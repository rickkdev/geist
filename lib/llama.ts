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
    console.log('Initializing Llama with config:', config);
    
    
    const context = await initLlama({
      model: config.modelPath,
      n_ctx: config.contextSize || 2048,
      n_threads: config.threads || 4,
    });

    llamaContext = context;
    console.log('Llama initialized successfully');
    return context;
  } catch (error) {
    console.error('Failed to initialize Llama:', error);
    throw error;
  }
}

export function getLlamaContext(): LlamaContext | null {
  return llamaContext;
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

  // Enhanced logging function
  const logGeneration = (type: 'START' | 'TOKEN' | 'TIMEOUT' | 'SUCCESS' | 'ERROR', data?: any) => {
    const timestamp = new Date().toISOString();
    const duration = Date.now() - startTime;
    
    switch (type) {
      case 'START':
        console.log(`${logPrefix} 🚀 STARTED at ${timestamp}`);
        console.log(`${logPrefix} ⚙️  Config: maxTokens=${maxTokens}, timeout=${timeoutMs}ms`);
        console.log(`${logPrefix} 📝 PROMPT (${prompt.length} chars):`);
        console.log('='.repeat(60));
        console.log(prompt);
        console.log('='.repeat(60));
        break;
        
      case 'TOKEN':
        if (tokenCount % 10 === 0) { // Log every 10th token to avoid spam
          console.log(`${logPrefix} 🔄 Token ${tokenCount}/${maxTokens} (${duration}ms)`);
        }
        break;
        
      case 'TIMEOUT':
        console.error(`${logPrefix} ⏰ TIMEOUT after ${duration}ms`);
        console.error(`${logPrefix} 📊 Stats: ${tokenCount} tokens, ${fullResponse.length} chars`);
        console.error(`${logPrefix} 💾 PARTIAL RESPONSE SAVED:`);
        console.error('='.repeat(60));
        console.error(fullResponse || '(no response received)');
        console.error('='.repeat(60));
        // Store partial response in global for developer tools access
        (global as any).__LLAMA_LAST_PARTIAL_RESPONSE = {
          prompt,
          partialResponse: fullResponse,
          tokenCount,
          duration,
          timestamp,
          reason: 'timeout'
        };
        break;
        
      case 'SUCCESS':
        const finalResponse = data as string;
        console.log(`${logPrefix} ✅ SUCCESS in ${duration}ms`);
        console.log(`${logPrefix} 📊 Stats: ${tokenCount} tokens, ${finalResponse.length} chars`);
        console.log(`${logPrefix} 📄 FINAL RESPONSE:`);
        console.log('='.repeat(60));
        console.log(finalResponse);
        console.log('='.repeat(60));
        // Store successful response in global for developer tools access
        (global as any).__LLAMA_LAST_RESPONSE = {
          prompt,
          response: finalResponse,
          tokenCount,
          duration,
          timestamp,
          reason: 'success'
        };
        break;
        
      case 'ERROR':
        console.error(`${logPrefix} ❌ ERROR after ${duration}ms`);
        console.error(`${logPrefix} 📊 Stats: ${tokenCount} tokens, ${fullResponse.length} chars`);
        console.error(`${logPrefix} 🚨 Error:`, data);
        if (fullResponse) {
          console.error(`${logPrefix} 💾 PARTIAL RESPONSE BEFORE ERROR:`);
          console.error('='.repeat(60));
          console.error(fullResponse);
          console.error('='.repeat(60));
        }
        // Store error response in global for developer tools access
        (global as any).__LLAMA_LAST_ERROR = {
          prompt,
          partialResponse: fullResponse,
          error: data,
          tokenCount,
          duration,
          timestamp,
          reason: 'error'
        };
        break;
    }
  };

  try {
    logGeneration('START');
    
    // Always perform soft reset for clean inference - prevents context pollution
    console.log('🔄 Performing soft context reset (clearing KV cache)...');
    try {
      await llamaContext.completion({ prompt: '', n_predict: 0 });
    } catch (e) {
      console.warn('Soft reset failed, continuing anyway:', e);
    }
    
    // Create timeout promise with enhanced logging
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        logGeneration('TIMEOUT');
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
          tokenCount++;
          logGeneration('TOKEN');
          
          // Token limit guard
          if (tokenCount >= maxTokens) {
            console.log(`⚠️ Token limit reached: ${tokenCount}/${maxTokens}`);
            resolve(fullResponse);
            return;
          }
          
          if (onToken) {
            onToken(data.token);
            fullResponse += data.token;
          }
        }
      }).then((response) => {
        if (!onToken) {
          fullResponse = response.text || '';
        }
        resolve(fullResponse);
      }).catch(reject);
    });
    
    // Race between completion and timeout
    const response = await Promise.race([completionPromise, timeoutPromise]);
    
    // Check for signs of hallucination or off-topic responses
    const cleanResponse = response.trim();
    
    // If response is suspiciously short or contains error indicators
    if (cleanResponse.length < 3) {
      console.warn('⚠️ Very short response detected, using fallback');
      const fallbackResponse = "I'm not sure how to answer that. Could you please rephrase your question?";
      logGeneration('SUCCESS', fallbackResponse);
      return fallbackResponse;
    }
    
    // If response seems to be repeating the prompt or contains parsing errors
    if (cleanResponse.includes('<|im_start|>') || cleanResponse.includes('<|im_end|>')) {
      console.warn('⚠️ Response contains prompt tokens, using fallback');
      const fallbackResponse = "I apologize, but I encountered an issue processing your request. Could you try asking in a different way?";
      logGeneration('SUCCESS', fallbackResponse);
      return fallbackResponse;
    }
    
    logGeneration('SUCCESS', cleanResponse);
    return cleanResponse;
  } catch (error) {
    logGeneration('ERROR', error);
    throw error;
  }
}

export async function releaseLlama(): Promise<void> {
  if (llamaContext) {
    try {
      await llamaContext.release();
      llamaContext = null;
      console.log('Llama context released');
    } catch (error) {
      console.error('Failed to release Llama context:', error);
    }
  }
}