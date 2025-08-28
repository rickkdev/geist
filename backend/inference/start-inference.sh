#!/bin/bash

# LLM Inference Server Startup Script
# This script sets up and starts the llama.cpp inference server

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Starting LLM Inference Server"
echo "================================"

# Configuration
LLAMA_CPP_DIR="$PROJECT_ROOT/llama.cpp"
MODEL_DIR="$LLAMA_CPP_DIR/models"
DEFAULT_MODEL="tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
MODEL_URL="https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"

# Server settings
HOST="127.0.0.1"
PORT="8001"
CONTEXT_SIZE="4096"
GPU_LAYERS="99"  # Use all GPU layers if available
THREADS="0"      # Auto-detect

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down inference server..."
    if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "Stopping inference server (PID: $SERVER_PID)..."
        kill "$SERVER_PID"
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    echo "✅ Cleanup complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo ""
echo "1️⃣ Checking llama.cpp installation..."

# Check if llama.cpp exists
if [[ ! -d "$LLAMA_CPP_DIR" ]]; then
    echo "📥 Cloning llama.cpp..."
    git clone https://github.com/ggerganov/llama.cpp.git "$LLAMA_CPP_DIR"
fi

# Check if binary exists
if [[ ! -f "$LLAMA_CPP_DIR/build/bin/llama-server" ]]; then
    echo "🔨 Building llama.cpp..."
    cd "$LLAMA_CPP_DIR"
    
    # Create build directory
    mkdir -p build
    cd build
    
    # Configure and build
    echo "   Configuring with CMake..."
    cmake .. -DCMAKE_BUILD_TYPE=Release
    
    echo "   Building (this may take a few minutes)..."
    make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4) llama-server
    
    cd "$PROJECT_ROOT"
fi

echo "   ✅ llama.cpp is ready"

echo ""
echo "2️⃣ Checking model availability..."

# Create models directory
mkdir -p "$MODEL_DIR"

# Check if default model exists
if [[ ! -f "$MODEL_DIR/$DEFAULT_MODEL" ]]; then
    echo "📥 Downloading default model ($DEFAULT_MODEL)..."
    echo "   This may take a few minutes (637MB download)..."
    
    cd "$MODEL_DIR"
    curl -L --progress-bar -o "$DEFAULT_MODEL" "$MODEL_URL"
    cd "$PROJECT_ROOT"
fi

echo "   ✅ Model is ready: $DEFAULT_MODEL"

echo ""
echo "3️⃣ Starting inference server..."
echo "   Model: $MODEL_DIR/$DEFAULT_MODEL"
echo "   Binding to: $HOST:$PORT"
echo "   Context size: $CONTEXT_SIZE"
echo "   GPU layers: $GPU_LAYERS"

# Start the server
cd "$LLAMA_CPP_DIR"
./build/bin/llama-server \
    -m "$MODEL_DIR/$DEFAULT_MODEL" \
    -c "$CONTEXT_SIZE" \
    -ngl "$GPU_LAYERS" \
    -t "$THREADS" \
    --port "$PORT" \
    --host "$HOST" \
    --log-disable &

SERVER_PID=$!

echo "   ✅ Inference server started (PID: $SERVER_PID)"

# Wait for server to be ready
echo "   ⏳ Waiting for server to load model..."
for i in {1..60}; do
    if curl -s "http://$HOST:$PORT/health" >/dev/null 2>&1; then
        echo "   ✅ Server is ready and healthy"
        break
    fi
    sleep 1
    if [[ $i -eq 60 ]]; then
        echo "   ❌ Server failed to start within 60 seconds"
        cleanup
        exit 1
    fi
done

echo ""
echo "🎉 Inference server is running!"
echo ""
echo "📡 Endpoints:"
echo "  Health check:      http://$HOST:$PORT/health"
echo "  Text completion:   http://$HOST:$PORT/completion"
echo "  Chat completion:   http://$HOST:$PORT/v1/chat/completions"
echo ""
echo "🧪 Test commands:"
echo "  # Health check"
echo "  curl http://$HOST:$PORT/health"
echo ""
echo "  # Simple completion"
echo "  curl -X POST http://$HOST:$PORT/completion \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"prompt\": \"The capital of France is\", \"n_predict\": 10}'"
echo ""
echo "  # Chat completion"
echo "  curl -X POST http://$HOST:$PORT/v1/chat/completions \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"messages\": [{\"role\": \"user\", \"content\": \"Hello!\"}], \"max_tokens\": 50}'"
echo ""
echo "🛑 Press Ctrl+C to stop the server"
echo ""

# Keep script running and wait for signals
wait