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
- **OpenAI Harmony Integration**: Structured response format optimized for gpt-oss 20B

## OpenAI Harmony Integration

The router integrates OpenAI Harmony response format to significantly improve response quality from the gpt-oss 20B model by providing the structured conversation format it was designed for.

### What is Harmony?

Harmony is OpenAI's structured response format that separates reasoning from final output using special tokens and channels:

- **Channels**: `final` (user-facing), `analysis` (reasoning), `commentary` (tool calls)  
- **Special Tokens**: `<|start|>`, `<|end|>`, `<|message|>`, `<|channel|>`, `<|return|>`
- **Structure**: `<|start|>{role}<|channel|>{channel}<|message|>{content}<|end|>`

### How It Works

1. **Request Processing**: Incoming messages are converted to Harmony format using `HarmonyService`
2. **Model Inference**: Uses completion endpoint with Harmony-formatted prompts
3. **Response Parsing**: Separates analysis channel (reasoning) from final channel (user response)
4. **HPKE Integration**: Full compatibility with encrypted streaming maintained

### Configuration

```bash
# Enable/disable Harmony (config.py)
HARMONY_ENABLED=true

# Reasoning effort levels
HARMONY_REASONING_EFFORT=medium  # low, medium, high

# Include analysis channel in response
HARMONY_INCLUDE_ANALYSIS=true
```

### Architecture Changes

```
Before: messages → chat/completions → raw response → HPKE encrypt → client
After:  messages → harmony format → completions → channel parse → HPKE encrypt → client
```

**New Components**:
- `services/harmony_service.py`: Core Harmony integration
- `HarmonyService`: Conversation preparation and response parsing
- Enhanced `InferenceService`: Harmony-aware request formatting

### Response Quality Improvement

**Before Harmony** (verbose internal reasoning):
```
We need to help prioritize tasks: cleaning, working, building furniture...
Need to give a schedule or priority list. Might consider time allocation...
[continues with verbose reasoning mixed with response]
```

**After Harmony** (clean separation):
- **Analysis Channel**: Contains reasoning (hidden from user)  
- **Final Channel**: Clean, structured response (shown to user)

### Benefits Achieved

✅ **Eliminated Internal Reasoning Leaks**: No more verbose thought processes in final response  
✅ **Improved Response Structure**: Better organized, more coherent answers  
✅ **HPKE Compatibility**: Full encryption support maintained  
✅ **Backward Compatibility**: Can be disabled via configuration  
✅ **Mobile Optimization**: Foundation for verbosity control

### Current Status

- **Phase 1**: ✅ Complete - Basic integration with gpt-oss 20B
- **Phase 2**: 🚧 In Progress - Verbosity optimization for mobile chat
- **Phase 3**: 📋 Planned - Advanced reasoning effort tuning
- **Phase 4**: 📋 Planned - Context-aware response formatting

### Testing

```bash
# Test Harmony integration
python test_harmony_integration.py

# Test with HPKE encryption
python create_hpke_request.py "Your question" | grep curl | bash | python decode_harmony_response.py

# Debug channel content
python decode_harmony_response.py  # Shows analysis vs final channels
```

### Troubleshooting

- **Verbose Responses**: Adjust `HARMONY_REASONING_EFFORT=low` or implement verbosity controls (Section 18 in plan.md)
- **Missing Responses**: Check logs for Harmony parsing errors
- **HPKE Issues**: Ensure mobile app uses updated `harmonyDecoder.ts`

See `backend/plan.md` Section 17 for complete implementation details and Section 18 for verbosity optimization plans.

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