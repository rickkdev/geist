"""
pytest configuration and shared fixtures for LLM Router tests.

Provides common test fixtures, utilities, and configuration
for unit tests, integration tests, and test utilities.
"""

import base64
import json
import os
import tempfile
from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi.testclient import TestClient

from config import Settings
from services.hpke_service import HPKEService


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        yield tmp_dir


@pytest.fixture
def test_settings(temp_dir):
    """Create test settings with temporary file paths."""
    return Settings(
        ENVIRONMENT="test",
        ROUTER_HPKE_PRIVATE_KEY_PATH=os.path.join(temp_dir, "hpke-private.key"),
        ROUTER_HPKE_PUBLIC_KEY_PATH=os.path.join(temp_dir, "hpke-public.key"),
        HPKE_KEY_ROTATION_HOURS=24,
        REQUEST_TTL_SECONDS=60,
        RATE_LIMIT_PER_MINUTE=100,
        MLOCK_SECRETS=False,  # Disable for testing
        INFERENCE_TRANSPORT="mock",
        LOG_LEVEL="WARNING"  # Reduce log noise in tests
    )


@pytest.fixture
def hpke_service(test_settings):
    """Create HPKEService instance for testing."""
    return HPKEService(test_settings)


@pytest.fixture
def test_client(test_settings):
    """Create FastAPI test client with mocked dependencies."""
    with patch('config.get_settings', return_value=test_settings):
        from main import app
        client = TestClient(app)
        yield client


@pytest.fixture
def mock_inference_client():
    """Mock inference client for testing."""
    mock_client = Mock()
    mock_client.chat_completion = AsyncMock(return_value={
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": "This is a mock response from the inference server."
                }
            }
        ]
    })
    
    async def mock_stream():
        chunks = ["Hello", " world", "!"]
        for chunk in chunks:
            yield {"choices": [{"delta": {"content": chunk}}]}
    
    mock_client.chat_completion_stream = AsyncMock(return_value=mock_stream())
    return mock_client


@pytest.fixture
def sample_chat_payload():
    """Sample chat payload for testing."""
    return {
        "messages": [
            {"role": "user", "content": "Hello, this is a test message"}
        ],
        "temperature": 0.7,
        "top_p": 0.9,
        "max_tokens": 100
    }


@pytest.fixture
def sample_hpke_request(sample_chat_payload):
    """Sample HPKE encrypted request for testing."""
    payload_json = json.dumps(sample_chat_payload)
    ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
    
    return {
        "encapsulated_key": base64.b64encode(b"mock_encapsulated_key_32bytes__").decode('ascii'),
        "ciphertext": ciphertext,
        "aad": base64.b64encode(b"test_aad").decode('ascii'),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "request_id": "test-request-123",
        "device_pubkey": base64.b64encode(b"mock_device_pubkey_32bytes____").decode('ascii')
    }


@pytest.fixture
def valid_device_keys():
    """Generate valid device key pair for testing."""
    device_private_key = b"mock_device_private_key_32_bytes_"
    device_public_key = b"mock_device_public_key_32_bytes__"
    
    return {
        "private_key": device_private_key,
        "public_key": device_public_key,
        "public_key_b64": base64.b64encode(device_public_key).decode('ascii')
    }


@pytest.fixture(autouse=True)
def setup_test_environment(monkeypatch):
    """Automatically set up test environment for all tests."""
    # Set test environment variables
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    
    # Disable external services in tests
    monkeypatch.setenv("MLOCK_SECRETS", "false")
    monkeypatch.setenv("INFERENCE_TRANSPORT", "mock")


@pytest.fixture
def mock_time():
    """Mock time functions for deterministic testing."""
    with patch('time.time', return_value=1640995200.0):  # Fixed timestamp
        with patch('datetime.datetime') as mock_datetime:
            mock_datetime.now.return_value = datetime(2022, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
            mock_datetime.side_effect = lambda *args, **kw: datetime(*args, **kw)
            yield mock_datetime


# Test utilities
class TestHelpers:
    """Helper methods for testing."""
    
    @staticmethod
    def create_hpke_request(payload, request_id=None, timestamp=None, device_pubkey=None):
        """Create a properly formatted HPKE request for testing."""
        payload_json = json.dumps(payload)
        ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        
        return {
            "encapsulated_key": base64.b64encode(b"mock_encapsulated_key_32bytes__").decode('ascii'),
            "ciphertext": ciphertext,
            "aad": base64.b64encode(b"test_aad").decode('ascii'),
            "timestamp": timestamp or datetime.now(timezone.utc).isoformat(),
            "request_id": request_id or f"test-{datetime.now().timestamp()}",
            "device_pubkey": device_pubkey or base64.b64encode(b"mock_device_pubkey_32bytes____").decode('ascii')
        }
    
    @staticmethod
    def assert_valid_hpke_response(response_data):
        """Assert that a response contains valid HPKE encrypted data."""
        assert "encapsulated_key" in response_data
        assert "ciphertext" in response_data
        assert "aad" in response_data
        
        # Verify base64 encoding
        base64.b64decode(response_data["encapsulated_key"])
        base64.b64decode(response_data["ciphertext"])
        base64.b64decode(response_data["aad"])
    
    @staticmethod
    def assert_no_sensitive_data_in_logs(caplog):
        """Assert that logs don't contain sensitive data."""
        log_text = caplog.text.lower()
        
        # Check for common sensitive data patterns
        sensitive_patterns = [
            "encapsulated_key",
            "ciphertext",
            "private_key",
            "password",
            "secret",
            "token"
        ]
        
        for pattern in sensitive_patterns:
            assert pattern not in log_text, f"Sensitive data '{pattern}' found in logs"
    
    @staticmethod
    def generate_large_payload(size_kb=10):
        """Generate a large payload for testing size limits."""
        content = "A" * (size_kb * 1024)
        return {
            "messages": [{"role": "user", "content": content}],
            "temperature": 0.7,
            "max_tokens": 100
        }


@pytest.fixture
def test_helpers():
    """Provide test helper methods."""
    return TestHelpers


# Performance testing fixtures
@pytest.fixture
def performance_timer():
    """Timer fixture for performance testing."""
    import time
    
    class Timer:
        def __init__(self):
            self.start_time = None
            self.end_time = None
        
        def start(self):
            self.start_time = time.time()
            return self
        
        def stop(self):
            self.end_time = time.time()
            return self
        
        @property
        def elapsed(self):
            if self.start_time and self.end_time:
                return self.end_time - self.start_time
            return None
        
        def assert_faster_than(self, max_seconds):
            assert self.elapsed is not None, "Timer not started/stopped"
            assert self.elapsed < max_seconds, f"Operation took {self.elapsed:.3f}s, expected < {max_seconds}s"
    
    return Timer()


# Error simulation fixtures
@pytest.fixture
def error_simulator():
    """Fixture for simulating various error conditions."""
    
    class ErrorSimulator:
        @staticmethod
        def network_timeout():
            import asyncio
            return asyncio.TimeoutError("Simulated network timeout")
        
        @staticmethod
        def connection_error():
            import httpx
            return httpx.ConnectError("Simulated connection error")
        
        @staticmethod
        def inference_server_error():
            return Exception("Simulated inference server error")
        
        @staticmethod
        def invalid_response():
            return {"error": "Simulated invalid response"}
        
        @staticmethod
        def rate_limit_error():
            class RateLimitError(Exception):
                pass
            return RateLimitError("Rate limit exceeded")
    
    return ErrorSimulator


# Test data generators
@pytest.fixture
def test_data_generator():
    """Generate various test data patterns."""
    
    class TestDataGenerator:
        @staticmethod
        def generate_chat_scenarios():
            """Generate various chat test scenarios."""
            return [
                {
                    "name": "simple_question",
                    "messages": [{"role": "user", "content": "What is 2+2?"}],
                    "expected_tokens": 10
                },
                {
                    "name": "complex_question", 
                    "messages": [{"role": "user", "content": "Explain quantum computing in detail"}],
                    "expected_tokens": 200
                },
                {
                    "name": "conversation",
                    "messages": [
                        {"role": "user", "content": "Hello"},
                        {"role": "assistant", "content": "Hi there!"},
                        {"role": "user", "content": "How are you?"}
                    ],
                    "expected_tokens": 50
                }
            ]
        
        @staticmethod
        def generate_invalid_requests():
            """Generate various invalid request patterns."""
            return [
                {
                    "name": "invalid_base64",
                    "error": "Invalid base64 encoding",
                    "data": {
                        "encapsulated_key": "invalid-base64!@#",
                        "ciphertext": "also-invalid!@#",
                        "aad": base64.b64encode(b"test").decode(),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "request_id": "invalid-test",
                        "device_pubkey": base64.b64encode(b"mock").decode()
                    }
                },
                {
                    "name": "missing_fields",
                    "error": "Missing required fields",
                    "data": {
                        "encapsulated_key": base64.b64encode(b"test").decode()
                        # Missing other required fields
                    }
                },
                {
                    "name": "expired_timestamp",
                    "error": "Expired request",
                    "data": {
                        "encapsulated_key": base64.b64encode(b"test").decode(),
                        "ciphertext": base64.b64encode(b"test").decode(),
                        "aad": base64.b64encode(b"test").decode(),
                        "timestamp": "2020-01-01T00:00:00Z",
                        "request_id": "expired-test",
                        "device_pubkey": base64.b64encode(b"mock").decode()
                    }
                }
            ]
    
    return TestDataGenerator


# Cleanup fixtures
@pytest.fixture(autouse=True)
def cleanup_test_files():
    """Automatically cleanup test files after each test."""
    yield
    
    # Cleanup any temporary files that might have been created
    import glob
    import os
    
    test_files = glob.glob("test_*.tmp") + glob.glob("*.test")
    for file in test_files:
        try:
            os.remove(file)
        except OSError:
            pass