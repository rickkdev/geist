#!/bin/bash

# Memory Security Configuration Script
# Configures kernel parameters and memory protections to prevent data leakage

set -e

echo "🛡️  Setting up memory security for LLM Router..."

# Ensure we're running as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ This script must be run as root"
    exit 1
fi

# Backup current configuration
BACKUP_DIR="/var/backups/llm-router-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo "📋 Creating configuration backup in $BACKUP_DIR"

# Backup existing configs
[ -f /etc/sysctl.conf ] && cp /etc/sysctl.conf "$BACKUP_DIR/"
[ -f /etc/fstab ] && cp /etc/fstab "$BACKUP_DIR/"
[ -f /etc/security/limits.conf ] && cp /etc/security/limits.conf "$BACKUP_DIR/"

echo "💾 Configuring swap protection..."

# Disable swap immediately
echo "   → Disabling active swap..."
swapoff -a

# Remove swap from fstab to prevent re-enabling on boot
echo "   → Removing swap entries from /etc/fstab..."
sed -i '/\bswap\b/d' /etc/fstab

# Verify swap is disabled
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
    echo "   ✅ Swap successfully disabled"
else
    echo "   ⚠️  Warning: Swap still active"
    swapon --show
fi

echo "⚙️  Configuring kernel security parameters..."

# Create comprehensive sysctl configuration
cat > /etc/sysctl.d/99-llm-router-security.conf << 'EOF'
# LLM Router Security Configuration
# Prevents sensitive data leakage and hardens system

# Memory protection
vm.swappiness=0                    # Minimize swapping (but allow emergency swap)
vm.vfs_cache_pressure=50          # Reduce cache pressure to avoid swapping
vm.dirty_ratio=5                  # Reduce dirty memory threshold
vm.dirty_background_ratio=2       # Background writeback threshold

# Prevent core dumps (could contain sensitive data)
fs.suid_dumpable=0                # Disable core dumps for setuid programs
kernel.core_pattern=|/bin/false   # Disable core dumps entirely

# Kernel information restrictions
kernel.dmesg_restrict=1           # Restrict dmesg access to root
kernel.kptr_restrict=2            # Hide kernel pointers completely
kernel.printk=3 3 3 3            # Reduce kernel log verbosity

# Network security
net.core.bpf_jit_harden=2         # Harden BPF JIT compiler
net.ipv4.conf.all.log_martians=1 # Log suspicious packets
net.ipv4.conf.default.log_martians=1
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.default.send_redirects=0
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.default.accept_redirects=0
net.ipv6.conf.all.accept_redirects=0
net.ipv6.conf.default.accept_redirects=0

# Process restrictions
fs.protected_hardlinks=1          # Prevent hardlink attacks
fs.protected_symlinks=1           # Prevent symlink attacks
fs.protected_fifos=2              # FIFO protection
fs.protected_regular=2            # Regular file protection

# Randomization
kernel.randomize_va_space=2       # Enable full ASLR
EOF

echo "   → Applied comprehensive sysctl configuration"

echo "🔒 Configuring process limits..."

# Configure limits for LLM Router users
cat > /etc/security/limits.d/llm-router.conf << 'EOF'
# LLM Router Security Limits

# Core dumps disabled
llm-router    hard    core         0
inference     hard    core         0

# Memory locking limits (for HPKE keys and model data)
llm-router    hard    memlock      67108864  # 64MB for HPKE keys
llm-router    soft    memlock      67108864
inference     hard    memlock      17179869184  # 16GB for models
inference     soft    memlock      17179869184

# Process limits
llm-router    hard    nproc        2048
llm-router    soft    nproc        1024
inference     hard    nproc        1024  
inference     soft    nproc        512

# File descriptor limits
llm-router    hard    nofile       8192
llm-router    soft    nofile       4096
inference     hard    nofile       4096
inference     soft    nofile       2048

# CPU time limits (prevent runaway processes)
llm-router    hard    cpu          3600  # 1 hour
inference     hard    cpu          7200  # 2 hours

# Memory limits (virtual memory)
llm-router    hard    as           8589934592   # 8GB
inference     hard    as           34359738368  # 32GB for model loading
EOF

echo "   → Applied process security limits"

echo "🧠 Configuring memory locking capabilities..."

# Update systemd service to use memory locking
# This will be handled by the systemd services we created

# Create memory security validation script
cat > /usr/local/bin/validate-memory-security.sh << 'EOF'
#!/bin/bash

# Memory Security Validation Script
# Checks that memory security configurations are active

echo "🛡️  Memory Security Validation"
echo "============================="

# Check swap status
echo ""
echo "💾 Swap Status:"
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
    echo "✅ Swap is disabled"
else
    echo "❌ Swap is active (security risk):"
    swapon --show
fi

# Check key sysctl parameters
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

check_sysctl "vm.swappiness" "0"
check_sysctl "fs.suid_dumpable" "0" 
check_sysctl "kernel.dmesg_restrict" "1"
check_sysctl "kernel.kptr_restrict" "2"
check_sysctl "kernel.randomize_va_space" "2"

# Check process limits
echo ""
echo "📊 Process Limits:"
for user in llm-router inference; do
    if id "$user" >/dev/null 2>&1; then
        echo "User: $user"
        echo "  Core dumps: $(sudo -u "$user" bash -c 'ulimit -Hc')"
        echo "  Memory lock: $(sudo -u "$user" bash -c 'ulimit -Hl')"
        echo "  Processes: $(sudo -u "$user" bash -c 'ulimit -Hu')"
        echo "  Files: $(sudo -u "$user" bash -c 'ulimit -Hn')"
    fi
done

# Check for any core dumps
echo ""
echo "💥 Core Dump Check:"
core_files=$(find /var/crash /var/lib/systemd/coredump /tmp /var/tmp -name "core*" -o -name "*.crash" 2>/dev/null | wc -l)
if [ "$core_files" -eq 0 ]; then
    echo "✅ No core dump files found"
else
    echo "⚠️  Found $core_files core dump files"
fi

# Check memory usage
echo ""
echo "📈 Memory Usage:"
free -h
echo ""
echo "🔍 Memory Security Summary:"
if [ "$(swapon --show | wc -l)" -eq 0 ] && [ "$(sysctl -n vm.swappiness)" = "0" ]; then
    echo "✅ Memory security properly configured"
else
    echo "⚠️  Memory security needs attention"
fi
EOF

chmod +x /usr/local/bin/validate-memory-security.sh

echo "📝 Applying configuration changes..."

# Apply sysctl changes immediately
sysctl -p /etc/sysctl.d/99-llm-router-security.conf

echo "🧪 Running memory security validation..."
/usr/local/bin/validate-memory-security.sh

echo ""
echo "✅ Memory security setup complete!"
echo ""
echo "🔧 Configuration changes made:"
echo "   - Swap completely disabled"
echo "   - Kernel hardening parameters applied"
echo "   - Process limits configured for service users"
echo "   - Memory locking enabled for sensitive data"
echo "   - Core dumps disabled"
echo "   - ASLR and other randomization enabled"
echo ""
echo "⚠️  Important notes:"
echo "   - Changes are persistent across reboots"
echo "   - Run validate-memory-security.sh to check status"
echo "   - Backup created in: $BACKUP_DIR"
echo ""
echo "🚀 Next steps:"
echo "   1. Deploy hardened systemd services"
echo "   2. Configure logging restrictions"
echo "   3. Test memory locking in applications"
echo ""