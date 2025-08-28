#!/bin/bash

# Inference Server Startup Script
# Start the llama.cpp inference server for development

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🧠 Starting LLM Inference Server"
echo "================================="

# Check if llama.cpp exists
if [[ ! -f "llama.cpp/build/bin/llama-server" ]]; then
    echo "❌ llama.cpp not found at llama.cpp/build/bin/llama-server"
    echo "Please build llama.cpp first:"
    echo "  cd llama.cpp && make"
    exit 1
fi

# Check if model exists
MODEL_PATH="llama.cpp/models/gpt-oss-20b-Q4_K_S.gguf"
if [[ ! -f "$MODEL_PATH" ]]; then
    echo "❌ Model not found: $MODEL_PATH"
    echo "Please download a model file to that location"
    exit 1
fi

echo "🚀 Starting llama.cpp inference server..."
echo "   Model: $MODEL_PATH"
echo "   Binding to: localhost:8001 (not exposed externally)"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down inference server..."
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start llama.cpp server with gpt-oss optimized settings (no jinja due to template bugs)
llama.cpp/build/bin/llama-server \
    -m "$MODEL_PATH" \
    -c 4096 \
    -ngl 0 \
    --port 8001 \
    --host 127.0.0.1 \
    --log-disable \
    --temp 1.0 \
    --top-p 1.0 \
    --sampling-seq tp \
    --min-p 0.0 \
    --top-k 0

echo "✅ Inference server stopped"