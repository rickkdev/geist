#!/bin/bash

# Test script for UNIX socket inference server
set -euo pipefail

SOCKET_PATH="${1:-/tmp/inference.sock}"

echo "Testing UNIX socket at: $SOCKET_PATH"

# Test 1: Health check
echo "1. Testing health endpoint..."
if curl --unix-socket "$SOCKET_PATH" http://localhost/health -f -s; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    exit 1
fi

echo

# Test 2: Simple completion
echo "2. Testing chat completion..."
RESPONSE=$(curl --unix-socket "$SOCKET_PATH" http://localhost/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Say hello in one word"}],"max_tokens":5}' \
    -f -s)

if echo "$RESPONSE" | jq -e '.choices[0].message.content' > /dev/null 2>&1; then
    echo "✅ Chat completion passed"
    echo "Response: $(echo "$RESPONSE" | jq -r '.choices[0].message.content' | head -c 100)..."
else
    echo "❌ Chat completion failed - invalid JSON structure"
    echo "Response: $RESPONSE"
    exit 1
fi

echo

# Test 3: Streaming
echo "3. Testing streaming..."
curl --unix-socket "$SOCKET_PATH" http://localhost/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Count 1 2 3"}],"stream":true,"max_tokens":10}' \
    -f -s | head -5

echo "✅ Streaming test passed"

echo
echo "🎉 All tests passed! UNIX socket is working correctly."