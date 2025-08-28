# Router Startup Instructions

This guide will get the LLM Router service running from scratch.

## Prerequisites

- macOS/Linux system
- Git installed
- CMake installed (for inference server)
- C++ compiler (Xcode command line tools on macOS)

## Quick Start

### Option 1: Use the Development Script (Recommended)
```bash
cd /Users/alo/geist/backend/router
./start-dev.sh
```

This script automatically:
1. Checks for llama.cpp and model
2. Starts the inference server
3. Starts the router
4. Provides test commands

### Option 2: Manual Setup

#### Step 1: Install uv Package Manager
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env
```

#### Step 2: Install Router Dependencies
```bash
cd /Users/alo/geist/backend/router
uv sync
```

#### Step 3: Set Up Inference Server
```bash
cd ../inference

# Clone and build llama.cpp
git clone https://github.com/ggerganov/llama.cpp.git
cd llama.cpp
mkdir build && cd build
cmake .. && make -j8

# Download a test model
cd ../models
curl -L -o tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
  "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
```

#### Step 4: Start Inference Server
```bash
cd /Users/alo/geist/backend/inference/llama.cpp
./build/bin/llama-server \
  -m models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
  --port 8001 \
  --host 127.0.0.1 &

# Wait for model to load (30-60 seconds)
# Check status: curl http://localhost:8001/health
```

#### Step 5: Start Router
```bash
cd /Users/alo/geist/backend/router

# Set environment
export ENVIRONMENT=development
export LOG_LEVEL=DEBUG

# Start router
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload &
```

## Verification

### Health Checks
```bash
# Router health (should return "healthy")
curl http://localhost:8000/health

# Inference health (should return "ok")
curl http://localhost:8001/health

# HPKE public keys
curl http://localhost:8000/api/pubkey
```

### Test Encrypted Chat
```bash
# Generate encrypted request
python create_hpke_request.py "Hello, how are you?"

# Copy and run the generated curl command
# Should stream back encrypted token chunks
```

## Available Endpoints

- **Router (port 8000)**:
  - `GET /health` - Health check
  - `GET /api/pubkey` - HPKE public keys
  - `POST /api/chat` - Encrypted chat endpoint
  - `POST /inference` - Direct inference endpoint
  - `GET /metrics` - Prometheus metrics

- **Inference (port 8001)**:
  - `GET /health` - Health check
  - `POST /completion` - Text completion
  - `POST /chat/completions` - Chat completions

## Configuration

Key environment variables:
- `ENVIRONMENT=development` - Enables CORS and debug features
- `LOG_LEVEL=DEBUG` - Verbose logging
- `INFERENCE_ENDPOINTS=["http://127.0.0.1:8001"]` - Inference server URLs

See `config.py` for all available settings.

## Stopping Services

```bash
# Kill background processes
pkill -f "llama-server"
pkill -f "uvicorn"

# Or use Ctrl+C if running in foreground
```

## Troubleshooting

### Router shows "unhealthy"
- Check if inference server is running: `curl http://localhost:8001/health`
- Ensure model is fully loaded (check llama-server logs)

### "uv not found"
- Install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Add to PATH: `source $HOME/.local/bin/env`

### Model download fails
- Check internet connection
- Try a different model from Hugging Face
- Ensure sufficient disk space (models are 500MB-4GB+)

### Build failures
- Install CMake: `brew install cmake` (macOS) or `apt install cmake` (Ubuntu)
- Install build tools: `xcode-select --install` (macOS)

## Production Deployment

For production, use:
- `deploy-prod.sh` script
- Systemd services in `systemd/` directory
- WireGuard + mTLS for secure inference communication
- See `README.md` for full production setup
