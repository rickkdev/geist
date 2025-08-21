# LLM Inference Service

This directory contains the llama.cpp-based inference engine that processes LLM requests.

## Architecture

- **Development**: Communicates with router via UNIX socket (`/run/inference.sock`)
- **Production**: Runs on separate server(s), communicates via WireGuard + mTLS

## Components

- `llama.cpp/`: Core inference engine (C++ implementation)
- `*.service`: Systemd service files for process management
- `setup-inference-socket.sh`: UNIX socket configuration
- `test-unix-socket.sh`: Socket connectivity testing

## Usage

### Development
```bash
# From backend/inference/
./setup-inference-socket.sh
systemctl start llama-inference
```

### Production  
```bash
# On inference server
systemctl start llama-inference-prod
```

## Model Storage

Models are stored in `llama.cpp/models/` directory in GGUF format.