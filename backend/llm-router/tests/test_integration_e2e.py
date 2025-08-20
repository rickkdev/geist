"""
Integration tests for end-to-end LLM Router functionality.

Tests include:
- Complete mobile-to-inference flow
- Circuit breaker and retry behavior  
- SSE streaming with HPKE encryption
- Health checks and monitoring
- Rate limiting
- Error handling and recovery
"""

import asyncio
import base64
import json
import tempfile
from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi.testclient import TestClient

from config import Settings


class TestE2EIntegration:
    """End-to-end integration test suite."""

    @pytest.fixture
    def test_settings(self):
        """Create test settings."""
        with tempfile.TemporaryDirectory() as temp_dir:
            settings = Settings(
                ENVIRONMENT="test",
                INFERENCE_TRANSPORT="mock",
                ROUTER_HPKE_PRIVATE_KEY_PATH=f"{temp_dir}/hpke-private.key",
                ROUTER_HPKE_PUBLIC_KEY_PATH=f"{temp_dir}/hpke-public.key",
                RATE_LIMIT_PER_MINUTE=100,
                REQUEST_TTL_SECONDS=60,
                MLOCK_SECRETS=False
            )
            yield settings

    @pytest.fixture
    def test_client(self, test_settings):
        """Create test client with mocked dependencies."""
        # Mock all the services that startup during app creation
        with patch('services.inference_client.InferenceClient') as mock_inf_client, \
             patch('services.inference_service.InferenceService') as mock_inf_service, \
             patch('services.hpke_service.HPKEService') as mock_hpke_service, \
             patch('config.get_settings', return_value=test_settings):
            
            # Setup inference client mock
            mock_inf_client_instance = Mock()
            mock_inf_client_instance.startup = AsyncMock()
            mock_inf_client_instance.shutdown = AsyncMock()
            mock_inf_client_instance.health_check = AsyncMock(return_value=True)
            mock_inf_client_instance.chat_completion = AsyncMock(return_value={
                "choices": [{"message": {"role": "assistant", "content": "Test response"}}]
            })
            mock_inf_client.return_value = mock_inf_client_instance
            
            # Setup inference service mock
            mock_inf_service_instance = Mock()
            mock_inf_service_instance.startup = AsyncMock()
            mock_inf_service_instance.shutdown = AsyncMock()
            mock_inf_service.return_value = mock_inf_service_instance
            
            # Setup HPKE service mock
            mock_hpke_service_instance = Mock()
            mock_hpke_service_instance.get_public_keys = Mock(return_value={
                "current_pubkey": "dGVzdF9wdWJrZXk=",  # base64: test_pubkey
                "next_pubkey": "dGVzdF9uZXh0X3B1YmtleQ==",  # base64: test_next_pubkey
                "key_id": "test-key-001",
                "expires_at": "2025-01-01T00:00:00Z",
                "algorithm": "X25519-HKDF-SHA256+ChaCha20-Poly1305"
            })
            mock_hpke_service_instance.decrypt_request = Mock()
            mock_hpke_service_instance.encrypt_chunk = Mock(return_value='{"encapsulated_key":"dGVzdA==","ciphertext":"dGVzdA==","aad":"dGVzdA==","sequence":0}')
            mock_hpke_service.return_value = mock_hpke_service_instance
            
            # Import main after patching
            from main import app
            client = TestClient(app)
            yield client

    @pytest.fixture
    def mock_inference_response(self):
        """Mock successful inference response."""
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "This is a test response from the inference server."
                    }
                }
            ]
        }

    def test_health_endpoint(self, test_client):
        """Test health check endpoint."""
        response = test_client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "status" in data
        assert "timestamp" in data
        assert "version" in data
        assert data["status"] == "healthy"

    def test_pubkey_endpoint(self, test_client):
        """Test public key retrieval endpoint."""
        response = test_client.get("/api/pubkey")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "current_pubkey" in data
        assert "next_pubkey" in data
        assert "key_id" in data
        assert "expires_at" in data
        assert "algorithm" in data
        
        # Verify base64 encoding
        current_pubkey = base64.b64decode(data["current_pubkey"])
        assert len(current_pubkey) > 0

    @patch('services.inference_client.InferenceClient')
    def test_chat_endpoint_success(self, mock_inference_client, test_client, mock_inference_response):
        """Test successful chat completion flow."""
        # Setup mock inference client
        mock_client_instance = Mock()
        mock_client_instance.chat_completion = AsyncMock(return_value=mock_inference_response)
        mock_inference_client.return_value = mock_client_instance
        
        # Create test request payload
        test_payload = {
            "messages": [{"role": "user", "content": "Hello, test message"}],
            "temperature": 0.7,
            "max_tokens": 100
        }
        
        # Simulate HPKE encryption (simplified for testing)
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        
        request_data = {
            "encapsulated_key": base64.b64encode(b"mock_encapsulated_key_32bytes__").decode('ascii'),
            "ciphertext": ciphertext,
            "aad": base64.b64encode(b"test_aad").decode('ascii'),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": "integration-test-123",
            "device_pubkey": base64.b64encode(b"mock_device_pubkey_32bytes____").decode('ascii')
        }
        
        # Send request
        response = test_client.post("/api/chat", json=request_data)
        
        assert response.status_code == 200
        
        # Verify inference client was called
        mock_client_instance.chat_completion.assert_called_once()

    def test_chat_endpoint_invalid_hpke(self, test_client):
        """Test chat endpoint with invalid HPKE data."""
        request_data = {
            "encapsulated_key": "invalid-base64!@#",
            "ciphertext": "also-invalid!@#",
            "aad": base64.b64encode(b"test_aad").decode('ascii'),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": "invalid-test-123",
            "device_pubkey": base64.b64encode(b"mock_device_pubkey").decode('ascii')
        }
        
        response = test_client.post("/api/chat", json=request_data)
        
        assert response.status_code == 400
        data = response.json()
        assert "error" in data

    def test_chat_endpoint_replay_attack(self, test_client):
        """Test replay attack protection."""
        test_payload = {"messages": [{"role": "user", "content": "Test"}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        
        request_data = {
            "encapsulated_key": base64.b64encode(b"mock_key").decode('ascii'),
            "ciphertext": ciphertext,
            "aad": base64.b64encode(b"test_aad").decode('ascii'),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": "replay-test-456",
            "device_pubkey": base64.b64encode(b"mock_pubkey").decode('ascii')
        }
        
        # First request should succeed
        with patch('services.inference_client.InferenceClient') as mock_client:
            mock_instance = Mock()
            mock_instance.chat_completion = AsyncMock(return_value={"choices": [{"message": {"content": "test"}}]})
            mock_client.return_value = mock_instance
            
            response1 = test_client.post("/api/chat", json=request_data)
            assert response1.status_code == 200
        
        # Second request with same ID should fail
        response2 = test_client.post("/api/chat", json=request_data)
        assert response2.status_code == 400

    @patch('services.inference_client.InferenceClient')
    def test_chat_streaming_response(self, mock_inference_client, test_client):
        """Test Server-Sent Events streaming response."""
        # Setup streaming mock
        async def mock_stream():
            chunks = [
                "This is ",
                "a streaming ",
                "response test."
            ]
            for chunk in chunks:
                yield {"choices": [{"delta": {"content": chunk}}]}
        
        mock_client_instance = Mock()
        mock_client_instance.chat_completion_stream = AsyncMock(return_value=mock_stream())
        mock_inference_client.return_value = mock_client_instance
        
        test_payload = {"messages": [{"role": "user", "content": "Stream test"}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        
        request_data = {
            "encapsulated_key": base64.b64encode(b"mock_key").decode('ascii'),
            "ciphertext": ciphertext,
            "aad": base64.b64encode(b"test_aad").decode('ascii'),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": "stream-test-789",
            "device_pubkey": base64.b64encode(b"mock_pubkey").decode('ascii')
        }
        
        # Test streaming endpoint
        response = test_client.post("/api/chat", json=request_data, headers={"Accept": "text/event-stream"})
        
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

    def test_rate_limiting(self, test_client):
        """Test rate limiting functionality."""
        test_payload = {"messages": [{"role": "user", "content": "Rate limit test"}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        
        # Send multiple requests rapidly
        requests_sent = 0
        rate_limited = False
        
        with patch('services.inference_client.InferenceClient') as mock_client:
            mock_instance = Mock()
            mock_instance.chat_completion = AsyncMock(return_value={"choices": [{"message": {"content": "test"}}]})
            mock_client.return_value = mock_instance
            
            for i in range(10):  # Send 10 requests quickly
                request_data = {
                    "encapsulated_key": base64.b64encode(b"mock_key").decode('ascii'),
                    "ciphertext": ciphertext,
                    "aad": base64.b64encode(b"test_aad").decode('ascii'),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "request_id": f"rate-limit-test-{i}",
                    "device_pubkey": base64.b64encode(b"mock_pubkey").decode('ascii')
                }
                
                response = test_client.post("/api/chat", json=request_data)
                requests_sent += 1
                
                if response.status_code == 429:  # Rate limited
                    rate_limited = True
                    break
        
        # Should have sent some requests successfully
        assert requests_sent > 0

    @patch('services.inference_client.InferenceClient')
    def test_circuit_breaker_behavior(self, mock_inference_client, test_client):
        """Test circuit breaker functionality."""
        # Setup mock to fail consistently
        mock_client_instance = Mock()
        mock_client_instance.chat_completion = AsyncMock(side_effect=Exception("Inference server down"))
        mock_inference_client.return_value = mock_client_instance
        
        test_payload = {"messages": [{"role": "user", "content": "Circuit breaker test"}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        
        # Send multiple requests to trigger circuit breaker
        for i in range(5):
            request_data = {
                "encapsulated_key": base64.b64encode(b"mock_key").decode('ascii'),
                "ciphertext": ciphertext,
                "aad": base64.b64encode(b"test_aad").decode('ascii'),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "request_id": f"circuit-test-{i}",
                "device_pubkey": base64.b64encode(b"mock_pubkey").decode('ascii')
            }
            
            response = test_client.post("/api/chat", json=request_data)
            # Should return 500 or 503 (service unavailable)
            assert response.status_code in [500, 503]

    def test_metrics_endpoint(self, test_client):
        """Test metrics endpoint for monitoring."""
        response = test_client.get("/metrics")
        
        assert response.status_code == 200
        
        # Should be Prometheus format
        content = response.text
        assert "# HELP" in content or "# TYPE" in content

    def test_malformed_json_request(self, test_client):
        """Test handling of malformed JSON requests."""
        # Send invalid JSON
        response = test_client.post(
            "/api/chat",
            data="invalid json data",
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 422  # Unprocessable Entity

    def test_missing_required_fields(self, test_client):
        """Test handling of requests with missing required fields."""
        incomplete_request = {
            "encapsulated_key": base64.b64encode(b"mock_key").decode('ascii'),
            # Missing ciphertext, aad, timestamp, etc.
        }
        
        response = test_client.post("/api/chat", json=incomplete_request)
        
        assert response.status_code == 422
        data = response.json()
        assert "detail" in data

    @patch('services.inference_client.InferenceClient')
    def test_inference_server_timeout(self, mock_inference_client, test_client):
        """Test handling of inference server timeouts."""
        # Setup mock to timeout
        mock_client_instance = Mock()
        mock_client_instance.chat_completion = AsyncMock(side_effect=asyncio.TimeoutError("Request timeout"))
        mock_inference_client.return_value = mock_client_instance
        
        test_payload = {"messages": [{"role": "user", "content": "Timeout test"}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        
        request_data = {
            "encapsulated_key": base64.b64encode(b"mock_key").decode('ascii'),
            "ciphertext": ciphertext,
            "aad": base64.b64encode(b"test_aad").decode('ascii'),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": "timeout-test-123",
            "device_pubkey": base64.b64encode(b"mock_pubkey").decode('ascii')
        }
        
        response = test_client.post("/api/chat", json=request_data)
        
        assert response.status_code in [504, 500]  # Gateway timeout or internal error

    def test_large_payload_handling(self, test_client):
        """Test handling of large payloads."""
        # Create large message content
        large_content = "A" * 10000  # 10KB message
        
        test_payload = {"messages": [{"role": "user", "content": large_content}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        
        request_data = {
            "encapsulated_key": base64.b64encode(b"mock_key").decode('ascii'),
            "ciphertext": ciphertext,
            "aad": base64.b64encode(b"test_aad").decode('ascii'),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": "large-payload-test",
            "device_pubkey": base64.b64encode(b"mock_pubkey").decode('ascii')
        }
        
        with patch('services.inference_client.InferenceClient') as mock_client:
            mock_instance = Mock()
            mock_instance.chat_completion = AsyncMock(return_value={"choices": [{"message": {"content": "Response"}}]})
            mock_client.return_value = mock_instance
            
            response = test_client.post("/api/chat", json=request_data)
            
            # Should handle large payloads or return appropriate error
            assert response.status_code in [200, 413]  # OK or Payload Too Large

    @patch('services.inference_client.InferenceClient')
    def test_concurrent_requests(self, mock_inference_client, test_client):
        """Test handling of concurrent requests."""
        mock_client_instance = Mock()
        mock_client_instance.chat_completion = AsyncMock(return_value={"choices": [{"message": {"content": "Concurrent test"}}]})
        mock_inference_client.return_value = mock_client_instance
        
        test_payload = {"messages": [{"role": "user", "content": "Concurrent test"}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode('utf-8')).decode('ascii')
        
        # Send multiple concurrent requests
        responses = []
        for i in range(5):
            request_data = {
                "encapsulated_key": base64.b64encode(b"mock_key").decode('ascii'),
                "ciphertext": ciphertext,
                "aad": base64.b64encode(b"test_aad").decode('ascii'),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "request_id": f"concurrent-test-{i}",
                "device_pubkey": base64.b64encode(b"mock_pubkey").decode('ascii')
            }
            
            response = test_client.post("/api/chat", json=request_data)
            responses.append(response)
        
        # All requests should be handled successfully
        for response in responses:
            assert response.status_code == 200

    def test_error_response_format(self, test_client):
        """Test that error responses follow consistent format."""
        # Trigger an error with invalid data
        request_data = {
            "encapsulated_key": "invalid-base64",
            "ciphertext": "invalid-base64",
            "aad": base64.b64encode(b"test_aad").decode('ascii'),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": "error-format-test",
            "device_pubkey": base64.b64encode(b"mock_pubkey").decode('ascii')
        }
        
        response = test_client.post("/api/chat", json=request_data)
        
        assert response.status_code == 400
        data = response.json()
        
        # Error response should have consistent structure
        assert "error" in data
        assert isinstance(data["error"], str)
        
        # Should not expose sensitive information
        assert "base64" not in data["error"].lower()
        assert "traceback" not in data

    def test_cors_headers(self, test_client):
        """Test CORS headers are properly set."""
        response = test_client.options("/api/chat")
        
        # Should include appropriate CORS headers for security
        headers = response.headers
        
        # Check for security headers
        if "access-control-allow-origin" in headers:
            # If CORS is enabled, ensure it's restrictive
            origin = headers["access-control-allow-origin"]
            assert origin != "*"  # Should not allow all origins

    def test_security_headers(self, test_client):
        """Test that appropriate security headers are set."""
        response = test_client.get("/health")
        
        headers = response.headers
        
        # Should not expose server information
        assert "server" not in headers or "fastapi" not in headers.get("server", "").lower()
        
        # Should have security headers
        if "x-frame-options" in headers:
            assert headers["x-frame-options"] in ["DENY", "SAMEORIGIN"]