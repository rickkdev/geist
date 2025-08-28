/**
 * Harmony Response Channel Parser for React Native
 * 
 * Properly parses Harmony-formatted responses to extract only the final user-facing content
 * while filtering out analysis/reasoning channel content.
 */

export interface HarmonyChannels {
  final: string[];
  analysis: string[];
  commentary: string[];
}

export class HarmonyResponseDecoder {
  private currentChannel: 'final' | 'analysis' | 'commentary' | null = null;
  private channels: HarmonyChannels = {
    final: [],
    analysis: [],
    commentary: []
  };
  private awaitingChannelName = false;
  private awaitingMessage = false;

  /**
   * Process a decrypted token and determine if it should be included in the final response
   */
  processToken(token: string): { shouldInclude: boolean; isComplete: boolean } {
    // TEMPORARY FIX: For gpt-oss models without proper Harmony formatting,
    // include all content that isn't control tokens
    
    // Skip only truly empty tokens, but preserve space-only tokens
    if (!token || token === '') {
      return { shouldInclude: false, isComplete: false };
    }
    
    // Handle Harmony control tokens (filter these out)
    if (token === '<|channel|>') {
      this.awaitingChannelName = true;
      return { shouldInclude: false, isComplete: false };
    }
    
    if (this.awaitingChannelName) {
      if (token === 'final' || token === 'analysis' || token === 'commentary') {
        this.currentChannel = token as 'final' | 'analysis' | 'commentary';
        this.awaitingChannelName = false;
        return { shouldInclude: false, isComplete: false };
      }
    }
    
    if (token === '<|message|>') {
      this.awaitingMessage = true;
      return { shouldInclude: false, isComplete: false };
    }
    
    // Check for completion markers first
    if (token === '<|end|>') {
      return { shouldInclude: false, isComplete: true };
    }
    
    // Handle other control tokens (filter these out)
    if (['<|start|>', '<|return|>', '<|system|>', '<|user|>', '<|assistant|>'].includes(token)) {
      return { shouldInclude: false, isComplete: false };
    }
    
    // Process content based on current channel (proper Harmony format)
    if (this.currentChannel && this.awaitingMessage) {
      this.channels[this.currentChannel].push(token);
      
      // Only include content from the "final" channel in the user response
      const shouldInclude = this.currentChannel === 'final';
      return { shouldInclude, isComplete: false };
    }
    
    // TEMPORARY: For gpt-oss without proper Harmony, include all non-control content
    return { shouldInclude: true, isComplete: false };
  }
  
  /**
   * Get the final user-facing response
   */
  getFinalResponse(): string {
    return this.channels.final.join('');
  }
  
  /**
   * Get the analysis/reasoning content (for debugging)
   */
  getAnalysisContent(): string {
    return this.channels.analysis.join('');
  }
  
  /**
   * Get all channels for debugging
   */
  getAllChannels(): HarmonyChannels {
    return { ...this.channels };
  }
  
  /**
   * Reset the decoder state
   */
  reset(): void {
    this.currentChannel = null;
    this.channels = {
      final: [],
      analysis: [],
      commentary: []
    };
    this.awaitingChannelName = false;
    this.awaitingMessage = false;
  }
  
  /**
   * Get debug information about parsing state
   */
  getDebugInfo(): {
    currentChannel: string | null;
    channelLengths: Record<string, number>;
    awaitingChannelName: boolean;
    awaitingMessage: boolean;
  } {
    return {
      currentChannel: this.currentChannel,
      channelLengths: {
        final: this.channels.final.length,
        analysis: this.channels.analysis.length,
        commentary: this.channels.commentary.length
      },
      awaitingChannelName: this.awaitingChannelName,
      awaitingMessage: this.awaitingMessage
    };
  }
}