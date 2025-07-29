import { initLlama, LlamaContext, LlamaGrammar } from 'llama.rn';

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
      seed: config.seed || -1,
      temperature: config.temperature || 0.7,
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
  onToken?: (token: string) => void
): Promise<string> {
  if (!llamaContext) {
    throw new Error('Llama not initialized. Call initializeLlama first.');
  }

  try {
    console.log('Generating response for prompt:', prompt.substring(0, 100) + '...');
    
    let fullResponse = '';
    
    const response = await llamaContext.completion({
      prompt,
      n_predict: 512,
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.1,
      stream: !!onToken,
    }, (data) => {
      if (onToken && data.token) {
        onToken(data.token);
        fullResponse += data.token;
      }
    });

    if (!onToken) {
      fullResponse = response.text || '';
    }

    console.log('Response generated, length:', fullResponse.length);
    return fullResponse;
  } catch (error) {
    console.error('Failed to generate response:', error);
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