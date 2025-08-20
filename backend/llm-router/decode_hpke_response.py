#!/usr/bin/env python3
"""
Decode HPKE response chunks to readable text.
Usage: curl ... | python3 decode_hpke_response.py
"""

import sys
import json
import base64

def decode_hpke_response():
    """Decode streaming HPKE response chunks into readable text."""
    
    print("🔓 Decoding HPKE Response:")
    print("=" * 40)
    
    full_response = ""
    chunk_count = 0
    
    for line in sys.stdin:
        line = line.strip()
        
        if line.startswith('data: {'):
            # Extract the JSON data after "data: "
            json_data = line[6:]  # Remove "data: " prefix
            
            try:
                chunk_data = json.loads(json_data)
                
                # Decode the base64 ciphertext
                if 'ciphertext' in chunk_data:
                    encrypted_text = chunk_data['ciphertext']
                    decrypted_chunk = base64.b64decode(encrypted_text).decode('utf-8')
                    
                    # Print the chunk
                    chunk_count += 1
                    print(f"Chunk {chunk_count:3d}: '{decrypted_chunk}'")
                    
                    # Add to full response
                    full_response += decrypted_chunk
                    
            except (json.JSONDecodeError, Exception) as e:
                # Skip malformed chunks
                continue
        
        elif line.startswith('event: end'):
            print("\n" + "=" * 40)
            print("🎉 FULL RESPONSE:")
            print("=" * 40)
            print(full_response)
            print("=" * 40)
            print(f"📊 Total chunks decoded: {chunk_count}")
            break

if __name__ == "__main__":
    try:
        decode_hpke_response()
    except KeyboardInterrupt:
        print("\n\n🔓 Partial decode complete!")
    except Exception as e:
        print(f"Error: {e}")
        print("Usage: curl ... | python3 decode_hpke_response.py")