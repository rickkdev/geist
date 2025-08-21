# Configuration Management Guide

This guide covers the complete configuration system for the Privacy-Focused LLM Router, including environment switching, deployment procedures, and configuration options.

## Overview

The LLM Router uses a flexible configuration system that supports:
- **Environment-based configuration** (development vs production)
- **Hot-swappable environments** with deployment scripts
- **Security-first defaults** with production hardening
- **Pydantic validation** for all configuration values

## Environment Configurations

### Development Environment

**Use Case**: Local development, testing, debugging
**Transport**: UNIX domain socket (`/run/inference.sock`)
**Security**: Relaxed settings, verbose logging
**Services**: Single server with direct socket communication

### Production Environment

**Use Case**: Production deployment with security hardening
**Transport**: HTTPS over WireGuard with mTLS
**Security**: Strict settings, minimal logging, sandboxing
**Services**: Distributed architecture with multiple inference servers

## Configuration Files

### `.env.development`
Development-specific configuration with:
- UNIX socket transport
- Verbose logging enabled
- Development HPKE keys (`./dev-keys/`)
- Relaxed rate limiting
- CORS enabled
- FastAPI docs enabled

### `.env.production`
Production-specific configuration with:
- HTTPS transport over WireGuard
- mTLS authentication
- Production HPKE keys (`/etc/llm-router/keys/`)
- Strict rate limiting
- No CORS, no docs
- Comprehensive security hardening

## Configuration Options

### Core Settings

| Setting | Development | Production | Description |
|---------|-------------|------------|-------------|
| `ENVIRONMENT` | `development` | `production` | Current environment mode |
| `HOST` | `0.0.0.0` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | `443` | Server port |
| `SSL_ENABLED` | `false` | `true` | Enable SSL/TLS |

### Transport Configuration

| Setting | Development | Production | Description |
|---------|-------------|------------|-------------|
| `INFERENCE_TRANSPORT` | `unix` | `https` | Transport protocol |
| `INFERENCE_ENDPOINTS` | `["/run/inference.sock"]` | `["https://10.0.0.2:8001"]` | Endpoint addresses |
| `INFERENCE_TIMEOUT_SECONDS` | `60` | `90` | Request timeout |
| `REQUEST_BUDGET_SECONDS` | `300` | `600` | Max request duration |

### Security Settings

| Setting | Development | Production | Description |
|---------|-------------|------------|-------------|
| `MTLS_ENABLED` | `false` | `true` | Mutual TLS authentication |
| `RATE_LIMIT_PER_MINUTE` | `120` | `60` | Requests per minute limit |
| `HPKE_KEY_ROTATION_HOURS` | `24` | `12` | Key rotation interval |
| `DISABLE_DOCS` | `false` | `true` | Disable FastAPI docs |

### Logging Settings

| Setting | Development | Production | Description |
|---------|-------------|------------|-------------|
| `LOG_LEVEL` | `DEBUG` | `INFO` | Logging verbosity |
| `DISABLE_ACCESS_LOGS` | `false` | `true` | Disable HTTP access logs |
| `DISABLE_REQUEST_BODY_LOGGING` | `false` | `true` | Hide request bodies |
| `DISABLE_RESPONSE_BODY_LOGGING` | `false` | `true` | Hide response bodies |

## Deployment Scripts

### Quick Environment Switching

```bash
# Switch to development
./switch-env.sh dev

# Switch to production (requires sudo)
sudo ./switch-env.sh prod

# Check current status
./switch-env.sh status
```

### Individual Deployment Scripts

```bash
# Deploy development environment
./deploy-dev.sh

# Deploy production environment (requires sudo)
sudo ./deploy-prod.sh
```

## Environment Switching Process

### Development → Production

1. **Stop development services**
   ```bash
   pkill -f "uvicorn main:app"
   ```

2. **Run production deployment**
   ```bash
   sudo ./deploy-prod.sh
   ```

3. **Start production service**
   ```bash
   systemctl start llm-router-prod
   ```

### Production → Development

1. **Stop production service**
   ```bash
   sudo systemctl stop llm-router-prod
   ```

2. **Run development deployment**
   ```bash
   ./deploy-dev.sh
   ```

3. **Start development server**
   ```bash
   ./start-dev.sh
   ```

## Configuration Validation

The system includes automatic configuration validation:

```python
from config import get_settings
settings = get_settings()

# Environment-specific validation
assert settings.ENVIRONMENT in ["development", "production"]

if settings.is_production():
    assert settings.MTLS_ENABLED == True
    assert settings.SSL_ENABLED == True
    assert settings.INFERENCE_TRANSPORT == "https"
    
if settings.is_development():
    assert settings.INFERENCE_TRANSPORT == "unix"
    assert settings.DEV_DEBUG == True
```

## Configuration Methods

### Settings Class Helper Methods

```python
settings = get_settings()

# Environment checks
settings.is_development()  # True if ENVIRONMENT=development
settings.is_production()   # True if ENVIRONMENT=production

# Transport helpers
settings.get_inference_socket_path()    # UNIX socket path (dev)
settings.get_inference_https_urls()     # HTTPS URLs (prod)
settings.get_production_endpoints()     # WireGuard endpoints

# Security helpers
settings.should_enable_cors()           # CORS policy
settings.should_use_mtls()              # mTLS configuration
```

## Security Considerations

### Development Environment
- **Local-only access**: UNIX socket prevents network exposure
- **Verbose logging**: Full request/response logging for debugging
- **Relaxed rate limiting**: Higher limits for development workflow
- **CORS enabled**: Allows frontend development

### Production Environment
- **Network isolation**: WireGuard private network only
- **mTLS authentication**: Certificate-based client authentication
- **Minimal logging**: No sensitive data in logs
- **Strict rate limiting**: DDoS protection
- **Systemd hardening**: Process isolation and security restrictions

## Troubleshooting

### Configuration Issues

**Problem**: Environment not switching properly
```bash
# Check current configuration
./switch-env.sh status

# Verify .env file
cat .env | grep ENVIRONMENT

# Re-deploy environment
./switch-env.sh dev  # or prod
```

**Problem**: UNIX socket not accessible
```bash
# Check socket exists
ls -la /run/inference.sock

# Check service status
systemctl status llama-inference

# Test connectivity
curl --unix-socket /run/inference.sock http://localhost/health
```

**Problem**: mTLS certificate errors
```bash
# Verify certificates exist
ls -la /etc/llm-router/certs/

# Re-generate certificates
sudo ./scripts/setup-mtls-certs.sh setup

# Test certificate
openssl x509 -in /etc/llm-router/certs/router-cert.pem -text -noout
```

### Validation Errors

**Problem**: Pydantic validation failures
- Check environment variable names (case-sensitive)
- Verify data types (strings, booleans, integers, lists)
- Ensure required fields are present
- Use proper JSON formatting for list values

**Problem**: Service startup failures
- Check configuration file syntax
- Verify file permissions (especially keys and certificates)
- Review systemd service logs: `journalctl -u llm-router-prod -f`

## Best Practices

### Development
1. Always use `./switch-env.sh dev` for consistent setup
2. Keep development keys in version control (they're not secret)
3. Use verbose logging for debugging
4. Test configuration validation regularly

### Production
1. Use `sudo ./switch-env.sh prod` for proper permissions
2. Store production keys securely (never in version control)
3. Monitor configuration changes through systemd
4. Implement configuration backup and recovery procedures
5. Test environment switching in staging before production

### Security
1. Never mix development and production configurations
2. Rotate HPKE keys according to configured intervals
3. Monitor certificate expiration dates
4. Audit configuration changes
5. Use principle of least privilege for file permissions

## Configuration Reference

For complete configuration options, see:
- `config.py`: Settings class with all available options
- `.env.development`: Development environment template
- `.env.production`: Production environment template
- Deployment scripts: `deploy-dev.sh`, `deploy-prod.sh`, `switch-env.sh`