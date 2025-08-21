import React, { useState } from 'react';
import { SafeAreaView, View, Text } from 'react-native';
import ChatList from '../components/ChatList';
import InputBar from '../components/InputBar';
import TypingIndicator from '../components/TypingIndicator';
import { useLlama } from '../hooks/useLlama';
import { useChatHistory } from '../hooks/useChatHistory';
import { Message } from '../lib/chatStorage';

const ChatScreen: React.FC = () => {
  const { messages, isLoading, addMessage, logChatHistoryForLLM } = useChatHistory();
  const { isReady, loading, error, downloadProgress, ask } = useLlama();
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');

  const handleSend = async () => {
    if (!input.trim() || !isReady) return;
    
    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      role: 'user',
      timestamp: Date.now(),
    };
    await addMessage(userMessage);
    setInput('');
    setIsTyping(true);
    setStreamingMessage('');
    
    try {
      const assistantId = (Date.now() + 1).toString();
      let fullResponse = '';
      
      // Pass the entire conversation history including the new user message
      const conversationHistory = [...messages, userMessage];
      
      console.log('🎯 CHAT HANDLER: Starting LLM request');
      console.log('📊 Conversation length:', conversationHistory.length, 'messages');
      
      const replyText = await ask(conversationHistory, (token: string) => {
        fullResponse += token;
        setStreamingMessage(fullResponse);
      });
      
      const assistantMessage: Message = {
        id: assistantId,
        text: replyText || fullResponse,
        role: 'assistant',
        timestamp: Date.now(),
      };
      await addMessage(assistantMessage);
      setStreamingMessage('');
      
      console.log('✅ CHAT HANDLER: Successfully added assistant message');
      
      // Log the entire chat history after each message exchange
      logChatHistoryForLLM();
    } catch (err) {
      console.error('💥 CHAT HANDLER: LLM request failed:', err);
      
      // Check if we have any partial response from global state
      const partialResponse = (global as any).__LLAMA_LAST_PARTIAL_RESPONSE;
      const lastError = (global as any).__LLAMA_LAST_ERROR;
      
      let errorText = 'Sorry, I encountered an error processing your message.';
      
      // If we have a partial response from timeout, use it
      if (partialResponse && partialResponse.partialResponse && partialResponse.partialResponse.trim()) {
        console.log('🔄 CHAT HANDLER: Found partial response from timeout, using it');
        console.log('Partial response length:', partialResponse.partialResponse.length);
        errorText = partialResponse.partialResponse.trim() + '\n\n[Response was cut short due to timeout]';
        
        // Store the partial response globally for developer inspection
        (global as any).__CHAT_LAST_PARTIAL = {
          userMessage: userMessage.text,
          partialResponse: partialResponse.partialResponse,
          timestamp: new Date().toISOString(),
          reason: 'timeout'
        };
      } else if (lastError && lastError.partialResponse && lastError.partialResponse.trim()) {
        console.log('🔄 CHAT HANDLER: Found partial response from error, using it');
        errorText = lastError.partialResponse.trim() + '\n\n[Response was interrupted by an error]';
        
        // Store the partial response globally for developer inspection
        (global as any).__CHAT_LAST_PARTIAL = {
          userMessage: userMessage.text,
          partialResponse: lastError.partialResponse,
          error: lastError.error,
          timestamp: new Date().toISOString(),
          reason: 'error'
        };
      }
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: errorText,
        role: 'assistant',
        timestamp: Date.now(),
      };
      await addMessage(errorMessage);
      
      // Log error details for debugging
      console.error('🔍 CHAT HANDLER: Error details logged to global.__CHAT_LAST_ERROR');
      (global as any).__CHAT_LAST_ERROR = {
        userMessage: userMessage.text,
        error: err,
        timestamp: new Date().toISOString(),
        conversationLength: [...messages, userMessage].length
      };
    } finally {
      setIsTyping(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 justify-center items-center p-5">
          <Text className="text-base text-gray-600 text-center">
            {downloadProgress > 0 && downloadProgress < 100 
              ? `Downloading model... ${Math.round(downloadProgress)}%`
              : 'Initializing AI model...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 justify-center items-center p-5">
          <Text className="text-base text-red-500 text-center mb-2">Error: {error}</Text>
          <Text className="text-sm text-gray-600 text-center">Please check your model setup</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Combine regular messages with streaming message for display
  const displayMessages = [...messages];
  if (streamingMessage) {
    displayMessages.push({
      id: 'streaming',
      text: streamingMessage,
      role: 'assistant',
      timestamp: Date.now(),
    });
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 pb-2">
        <ChatList messages={displayMessages} />
        {isTyping && !streamingMessage && <TypingIndicator />}
      </View>
      <InputBar 
        value={input} 
        onChangeText={setInput} 
        onSend={handleSend}
        disabled={!isReady || isTyping}
      />
    </SafeAreaView>
  );
};

export default ChatScreen;
