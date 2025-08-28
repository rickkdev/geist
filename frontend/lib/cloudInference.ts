import HPKEClient, { HPKEEncryptedMessage } from './hpkeClient';
import { sha256 } from '@noble/hashes/sha256';
import { HarmonyResponseDecoder } from './harmonyDecoder';

export interface CloudInferenceConfig {
  routerUrl: string;
  timeout: number;
  maxRetries: number;
  certificateFingerprint?: string; // Optional SHA256 fingerprint for certificate pinning
}

export interface CloudMessage {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  request_id: string;
  stream?: boolean;
}

export interface CloudInferenceResponse {
  success: boolean;
  error?: string;
}

export interface RouterPublicKeys {
  current_pubkey: string;
  next_pubkey: string;
  key_id: string;
  expires_at: string;
  algorithm: string;
}

export class CloudInferenceError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'CloudInferenceError';
  }
}

export class CloudInferenceClient {
  private hpkeClient: HPKEClient;
  private config: CloudInferenceConfig;
  private cachedPublicKeys: RouterPublicKeys | null = null;
  private keysCacheExpiry: number = 0;
  private requestFingerprint: string | null = null;
  private harmonyDecoder: HarmonyResponseDecoder;

  constructor(config: CloudInferenceConfig) {
    this.config = config;
    this.hpkeClient = new HPKEClient();
    this.harmonyDecoder = new HarmonyResponseDecoder();
  }

  async initialize(): Promise<void> {
    await this.hpkeClient.initialize();
  }

  async getRouterPublicKeys(): Promise<RouterPublicKeys> {
    // Return cached keys if still valid
    if (this.cachedPublicKeys && Date.now() < this.keysCacheExpiry) {
      return this.cachedPublicKeys;
    }

    try {
      const response = await this.fetchWithSecurity(`${this.config.routerUrl}/api/pubkey`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new CloudInferenceError(
          `Failed to fetch router public keys: ${response.status}`,
          'PUBKEY_FETCH_ERROR',
          response.status >= 500
        );
      }

      const keys: RouterPublicKeys = await response.json();


      // Validate response format
      if (!keys.current_pubkey || !keys.algorithm) {
        throw new CloudInferenceError(
          'Invalid public keys response format',
          'INVALID_PUBKEY_FORMAT'
        );
      }

      // Check for key rotation
      await this.handleKeyRotation(keys);

      // Cache keys for 10 minutes
      this.cachedPublicKeys = keys;
      this.keysCacheExpiry = Date.now() + 10 * 60 * 1000;

      return keys;
    } catch (error) {
      if (error instanceof CloudInferenceError) {
        throw error;
      }
      throw new CloudInferenceError(
        `Network error fetching public keys: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NETWORK_ERROR',
        true
      );
    }
  }

  async sendMessage(
    message: CloudMessage,
    onToken?: (token: string) => void,
    abortSignal?: AbortSignal
  ): Promise<CloudInferenceResponse> {
    return this.sendMessageWithRetry(message, onToken, 0, abortSignal);
  }

  private async sendMessageWithRetry(
    message: CloudMessage,
    onToken?: (token: string) => void,
    attempt: number = 0,
    abortSignal?: AbortSignal
  ): Promise<CloudInferenceResponse> {
    try {
      // Ensure HPKE client is initialized
      await this.hpkeClient.initialize();

      // Get router public keys
      const keys = await this.getRouterPublicKeys();

      // Encrypt the message using HPKE
      const messageJson = JSON.stringify(message);

      const encryptedMessage = await this.hpkeClient.seal(messageJson, keys.current_pubkey);

      // Prepare request payload
      const requestPayload = {
        encapsulated_key: encryptedMessage.encapsulatedKey,
        ciphertext: encryptedMessage.ciphertext,
        aad: btoa('geist-mobile-app'), // Additional authenticated data
        timestamp: encryptedMessage.timestamp,
        request_id: encryptedMessage.requestId,
        device_pubkey: this.hpkeClient.getDevicePublicKey(),
      };

      // Send request to router
      const response = await this.fetchWithSecurity(`${this.config.routerUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(requestPayload),
        signal: abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const isRetryable = response.status >= 500 || response.status === 429;
        const error = new CloudInferenceError(
          `Request failed: ${response.status} - ${errorText}`,
          response.status === 429 ? 'RATE_LIMITED' : 'REQUEST_FAILED',
          isRetryable
        );

        // Handle rate limiting with backoff
        if (response.status === 429 && attempt < this.config.maxRetries) {
          const retryAfter = response.headers.get('retry-after');
          const delay = retryAfter
            ? parseInt(retryAfter) * 1000
            : this.calculateBackoffDelay(attempt);
          await this.sleep(delay);
          return this.sendMessageWithRetry(message, onToken, attempt + 1, abortSignal);
        }

        throw error;
      }

      // Handle streaming response for React Native
      if (onToken) {
        await this.processStreamingResponse(response, onToken, abortSignal);
        return { success: true };
      } else {
        // Non-streaming mode - collect all tokens
        let fullResponse = '';
        await this.processStreamingResponse(response, (token) => {
          fullResponse += token;
        }, abortSignal);

        return { success: true };
      }
    } catch (error) {
      if (error instanceof CloudInferenceError) {
        // Retry logic for retryable errors
        if (error.retryable && attempt < this.config.maxRetries) {
          const delay = this.calculateBackoffDelay(attempt);
          await this.sleep(delay);
          return this.sendMessageWithRetry(message, onToken, attempt + 1, abortSignal);
        }
        throw error;
      }

      // Convert network/timeout errors to CloudInferenceError
      const isNetworkError =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('fetch') ||
          error.message.includes('network') ||
          error.message.includes('timeout'));

      const cloudError = new CloudInferenceError(
        `${isNetworkError ? 'Network' : 'Unexpected'} error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isNetworkError ? 'NETWORK_ERROR' : 'UNEXPECTED_ERROR',
        isNetworkError
      );

      // Retry network errors
      if (isNetworkError && attempt < this.config.maxRetries) {
        const delay = this.calculateBackoffDelay(attempt);
        await this.sleep(delay);
        return this.sendMessageWithRetry(message, onToken, attempt + 1, abortSignal);
      }

      throw cloudError;
    }
  }

  private calculateBackoffDelay(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s...
    const baseDelay = 1000;
    const maxDelay = 15000; // Cap at 15 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return Math.floor(delay + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async processStreamingResponse(
    response: Response,
    onToken: (token: string) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    // Reset Harmony decoder for new request
    this.harmonyDecoder.reset();
    
    try {

      // For React Native, try to use the reader if available
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            // Check if aborted
            if (abortSignal?.aborted) {
              break;
            }
            
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE events
            const events = this.parseSSEEvents(buffer);
            buffer = events.remaining;

            for (const event of events.events) {
              // Check if aborted before processing each event
              if (abortSignal?.aborted) {
                throw new Error('Request aborted');
              }
              
              try {
                const decryptedToken = await this.decryptSSEEvent(event);
                if (decryptedToken) {
                  onToken(decryptedToken);
                }
              } catch (error) {
                if (error instanceof Error && error.message === 'Request aborted') {
                  throw error;
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      } else {
        // Fallback to reading entire response as text
        const responseText = await response.text();

        // Process the complete response as SSE events
        const events = this.parseSSEEvents(responseText);

        for (const event of events.events) {
          // Check if aborted before processing each event (fallback mode)
          if (abortSignal?.aborted) {
            throw new Error('Request aborted');
          }
          
          try {
            const decryptedToken = await this.decryptSSEEvent(event);
            if (decryptedToken) {
              onToken(decryptedToken);
              // Small delay to maintain streaming effect without being sluggish
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          } catch (error) {
            if (error instanceof Error && error.message === 'Request aborted') {
              throw error;
            }
          }
        }
      }
    } catch (error) {
      // Check if this was an abort (interruption) - don't log as error
      if (error instanceof Error && error.message === 'Request aborted') {
        throw error; // Re-throw for the hook to handle
      }
      throw new CloudInferenceError(
        `Stream processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STREAM_PROCESSING_ERROR'
      );
    }
  }

  private parseSSEEvents(buffer: string): { events: string[]; remaining: string } {
    const events: string[] = [];
    const lines = buffer.split(/\r?\n/); // Handle both \r\n and \n
    let currentEvent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line === '') {
        // Empty line indicates end of event
        if (currentEvent.length > 0) {
          events.push(currentEvent.join('\n'));
          currentEvent = [];
        }
      } else if (
        line.startsWith('event:') ||
        line.startsWith('data:') ||
        line.startsWith('id:') ||
        line.startsWith('retry:')
      ) {
        // Valid SSE line - add to current event
        currentEvent.push(line);
      } else {
        // Handle continuation lines (though not expected in our format)
        if (currentEvent.length > 0) {
          currentEvent.push(line);
        }
      }
    }

    // Return any remaining incomplete event
    const remaining = currentEvent.length > 0 ? currentEvent.join('\n') : '';
    return { events, remaining };
  }

  private async decryptSSEEvent(eventData: string): Promise<string | null> {
    try {
      // Parse SSE format looking for data lines
      const dataMatch = eventData.match(/^data:\s*(.+)$/m);
      if (!dataMatch) {
        return null;
      }

      const chunkData = dataMatch[1].trim();

      // Skip SSE control messages
      if (chunkData === '[DONE]' || chunkData === 'ping' || chunkData === '') {
        return null;
      }

      try {
        // Parse the encrypted chunk JSON
        const encryptedChunk = JSON.parse(chunkData);

        if (!encryptedChunk.ciphertext) {
          return null;
        }

        // For development, the backend sends base64-encoded text chunks
        try {

          // Validate base64 format before decoding
          const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
          if (!base64Pattern.test(encryptedChunk.ciphertext)) {
            return null;
          }

          // The backend sends base64-encoded text in ciphertext field
          // Use proper UTF-8 decoding for Unicode support
          const base64Decoded = atob(encryptedChunk.ciphertext);
          const utf8Bytes = new Uint8Array(base64Decoded.length);
          for (let i = 0; i < base64Decoded.length; i++) {
            utf8Bytes[i] = base64Decoded.charCodeAt(i);
          }
          const decryptedText = new TextDecoder().decode(utf8Bytes);

          // Skip only truly empty chunks, but preserve space-only tokens
          if (!decryptedText || decryptedText === '') {
            return null;
          }

          // Use Harmony decoder to properly parse channels
          const { shouldInclude, isComplete } = this.harmonyDecoder.processToken(decryptedText);
          
          if (shouldInclude) {
            return decryptedText;
          } else {
            return null;
          }
        } catch (error) {
          return null;
        }
      } catch (parseError) {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  private async handleKeyRotation(keys: RouterPublicKeys): Promise<void> {
    try {
      const expiryTime = new Date(keys.expires_at).getTime();
      const timeUntilExpiry = expiryTime - Date.now();

      // Force refresh if keys are expired or expiring soon
      if (timeUntilExpiry < 300000) {
        // 5 minutes
        this.cachedPublicKeys = null;
        this.keysCacheExpiry = 0;
      }
    } catch (error) {
      // Silent error handling for key rotation
    }
  }

  private async validateCertificate(response: Response): Promise<void> {
    if (!this.config.certificateFingerprint) {
      return; // Certificate pinning not configured
    }

    try {
      // Check for server-provided certificate fingerprint in headers
      const serverFingerprint = response.headers.get('x-cert-fingerprint');

      if (!serverFingerprint) {
        return;
      }

      if (serverFingerprint !== this.config.certificateFingerprint) {
        throw new CloudInferenceError(
          'Certificate fingerprint mismatch - potential MITM attack',
          'CERT_PINNING_FAILED'
        );
      }

    } catch (error) {
      if (error instanceof CloudInferenceError) {
        throw error;
      }
      throw new CloudInferenceError(
        `Certificate validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CERT_VALIDATION_ERROR'
      );
    }
  }

  private async generateRequestFingerprint(): Promise<string> {
    if (this.requestFingerprint) {
      return this.requestFingerprint;
    }

    // Generate a unique fingerprint for this app instance
    const deviceInfo = {
      timestamp: Date.now(),
      random: Math.random().toString(36),
      userAgent: navigator.userAgent || 'GeistApp',
    };

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(deviceInfo));
    const hashArray = new Uint8Array(sha256(data));

    this.requestFingerprint = Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 16); // Use first 16 chars

    return this.requestFingerprint;
  }

  private async fetchWithSecurity(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const secureOptions = {
        ...options,
        signal: options.signal || controller.signal, // Use provided signal or fallback to timeout
        headers: {
          ...options.headers,
          'User-Agent': 'GeistApp/1.0',
          'X-Requested-With': 'GeistMobileApp',
          'X-Request-Fingerprint': await this.generateRequestFingerprint(),
        },
      };

      const response = await fetch(url, secureOptions);
      clearTimeout(timeoutId);

      // Validate certificate if pinning is configured
      await this.validateCertificate(response);

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const keys = await this.getRouterPublicKeys();

      // Test with a simple health check message
      const testMessage: CloudMessage = {
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        request_id: `test-${Date.now()}`,
        stream: true,
      };

      await this.sendMessage(testMessage);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof CloudInferenceError ? error.message : 'Unknown error',
      };
    }
  }

  clearSensitiveData(): void {
    this.hpkeClient.clearSensitiveData();
    this.cachedPublicKeys = null;
    this.keysCacheExpiry = 0;
    this.requestFingerprint = null;
  }
}

// Development configuration
export const defaultCloudConfig: CloudInferenceConfig = {
  routerUrl: 'http://localhost:8000', // Development default
  timeout: 30000, // 30 seconds
  maxRetries: 3,
};

// Production configuration template
export const productionCloudConfig: CloudInferenceConfig = {
  routerUrl: 'https://your-production-domain.com', // Replace with actual production URL
  timeout: 30000, // 30 seconds
  maxRetries: 3,
  certificateFingerprint: 'sha256:ABC123...', // Replace with actual certificate fingerprint
};

// Configuration factory
export function createCloudConfig(
  environment: 'development' | 'production' = 'development'
): CloudInferenceConfig {
  return environment === 'production' ? productionCloudConfig : defaultCloudConfig;
}

export default CloudInferenceClient;
