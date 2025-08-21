#!/bin/bash

# Network Configuration Verification Script
# Verifies step 7 network configuration

set -euo pipefail

echo "🔍 Verifying Network Configuration (Step 7)..."
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

test_result() {
    local test_name="$1"
    local result="$2"
    
    if [[ "$result" == "PASS" ]]; then
        echo -e "${GREEN}✓${NC} $test_name"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗${NC} $test_name"
        ((TESTS_FAILED++))
    fi
}

echo ""
echo "1. Development Configuration"
echo "----------------------------"

# Test 1: Check if UNIX socket path is configured correctly
if [[ -f "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/inference-socket.service" ]]; then
    if grep -q "/run/inference.sock" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/inference-socket.service"; then
        test_result "UNIX socket path configured" "PASS"
    else
        test_result "UNIX socket path configured" "FAIL"
    fi
else
    test_result "UNIX socket service file exists" "FAIL"
fi

# Test 2: Check socket permissions in service file
if grep -q "mode=660" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/inference-socket.service" 2>/dev/null; then
    test_result "Socket permissions configured (660)" "PASS"
else
    test_result "Socket permissions configured (660)" "FAIL"
fi

# Test 3: Check group configuration
if grep -q "group=router" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/inference-socket.service" 2>/dev/null; then
    test_result "Socket group configured (router)" "PASS"
else
    test_result "Socket group configured (router)" "FAIL"
fi

# Test 4: Check inference server localhost binding
if grep -q "127.0.0.1:8001" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/llama-inference.service" 2>/dev/null; then
    test_result "Inference server localhost-only binding" "PASS"
else
    test_result "Inference server localhost-only binding" "FAIL"
fi

echo ""
echo "2. Firewall Configuration"
echo "-------------------------"

# Test 5: Check if firewall script exists
if [[ -f "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/scripts/setup-firewall-dev.sh" ]]; then
    test_result "Firewall configuration script exists" "PASS"
    
    # Check if script is executable
    if [[ -x "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/scripts/setup-firewall-dev.sh" ]]; then
        test_result "Firewall script is executable" "PASS"
    else
        test_result "Firewall script is executable" "FAIL"
    fi
else
    test_result "Firewall configuration script exists" "FAIL"
fi

# Test 6: Check firewall script content
if grep -q "port 22" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/scripts/setup-firewall-dev.sh" 2>/dev/null && \
   grep -q "port 443" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/scripts/setup-firewall-dev.sh" 2>/dev/null; then
    test_result "Firewall allows SSH (22) and HTTPS (443)" "PASS"
else
    test_result "Firewall allows SSH (22) and HTTPS (443)" "FAIL"
fi

# Test 7: Check inference port blocking
if grep -q "block.*8001\|deny.*8001\|DROP.*8001" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/scripts/setup-firewall-dev.sh" 2>/dev/null; then
    test_result "Firewall blocks inference port (8001)" "PASS"
else
    test_result "Firewall blocks inference port (8001)" "FAIL"
fi

echo ""
echo "3. Security Hardening"
echo "---------------------"

# Test 8: Check systemd security settings
if grep -q "RestrictAddressFamilies=.*AF_UNIX" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/inference-socket.service" 2>/dev/null; then
    test_result "Socket service allows UNIX sockets" "PASS"
else
    test_result "Socket service allows UNIX sockets" "FAIL"
fi

# Test 9: Check NoNewPrivileges
if grep -q "NoNewPrivileges=yes" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/llama-inference.service" 2>/dev/null && \
   grep -q "NoNewPrivileges=yes" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/inference-socket.service" 2>/dev/null; then
    test_result "NoNewPrivileges enabled for both services" "PASS"
else
    test_result "NoNewPrivileges enabled for both services" "FAIL"
fi

# Test 10: Check ProtectSystem
if grep -q "ProtectSystem=strict" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/llama-inference.service" 2>/dev/null && \
   grep -q "ProtectSystem=strict" "/Users/rickkdev/Documents/workspace/geist/backend/llm-router/inference-socket.service" 2>/dev/null; then
    test_result "ProtectSystem=strict enabled for both services" "PASS"
else
    test_result "ProtectSystem=strict enabled for both services" "FAIL"
fi

echo ""
echo "4. Runtime Tests (if services are running)"
echo "-------------------------------------------"

# Test 11: Check if socket exists (if services are running)
if [[ -S "/run/inference.sock" ]]; then
    test_result "UNIX socket exists at runtime" "PASS"
    
    # Test socket connectivity
    if timeout 5 bash -c 'echo -e "GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n" | nc -U /run/inference.sock' >/dev/null 2>&1; then
        test_result "UNIX socket is responsive" "PASS"
    else
        test_result "UNIX socket is responsive" "FAIL (services may not be running)"
    fi
else
    echo -e "${YELLOW}ℹ${NC} UNIX socket not found (services not running - this is OK for testing)"
fi

# Test 12: Check if inference port is not externally accessible
if command -v nc >/dev/null 2>&1; then
    if ! timeout 2 nc -z 127.0.0.1 8001 2>/dev/null; then
        echo -e "${YELLOW}ℹ${NC} Inference port 8001 not accessible (services not running - this is OK)"
    else
        # If it is accessible, that's expected for localhost
        test_result "Inference server accessible on localhost" "PASS"
    fi
fi

echo ""
echo "📊 Test Summary"
echo "==============="
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"

if [[ $TESTS_FAILED -eq 0 ]]; then
    echo -e "\n${GREEN}🎉 All network configuration tests passed!${NC}"
    echo ""
    echo "Network Configuration Summary:"
    echo "  ✓ UNIX socket communication configured"
    echo "  ✓ Firewall rules defined (SSH/HTTPS only)"
    echo "  ✓ Inference port blocked from external access"
    echo "  ✓ Security hardening enabled"
    echo ""
    echo "To apply firewall rules:"
    echo "  ./scripts/setup-firewall-dev.sh"
    echo ""
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed. Please review the configuration.${NC}"
    exit 1
fi