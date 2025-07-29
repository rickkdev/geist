import { useState, useEffect, useCallback } from 'react';
import { initializeLlama, generateResponse, releaseLlama, getLlamaContext } from '../lib/llama';
import { downloadModel, getModelPath } from '../lib/modelDownloader';

export interface UseLlamaReturn {
  isReady: boolean;
  loading: boolean;
  error: string | null;
  downloadProgress: number;
  ask: (prompt: string, onToken?: (token: string) => void) => Promise<string>;
  reinitialize: () => Promise<void>;
}

export function useLlama(): UseLlamaReturn {
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

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
        contextSize: 2048,
        threads: 4,
        temperature: 0.7,
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
    prompt: string, 
    onToken?: (token: string) => void
  ): Promise<string> => {
    if (!isReady) {
      throw new Error('Llama is not ready. Please wait for initialization to complete.');
    }

    try {
      const response = await generateResponse(prompt, onToken);
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
  };
}