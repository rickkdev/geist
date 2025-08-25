#!/bin/bash

# Simple Development Server Startup Script
# This replaces the complex systemd setup with a simple script for development

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Starting LLM Router - Development Mode"
echo "========================================"

# Check if llama.cpp exists
if [[ ! -f "../inference/llama.cpp/build/bin/llama-server" ]]; then
    echo "❌ llama.cpp not found at ../inference/llama.cpp/build/bin/llama-server"
    echo "Please build llama.cpp first:"
    echo "  cd ../inference/llama.cpp && make"
    exit 1
fi

# Check if model exists
MODEL_PATH="../inference/llama.cpp/models/gpt-oss-20b-Q4_K_S.gguf"
if [[ ! -f "$MODEL_PATH" ]]; then
    echo "❌ Model not found: $MODEL_PATH"
    echo "Please download a model file to that location"
    exit 1
fi

# Function to cleanup background processes
cleanup() {
    echo ""
    echo "🛑 Shutting down servers..."
    
    if [[ -n "${LLAMA_PID:-}" ]] && kill -0 "$LLAMA_PID" 2>/dev/null; then
        echo "Stopping llama.cpp server (PID: $LLAMA_PID)..."
        kill "$LLAMA_PID"
        wait "$LLAMA_PID" 2>/dev/null || true
    fi
    
    if [[ -n "${ROUTER_PID:-}" ]] && kill -0 "$ROUTER_PID" 2>/dev/null; then
        echo "Stopping router server (PID: $ROUTER_PID)..."
        kill "$ROUTER_PID"
        wait "$ROUTER_PID" 2>/dev/null || true
    fi
    
    echo "✅ Cleanup complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo ""
echo "1️⃣ Starting llama.cpp inference server..."
echo "   Model: $MODEL_PATH"
echo "   Binding to: localhost:8001 (not exposed externally)"

# Start llama.cpp server in background
../inference/llama.cpp/build/bin/llama-server \
    -m "$MODEL_PATH" \
    -c 4096 \
    -ngl 99 \
    --port 8001 \
    --host 127.0.0.1 \
    --log-disable &

LLAMA_PID=$!

echo "   ✅ llama.cpp server started (PID: $LLAMA_PID)"

# Wait for llama.cpp to be ready
echo "   ⏳ Waiting for llama.cpp to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:8001/health >/dev/null 2>&1; then
        echo "   ✅ llama.cpp server is ready"
        break
    fi
    sleep 1
    if [[ $i -eq 30 ]]; then
        echo "   ❌ llama.cpp server failed to start"
        kill "$LLAMA_PID" 2>/dev/null || true
        exit 1
    fi
done

echo ""
echo "2️⃣ Starting FastAPI router server..."
echo "   Binding to: localhost:8000 (development mode)"
echo "   Environment: DEVELOPMENT"

# Set development environment variables
export ENVIRONMENT=development
export INFERENCE_TRANSPORT=http
export INFERENCE_ENDPOINTS='["http://127.0.0.1:8001"]'
export LOG_LEVEL=DEBUG

# Start router server in background
uv run uvicorn main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --reload \
    --log-level info &

ROUTER_PID=$!

echo "   ✅ FastAPI router started (PID: $ROUTER_PID)"

# Wait for router to be ready
echo "   ⏳ Waiting for router to be ready..."
for i in {1..15}; do
    if curl -s http://localhost:8000/health >/dev/null 2>&1; then
        echo "   ✅ Router server is ready"
        break
    fi
    sleep 1
    if [[ $i -eq 15 ]]; then
        echo "   ❌ Router server failed to start"
        cleanup
        exit 1
    fi
done

echo ""
echo "🎉 Development servers are running!"
echo ""
echo "📡 Endpoints:"
echo "  Router (main):     http://localhost:8000"
echo "  Health check:      http://localhost:8000/health"
echo "  HPKE public keys:  http://localhost:8000/api/pubkey"
echo "  Inference (direct): http://localhost:8001 (localhost only)"
echo ""
echo "🧪 Test commands:"
echo "  # Health check"
echo "  curl http://localhost:8000/health"
echo ""
echo "  # Get public keys"
echo "  curl http://localhost:8000/api/pubkey"
echo ""
echo "  # Send encrypted request"
echo "  python3 create_hpke_request.py \"Hello, how are you?\" | grep curl | bash"
echo ""
echo "🛑 Press Ctrl+C to stop all servers"
echo ""

# Keep script running and wait for signals
wait