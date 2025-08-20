# 🧠 Privacy-Focused LLM Server on Hetzner — Flexible Architecture TODO Checklist

## ✅ Project Goals

- [x] Secure prompt transmission (TLS)
- [x] End-to-end encrypted prompts, decrypted only in-memory
- [x] No server-side prompt storage or logging
- [x] Trusted Execution Environment (TEE) ready (future)
- [x] Strong process isolation
- [x] Streaming support (SSE) with end-to-end encryption
- [x] Integrate only with trusted mobile app (no API keys)
- [x] Flexible architecture: single node (dev) → multi-node (prod)
- [ ] Formal threat model (actors, goals, assumptions, out-of-scope)

---

## 🏗️ 1. Architecture Overview

### Development Architecture (Single Server)

- **Server**: Hetzner AX41-NVMe (CPU)
- **Components**:
  - Router/API server (FastAPI)
  - LLM inference server: llama.cpp HTTP server (gguf)
- **Communication**:
  - Router ⇄ inference via UNIX domain socket (`/run/inference.sock`)
  - Router ⇄ client via HTTPS (HTTP/2, optional HTTP/3) and SSE
- **Use Case**: Development, testing, smaller workloads

### Production Architecture (Distributed)

- **Router Server**: Hetzner AX41-NVMe
  - Purpose: Request routing, E2EE, streaming, cert/key management, rate limiting
- **Inference Server(s)**: Hetzner CPX/GPUs when available
  - Purpose: LLM inference (llama.cpp initially; later vLLM/ExLlamaV2 if GPU)
- **Network**:
  - WireGuard private network between router and inference servers
  - mTLS on app layer over WG
  - Health checks, circuit breaker, simple round-robin

### Streaming

- End-to-end Server-Sent Events (SSE):
  - Client ⇄ Router (SSE over HTTPS)
  - Router ⇄ Inference (SSE over UNIX socket in dev; HTTPS+mTLS in prod)
  - Router re-encrypts and re-frames tokens per chunk

### Configuration Management

- Environment-based configuration (dev/prod)
- Systemd services with hardening and dependency ordering
- Shared codebase with deployment-specific configs
- Key rotation and cert management

---

## 🛡️ 2. Threat Model

- [ ] Document adversaries: network observers, rogue infra admins (limited), remote attackers
- [ ] Goals: keep prompts/responses confidential; no at-rest data; minimal metadata
- [ ] Assumptions: device integrity, app pinning, OS trust on server, no physical access
- [ ] Out-of-scope: on-device malware, baseband attacks, coerced endpoints
- [ ] Controls: HPKE E2EE, mTLS, WireGuard, systemd sandboxing, no logs, swap disabled

---

## ⚙️ 3. Router Python Environment & Dependencies

- [x] Install uv:
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  source ~/.cargo/env
  ```
- [x] Create project:
  ```bash
  uv init llm-router
  cd llm-router
  ```
- [x] Add core dependencies:
  ```bash
  uv add fastapi uvicorn[standard] hpke sse-starlette httpx[http2] python-dotenv pydantic-settings
  ```
- [x] Dev tools:
  ```bash
  uv add --dev ruff mypy pytest pytest-asyncio psutil
  ```
- [x] Sync:
  ```bash
  uv sync
  ```

---

## 🧠 4. Inference Server Setup (CPU-first with llama.cpp)

### Foundation Setup

- [x] Download and compile llama.cpp from source:
  ```bash
  git clone https://github.com/ggerganov/llama.cpp
  cd llama.cpp
  make
  ```
- [x] Download gguf model (start practical: `the gpt oss 20b model`)
- [x] Test/ start basic llama.cpp server:

  ```bash
  ./build/bin/llama-server -m models/gpt-oss-20b-Q4_K_S.gguf -c 4096 -ngl 0 --port 8001 --host 127.0.0.1
  ```

- [x] Verify HTTP API works:
  ```bash
  curl -X POST http://localhost:8001/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Hello"}],"stream":true}'
  ```

### UNIX Socket Security Layer

- [x] Understand UNIX socket benefits:
  - File-based IPC (not network ports)
  - No accidental external exposure
  - Process-level access control
  - Security isolation from network stack
- [x] Choose UNIX socket approach: socat, nginx stream module, or custom Python adapter
<!-- COMPLETED: Selected socat for simplicity and reliability -->
- [x] Create UNIX socket at `/run/inference.sock` with proper permissions (660)
<!-- COMPLETED: Created systemd services with proper permissions and user/group setup -->
- [x] Set up proxy/adapter to forward HTTP requests from UNIX socket to localhost:8001
<!-- COMPLETED: socat proxy forwards all HTTP traffic bidirectionally -->
- [x] Configure socket ownership for router service access
<!-- COMPLETED: Socket owned by inference:router group with 660 permissions -->
- [x] Test UNIX socket connectivity:
  ```bash
  curl --unix-socket /run/inference.sock http://localhost/v1/chat/completions
  # TESTED: Works for health, chat completions, and streaming
  ```
- [x] Add systemd socket activation for automatic socket creation on boot
<!-- COMPLETED: Created llama-inference.service and inference-socket.service -->
- [x] Implement graceful socket cleanup on service restart/stop
<!-- COMPLETED: ExecStartPre/ExecStopPost handle socket cleanup -->
- [x] Health endpoint: `/health` (readiness: model loaded; liveness)
<!-- COMPLETED: Available at /health endpoint through UNIX socket -->

Optional Python adapter (normalize SSE, map params) if needed for advanced routing.

---

## 🔐 5. Router FastAPI Server Setup

- [x] Create FastAPI app with:
  - [x] `/api/chat` POST (SSE response): accepts HPKE-encrypted request; streams HPKE-encrypted chunks back
  - [x] `/api/pubkey` GET: returns current and next router HPKE public keys (for rotation)
  - [x] `/health` GET: liveness/readiness (no sensitive info)
  - [x] `/metrics` GET: Prometheus metrics (no payloads)
- [x] Disable logging of body/headers; scrub traces
- [x] Retries with capped exponential backoff; circuit breaker on inference failures
- [x] Rate limiting per device pubkey and per-IP; optional PoW under stress

Example local run:

```bash
uvicorn main:app --host 0.0.0.0 --port 443 --ssl-keyfile=... --ssl-certfile=...
```

---

## 🔑 6. End-to-End Encryption (E2EE) - HPKE

- [x] HPKE: X25519-HKDF-SHA256 + ChaCha20-Poly1305 (RFC 9180)
- [x] Client request includes: encapsulated key, ciphertext, aad, timestamp (ts), request-id (rid)
- [x] Router: derive AEAD context, decrypt; zeroize secrets; mlock; no swap; per-request re-encrypt stream chunks
- [x] Replay protection: TTL (e.g., 60s), strict clock skew window
- [x] Key rotation: serve current + next public keys at `/api/pubkey`; app pins and supports overlap
- [x] Mobile app: pin router HPKE pubkey and TLS cert
- [x] Development environment configuration with secure key management
- [x] Memory protection using mlockall for sensitive key material
- [x] Automatic key rotation with configurable intervals
- [x] Test script for HPKE implementation verification

### 🚀 HPKE System Usage Commands

**Testing HPKE Implementation:**

```bash
# Test the complete HPKE flow
python test_hpke_implementation.py

# Test direct inference without HPKE
python test_direct_inference.py

# Debug HPKE functions directly
python debug_hpke_direct.py
```

**Generate Encrypted Requests:**

```bash
# Create curl command for any question
python3 create_hpke_request.py "Your question here"

# Examples:
python3 create_hpke_request.py "Explain quantum computing"
python3 create_hpke_request.py "Write a Python function to sort a list"
python3 create_hpke_request.py "What are the benefits of renewable energy?"
```

**Send Encrypted Requests:**

```bash
# Method 1: Use generator (recommended)
python3 create_hpke_request.py "Who were the presidents in the US in the 90s?" | grep curl | bash

# Method 2: Manual curl (single-line format)
curl -X POST http://localhost:8000/api/chat -H "Content-Type: application/json" -d '{"encapsulated_key":"bW9ja19lbmNhcHN1bGF0ZWRfa2V5XzMyYnl0ZXNfXw==","ciphertext":"BASE64_ENCODED_PAYLOAD","aad":"dGVzdF9hYWQ=","timestamp":"CURRENT_UTC_TIMESTAMP","request_id":"unique-request-id","device_pubkey":"bW9ja19kZXZpY2VfcHVia2V5XzMyYnl0ZXNfX19f"}'
```

**Decrypt Streaming Responses:**

```bash
# Method 1: Pipe directly to decoder (recommended)
curl ... | python3 decode_hpke_response.py

# Method 2: Save then decode
curl ... > encrypted_response.txt
python3 decode_hpke_response.py < encrypted_response.txt

# Method 3: Manual base64 decoding of individual chunks
echo "BASE64_CHUNK" | base64 -d
```

**Full example all in one:**

python3 create_hpke_request.py "YOUR PROMPT" | grep curl | bash | python3 decode_hpke_response.py

**Check System Health:**

```bash
# Health check
curl http://localhost:8000/health

# Get HPKE public keys
curl http://localhost:8000/api/pubkey

# Debug endpoint (for troubleshooting)
curl -X POST http://localhost:8000/api/chat/debug -H "Content-Type: application/json" -d '{"encapsulated_key":"...","ciphertext":"...","aad":"...","timestamp":"...","request_id":"debug-test","device_pubkey":"..."}'
```

**Key Management:**

```bash
# Keys are stored in: ./dev-keys/ (development)
# Production keys: /etc/llm-router/
ls -la dev-keys/

# Key rotation happens automatically every 24h
# Check rotation status via /api/pubkey endpoint
```

### 📱 Mobile App Implementation Hints (React Native + TypeScript)

**Architecture Overview:**

- React Native Frontend with TypeScript + Expo (ejected)
- Use @noble/curves and @noble/hashes for HPKE crypto operations in pure JavaScript
- Store device private keys in expo-secure-store with biometric authentication
- Implement SSE streaming with fetch API for real-time encrypted responses

**Required Dependencies:**

- @noble/curves @noble/hashes for cryptographic operations
- expo-secure-store for secure key storage (already installed)
- Built-in fetch API for HTTP requests and SSE streaming

**1. HPKE Client Setup:**

- Create HPKEClient class to handle X25519-HKDF-SHA256 + ChaCha20-Poly1305 operations
- Generate device key pair on first launch, store private key securely with biometric protection
- Implement HPKE seal operation: ephemeral key generation, ECDH, HKDF key derivation
- Encrypt request payload with timestamp and unique request ID for replay protection
- Use ChaCha20-Poly1305 AEAD with derived key and nonce for message encryption

**2. Secure Request Flow:**

- Initialize HPKE client and retrieve device keys from secure storage
- Fetch current router public key from /api/pubkey endpoint with certificate pinning
- Encrypt user message using HPKE seal operation with router's public key
- Send encrypted request to /api/chat endpoint with proper headers for SSE
- Stream response chunks using ReadableStream reader and TextDecoder
- Parse SSE events and decrypt each chunk using established HPKE context
- Yield decrypted content as async generator for real-time UI updates

**3. Key Management & Rotation:**

- Periodically fetch /api/pubkey to get current and next router public keys
- Cache router keys in secure storage for offline operation
- Implement certificate pinning using SHA256 fingerprint validation
- Handle key rotation gracefully by supporting both current and next keys
- Validate router public key against hardcoded fingerprint before use

**4. Security Best Practices:**

- Store all sensitive keys in expo-secure-store with authentication prompts
- Implement client-side rate limiting to prevent abuse
- Add timestamp validation for replay attack protection (60s window)
- Clear sensitive data from memory after use (best effort in JavaScript)
- Validate TLS certificate fingerprint for router connections
- Use secure random number generation for all cryptographic operations

**5. Error Handling:**

- Define HPKEError types: encryption, decryption, network, rate limited, key rotation
- Implement HPKEResult wrapper for safe operation handling
- Create HPKEClientError class with specific error types and retry information
- Handle network failures gracefully with fallback to cached keys
- Provide user-friendly error messages for crypto failures and network issues

---

## 🌐 7. Network Configuration

### Development

- [x] Router ⇄ inference via UNIX domain socket: `/run/inference.sock`
- [x] Firewall: allow only 22/443; block local TCP binding for inference

Run with `./start-dev.sh`

### Production

- [x] WireGuard between router and inference servers (private subnet only)
- [x] Inference binds only to WG interface
- [x] App-layer mTLS (short-lived certs via Smallstep/step-ca); cert pinning on router
- [x] Connection pooling, keep-alive, backoff/jitter

Run with `./start-prod.sh`

### 🚀 Network Configuration Usage Commands

**Development Setup:**

```bash
# Apply firewall rules (development)
./scripts/setup-firewall-dev.sh

# Verify network configuration
./scripts/verify-network-config.sh

# Check UNIX socket connectivity
curl --unix-socket /run/inference.sock http://localhost/health
```

**Production Setup:**

```bash
# Configure WireGuard on router server
sudo ./scripts/setup-wireguard-prod.sh  # Select: router

# Configure WireGuard on inference server(s)
sudo ./scripts/setup-wireguard-prod.sh  # Select: inference

# Generate and distribute mTLS certificates
sudo ./scripts/setup-mtls-certs.sh setup

# Test WireGuard connectivity
ping 10.0.0.1  # From inference to router
ping 10.0.0.2  # From router to inference

# Test mTLS connection
openssl s_client -connect 10.0.0.2:8001 \
  -cert /etc/llm-router/certs/router-cert.pem \
  -key /etc/llm-router/certs/router-key.pem \
  -CAfile /etc/llm-router/ca/ca-cert.pem
```

**Security Features:**

- Development: UNIX socket isolation, firewall protection
- Production: WireGuard encryption, mTLS authentication, network isolation
- Automatic certificate rotation and monitoring
- Comprehensive network security documentation

**Files Created:**

- `scripts/setup-firewall-dev.sh` - Development firewall configuration
- `scripts/verify-network-config.sh` - Network configuration verification
- `scripts/setup-wireguard-prod.sh` - Production WireGuard setup
- `scripts/setup-mtls-certs.sh` - mTLS certificate management
- `llama-inference-prod.service` - Production inference service
- `docs/network-security-guide.md` - Complete network security documentation

---

## 🔄 8. Transport Configuration

- [ ] Dev: `unix:///run/inference.sock` (preferred)
- [ ] Prod: `https://10.0.0.x:8001` over WireGuard + mTLS
- [ ] Timeouts: connect/read; budget per request; cancel on client disconnect
- [ ] Health checks: periodic; remove unhealthy nodes from rotation

---

## 🧠 9. Inference Server Implementation

- [ ] Use llama.cpp HTTP SSE endpoint:
  - [ ] POST `/inference` (SSE stream of tokens)
  - [ ] GET `/health`
- [ ] Router parses llama.cpp SSE and re-frames to client SSE with HPKE per-chunk
- [ ] Parameters: temperature, top_p, max_tokens; guardrails for limits
- [ ] Future (GPU): migrate to vLLM/ExLlamaV2; keep router protocol stable

---

## ⚙️ 10. Configuration Management

- [ ] Settings:

  ```python
  from pydantic_settings import BaseSettings

  class Settings(BaseSettings):
      ENVIRONMENT: str = "development"  # "development" | "production"
      STREAMING_ENABLED: bool = True
      REQUEST_TTL_SECONDS: int = 60

      INFERENCE_TRANSPORT: str = "unix"  # "unix" | "https"
      INFERENCE_ENDPOINTS: list[str] = ["unix:///run/inference.sock"]  # or ["https://10.0.0.2:8001"]

      CIRCUIT_BREAKER_THRESHOLD: int = 5
      CIRCUIT_RESET_SECONDS: int = 30

      RATE_LIMIT_PER_MINUTE: int = 60
      RATE_LIMIT_BURST: int = 30

      ROUTER_HPKE_JWKS_PATH: str = ".well-known/jwks.json"

      class Config:
          env_file = ".env"
  ```

- [ ] `.env.development` and `.env.production`
- [ ] Deployment scripts for env switching
- [ ] Document config options and procedures

---

## 🔒 11. Isolation & No Data Persistence

- [ ] Run as non-root users; dedicated users per service
- [ ] Systemd sandboxing (router + inference):
  ```ini
  NoNewPrivileges=yes
  PrivateTmp=yes
  ProtectHome=read-only
  ProtectSystem=strict
  ProtectKernelLogs=yes
  ProtectKernelModules=yes
  RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
  SystemCallFilter=@system-service
  MemoryDenyWriteExecute=yes
  ReadWritePaths=/run
  LimitCORE=0
  ```
- [ ] Disable swap; `vm.swappiness=1`; `fs.suid_dumpable=0`
- [ ] `mlock` sensitive key material; avoid temp files
- [ ] No prompt/response logging; redact errors

---

## 🧪 12. Testing Pipeline

- [ ] Unit tests:
  - [ ] HPKE round-trip, replay rejection, key rotation handling
  - [ ] Prompt formatting
- [ ] Integration tests:
  - [ ] Mobile-side HPKE → router → llama.cpp (SSE) → router → client decrypt
  - [ ] Circuit breaker and retry behavior
- [ ] Load tests (k6/Locust): p50/p95 latency, tokens/sec, concurrency
- [ ] CI (GitHub Actions): lint (ruff), type-check (mypy), tests (pytest); ephemeral llama.cpp in CI if feasible

---

## 🚀 13. Production Deployment

- [ ] Domain → router IP
- [ ] TLS on router (Caddy recommended for auto HTTPS with HTTP/2/3)
- [ ] Auto-renew certs
- [ ] Firewall hardening (only 443 on router exposed)
- [ ] Systemd units with restart policies; `After=wireguard-wg0.service` for inference servers
- [ ] WireGuard setup and mTLS cert issuance (step-ca)
- [ ] Monitoring/alerting (no sensitive logs)
- [ ] Backup router configs and code
- [ ] Separate inference server(s); private-only; health probes
- [ ] Rate limiting and basic DDoS protection; optional PoW challenge

---

## 📊 14. Monitoring & Observability

- [ ] `/metrics` (Prometheus):
  - Latency: router→inference, end-to-end
  - Active streams, tokens/sec
  - HTTP status counts (4xx/5xx), circuit breaker open/close
- [ ] Grafana dashboards
- [ ] Alerts on error rate, tail latency, unhealthy backends
- [ ] No payloads, no headers; hash-only request-id for correlation

---

## 🔄 15. Deployment Workflow

### Development Workflow

1. Code changes on router server
2. Test with local llama.cpp via UNIX socket
3. Iterate and refine

### Production Deployment

1. Deploy router to prod router server
2. Deploy inference server(s); join WireGuard; issue mTLS certs
3. Update environment configuration
4. Restart systemd services
5. Run health checks and monitoring

### Easy Migration Path

- [ ] Scripts for environment switching
- [ ] Document dev → prod migration
- [ ] Automated tests for both configurations
- [ ] Backup and rollback procedures

---

## 🧯 16. Abuse Prevention & Safety

- [ ] Per-device and per-IP rate limits (sliding window + burst)
- [ ] Optional PoW (Hashcash-like) under attack
- [ ] Max token and concurrency guards
- [ ] Basic input/output token accounting (no content logging)
