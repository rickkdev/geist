#!/bin/bash

# Load Testing Automation Script for LLM Router
# Supports both k6 and Locust load testing frameworks

set -e

# Configuration
DEFAULT_TARGET_URL="http://localhost:8000"
DEFAULT_DURATION="10m"
DEFAULT_VUS="50"
DEFAULT_RPS="10"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check server health
check_server_health() {
    local url="$1"
    print_status "Checking server health at $url..."
    
    if curl -s -f "$url/health" > /dev/null; then
        print_success "Server is healthy and ready for testing"
        return 0
    else
        print_error "Server health check failed. Is the server running at $url?"
        return 1
    fi
}

# Function to run k6 load tests
run_k6_tests() {
    local target_url="$1"
    local duration="$2"
    local vus="$3"
    local test_type="$4"
    
    print_status "Running k6 load tests..."
    print_status "Target URL: $target_url"
    print_status "Duration: $duration"
    print_status "Virtual Users: $vus"
    print_status "Test Type: $test_type"
    
    # Create results directory
    mkdir -p "results/k6"
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local results_file="results/k6/k6_results_${test_type}_${timestamp}.json"
    local html_report="results/k6/k6_report_${test_type}_${timestamp}.html"
    
    # Set k6 options based on test type
    local k6_options=""
    case "$test_type" in
        "smoke")
            k6_options="--vus 1 --duration 1m"
            ;;
        "load")
            k6_options="--vus $vus --duration $duration"
            ;;
        "stress")
            k6_options="--vus $((vus * 2)) --duration $duration"
            ;;
        "spike")
            k6_options="--vus 1 --duration 2m --vus $((vus * 3)) --duration 1m --vus $vus --duration 2m"
            ;;
        *)
            k6_options="--vus $vus --duration $duration"
            ;;
    esac
    
    # Run k6 test
    BASE_URL="$target_url" k6 run \
        $k6_options \
        --out json="$results_file" \
        --summary-trend-stats="avg,min,med,max,p(95),p(99)" \
        tests/load/k6-load-test.js
    
    # Generate HTML report if jq is available
    if command_exists jq; then
        print_status "Generating HTML report..."
        generate_k6_html_report "$results_file" "$html_report"
    fi
    
    print_success "k6 test completed. Results saved to $results_file"
}

# Function to run Locust load tests
run_locust_tests() {
    local target_url="$1"
    local duration="$2"
    local users="$3"
    local spawn_rate="$4"
    local test_type="$5"
    
    print_status "Running Locust load tests..."
    print_status "Target URL: $target_url"
    print_status "Duration: $duration"
    print_status "Users: $users"
    print_status "Spawn Rate: $spawn_rate/sec"
    print_status "Test Type: $test_type"
    
    # Create results directory
    mkdir -p "results/locust"
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local html_report="results/locust/locust_report_${test_type}_${timestamp}.html"
    local csv_prefix="results/locust/locust_${test_type}_${timestamp}"
    
    # Select user class based on test type
    local user_class="LLMRouterUser"
    if [ "$test_type" = "stress" ]; then
        user_class="StressTestUser"
    fi
    
    # Run Locust test
    locust -f tests/load/locust-load-test.py \
        --host="$target_url" \
        --headless \
        -u "$users" \
        -r "$spawn_rate" \
        -t "$duration" \
        --html="$html_report" \
        --csv="$csv_prefix" \
        --print-stats \
        "$user_class"
    
    print_success "Locust test completed. Report saved to $html_report"
}

# Function to generate k6 HTML report
generate_k6_html_report() {
    local json_file="$1"
    local html_file="$2"
    
    cat > "$html_file" << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>k6 Load Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .metric { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
        .pass { background-color: #d4edda; }
        .fail { background-color: #f8d7da; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>k6 Load Test Report</h1>
    <p><strong>Generated:</strong> $(date)</p>
    
    <h2>Test Summary</h2>
    <div id="summary">
        <!-- Summary will be populated by JavaScript -->
    </div>
    
    <h2>Detailed Metrics</h2>
    <div id="metrics">
        <!-- Metrics will be populated by JavaScript -->
    </div>
    
    <script>
        // Load and display k6 results
        // This would need to be enhanced with actual JSON parsing
        document.getElementById('summary').innerHTML = '<p>Test completed successfully. Check console for detailed results.</p>';
    </script>
</body>
</html>
EOF
}

# Function to run comprehensive test suite
run_comprehensive_tests() {
    local target_url="$1"
    local tool="$2"
    
    print_status "Running comprehensive test suite with $tool..."
    
    # Test sequence: smoke -> load -> stress -> spike
    local tests=("smoke" "load" "stress" "spike")
    
    for test_type in "${tests[@]}"; do
        print_status "Starting $test_type test..."
        
        # Wait between tests
        if [ "$test_type" != "smoke" ]; then
            print_status "Waiting 60 seconds before next test..."
            sleep 60
        fi
        
        case "$tool" in
            "k6")
                case "$test_type" in
                    "smoke")
                        run_k6_tests "$target_url" "1m" "1" "$test_type"
                        ;;
                    "load")
                        run_k6_tests "$target_url" "5m" "10" "$test_type"
                        ;;
                    "stress")
                        run_k6_tests "$target_url" "5m" "20" "$test_type"
                        ;;
                    "spike")
                        run_k6_tests "$target_url" "3m" "30" "$test_type"
                        ;;
                esac
                ;;
            "locust")
                case "$test_type" in
                    "smoke")
                        run_locust_tests "$target_url" "1m" "1" "1" "$test_type"
                        ;;
                    "load")
                        run_locust_tests "$target_url" "5m" "10" "2" "$test_type"
                        ;;
                    "stress")
                        run_locust_tests "$target_url" "5m" "20" "5" "$test_type"
                        ;;
                    "spike")
                        run_locust_tests "$target_url" "3m" "30" "10" "$test_type"
                        ;;
                esac
                ;;
        esac
        
        print_success "$test_type test completed"
    done
}

# Function to display usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS] COMMAND

Load testing script for LLM Router

COMMANDS:
    k6          Run k6 load tests
    locust      Run Locust load tests
    both        Run both k6 and Locust tests
    comprehensive   Run comprehensive test suite
    health      Check server health only

OPTIONS:
    -u, --url URL           Target URL (default: $DEFAULT_TARGET_URL)
    -d, --duration TIME     Test duration (default: $DEFAULT_DURATION)
    -v, --vus NUMBER        Virtual users for k6 (default: $DEFAULT_VUS)
    -r, --rate NUMBER       Spawn rate for Locust (default: $DEFAULT_RPS)
    -t, --type TYPE         Test type: smoke, load, stress, spike (default: load)
    -h, --help              Show this help message

EXAMPLES:
    $0 k6                                   # Run k6 with defaults
    $0 locust -u http://localhost:8000     # Run Locust with custom URL
    $0 both -d 5m -v 100                   # Run both tools for 5 minutes with 100 VUs
    $0 comprehensive -t k6                  # Run comprehensive test suite with k6
    $0 health -u http://prod-server.com    # Check production server health

PREREQUISITES:
    - k6 installed (https://k6.io/docs/getting-started/installation/)
    - Python 3 with locust installed (pip install locust)
    - LLM Router server running at target URL
EOF
}

# Parse command line arguments
TARGET_URL="$DEFAULT_TARGET_URL"
DURATION="$DEFAULT_DURATION"
VUS="$DEFAULT_VUS"
SPAWN_RATE="$DEFAULT_RPS"
TEST_TYPE="load"
COMMAND=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--url)
            TARGET_URL="$2"
            shift 2
            ;;
        -d|--duration)
            DURATION="$2"
            shift 2
            ;;
        -v|--vus)
            VUS="$2"
            shift 2
            ;;
        -r|--rate)
            SPAWN_RATE="$2"
            shift 2
            ;;
        -t|--type)
            TEST_TYPE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        k6|locust|both|comprehensive|health)
            COMMAND="$1"
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Validate command
if [ -z "$COMMAND" ]; then
    print_error "No command specified"
    usage
    exit 1
fi

# Main execution
print_status "LLM Router Load Testing Script"
print_status "Target URL: $TARGET_URL"

# Check server health for all commands except 'health'
if [ "$COMMAND" != "health" ]; then
    if ! check_server_health "$TARGET_URL"; then
        exit 1
    fi
fi

# Execute command
case "$COMMAND" in
    "health")
        check_server_health "$TARGET_URL"
        ;;
    "k6")
        if ! command_exists k6; then
            print_error "k6 is not installed. Please install k6 first."
            exit 1
        fi
        run_k6_tests "$TARGET_URL" "$DURATION" "$VUS" "$TEST_TYPE"
        ;;
    "locust")
        if ! command_exists locust; then
            print_error "Locust is not installed. Please install with: pip install locust"
            exit 1
        fi
        run_locust_tests "$TARGET_URL" "$DURATION" "$VUS" "$SPAWN_RATE" "$TEST_TYPE"
        ;;
    "both")
        if command_exists k6; then
            run_k6_tests "$TARGET_URL" "$DURATION" "$VUS" "$TEST_TYPE"
            print_status "Waiting 2 minutes between test tools..."
            sleep 120
        else
            print_warning "k6 not found, skipping k6 tests"
        fi
        
        if command_exists locust; then
            run_locust_tests "$TARGET_URL" "$DURATION" "$VUS" "$SPAWN_RATE" "$TEST_TYPE"
        else
            print_warning "Locust not found, skipping Locust tests"
        fi
        ;;
    "comprehensive")
        if [ "$TEST_TYPE" = "k6" ]; then
            if ! command_exists k6; then
                print_error "k6 is not installed"
                exit 1
            fi
            run_comprehensive_tests "$TARGET_URL" "k6"
        elif [ "$TEST_TYPE" = "locust" ]; then
            if ! command_exists locust; then
                print_error "Locust is not installed"
                exit 1
            fi
            run_comprehensive_tests "$TARGET_URL" "locust"
        else
            print_error "For comprehensive tests, specify -t k6 or -t locust"
            exit 1
        fi
        ;;
    *)
        print_error "Invalid command: $COMMAND"
        usage
        exit 1
        ;;
esac

print_success "Load testing completed successfully!"