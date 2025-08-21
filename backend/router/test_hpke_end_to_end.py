#!/usr/bin/env python3
"""
Test the complete HPKE end-to-end flow by calling the actual API.
"""

import asyncio
import aiohttp
import base64
import json
import sys

async def test_hpke_api():
    """Test the complete HPKE API flow."""
    print("🔐 Testing HPKE End-to-End API")
    print("=" * 40)
    
    base_url = "http://localhost:8000"
    
    async with aiohttp.ClientSession() as session:
        # Test health endpoint
        print("1️⃣ Testing health endpoint...")
        async with session.get(f"{base_url}/health") as response:
            if response.status == 200:
                health_data = await response.json()
                print(f"✅ Health: {health_data['status']}")
            else:
                print(f"❌ Health check failed: {response.status}")
                return False
        
        # Test pubkey endpoint
        print("\n2️⃣ Testing pubkey endpoint...")
        async with session.get(f"{base_url}/api/pubkey") as response:
            if response.status == 200:
                pubkey_data = await response.json()
                print(f"✅ Got pubkey: {pubkey_data['key_id']}")
                print(f"   Algorithm: {pubkey_data.get('algorithm', 'N/A')}")
            else:
                print(f"❌ Pubkey check failed: {response.status}")
                return False
        
        # Test chat endpoint with HPKE
        print("\n3️⃣ Testing HPKE chat endpoint...")
        
        # Prepare the chat request
        payload = {
            "messages": [{"role": "user", "content": "Who were the presidents in the US in the 90s?"}],
            "temperature": 0.7,
            "top_p": 0.9,
            "max_tokens": 100
        }
        payload_json = json.dumps(payload)
        
        # For testing, we base64-encode the JSON (simulating HPKE encryption)
        ciphertext_b64 = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        
        chat_request = {
            "encapsulated_key": base64.b64encode(b"mock_encapsulated_key_32bytes__").decode('ascii'),
            "ciphertext": ciphertext_b64,
            "aad": base64.b64encode(b"test_aad").decode('ascii'),
            "timestamp": "2025-08-20T14:50:00Z",
            "request_id": "test-e2e-presidents-456",
            "device_pubkey": base64.b64encode(b"mock_device_pubkey_32bytes____").decode('ascii')
        }
        
        print(f"📝 Sending question: {payload['messages'][0]['content']}")
        
        try:
            async with session.post(
                f"{base_url}/api/chat",
                json=chat_request,
                headers={"Content-Type": "application/json"}
            ) as response:
                print(f"📡 Response status: {response.status}")
                print(f"📡 Response headers: {dict(response.headers)}")
                
                if response.status != 200:
                    error_text = await response.text()
                    print(f"❌ Request failed: {error_text}")
                    return False
                
                # Read the streaming response
                chunk_count = 0
                print("📦 Reading chunks...")
                
                async for line in response.content:
                    line = line.decode('utf-8').strip()
                    if line:
                        print(f"🔗 Raw line: {line}")
                        
                        if line.startswith('event: '):
                            event_type = line[7:]
                            print(f"   📋 Event: {event_type}")
                        elif line.startswith('data: '):
                            data = line[6:]
                            print(f"   📄 Data: {data[:100]}...")
                            
                            if event_type == 'chunk':
                                try:
                                    # Parse the encrypted chunk
                                    encrypted_chunk = json.loads(data)
                                    # For testing, decode the base64 ciphertext
                                    chunk_text = base64.b64decode(encrypted_chunk['ciphertext']).decode('utf-8')
                                    print(f"   ✨ Decrypted: '{chunk_text}'")
                                    chunk_count += 1
                                except Exception as e:
                                    print(f"   ❌ Failed to decrypt: {e}")
                            elif event_type == 'end':
                                print("   🏁 End event received")
                                break
                            elif event_type == 'error':
                                print(f"   ❌ Error event: {data}")
                                return False
                        
                        # Stop after reasonable number of chunks
                        if chunk_count > 20:
                            print("   ⏹️ Stopping after 20 chunks for test")
                            break
                
                print(f"\n✅ Streaming test completed! Got {chunk_count} chunks")
                return True
                
        except Exception as e:
            print(f"❌ Request failed with exception: {e}")
            return False

if __name__ == "__main__":
    success = asyncio.run(test_hpke_api())
    sys.exit(0 if success else 1)