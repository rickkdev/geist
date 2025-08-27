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

`python3 create_hpke_request.py "YOUR PROMPT" | grep curl | bash | python3 decode_hpke_response.py`

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

- [x] Dev: `unix:///run/inference.sock` (preferred)
- [x] Prod: `https://10.0.0.x:8001` over WireGuard + mTLS
- [x] Timeouts: connect/read; budget per request; cancel on client disconnect
- [x] Health checks: periodic; remove unhealthy nodes from rotation

---

## 🧠 9. Inference Server Implementation

- [x] Use llama.cpp HTTP SSE endpoint:
  - [x] POST `/inference` (SSE stream of tokens)
  - [x] GET `/health`
- [x] Router parses llama.cpp SSE and re-frames to client SSE with HPKE per-chunk
- [x] Parameters: temperature, top_p, max_tokens; guardrails for limits
- [x] Future (GPU): migrate to vLLM/ExLlamaV2; keep router protocol stable

Example:

POST `http://localhost:8000/inference`

Body:

```
 {
    "messages": [
      {
        "role": "user",
        "content": "Who were the US presidents in the 1990s? Please list their names and years served."
      }
    ],
    "temperature": 0.7,
    "top_p": 0.9,
    "max_tokens": 200,
    "request_id": "postman-90s-presidents"
  }
```

---

## ⚙️ 10. Configuration Management

- [x] Settings:

  - [x] Complete Pydantic settings class with all configuration options
  - [x] Environment-based configuration with validation
  - [x] Helper methods for environment checks and transport configuration
  - [x] Security settings with production hardening

- [x] `.env.development` and `.env.production`:

  - [x] Development: UNIX socket transport, verbose logging, relaxed limits
  - [x] Production: HTTPS/WireGuard transport, mTLS, strict security

- [x] Deployment scripts for env switching:

  - [x] `deploy-dev.sh`: Development environment setup
  - [x] `deploy-prod.sh`: Production environment setup with security hardening
  - [x] `switch-env.sh`: Easy environment switching with status checking

- [x] Document config options and procedures:
  - [x] Complete configuration guide (`docs/configuration-guide.md`)
  - [x] Environment switching procedures
  - [x] Security considerations and troubleshooting
  - [x] Configuration validation and best practices

### 🚀 Configuration Management Usage Commands

**Environment Switching:**

```bash
# Quick environment switching
./switch-env.sh dev          # Switch to development
sudo ./switch-env.sh prod    # Switch to production (requires sudo)
./switch-env.sh status       # Check current environment status

# Individual deployment scripts
./deploy-dev.sh              # Set up development environment
sudo ./deploy-prod.sh        # Set up production environment
```

**Configuration Validation:**

```bash
# Test configuration validity
python3 -c "from config import get_settings; settings = get_settings(); print(f'Environment: {settings.ENVIRONMENT}')"

# Development validation
python3 -c "from config import get_settings; s = get_settings(); assert s.is_development() and s.INFERENCE_TRANSPORT == 'unix'"

# Production validation
python3 -c "from config import get_settings; s = get_settings(); assert s.is_production() and s.MTLS_ENABLED"
```

**Environment Status:**

```bash
# Check active configuration
grep "ENVIRONMENT=" .env

# View current transport settings
grep -E "(INFERENCE_TRANSPORT|INFERENCE_ENDPOINTS)" .env

# Check service status
systemctl status llm-router-prod    # Production service
systemctl status llama-inference    # Development service
```

---

## 🔒 11. Isolation & No Data Persistence

- [x] **User & Process Isolation**:

  - [x] Dedicated system users: `llm-router` and `inference` with `/usr/sbin/nologin`
  - [x] Proper group memberships for socket access
  - [x] Secure directory structure with minimal permissions
  - [x] Sudoers restrictions for emergency access only

- [x] **Comprehensive Systemd Sandboxing** (`systemd/llm-router-hardened.service`, `systemd/llama-inference-hardened.service`):

  - [x] `NoNewPrivileges=yes` - Prevent privilege escalation
  - [x] `PrivateTmp=yes` - Isolated temporary directories
  - [x] `ProtectHome=read-only` - Home directory protection
  - [x] `ProtectSystem=strict` - System directory protection
  - [x] `ProtectKernelLogs=yes` - Kernel log protection
  - [x] `ProtectKernelModules=yes` - Kernel module protection
  - [x] `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6` - Network restrictions
  - [x] `SystemCallFilter=@system-service` - System call filtering
  - [x] `MemoryDenyWriteExecute=yes` - W^X memory protection
  - [x] `LimitCORE=0` - Disable core dumps
  - [x] `DevicePolicy=closed` - Device access restrictions
  - [x] Network isolation and resource limits

- [x] **Memory Security** (`scripts/setup-memory-security.sh`):

  - [x] Swap completely disabled: `swapoff -a` + fstab cleanup
  - [x] Kernel hardening: `vm.swappiness=0`, `fs.suid_dumpable=0`
  - [x] ASLR enabled: `kernel.randomize_va_space=2`
  - [x] Memory locking limits for HPKE keys (64MB) and models (16GB)
  - [x] Core dump prevention and cleanup
  - [x] Kernel information restrictions

- [x] **Data Persistence Prevention** (`middleware/secure_logging.py`, `scripts/setup-log-security.sh`):

  - [x] Comprehensive log scrubbing with regex patterns for sensitive data
  - [x] HPKE data, API keys, message content, IPs all scrubbed
  - [x] Secure log rotation (3-day retention) with automatic shredding
  - [x] Systemd journal limits (100MB, 7-day retention)
  - [x] Syslog filtering to prevent sensitive data leakage
  - [x] No request/response body logging in production
  - [x] Error message sanitization

- [x] **Security Monitoring & Validation**:
  - [x] Real-time security event monitoring (`/usr/local/bin/monitor-security-logs.sh`)
  - [x] Comprehensive security validation (`scripts/security-validation.sh`)
  - [x] Automated daily log cleanup with secure wiping
  - [x] Security alert logging to `/var/log/llm-security/`

### 🚀 Isolation & Security Usage Commands

**Deploy Complete Security Hardening:**

```bash
# Full security hardening deployment (requires root)
sudo ./deploy-isolation-hardening.sh

# Individual security components
sudo ./scripts/setup-security-users.sh     # Users and permissions
sudo ./scripts/setup-memory-security.sh    # Memory protection
sudo ./scripts/setup-log-security.sh       # Secure logging
```

**Security Validation & Monitoring:**

```bash
# Comprehensive security audit
./scripts/security-validation.sh

# Check memory security
sudo /usr/local/bin/validate-memory-security.sh

# Check user/permission security
sudo /usr/local/bin/check-llm-security.sh

# Monitor security events
tail -f /var/log/llm-security/security-alerts.log

# Manual log cleanup
sudo /usr/local/bin/secure-log-cleanup.sh
```

**Hardened Service Management:**

```bash
# Start hardened services
sudo systemctl start llm-router-hardened
sudo systemctl start llama-inference-hardened

# Check service security status
systemctl show llm-router-hardened | grep -E "(NoNewPrivileges|PrivateTmp|ProtectSystem)"

# View service logs (automatically scrubbed)
journalctl -u llm-router-hardened -f
```

**Security Features Implemented:**

- **Zero Data Persistence**: No prompts/responses logged, aggressive log cleanup
- **Memory Protection**: Swap disabled, kernel hardened, sensitive data mlocked
- **Process Isolation**: Dedicated users, comprehensive systemd sandboxing
- **Logging Security**: Data scrubbing, rotation, secure wiping, monitoring
- **System Hardening**: ASLR, core dump prevention, device restrictions
- **Real-time Monitoring**: Security event detection and alerting

---

## 🧪 12. Testing Pipeline

- [x] **Unit tests** (`tests/test_hpke_unit.py`):

  - [x] HPKE round-trip encryption/decryption testing
  - [x] Replay protection mechanisms (timestamp validation, request ID tracking)
  - [x] Key rotation handling and validation
  - [x] Memory security operations
  - [x] Error handling and edge cases
  - [x] Concurrent request processing
  - [x] Invalid input validation
  - [x] Security logging validation

- [x] **Integration tests** (`tests/test_integration_e2e.py`):

  - [x] Complete mobile-side HPKE → router → inference flow
  - [x] Server-Sent Events (SSE) streaming with HPKE encryption
  - [x] Circuit breaker and retry behavior testing
  - [x] Rate limiting functionality
  - [x] Health checks and monitoring endpoints
  - [x] Error response format validation
  - [x] Security headers and CORS validation
  - [x] Timeout and network error handling

- [x] **Load tests** (`tests/load/`):

  - [x] k6 load testing script with multiple scenarios
  - [x] Locust load testing with realistic user behavior simulation
  - [x] Performance metrics: p50/p95 latency, tokens/sec, concurrency
  - [x] Automated load test execution script
  - [x] Gradual ramp-up, sustained load, spike, and stress testing
  - [x] Rate limiting and circuit breaker validation under load

- [x] **Test infrastructure** (`tests/`):

  - [x] Comprehensive pytest configuration (`conftest.py`, `pytest.ini`)
  - [x] Test utilities and helper functions
  - [x] Mock fixtures for dependencies
  - [x] Performance timing utilities
  - [x] Error simulation framework
  - [x] Test data generators

- [x] **Test automation** (`Makefile`, `tests/run_tests.py`):

  - [x] Unified test runner with multiple test categories
  - [x] Code quality checks (ruff linting, mypy type checking)
  - [x] Coverage reporting with HTML output
  - [x] Development workflow commands
  - [x] CI/CD simulation pipeline
  - [x] Load test execution automation

- [ ] **CI (GitHub Actions)**: lint (ruff), type-check (mypy), tests (pytest); ephemeral llama.cpp in CI if feasible

### 🚀 Testing Pipeline Usage Commands

**Quick Development Testing:**

```bash
# Fast feedback loop for development
make quick                    # Lint + unit tests
make dev-check               # Format + lint + type-check + unit tests
make test-unit --verbose     # Detailed unit test output

# Individual test categories
make test-integration        # End-to-end integration tests
make test-security          # Security-focused tests
make test-load              # Load tests with k6 (requires running server)
```

**Comprehensive Testing:**

```bash
# Complete test suite
make test-all               # All tests with full reporting
python tests/run_tests.py all --verbose

# Coverage analysis
make coverage-html          # Generate HTML coverage report
make generate-reports       # All reports (coverage + load test results)

# Performance testing
make benchmark              # Performance benchmark tests
make test-load-stress       # Stress testing with high load
make test-load-spike        # Spike testing with sudden load increases
```

**Load Testing:**

```bash
# Different load testing tools and scenarios
make test-load              # Basic k6 smoke test
make test-load-locust       # Locust-based load testing
make test-load-comprehensive # Full load test suite

# Manual load testing
./tests/load/run-load-tests.sh k6 -d 5m -v 50 -t load
./tests/load/run-load-tests.sh locust -d 3m -u 100 -r 10 -t stress
```

**CI/CD Simulation:**

```bash
# Simulate complete CI/CD pipeline
make ci-test                # Full pipeline: deps → quality → all tests

# Individual quality checks
make lint                   # Code linting with ruff
make type-check            # Type checking with mypy
make format                # Code formatting
```

**Test Results and Reports:**

- Unit test coverage: `tests/coverage/index.html`
- Load test results: `tests/load/results/`
- Pytest reports: Terminal output with detailed failure information
- Performance benchmarks: Automated timing and memory usage analysis

**Test Features Implemented:**

- **Security Testing**: HPKE encryption validation, replay protection, input sanitization
- **Performance Testing**: Response time measurement, throughput analysis, concurrent load handling
- **Reliability Testing**: Circuit breaker validation, retry mechanism testing, error recovery
- **Scalability Testing**: Load ramp-up scenarios, stress testing, spike handling
- **Compatibility Testing**: Multiple client scenario simulation, edge case handling

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

---

## Kubernetes thoughts

Looking at your production architecture only vs
Kubernetes:

What Wouldn't Work Well with K8s

Direct WireGuard Networking

- Your plan: Direct WireGuard tunnels between router +
  inference servers
- K8s problem: Adds overlay networking (CNI) on top of
  WireGuard
- Result: Router → CNI → WireGuard → CNI → Inference
  (extra hops, complexity)

mTLS Certificate Management

- Your plan: Simple step-ca with short-lived certs,
  direct cert pinning
- K8s problem: Would need cert-manager + your step-ca =
  dual cert systems
- Result: More complex certificate rotation, additional
  failure points

Dedicated Security Users

- Your plan: llm-router and inference users with specific
  permissions
- K8s problem: Containers run as numeric UIDs, not your
  hardened user accounts
- Result: Lose your specific user/group security model

systemd Security Hardening

- Your plan: Comprehensive systemd sandboxing
  (ProtectSystem=strict, etc.)
- K8s problem: Container security contexts are different
  from systemd features
- Result: Need to recreate security controls using Pod
  Security Standards

Memory Security Controls

- Your plan: mlockall() for HPKE keys, swap disabled,
  kernel hardening
- K8s problem: Less direct control over host memory
  management from containers
- Result: More complex memory security implementation

What K8s Would Add (Overhead)

- etcd cluster management
- API server security
- Container image vulnerabilities
- More network components to secure
- Service mesh complexity for mTLS

Your production setup is already distributed and secure.
K8s would add abstraction layers without significant
benefits for your specific privacy-focused use case.

Zero Data Persistence Requirements

Secure Log Scrubbing (lines 532-539)

- Your comprehensive regex patterns for scrubbing HPKE
  data, API keys, message content
- K8s problem: Container logs go through multiple layers
  (container runtime, kubelet, log drivers)
- Result: Much harder to guarantee complete data
  scrubbing across all log paths

Swap Completely Disabled (line 525)

- Your swapoff -a + fstab cleanup approach
- K8s problem: Node-level swap disabling conflicts with
  K8s memory management
- Result: K8s expects swap to be disabled anyway, but
  containers add memory complexity

Performance-Critical llama.cpp Optimizations

Direct Hardware Control (lines 98-109)

- Your custom make compilation with specific CPU flags
  for llama.cpp
- K8s problem: Container builds are less optimized,
  runtime overhead
- Result: Performance degradation for CPU-intensive
  inference

Model Loading & Memory Management (line 528)

- Your 16GB memory locking limits for models
- K8s problem: Container memory limits work differently
  than direct mlockall()
- Result: Less predictable model loading performance

Custom Systemd Dependency Ordering

Service Dependencies (line 727)

- Your After=wireguard-wg0.service for inference servers
- K8s problem: Pod startup dependencies are handled
  differently (init containers, readiness probes)
- Result: More complex service orchestration

Direct Certificate Pinning

Mobile App Certificate Pinning (lines 175, 297)

- Your hardcoded TLS cert fingerprint validation
- K8s problem: Ingress controllers/load balancers add
  certificate complexity
- Result: More certificate layers to pin and validate

Your architecture is designed for maximum control and
minimal abstraction - exactly what K8s adds layers to.

---

## 🎯 17. OpenAI Harmony Response Format Implementation

Based on the documentation at https://cookbook.openai.com/articles/openai-harmony and the GitHub repo https://github.com/openai/harmony, implementing the Harmony response format will improve the quality and structure of gpt-oss 20B model responses.

### Core Harmony Concepts

- **Roles**: `system` (highest priority) → `developer` → `user` → `assistant` → `tool`
- **Channels**: `final` (user-facing), `analysis` (chain-of-thought), `commentary` (tool calls/preambles)
- **Special Tokens**: `<|start|>`, `<|end|>`, `<|message|>`, `<|channel|>`, `<|return|>`
- **Structure**: `<|start|>{header}<|message|>{content}<|end|>`

### Implementation Tasks

- [ ] **Install OpenAI Harmony Library**:
  - [ ] Add `openai-harmony` to router dependencies: `uv add openai-harmony`
  - [ ] Verify Python library installation and compatibility
  - [ ] Import core components: `load_harmony_encoding`, `HarmonyEncodingName`, `Role`, `Message`, `Conversation`

- [ ] **Harmony Service Integration** (`services/harmony_service.py`):
  - [ ] Create HarmonyService class for response formatting
  - [ ] Implement `load_harmony_encoding(HarmonyEncodingName.HARMONY_GPT_OSS)` setup
  - [ ] Add conversation preparation: `Conversation.from_messages()` for chat history
  - [ ] Implement `render_conversation_for_completion()` for model input preparation
  - [ ] Add response parsing: `parse_messages_from_completion_tokens()` for model output

- [ ] **Router Integration** (`main.py` and `services/inference_service.py`):
  - [ ] Integrate HarmonyService into inference pipeline
  - [ ] Modify chat endpoint to use Harmony conversation preparation
  - [ ] Update streaming response handler to parse Harmony-formatted tokens
  - [ ] Preserve chain-of-thought messages between conversation turns
  - [ ] Handle different message channels (`final`, `analysis`, `commentary`)

- [ ] **Response Processing Enhancement**:
  - [ ] Implement reasoning effort level support (low/medium/high)
  - [ ] Add proper handling of tool calls in `commentary` channel
  - [ ] Support structured message parsing with role/channel separation
  - [ ] Maintain conversation context with proper message history

- [ ] **HPKE Integration with Harmony**:
  - [ ] Ensure Harmony-formatted responses work with HPKE encryption
  - [ ] Test streaming of structured Harmony responses through SSE
  - [ ] Verify encrypted chunk formatting maintains Harmony structure
  - [ ] Update response decoding to handle Harmony message format

- [ ] **Configuration and Testing**:
  - [ ] Add Harmony-specific configuration options to `config.py`
  - [ ] Create test cases for Harmony response formatting
  - [ ] Test conversation continuation with proper role/channel handling
  - [ ] Validate improved response quality vs. standard chat completions
  - [ ] Load test Harmony implementation performance impact

- [ ] **Documentation Updates**:
  - [ ] Document Harmony integration in configuration guide
  - [ ] Add usage examples for Harmony-formatted conversations
  - [ ] Update API documentation to reflect Harmony response structure
  - [ ] Create troubleshooting guide for Harmony-specific issues

### 🚀 Harmony Implementation Usage Commands

**Development Testing:**

```bash
# Test Harmony library installation
python3 -c "from openai_harmony import load_harmony_encoding, HarmonyEncodingName; print('Harmony installed successfully')"

# Test basic Harmony conversation rendering
python3 -c "
from openai_harmony import load_harmony_encoding, HarmonyEncodingName, Role, Message, Conversation
enc = load_harmony_encoding(HarmonyEncodingName.HARMONY_GPT_OSS)
convo = Conversation.from_messages([Message.from_role_and_content(Role.USER, 'Hello')])
tokens = enc.render_conversation_for_completion(convo, Role.ASSISTANT)
print(f'Rendered tokens: {len(tokens)}')
"

# Test Harmony-formatted HPKE request
python3 create_hpke_request.py "Explain quantum computing step by step" | grep curl | bash | python3 decode_hpke_response.py
```

**Harmony Response Quality Testing:**

```bash
# Compare standard vs Harmony responses
python3 test_harmony_quality.py "Compare reasoning quality"

# Test multi-turn conversation with Harmony
python3 test_harmony_conversation.py

# Validate Harmony streaming performance
python3 test_harmony_streaming.py
```

**Expected Benefits:**
- Improved response quality from gpt-oss 20B model
- Structured reasoning with chain-of-thought preservation
- Better tool call handling and conversation continuity
- Enhanced user experience with clearer response formatting

### Priority Implementation Order

1. **Phase 1**: Install library and create basic HarmonyService
2. **Phase 2**: Integrate with existing inference pipeline
3. **Phase 3**: Test HPKE compatibility and streaming
4. **Phase 4**: Optimize performance and add comprehensive testing

This implementation should significantly improve the quality of responses from your gpt-oss 20B model by providing the structured conversation format it was designed to work with.

---

## 🎯 18. Response Verbosity Optimization (Post-Harmony)

After implementing Harmony format integration, responses now have proper channel separation but remain overly verbose for mobile chat interfaces. While Harmony eliminated internal reasoning leaks, the final responses still contain excessive tables, detailed schedules, and multi-section formatting inappropriate for mobile.

### Current Verbosity Issues Identified

**✅ Fixed by Harmony**:
- Internal reasoning no longer exposed to user
- No more rambling thought processes like "We need to help prioritize..."
- Proper channel separation between analysis and final response

**❌ Remaining Verbosity Problems**:
- Final responses still too structured/comprehensive (tables, schedules, tips sections)
- Responses optimized for desktop/documentation, not mobile chat
- No dynamic verbosity control based on context
- Model doesn't understand mobile chat constraints

### Implementation Tasks

- [ ] **System Prompt Optimization**:
  - [ ] Add mobile-first response guidelines to system prompts
  - [ ] Emphasize conciseness and direct answers for chat interfaces
  - [ ] Specify preferred response length (2-3 sentences for simple questions)
  - [ ] Add context awareness for mobile vs desktop usage

- [ ] **Dynamic Verbosity Control**:
  - [ ] Add `verbosity_level` parameter to `InferenceRequest` model
  - [ ] Implement verbosity levels: `brief`, `normal`, `detailed`
  - [ ] Allow mobile app to specify desired response length
  - [ ] Create verbosity-specific system prompt templates

- [ ] **Harmony Reasoning Effort Tuning**:
  - [ ] Test `reasoning_effort: "low"` for more concise responses
  - [ ] Compare response quality across different reasoning effort levels
  - [ ] Implement dynamic reasoning effort based on question complexity
  - [ ] Add configuration options for different use cases

- [ ] **Response Length Management**:
  - [ ] Implement more aggressive `max_tokens` defaults for mobile
  - [ ] Add response truncation with smart cutoff points
  - [ ] Create response length estimation before sending
  - [ ] Add response preview/summary options

- [ ] **Context-Aware Response Formatting**:
  - [ ] Detect question complexity and adjust response depth
  - [ ] Simple questions → brief answers, complex questions → detailed
  - [ ] Add response format preferences (bullet points vs paragraphs)
  - [ ] Implement conversation context awareness

### 🚀 Verbosity Control Usage Commands

**Configuration Options:**

```bash
# Adjust Harmony reasoning effort
HARMONY_REASONING_EFFORT=low          # More concise responses
HARMONY_REASONING_EFFORT=medium       # Balanced (current)
HARMONY_REASONING_EFFORT=high         # More detailed responses

# New verbosity settings
DEFAULT_VERBOSITY_LEVEL=brief         # For mobile apps
MAX_TOKENS_MOBILE=150                # Shorter responses for mobile
MAX_TOKENS_DESKTOP=500               # Longer responses for desktop
```

**Testing Different Verbosity Levels:**

```bash
# Test brief responses
python3 create_hpke_request.py "What is 2+2?" --verbosity=brief

# Test normal responses  
python3 create_hpke_request.py "Help me prioritize my day" --verbosity=normal

# Test detailed responses
python3 create_hpke_request.py "Explain quantum computing" --verbosity=detailed
```

### Expected Results

**Before Optimization (Current)**:
```
Here's a quick "rule-of-thumb" priority list:

| # | Task | Why it's high priority | When it fits |
|---|------|------------------------|---------------|
|1 | Working | Deadlines/meetings | Morning 8-12 |
|2 | Cleaning | Boosts productivity | 12-1pm |
[... continues with tables, schedules, tips...]
```

**After Optimization (Target)**:
```
Priority order: 1) Work (morning), 2) Cleaning, 3) Building furniture, 4) Groceries, 5) Cooking, 6) Sport, 7) Time with girlfriend. 

Start with work when you're fresh, then tackle physical tasks, and end with relaxation.
```

### Priority Implementation Order

1. **Phase 1**: System prompt optimization for conciseness
2. **Phase 2**: Dynamic verbosity control implementation  
3. **Phase 3**: Harmony reasoning effort tuning
4. **Phase 4**: Context-aware response formatting

This optimization should achieve 60-80% reduction in response length while maintaining quality and usefulness for mobile chat interfaces.
