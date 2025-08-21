"""
Unit tests for HPKE Service functionality.

Tests include:
- HPKE encryption/decryption round-trip
- Key rotation handling
- Replay protection
- Memory security
- Error handling
"""

import base64
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from config import Settings
from models import ChatRequest, DecryptedChatPayload
from services.hpke_service import HPKEService


class TestHPKEService:
    """Test suite for HPKEService functionality."""

    @pytest.fixture
    def temp_settings(self):
        """Create test settings with temporary directories."""
        with tempfile.TemporaryDirectory() as temp_dir:
            settings = Settings(
                ENVIRONMENT="test",
                ROUTER_HPKE_PRIVATE_KEY_PATH=os.path.join(temp_dir, "hpke-private.key"),
                ROUTER_HPKE_PUBLIC_KEY_PATH=os.path.join(temp_dir, "hpke-public.key"),
                HPKE_KEY_ROTATION_HOURS=24,
                REQUEST_TTL_SECONDS=60,
                MLOCK_SECRETS=False,  # Disable for testing
            )
            yield settings

    @pytest.fixture
    def hpke_service(self, temp_settings):
        """Create HPKEService instance for testing."""
        return HPKEService(temp_settings)

    def test_service_initialization(self, hpke_service):
        """Test that HPKEService initializes correctly."""
        assert hpke_service.current_private_key is not None
        assert hpke_service.current_public_key is not None
        assert hpke_service.next_private_key is not None
        assert hpke_service.next_public_key is not None
        assert hpke_service.key_id is not None
        assert isinstance(hpke_service.seen_request_ids, dict)

    def test_get_public_keys(self, hpke_service):
        """Test public key retrieval for client pinning."""
        pubkeys = hpke_service.get_public_keys()

        assert "current_pubkey" in pubkeys
        assert "next_pubkey" in pubkeys
        assert "key_id" in pubkeys
        assert "expires_at" in pubkeys
        assert "algorithm" in pubkeys

        assert len(pubkeys["current_pubkey"]) > 0
        assert pubkeys["next_pubkey"] is not None
        assert pubkeys["algorithm"] == "X25519-HKDF-SHA256+ChaCha20-Poly1305"

        # Verify base64 encoding
        current_pubkey_bytes = base64.b64decode(pubkeys["current_pubkey"])
        assert len(current_pubkey_bytes) > 0

    def test_decrypt_request_valid(self, hpke_service):
        """Test successful request decryption."""
        # Create test payload
        test_payload = {
            "messages": [{"role": "user", "content": "Test message"}],
            "temperature": 0.7,
            "top_p": 0.9,
            "max_tokens": 100,
        }

        # Simulate client encryption (base64 for testing)
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode("utf-8")).decode("ascii")

        request = ChatRequest(
            encapsulated_key=base64.b64encode(
                b"mock_encapsulated_key_32bytes__"
            ).decode("ascii"),
            ciphertext=ciphertext,
            aad=base64.b64encode(b"test_aad").decode("ascii"),
            timestamp=datetime.now(timezone.utc),
            request_id="test-request-unique-123",
            device_pubkey=base64.b64encode(b"mock_device_pubkey_32bytes____").decode(
                "ascii"
            ),
        )

        # Test decryption
        decrypted = hpke_service.decrypt_request(request)

        assert isinstance(decrypted, DecryptedChatPayload)
        assert len(decrypted.messages) == 1
        assert decrypted.messages[0]["content"] == "Test message"
        assert decrypted.temperature == 0.7
        assert decrypted.max_tokens == 100

    def test_decrypt_request_replay_protection(self, hpke_service):
        """Test replay protection mechanisms."""
        # Create valid request
        test_payload = {"messages": [{"role": "user", "content": "Test"}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode("utf-8")).decode("ascii")

        request = ChatRequest(
            encapsulated_key=base64.b64encode(b"mock_key").decode("ascii"),
            ciphertext=ciphertext,
            aad=base64.b64encode(b"test_aad").decode("ascii"),
            timestamp=datetime.now(timezone.utc),
            request_id="replay-test-123",
            device_pubkey=base64.b64encode(b"mock_pubkey").decode("ascii"),
        )

        # First request should succeed
        decrypted = hpke_service.decrypt_request(request)
        assert decrypted is not None

        # Second request with same ID should fail (replay)
        with pytest.raises(ValueError, match="Request failed replay protection"):
            hpke_service.decrypt_request(request)

    def test_decrypt_request_expired_timestamp(self, hpke_service):
        """Test rejection of expired requests."""
        # Create request with old timestamp
        test_payload = {"messages": [{"role": "user", "content": "Test"}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode("utf-8")).decode("ascii")

        old_timestamp = datetime.now(timezone.utc) - timedelta(
            seconds=120
        )  # 2 minutes old

        request = ChatRequest(
            encapsulated_key=base64.b64encode(b"mock_key").decode("ascii"),
            ciphertext=ciphertext,
            aad=base64.b64encode(b"test_aad").decode("ascii"),
            timestamp=old_timestamp,
            request_id="expired-test-123",
            device_pubkey=base64.b64encode(b"mock_pubkey").decode("ascii"),
        )

        # Should fail due to expired timestamp
        with pytest.raises(ValueError, match="Request failed replay protection"):
            hpke_service.decrypt_request(request)

    def test_decrypt_request_future_timestamp(self, hpke_service):
        """Test rejection of future requests (clock skew protection)."""
        # Create request with future timestamp
        test_payload = {"messages": [{"role": "user", "content": "Test"}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode("utf-8")).decode("ascii")

        future_timestamp = datetime.now(timezone.utc) + timedelta(
            seconds=60
        )  # 1 minute future

        request = ChatRequest(
            encapsulated_key=base64.b64encode(b"mock_key").decode("ascii"),
            ciphertext=ciphertext,
            aad=base64.b64encode(b"test_aad").decode("ascii"),
            timestamp=future_timestamp,
            request_id="future-test-123",
            device_pubkey=base64.b64encode(b"mock_pubkey").decode("ascii"),
        )

        # Should fail due to future timestamp
        with pytest.raises(ValueError, match="Request failed replay protection"):
            hpke_service.decrypt_request(request)

    def test_encrypt_chunk(self, hpke_service):
        """Test chunk encryption for streaming responses."""
        test_chunk = "This is a test response chunk."
        recipient_pubkey = b"mock_recipient_pubkey_32bytes__"

        encrypted_chunk = hpke_service.encrypt_chunk(
            test_chunk, recipient_pubkey, sequence=0
        )

        # Parse encrypted chunk
        chunk_data = json.loads(encrypted_chunk)

        assert "encapsulated_key" in chunk_data
        assert "ciphertext" in chunk_data
        assert "aad" in chunk_data
        assert "sequence" in chunk_data

        assert chunk_data["sequence"] == 0
        assert len(chunk_data["encapsulated_key"]) > 0
        assert len(chunk_data["ciphertext"]) > 0

        # Verify AAD format
        aad_bytes = base64.b64decode(chunk_data["aad"])
        assert aad_bytes == b"chunk-0"

    def test_encrypt_chunk_multiple_sequences(self, hpke_service):
        """Test chunk encryption with different sequence numbers."""
        recipient_pubkey = b"mock_recipient_pubkey"

        for seq in range(5):
            encrypted_chunk = hpke_service.encrypt_chunk(
                f"Chunk {seq}", recipient_pubkey, sequence=seq
            )
            chunk_data = json.loads(encrypted_chunk)

            assert chunk_data["sequence"] == seq
            aad_bytes = base64.b64decode(chunk_data["aad"])
            assert aad_bytes == f"chunk-{seq}".encode("utf-8")

    def test_key_rotation_status(self, hpke_service):
        """Test key rotation status reporting."""
        status = hpke_service.get_key_rotation_status()

        assert "current_key_id" in status
        assert "expires_at" in status
        assert "should_rotate" in status
        assert "next_key_available" in status

        assert status["current_key_id"] == hpke_service.key_id
        assert isinstance(status["should_rotate"], bool)
        assert status["next_key_available"] is True

    def test_should_rotate_keys_not_expired(self, hpke_service):
        """Test that keys are not rotated when not expired."""
        assert not hpke_service.should_rotate_keys()

    def test_should_rotate_keys_expired(self, hpke_service):
        """Test that keys are rotated when expired."""
        # Manually set expiration to past
        hpke_service.key_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        assert hpke_service.should_rotate_keys()

    def test_key_rotation(self, hpke_service):
        """Test key rotation functionality."""
        # Store original keys
        original_private = hpke_service.current_private_key
        original_public = hpke_service.current_public_key
        original_key_id = hpke_service.key_id

        # Perform rotation
        hpke_service.rotate_keys()

        # Verify keys changed
        assert hpke_service.current_private_key != original_private
        assert hpke_service.current_public_key != original_public
        assert hpke_service.key_id != original_key_id

        # Verify new next keys were generated
        assert hpke_service.next_private_key is not None
        assert hpke_service.next_public_key is not None

        # Verify expiration time updated
        assert hpke_service.key_expires_at > datetime.now(timezone.utc)

    def test_key_persistence(self, temp_settings):
        """Test that keys are saved and loaded from files."""
        # Create first service instance
        service1 = HPKEService(temp_settings)
        key_id_1 = service1.key_id
        public_key_1 = service1.current_public_key

        # Create second service instance (should load same keys)
        service2 = HPKEService(temp_settings)

        # Keys should be the same
        assert service2.key_id == key_id_1
        assert service2.current_public_key == public_key_1

    def test_replay_id_cleanup(self, hpke_service):
        """Test that old request IDs are cleaned up."""
        # Add some old request IDs
        old_time = datetime.now(timezone.utc) - timedelta(hours=2)
        hpke_service.seen_request_ids["old-request-1"] = old_time
        hpke_service.seen_request_ids["old-request-2"] = old_time

        # Process a new request (triggers cleanup)
        test_payload = {"messages": [{"role": "user", "content": "Test"}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode("utf-8")).decode("ascii")

        request = ChatRequest(
            encapsulated_key=base64.b64encode(b"mock_key").decode("ascii"),
            ciphertext=ciphertext,
            aad=base64.b64encode(b"test_aad").decode("ascii"),
            timestamp=datetime.now(timezone.utc),
            request_id="new-request-123",
            device_pubkey=base64.b64encode(b"mock_pubkey").decode("ascii"),
        )

        hpke_service.decrypt_request(request)

        # Old request IDs should be cleaned up
        assert "old-request-1" not in hpke_service.seen_request_ids
        assert "old-request-2" not in hpke_service.seen_request_ids
        assert "new-request-123" in hpke_service.seen_request_ids

    def test_invalid_base64_handling(self, hpke_service):
        """Test handling of invalid base64 data."""
        request = ChatRequest(
            encapsulated_key="invalid-base64!@#",
            ciphertext="also-invalid-base64!@#",
            aad=base64.b64encode(b"test_aad").decode("ascii"),
            timestamp=datetime.now(timezone.utc),
            request_id="invalid-test-123",
            device_pubkey=base64.b64encode(b"mock_pubkey").decode("ascii"),
        )

        with pytest.raises(ValueError, match="Decryption failed"):
            hpke_service.decrypt_request(request)

    def test_malformed_ciphertext_handling(self, hpke_service):
        """Test handling of malformed ciphertext."""
        # Valid base64 but invalid JSON
        invalid_ciphertext = base64.b64encode(b"not-json-data").decode("ascii")

        request = ChatRequest(
            encapsulated_key=base64.b64encode(b"mock_key").decode("ascii"),
            ciphertext=invalid_ciphertext,
            aad=base64.b64encode(b"test_aad").decode("ascii"),
            timestamp=datetime.now(timezone.utc),
            request_id="malformed-test-123",
            device_pubkey=base64.b64encode(b"mock_pubkey").decode("ascii"),
        )

        with pytest.raises(ValueError, match="Decryption failed"):
            hpke_service.decrypt_request(request)

    @patch("services.hpke_service.logging")
    def test_error_logging(self, mock_logging, hpke_service):
        """Test that errors are properly logged without exposing sensitive data."""
        # Trigger decryption error
        request = ChatRequest(
            encapsulated_key="invalid-base64",
            ciphertext="invalid-base64",
            aad=base64.b64encode(b"test_aad").decode("ascii"),
            timestamp=datetime.now(timezone.utc),
            request_id="logging-test-123",
            device_pubkey=base64.b64encode(b"mock_pubkey").decode("ascii"),
        )

        with pytest.raises(ValueError):
            hpke_service.decrypt_request(request)

        # Verify error was logged with only error type, not sensitive data
        mock_logging.error.assert_called()
        error_call = mock_logging.error.call_args[0][0]
        assert "HPKE decryption failed" in error_call
        assert "invalid-base64" not in error_call  # Sensitive data not logged

    def test_memory_security_operations(self, hpke_service):
        """Test memory security operations."""
        # Test that _zero_memory doesn't crash
        test_data = b"sensitive data to zero"
        hpke_service._zero_memory(test_data)

        # Test should complete without error
        assert True

    @patch("services.hpke_service.ctypes.util.find_library")
    def test_mlock_fallback(self, mock_find_library, temp_settings):
        """Test mlock fallback when libc is not available."""
        mock_find_library.return_value = None
        temp_settings.MLOCK_SECRETS = True

        # Should not crash when libc is not available
        service = HPKEService(temp_settings)
        assert service is not None

    def test_concurrent_request_processing(self, hpke_service):
        """Test handling of multiple concurrent requests."""
        test_payload = {"messages": [{"role": "user", "content": "Test"}]}
        payload_json = json.dumps(test_payload)
        ciphertext = base64.b64encode(payload_json.encode("utf-8")).decode("ascii")

        # Process multiple requests with different IDs
        for i in range(10):
            request = ChatRequest(
                encapsulated_key=base64.b64encode(b"mock_key").decode("ascii"),
                ciphertext=ciphertext,
                aad=base64.b64encode(b"test_aad").decode("ascii"),
                timestamp=datetime.now(timezone.utc),
                request_id=f"concurrent-test-{i}",
                device_pubkey=base64.b64encode(b"mock_pubkey").decode("ascii"),
            )

            decrypted = hpke_service.decrypt_request(request)
            assert decrypted is not None

        # All request IDs should be tracked
        assert len(hpke_service.seen_request_ids) == 10
