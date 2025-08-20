#!/bin/bash

# Security Validation Script
# Comprehensive security audit and validation for LLM Router

set -e

echo "🛡️  LLM Router Security Validation"
echo "=================================="

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters for results
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNINGS=0

# Function to log results
log_check() {
    local status=$1
    local message=$2
    local details=$3
    
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    
    case $status in
        "PASS")
            echo -e "${GREEN}✅ PASS${NC}: $message"
            [ -n "$details" ] && echo -e "   ${BLUE}→${NC} $details"
            PASSED_CHECKS=$((PASSED_CHECKS + 1))
            ;;
        "FAIL")
            echo -e "${RED}❌ FAIL${NC}: $message"
            [ -n "$details" ] && echo -e "   ${RED}→${NC} $details"
            FAILED_CHECKS=$((FAILED_CHECKS + 1))
            ;;
        "WARN")
            echo -e "${YELLOW}⚠️  WARN${NC}: $message"
            [ -n "$details" ] && echo -e "   ${YELLOW}→${NC} $details"
            WARNINGS=$((WARNINGS + 1))
            ;;
    esac
}

echo ""
echo "👥 User and Permission Security"
echo "------------------------------"

# Check if security users exist
for user in llm-router inference; do
    if id "$user" >/dev/null 2>&1; then
        shell=$(getent passwd "$user" | cut -d: -f7)
        if [ "$shell" = "/usr/sbin/nologin" ]; then
            log_check "PASS" "User $user exists with secure shell" "$shell"
        else
            log_check "FAIL" "User $user has insecure shell" "$shell"
        fi
    else
        log_check "FAIL" "Security user $user does not exist"
    fi
done

# Check directory permissions
echo ""
echo "📁 Directory Security"
echo "-------------------"

check_directory_security() {
    local dir=$1
    local expected_owner=$2
    local max_perms=$3
    local description=$4
    
    if [ -d "$dir" ]; then
        local owner=$(stat -c "%U:%G" "$dir" 2>/dev/null)
        local perms=$(stat -c "%a" "$dir" 2>/dev/null)
        
        if [ "$owner" = "$expected_owner" ]; then
            if [ "$perms" -le "$max_perms" ]; then
                log_check "PASS" "$description directory secure" "owner: $owner, perms: $perms"
            else
                log_check "FAIL" "$description directory permissions too open" "perms: $perms (max: $max_perms)"
            fi
        else
            log_check "FAIL" "$description directory wrong owner" "actual: $owner, expected: $expected_owner"
        fi
    else
        log_check "WARN" "$description directory does not exist" "$dir"
    fi
}

check_directory_security "/etc/llm-router/keys" "llm-router:llm-router" 700 "HPKE keys"
check_directory_security "/var/lib/llm-router" "llm-router:llm-router" 750 "Router data"
check_directory_security "/var/lib/inference" "inference:inference" 750 "Inference data"
check_directory_security "/var/log/llm-router" "llm-router:llm-router" 750 "Router logs"

echo ""
echo "💾 Memory Security"
echo "----------------"

# Check swap status
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
    log_check "PASS" "Swap is disabled"
else
    log_check "FAIL" "Swap is active - may leak sensitive data"
fi

# Check kernel security parameters
check_sysctl() {
    local param=$1
    local expected=$2
    local description=$3
    
    local current=$(sysctl -n "$param" 2>/dev/null || echo "unknown")
    
    if [ "$current" = "$expected" ]; then
        log_check "PASS" "$description" "$param = $current"
    else
        log_check "FAIL" "$description incorrect" "actual: $current, expected: $expected"
    fi
}

check_sysctl "vm.swappiness" "0" "Swap prevention"
check_sysctl "fs.suid_dumpable" "0" "Core dump security"
check_sysctl "kernel.dmesg_restrict" "1" "Kernel log protection"
check_sysctl "kernel.randomize_va_space" "2" "ASLR enabled"

echo ""
echo "⚙️  Systemd Service Security"
echo "---------------------------"

# Check if hardened services exist
check_systemd_service() {
    local service=$1
    local description=$2
    
    if systemctl cat "$service" >/dev/null 2>&1; then
        log_check "PASS" "$description service exists"
        
        # Check for key security features
        if systemctl cat "$service" | grep -q "NoNewPrivileges=yes"; then
            log_check "PASS" "$description has NoNewPrivileges"
        else
            log_check "FAIL" "$description missing NoNewPrivileges"
        fi
        
        if systemctl cat "$service" | grep -q "PrivateTmp=yes"; then
            log_check "PASS" "$description has PrivateTmp"
        else
            log_check "WARN" "$description missing PrivateTmp"
        fi
        
        if systemctl cat "$service" | grep -q "ProtectSystem=strict"; then
            log_check "PASS" "$description has ProtectSystem=strict"
        else
            log_check "WARN" "$description missing ProtectSystem=strict"
        fi
        
    else
        log_check "WARN" "$description service not found" "May not be deployed yet"
    fi
}

check_systemd_service "llm-router-hardened" "Router"
check_systemd_service "llama-inference-hardened" "Inference"

echo ""
echo "🔒 Logging Security"
echo "-----------------"

# Check log directory permissions
check_directory_security "/var/log/llm-router" "llm-router:llm-router" 750 "Application logs"
check_directory_security "/var/log/llm-security" "root:adm" 750 "Security logs"

# Check if log rotation is configured
if [ -f "/etc/logrotate.d/llm-router" ]; then
    log_check "PASS" "Log rotation configured"
else
    log_check "WARN" "Log rotation not configured"
fi

# Check for log cleanup script
if [ -x "/usr/local/bin/secure-log-cleanup.sh" ]; then
    log_check "PASS" "Secure log cleanup script exists"
else
    log_check "WARN" "Secure log cleanup script missing"
fi

echo ""
echo "🌐 Network Security"
echo "------------------"

# Check firewall status
if command -v ufw >/dev/null 2>&1; then
    if ufw status | grep -q "Status: active"; then
        log_check "PASS" "UFW firewall is active"
    else
        log_check "WARN" "UFW firewall is inactive"
    fi
else
    log_check "WARN" "UFW firewall not installed"
fi

# Check for open ports
open_ports=$(ss -tlnp | grep -E ':(443|8000|8001)' | wc -l)
if [ "$open_ports" -le 3 ]; then
    log_check "PASS" "Reasonable number of open ports" "$open_ports ports"
else
    log_check "WARN" "Many open ports detected" "$open_ports ports"
fi

echo ""
echo "🔑 Cryptographic Security"
echo "------------------------"

# Check if HPKE keys exist with proper permissions
for key_file in "/etc/llm-router/keys/hpke-private.key" "/etc/llm-router/keys/hpke-public.key" "./dev-keys/hpke-private.key" "./dev-keys/hpke-public.key"; do
    if [ -f "$key_file" ]; then
        perms=$(stat -c "%a" "$key_file" 2>/dev/null)
        owner=$(stat -c "%U" "$key_file" 2>/dev/null)
        
        if [[ "$key_file" == *"private"* ]]; then
            if [ "$perms" = "600" ]; then
                log_check "PASS" "Private key permissions secure" "$key_file ($perms)"
            else
                log_check "FAIL" "Private key permissions too open" "$key_file ($perms)"
            fi
        else
            if [ "$perms" = "644" ] || [ "$perms" = "600" ]; then
                log_check "PASS" "Public key permissions secure" "$key_file ($perms)"
            else
                log_check "WARN" "Public key permissions unusual" "$key_file ($perms)"
            fi
        fi
    fi
done

echo ""
echo "💥 Core Dump Security"
echo "--------------------"

# Check for core dumps
core_files=$(find /var/crash /var/lib/systemd/coredump /tmp /var/tmp -name "core*" -o -name "*.crash" 2>/dev/null | wc -l)
if [ "$core_files" -eq 0 ]; then
    log_check "PASS" "No core dump files found"
else
    log_check "FAIL" "Core dump files present" "$core_files files found"
fi

echo ""
echo "📋 Process Security"
echo "------------------"

# Check if services are running as correct users
check_process_user() {
    local process_name=$1
    local expected_user=$2
    
    if pgrep -f "$process_name" >/dev/null 2>&1; then
        local actual_user=$(ps -o user= -p $(pgrep -f "$process_name" | head -1) 2>/dev/null)
        if [ "$actual_user" = "$expected_user" ]; then
            log_check "PASS" "$process_name running as correct user" "$expected_user"
        else
            log_check "FAIL" "$process_name running as wrong user" "actual: $actual_user, expected: $expected_user"
        fi
    else
        log_check "WARN" "$process_name not currently running"
    fi
}

check_process_user "uvicorn.*main:app" "llm-router"
check_process_user "llama-server" "inference"

echo ""
echo "📊 Security Summary"
echo "==================="

# Calculate percentages
if [ $TOTAL_CHECKS -gt 0 ]; then
    PASS_PERCENT=$((PASSED_CHECKS * 100 / TOTAL_CHECKS))
    FAIL_PERCENT=$((FAILED_CHECKS * 100 / TOTAL_CHECKS))
    WARN_PERCENT=$((WARNINGS * 100 / TOTAL_CHECKS))
else
    PASS_PERCENT=0
    FAIL_PERCENT=0
    WARN_PERCENT=0
fi

echo -e "Total Checks: $TOTAL_CHECKS"
echo -e "${GREEN}Passed: $PASSED_CHECKS ($PASS_PERCENT%)${NC}"
echo -e "${RED}Failed: $FAILED_CHECKS ($FAIL_PERCENT%)${NC}" 
echo -e "${YELLOW}Warnings: $WARNINGS ($WARN_PERCENT%)${NC}"

echo ""
if [ $FAILED_CHECKS -eq 0 ]; then
    echo -e "${GREEN}🎉 Security validation completed successfully!${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠️  Address warnings for optimal security.${NC}"
    fi
    exit 0
else
    echo -e "${RED}❌ Security validation failed with $FAILED_CHECKS critical issues.${NC}"
    echo -e "${RED}🚨 System is NOT ready for production deployment!${NC}"
    exit 1
fi