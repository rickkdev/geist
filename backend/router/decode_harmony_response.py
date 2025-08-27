#!/usr/bin/env python3
"""
Decode HPKE response chunks with Harmony channel parsing.
Usage: curl ... | python3 decode_harmony_response.py
"""

import sys
import json
import base64
import re

class HarmonyResponseDecoder:
    def __init__(self):
        self.full_response = ""
        self.chunk_count = 0
        self.current_channel = None
        self.channels = {
            'final': [],
            'analysis': [],
            'commentary': []
        }
        
    def parse_harmony_content(self, content):
        """Parse Harmony special tokens and channel content."""
        # Look for channel markers
        if content == '<|channel|>':
            return 'channel_marker', content
        elif content in ['final', 'analysis', 'commentary']:
            self.current_channel = content
            return 'channel_name', content
        elif content == '<|message|>':
            return 'message_marker', content
        elif content in ['<|start|>', '<|end|>', '<|return|>']:
            return 'control_token', content
        else:
            return 'content', content
    
    def add_content(self, content):
        """Add content to the appropriate channel."""
        token_type, token_content = self.parse_harmony_content(content)
        
        if token_type == 'content' and self.current_channel:
            self.channels[self.current_channel].append(token_content)
        
        return token_type, token_content
    
    def get_final_response(self):
        """Get the final user-facing response."""
        return ''.join(self.channels['final'])
    
    def get_analysis_response(self):
        """Get the analysis/reasoning content."""  
        return ''.join(self.channels['analysis'])
    
    def get_commentary_response(self):
        """Get the commentary content."""
        return ''.join(self.channels['commentary'])

def decode_harmony_response():
    """Decode streaming HPKE response chunks with Harmony channel parsing."""
    
    print("🔓 Decoding Harmony HPKE Response:")
    print("=" * 50)
    
    decoder = HarmonyResponseDecoder()
    
    for line in sys.stdin:
        line = line.strip()
        
        # Skip empty lines
        if not line:
            continue
            
        # Parse SSE format
        if line.startswith("event:") or line.startswith("data:"):
            if line.startswith("data:"):
                try:
                    # Extract JSON from "data: {...}"
                    json_str = line[5:].strip()  # Remove "data: "
                    
                    if json_str == "[DONE]":
                        print("Stream completed.")
                        break
                        
                    data = json.loads(json_str)
                    
                    # Extract encrypted chunk
                    if "ciphertext" in data:
                        encrypted_content = data["ciphertext"]
                        
                        # Decode base64 content (simplified for demo)
                        try:
                            decoded_bytes = base64.b64decode(encrypted_content)
                            content = decoded_bytes.decode('utf-8')
                            
                            decoder.chunk_count += 1
                            decoder.full_response += content
                            
                            # Parse and categorize content
                            token_type, token_content = decoder.add_content(content)
                            
                            # Show debug info
                            if token_type == 'channel_marker':
                                print(f"\n📍 Channel Marker Found")
                            elif token_type == 'channel_name':
                                print(f"🔀 Switched to channel: {token_content}")
                            elif token_type == 'message_marker':
                                print(f"📝 Message Content Starts")
                            elif token_type == 'control_token':
                                print(f"🎛️  Control: {token_content}")
                            else:
                                # Only show content for debugging, don't spam
                                if decoder.chunk_count <= 10 or decoder.chunk_count % 20 == 0:
                                    channel_info = f"[{decoder.current_channel}]" if decoder.current_channel else "[unknown]"
                                    print(f"Chunk {decoder.chunk_count:3d} {channel_info}: {repr(content[:50])}")
                                    
                        except Exception as e:
                            print(f"Failed to decode chunk {decoder.chunk_count}: {e}")
                            
                except json.JSONDecodeError as e:
                    print(f"Failed to parse JSON: {e}")
                except Exception as e:
                    print(f"Error processing line: {e}")

    # Show results by channel
    print("\n" + "=" * 50)
    print("📊 HARMONY CHANNEL RESULTS:")
    print("=" * 50)
    
    final_content = decoder.get_final_response()
    analysis_content = decoder.get_analysis_response()
    commentary_content = decoder.get_commentary_response()
    
    if final_content:
        print("🎯 FINAL RESPONSE (User-facing):")
        print("-" * 30)
        print(final_content)
        print()
    
    if analysis_content:
        print("🧠 ANALYSIS (Reasoning/Thinking):")
        print("-" * 30) 
        print(analysis_content[:500] + "..." if len(analysis_content) > 500 else analysis_content)
        print()
        
    if commentary_content:
        print("💬 COMMENTARY (Tool calls/Meta):")
        print("-" * 30)
        print(commentary_content[:200] + "..." if len(commentary_content) > 200 else commentary_content)
        print()
    
    print(f"📈 STATS:")
    print(f"  Total chunks: {decoder.chunk_count}")
    print(f"  Final content: {len(final_content)} chars")
    print(f"  Analysis content: {len(analysis_content)} chars") 
    print(f"  Commentary content: {len(commentary_content)} chars")
    
    # Show what the user should actually see
    if final_content:
        print("\n" + "🎯" * 20)
        print("USER SEES (Final Response Only):")
        print("🎯" * 20)
        print(final_content)
    else:
        print("\n❌ No final response found - this suggests Harmony parsing needs adjustment")

if __name__ == "__main__":
    try:
        decode_harmony_response()
    except KeyboardInterrupt:
        print("\nDecoding interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)