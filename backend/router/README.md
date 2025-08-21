# LLM Router Service

This directory contains the FastAPI-based router service that handles HPKE-encrypted requests and routes them to inference servers.

## Architecture

- **Development**: Communicates with local inference via UNIX socket
- **Production**: Routes to remote inference servers via WireGuard + mTLS

## Components

- `main.py`: FastAPI application entry point
- `config.py`: Configuration management
- `models.py`: Pydantic data models
- `services/`: Core services (HPKE, rate limiting, circuit breaker, etc.)
- `middleware/`: Request/response middleware 
- `tests/`: Comprehensive test suite
- `scripts/`: Setup and deployment scripts
- `docs/`: Documentation

## Key Features

- **End-to-End Encryption**: HPKE with X25519 + ChaCha20-Poly1305
- **Security**: Process isolation, memory protection, no data persistence
- **Reliability**: Circuit breaker, rate limiting, retry logic
- **Monitoring**: Health checks, metrics, secure logging

## Usage

### Development
```bash
# From backend/router/
./start-dev.sh
```

### Production
```bash
# From backend/router/
sudo ./deploy-prod.sh
sudo systemctl start llm-router-hardened
```