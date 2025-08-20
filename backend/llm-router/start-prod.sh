#!/bin/bash

# Production Server Startup Script
# This sets up and starts the production configuration with systemd

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🏭 Starting LLM Router - Production Mode"
echo "======================================="

# Check if running as root (required for production setup)
if [[ $EUID -ne 0 ]]; then
    echo "❌ Production setup requires root privileges"
    echo "Please run: sudo $0"
    exit 1
fi

# Determine server type
SERVER_TYPE=""
if [[ -f "/etc/llm-router/server-type" ]]; then
    SERVER_TYPE=$(cat /etc/llm-router/server-type)
else
    echo "What type of server is this?"
    echo "1) router    - Handles client connections and routing"
    echo "2) inference - Runs the LLM inference engine"
    echo ""
    read -p "Enter choice (1 or 2): " choice
    
    case $choice in
        1) SERVER_TYPE="router" ;;
        2) SERVER_TYPE="inference" ;;
        *) echo "❌ Invalid choice"; exit 1 ;;
    esac
    
    # Save server type
    mkdir -p /etc/llm-router
    echo "$SERVER_TYPE" > /etc/llm-router/server-type
fi

echo "📝 Server type: $SERVER_TYPE"

# Create users if they don't exist
create_users() {
    echo "👥 Creating service users..."
    
    if ! id inference >/dev/null 2>&1; then
        useradd -r -s /bin/false -d /opt/llm-router inference
        echo "   ✅ Created user: inference"
    fi
    
    if ! id router >/dev/null 2>&1; then
        useradd -r -s /bin/false -d /opt/llm-router router
        echo "   ✅ Created user: router"
    fi
    
    # Add router user to inference group for socket access
    usermod -a -G inference router
    echo "   ✅ Added router to inference group"
}

# Install systemd services
install_services() {
    echo "⚙️ Installing systemd services..."
    
    if [[ "$SERVER_TYPE" == "router" ]]; then
        # Install router service (you'll need to create this)
        echo "   📄 Router services will be installed here"
        echo "   (Implementation depends on your main.py FastAPI app)"
        
    elif [[ "$SERVER_TYPE" == "inference" ]]; then
        # Install inference services
        cp llama-inference-prod.service /etc/systemd/system/
        systemctl daemon-reload
        echo "   ✅ Installed: llama-inference-prod.service"
    fi
}

# Setup network configuration
setup_network() {
    echo "🌐 Setting up network configuration..."
    
    # Check if WireGuard is configured
    if [[ ! -f "/etc/wireguard/wg0.conf" ]]; then
        echo "   ⚠️  WireGuard not configured"
        echo "   Run: sudo ./scripts/setup-wireguard-prod.sh"
        read -p "   Continue without WireGuard? (y/N): " continue_without_wg
        if [[ "$continue_without_wg" != "y" ]]; then
            exit 1
        fi
    else
        echo "   ✅ WireGuard configuration found"
    fi
    
    # Check if mTLS certificates exist
    if [[ ! -f "/etc/llm-router/certs/${SERVER_TYPE}-cert.pem" ]]; then
        echo "   ⚠️  mTLS certificates not found"
        echo "   Run: sudo ./scripts/setup-mtls-certs.sh setup"
        read -p "   Continue without mTLS? (y/N): " continue_without_mtls
        if [[ "$continue_without_mtls" != "y" ]]; then
            exit 1
        fi
    else
        echo "   ✅ mTLS certificates found"
    fi
}

# Start services
start_services() {
    echo "🚀 Starting services..."
    
    # Start WireGuard if configured
    if [[ -f "/etc/wireguard/wg0.conf" ]]; then
        echo "   🔗 Starting WireGuard..."
        systemctl enable wg-quick@wg0
        systemctl start wg-quick@wg0
        echo "   ✅ WireGuard started"
    fi
    
    if [[ "$SERVER_TYPE" == "router" ]]; then
        echo "   🌐 Starting router services..."
        echo "   (You'll need to create a router systemd service)"
        echo "   For now, you can run manually:"
        echo "   ENVIRONMENT=production uvicorn main:app --host 0.0.0.0 --port 443 --ssl-keyfile=... --ssl-certfile=..."
        
    elif [[ "$SERVER_TYPE" == "inference" ]]; then
        echo "   🧠 Starting inference services..."
        systemctl enable llama-inference-prod
        systemctl start llama-inference-prod
        echo "   ✅ Inference services started"
    fi
}

# Check service status
check_status() {
    echo ""
    echo "📊 Service Status:"
    echo "=================="
    
    # WireGuard status
    if systemctl is-active --quiet wg-quick@wg0 2>/dev/null; then
        echo "🔗 WireGuard: ✅ Active"
        ip addr show wg0 2>/dev/null | grep -E "inet|wg0:" || true
    else
        echo "🔗 WireGuard: ❌ Inactive"
    fi
    
    # Service-specific status
    if [[ "$SERVER_TYPE" == "router" ]]; then
        echo "🌐 Router: ⚠️  Manual startup required"
        
    elif [[ "$SERVER_TYPE" == "inference" ]]; then
        if systemctl is-active --quiet llama-inference-prod 2>/dev/null; then
            echo "🧠 Inference: ✅ Active"
        else
            echo "🧠 Inference: ❌ Inactive"
            echo "   Check logs: journalctl -u llama-inference-prod -f"
        fi
    fi
}

# Main execution
main() {
    create_users
    install_services
    setup_network
    start_services
    check_status
    
    echo ""
    echo "🎉 Production startup complete!"
    echo ""
    echo "📋 Next Steps:"
    if [[ "$SERVER_TYPE" == "router" ]]; then
        echo "1. Create a proper router systemd service"
        echo "2. Configure TLS certificates for HTTPS"
        echo "3. Test client connections"
    elif [[ "$SERVER_TYPE" == "inference" ]]; then
        echo "1. Verify inference service is running"
        echo "2. Test WireGuard connectivity from router"
        echo "3. Check mTLS connection works"
    fi
    
    echo ""
    echo "🔍 Monitoring:"
    echo "  journalctl -f  # All system logs"
    if [[ "$SERVER_TYPE" == "inference" ]]; then
        echo "  journalctl -u llama-inference-prod -f  # Inference logs"
    fi
    echo "  systemctl status wg-quick@wg0  # WireGuard status"
}

main "$@"