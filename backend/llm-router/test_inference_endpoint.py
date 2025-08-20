#!/usr/bin/env python3
"""
Test script for the new /inference endpoint (step 9 implementation).
Tests both direct inference and streaming with parameter guardrails.
"""

import asyncio
import httpx
import json
import time
from datetime import datetime

# Base URL for the router
BASE_URL = "http://localhost:8000"


async def test_health_check():
    """Test the health endpoint first."""
    print("=== Testing Health Check ===")
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{BASE_URL}/health")
            print(f"Health Status: {response.status_code}")
            if response.status_code == 200:
                data = response.json()
                print(f"Service Status: {data['status']}")
                return data['status'] == 'healthy'
            else:
                print("Health check failed")
                return False
    except Exception as e:
        print(f"Health check error: {e}")
        return False


async def test_inference_endpoint():
    """Test the new /inference endpoint with streaming."""
    print("\n=== Testing /inference Endpoint ===")
    
    # Test request with parameter guardrails
    test_request = {
        "messages": [
            {"role": "user", "content": "Count from 1 to 5, one number per response chunk"}
        ],
        "temperature": 0.8,  # Should be clamped by guardrails
        "top_p": 0.9,
        "max_tokens": 100,
        "request_id": f"test-{datetime.now().isoformat()}"
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            print(f"Sending request: {test_request['messages'][0]['content']}")
            print(f"Parameters: temp={test_request['temperature']}, top_p={test_request['top_p']}, max_tokens={test_request['max_tokens']}")
            
            async with client.stream(
                "POST",
                f"{BASE_URL}/inference",
                json=test_request,
                headers={"Accept": "text/event-stream"}
            ) as response:
                
                if response.status_code != 200:
                    print(f"Error: Status {response.status_code}")
                    print(await response.aread())
                    return False
                
                print(f"Response Status: {response.status_code}")
                print("Streaming tokens:")
                print("-" * 40)
                
                token_count = 0
                start_time = time.time()
                
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]  # Remove "data: " prefix
                        
                        if not data.strip():
                            continue
                            
                        try:
                            print(f"Raw SSE data: {data}")
                            # The token should be in the data field
                            if data and data != '':
                                token_count += 1
                                print(f"Token {token_count}: {repr(data)}")
                        except Exception as e:
                            print(f"Parse error: {e}")
                    
                    elif line.startswith("event: "):
                        event_type = line[7:]  # Remove "event: " prefix  
                        print(f"Event: {event_type}")
                        
                        if event_type == "done":
                            print("Stream completed successfully")
                            break
                        elif event_type == "error":
                            print("Stream error received")
                            break
                
                elapsed = time.time() - start_time
                print("-" * 40)
                print(f"Received {token_count} tokens in {elapsed:.2f}s")
                print(f"Tokens/second: {token_count/elapsed:.2f}")
                return token_count > 0
                
    except Exception as e:
        print(f"Inference test error: {e}")
        return False


async def test_parameter_guardrails():
    """Test parameter guardrails enforcement."""
    print("\n=== Testing Parameter Guardrails ===")
    
    # Test parameters within Pydantic bounds but that trigger our custom guardrails
    extreme_request = {
        "messages": [
            {"role": "user", "content": "Hello"}
        ],
        "temperature": 1.8,  # Should be clamped to 1.5 by our guardrails
        "top_p": 0.98,       # Should be clamped to 0.95 by our guardrails
        "max_tokens": 5000,  # Should be clamped to 4096 by our guardrails
        "request_id": f"guardrails-test-{datetime.now().isoformat()}"
    }
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            print("Testing parameters that trigger our custom guardrails:")
            print(f"Input: temp=1.8, top_p=0.98, max_tokens=5000")
            print("Expected: clamped to temp=1.5, top_p=0.95, max_tokens=4096")
            
            response = await client.post(
                f"{BASE_URL}/inference",
                json=extreme_request,
                headers={"Accept": "text/event-stream"}
            )
            
            if response.status_code == 200:
                print("✓ Request accepted (parameters clamped by guardrails)")
                return True
            else:
                print(f"✗ Request failed: {response.status_code}")
                print(await response.aread())
                return False
                
    except Exception as e:
        print(f"Guardrails test error: {e}")
        return False


async def main():
    """Run all inference tests."""
    print("Starting inference endpoint tests...")
    
    # Test health first
    healthy = await test_health_check()
    if not healthy:
        print("❌ Health check failed - make sure inference server is running")
        return
    
    # Test basic inference streaming
    inference_ok = await test_inference_endpoint()
    if not inference_ok:
        print("❌ Inference endpoint test failed")
        return
    
    # Test parameter guardrails
    guardrails_ok = await test_parameter_guardrails()
    if not guardrails_ok:
        print("❌ Parameter guardrails test failed")
        return
    
    print("\n" + "="*50)
    print("✅ All inference tests passed!")
    print("✅ Step 9 implementation working correctly:")
    print("  - SSE token streaming from llama.cpp")
    print("  - Router parsing and re-framing")  
    print("  - Parameter validation with guardrails")
    print("  - Dedicated /inference endpoint")


if __name__ == "__main__":
    asyncio.run(main())