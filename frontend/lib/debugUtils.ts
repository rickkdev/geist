// Debug utilities for accessing logged data in developer tools

export interface LlamaLogEntry {
  prompt: string;
  response?: string;
  partialResponse?: string;
  error?: any;
  tokenCount: number;
  duration: number;
  timestamp: string;
  reason: 'success' | 'timeout' | 'error';
}

export interface ChatLogEntry {
  userMessage: string;
  partialResponse?: string;
  error?: any;
  timestamp: string;
  reason: 'timeout' | 'error';
}

// Global debug data accessors for developer tools
export const DebugLog = {
  // Get the last successful LLM response
  getLastResponse(): LlamaLogEntry | null {
    return (global as any).__LLAMA_LAST_RESPONSE || null;
  },

  // Get the last partial response from timeout
  getLastTimeout(): LlamaLogEntry | null {
    return (global as any).__LLAMA_LAST_PARTIAL_RESPONSE || null;
  },

  // Get the last error from LLM
  getLastLlamaError(): LlamaLogEntry | null {
    return (global as any).__LLAMA_LAST_ERROR || null;
  },

  // Get the last chat error
  getLastChatError(): any {
    return (global as any).__CHAT_LAST_ERROR || null;
  },

  // Get the last partial chat response
  getLastPartialChat(): ChatLogEntry | null {
    return (global as any).__CHAT_LAST_PARTIAL || null;
  },

  // Get full chat history
  getChatHistory(): any {
    return (global as any).__CHAT_HISTORY || null;
  },

  // Print all available debug data
  printAll() {
    
    const lastResponse = this.getLastResponse();
    if (lastResponse) {
    }

    const lastTimeout = this.getLastTimeout();
    if (lastTimeout) {
    }

    const lastError = this.getLastLlamaError();
    if (lastError) {
    }

    const chatHistory = this.getChatHistory();
    if (chatHistory) {
    }

  },

  // Clear all debug data
  clear() {
    delete (global as any).__LLAMA_LAST_RESPONSE;
    delete (global as any).__LLAMA_LAST_PARTIAL_RESPONSE;
    delete (global as any).__LLAMA_LAST_ERROR;
    delete (global as any).__CHAT_LAST_ERROR;
    delete (global as any).__CHAT_LAST_PARTIAL;
    delete (global as any).__CHAT_HISTORY;
  }
};

// Make DebugLog available globally in development
if (__DEV__) {
  (global as any).DebugLog = DebugLog;
}