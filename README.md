# 🧠 Geist - Privacy-First LLM Platform

A complete privacy-focused LLM platform featuring both on-device mobile inference and secure cloud infrastructure with end-to-end encryption.

## 🏗️ Architecture Overview

### Backend: Privacy-Focused LLM Server
- **Router Server**: FastAPI-based HPKE-encrypted request routing
- **Inference Engine**: llama.cpp-based LLM processing
- **Security**: End-to-end encryption, no data persistence, memory protection
- **Deployment**: Development (UNIX sockets) and Production (WireGuard + mTLS)

### Frontend: React Native Mobile App
- **Stack**: React Native + Expo (ejected) + llama.rn
- **Inference Modes**: Local on-device AI and secure cloud AI
- **Privacy**: Local chat storage, secure key management, no external data transmission

## 🚀 Quick Start

### Backend Setup

#### Development Environment
```bash
# 1. Set up Python environment
cd backend/router
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.cargo/env
uv sync

# 2. Set up inference server (llama.cpp)
cd ../inference
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp && mkdir build && cd build && cmake .. && make -j4
# Download your GGUF model to models/ directory

# 3. Start development servers (from project root)
cd ../../
./start-backend-dev.sh  # Starts both router and inference services
```

#### Production Environment
```bash
# 1. Deploy security hardening
cd backend/router
sudo ./deploy-isolation-hardening.sh

# 2. Configure network (WireGuard + mTLS)
sudo ./scripts/setup-wireguard-prod.sh
sudo ./scripts/setup-mtls-certs.sh setup

# 3. Start production servers
sudo ./start-prod.sh
```

### Frontend Setup

#### Prerequisites
- Node.js 18+
- React Native development environment (Xcode for iOS, Android Studio for Android)
- Ejected Expo project (already configured)

#### Getting Started
```bash
# 1. Install dependencies
cd frontend
npm install

# 2. Install iOS dependencies
npx pod-install

# 3. Start local model server (for development)
cd models && npx http-server . -p 3000 --cors

# 4. Start Metro bundler
npx react-native start

# 5. Run on device/simulator
npx react-native run-ios     # iOS
npx react-native run-android # Android
```

## 🔧 Backend Details

### Core Components

#### Router Server (FastAPI)
- **Port**: 8000 (dev) / 443 (prod)
- **Endpoints**:
  - `POST /api/chat` - HPKE-encrypted chat requests with SSE streaming
  - `GET /api/pubkey` - Router public keys for HPKE encryption
  - `GET /health` - Health checks
  - `GET /metrics` - Prometheus metrics

#### Inference Server (llama.cpp)
- **Communication**: UNIX socket (dev) / WireGuard+mTLS (prod)
- **Models**: GGUF format (CPU optimized)
- **API**: OpenAI-compatible endpoints with streaming support

### Security Features

#### End-to-End Encryption (HPKE)
- **Algorithm**: X25519-HKDF-SHA256 + ChaCha20-Poly1305
- **Key Rotation**: Automatic 24-hour rotation
- **Replay Protection**: Timestamp validation + request ID tracking
- **Memory Security**: mlockall() for sensitive data, swap disabled

#### Process Isolation
- **Users**: Dedicated `llm-router` and `inference` system users
- **Systemd**: Comprehensive sandboxing with security hardening
- **Logging**: Automatic sensitive data scrubbing and secure rotation

#### Network Security
- **Development**: UNIX domain sockets, firewall protection
- **Production**: WireGuard VPN + mutual TLS authentication
- **Certificate Management**: Automated rotation via step-ca

### Testing

```bash
# Unit and integration tests
make test-all

# Load testing
make test-load

# Security validation
./scripts/security-validation.sh

# HPKE encryption testing
python3 create_hpke_request.py "Test message" | grep curl | bash | python3 decode_hpke_response.py
```

## 📱 Frontend Details

### Core Features

#### Chat Interface
- **UI**: Native chat bubbles with streaming responses
- **History**: Persistent local chat storage via AsyncStorage
- **Threading**: Support for multiple conversation threads

#### Inference Modes
- **Local Mode**: On-device llama.rn processing (fully private)
- **Cloud Mode**: Encrypted backend communication via HPKE
- **Seamless Switching**: Toggle between modes mid-conversation

#### Security & Privacy
- **Local Storage**: All data stored on-device only
- **Key Management**: Device keys in secure storage (expo-secure-store)
- **Encryption**: Transparent HPKE encryption for cloud mode
- **No Tracking**: No analytics, no external data transmission

### Development

#### Model Management
```bash
# Local model hosting for development
cd models
npx http-server . -p 3000 --cors
# Models served at: http://127.0.0.1:3000/[model-name].gguf
```

#### Key Libraries
- **llama.rn**: Local LLM inference engine
- **@noble/curves & @noble/hashes**: HPKE cryptography
- **expo-secure-store**: Secure key storage
- **react-native-fs**: File system access for models

#### Project Structure
```
frontend/
├── components/        # Reusable UI components
├── screens/          # Main app screens
├── hooks/            # Custom React hooks
├── lib/              # Core libraries (HPKE, LLM client, etc.)
├── models/           # Local GGUF model storage
└── utils/            # Helper utilities
```

## 🛠️ Development Workflow

### Backend Development
```bash
# Switch to development environment (from backend/router/)
cd backend/router
./switch-env.sh dev

# Run tests during development
make quick              # Fast linting + unit tests
make test-all           # Complete test suite (linting, typing, unit tests)
make dev-check          # Full development checks

# Test HPKE encryption manually
python3 create_hpke_request.py "Hello!" | grep curl | bash | python3 decode_hpke_response.py

# Debug HPKE encryption
python3 debug_hpke_direct.py
```

### Frontend Development
```bash
# Start development environment
npm start              # Metro bundler
npx react-native run-ios --simulator="iPhone 15"

# Debug local inference
# Enable verbose logging in useLlama.ts
```

### Full Stack Testing
```bash
# 1. Start backend (from project root)
./start-backend-dev.sh

# 2. Start model server (in frontend/ directory)  
cd frontend/models && npx http-server . -p 3000 --cors

# 3. Start frontend (in frontend/ directory)
cd ../
npx react-native start
npx react-native run-ios

# 4. Test cloud inference mode in app settings
```

## 🚀 Production Deployment

### Backend Production
```bash
# 1. Deploy to router server
cd backend/router
sudo ./deploy-prod.sh

# 2. Configure DNS and TLS
# Point domain to router server IP
# Configure Caddy or similar for auto HTTPS

# 3. Set up inference server(s)
sudo ./scripts/setup-wireguard-prod.sh
sudo systemctl start llm-router-hardened
```

### Frontend Production
```bash
# Build release APK/IPA
npx react-native run-android --variant=release
# Follow platform-specific distribution guides
```

## 📊 Monitoring & Maintenance

### Backend Monitoring
```bash
# Health checks
curl http://localhost:8000/health

# Security monitoring
tail -f /var/log/llm-security/security-alerts.log

# Performance metrics
curl http://localhost:8000/metrics
```

### Frontend Debugging
- Enable verbose logging in development builds
- Use React Native Debugger for state inspection
- Monitor device storage usage for downloaded models

## 🔍 Troubleshooting

### Common Backend Issues
- **llama.cpp Build Errors**: Use CMake instead of make: `cd llama.cpp/build && cmake .. && make -j4`
- **Server Won't Start**: Check if ports 8000/8001 are available, ensure model files exist
- **HPKE Encryption Errors**: Test with `python3 create_hpke_request.py "test"` 
- **Memory Issues**: Verify swap disabled and mlockall limits
- **Integration Test Failures**: Normal due to circuit breaker - live server should work fine

### Common Frontend Issues
- **Model Download Failures**: Check local server at port 3000
- **llama.rn Build Errors**: Ensure proper pod installation
- **Inference Crashes**: Check device memory and model compatibility

## 📚 Additional Resources

- **Backend Architecture**: See `backend/plan.md` for detailed technical specs
- **Frontend Implementation**: See `frontend/plan.md` for phase-by-phase development
- **Router Documentation**: See `backend/router/docs/`
- **Security Guide**: See `backend/router/docs/network-security-guide.md`
- **Configuration**: See `backend/router/docs/configuration-guide.md`

---

**Built for Privacy**: No data leaves your device in local mode. Cloud mode uses military-grade encryption with zero server-side storage.
