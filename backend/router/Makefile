# LLM Router Testing Makefile
# Provides convenient commands for running tests, linting, and other development tasks

.PHONY: help test test-unit test-integration test-load test-security test-all
.PHONY: lint type-check format coverage clean install dev-install
.PHONY: start-dev start-prod health check-deps benchmark quick

# Default target
.DEFAULT_GOAL := help

# Colors for output
BLUE := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
RESET := \033[0m

# Project configuration
PYTHON := python3
PIP := pip3
UV := uv
PYTEST := pytest
RUFF := ruff
MYPY := mypy

# Test configuration
TEST_RUNNER := tests/run_tests.py
LOAD_TEST_SCRIPT := tests/load/run-load-tests.sh
SERVER_URL := http://localhost:8000
COVERAGE_DIR := tests/coverage

help: ## Show this help message
	@echo "$(BLUE)LLM Router Testing Commands$(RESET)"
	@echo ""
	@echo "$(YELLOW)Installation:$(RESET)"
	@echo "  install         Install production dependencies"
	@echo "  dev-install     Install development dependencies"
	@echo "  check-deps      Check if all dependencies are installed"
	@echo ""
	@echo "$(YELLOW)Code Quality:$(RESET)"
	@echo "  lint            Run linting with ruff"
	@echo "  format          Format code with ruff"
	@echo "  type-check      Run type checking with mypy"
	@echo ""
	@echo "$(YELLOW)Testing:$(RESET)"
	@echo "  test            Run all tests (equivalent to test-all)"
	@echo "  test-unit       Run unit tests only"
	@echo "  test-integration Run integration tests only"
	@echo "  test-security   Run security tests only"
	@echo "  test-load       Run load tests with k6"
	@echo "  test-all        Run complete test suite"
	@echo "  quick           Run quick test suite (lint + unit tests)"
	@echo "  benchmark       Run performance benchmark tests"
	@echo ""
	@echo "$(YELLOW)Coverage:$(RESET)"
	@echo "  coverage        Generate coverage report"
	@echo "  coverage-html   Generate HTML coverage report"
	@echo ""
	@echo "$(YELLOW)Server Management:$(RESET)"
	@echo "  start-dev       Start development server"
	@echo "  start-prod      Start production server"
	@echo "  health          Check server health"
	@echo ""
	@echo "$(YELLOW)Utilities:$(RESET)"
	@echo "  clean           Clean up generated files"
	@echo "  help            Show this help message"

# Installation targets
install: ## Install production dependencies
	@echo "$(BLUE)Installing production dependencies...$(RESET)"
	$(UV) sync --no-dev

dev-install: ## Install development dependencies
	@echo "$(BLUE)Installing development dependencies...$(RESET)"
	$(UV) sync

check-deps: ## Check if all dependencies are installed
	@echo "$(BLUE)Checking dependencies...$(RESET)"
	@$(PYTHON) $(TEST_RUNNER) unit --no-coverage > /dev/null 2>&1 && \
		echo "$(GREEN)✓ All dependencies are installed$(RESET)" || \
		(echo "$(RED)✗ Missing dependencies. Run 'make dev-install'$(RESET)" && exit 1)

# Code quality targets
lint: ## Run linting with ruff
	@echo "$(BLUE)Running linting...$(RESET)"
	$(RUFF) check . --fix
	@echo "$(GREEN)✓ Linting completed$(RESET)"

format: ## Format code with ruff
	@echo "$(BLUE)Formatting code...$(RESET)"
	$(RUFF) format .
	@echo "$(GREEN)✓ Code formatted$(RESET)"

type-check: ## Run type checking with mypy
	@echo "$(BLUE)Running type checking...$(RESET)"
	$(MYPY) services/ models.py config.py main.py \
		--ignore-missing-imports --no-strict-optional
	@echo "$(GREEN)✓ Type checking completed$(RESET)"

# Testing targets
test: test-all ## Run all tests

test-unit: ## Run unit tests only
	@echo "$(BLUE)Running unit tests...$(RESET)"
	$(PYTHON) $(TEST_RUNNER) unit --verbose

test-integration: ## Run integration tests only
	@echo "$(BLUE)Running integration tests...$(RESET)"
	$(PYTHON) $(TEST_RUNNER) integration --verbose

test-security: ## Run security tests only
	@echo "$(BLUE)Running security tests...$(RESET)"
	$(PYTHON) $(TEST_RUNNER) security --verbose

test-load: health ## Run load tests with k6
	@echo "$(BLUE)Running load tests...$(RESET)"
	$(LOAD_TEST_SCRIPT) k6 -d 2m -v 20 -t smoke

test-load-locust: health ## Run load tests with Locust
	@echo "$(BLUE)Running load tests with Locust...$(RESET)"
	$(LOAD_TEST_SCRIPT) locust -d 2m -u 20 -r 5 -t smoke

test-all: ## Run complete test suite
	@echo "$(BLUE)Running complete test suite...$(RESET)"
	$(PYTHON) $(TEST_RUNNER) all --verbose

quick: ## Run quick test suite (lint + unit tests)
	@echo "$(BLUE)Running quick test suite...$(RESET)"
	$(PYTHON) $(TEST_RUNNER) quick --verbose

benchmark: ## Run performance benchmark tests
	@echo "$(BLUE)Running benchmark tests...$(RESET)"
	$(PYTHON) $(TEST_RUNNER) benchmark

# Coverage targets
coverage: ## Generate coverage report
	@echo "$(BLUE)Generating coverage report...$(RESET)"
	$(PYTHON) $(TEST_RUNNER) coverage

coverage-html: ## Generate HTML coverage report
	@echo "$(BLUE)Generating HTML coverage report...$(RESET)"
	$(PYTEST) --cov=services --cov=models --cov=config \
		--cov-report=html:$(COVERAGE_DIR) --cov-report=term-missing
	@echo "$(GREEN)✓ HTML coverage report generated in $(COVERAGE_DIR)/$(RESET)"
	@echo "Open $(COVERAGE_DIR)/index.html in your browser"

# Server management targets
start-dev: ## Start development server
	@echo "$(BLUE)Starting development server...$(RESET)"
	./start-dev.sh

start-prod: ## Start production server
	@echo "$(BLUE)Starting production server...$(RESET)"
	./start-prod.sh

health: ## Check server health
	@echo "$(BLUE)Checking server health...$(RESET)"
	@curl -s -f $(SERVER_URL)/health > /dev/null && \
		echo "$(GREEN)✓ Server is healthy$(RESET)" || \
		(echo "$(RED)✗ Server is not responding at $(SERVER_URL)$(RESET)" && \
		 echo "Start server with: make start-dev" && exit 1)

# Utility targets
clean: ## Clean up generated files
	@echo "$(BLUE)Cleaning up generated files...$(RESET)"
	rm -rf $(COVERAGE_DIR)
	rm -rf tests/results
	rm -rf .pytest_cache
	rm -rf __pycache__
	rm -rf .mypy_cache
	rm -rf .ruff_cache
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete
	find . -type f -name ".coverage" -delete
	@echo "$(GREEN)✓ Cleanup completed$(RESET)"

# CI/CD simulation targets
ci-test: ## Simulate CI/CD test pipeline
	@echo "$(BLUE)Simulating CI/CD pipeline...$(RESET)"
	@echo "$(YELLOW)Step 1: Dependencies$(RESET)"
	@make check-deps
	@echo ""
	@echo "$(YELLOW)Step 2: Code Quality$(RESET)"
	@make lint
	@make type-check
	@echo ""
	@echo "$(YELLOW)Step 3: Unit Tests$(RESET)"
	@make test-unit
	@echo ""
	@echo "$(YELLOW)Step 4: Integration Tests$(RESET)"
	@make test-integration
	@echo ""
	@echo "$(YELLOW)Step 5: Security Tests$(RESET)"
	@make test-security
	@echo ""
	@echo "$(GREEN)✓ CI/CD simulation completed successfully$(RESET)"

# Load testing variants
test-load-comprehensive: health ## Run comprehensive load test suite
	@echo "$(BLUE)Running comprehensive load tests...$(RESET)"
	$(LOAD_TEST_SCRIPT) comprehensive -t k6

test-load-stress: health ## Run stress tests
	@echo "$(BLUE)Running stress tests...$(RESET)"
	$(LOAD_TEST_SCRIPT) k6 -d 5m -v 100 -t stress

test-load-spike: health ## Run spike tests
	@echo "$(BLUE)Running spike tests...$(RESET)"
	$(LOAD_TEST_SCRIPT) k6 -d 3m -v 200 -t spike

# Development workflow targets
dev-check: ## Run development pre-commit checks
	@echo "$(BLUE)Running development checks...$(RESET)"
	@make format
	@make lint
	@make type-check
	@make test-unit
	@echo "$(GREEN)✓ Development checks completed$(RESET)"

test-watch: ## Run tests in watch mode (requires entr)
	@echo "$(BLUE)Running tests in watch mode...$(RESET)"
	@echo "$(YELLOW)Watching for changes... (Ctrl+C to stop)$(RESET)"
	find . -name "*.py" | entr -c make test-unit

# Documentation targets
test-docs: ## Test documentation examples
	@echo "$(BLUE)Testing documentation examples...$(RESET)"
	@echo "$(YELLOW)This would test code examples in documentation$(RESET)"

# Security-specific targets
test-security-full: ## Run comprehensive security tests
	@echo "$(BLUE)Running comprehensive security tests...$(RESET)"
	@make test-security
	# Add additional security tools here (bandit, safety, etc.)

# Performance testing
test-performance: ## Run performance tests
	@echo "$(BLUE)Running performance tests...$(RESET)"
	$(PYTEST) tests/ -m "performance" --benchmark-only

# Report generation
generate-reports: ## Generate all test reports
	@echo "$(BLUE)Generating all test reports...$(RESET)"
	@make coverage-html
	@make test-load
	@echo "$(GREEN)✓ All reports generated$(RESET)"
	@echo "Coverage report: $(COVERAGE_DIR)/index.html"
	@echo "Load test results: tests/load/results/"

# Help for specific test categories
help-testing: ## Show detailed testing help
	@echo "$(BLUE)LLM Router Testing Guide$(RESET)"
	@echo ""
	@echo "$(YELLOW)Test Categories:$(RESET)"
	@echo "  Unit Tests:        Test individual components in isolation"
	@echo "  Integration Tests: Test complete workflows end-to-end"
	@echo "  Security Tests:    Test security mechanisms and protections"
	@echo "  Load Tests:        Test performance under various load conditions"
	@echo ""
	@echo "$(YELLOW)Test Execution Order:$(RESET)"
	@echo "  1. make lint type-check    # Code quality checks"
	@echo "  2. make test-unit          # Fast unit tests"
	@echo "  3. make test-integration   # Slower integration tests"
	@echo "  4. make test-security      # Security validation"
	@echo "  5. make test-load          # Performance testing"
	@echo ""
	@echo "$(YELLOW)Development Workflow:$(RESET)"
	@echo "  make dev-check    # Quick pre-commit checks"
	@echo "  make quick        # Fast feedback loop"
	@echo "  make test-all     # Full validation before push"

.PHONY: ci-test test-load-comprehensive test-load-stress test-load-spike
.PHONY: dev-check test-watch test-docs test-security-full test-performance
.PHONY: generate-reports help-testing coverage-html