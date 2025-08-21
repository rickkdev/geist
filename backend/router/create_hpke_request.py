#!/usr/bin/env python3
"""
Generate HPKE-encrypted curl requests for testing.
Usage: python3 create_hpke_request.py "Your question here"
"""

import sys
import json
import base64
from datetime import datetime, timezone
import uuid

def create_hpke_request(question):
    """Create a complete HPKE-encrypted curl request."""
    
    # Create the payload
    payload = {
        "messages": [{"role": "user", "content": question}],
        "temperature": 0.7,
        "top_p": 0.9,
        "max_tokens": 500
    }
    
    # Encode as base64 (simulating HPKE encryption)
    payload_json = json.dumps(payload)
    ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
    
    # Generate current timestamp
    timestamp = datetime.now(timezone.utc).isoformat()
    
    # Generate unique request ID
    request_id = f"custom-question-{str(uuid.uuid4())[:8]}"
    
    # Create the curl command (single line to avoid JSON parsing issues)
    curl_command = f'''curl -X POST http://localhost:8000/api/chat -H "Content-Type: application/json" -d '{{"encapsulated_key":"bW9ja19lbmNhcHN1bGF0ZWRfa2V5XzMyYnl0ZXNfXw==","ciphertext":"{ciphertext}","aad":"dGVzdF9hYWQ=","timestamp":"{timestamp}","request_id":"{request_id}","device_pubkey":"bW9ja19kZXZpY2VfcHVia2V5XzMyYnl0ZXNfX19f"}}\'
'''
    
    return curl_command

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 create_hpke_request.py \"Your question here\"")
        print("\nExample questions:")
        print("  python3 create_hpke_request.py \"Explain quantum computing\"")
        print("  python3 create_hpke_request.py \"What is the capital of France?\"")
        print("  python3 create_hpke_request.py \"Write a Python function to reverse a string\"")
        sys.exit(1)
    
    question = sys.argv[1]
    curl_command = create_hpke_request(question)
    
    print(f"🔐 HPKE-Encrypted Request for: \"{question}\"")
    print("=" * 60)
    print(curl_command)
    print("\n💡 Copy and paste this into your terminal!")