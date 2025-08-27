import { initLlama, LlamaContext } from 'llama.rn';

let llamaContext: LlamaContext | null = null;

export interface LlamaConfig {
  modelPath: string;
  contextSize?: number;
  threads?: number;
  temperature?: number;
  seed?: number;
}

export async function initializeLlama(config: LlamaConfig): Promise<LlamaContext> {
  try {
    
    
    const context = await initLlama({
      model: config.modelPath,
      n_ctx: config.contextSize || 2048,
      n_threads: config.threads || 4,
    });

    llamaContext = context;
    return context;
  } catch (error) {
    throw error;
  }
}

export function getLlamaContext(): LlamaContext | null {
  return llamaContext;
}

let isInterrupted = false;

export async function interruptGeneration() {
  // Set flag immediately for fastest response
  isInterrupted = true;
  
  // Call stopCompletion asynchronously without waiting
  if (llamaContext) {
    llamaContext.stopCompletion().catch((error) => {
      // Silently handle errors - the flag is already set
    });
  }
}

export async function generateResponse(
  prompt: string,
  onToken?: (token: string) => void,
  maxTokens: number = 256,
  timeoutMs: number = 45000
): Promise<string> {
  if (!llamaContext) {
    throw new Error('Llama not initialized. Call initializeLlama first.');
  }

  const logPrefix = '🤖 LLAMA GENERATION';
  let fullResponse = '';
  let tokenCount = 0;
  const startTime = Date.now();
  isInterrupted = false;


  try {
    
    // Always perform soft reset for clean inference - prevents context pollution
    try {
      await llamaContext.completion({ prompt: '', n_predict: 0 });
    } catch (e) {
      // Soft reset failed, continuing anyway
    }
    
    // Create timeout promise with enhanced logging
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Generation timeout after ${timeoutMs}ms. Partial response: "${fullResponse.slice(0, 100)}${fullResponse.length > 100 ? '...' : ''}"`));
      }, timeoutMs);
    });
    
    // Create completion promise with enhanced token logging
    const completionPromise = new Promise<string>((resolve, reject) => {
      llamaContext!.completion({
        prompt,
        n_predict: maxTokens,
        temperature: 0.8,
        top_p: 0.9,
        top_k: 50,
        stop: ['<|im_end|>', '</s>', '\n\nUser:', '\n\nuser:', '\n\nUSER:', 'User:', '\nUser:'],
      }, (data) => {
        if (data.token) {
          // Single interruption check - only when actually interrupted
          if (isInterrupted) {
            return false; // Stop immediately
          }
          
          tokenCount++;
          
          
          // Token limit guard
          if (tokenCount >= maxTokens) {
            resolve(fullResponse);
            return false;
          }
          
          // Direct token processing without checks
          if (onToken) {
            onToken(data.token);
          }
          fullResponse += data.token;
        }
      }).then((response) => {
        if (!onToken) {
          fullResponse = response.text || '';
        }
        resolve(fullResponse);
      }).catch((error) => {
        if (isInterrupted) {
          resolve(fullResponse); // Return partial response on interruption
        } else {
          reject(error);
        }
      });
    });
    
    // Race between completion and timeout
    const response = await Promise.race([completionPromise, timeoutPromise]);
    
    // Check for signs of hallucination or off-topic responses
    const cleanResponse = response.trim();
    
    // If response is suspiciously short or contains error indicators
    if (cleanResponse.length < 3) {
      const fallbackResponse = "I'm not sure how to answer that. Could you please rephrase your question?";
      return fallbackResponse;
    }
    
    // If response seems to be repeating the prompt or contains parsing errors
    if (cleanResponse.includes('<|im_start|>') || cleanResponse.includes('<|im_end|>')) {
      const fallbackResponse = "I apologize, but I encountered an issue processing your request. Could you try asking in a different way?";
      return fallbackResponse;
    }
    
    return cleanResponse;
  } catch (error) {
    throw error;
  } finally {
    // Reset the interruption flag
    isInterrupted = false;
  }
}

export async function releaseLlama(): Promise<void> {
  if (llamaContext) {
    try {
      await llamaContext.release();
      llamaContext = null;
    } catch (error) {
    }
  }
}