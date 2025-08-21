#!/bin/bash

# Production Environment Deployment Script
# This script configures the system for production mode with security hardening

set -e

echo "🚀 Deploying LLM Router in PRODUCTION mode..."

# Ensure we're running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo "❌ This script must be run as root or with sudo for production deployment"
    exit 1
fi

# Ensure we're in the correct directory
cd "$(dirname "$0")"

# Set environment
export ENVIRONMENT=production

# Backup existing configuration
echo "📋 Setting up production configuration..."
if [ -f ".env" ]; then
    cp .env .env.backup.$(date +%s)
    echo "   → Backed up existing .env file"
fi

cp .env.production .env
echo "   → Copied .env.production to .env"

# Create production directories
echo "🏗️  Creating production directory structure..."
mkdir -p /etc/llm-router/{keys,certs,ca}
mkdir -p /var/log/llm-router
mkdir -p /var/lib/llm-router

# Set proper ownership and permissions
chown -R llm-router:llm-router /etc/llm-router
chown -R llm-router:llm-router /var/log/llm-router
chown -R llm-router:llm-router /var/lib/llm-router

chmod 700 /etc/llm-router/keys
chmod 750 /etc/llm-router/certs
chmod 750 /etc/llm-router/ca

# Generate production HPKE keys if they don't exist
echo "🔑 Setting up production HPKE keys..."
if [ ! -f "/etc/llm-router/keys/hpke-private.key" ] || [ ! -f "/etc/llm-router/keys/hpke-public.key" ]; then
    echo "   → Generating production HPKE keys..."
    sudo -u llm-router python3 -c "
from services.hpke_service import HPKEService
hpke = HPKEService('/etc/llm-router/keys')
hpke.rotate_keys()
print('   → Production HPKE keys generated successfully')
"
    chmod 600 /etc/llm-router/keys/hpke-private.key
    chmod 644 /etc/llm-router/keys/hpke-public.key
fi

# Set up WireGuard configuration
echo "🌐 Verifying WireGuard configuration..."
if [ ! -f "/etc/wireguard/wg0.conf" ]; then
    echo "   ⚠️  WireGuard configuration not found!"
    echo "   → Please run: ./scripts/setup-wireguard-prod.sh"
else
    echo "   → WireGuard configuration found ✅"
    # Start WireGuard if not running
    if ! systemctl is-active --quiet wg-quick@wg0; then
        echo "   → Starting WireGuard interface..."
        systemctl enable wg-quick@wg0
        systemctl start wg-quick@wg0
    fi
fi

# Set up mTLS certificates
echo "🔐 Verifying mTLS certificates..."
if [ ! -f "/etc/llm-router/certs/router-cert.pem" ]; then
    echo "   ⚠️  mTLS certificates not found!"
    echo "   → Please run: ./scripts/setup-mtls-certs.sh setup"
else
    echo "   → mTLS certificates found ✅"
fi

# Configure systemd service for production
echo "⚙️  Configuring production systemd service..."
cat > /etc/systemd/system/llm-router-prod.service << 'EOF'
[Unit]
Description=LLM Router (Production)
After=network.target wg-quick@wg0.service
Wants=wg-quick@wg0.service
PartOf=wg-quick@wg0.service

[Service]
Type=exec
User=llm-router
Group=llm-router
WorkingDirectory=/opt/llm-router
Environment=ENVIRONMENT=production
ExecStart=/opt/llm-router/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 443 --ssl-keyfile /etc/llm-router/certs/server.key --ssl-certfile /etc/llm-router/certs/server.crt
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=read-only
ProtectSystem=strict
ProtectKernelLogs=yes
ProtectKernelModules=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
SystemCallFilter=@system-service
MemoryDenyWriteExecute=yes
ReadWritePaths=/var/log/llm-router /var/lib/llm-router /tmp
LimitCORE=0

# Resource limits
LimitNOFILE=8192
LimitNPROC=2048

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable llm-router-prod

# Configure firewall for production
echo "🔥 Configuring production firewall..."
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 443/tcp  # HTTPS
ufw allow 51820/udp # WireGuard

# Disable swap for security
echo "🔒 Configuring security settings..."
swapoff -a
echo "vm.swappiness=1" >> /etc/sysctl.conf
echo "fs.suid_dumpable=0" >> /etc/sysctl.conf
sysctl -p

# Install/update dependencies
echo "📦 Installing dependencies..."
sudo -u llm-router uv sync

# Run configuration validation
echo "🧪 Validating production configuration..."
sudo -u llm-router python3 -c "
from config import get_settings
settings = get_settings()
assert settings.ENVIRONMENT == 'production', 'Environment should be production'
assert settings.INFERENCE_TRANSPORT == 'https', 'Should use HTTPS transport in prod'
assert settings.MTLS_ENABLED == True, 'mTLS should be enabled in prod'
assert settings.SSL_ENABLED == True, 'SSL should be enabled in prod'
print('   → Configuration validation passed ✅')
"

echo ""
echo "✅ Production environment setup complete!"
echo ""
echo "🚀 To start the production server:"
echo "   systemctl start llm-router-prod"
echo ""
echo "📊 To check service status:"
echo "   systemctl status llm-router-prod"
echo "   journalctl -u llm-router-prod -f"
echo ""
echo "🔍 To test the setup:"
echo "   curl https://your-domain.com/health"
echo ""