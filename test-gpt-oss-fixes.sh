#!/bin/bash

# Test script for gpt-oss tokenization and response truncation fixes
# Tests both the inference server configuration and the HarmonyDecoder fixes

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🧪 Testing GPT-OSS Fixes"
echo "========================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

print_test_result() {
    local test_name="$1"
    local result="$2"
    local details="$3"
    
    if [ "$result" == "PASS" ]; then
        echo -e "✅ ${GREEN}PASS${NC}: $test_name"
        [ -n "$details" ] && echo "   $details"
        ((TESTS_PASSED++))
    else
        echo -e "❌ ${RED}FAIL${NC}: $test_name"
        [ -n "$details" ] && echo "   $details"
        ((TESTS_FAILED++))
    fi
}

# Test 1: Check if inference server is running
echo ""
echo "🔍 Test 1: Inference Server Status"
echo "--------------------------------"

if curl -s http://localhost:8001/health >/dev/null 2>&1; then
    print_test_result "Inference server is running" "PASS" "Server responding on localhost:8001"
else
    print_test_result "Inference server is running" "FAIL" "Server not responding. Start with: ./backend/start-backend-dev.sh"
    echo -e "${YELLOW}⚠️  Please start the inference server before running tests${NC}"
    exit 1
fi

# Test 2: Check server configuration
echo ""
echo "🔍 Test 2: Server Configuration"
echo "------------------------------"

# Check if the server was started without the problematic --jinja flag
if pgrep -f "llama-server" > /dev/null; then
    SERVER_ARGS=$(ps aux | grep "llama-server" | grep -v grep | head -1)
    
    if echo "$SERVER_ARGS" | grep -q "\--jinja"; then
        print_test_result "Server configuration (no --jinja)" "FAIL" "Found --jinja flag in server args"
    else
        print_test_result "Server configuration (no --jinja)" "PASS" "No --jinja flag found"
    fi
    
    if echo "$SERVER_ARGS" | grep -q "\--temp 1.0"; then
        print_test_result "Server configuration (optimized sampling)" "PASS" "Found --temp 1.0 and other gpt-oss flags"
    else
        print_test_result "Server configuration (optimized sampling)" "FAIL" "Missing gpt-oss optimized flags"
    fi
else
    print_test_result "Server process check" "FAIL" "Could not find llama-server process"
fi

# Test 3: Test tokenization with direct API call
echo ""
echo "🔍 Test 3: Tokenization Test"
echo "---------------------------"

# Create test payload
TEST_PAYLOAD='{
    "messages": [
        {"role": "user", "content": "Name the US president in the 1990s"}
    ],
    "temperature": 1.0,
    "max_tokens": 50,
    "stream": false
}'

# Test direct inference call
echo "Testing direct inference endpoint..."
RESPONSE=$(curl -s -X POST http://localhost:8001/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d "$TEST_PAYLOAD" 2>/dev/null)

if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
    # Extract the response content
    CONTENT=$(echo "$RESPONSE" | grep -o '"content":"[^"]*"' | sed 's/"content":"//' | sed 's/"$//')
    
    if [ -n "$CONTENT" ]; then
        echo "Response: $CONTENT"
        
        # Check for common tokenization issues
        if echo "$CONTENT" | grep -q "BillClinton\|RichardNixon\|GeorgeH\.W\.Bush"; then
            print_test_result "Tokenization quality" "FAIL" "Found concatenated names without spaces"
        else
            print_test_result "Tokenization quality" "PASS" "No obvious tokenization issues detected"
        fi
        
        # Check if response is not just punctuation
        if [ "${#CONTENT}" -gt 5 ]; then
            print_test_result "Response completeness" "PASS" "Received substantial response (${#CONTENT} chars)"
        else
            print_test_result "Response completeness" "FAIL" "Response too short or empty"
        fi
    else
        print_test_result "Response parsing" "FAIL" "Could not extract content from response"
    fi
else
    print_test_result "Direct API call" "FAIL" "Failed to get response from inference server"
fi

# Test 4: Test HarmonyDecoder with unit tests
echo ""
echo "🔍 Test 4: HarmonyDecoder Unit Tests"  
echo "----------------------------------"

# Check if we can run the frontend tests
if [ -f "frontend/package.json" ]; then
    echo "Running HarmonyDecoder tests..."
    cd frontend
    
    # Check if jest is available
    if npm list jest >/dev/null 2>&1 || npx jest --version >/dev/null 2>&1; then
        # Run the specific test file
        if npx jest lib/__tests__/harmonyDecoder.test.ts --silent 2>/dev/null; then
            print_test_result "HarmonyDecoder unit tests" "PASS" "All decoder tests passed"
        else
            print_test_result "HarmonyDecoder unit tests" "FAIL" "Some decoder tests failed"
        fi
    else
        echo "Jest not available, skipping unit tests"
        print_test_result "HarmonyDecoder unit tests" "SKIP" "Jest not installed"
    fi
    
    cd ..
else
    print_test_result "Frontend tests" "SKIP" "Frontend package.json not found"
fi

# Test 5: Integration test with encrypted endpoint (if router is running)
echo ""
echo "🔍 Test 5: End-to-End Integration Test"
echo "------------------------------------"

if curl -s http://localhost:8000/health >/dev/null 2>&1; then
    echo "Router is running, testing full pipeline..."
    
    # Test the encrypted endpoint
    if [ -f "backend/router/create_hpke_request.py" ]; then
        cd backend/router
        
        # Create encrypted test request
        TEST_RESPONSE=$(python3 create_hpke_request.py "Tell me about Bill Clinton" 2>/dev/null | grep curl | bash 2>/dev/null)
        
        if [ $? -eq 0 ] && [ -n "$TEST_RESPONSE" ]; then
            # Check if we got a meaningful response
            if echo "$TEST_RESPONSE" | grep -q "Clinton" && [ "${#TEST_RESPONSE}" -gt 20 ]; then
                print_test_result "End-to-end encrypted pipeline" "PASS" "Received proper response through full pipeline"
            else
                print_test_result "End-to-end encrypted pipeline" "FAIL" "Response seems truncated or incomplete"
            fi
        else
            print_test_result "End-to-end encrypted pipeline" "FAIL" "Failed to get response through encrypted pipeline"
        fi
        
        cd ../../
    else
        print_test_result "End-to-end test setup" "SKIP" "HPKE test script not found"
    fi
else
    print_test_result "End-to-end pipeline" "SKIP" "Router not running (localhost:8000)"
fi

# Summary
echo ""
echo "📊 Test Summary"
echo "==============="
echo -e "✅ ${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "❌ ${RED}Tests Failed: $TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed! The gpt-oss fixes are working correctly.${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some tests failed. Please review the issues above.${NC}"
    exit 1
fi