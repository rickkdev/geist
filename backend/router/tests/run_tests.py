#!/usr/bin/env python3
"""
Test runner script for LLM Router testing pipeline.

Provides a comprehensive test execution interface with various
test categories, reporting options, and configuration management.
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path
from typing import List


class TestRunner:
    """Manages test execution for the LLM Router project."""

    def __init__(self):
        self.project_root = Path(__file__).parent.parent
        self.test_dir = self.project_root / "tests"

    def run_command(
        self, cmd: List[str], capture_output: bool = False
    ) -> subprocess.CompletedProcess:
        """Run a command and return the result."""
        # Use uv run for python commands
        if cmd[0] in ["pytest", "ruff", "mypy", "coverage"]:
            cmd = ["uv", "run"] + cmd

        print(f"Running: {' '.join(cmd)}")

        if capture_output:
            return subprocess.run(
                cmd, capture_output=True, text=True, cwd=self.project_root
            )
        else:
            return subprocess.run(cmd, cwd=self.project_root)

    def check_dependencies(self) -> bool:
        """Check if required testing dependencies are installed."""
        dependencies = [
            ("pytest", "uv run pytest --version"),
            ("coverage", "uv run coverage --version"),
            ("ruff", "uv run ruff --version"),
            ("mypy", "uv run mypy --version"),
        ]

        missing = []
        for name, cmd in dependencies:
            try:
                result = subprocess.run(
                    cmd.split(), capture_output=True, text=True, cwd=self.project_root
                )
                if result.returncode != 0:
                    missing.append(name)
            except FileNotFoundError:
                missing.append(name)

        if missing:
            print(f"❌ Missing dependencies: {', '.join(missing)}")
            print("Install with: uv sync --dev")
            return False

        print("✅ All testing dependencies are available")
        return True

    def run_linting(self) -> bool:
        """Run code linting with ruff."""
        print("🧹 Running code linting...")

        # Run ruff check on our source code only (exclude external dependencies)
        result = self.run_command(
            [
                "ruff",
                "check",
                "main.py",
                "config.py",
                "models.py",
                "services/",
                "middleware/",
                "tests/",
                "--fix",
            ]
        )
        if result.returncode != 0:
            print("❌ Linting failed")
            return False

        # Run ruff format check
        result = self.run_command(
            [
                "ruff",
                "format",
                "main.py",
                "config.py",
                "models.py",
                "services/",
                "middleware/",
                "tests/",
                "--check",
            ]
        )
        if result.returncode != 0:
            print("❌ Formatting check failed")
            return False

        print("✅ Linting passed")
        return True

    def run_type_checking(self) -> bool:
        """Run type checking with mypy."""
        print("🔍 Running type checking...")

        result = self.run_command(
            [
                "mypy",
                "services/",
                "models.py",
                "config.py",
                "main.py",
                "--ignore-missing-imports",
                "--no-strict-optional",
            ]
        )

        if result.returncode != 0:
            print("❌ Type checking failed")
            return False

        print("✅ Type checking passed")
        return True

    def run_unit_tests(self, verbose: bool = False, coverage: bool = True) -> bool:
        """Run unit tests."""
        print("🧪 Running unit tests...")

        cmd = ["pytest", "tests/test_hpke_unit.py", "-m", "unit or not integration"]

        if verbose:
            cmd.append("-v")

        if coverage:
            cmd.extend(
                [
                    "--cov=services",
                    "--cov=models",
                    "--cov=config",
                    "--cov-report=term-missing",
                ]
            )

        result = self.run_command(cmd)

        if result.returncode != 0:
            print("❌ Unit tests failed")
            return False

        print("✅ Unit tests passed")
        return True

    def run_integration_tests(self, verbose: bool = False) -> bool:
        """Run integration tests."""
        print("🔗 Running integration tests...")

        cmd = ["pytest", "tests/test_integration_e2e.py", "-m", "integration"]

        if verbose:
            cmd.append("-v")

        result = self.run_command(cmd)

        if result.returncode != 0:
            print("❌ Integration tests failed")
            return False

        print("✅ Integration tests passed")
        return True

    def run_security_tests(self, verbose: bool = False) -> bool:
        """Run security-focused tests."""
        print("🔐 Running security tests...")

        cmd = ["pytest", "-m", "security"]

        if verbose:
            cmd.append("-v")

        result = self.run_command(cmd)

        if result.returncode != 0:
            print("❌ Security tests failed")
            return False

        print("✅ Security tests passed")
        return True

    def run_load_tests(self, tool: str = "k6", duration: str = "2m") -> bool:
        """Run load tests."""
        print(f"📈 Running load tests with {tool}...")

        # Check if server is running
        health_check = self.run_command(
            ["curl", "-s", "-f", "http://localhost:8000/health"], capture_output=True
        )

        if health_check.returncode != 0:
            print("❌ Server not running at http://localhost:8000")
            print("Start server with: uvicorn main:app --reload --port 8000")
            return False

        # Run load tests
        script_path = self.test_dir / "load" / "run-load-tests.sh"
        cmd = [str(script_path), tool, "-d", duration, "-t", "smoke"]

        result = self.run_command(cmd)

        if result.returncode != 0:
            print("❌ Load tests failed")
            return False

        print("✅ Load tests passed")
        return True

    def run_all_tests(self, quick: bool = False, verbose: bool = False) -> bool:
        """Run the complete test suite."""
        print("🚀 Running complete test suite...")

        start_time = time.time()

        # Check dependencies first
        if not self.check_dependencies():
            return False

        # Run tests in order
        test_stages = [
            ("Linting", lambda: self.run_linting()),
            ("Type Checking", lambda: self.run_type_checking()),
            ("Unit Tests", lambda: self.run_unit_tests(verbose=verbose)),
        ]

        if not quick:
            test_stages.extend(
                [
                    (
                        "Integration Tests",
                        lambda: self.run_integration_tests(verbose=verbose),
                    ),
                    (
                        "Security Tests",
                        lambda: self.run_security_tests(verbose=verbose),
                    ),
                ]
            )

        failed_stages = []
        for stage_name, stage_func in test_stages:
            print(f"\n{'=' * 50}")
            print(f"Running {stage_name}")
            print(f"{'=' * 50}")

            if not stage_func():
                failed_stages.append(stage_name)
                if not quick:  # In quick mode, continue on failure
                    break

        # Summary
        elapsed = time.time() - start_time
        print(f"\n{'=' * 50}")
        print("Test Suite Summary")
        print(f"{'=' * 50}")
        print(f"Duration: {elapsed:.2f} seconds")

        if failed_stages:
            print(f"❌ Failed stages: {', '.join(failed_stages)}")
            return False
        else:
            print("✅ All tests passed!")
            return True

    def generate_coverage_report(self) -> bool:
        """Generate detailed coverage report."""
        print("📊 Generating coverage report...")

        # Run tests with coverage
        result = self.run_command(
            [
                "pytest",
                "--cov=services",
                "--cov=models",
                "--cov=config",
                "--cov-report=html:tests/coverage",
                "--cov-report=term-missing",
                "--cov-report=xml",
            ]
        )

        if result.returncode != 0:
            print("❌ Coverage report generation failed")
            return False

        print("✅ Coverage report generated in tests/coverage/")
        return True

    def run_benchmark_tests(self) -> bool:
        """Run performance benchmark tests."""
        print("⚡ Running benchmark tests...")

        cmd = ["pytest", "tests/", "-m", "benchmark", "--benchmark-only"]

        result = self.run_command(cmd)

        if result.returncode != 0:
            print("❌ Benchmark tests failed")
            return False

        print("✅ Benchmark tests completed")
        return True


def main():
    """Main entry point for the test runner."""
    parser = argparse.ArgumentParser(
        description="LLM Router Test Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python tests/run_tests.py all                    # Run complete test suite
  python tests/run_tests.py unit --verbose         # Run unit tests with verbose output
  python tests/run_tests.py integration            # Run integration tests only
  python tests/run_tests.py load --tool k6         # Run load tests with k6
  python tests/run_tests.py quick                  # Run quick test suite (linting + unit)
        """,
    )

    parser.add_argument(
        "command",
        choices=[
            "all",
            "unit",
            "integration",
            "security",
            "load",
            "lint",
            "type",
            "coverage",
            "benchmark",
            "quick",
        ],
        help="Test category to run",
    )

    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")

    parser.add_argument(
        "--tool",
        choices=["k6", "locust"],
        default="k6",
        help="Load testing tool (default: k6)",
    )

    parser.add_argument(
        "--duration", "-d", default="2m", help="Load test duration (default: 2m)"
    )

    parser.add_argument(
        "--no-coverage", action="store_true", help="Skip coverage reporting"
    )

    args = parser.parse_args()

    runner = TestRunner()

    # Execute the specified command
    success = False

    if args.command == "all":
        success = runner.run_all_tests(verbose=args.verbose)
    elif args.command == "quick":
        success = runner.run_all_tests(quick=True, verbose=args.verbose)
    elif args.command == "unit":
        success = runner.run_unit_tests(
            verbose=args.verbose, coverage=not args.no_coverage
        )
    elif args.command == "integration":
        success = runner.run_integration_tests(verbose=args.verbose)
    elif args.command == "security":
        success = runner.run_security_tests(verbose=args.verbose)
    elif args.command == "load":
        success = runner.run_load_tests(tool=args.tool, duration=args.duration)
    elif args.command == "lint":
        success = runner.run_linting()
    elif args.command == "type":
        success = runner.run_type_checking()
    elif args.command == "coverage":
        success = runner.generate_coverage_report()
    elif args.command == "benchmark":
        success = runner.run_benchmark_tests()

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
