#!/bin/bash

# Development Environment Deployment Script
# This script configures the system for development mode

set -e

echo "🔧 Deploying LLM Router in DEVELOPMENT mode..."

# Ensure we're in the correct directory
cd "$(dirname "$0")"

# Set environment
export ENVIRONMENT=development

# Copy development configuration
echo "📋 Setting up development configuration..."
if [ -f ".env" ]; then
    cp .env .env.backup.$(date +%s)
    echo "   → Backed up existing .env file"
fi

cp .env.development .env
echo "   → Copied .env.development to .env"

# Verify development keys exist
echo "🔑 Verifying development HPKE keys..."
if [ ! -d "dev-keys" ]; then
    echo "   → Creating dev-keys directory..."
    mkdir -p dev-keys
fi

if [ ! -f "dev-keys/hpke-private.key" ] || [ ! -f "dev-keys/hpke-public.key" ]; then
    echo "   → Generating development HPKE keys..."
    python3 -c "
from services.hpke_service import HPKEService
import os
os.makedirs('dev-keys', exist_ok=True)
hpke = HPKEService('dev-keys')
hpke.rotate_keys()
print('   → Development HPKE keys generated successfully')
"
fi

# Set up UNIX socket permissions for development
echo "🔧 Setting up development environment..."

# Check if llama-inference service is running
if systemctl is-active --quiet llama-inference; then
    echo "   → llama-inference service is already running"
else
    echo "   → Starting llama-inference service..."
    sudo systemctl start llama-inference
fi

# Verify UNIX socket exists and is accessible
echo "🔍 Verifying UNIX socket connectivity..."
if [ -S "/run/inference.sock" ]; then
    echo "   → UNIX socket exists at /run/inference.sock"
    # Test socket connectivity
    if curl --unix-socket /run/inference.sock -s http://localhost/health >/dev/null 2>&1; then
        echo "   → Socket connectivity verified ✅"
    else
        echo "   ⚠️  Warning: Socket exists but not responding"
    fi
else
    echo "   ⚠️  Warning: UNIX socket not found at /run/inference.sock"
    echo "   → Please ensure llama-inference service is running"
fi

# Install/update dependencies
echo "📦 Installing dependencies..."
uv sync

# Run configuration validation
echo "🧪 Validating configuration..."
python3 -c "
from config import get_settings
settings = get_settings()
assert settings.ENVIRONMENT == 'development', 'Environment should be development'
assert settings.INFERENCE_TRANSPORT == 'unix', 'Should use UNIX transport in dev'
assert settings.DEV_DEBUG == True, 'Debug should be enabled in dev'
print('   → Configuration validation passed ✅')
"

echo ""
echo "✅ Development environment setup complete!"
echo ""
echo "🚀 To start the development server:"
echo "   ./start-dev.sh"
echo ""
echo "🔍 To test the setup:"
echo "   python3 create_hpke_request.py \"Hello world\" | grep curl | bash"
echo ""