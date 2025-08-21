#!/usr/bin/env python3
"""
Debug HPKE direct by calling the functions directly.
"""

import asyncio
import base64
import json
import sys
from datetime import datetime, timezone

sys.path.insert(0, '.')

from config import get_settings
from services.hpke_service import HPKEService
from services.inference_client import InferenceClient
from models import ChatRequest

async def debug_hpke_direct():
    """Debug the HPKE flow by calling functions directly."""
    print("🔧 Debug HPKE Direct")
    print("=" * 30)
    
    settings = get_settings()
    hpke_service = HPKEService(settings)
    inference_client = InferenceClient(settings)
    
    # Initialize inference client
    await inference_client.startup()
    print("✅ Services initialized")
    
    try:
        # Create test request
        payload = {
            "messages": [{"role": "user", "content": "Hello"}],
            "temperature": 0.7,
            "top_p": 0.9,
            "max_tokens": 10
        }
        payload_json = json.dumps(payload)
        ciphertext_b64 = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        
        chat_request = ChatRequest(
            encapsulated_key=base64.b64encode(b"mock_encapsulated_key_32bytes__").decode('ascii'),
            ciphertext=ciphertext_b64,
            aad=base64.b64encode(b"test_aad").decode('ascii'),
            timestamp=datetime.now(timezone.utc),
            request_id="test-debug-hello",
            device_pubkey=base64.b64encode(b"mock_device_pubkey_32bytes____").decode('ascii')
        )
        
        print(f"📝 Created request: {chat_request.request_id}")
        
        # Test HPKE decryption
        print("1️⃣ Testing HPKE decryption...")
        decrypted_payload = hpke_service.decrypt_request(chat_request)
        print(f"✅ Decrypted: {decrypted_payload.messages[0]['content']}")
        print(f"   Max tokens: {decrypted_payload.max_tokens}")
        
        # Test inference streaming
        print("2️⃣ Testing inference streaming...")
        chunk_count = 0
        full_response = ""
        
        async for chunk in inference_client.stream_chat(decrypted_payload):
            chunk_count += 1
            full_response += chunk
            print(f"📦 Chunk {chunk_count}: '{chunk}'")
            if chunk_count >= 5:  # Just test first few chunks
                break
        
        print(f"✅ Got {chunk_count} chunks: '{full_response}'")
        
        # Test chunk encryption
        print("3️⃣ Testing chunk encryption...")
        client_pubkey = base64.b64decode(chat_request.device_pubkey)
        test_chunk = "Hello world"
        encrypted_chunk = hpke_service.encrypt_chunk(test_chunk, client_pubkey, 0)
        print(f"✅ Encrypted chunk: {encrypted_chunk[:100]}...")
        
        # Parse the encrypted chunk
        chunk_data = json.loads(encrypted_chunk)
        decrypted_test = base64.b64decode(chunk_data['ciphertext']).decode('utf-8')
        print(f"✅ Decrypted back: '{decrypted_test}'")
        
        print("\n🎉 All direct tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Direct test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        await inference_client.shutdown()

if __name__ == "__main__":
    success = asyncio.run(debug_hpke_direct())
    sys.exit(0 if success else 1)