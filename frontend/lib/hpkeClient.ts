// Import crypto polyfill first
import 'react-native-get-random-values';
import * as SecureStore from 'expo-secure-store';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { concatBytes, randomBytes } from '@noble/hashes/utils';

// Use @noble's cryptographically secure random bytes
const getRandomBytes = randomBytes;

const DEVICE_PRIVATE_KEY = 'device_private_key';
const DEVICE_PUBLIC_KEY = 'device_public_key';

export interface HPKEEncryptedMessage {
  encapsulatedKey: string; // Base64 encoded
  ciphertext: string; // Base64 encoded
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

  async initialize(): Promise<void> {
    try {
      console.log('HPKE: Starting initialization...');
      await this.loadOrGenerateDeviceKeys();
      console.log('HPKE: Initialization completed successfully');
    } catch (error) {
      console.error('HPKE: Initialization failed:', error);
      throw error;
    }
  }

  private async loadOrGenerateDeviceKeys(): Promise<void> {
    try {
      console.log('HPKE: Loading stored device keys...');
      const storedPrivateKey = await SecureStore.getItemAsync(DEVICE_PRIVATE_KEY);
      const storedPublicKey = await SecureStore.getItemAsync(DEVICE_PUBLIC_KEY);

      if (storedPrivateKey && storedPublicKey) {
        console.log('HPKE: Found stored keys, loading...');
        this.devicePrivateKey = new Uint8Array(
          Array.from(atob(storedPrivateKey), c => c.charCodeAt(0))
        );
        this.devicePublicKey = new Uint8Array(
          Array.from(atob(storedPublicKey), c => c.charCodeAt(0))
        );
        console.log('HPKE: Stored keys loaded successfully');
      } else {
        console.log('HPKE: No stored keys found, generating new ones...');
        await this.generateAndStoreDeviceKeys();
      }
    } catch (error) {
      console.error('HPKE: Error loading device keys:', error);
      console.log('HPKE: Falling back to generating new keys...');
      await this.generateAndStoreDeviceKeys();
    }
  }

  private async generateAndStoreDeviceKeys(): Promise<void> {
    try {
      console.log('HPKE: Generating new X25519 device keys...');
      
      // Generate proper X25519 key pair
      const privateKey = getRandomBytes(32);
      const publicKey = x25519.getPublicKey(privateKey);

      // Store keys securely
      const privateKeyB64 = btoa(String.fromCharCode.apply(null, Array.from(privateKey)));
      const publicKeyB64 = btoa(String.fromCharCode.apply(null, Array.from(publicKey)));

      console.log('HPKE: Storing keys to SecureStore...');
      await SecureStore.setItemAsync(DEVICE_PRIVATE_KEY, privateKeyB64);
      await SecureStore.setItemAsync(DEVICE_PUBLIC_KEY, publicKeyB64);

      this.devicePrivateKey = privateKey;
      this.devicePublicKey = publicKey;
      console.log('HPKE: New X25519 keys generated and stored successfully');
    } catch (error) {
      console.error('HPKE: Failed to generate and store keys:', error);
      throw error;
    }
  }

  getDevicePublicKey(): string {
    if (!this.devicePublicKey) {
      throw new Error('Device keys not initialized');
    }
    return btoa(String.fromCharCode.apply(null, Array.from(this.devicePublicKey)));
  }

  async seal(
    plaintext: string,
    recipientPublicKey: string
  ): Promise<HPKEEncryptedMessage> {
    console.log('HPKE: seal() called, checking device keys...');
    console.log('HPKE: devicePrivateKey exists:', !!this.devicePrivateKey);
    console.log('HPKE: devicePublicKey exists:', !!this.devicePublicKey);
    
    if (!this.devicePrivateKey) {
      throw new Error('Device keys not initialized');
    }

    try {
      const requestId = Array.from(getRandomBytes(16), b => b.toString(16).padStart(2, '0')).join('');
      const timestamp = Date.now();

      // Debug: Log recipient public key info
      console.log('🔑 HPKE: recipientPublicKey (base64):', recipientPublicKey);
      console.log('🔑 HPKE: recipientPublicKey length:', recipientPublicKey?.length);
      
      // Decode recipient public key from base64 - this is PEM-encoded
      let recipientPubKeyBytes: Uint8Array;
      try {
        const pemDecoded = atob(recipientPublicKey);
        console.log('🔑 HPKE: PEM decoded length:', pemDecoded.length);
        console.log('🔑 HPKE: PEM content:', pemDecoded);
        
        // For development: Since backend uses P-256 instead of X25519, 
        // we'll use a mock 32-byte key derived from the PEM key hash
        const pemBytes = new TextEncoder().encode(pemDecoded);
        recipientPubKeyBytes = sha256(pemBytes);
        
        console.log('🔑 HPKE: mock X25519 key length:', recipientPubKeyBytes.length);
      } catch (error) {
        throw new Error(`Failed to decode recipient public key: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Generate ephemeral key pair for ECDH
      const ephemeralPrivateKey = getRandomBytes(32);
      const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);

      // For development: Since we're using a mock key, create a mock shared secret
      // In production, this would be: x25519.getSharedSecret(ephemeralPrivateKey, recipientPubKeyBytes)
      const mockSharedSecretSource = concatBytes(ephemeralPrivateKey, recipientPubKeyBytes);
      const sharedSecret = sha256(mockSharedSecretSource);

      // Derive encryption key using HKDF-SHA256
      const suite_id = new TextEncoder().encode('HPKE-v1-X25519-HKDF-SHA256-ChaCha20Poly1305');
      const info = concatBytes(suite_id, new TextEncoder().encode('geist-mobile'));
      const key = hkdf(sha256, sharedSecret, new Uint8Array(0), info, 32);

      // For development: Backend expects base64-encoded plaintext, not encrypted data
      // In production, this would do real ChaCha20-Poly1305 encryption
      console.log('🔐 HPKE: Using development mode - base64 encoding plaintext');
      const ciphertextB64 = btoa(plaintext);

      console.log('🔐 HPKE seal - plaintext length:', plaintext.length, 'base64 length:', ciphertextB64.length);

      return {
        encapsulatedKey: btoa(String.fromCharCode.apply(null, Array.from(ephemeralPublicKey))),
        ciphertext: ciphertextB64,
        timestamp,
        requestId
      };
    } catch (error) {
      console.error('❌ HPKE seal failed:', error);
      throw new Error(`HPKE encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      // For development: Backend sends base64-encoded plaintext, not encrypted data
      console.log('🔐 HPKE: Using development mode - base64 decoding plaintext');
      const decryptedText = atob(encryptedMessage.ciphertext);
      
      return {
        plaintext: decryptedText,
        timestamp: encryptedMessage.timestamp,
        requestId: encryptedMessage.requestId
      };
    } catch (error) {
      console.error('❌ HPKE open failed:', error);
      throw new Error(`HPKE decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      this.devicePrivateKey.fill(0);
      this.devicePrivateKey = null;
    }
    if (this.devicePublicKey) {
      this.devicePublicKey.fill(0);
      this.devicePublicKey = null;
    }
  }
}

export default HPKEClient;