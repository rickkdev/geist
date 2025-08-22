// Import crypto polyfill first
import 'react-native-get-random-values';
import * as SecureStore from 'expo-secure-store';

// Use crypto-js for React Native compatibility
const CryptoJS = require('react-native-crypto-js');

// React Native compatible random bytes generator
const getRandomBytes = (length: number): Uint8Array => {
  const array = new Uint8Array(length);
  
  // Use crypto.getRandomValues if available (from polyfill)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback to Math.random
    for (let i = 0; i < length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  
  return array;
};

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
      console.log('HPKE: Generating new device keys...');
      // Generate random key pair for development
      const privateKey = getRandomBytes(32);
      const publicKey = getRandomBytes(32); // Mock public key for development

      // Store keys securely
      const privateKeyB64 = btoa(String.fromCharCode(...privateKey));
      const publicKeyB64 = btoa(String.fromCharCode(...publicKey));

      console.log('HPKE: Storing keys to SecureStore...');
      await SecureStore.setItemAsync(DEVICE_PRIVATE_KEY, privateKeyB64);
      await SecureStore.setItemAsync(DEVICE_PUBLIC_KEY, publicKeyB64);

      this.devicePrivateKey = privateKey;
      this.devicePublicKey = publicKey;
      console.log('HPKE: New keys generated and stored successfully');
    } catch (error) {
      console.error('HPKE: Failed to generate and store keys:', error);
      throw error;
    }
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
    console.log('HPKE: seal() called, checking device keys...');
    console.log('HPKE: devicePrivateKey exists:', !!this.devicePrivateKey);
    console.log('HPKE: devicePublicKey exists:', !!this.devicePublicKey);
    
    if (!this.devicePrivateKey) {
      throw new Error('Device keys not initialized');
    }

    // For development, create a simple encrypted message using crypto-js
    const requestId = Array.from(getRandomBytes(16), b => b.toString(16).padStart(2, '0')).join('');
    const timestamp = Date.now();

    // For development mode, just base64 encode the plaintext directly (no encryption)
    // This matches what the backend expects in hpke_service.py:99
    let ciphertext: string;
    try {
      // Use proper UTF-8 to base64 encoding for Unicode support
      const utf8Bytes = new TextEncoder().encode(plaintext);
      ciphertext = btoa(String.fromCharCode(...utf8Bytes));
      console.log('🔐 HPKE seal - plaintext length:', plaintext.length, 'ciphertext length:', ciphertext.length);
    } catch (error) {
      console.error('❌ HPKE seal - base64 encoding failed for plaintext:', plaintext);
      console.error('❌ Error:', error);
      throw new Error(`Base64 encoding failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Generate mock encapsulated key
    const mockKey = getRandomBytes(32);

    return {
      encapsulatedKey: btoa(String.fromCharCode(...mockKey)),
      ciphertext: ciphertext,
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

    try {
      // Decode the base64 ciphertext (crypto-js encrypted data)
      const ciphertextB64 = atob(encryptedMessage.ciphertext);
      
      // Use the same secret key as in seal method
      const secretKey = Array.from(this.devicePrivateKey).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
      
      // Decrypt using crypto-js
      const decryptedBytes = CryptoJS.AES.decrypt(ciphertextB64, secretKey);
      const decryptedText = decryptedBytes.toString(CryptoJS.enc.Utf8);
      
      // Parse the decrypted JSON data
      const data = JSON.parse(decryptedText);
      
      // Validate request ID matches
      if (data.requestId !== encryptedMessage.requestId) {
        throw new Error('Request ID mismatch');
      }

      return {
        plaintext: data.plaintext,
        timestamp: data.timestamp,
        requestId: data.requestId
      };
    } catch (error) {
      throw new Error(`Failed to decrypt message: ${error instanceof Error ? error.message : 'Unknown error'}`);
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