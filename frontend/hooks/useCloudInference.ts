import { useState, useEffect, useRef, useCallback } from 'react';
import CloudInferenceClient, { 
  CloudInferenceConfig, 
  CloudMessage, 
  CloudInferenceError,
  defaultCloudConfig 
} from '../lib/cloudInference';

export interface UseCloudInferenceOptions {
  config?: Partial<CloudInferenceConfig>;
  autoInitialize?: boolean;
}

export interface CloudInferenceState {
  isInitialized: boolean;
  isConnected: boolean;
  isLoading: boolean;
  isGenerating: boolean;
  error: string | null;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
}

export interface UseCloudInferenceResult extends CloudInferenceState {
  ask: (messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, onToken?: (token: string) => void) => Promise<void>;
  testConnection: () => Promise<boolean>;
  initialize: () => Promise<void>;
  clearError: () => void;
  disconnect: () => void;
}

export function useCloudInference(options: UseCloudInferenceOptions = {}): UseCloudInferenceResult {
  const { 
    config = {},
    autoInitialize = true 
  } = options;

  const [state, setState] = useState<CloudInferenceState>({
    isInitialized: false,
    isConnected: false,
    isLoading: false,
    isGenerating: false,
    error: null,
    connectionStatus: 'disconnected'
  });

  const clientRef = useRef<CloudInferenceClient | null>(null);
  const currentRequestRef = useRef<string | null>(null);

  // Merge default config with provided config
  const fullConfig: CloudInferenceConfig = {
    ...defaultCloudConfig,
    ...config
  };

  const updateState = useCallback((updates: Partial<CloudInferenceState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const initialize = useCallback(async () => {
    if (state.isInitialized || state.isLoading) {
      return;
    }

    updateState({ isLoading: true, connectionStatus: 'connecting' });

    try {
      const client = new CloudInferenceClient(fullConfig);
      await client.initialize();
      
      clientRef.current = client;
      
      updateState({
        isInitialized: true,
        isLoading: false,
        connectionStatus: 'connected',
        isConnected: true,
        error: null
      });
    } catch (error) {
      console.error('Failed to initialize cloud inference client:', error);
      updateState({
        isLoading: false,
        connectionStatus: 'error',
        isConnected: false,
        error: error instanceof Error ? error.message : 'Failed to initialize cloud inference'
      });
      throw error; // Re-throw so caller can handle
    }
  }, [state.isInitialized, state.isLoading, fullConfig, updateState]);

  const testConnection = useCallback(async (): Promise<boolean> => {
    if (!clientRef.current) {
      await initialize();
      if (!clientRef.current) {
        return false;
      }
    }

    updateState({ isLoading: true });

    try {
      const result = await clientRef.current.testConnection();
      updateState({ 
        isLoading: false,
        isConnected: result.success,
        connectionStatus: result.success ? 'connected' : 'error',
        error: result.success ? null : result.error || 'Connection test failed'
      });
      return result.success;
    } catch (error) {
      updateState({
        isLoading: false,
        isConnected: false,
        connectionStatus: 'error',
        error: error instanceof Error ? error.message : 'Connection test failed'
      });
      return false;
    }
  }, [initialize, updateState]);

  const ask = useCallback(async (
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    onToken?: (token: string) => void
  ): Promise<void> => {
    if (!clientRef.current) {
      // Try to initialize if not already done
      await initialize();
      if (!clientRef.current) {
        throw new Error('Cloud inference client not initialized');
      }
    }

    if (state.isGenerating) {
      throw new Error('Already generating a response');
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    currentRequestRef.current = requestId;

    updateState({ 
      isGenerating: true, 
      error: null 
    });

    try {
      const cloudMessage: CloudMessage = {
        messages,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 2000,
        request_id: requestId,
        stream: true
      };

      const response = await clientRef.current.sendMessage(cloudMessage, onToken);
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to send message');
      }

      updateState({ 
        isGenerating: false,
        isConnected: true,
        connectionStatus: 'connected'
      });
    } catch (error) {
      console.error('Cloud inference error:', error);
      
      let errorMessage = 'Unknown error occurred';
      let shouldRetry = false;
      
      if (error instanceof CloudInferenceError) {
        errorMessage = error.message;
        shouldRetry = error.retryable;
        
        // Update connection status based on error type
        if (error.code === 'NETWORK_ERROR' || error.code === 'REQUEST_FAILED') {
          updateState({ 
            connectionStatus: 'error',
            isConnected: false 
          });
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      updateState({ 
        isGenerating: false,
        error: errorMessage
      });

      throw error;
    } finally {
      currentRequestRef.current = null;
    }
  }, [state.isGenerating, updateState]);

  const clearError = useCallback(() => {
    updateState({ error: null });
  }, [updateState]);

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.clearSensitiveData();
      clientRef.current = null;
    }
    
    updateState({
      isInitialized: false,
      isConnected: false,
      connectionStatus: 'disconnected',
      error: null,
      isGenerating: false,
      isLoading: false
    });
  }, [updateState]);

  // Auto-initialize if requested
  useEffect(() => {
    if (autoInitialize && !state.isInitialized && !state.isLoading) {
      initialize();
    }
  }, [autoInitialize, state.isInitialized, state.isLoading, initialize]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.clearSensitiveData();
      }
    };
  }, []);

  return {
    ...state,
    ask,
    testConnection,
    initialize,
    clearError,
    disconnect
  };
}

export default useCloudInference;