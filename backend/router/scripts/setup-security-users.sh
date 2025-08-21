#!/bin/bash

# Security User Setup Script
# Creates dedicated users and groups for LLM Router services with minimal privileges

set -e

echo "🔒 Setting up security users and groups for LLM Router..."

# Ensure we're running as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ This script must be run as root"
    exit 1
fi

# Create system users and groups
echo "👥 Creating system users and groups..."

# Create llm-router group
if ! getent group llm-router >/dev/null 2>&1; then
    groupadd --system llm-router
    echo "   → Created group: llm-router"
else
    echo "   → Group already exists: llm-router"
fi

# Create inference group  
if ! getent group inference >/dev/null 2>&1; then
    groupadd --system inference
    echo "   → Created group: inference"
else
    echo "   → Group already exists: inference"
fi

# Create llm-router user
if ! id llm-router >/dev/null 2>&1; then
    useradd --system \
        --gid llm-router \
        --groups inference \
        --home-dir /var/lib/llm-router \
        --shell /usr/sbin/nologin \
        --comment "LLM Router service user" \
        llm-router
    echo "   → Created user: llm-router"
else
    echo "   → User already exists: llm-router"
    # Ensure user is in correct groups
    usermod -g llm-router -G inference llm-router
fi

# Create inference user
if ! id inference >/dev/null 2>&1; then
    useradd --system \
        --gid inference \
        --groups llm-router \
        --home-dir /var/lib/inference \
        --shell /usr/sbin/nologin \
        --comment "LLM Inference service user" \
        inference
    echo "   → Created user: inference"
else
    echo "   → User already exists: inference"
    # Ensure user is in correct groups
    usermod -g inference -G llm-router inference
fi

# Create necessary directories with proper ownership
echo "📁 Creating service directories with secure permissions..."

# Router directories
mkdir -p /etc/llm-router/{keys,certs,ca,config}
mkdir -p /var/lib/llm-router/{cache,state}
mkdir -p /var/log/llm-router
mkdir -p /run/llm-router

# Inference directories
mkdir -p /var/lib/inference/{models,cache}
mkdir -p /var/log/inference
mkdir -p /run/inference

# Set ownership and permissions for router directories
chown -R llm-router:llm-router /etc/llm-router
chown -R llm-router:llm-router /var/lib/llm-router
chown -R llm-router:llm-router /var/log/llm-router
chown -R llm-router:llm-router /run/llm-router

# Set ownership and permissions for inference directories
chown -R inference:inference /var/lib/inference
chown -R inference:inference /var/log/inference
chown -R inference:inference /run/inference

# Set secure permissions
chmod 750 /etc/llm-router
chmod 700 /etc/llm-router/keys      # Private keys - router only
chmod 750 /etc/llm-router/certs     # Certificates - router + inference
chmod 750 /etc/llm-router/ca        # CA certificates - router + inference
chmod 755 /etc/llm-router/config    # Config files - readable

chmod 750 /var/lib/llm-router
chmod 750 /var/lib/llm-router/cache
chmod 750 /var/lib/llm-router/state

chmod 750 /var/lib/inference
chmod 755 /var/lib/inference/models # Models can be readable
chmod 750 /var/lib/inference/cache

chmod 750 /var/log/llm-router
chmod 750 /var/log/inference

chmod 755 /run/llm-router
chmod 755 /run/inference

# Set up shared socket directory permissions
# This allows router to connect to inference socket
chgrp llm-router /run/inference
chmod 750 /run/inference

echo "🔐 Setting up secure file permissions..."

# Create tmpfiles.d configuration for runtime directories
cat > /etc/tmpfiles.d/llm-router.conf << 'EOF'
# LLM Router runtime directories
d /run/llm-router 0755 llm-router llm-router -
d /run/inference 0750 inference llm-router -

# Inference socket with proper permissions
# Socket will be created by inference service, accessible by router
EOF

echo "🛡️  Configuring sudo restrictions..."

# Create sudoers file for emergency access (very restricted)
cat > /etc/sudoers.d/llm-router << 'EOF'
# LLM Router emergency access - very restrictive
# Only allow specific commands for troubleshooting

# Router user can only restart its own service
llm-router ALL=(root) NOPASSWD: /bin/systemctl restart llm-router-prod
llm-router ALL=(root) NOPASSWD: /bin/systemctl status llm-router-prod
llm-router ALL=(root) NOPASSWD: /bin/journalctl -u llm-router-prod -n 50

# Inference user can only restart inference services
inference ALL=(root) NOPASSWD: /bin/systemctl restart llama-inference
inference ALL=(root) NOPASSWD: /bin/systemctl status llama-inference
inference ALL=(root) NOPASSWD: /bin/journalctl -u llama-inference -n 50

# No other sudo access allowed
EOF

# Set proper permissions on sudoers file
chmod 440 /etc/sudoers.d/llm-router

echo "🔍 Configuring security monitoring..."

# Create script to check user/permission integrity
cat > /usr/local/bin/check-llm-security.sh << 'EOF'
#!/bin/bash

# LLM Router Security Check Script
# Validates user permissions and directory security

check_user_security() {
    local user=$1
    local expected_shell="/usr/sbin/nologin"
    
    # Check if user exists
    if ! id "$user" >/dev/null 2>&1; then
        echo "❌ User $user does not exist"
        return 1
    fi
    
    # Check shell is nologin
    local shell=$(getent passwd "$user" | cut -d: -f7)
    if [ "$shell" != "$expected_shell" ]; then
        echo "⚠️  User $user has shell: $shell (expected: $expected_shell)"
    else
        echo "✅ User $user has secure shell"
    fi
    
    # Check home directory permissions
    local home=$(getent passwd "$user" | cut -d: -f6)
    if [ -d "$home" ]; then
        local perms=$(stat -c "%a" "$home")
        if [ "$perms" -gt 750 ]; then
            echo "⚠️  User $user home directory has loose permissions: $perms"
        else
            echo "✅ User $user home directory permissions secure: $perms"
        fi
    fi
}

echo "🔒 LLM Router Security Check"
echo "============================"

# Check users
check_user_security "llm-router"
check_user_security "inference"

# Check critical directory permissions
echo ""
echo "📁 Directory Security Check:"

check_dir_perms() {
    local dir=$1
    local expected_owner=$2
    local max_perms=$3
    
    if [ -d "$dir" ]; then
        local owner=$(stat -c "%U:%G" "$dir")
        local perms=$(stat -c "%a" "$dir")
        
        if [ "$owner" != "$expected_owner" ]; then
            echo "⚠️  $dir owner: $owner (expected: $expected_owner)"
        else
            echo "✅ $dir ownership correct: $owner"
        fi
        
        if [ "$perms" -gt "$max_perms" ]; then
            echo "⚠️  $dir permissions too open: $perms (max: $max_perms)"
        else
            echo "✅ $dir permissions secure: $perms"
        fi
    else
        echo "❌ Directory missing: $dir"
    fi
}

check_dir_perms "/etc/llm-router/keys" "llm-router:llm-router" 700
check_dir_perms "/var/lib/llm-router" "llm-router:llm-router" 750
check_dir_perms "/var/lib/inference" "inference:inference" 750
check_dir_perms "/run/inference" "inference:llm-router" 750

# Check if swap is disabled
echo ""
echo "💾 Memory Security Check:"
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
    echo "✅ Swap is disabled"
else
    echo "⚠️  Swap is enabled - this may leak sensitive data"
fi

# Check kernel security parameters
echo ""
echo "⚙️  Kernel Security Parameters:"
check_sysctl() {
    local param=$1
    local expected=$2
    local current=$(sysctl -n "$param" 2>/dev/null || echo "unknown")
    
    if [ "$current" = "$expected" ]; then
        echo "✅ $param = $current"
    else
        echo "⚠️  $param = $current (expected: $expected)"
    fi
}

check_sysctl "vm.swappiness" "1"
check_sysctl "fs.suid_dumpable" "0"
check_sysctl "kernel.dmesg_restrict" "1"
check_sysctl "kernel.kptr_restrict" "2"
EOF

chmod +x /usr/local/bin/check-llm-security.sh

echo "🧪 Running initial security check..."
/usr/local/bin/check-llm-security.sh

echo ""
echo "✅ Security users and groups setup complete!"
echo ""
echo "👥 Created users:"
echo "   - llm-router (router service user)"
echo "   - inference (inference service user)"
echo ""
echo "📁 Created secure directories:"
echo "   - /etc/llm-router/ (configuration)"
echo "   - /var/lib/llm-router/ (persistent data)" 
echo "   - /var/lib/inference/ (models and cache)"
echo "   - /run/llm-router/ (runtime files)"
echo "   - /run/inference/ (sockets)"
echo ""
echo "🔧 Next steps:"
echo "   1. Update systemd services to use these users"
echo "   2. Configure memory security settings"
echo "   3. Set up systemd sandboxing"
echo ""