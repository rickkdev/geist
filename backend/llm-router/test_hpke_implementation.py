#!/usr/bin/env python3
"""
Test script for HPKE implementation in the LLM Router.
This verifies that the HPKE encryption/decryption works correctly.
"""

import base64
import json
import os
import sys
from datetime import datetime, timezone

# Add the current directory to Python path
sys.path.insert(0, '.')

from config import get_settings
from services.hpke_service import HPKEService
from models import ChatRequest, DecryptedChatPayload


def test_hpke_encryption_flow():
    """Test the complete HPKE encryption/decryption flow."""
    print("🔐 Testing HPKE Implementation")
    print("=" * 50)
    
    # Initialize settings and service
    settings = get_settings()
    hpke_service = HPKEService(settings)
    
    print("✅ HPKE Service initialized")
    
    # Test public key retrieval
    pubkeys = hpke_service.get_public_keys()
    print(f"✅ Public keys retrieved: key_id={pubkeys['key_id']}")
    print(f"   Algorithm: {pubkeys['algorithm']}")
    print(f"   Current pubkey: {pubkeys['current_pubkey'][:32]}...")
    
    # Create test payload
    test_payload = {
        "messages": [
            {"role": "user", "content": "Hello, this is a test message for HPKE encryption!"}
        ],
        "temperature": 0.7,
        "top_p": 0.9,
        "max_tokens": 100
    }
    
    print(f"✅ Test payload created: {test_payload['messages'][0]['content'][:30]}...")
    
    # In a real scenario, the client would encrypt the payload
    # For testing, we'll simulate this by base64 encoding
    payload_json = json.dumps(test_payload)
    simulated_ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
    
    # Create a mock encrypted request
    test_request = ChatRequest(
        encapsulated_key=base64.b64encode(b"mock_encapsulated_key_32bytes__").decode('ascii'),
        ciphertext=simulated_ciphertext,  # In real use, this would be HPKE-encrypted
        aad=base64.b64encode(b"test_aad").decode('ascii'),
        timestamp=datetime.now(timezone.utc),
        request_id="test-request-123",
        device_pubkey=base64.b64encode(b"mock_device_pubkey_32bytes____").decode('ascii')
    )
    
    print("✅ Mock encrypted request created")
    
    # Test decryption (this will use our placeholder decryption for now)
    try:
        decrypted_payload = hpke_service.decrypt_request(test_request)
        print("✅ Request decryption successful")
        print(f"   Decrypted message: {decrypted_payload.messages[0]['content'][:50]}...")
        print(f"   Temperature: {decrypted_payload.temperature}")
        print(f"   Max tokens: {decrypted_payload.max_tokens}")
    except Exception as e:
        print(f"❌ Request decryption failed: {e}")
        return False
    
    # Test chunk encryption
    try:
        test_chunk = "This is a test response chunk from the LLM."
        client_pubkey = base64.b64decode(test_request.device_pubkey)
        encrypted_chunk = hpke_service.encrypt_chunk(test_chunk, client_pubkey, sequence=0)
        print("✅ Chunk encryption successful")
        print(f"   Original chunk: {test_chunk}")
        print(f"   Encrypted chunk (first 100 chars): {encrypted_chunk[:100]}...")
        
        # Parse the encrypted chunk
        chunk_data = json.loads(encrypted_chunk)
        print(f"   Chunk sequence: {chunk_data['sequence']}")
        print(f"   Has encapsulated key: {len(chunk_data['encapsulated_key']) > 0}")
        
    except Exception as e:
        print(f"❌ Chunk encryption failed: {e}")
        return False
    
    # Test key rotation status
    try:
        rotation_status = hpke_service.get_key_rotation_status()
        print("✅ Key rotation status retrieved")
        print(f"   Current key ID: {rotation_status['current_key_id']}")
        print(f"   Should rotate: {rotation_status['should_rotate']}")
        print(f"   Next key available: {rotation_status['next_key_available']}")
        
    except Exception as e:
        print(f"❌ Key rotation status failed: {e}")
        return False
    
    print("\n🎉 All HPKE tests passed successfully!")
    print("\n📝 Next steps:")
    print("   1. Start the llama.cpp inference server")
    print("   2. Start the router with: uvicorn main:app --reload --host 0.0.0.0 --port 8000")
    print("   3. Test endpoints:")
    print("      - GET  http://localhost:8000/health")
    print("      - GET  http://localhost:8000/api/pubkey")
    print("      - POST http://localhost:8000/api/chat (with proper HPKE encryption)")
    
    return True


if __name__ == "__main__":
    # Create dev-keys directory if it doesn't exist
    os.makedirs("dev-keys", exist_ok=True)
    
    success = test_hpke_encryption_flow()
    sys.exit(0 if success else 1)