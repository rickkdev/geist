// Import crypto polyfill first
import 'react-native-get-random-values';
import * as SecureStore from 'expo-secure-store';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 as sha256Hash } from '@noble/hashes/sha256';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { concatBytes, randomBytes } from '@noble/hashes/utils';

// Use @noble's cryptographically secure random bytes
const getRandomBytes = randomBytes;

const DEVICE_PRIVATE_KEY = 'device_private_key';
const DEVICE_PUBLIC_KEY = 'device_public_key';

export interface HPKEEncryptedMessage {
  encapsulatedKey: string; // Base64 encoded
  ciphertext: string; // Base64 encoded
  nonce: string; // Base64 encoded nonce for ChaCha20-Poly1305
  timestamp: number;
  requestId: string;
}

export interface HPKEDecryptedMessage {
  plaintext: string;
  timestamp: number;
  requestId: string;
}

export class HPKEClient {
  private devicePrivateKey: Uint8Array | null = null;
  private devicePublicKey: Uint8Array | null = null;
  private usedRequestIds = new Set<string>();
  private readonly MAX_REQUEST_IDS = 10000;
  private readonly DEVELOPMENT_MODE = __DEV__ || false;

  async initialize(): Promise<void> {
    try {
      await this.loadOrGenerateDeviceKeys();
    } catch (error) {
      throw error;
    }
  }

  private async loadOrGenerateDeviceKeys(): Promise<void> {
    try {
      const storedPrivateKey = await SecureStore.getItemAsync(DEVICE_PRIVATE_KEY);
      const storedPublicKey = await SecureStore.getItemAsync(DEVICE_PUBLIC_KEY);

      if (storedPrivateKey && storedPublicKey) {
        this.devicePrivateKey = new Uint8Array(
          Array.from(atob(storedPrivateKey), (c) => c.charCodeAt(0))
        );
        this.devicePublicKey = new Uint8Array(
          Array.from(atob(storedPublicKey), (c) => c.charCodeAt(0))
        );
      } else {
        await this.generateAndStoreDeviceKeys();
      }
    } catch (error) {
      await this.generateAndStoreDeviceKeys();
    }
  }

  private async generateAndStoreDeviceKeys(): Promise<void> {
    try {
      // Generate proper X25519 key pair
      const privateKey = getRandomBytes(32);
      const publicKey = x25519.getPublicKey(privateKey);

      // Store keys securely
      const privateKeyB64 = btoa(String.fromCharCode.apply(null, Array.from(privateKey)));
      const publicKeyB64 = btoa(String.fromCharCode.apply(null, Array.from(publicKey)));

      await SecureStore.setItemAsync(DEVICE_PRIVATE_KEY, privateKeyB64);
      await SecureStore.setItemAsync(DEVICE_PUBLIC_KEY, publicKeyB64);

      this.devicePrivateKey = privateKey;
      this.devicePublicKey = publicKey;
    } catch (error) {
      throw error;
    }
  }

  getDevicePublicKey(): string {
    if (!this.devicePublicKey) {
      throw new Error('Device keys not initialized');
    }
    return btoa(String.fromCharCode.apply(null, Array.from(this.devicePublicKey)));
  }

  async seal(plaintext: string, recipientPublicKey: string): Promise<HPKEEncryptedMessage> {
    if (!this.devicePrivateKey) {
      await this.initialize();

      if (!this.devicePrivateKey) {
        throw new Error('Device keys not initialized after re-initialization');
      }
    }

    try {
      const requestId = Array.from(getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join(
        ''
      );
      const timestamp = Date.now();

      // Decode recipient public key from base64 - this is PEM-encoded
      let recipientPubKeyBytes: Uint8Array;
      try {
        const pemDecoded = atob(recipientPublicKey);

        if (this.DEVELOPMENT_MODE) {
          // Development: Use mock key derived from PEM
          const pemBytes = new TextEncoder().encode(pemDecoded);
          recipientPubKeyBytes = new Uint8Array(sha256Hash(pemBytes));
        } else {
          // Production: Extract actual X25519 key from PEM structure
          // This assumes the backend sends proper X25519 public keys in production
          recipientPubKeyBytes = new Uint8Array(Array.from(pemDecoded, (c) => c.charCodeAt(0)));
          if (recipientPubKeyBytes.length !== 32) {
            throw new Error(
              `Invalid X25519 key length: ${recipientPubKeyBytes.length}, expected 32`
            );
          }
        }
      } catch (error) {
        throw new Error(
          `Failed to decode recipient public key: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }

      // Generate ephemeral key pair for ECDH
      const ephemeralPrivateKey = getRandomBytes(32);
      const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);

      // Perform ECDH key exchange
      let sharedSecret: Uint8Array;
      if (this.DEVELOPMENT_MODE) {
        // Development: Mock shared secret for compatibility
        const mockSharedSecretSource = concatBytes(ephemeralPrivateKey, recipientPubKeyBytes);
        sharedSecret = new Uint8Array(sha256Hash(mockSharedSecretSource));
      } else {
        // Production: Real X25519 ECDH
        sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, recipientPubKeyBytes);
      }

      // Derive encryption key using HKDF-SHA256
      const suite_id = new TextEncoder().encode('HPKE-v1-X25519-HKDF-SHA256-ChaCha20Poly1305');
      const info = concatBytes(suite_id, new TextEncoder().encode('geist-mobile'));
      const key = hkdf(sha256Hash, sharedSecret, new Uint8Array(0), info, 32);

      // Encrypt with ChaCha20-Poly1305
      let ciphertextB64: string;
      let nonceB64: string;

      if (this.DEVELOPMENT_MODE) {
        // Development: Base64 encoding for backend compatibility
        // Use TextEncoder to handle unicode characters properly
        const plaintextBytes = new TextEncoder().encode(plaintext);
        ciphertextB64 = btoa(String.fromCharCode.apply(null, Array.from(plaintextBytes)));
        nonceB64 = btoa(String.fromCharCode.apply(null, Array.from(getRandomBytes(12))));
      } else {
        // Production: Real ChaCha20-Poly1305 encryption
        const nonce = getRandomBytes(12); // ChaCha20-Poly1305 requires 12-byte nonce
        const cipher = chacha20poly1305(key, nonce);
        const plainTextBytes = new TextEncoder().encode(plaintext);
        const encrypted = cipher.encrypt(plainTextBytes);

        ciphertextB64 = btoa(String.fromCharCode.apply(null, Array.from(encrypted)));
        nonceB64 = btoa(String.fromCharCode.apply(null, Array.from(nonce)));
      }

      // Secure cleanup of sensitive intermediate values
      this.secureWipe(sharedSecret);
      this.secureWipe(ephemeralPrivateKey);
      this.secureWipe(key);

      // Validate and track request ID for replay protection
      this.validateAndTrackRequestId(requestId);

      return {
        encapsulatedKey: btoa(String.fromCharCode.apply(null, Array.from(ephemeralPublicKey))),
        ciphertext: ciphertextB64,
        nonce: nonceB64,
        timestamp,
        requestId,
      };
    } catch (error) {
      throw new Error(
        `HPKE encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async open(
    encryptedMessage: HPKEEncryptedMessage,
    senderPublicKey?: string
  ): Promise<HPKEDecryptedMessage> {
    if (!this.devicePrivateKey) {
      throw new Error('Device keys not initialized');
    }

    // Validate timestamp (60 second window)
    const now = Date.now();
    if (Math.abs(now - encryptedMessage.timestamp) > 60000) {
      throw new Error('Message timestamp outside valid window');
    }

    try {
      // Validate request ID for replay protection
      if (this.usedRequestIds.has(encryptedMessage.requestId)) {
        throw new Error('Request ID already used (potential replay attack)');
      }

      let decryptedText: string;

      if (this.DEVELOPMENT_MODE) {
        // Development: Base64 decoding
        decryptedText = atob(encryptedMessage.ciphertext);
      } else {
        // Production: Real ChaCha20-Poly1305 decryption

        if (!encryptedMessage.nonce) {
          throw new Error('Nonce missing from encrypted message');
        }

        const nonce = new Uint8Array(
          Array.from(atob(encryptedMessage.nonce), (c) => c.charCodeAt(0))
        );
        const ciphertext = new Uint8Array(
          Array.from(atob(encryptedMessage.ciphertext), (c) => c.charCodeAt(0))
        );

        // Derive the same key used for encryption
        // This would need the same HKDF process as in seal()
        const suite_id = new TextEncoder().encode('HPKE-v1-X25519-HKDF-SHA256-ChaCha20Poly1305');
        const info = concatBytes(suite_id, new TextEncoder().encode('geist-mobile'));

        // Note: This is simplified - in full HPKE we'd need the ephemeral key
        // and recipient private key to reconstruct the shared secret
        throw new Error(
          'Full HPKE decryption not implemented - requires ephemeral key from message'
        );
      }

      return {
        plaintext: decryptedText,
        timestamp: encryptedMessage.timestamp,
        requestId: encryptedMessage.requestId,
      };
    } catch (error) {
      throw new Error(
        `HPKE decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private validateAndTrackRequestId(requestId: string): void {
    if (this.usedRequestIds.has(requestId)) {
      throw new Error('Request ID already used (replay attack detected)');
    }

    this.usedRequestIds.add(requestId);

    // Clean up old request IDs to prevent memory bloat
    if (this.usedRequestIds.size > this.MAX_REQUEST_IDS) {
      // Convert to array, sort, and keep only the most recent half
      const sortedIds = Array.from(this.usedRequestIds).sort();
      this.usedRequestIds.clear();

      // Keep the second half (more recent IDs assuming timestamp-based IDs)
      const keepFrom = Math.floor(sortedIds.length / 2);
      for (let i = keepFrom; i < sortedIds.length; i++) {
        this.usedRequestIds.add(sortedIds[i]);
      }
    }
  }

  private secureWipe(data: Uint8Array): void {
    if (!data) return;

    try {
      // First overwrite with random data
      crypto.getRandomValues(data);
      // Then zero out
      data.fill(0);
    } catch (error) {
      // Fallback: just zero out if crypto.getRandomValues fails
      data.fill(0);
    }
  }

  private constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }

  clearSensitiveData(): void {
    if (this.devicePrivateKey) {
      this.secureWipe(this.devicePrivateKey);
      this.devicePrivateKey = null;
    }
    if (this.devicePublicKey) {
      this.secureWipe(this.devicePublicKey);
      this.devicePublicKey = null;
    }

    // Clear request ID tracking
    this.usedRequestIds.clear();
  }
}

export default HPKEClient;
