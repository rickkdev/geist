#!/bin/bash

# Production Network Configuration with WireGuard
# Step 7.2: WireGuard setup for router-inference communication

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔧 Setting up WireGuard for Production Network"
echo "=============================================="

# Check if we're running as root (required for WireGuard setup)
if [[ $EUID -ne 0 ]]; then
    echo "❌ This script must be run as root for WireGuard configuration"
    echo "Please run: sudo $0 $*"
    exit 1
fi

# Configuration variables
WG_INTERFACE="wg0"
WG_CONFIG_DIR="/etc/wireguard"
ROUTER_WG_IP="10.0.0.1/24"
INFERENCE_WG_IP="10.0.0.2/24"
WG_PORT="51820"

# Server type detection
SERVER_TYPE=""
if [[ -f "/tmp/.server_type" ]]; then
    SERVER_TYPE=$(cat /tmp/.server_type)
else
    echo "Server type (router/inference): "
    read -r SERVER_TYPE
    echo "$SERVER_TYPE" > /tmp/.server_type
fi

case "$SERVER_TYPE" in
    router|inference)
        echo "Configuring $SERVER_TYPE server..."
        ;;
    *)
        echo "❌ Invalid server type. Must be 'router' or 'inference'"
        exit 1
        ;;
esac

# Install WireGuard if not already installed
install_wireguard() {
    echo "📦 Installing WireGuard..."
    
    if command -v apt-get >/dev/null 2>&1; then
        # Debian/Ubuntu
        apt-get update
        apt-get install -y wireguard wireguard-tools
    elif command -v dnf >/dev/null 2>&1; then
        # Fedora/RHEL 8+
        dnf install -y wireguard-tools
    elif command -v yum >/dev/null 2>&1; then
        # CentOS/RHEL 7
        yum install -y epel-release
        yum install -y wireguard-tools
    else
        echo "❌ Unsupported package manager. Please install WireGuard manually."
        exit 1
    fi
}

# Generate WireGuard keys
generate_keys() {
    local key_name="$1"
    local private_key_file="$WG_CONFIG_DIR/${key_name}_private.key"
    local public_key_file="$WG_CONFIG_DIR/${key_name}_public.key"
    
    echo "🔑 Generating keys for $key_name..."
    
    # Create config directory
    mkdir -p "$WG_CONFIG_DIR"
    
    # Generate private key
    wg genkey > "$private_key_file"
    chmod 600 "$private_key_file"
    
    # Generate public key
    wg pubkey < "$private_key_file" > "$public_key_file"
    chmod 644 "$public_key_file"
    
    echo "Keys generated:"
    echo "  Private: $private_key_file"
    echo "  Public:  $public_key_file"
}

# Configure router server
setup_router() {
    echo "🌐 Configuring router server..."
    
    # Generate router keys
    generate_keys "router"
    
    # Create WireGuard config
    cat > "$WG_CONFIG_DIR/$WG_INTERFACE.conf" << EOF
[Interface]
Address = $ROUTER_WG_IP
ListenPort = $WG_PORT
PrivateKey = $(cat "$WG_CONFIG_DIR/router_private.key")

# Enable IP forwarding
PostUp = echo 1 > /proc/sys/net/ipv4/ip_forward
PostUp = iptables -A FORWARD -i $WG_INTERFACE -j ACCEPT
PostUp = iptables -A FORWARD -o $WG_INTERFACE -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE

PostDown = iptables -D FORWARD -i $WG_INTERFACE -j ACCEPT
PostDown = iptables -D FORWARD -o $WG_INTERFACE -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

# Peer configuration will be added after inference server setup
EOF

    echo "Router WireGuard configuration created."
    echo ""
    echo "🔑 Router public key (share with inference servers):"
    cat "$WG_CONFIG_DIR/router_public.key"
    echo ""
    echo "Next steps:"
    echo "1. Configure inference server(s) with this script"
    echo "2. Add inference server peers to router config"
    echo "3. Start WireGuard: systemctl enable --now wg-quick@$WG_INTERFACE"
}

# Configure inference server
setup_inference() {
    echo "🧠 Configuring inference server..."
    
    # Generate inference keys
    generate_keys "inference"
    
    echo "Please provide the router's public key:"
    read -r ROUTER_PUBLIC_KEY
    
    echo "Router's WireGuard endpoint (IP:port, e.g., router.example.com:51820):"
    read -r ROUTER_ENDPOINT
    
    # Create WireGuard config
    cat > "$WG_CONFIG_DIR/$WG_INTERFACE.conf" << EOF
[Interface]
Address = $INFERENCE_WG_IP
PrivateKey = $(cat "$WG_CONFIG_DIR/inference_private.key")

[Peer]
PublicKey = $ROUTER_PUBLIC_KEY
Endpoint = $ROUTER_ENDPOINT
AllowedIPs = 10.0.0.1/32
PersistentKeepalive = 25
EOF

    echo "Inference WireGuard configuration created."
    echo ""
    echo "🔑 Inference public key (add to router config):"
    cat "$WG_CONFIG_DIR/inference_public.key"
    echo ""
    echo "Add this peer block to router's $WG_CONFIG_DIR/$WG_INTERFACE.conf:"
    echo ""
    echo "[Peer]"
    echo "PublicKey = $(cat "$WG_CONFIG_DIR/inference_public.key")"
    echo "AllowedIPs = 10.0.0.2/32"
    echo ""
}

# Set up systemd service
setup_systemd() {
    echo "⚙️ Setting up systemd service..."
    
    # Enable and start WireGuard
    systemctl enable wg-quick@$WG_INTERFACE
    
    echo "WireGuard systemd service configured."
    echo "Start with: systemctl start wg-quick@$WG_INTERFACE"
}

# Configure firewall for production
setup_production_firewall() {
    echo "🔥 Configuring production firewall..."
    
    if [[ "$SERVER_TYPE" == "router" ]]; then
        # Router firewall rules
        cat > /tmp/pf.prod.router.conf << EOF
# Production firewall rules for router server
set skip on lo0

# Block all by default
block all

# Allow outbound connections
pass out all

# Allow SSH, HTTPS, and WireGuard
pass in inet proto tcp from any to any port 22
pass in inet proto tcp from any to any port 443
pass in inet proto udp from any to any port $WG_PORT

# Allow WireGuard interface traffic
pass in on $WG_INTERFACE all
pass out on $WG_INTERFACE all

# Allow ICMP
pass inet proto icmp all

# Block inference port from external (only allow via WireGuard)
block in inet proto tcp from ! 10.0.0.0/24 to any port 8001
EOF
        
        echo "Router firewall rules created at /tmp/pf.prod.router.conf"
        
    elif [[ "$SERVER_TYPE" == "inference" ]]; then
        # Inference server firewall rules
        cat > /tmp/pf.prod.inference.conf << EOF
# Production firewall rules for inference server
set skip on lo0

# Block all by default
block all

# Allow outbound connections
pass out all

# Allow SSH and WireGuard only
pass in inet proto tcp from any to any port 22
pass in inet proto udp from any to any port $WG_PORT

# Allow WireGuard interface traffic
pass in on $WG_INTERFACE all
pass out on $WG_INTERFACE all

# Allow inference port only from WireGuard network
pass in inet proto tcp from 10.0.0.0/24 to any port 8001

# Block inference port from external networks
block in inet proto tcp from ! 10.0.0.0/24 to any port 8001

# Allow ICMP
pass inet proto icmp all
EOF
        
        echo "Inference firewall rules created at /tmp/pf.prod.inference.conf"
    fi
}

# Main execution
main() {
    echo "Starting WireGuard setup for $SERVER_TYPE server..."
    
    # Check if WireGuard is installed
    if ! command -v wg >/dev/null 2>&1; then
        install_wireguard
    fi
    
    # Set up based on server type
    case "$SERVER_TYPE" in
        router)
            setup_router
            ;;
        inference)
            setup_inference
            ;;
    esac
    
    setup_systemd
    setup_production_firewall
    
    echo ""
    echo "✅ WireGuard configuration complete!"
    echo ""
    echo "Next steps:"
    echo "1. Review configuration: $WG_CONFIG_DIR/$WG_INTERFACE.conf"
    echo "2. Start WireGuard: systemctl start wg-quick@$WG_INTERFACE"
    echo "3. Test connectivity: ping 10.0.0.1 (from inference) or ping 10.0.0.2 (from router)"
    echo "4. Apply firewall rules: pfctl -f /tmp/pf.prod.$SERVER_TYPE.conf -e"
    echo ""
    echo "Security notes:"
    echo "- All traffic between router and inference is encrypted via WireGuard"
    echo "- Inference port (8001) only accessible via WireGuard network"
    echo "- Each server has unique key pairs for authentication"
    echo ""
}

main "$@"