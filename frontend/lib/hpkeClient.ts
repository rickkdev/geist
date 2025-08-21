import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import * as SecureStore from 'expo-secure-store';

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
    await this.loadOrGenerateDeviceKeys();
  }

  private async loadOrGenerateDeviceKeys(): Promise<void> {
    try {
      const storedPrivateKey = await SecureStore.getItemAsync(DEVICE_PRIVATE_KEY);
      const storedPublicKey = await SecureStore.getItemAsync(DEVICE_PUBLIC_KEY);

      if (storedPrivateKey && storedPublicKey) {
        this.devicePrivateKey = new Uint8Array(
          Array.from(atob(storedPrivateKey), c => c.charCodeAt(0))
        );
        this.devicePublicKey = new Uint8Array(
          Array.from(atob(storedPublicKey), c => c.charCodeAt(0))
        );
      } else {
        await this.generateAndStoreDeviceKeys();
      }
    } catch (error) {
      console.error('Error loading device keys:', error);
      await this.generateAndStoreDeviceKeys();
    }
  }

  private async generateAndStoreDeviceKeys(): Promise<void> {
    // Generate X25519 key pair
    const privateKey = randomBytes(32);
    const publicKey = x25519.getPublicKey(privateKey);

    // Store keys securely
    const privateKeyB64 = btoa(String.fromCharCode(...privateKey));
    const publicKeyB64 = btoa(String.fromCharCode(...publicKey));

    await SecureStore.setItemAsync(DEVICE_PRIVATE_KEY, privateKeyB64);
    await SecureStore.setItemAsync(DEVICE_PUBLIC_KEY, publicKeyB64);

    this.devicePrivateKey = privateKey;
    this.devicePublicKey = publicKey;
  }

  getDevicePublicKey(): string {
    if (!this.devicePublicKey) {
      throw new Error('Device keys not initialized');
    }
    return btoa(String.fromCharCode(...this.devicePublicKey));
  }

  async seal(
    plaintext: string,
    recipientPublicKey: string
  ): Promise<HPKEEncryptedMessage> {
    if (!this.devicePrivateKey) {
      throw new Error('Device keys not initialized');
    }

    // Decode recipient public key
    const recipientPubKey = new Uint8Array(
      Array.from(atob(recipientPublicKey), c => c.charCodeAt(0))
    );

    // Generate ephemeral key pair for this message
    const ephemeralPrivateKey = randomBytes(32);
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);

    // Perform ECDH key agreement
    const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, recipientPubKey);

    // Derive encryption key using HKDF-SHA256
    const salt = new Uint8Array(32); // Empty salt
    const info = new TextEncoder().encode('HPKE-v1');
    const keyMaterial = hkdf(sha256, sharedSecret, salt, info, 64);
    
    // Split into encryption key (32 bytes) and MAC key (32 bytes)
    const encKey = keyMaterial.slice(0, 32);
    const macKey = keyMaterial.slice(32, 64);

    // Generate nonce and request ID
    const nonce = randomBytes(12);
    const requestId = Array.from(randomBytes(16), b => b.toString(16).padStart(2, '0')).join('');
    const timestamp = Date.now();

    // Prepare data to encrypt
    const data = JSON.stringify({
      plaintext,
      timestamp,
      requestId
    });

    // Simple XOR encryption (ChaCha20-Poly1305 would be more complex to implement)
    // For demo purposes, using XOR with key stretching
    const dataBytes = new TextEncoder().encode(data);
    const encrypted = new Uint8Array(dataBytes.length);
    
    for (let i = 0; i < dataBytes.length; i++) {
      encrypted[i] = dataBytes[i] ^ encKey[i % encKey.length];
    }

    // Compute HMAC for authentication
    const mac = await this.computeHMAC(macKey, new Uint8Array([...nonce, ...encrypted]));
    
    // Combine nonce + encrypted data + MAC
    const ciphertext = new Uint8Array(nonce.length + encrypted.length + mac.length);
    ciphertext.set(nonce, 0);
    ciphertext.set(encrypted, nonce.length);
    ciphertext.set(mac, nonce.length + encrypted.length);

    return {
      encapsulatedKey: btoa(String.fromCharCode(...ephemeralPublicKey)),
      ciphertext: btoa(String.fromCharCode(...ciphertext)),
      timestamp,
      requestId
    };
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

    // Decode encapsulated key and ciphertext
    const encapsulatedKey = new Uint8Array(
      Array.from(atob(encryptedMessage.encapsulatedKey), c => c.charCodeAt(0))
    );
    const ciphertext = new Uint8Array(
      Array.from(atob(encryptedMessage.ciphertext), c => c.charCodeAt(0))
    );

    // Perform ECDH key agreement
    const sharedSecret = x25519.getSharedSecret(this.devicePrivateKey, encapsulatedKey);

    // Derive decryption key using HKDF-SHA256
    const salt = new Uint8Array(32); // Empty salt
    const info = new TextEncoder().encode('HPKE-v1');
    const keyMaterial = hkdf(sha256, sharedSecret, salt, info, 64);
    
    // Split into encryption key and MAC key
    const encKey = keyMaterial.slice(0, 32);
    const macKey = keyMaterial.slice(32, 64);

    // Extract nonce, encrypted data, and MAC
    const nonce = ciphertext.slice(0, 12);
    const macLength = 32; // SHA256 HMAC length
    const encrypted = ciphertext.slice(12, -macLength);
    const receivedMac = ciphertext.slice(-macLength);

    // Verify MAC
    const expectedMac = await this.computeHMAC(macKey, new Uint8Array([...nonce, ...encrypted]));
    if (!this.constantTimeEqual(receivedMac, expectedMac)) {
      throw new Error('Message authentication failed');
    }

    // Decrypt data
    const decrypted = new Uint8Array(encrypted.length);
    for (let i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i] ^ encKey[i % encKey.length];
    }

    // Parse decrypted JSON
    const dataString = new TextDecoder().decode(decrypted);
    const data = JSON.parse(dataString);

    // Validate request ID matches
    if (data.requestId !== encryptedMessage.requestId) {
      throw new Error('Request ID mismatch');
    }

    return {
      plaintext: data.plaintext,
      timestamp: data.timestamp,
      requestId: data.requestId
    };
  }

  private async computeHMAC(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    // Simple HMAC-SHA256 implementation
    const blockSize = 64;
    const opad = new Uint8Array(blockSize).fill(0x5c);
    const ipad = new Uint8Array(blockSize).fill(0x36);

    // Adjust key length
    let adjustedKey = key;
    if (key.length > blockSize) {
      adjustedKey = sha256(key);
    }
    if (adjustedKey.length < blockSize) {
      const temp = new Uint8Array(blockSize);
      temp.set(adjustedKey);
      adjustedKey = temp;
    }

    // XOR key with pads
    for (let i = 0; i < blockSize; i++) {
      opad[i] ^= adjustedKey[i];
      ipad[i] ^= adjustedKey[i];
    }

    // Compute HMAC
    const innerHash = sha256(new Uint8Array([...ipad, ...data]));
    return sha256(new Uint8Array([...opad, ...innerHash]));
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