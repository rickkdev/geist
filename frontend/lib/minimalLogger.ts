/**
 * Minimal logger that only logs prompts and final responses
 * Replaces all console.log statements to reduce noise
 */

interface ChatSession {
  prompt: string;
  response: string;
  timestamp: Date;
  mode: 'local' | 'cloud';
}

class MinimalLogger {
  private static sessions: ChatSession[] = [];

  static logChatSession(prompt: string, response: string, mode: 'local' | 'cloud') {
    const session: ChatSession = {
      prompt: prompt.trim(),
      response: response.trim(),
      timestamp: new Date(),
      mode
    };
    
    this.sessions.push(session);
    
    // Keep only last 10 sessions to prevent memory bloat
    if (this.sessions.length > 10) {
      this.sessions = this.sessions.slice(-10);
    }
    
    // Log the session
    console.log('📝 CHAT SESSION');
    console.log('═'.repeat(50));
    console.log(`🕒 ${session.timestamp.toLocaleTimeString()}`);
    console.log(`🔧 Mode: ${mode.toUpperCase()}`);
    console.log(`📥 PROMPT (${prompt.length} chars):`);
    console.log(prompt);
    console.log('─'.repeat(50));
    console.log(`📤 RESPONSE (${response.length} chars):`);
    console.log(response);
    console.log('═'.repeat(50));
    console.log('');
  }

  static getLastSession(): ChatSession | null {
    return this.sessions[this.sessions.length - 1] || null;
  }

  static getAllSessions(): ChatSession[] {
    return [...this.sessions];
  }

  static clearSessions() {
    this.sessions = [];
    console.log('🧹 Chat session history cleared');
  }
}

// Make available globally for debugging
if (typeof global !== 'undefined') {
  (global as any).__MINIMAL_LOGGER = MinimalLogger;
}

export default MinimalLogger;