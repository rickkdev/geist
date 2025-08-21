#!/usr/bin/env python3
"""
Direct test of inference client without HPKE.
"""

import asyncio
import sys
sys.path.insert(0, '.')

from config import get_settings
from services.inference_client import InferenceClient
from models import DecryptedChatPayload


async def test_direct_inference():
    """Test direct inference client without HPKE."""
    print("🔬 Testing Direct Inference Client")
    print("=" * 40)
    
    settings = get_settings()
    client = InferenceClient(settings)
    
    # Initialize client
    await client.startup()
    print("✅ Inference client initialized")
    
    # Test health check
    healthy = await client.health_check()
    print(f"✅ Health check: {'healthy' if healthy else 'unhealthy'}")
    
    if not healthy:
        print("❌ Inference server is not healthy")
        return False
    
    # Create test payload
    test_payload = DecryptedChatPayload(
        messages=[
            {"role": "user", "content": "Who were the presidents in the US in the 90s?"}
        ],
        temperature=0.7,
        top_p=0.9,
        max_tokens=100
    )
    
    print(f"📝 Test payload: {test_payload.messages[0]['content']}")
    
    try:
        print("🚀 Starting stream...")
        chunk_count = 0
        full_response = ""
        
        async for chunk in client.stream_chat(test_payload):
            chunk_count += 1
            full_response += chunk
            print(f"📦 Chunk {chunk_count}: '{chunk}'")
            
            # Stop after reasonable amount for testing
            if chunk_count > 50:
                break
        
        print("\n✅ Streaming completed successfully!")
        print(f"   Total chunks: {chunk_count}")
        print(f"   Full response: {full_response[:200]}...")
        
        await client.shutdown()
        return True
        
    except Exception as e:
        print(f"❌ Streaming failed: {e}")
        await client.shutdown()
        return False


if __name__ == "__main__":
    success = asyncio.run(test_direct_inference())
    sys.exit(0 if success else 1)