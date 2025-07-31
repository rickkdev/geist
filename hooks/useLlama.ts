import { useState, useEffect, useCallback } from 'react';
import { initializeLlama, generateResponse, releaseLlama, getLlamaContext } from '../lib/llama';
import { downloadModel, getModelPath } from '../lib/modelDownloader';
import { Message } from '../lib/chatStorage';
import { formatPrompt, formatSinglePrompt } from '../lib/promptFormatter';

export interface UseLlamaReturn {
  isReady: boolean;
  loading: boolean;
  error: string | null;
  downloadProgress: number;
  ask: (messages: Message[], onToken?: (token: string) => void, oneShot?: boolean, enableHardReset?: boolean) => Promise<string>;
  reinitialize: () => Promise<void>;
  debugMode: boolean;
  setDebugMode: (enabled: boolean) => void;
}

export function useLlama(): UseLlamaReturn {
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [debugMode, setDebugMode] = useState(false);

  const initialize = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Check if model exists, if not download it
      let modelPath = await getModelPath();
      
      if (!modelPath) {
        console.log('Model not found, downloading...');
        modelPath = await downloadModel((progress) => {
          setDownloadProgress(progress);
        });
      }

      console.log('Initializing Llama with model at:', modelPath);
      
      await initializeLlama({
        modelPath,
        contextSize: 1024,
        threads: 6,
        temperature: 0.6,
      });

      setIsReady(true);
      setDownloadProgress(100);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('Failed to initialize Llama:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const ask = useCallback(async (
    messages: Message[], 
    onToken?: (token: string) => void,
    oneShot: boolean = false,
    enableHardReset: boolean = false
  ): Promise<string> => {
    if (!isReady) {
      throw new Error('Llama is not ready. Please wait for initialization to complete.');
    }

    try {
      let formattedPrompt: string;
      
      if (oneShot && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        formattedPrompt = formatSinglePrompt(lastMessage.text);
      } else {
        formattedPrompt = formatPrompt(messages);
      }
      
      const response = await generateResponse(formattedPrompt, onToken, 256, 45000, enableHardReset);
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate response';
      setError(errorMessage);
      throw err;
    }
  }, [isReady]);

  const reinitialize = useCallback(async () => {
    if (isReady && getLlamaContext()) {
      await releaseLlama();
      setIsReady(false);
    }
    await initialize();
  }, [isReady, initialize]);

  useEffect(() => {
    initialize();
    
    return () => {
      if (getLlamaContext()) {
        releaseLlama().catch(console.error);
      }
    };
  }, [initialize]);

  return {
    isReady,
    loading,
    error,
    downloadProgress,
    ask,
    reinitialize,
    debugMode,
    setDebugMode,
  };
}