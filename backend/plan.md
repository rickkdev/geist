# 🧠 Privacy-Focused LLM Server on Hetzner — Flexible Architecture TODO Checklist

## ✅ Project Goals

- [x] Secure prompt transmission (TLS)
- [x] End-to-end encrypted prompts, decrypted only in-memory
- [x] No server-side prompt storage or logging
- [x] Trusted Execution Environment (TEE) ready (future)
- [x] Strong process isolation
- [x] Streaming optional, initial focus on full response
- [x] Integrate only with trusted mobile app (no API keys)
- [x] **NEW: Flexible architecture supporting both development (single server) and production (distributed) deployments**

---

## 🏗️ 1. Architecture Overview

### Development Architecture (Single Server)

- **Server**: Hetzner AX41-NVMe instance
- **Components**:
  - Router/API server (FastAPI)
  - LLM inference server (native Python) - smaller model
- **Communication**: Local HTTP calls between router and inference server
- **Use Case**: Development, testing, smaller workloads

### Production Architecture (Distributed)

- **Router Server**: Hetzner AX41-NVMe instance
  - **Purpose**: Request routing, SSL termination, client communication
  - **Components**: FastAPI, HTTP client for inference calls
- **Inference Server**: Hetzner CPX51/CPX61 instance (GPU-enabled)
  - **Purpose**: LLM inference, model serving
  - **Components**: Native Python application with larger model
  - **Network**: Private network or VPN between router and inference server

### Communication Flow

**Development:**

1. Client → Router (encrypted request)
2. Router → Local Inference Server (encrypted payload via HTTP)
3. Inference Server → Router (encrypted response)
4. Router → Client (encrypted response)

**Production:**

1. Client → Router (encrypted request)
2. Router → Remote Inference Server (encrypted payload via HTTP)
3. Inference Server → Router (encrypted response)
4. Router → Client (encrypted response)

### Configuration Management

- Environment-based configuration to switch between dev/prod modes
- SystemD services for process management
- Shared codebase with deployment-specific configurations

---

## ⚙️ 2. Router Server Setup

- [x] Install latest stable Linux (Ubuntu 22.04 LTS recommended) on Hetzner AX41-NVMe
- [x] Set up SSH with key-based authentication (disable password login)
- [x] Create non-root service user (`router-user`)
- [x] Update system: `sudo apt update && sudo apt upgrade`
- [x] Install build tools: `build-essential`, `python3`, `python3-venv`, etc.
- [x] Enable Hetzner firewall:
  - [x] Allow only ports 22 (SSH) and 443 (HTTPS)
  - [x] Block all other inbound ports
- [x] Enable UFW or iptables on server
- [ ] Optional: Enable GDPR DPA in Hetzner admin console

---

## 🐍 3. Router Python Environment & Dependencies

- [x] Install uv (fast Python package manager):
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  source ~/.cargo/env  # or restart shell
  ```
- [x] Create new project with uv:
  ```bash
  uv init llm-router
  cd llm-router
  ```
- [x] Add core dependencies to pyproject.toml:
  ```bash
  uv add fastapi uvicorn[standard] cryptography pynacl
  uv add httpx aiohttp  # for async HTTP calls to inference server
  ```
- [x] Add dev tools:
  ```bash
  uv add --dev psutil supervisor
  ```
- [x] Install all dependencies:
  ```bash
  uv sync
  ```
- [ ] **NEW: Add configuration management**
  ```bash
  uv add python-dotenv pydantic-settings
  ```

---

## 🧠 4. LLM Inference Server Setup (Development & Production)

### Native Python Setup

- [x] Set up inference server dependencies:
  ```bash
  uv add fastapi uvicorn[standard] cryptography pynacl
  uv add torch transformers bitsandbytes accelerate deepspeed safetensors
  ```

- [ ] Create inference server application structure:
  ```
  inference-server/
  ├── main.py
  ├── config.py
  ├── model_loader.py
  └── requirements.txt
  ```

- [ ] Implement inference server with native Python:
  ```python
  # main.py
  from fastapi import FastAPI
  import uvicorn
  
  app = FastAPI()
  
  @app.post("/inference")
  async def process_inference(request):
      # Process LLM inference
      pass
      
  @app.get("/health")
  async def health_check():
      return {"status": "healthy"}
  
  if __name__ == "__main__":
      uvicorn.run(app, host="0.0.0.0", port=8001)
  ```

---

## 🔐 5. Router FastAPI Server Setup

- [ ] Create FastAPI app with flexible routing logic
- [ ] Define `/api/chat` POST endpoint (main entry point)
- [ ] Accept encrypted payload (encrypted prompt + encrypted symmetric key)
- [ ] **NEW: Environment-based inference server configuration**
  - Development: Forward to local inference server
  - Production: Forward to remote inference server
- [ ] Return encrypted response directly to client
- [ ] Implement retry logic for inference server failures
- [ ] Disable logging of request body, prompt, or response
- [ ] **NEW: Add health check endpoint for inference server**
- [ ] Test router with:
  ```bash
  uvicorn main:app --host 0.0.0.0 --port 443 --ssl-keyfile=... --ssl-certfile=...
  ```

---

## 🔑 6. End-to-End Encryption (E2EE) - Router Level

- [ ] Generate router-side asymmetric key pair (e.g. NaCl / Curve25519)
- [ ] Distribute router public key to client (hard-coded or `/api/pubkey`)
- [ ] On client:
  - [ ] Generate symmetric key
  - [ ] Encrypt prompt with symmetric key
  - [ ] Encrypt symmetric key with router public key
  - [ ] Send both to `/api/chat`
- [ ] On router:
  - [ ] Decrypt symmetric key using private key
  - [ ] Re-encrypt payload for inference server (different key)
  - [ ] Forward to inference server (local or remote)
- [ ] Document encryption scheme in README for auditability

---

## 🌐 7. Network Configuration

### Development Network

- [ ] Set up localhost communication between router and inference server
- [ ] Configure firewall to allow local inference server communication

### Production Network

- [ ] Set up private network between router and inference server:
  - [ ] Configure Hetzner Private Network or VPN
  - [ ] Assign static IPs to both instances
  - [ ] Configure firewall rules for inter-server communication
  - [ ] Set up DNS resolution for internal hostnames
- [ ] Set up secure communication channels:
  - [ ] Use mTLS for router-inference server communication
  - [ ] Implement certificate-based authentication
  - [ ] Configure connection pooling and keep-alive

## 🔄 8. Direct HTTP Communication

- [ ] Set up HTTP client on router for inference server calls
- [ ] **NEW: Environment-based endpoint configuration**
  - Development: `http://localhost:8001`
  - Production: `http://inference-server-ip:8001`
- [ ] Configure connection pooling and timeouts
- [ ] Implement health check endpoint on inference server
- [ ] Set up retry logic for failed HTTP calls
- [ ] Add request timeout handling
- [ ] Create monitoring for HTTP response times

---

## 🧠 9. Inference Server Implementation

- [ ] Create FastAPI server for inference:
  - [ ] Define `/inference` POST endpoint
  - [ ] Load model on startup
  - [ ] Process inference requests
  - [ ] Return encrypted responses
  - [ ] Health check endpoint at `/health`
- [ ] **NEW: Environment-based model selection**
  - Development: Smaller model (e.g., `microsoft/DialoGPT-medium`)
  - Production: Full model (e.g., `openai/gpt-oss-120b`)
- [ ] Download model weights to server (local directory)
- [ ] Load model using Hugging Face Transformers:
  ```python
  model = AutoModelForCausalLM.from_pretrained(..., torch_dtype="auto", device_map="auto")
  ```
- [ ] Test with quantized versions if needed (4-bit, 8-bit)
- [ ] Implement model caching and memory management
- [ ] Run inference server natively:
  ```bash
  # Development
  cd inference-server && python main.py

  # Production (with systemd service)
  sudo systemctl start inference-server
  ```
- [ ] For GPU support, ensure NVIDIA drivers are installed:
  ```bash
  # Check GPU availability
  nvidia-smi
  # Install PyTorch with CUDA support
  uv add torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
  ```

---

## ⚙️ 10. Configuration Management

- [ ] Create environment configuration system:

  ```python
  # config.py
  from pydantic_settings import BaseSettings

  class Settings(BaseSettings):
      ENVIRONMENT: str = "development"  # "development" or "production"
      INFERENCE_SERVER_URL: str = "http://localhost:8001"
      MODEL_NAME: str = "microsoft/DialoGPT-medium"
      MAX_MEMORY: float = 0.8

      class Config:
          env_file = ".env"
  ```

- [ ] Create `.env.development` and `.env.production` files
- [ ] Add deployment scripts for easy environment switching
- [ ] Document configuration options and deployment procedures

---

## 🔒 11. Isolation & No Data Persistence

- [ ] Run router as non-root user
- [ ] Run inference server with proper isolation:
  - [ ] Run as non-root user via systemd service
  - [ ] Limited file system access
  - [ ] No persistent storage for sensitive data
- [ ] Avoid logging prompt or response anywhere
- [ ] Ensure no temp files, logging libraries, etc. store data
- [ ] Disable or encrypt swap on all nodes
- [ ] Implement secure inter-node communication

---

## 🧪 12. Testing Pipeline

- [ ] Write local test script:
  - [ ] Encrypt prompt
  - [ ] Call router API
  - [ ] Poll for status
  - [ ] Retrieve and decrypt response
- [ ] Test various prompt lengths
- [ ] Benchmark inference server performance
- [ ] Test router-inference server communication
- [ ] Verify memory and CPU usage under load
- [ ] Test server failure scenarios
- [ ] **NEW: Test both development and production configurations**

---

## 🚀 13. Production Deployment

- [ ] Register domain and point to router server IP
- [ ] Install SSL cert via Let's Encrypt (Certbot) on router
- [ ] Set up HTTPS (via Uvicorn or Nginx reverse proxy)
- [ ] Auto-renew certs via cron or systemd
- [ ] Harden firewall (block all ports except 443 on router)
- [ ] Run router via systemd with restart policies
- [ ] Set up monitoring and alerting (no sensitive logging)
- [ ] Backup router configuration and source code
- [ ] **NEW: Create production inference server deployment**
  - [ ] Set up separate Hetzner instance for inference
  - [ ] Deploy native Python application with production configuration
  - [ ] Configure private network between servers
  - [ ] Set up systemd service for inference server
- [ ] Set up logging aggregation (excluding sensitive data)
- [ ] Implement rate limiting and DDoS protection
- [ ] Plan for multi-region deployment if needed

---

## 📊 14. Monitoring & Observability

- [ ] Set up Prometheus/Grafana for metrics
- [ ] Monitor response times, error rates
- [ ] Track inference server health and performance
- [ ] Implement distributed tracing (without sensitive data)
- [ ] Set up alerting for server failures
- [ ] Create dashboard for system overview
- [ ] **NEW: Monitor both development and production environments**

---

## 🔄 15. Deployment Workflow

### Development Workflow

1. Code changes on router server
2. Test with local native inference server
3. Iterate and refine

### Production Deployment

1. Deploy router changes to production router server
2. Deploy inference server to production inference server
3. Update environment configuration
4. Restart systemd services
5. Run health checks and monitoring

### Easy Migration Path

- [ ] Create deployment scripts for easy environment switching
- [ ] Document the process of moving from development to production
- [ ] Set up automated testing for both configurations
- [ ] Create backup and rollback procedures
