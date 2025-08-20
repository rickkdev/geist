#!/bin/bash

# Log Security Configuration Script
# Sets up secure logging policies, rotation, and retention

set -e

echo "📝 Setting up secure logging policies for LLM Router..."

# Ensure we're running as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ This script must be run as root"
    exit 1
fi

echo "🗂️  Configuring log directories and permissions..."

# Create secure log directories
mkdir -p /var/log/llm-router
mkdir -p /var/log/inference
mkdir -p /var/log/llm-security

# Set ownership and permissions
chown llm-router:llm-router /var/log/llm-router
chown inference:inference /var/log/inference  
chown root:adm /var/log/llm-security

# Secure permissions - logs should not be world-readable
chmod 750 /var/log/llm-router
chmod 750 /var/log/inference
chmod 750 /var/log/llm-security

echo "🔄 Configuring log rotation policies..."

# Configure logrotate for LLM Router logs
cat > /etc/logrotate.d/llm-router << 'EOF'
# LLM Router log rotation configuration
# Aggressive rotation to minimize data retention

/var/log/llm-router/*.log {
    # Rotate frequently to minimize data exposure
    daily
    rotate 3          # Keep only 3 days of logs
    compress
    delaycompress
    missingok
    notifempty
    
    # Secure permissions
    create 640 llm-router llm-router
    
    # Post-rotation cleanup
    postrotate
        # Signal service to reopen log files if needed
        if systemctl is-active llm-router-prod >/dev/null 2>&1; then
            systemctl reload llm-router-prod >/dev/null 2>&1 || true
        fi
        
        # Securely wipe old log files
        find /var/log/llm-router -name "*.log.*" -mtime +3 -exec shred -vfz -n 3 {} \; >/dev/null 2>&1 || true
    endscript
}

/var/log/inference/*.log {
    daily
    rotate 3          # Keep only 3 days
    compress
    delaycompress
    missingok
    notifempty
    
    create 640 inference inference
    
    postrotate
        if systemctl is-active llama-inference >/dev/null 2>&1; then
            systemctl reload llama-inference >/dev/null 2>&1 || true
        fi
        
        # Secure wipe of old inference logs
        find /var/log/inference -name "*.log.*" -mtime +3 -exec shred -vfz -n 3 {} \; >/dev/null 2>&1 || true
    endscript
}

# Security audit logs - keep slightly longer
/var/log/llm-security/*.log {
    weekly
    rotate 2          # Keep 2 weeks for security analysis
    compress
    delaycompress
    missingok
    notifempty
    
    create 640 root adm
    
    postrotate
        # Secure wipe of old security logs
        find /var/log/llm-security -name "*.log.*" -mtime +14 -exec shred -vfz -n 3 {} \; >/dev/null 2>&1 || true
    endscript
}
EOF

echo "🧹 Configuring automatic log cleanup..."

# Create secure log cleanup script
cat > /usr/local/bin/secure-log-cleanup.sh << 'EOF'
#!/bin/bash

# Secure Log Cleanup Script
# Automatically removes and securely wipes old log files

LOG_RETENTION_DAYS=3
SECURITY_LOG_RETENTION_DAYS=14

echo "🧹 Starting secure log cleanup..."

# Function to securely wipe files
secure_wipe() {
    local file="$1"
    if [ -f "$file" ]; then
        echo "   → Securely wiping: $file"
        shred -vfz -n 3 "$file" >/dev/null 2>&1
        rm -f "$file"
    fi
}

# Cleanup LLM Router logs
echo "📝 Cleaning LLM Router logs older than $LOG_RETENTION_DAYS days..."
find /var/log/llm-router -name "*.log*" -type f -mtime +$LOG_RETENTION_DAYS -print0 | \
    while IFS= read -r -d '' file; do
        secure_wipe "$file"
    done

# Cleanup inference logs  
echo "🧠 Cleaning inference logs older than $LOG_RETENTION_DAYS days..."
find /var/log/inference -name "*.log*" -type f -mtime +$LOG_RETENTION_DAYS -print0 | \
    while IFS= read -r -d '' file; do
        secure_wipe "$file"
    done

# Cleanup security logs (longer retention)
echo "🔒 Cleaning security logs older than $SECURITY_LOG_RETENTION_DAYS days..."
find /var/log/llm-security -name "*.log*" -type f -mtime +$SECURITY_LOG_RETENTION_DAYS -print0 | \
    while IFS= read -r -d '' file; do
        secure_wipe "$file"
    done

# Cleanup systemd journal logs
echo "📋 Cleaning systemd journal logs..."
journalctl --vacuum-time=7d --vacuum-size=100M >/dev/null 2>&1

# Cleanup temporary files that might contain sensitive data
echo "🗑️  Cleaning temporary files..."
find /tmp /var/tmp -name "*llm*" -o -name "*hpke*" -o -name "*inference*" -mtime +1 -exec secure_wipe {} \; 2>/dev/null || true

# Clean core dumps if any exist
echo "💥 Removing any core dumps..."
find /var/crash /var/lib/systemd/coredump -name "core*" -exec secure_wipe {} \; 2>/dev/null || true

echo "✅ Secure log cleanup completed"
EOF

chmod +x /usr/local/bin/secure-log-cleanup.sh

echo "⏰ Setting up automated cleanup schedule..."

# Add cron job for daily cleanup
cat > /etc/cron.d/llm-router-cleanup << 'EOF'
# LLM Router Secure Log Cleanup
# Runs daily at 2 AM to minimize data retention
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

0 2 * * * root /usr/local/bin/secure-log-cleanup.sh >/dev/null 2>&1
EOF

echo "🚫 Configuring syslog restrictions..."

# Configure rsyslog to not log sensitive applications
cat > /etc/rsyslog.d/99-llm-router-security.conf << 'EOF'
# LLM Router syslog security configuration
# Prevents sensitive data from appearing in general system logs

# Drop logs from LLM Router services to prevent data leakage
:programname, isequal, "llm-router" stop
:programname, isequal, "llama-inference" stop
:programname, isequal, "uvicorn" stop

# Drop logs containing sensitive keywords
:msg, contains, "encapsulated_key" stop
:msg, contains, "ciphertext" stop  
:msg, contains, "device_pubkey" stop
:msg, contains, "HPKE" stop

# This must be at the end
& stop
EOF

# Restart rsyslog to apply changes
systemctl restart rsyslog

echo "📊 Configuring systemd journal limits..."

# Configure systemd journal with restricted storage
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/llm-router-security.conf << 'EOF'
[Journal]
# Restrict journal storage to minimize data retention
SystemMaxUse=100M
SystemKeepFree=200M
SystemMaxFileSize=10M
SystemMaxFiles=10

# Shorter retention
MaxRetentionSec=7day

# Don't forward to syslog (we handle our own logging)
ForwardToSyslog=no

# Storage on disk only (more secure than volatile)
Storage=persistent

# Compression
Compress=yes

# Seal journals for integrity
Seal=yes
EOF

# Restart systemd-journald
systemctl restart systemd-journald

echo "🔍 Creating log monitoring script..."

# Create log monitoring script for security events
cat > /usr/local/bin/monitor-security-logs.sh << 'EOF'
#!/bin/bash

# Security Log Monitor
# Monitors logs for suspicious activity without exposing sensitive data

ALERT_LOG="/var/log/llm-security/security-alerts.log"

# Create security alert log if it doesn't exist
mkdir -p /var/log/llm-security
touch "$ALERT_LOG"
chown root:adm "$ALERT_LOG"
chmod 640 "$ALERT_LOG"

# Function to log security events
log_security_event() {
    local event_type="$1"
    local description="$2"
    local timestamp=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
    
    echo "[$timestamp] SECURITY_EVENT: $event_type - $description" >> "$ALERT_LOG"
}

# Monitor for failed authentication attempts
if journalctl --since "5 minutes ago" -u llm-router-prod | grep -i "unauthorized\|forbidden\|authentication failed" >/dev/null 2>&1; then
    log_security_event "AUTH_FAILURE" "Authentication failures detected in router service"
fi

# Monitor for rate limiting triggers
if journalctl --since "5 minutes ago" -u llm-router-prod | grep -i "rate limit\|too many requests" >/dev/null 2>&1; then
    log_security_event "RATE_LIMIT" "Rate limiting activated"
fi

# Monitor for circuit breaker activations
if journalctl --since "5 minutes ago" -u llm-router-prod | grep -i "circuit breaker\|service unavailable" >/dev/null 2>&1; then
    log_security_event "CIRCUIT_BREAKER" "Circuit breaker activated"
fi

# Monitor for suspicious file access
if find /etc/llm-router/keys -name "*.key" -newer /var/log/llm-security/.last-check 2>/dev/null | grep -q .; then
    log_security_event "KEY_ACCESS" "HPKE keys accessed"
fi

# Update check timestamp
touch /var/log/llm-security/.last-check

# Alert if security log is getting large (potential attack)
if [ -f "$ALERT_LOG" ] && [ $(stat -c%s "$ALERT_LOG") -gt 1048576 ]; then  # 1MB
    log_security_event "LOG_SIZE" "Security alert log growing rapidly"
fi
EOF

chmod +x /usr/local/bin/monitor-security-logs.sh

# Add security monitoring to cron (every 5 minutes)
cat > /etc/cron.d/llm-security-monitor << 'EOF'
# LLM Router Security Monitoring
*/5 * * * * root /usr/local/bin/monitor-security-logs.sh >/dev/null 2>&1
EOF

echo "🧪 Testing log security configuration..."

# Test log rotation
logrotate -f /etc/logrotate.d/llm-router

# Run initial cleanup
/usr/local/bin/secure-log-cleanup.sh

# Run initial security monitoring
/usr/local/bin/monitor-security-logs.sh

echo ""
echo "✅ Log security setup complete!"
echo ""
echo "🔧 Configuration applied:"
echo "   - Secure log directories with restricted permissions"
echo "   - Daily log rotation with 3-day retention"
echo "   - Automatic secure log cleanup with shredding"
echo "   - Systemd journal limits (100MB, 7-day retention)"
echo "   - Syslog filtering to prevent sensitive data leakage"
echo "   - Security event monitoring every 5 minutes"
echo ""
echo "📊 Log locations:"
echo "   - Application logs: /var/log/llm-router/"
echo "   - Inference logs: /var/log/inference/"  
echo "   - Security alerts: /var/log/llm-security/"
echo ""
echo "🔍 Management commands:"
echo "   - Manual cleanup: /usr/local/bin/secure-log-cleanup.sh"
echo "   - Security check: /usr/local/bin/monitor-security-logs.sh"
echo "   - View alerts: tail -f /var/log/llm-security/security-alerts.log"
echo ""