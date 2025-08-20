#!/bin/bash

# Network Configuration for Development Environment
# Step 7.1: Firewall rules for development

set -euo pipefail

echo "Setting up development firewall rules..."

# Check if we're on macOS or Linux
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Configuring macOS firewall (pfctl)..."
    
    # Create pfctl rules file for development
    cat > /tmp/pf.dev.conf << 'EOF'
# Development firewall rules for LLM router
# Allow only SSH (22) and HTTPS (443) from external

# Skip loopback interface
set skip on lo0

# Block all by default
block all

# Allow outbound connections
pass out all

# Allow SSH (22) and HTTPS (443) inbound
pass in inet proto tcp from any to any port 22
pass in inet proto tcp from any to any port 443

# Allow ICMP (ping)
pass inet proto icmp all

# Block local inference port from external access
# (inference server binds to 127.0.0.1:8001, but extra protection)
block in inet proto tcp from any to any port 8001

# Allow internal loopback communication
pass in on lo0 all
pass out on lo0 all
EOF

    echo "Firewall rules created at /tmp/pf.dev.conf"
    echo "To activate: sudo pfctl -f /tmp/pf.dev.conf -e"
    echo "To check status: sudo pfctl -s all"
    echo "To disable: sudo pfctl -d"

elif [[ -f /etc/debian_version ]] || [[ -f /etc/redhat-release ]]; then
    echo "Configuring Linux firewall (iptables/ufw)..."
    
    # Check if ufw is available (Ubuntu/Debian)
    if command -v ufw >/dev/null 2>&1; then
        echo "Using UFW (Uncomplicated Firewall)..."
        
        # Reset UFW to defaults
        sudo ufw --force reset
        
        # Set default policies
        sudo ufw default deny incoming
        sudo ufw default allow outgoing
        
        # Allow SSH
        sudo ufw allow 22/tcp comment "SSH"
        
        # Allow HTTPS
        sudo ufw allow 443/tcp comment "HTTPS"
        
        # Explicitly block inference port from external
        sudo ufw deny 8001/tcp comment "Block inference port"
        
        # Enable UFW
        sudo ufw --force enable
        
        echo "UFW firewall configured and enabled"
        sudo ufw status verbose
        
    else
        echo "Using iptables directly..."
        
        # Backup existing rules
        sudo iptables-save > /tmp/iptables.backup.$(date +%Y%m%d_%H%M%S)
        
        # Flush existing rules
        sudo iptables -F
        sudo iptables -X
        sudo iptables -t nat -F
        sudo iptables -t nat -X
        
        # Set default policies
        sudo iptables -P INPUT DROP
        sudo iptables -P FORWARD DROP
        sudo iptables -P OUTPUT ACCEPT
        
        # Allow loopback
        sudo iptables -A INPUT -i lo -j ACCEPT
        
        # Allow established and related connections
        sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
        
        # Allow SSH
        sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
        
        # Allow HTTPS
        sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
        
        # Explicitly block inference port (extra protection)
        sudo iptables -A INPUT -p tcp --dport 8001 -j DROP
        
        # Save rules (varies by distribution)
        if command -v iptables-save >/dev/null 2>&1; then
            if [[ -d /etc/iptables ]]; then
                sudo iptables-save > /etc/iptables/rules.v4
            elif [[ -f /etc/sysconfig/iptables ]]; then
                sudo iptables-save > /etc/sysconfig/iptables
            fi
        fi
        
        echo "iptables rules configured"
        sudo iptables -L -n -v
    fi
    
else
    echo "Unsupported operating system: $OSTYPE"
    exit 1
fi

echo ""
echo "Development firewall configuration complete!"
echo ""
echo "Ports allowed:"
echo "  - 22/tcp  (SSH)"
echo "  - 443/tcp (HTTPS)"
echo ""
echo "Ports blocked:"
echo "  - 8001/tcp (Inference server - internal only)"
echo "  - All others (default deny)"
echo ""
echo "Network configuration:"
echo "  - Router ⇄ Inference: UNIX socket (/run/inference.sock)"
echo "  - Client ⇄ Router: HTTPS (443)"
echo ""