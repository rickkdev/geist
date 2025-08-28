#!/bin/bash

# Master Backend Startup Script
# Starts both inference server and router in the correct order

set -e

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BACKEND_ROOT"

echo "🚀 Starting Complete Backend Stack"
echo "=================================="

# PIDs for cleanup
INFERENCE_PID=""
ROUTER_PID=""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down backend services..."
    
    if [[ -n "$ROUTER_PID" ]] && kill -0 "$ROUTER_PID" 2>/dev/null; then
        echo "Stopping router (PID: $ROUTER_PID)..."
        kill "$ROUTER_PID"
        wait "$ROUTER_PID" 2>/dev/null || true
    fi
    
    if [[ -n "$INFERENCE_PID" ]] && kill -0 "$INFERENCE_PID" 2>/dev/null; then
        echo "Stopping inference server (PID: $INFERENCE_PID)..."
        kill "$INFERENCE_PID"
        wait "$INFERENCE_PID" 2>/dev/null || true
    fi
    
    echo "✅ All services stopped"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo ""
echo "1️⃣ Starting inference server..."
echo "   This may take a few minutes on first run..."

# Start inference server in background
cd "$BACKEND_ROOT/inference"
./start-inference.sh &
INFERENCE_PID=$!

# Wait for inference server to be ready
echo "   ⏳ Waiting for inference server to be ready..."
for i in {1..120}; do
    if curl -s http://127.0.0.1:8001/health >/dev/null 2>&1; then
        echo "   ✅ Inference server is ready"
        break
    fi
    sleep 1
    if [[ $i -eq 120 ]]; then
        echo "   ❌ Inference server failed to start"
        cleanup
        exit 1
    fi
done

echo ""
echo "2️⃣ Starting router..."

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "📥 Installing uv package manager..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    source "$HOME/.local/bin/env"
fi

# Start router
cd "$BACKEND_ROOT/router"

# Install dependencies if needed
if [[ ! -d ".venv" ]]; then
    echo "📦 Installing router dependencies..."
    uv sync
fi

# Set environment variables
export ENVIRONMENT=development
export LOG_LEVEL=DEBUG
export INFERENCE_ENDPOINTS='["http://127.0.0.1:8001"]'
export INFERENCE_TRANSPORT=http

# Start router in background
echo "   Starting FastAPI router..."
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload &
ROUTER_PID=$!

# Wait for router to be ready
echo "   ⏳ Waiting for router to be ready..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:8000/health >/dev/null 2>&1; then
        echo "   ✅ Router is ready"
        break
    fi
    sleep 1
    if [[ $i -eq 30 ]]; then
        echo "   ❌ Router failed to start"
        cleanup
        exit 1
    fi
done

echo ""
echo "🎉 Backend stack is fully operational!"
echo ""
echo "📡 Services:"
echo "  Inference Server:  http://127.0.0.1:8001"
echo "  Router:           http://127.0.0.1:8000"
echo ""
echo "🔍 Health Checks:"
echo "  Inference: $(curl -s http://127.0.0.1:8001/health 2>/dev/null || echo 'Failed')"
echo "  Router:    $(curl -s http://127.0.0.1:8000/health 2>/dev/null | jq -r '.status' 2>/dev/null || echo 'Failed')"
echo ""
echo "📡 Router Endpoints:"
echo "  Health check:      http://127.0.0.1:8000/health"
echo "  HPKE public keys:  http://127.0.0.1:8000/api/pubkey"
echo "  Encrypted chat:    http://127.0.0.1:8000/api/chat"
echo "  Direct inference:  http://127.0.0.1:8000/inference"
echo "  Metrics:          http://127.0.0.1:8000/metrics"
echo ""
echo "🧪 Test encrypted chat:"
echo "  cd router && python create_hpke_request.py \"Hello, how are you?\""
echo "  # Then copy and run the generated curl command"
echo ""
echo "🛑 Press Ctrl+C to stop all services"
echo ""

# Keep script running and wait for signals
wait
