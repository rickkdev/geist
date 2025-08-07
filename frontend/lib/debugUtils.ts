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
    console.log('🔍 DEBUG LOG SUMMARY');
    console.log('='.repeat(50));
    
    const lastResponse = this.getLastResponse();
    if (lastResponse) {
      console.log('✅ Last Successful Response:');
      console.log(`   Duration: ${lastResponse.duration}ms`);
      console.log(`   Tokens: ${lastResponse.tokenCount}`);
      console.log(`   Length: ${lastResponse.response?.length || 0} chars`);
      console.log(`   Time: ${lastResponse.timestamp}`);
    }

    const lastTimeout = this.getLastTimeout();
    if (lastTimeout) {
      console.log('⏰ Last Timeout:');
      console.log(`   Duration: ${lastTimeout.duration}ms`);
      console.log(`   Tokens: ${lastTimeout.tokenCount}`);
      console.log(`   Partial: ${lastTimeout.partialResponse?.length || 0} chars`);
      console.log(`   Time: ${lastTimeout.timestamp}`);
    }

    const lastError = this.getLastLlamaError();
    if (lastError) {
      console.log('❌ Last LLM Error:');
      console.log(`   Duration: ${lastError.duration}ms`);
      console.log(`   Tokens: ${lastError.tokenCount}`);
      console.log(`   Error: ${lastError.error?.message || 'Unknown'}`);
      console.log(`   Time: ${lastError.timestamp}`);
    }

    const chatHistory = this.getChatHistory();
    if (chatHistory) {
      console.log('💬 Chat History:');
      console.log(`   Messages: ${chatHistory.messageCount}`);
      console.log(`   Last Update: ${chatHistory.timestamp}`);
    }

    console.log('='.repeat(50));
    console.log('💡 Access individual logs:');
    console.log('   DebugLog.getLastResponse()');
    console.log('   DebugLog.getLastTimeout()');
    console.log('   DebugLog.getLastLlamaError()');
    console.log('   DebugLog.getLastChatError()');
    console.log('   DebugLog.getLastPartialChat()');
    console.log('   DebugLog.getChatHistory()');
  },

  // Clear all debug data
  clear() {
    delete (global as any).__LLAMA_LAST_RESPONSE;
    delete (global as any).__LLAMA_LAST_PARTIAL_RESPONSE;
    delete (global as any).__LLAMA_LAST_ERROR;
    delete (global as any).__CHAT_LAST_ERROR;
    delete (global as any).__CHAT_LAST_PARTIAL;
    delete (global as any).__CHAT_HISTORY;
    console.log('🧹 Debug logs cleared');
  }
};

// Make DebugLog available globally in development
if (__DEV__) {
  (global as any).DebugLog = DebugLog;
  console.log('🔧 DebugLog available globally. Type "DebugLog.printAll()" in developer tools.');
}