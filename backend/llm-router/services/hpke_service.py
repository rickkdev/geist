import base64
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from config import Settings
from models import ChatRequest, DecryptedChatPayload


class HPKEService:
    """
    Service for HPKE (Hybrid Public Key Encryption) operations.
    Handles encryption, decryption, key rotation, and replay protection.
    """
    
    def __init__(self, settings: Settings):
        self.settings = settings
        self.current_private_key: Optional[bytes] = None
        self.current_public_key: Optional[bytes] = None
        self.next_private_key: Optional[bytes] = None
        self.next_public_key: Optional[bytes] = None
        self.key_id = "key-001"
        self.key_expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.HPKE_KEY_ROTATION_HOURS)
        self.seen_request_ids: Dict[str, datetime] = {}
        
        # Initialize keys (in production, load from secure storage)
        self._initialize_keys()
    
    def _initialize_keys(self):
        """
        Initialize HPKE keys. In production, these should be loaded from secure storage.
        For now, we'll use placeholder implementations.
        """
        # NOTE: This is a placeholder. In production, you would:
        # 1. Load keys from secure files or HSM
        # 2. Use actual HPKE library (like pyhpke)
        # 3. Implement proper key rotation
        
        # Placeholder key generation
        self.current_private_key = b"placeholder_private_key_32_bytes_"
        self.current_public_key = b"placeholder_public_key_32_bytes__"
        
        logging.info("HPKE keys initialized (placeholder implementation)")
    
    def decrypt_request(self, request: ChatRequest) -> DecryptedChatPayload:
        """
        Decrypt HPKE-encrypted request and validate replay protection.
        """
        # Replay protection
        if not self._check_replay_protection(request):
            raise ValueError("Request failed replay protection")
        
        try:
            # Decode base64 components
            encapsulated_key = base64.b64decode(request.encapsulated_key)
            ciphertext = base64.b64decode(request.ciphertext)
            aad = base64.b64decode(request.aad)
            
            # NOTE: This is a placeholder decryption.
            # In production, you would use a proper HPKE library like:
            # from pyhpke import AEADId, CipherSuite, KDFId, KEMId
            # 
            # suite = CipherSuite.new(
            #     kem_id=KEMId.DHKEM_X25519_HKDF_SHA256,
            #     kdf_id=KDFId.HKDF_SHA256,
            #     aead_id=AEADId.CHACHA20_POLY1305
            # )
            # context = suite.decrypt(encapsulated_key, self.current_private_key, aad)
            # plaintext = context.open(ciphertext, aad)
            
            # Placeholder decryption (just decode the ciphertext as JSON)
            # In real implementation, this would be the actual decrypted data
            try:
                plaintext_json = base64.b64decode(ciphertext).decode('utf-8')
                plaintext_data = json.loads(plaintext_json)
            except (json.JSONDecodeError, UnicodeDecodeError):
                # Fallback placeholder data for testing
                plaintext_data = {
                    "messages": [{"role": "user", "content": "Hello, how can I help you today?"}],
                    "temperature": 0.7,
                    "top_p": 0.9,
                    "max_tokens": 2048
                }
            
            return DecryptedChatPayload(**plaintext_data)
            
        except Exception as e:
            logging.error(f"HPKE decryption failed: {type(e).__name__}")
            raise ValueError("Decryption failed")
    
    def encrypt_chunk(self, chunk_data: str) -> str:
        """
        Encrypt a response chunk with HPKE.
        Returns base64-encoded encrypted data.
        """
        try:
            # NOTE: This is a placeholder encryption.
            # In production, you would use the same HPKE context
            # that was established during request decryption.
            
            # Placeholder: just base64 encode the chunk
            encrypted_data = base64.b64encode(chunk_data.encode('utf-8')).decode('ascii')
            return encrypted_data
            
        except Exception as e:
            logging.error(f"HPKE chunk encryption failed: {type(e).__name__}")
            raise ValueError("Chunk encryption failed")
    
    def get_public_keys(self) -> Dict[str, any]:
        """
        Get current and next public keys for client key pinning.
        """
        current_pubkey_b64 = base64.b64encode(self.current_public_key).decode('ascii') if self.current_public_key else ""
        next_pubkey_b64 = base64.b64encode(self.next_public_key).decode('ascii') if self.next_public_key else None
        
        return {
            "current_pubkey": current_pubkey_b64,
            "next_pubkey": next_pubkey_b64,
            "key_id": self.key_id,
            "expires_at": self.key_expires_at
        }
    
    def _check_replay_protection(self, request: ChatRequest) -> bool:
        """
        Check request against replay attacks using timestamp and request ID.
        """
        now = datetime.now(timezone.utc)
        
        # Check timestamp window (TTL)
        request_age = (now - request.timestamp).total_seconds()
        if request_age > self.settings.REQUEST_TTL_SECONDS:
            logging.warning(f"Request expired: age={request_age}s")
            return False
        
        if request_age < -30:  # Allow 30 seconds clock skew
            logging.warning(f"Request from future: age={request_age}s")
            return False
        
        # Check request ID for replay
        if request.request_id in self.seen_request_ids:
            logging.warning(f"Replay detected: request_id={request.request_id}")
            return False
        
        # Store request ID with cleanup
        self.seen_request_ids[request.request_id] = now
        
        # Clean old request IDs (keep last hour)
        cutoff = now - timedelta(hours=1)
        self.seen_request_ids = {
            rid: timestamp for rid, timestamp in self.seen_request_ids.items()
            if timestamp > cutoff
        }
        
        return True
    
    def rotate_keys(self):
        """
        Rotate HPKE keys. Should be called periodically.
        """
        if self.next_private_key and self.next_public_key:
            self.current_private_key = self.next_private_key
            self.current_public_key = self.next_public_key
            self.key_expires_at = datetime.now(timezone.utc) + timedelta(hours=self.settings.HPKE_KEY_ROTATION_HOURS)
            
            # Generate new next keys
            self._generate_next_keys()
            
            logging.info("HPKE keys rotated successfully")
    
    def _generate_next_keys(self):
        """Generate next key pair for rotation."""
        # Placeholder implementation
        self.next_private_key = b"next_placeholder_private_key_32b_"
        self.next_public_key = b"next_placeholder_public_key_32b__"