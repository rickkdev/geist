import { initLlama, LlamaContext, LlamaGrammar } from 'llama.rn';

let llamaContext: LlamaContext | null = null;
let llamaConfig: LlamaConfig | null = null;

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
    
    // Store config for context resets
    llamaConfig = config;
    
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
  maxTokens: number = 512,
  timeoutMs: number = 30000
): Promise<string> {
  if (!llamaContext) {
    throw new Error('Llama not initialized. Call initializeLlama first.');
  }

  try {
    // Reset context to ensure clean state
    if (llamaConfig) {
      console.log('🔄 Resetting Llama context before generation...');
      await llamaContext.release();
      
      // Re-initialize context (this clears previous conversation state)
      const context = await initLlama({
        model: llamaConfig.modelPath,
        n_ctx: llamaConfig.contextSize || 2048,
        n_threads: llamaConfig.threads || 4,
      });
      llamaContext = context;
    }
    
    // Log the full prompt being sent to the model for debugging
    console.log('🧠 Full Prompt being sent to model:');
    console.log('='.repeat(50));
    console.log(prompt);
    console.log('='.repeat(50));
    
    let fullResponse = '';
    let tokenCount = 0;
    const startTime = Date.now();
    
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Generation timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    
    // Create completion promise
    const completionPromise = new Promise<string>((resolve, reject) => {
      llamaContext!.completion({
        prompt,
        n_predict: maxTokens,
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        stop: ['<|im_end|>', '</s>', '\n\nUser:', '\n\nuser:', '\n\nUSER:'],
      }, (data) => {
        if (data.token) {
          tokenCount++;
          
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
    
    const endTime = Date.now();
    console.log(`✅ Response generated in ${endTime - startTime}ms, tokens: ${tokenCount}, length: ${response.length}`);
    
    // Check for signs of hallucination or off-topic responses
    const cleanResponse = response.trim();
    
    // If response is suspiciously short or contains error indicators
    if (cleanResponse.length < 3) {
      console.warn('⚠️ Very short response detected, using fallback');
      return "I'm not sure how to answer that. Could you please rephrase your question?";
    }
    
    // If response seems to be repeating the prompt or contains parsing errors
    if (cleanResponse.includes('<|im_start|>') || cleanResponse.includes('<|im_end|>')) {
      console.warn('⚠️ Response contains prompt tokens, using fallback');
      return "I apologize, but I encountered an issue processing your request. Could you try asking in a different way?";
    }
    
    return cleanResponse;
  } catch (error) {
    console.error('❌ Failed to generate response:', error);
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