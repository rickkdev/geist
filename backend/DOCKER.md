# Docker Deployment Guide

This guide covers running the backend services using Docker and Docker Compose.

## Quick Start with Docker Compose

### Start Everything
```bash
cd /Users/alo/geist/backend/router
docker-compose up --build
```

This will:
1. Build the inference server with llama.cpp
2. Download the TinyLlama model
3. Build the router service
4. Start both services with proper networking
5. Wait for health checks to pass

### Stop Everything
```bash
docker-compose down
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f router
docker-compose logs -f inference
```

## Individual Service Deployment

### Inference Server

#### Build and Run
```bash
cd /Users/alo/geist/backend/inference
docker build -t llama-inference .
docker run -p 8001:8001 llama-inference

# Test the setup
./test-docker.sh
```

#### With Custom Model
```bash
# Mount your models directory
docker run -p 8001:8001 \
  -v /path/to/your/models:/app/models:ro \
  -e MODEL_PATH=/app/models/your-model.gguf \
  llama-inference
```

#### With GPU Support
```bash
# Build with GPU support (base image already has CUDA support)
docker build -t llama-inference-gpu .

# Run with GPU
docker run --gpus all -p 8001:8001 \
  -e GPU_LAYERS=99 \
  llama-inference-gpu
```

### Router Service

#### Build and Run
```bash
cd /Users/alo/geist/backend/router
docker build -t llm-router .
docker run -p 8000:8000 \
  -e INFERENCE_ENDPOINTS='["http://host.docker.internal:8001"]' \
  llm-router
```

#### With Custom Configuration
```bash
docker run -p 8000:8000 \
  -e ENVIRONMENT=production \
  -e LOG_LEVEL=INFO \
  -e INFERENCE_ENDPOINTS='["http://inference:8001"]' \
  -v ./dev-keys:/app/dev-keys:ro \
  llm-router
```

## Production Deployment

### Docker Compose Production
```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  router:
    build: 
      context: .
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - ENVIRONMENT=production
      - LOG_LEVEL=INFO
      - INFERENCE_ENDPOINTS=["http://inference:8001"]
      - DISABLE_DOCS=true
    depends_on:
      inference:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '1.0'

  inference:
    build: ../inference
    ports:
      - "8001:8001"
    environment:
      - MODEL_PATH=/app/models/llama-2-7b-chat.Q4_K_M.gguf
      - CONTEXT_SIZE=4096
      - GPU_LAYERS=99
    volumes:
      - inference_models:/app/models
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 16G
          cpus: '8.0'
        reservations:
          memory: 8G
          cpus: '4.0'

volumes:
  inference_models:
```

### Run Production Stack
```bash
docker-compose -f docker-compose.prod.yml up -d
```

## Configuration

### Environment Variables

#### Router Service
- `ENVIRONMENT` - development/production
- `LOG_LEVEL` - DEBUG/INFO/WARNING/ERROR
- `INFERENCE_ENDPOINTS` - JSON array of inference URLs
- `INFERENCE_TRANSPORT` - http/https
- `HOST` - Bind host (default: 0.0.0.0)
- `PORT` - Bind port (default: 8000)
- `RATE_LIMIT_PER_MINUTE` - Rate limit (default: 60)
- `HARMONY_ENABLED` - Enable Harmony format (default: true)

#### Inference Service
- `MODEL_PATH` - Path to GGUF model file
- `HOST` - Bind host (default: 0.0.0.0)
- `PORT` - Bind port (default: 8001)
- `CONTEXT_SIZE` - Context window size (default: 4096)
- `THREADS` - Number of threads (default: auto)
- `GPU_LAYERS` - GPU layers to use (default: 0)

### Volume Mounts

#### Persistent Model Storage
```bash
# Create named volume for models
docker volume create inference_models

# Or bind mount local directory
-v /path/to/models:/app/models
```

#### Configuration Files
```bash
# Mount HPKE keys
-v ./dev-keys:/app/dev-keys:ro

# Mount custom config
-v ./config.py:/app/config.py:ro
```

## Monitoring and Logging

### Health Checks
```bash
# Check service health
docker-compose ps

# Manual health checks
curl http://localhost:8000/health
curl http://localhost:8001/health
```

### Resource Monitoring
```bash
# Container stats
docker stats

# Service logs
docker-compose logs -f --tail=100
```

### Prometheus Metrics
```bash
# Router metrics
curl http://localhost:8000/metrics
```

## Troubleshooting

### Common Issues

#### Out of Memory
```bash
# Increase Docker memory limit
# Docker Desktop: Settings > Resources > Memory

# Use smaller model
-e MODEL_PATH=/app/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf

# Reduce context size
-e CONTEXT_SIZE=2048
```

#### Slow Model Loading
```bash
# Check container logs
docker-compose logs inference

# Increase health check timeout
healthcheck:
  start_period: 120s  # Wait 2 minutes for model loading
```

#### Network Issues
```bash
# Check container networking
docker network ls
docker network inspect router_default

# Use host networking (Linux only)
docker run --network host llm-router
```

#### Permission Issues
```bash
# Fix file permissions
sudo chown -R 1000:1000 ./dev-keys
sudo chmod 600 ./dev-keys/*
```

### Debug Mode

#### Enable Debug Logging
```bash
docker-compose up --build \
  -e LOG_LEVEL=DEBUG \
  -e ENVIRONMENT=development
```

#### Interactive Shell
```bash
# Access running container
docker exec -it router_router_1 /bin/bash
docker exec -it router_inference_1 /bin/bash

# Run with shell override
docker run -it --entrypoint /bin/bash llm-router
```

## Performance Optimization

### CPU Optimization
```bash
# Use all available cores
-e THREADS=0  # Auto-detect

# Set CPU affinity
docker run --cpuset-cpus="0-7" llama-inference
```

### Memory Optimization
```bash
# Enable memory mapping
-e MMAP=1

# Set memory limits
deploy:
  resources:
    limits:
      memory: 8G
```

### GPU Acceleration
```bash
# Install nvidia-docker
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
sudo apt-get update && sudo apt-get install -y nvidia-docker2
sudo systemctl restart docker

# Use GPU in compose
services:
  inference:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

## Security Considerations

### Production Security
```bash
# Use non-root user (already configured in Dockerfiles)
USER 1000

# Read-only filesystem
docker run --read-only --tmpfs /tmp llm-router

# Drop capabilities
docker run --cap-drop=ALL llm-router

# Use secrets for sensitive data
docker secret create hpke_private_key ./dev-keys/hpke-private.key
```

### Network Security
```bash
# Internal network only
networks:
  internal:
    internal: true

# Reverse proxy setup
# Use nginx or traefik for external access
```
