import { useState, useEffect, useCallback, useRef } from 'react';
import { initializeLlama, generateResponse, releaseLlama, getLlamaContext, interruptGeneration } from '../lib/llama';
import { downloadModel, getModelPath } from '../lib/modelDownloader';
import { Message } from '../lib/chatStorage';
import { formatPrompt, formatSinglePrompt, formatPromptSimple } from '../lib/promptFormatter';

export interface UseLlamaReturn {
  isReady: boolean;
  loading: boolean;
  error: string | null;
  downloadProgress: number;
  ask: (
    messages: Message[],
    onToken?: (token: string) => void,
    oneShot?: boolean
  ) => Promise<string>;
  interrupt: () => void;
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
  
  const currentRequestRef = useRef<{ interrupt: () => void } | null>(null);

  const initialize = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if model exists, if not download it
      let modelPath = await getModelPath();

      if (!modelPath) {
        modelPath = await downloadModel((progress) => {
          setDownloadProgress(progress);
        });
      }

      await initializeLlama({
        modelPath,
        contextSize: 512,
        threads: 4,
        temperature: 0.6,
      });

      setIsReady(true);
      setDownloadProgress(100);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  const ask = useCallback(
    async (
      messages: Message[],
      onToken?: (token: string) => void,
      oneShot: boolean = false
    ): Promise<string> => {
      if (!isReady) {
        throw new Error('Llama is not ready. Please wait for initialization to complete.');
      }

      let interrupted = false;
      currentRequestRef.current = {
        interrupt: () => {
          interrupted = true;
        }
      };

      try {
        let formattedPrompt: string;

        if (oneShot && messages.length > 0) {
          const lastMessage = messages[messages.length - 1];
          formattedPrompt = formatSinglePrompt(lastMessage.text);
        } else {
          // Try simple format first for better compatibility with DeepSeek
          formattedPrompt = formatPromptSimple(messages);
        }

        // Wrap onToken to check for interruption
        const wrappedOnToken = onToken ? (token: string) => {
          if (!interrupted) {
            onToken(token);
          }
        } : undefined;

        const response = await generateResponse(formattedPrompt, wrappedOnToken, 256, 120000);
        
        if (interrupted) {
          throw new Error('Generation interrupted by user');
        }
        
        return response;
      } catch (err) {
        if (interrupted) {
          // Don't set error state for interruptions
          throw new Error('Generation interrupted');
        }
        const errorMessage = err instanceof Error ? err.message : 'Failed to generate response';
        setError(errorMessage);
        throw err;
      } finally {
        currentRequestRef.current = null;
      }
    },
    [isReady]
  );

  const interrupt = useCallback(() => {
    if (currentRequestRef.current) {
      currentRequestRef.current.interrupt();
    }
    // Call interruption without awaiting for speed
    interruptGeneration();
  }, []);

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
        releaseLlama().catch(() => {});
      }
    };
  }, [initialize]);

  return {
    isReady,
    loading,
    error,
    downloadProgress,
    ask,
    interrupt,
    reinitialize,
    debugMode,
    setDebugMode,
  };
}
