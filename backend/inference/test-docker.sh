#!/bin/bash

# Test script for llama.cpp Docker inference server

set -e

echo "🧪 Testing llama.cpp Docker Inference Server"
echo "============================================="

# Build the Docker image
echo ""
echo "1️⃣ Building Docker image..."
docker build -t llama-inference-test .

# Start the container
echo ""
echo "2️⃣ Starting container..."
docker run -d --name llama-test -p 8001:8001 llama-inference-test

# Function to cleanup
cleanup() {
    echo ""
    echo "🧹 Cleaning up..."
    docker stop llama-test >/dev/null 2>&1 || true
    docker rm llama-test >/dev/null 2>&1 || true
    echo "✅ Cleanup complete"
}

# Set up cleanup on exit
trap cleanup EXIT

# Wait for server to be ready
echo ""
echo "3️⃣ Waiting for server to be ready..."
for i in {1..120}; do
    if curl -s http://localhost:8001/health >/dev/null 2>&1; then
        echo "   ✅ Server is ready!"
        break
    fi
    echo -n "."
    sleep 1
    if [[ $i -eq 120 ]]; then
        echo ""
        echo "   ❌ Server failed to start within 2 minutes"
        echo "   📋 Container logs:"
        docker logs llama-test
        exit 1
    fi
done

# Test health endpoint
echo ""
echo "4️⃣ Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:8001/health)
echo "   Response: $HEALTH_RESPONSE"

if [[ "$HEALTH_RESPONSE" == *"ok"* ]]; then
    echo "   ✅ Health check passed"
else
    echo "   ❌ Health check failed"
    exit 1
fi

# Test completion endpoint
echo ""
echo "5️⃣ Testing completion endpoint..."
COMPLETION_RESPONSE=$(curl -s -X POST http://localhost:8001/completion \
    -H "Content-Type: application/json" \
    -d '{
        "prompt": "The capital of France is",
        "n_predict": 5,
        "temperature": 0.1
    }')

echo "   Response: $COMPLETION_RESPONSE"

if [[ "$COMPLETION_RESPONSE" == *"content"* ]]; then
    echo "   ✅ Completion test passed"
else
    echo "   ❌ Completion test failed"
    exit 1
fi

# Test chat endpoint
echo ""
echo "6️⃣ Testing chat endpoint..."
CHAT_RESPONSE=$(curl -s -X POST http://localhost:8001/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{
        "messages": [
            {"role": "user", "content": "Hello!"}
        ],
        "max_tokens": 10,
        "temperature": 0.1
    }')

echo "   Response: $CHAT_RESPONSE"

if [[ "$CHAT_RESPONSE" == *"choices"* ]]; then
    echo "   ✅ Chat test passed"
else
    echo "   ❌ Chat test failed"
    exit 1
fi

echo ""
echo "🎉 All tests passed! Docker inference server is working correctly."
echo ""
echo "📊 Container stats:"
docker stats llama-test --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

echo ""
echo "🔍 Server info:"
echo "   Image: llama-inference-test"
echo "   Port: 8001"
echo "   Model: TinyLlama 1.1B Chat"
echo "   Health: http://localhost:8001/health"
