# Inference Server Startup Instructions

This guide will get the llama.cpp inference server running from scratch.

## Prerequisites

- macOS/Linux system
- Git installed
- CMake installed
- C++ compiler (Xcode command line tools on macOS, build-essential on Ubuntu)
- At least 4GB RAM (8GB+ recommended)
- 2GB+ free disk space for models

## Quick Start

### Step 1: Clone and Build llama.cpp
```bash
cd /Users/alo/geist/backend/inference

# Clone the repository
git clone https://github.com/ggerganov/llama.cpp.git
cd llama.cpp

# Build with CMake
mkdir build && cd build
cmake .. && make -j8
```

### Step 2: Download a Model
```bash
cd ../models

# Download TinyLlama (637MB) - good for testing
curl -L -o tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
  "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"

# Alternative: Download a larger model (optional)
# curl -L -o llama-2-7b-chat.Q4_K_M.gguf \
#   "https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGUF/resolve/main/llama-2-7b-chat.Q4_K_M.gguf"
```

### Step 3: Start the Server
```bash
cd /Users/alo/geist/backend/inference/llama.cpp

# Start llama-server
./build/bin/llama-server \
  -m models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
  -c 4096 \
  -ngl 99 \
  --port 8001 \
  --host 127.0.0.1 \
  --log-disable

# Server will start loading the model...
# Wait for "HTTP server is listening" message
```

## Verification

### Health Check
```bash
# Should return {"status":"ok"}
curl http://localhost:8001/health
```

### Test Completion
```bash
# Test text completion
curl -X POST http://localhost:8001/completion \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "The capital of France is",
    "n_predict": 10,
    "temperature": 0.7
  }'
```

### Test Chat
```bash
# Test chat completion
curl -X POST http://localhost:8001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "max_tokens": 50,
    "temperature": 0.7
  }'
```

## Configuration Options

### Command Line Arguments
- `-m MODEL_PATH` - Path to GGUF model file
- `-c CONTEXT_SIZE` - Context window size (default: 2048)
- `-ngl N_GPU_LAYERS` - Number of layers to offload to GPU (99 = all)
- `--port PORT` - Server port (default: 8080)
- `--host HOST` - Server host (default: 127.0.0.1)
- `--log-disable` - Disable verbose logging
- `-t THREADS` - Number of threads (default: auto)

### Example with Custom Settings
```bash
./build/bin/llama-server \
  -m models/your-model.gguf \
  -c 8192 \
  -t 8 \
  -ngl 32 \
  --port 8001 \
  --host 0.0.0.0
```

## Available Endpoints

- `GET /health` - Health check
- `POST /completion` - Text completion
- `POST /v1/chat/completions` - OpenAI-compatible chat
- `POST /tokenize` - Tokenize text
- `POST /detokenize` - Detokenize tokens
- `GET /props` - Model properties

## Model Recommendations

### For Development/Testing
- **TinyLlama 1.1B** (637MB) - Fast, minimal resources
- **Phi-3 Mini** (2.4GB) - Good quality, reasonable size

### For Production
- **Llama 2 7B** (3.8GB) - Good balance of quality/speed
- **Llama 2 13B** (7.3GB) - Higher quality, more resources
- **Code Llama 7B** (3.8GB) - Specialized for code

### Model Sources
- [Hugging Face GGUF Models](https://huggingface.co/models?library=gguf)
- [TheBloke's Quantized Models](https://huggingface.co/TheBloke)

## Performance Tuning

### CPU Optimization
```bash
# Use all CPU cores
./build/bin/llama-server -m model.gguf -t $(nproc)

# Enable specific CPU features
export GGML_CPU_HBM=1  # For high bandwidth memory
```

### GPU Acceleration (if available)
```bash
# Build with CUDA support
cmake -DGGML_CUDA=ON ..

# Build with Metal support (macOS)
cmake -DGGML_METAL=ON ..

# Use GPU layers
./build/bin/llama-server -m model.gguf -ngl 99
```

### Memory Management
```bash
# Reduce memory usage
./build/bin/llama-server -m model.gguf -c 2048 --mlock

# Use memory mapping
./build/bin/llama-server -m model.gguf --mmap 1
```

## Troubleshooting

### Build Issues
```bash
# Install dependencies (Ubuntu)
sudo apt update
sudo apt install build-essential cmake

# Install dependencies (macOS)
xcode-select --install
brew install cmake

# Clean build
rm -rf build && mkdir build && cd build
cmake .. && make clean && make -j8
```

### Model Loading Issues
- **Out of memory**: Use smaller model or reduce context size (`-c`)
- **Slow loading**: Enable memory mapping (`--mmap 1`)
- **Model not found**: Check file path and permissions

### Performance Issues
- **Slow inference**: Increase threads (`-t`), use GPU (`-ngl`)
- **High memory usage**: Reduce context size (`-c`), use quantized model
- **Connection refused**: Check host/port settings

## Production Deployment

### Systemd Service
```bash
# Copy service file
sudo cp llama-inference.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable llama-inference
sudo systemctl start llama-inference
```

### Docker Deployment
```bash
# Build and run with Docker
docker build -t llama-inference .
docker run -p 8001:8001 llama-inference

# Test the Docker setup
./test-docker.sh
```

### Security Considerations
- Bind to localhost (`127.0.0.1`) for local access only
- Use reverse proxy (nginx) for external access
- Implement rate limiting and authentication
- Monitor resource usage and set limits

## Monitoring

### Resource Usage
```bash
# Monitor CPU/memory
htop
nvidia-smi  # For GPU usage

# Check server logs
journalctl -u llama-inference -f
```

### Performance Metrics
- Tokens per second (shown in server output)
- Memory usage (RSS)
- GPU utilization (if applicable)
- Request latency
