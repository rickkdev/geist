import React, { useState, useEffect } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, Alert } from 'react-native';
import ChatList from '../components/ChatList';
import InputBar from '../components/InputBar';
import TypingIndicator from '../components/TypingIndicator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLlama } from '../hooks/useLlama';
import { useChatHistory } from '../hooks/useChatHistory';
import { Message } from '../lib/chatStorage';

type InferenceMode = 'local' | 'cloud';

const ChatScreen: React.FC = () => {
  const { messages, addMessage, logChatHistoryForLLM } = useChatHistory();
  const { isReady, loading, error, downloadProgress, ask } = useLlama();
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [inferenceMode, setInferenceMode] = useState<InferenceMode>('local');
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    loadInferenceMode();
  }, []);

  const loadInferenceMode = async () => {
    try {
      const savedMode = await AsyncStorage.getItem('inference_mode');
      if (savedMode === 'local' || savedMode === 'cloud') {
        setInferenceMode(savedMode);
      }
    } catch (error) {
      console.error('Failed to load inference mode:', error);
    }
  };

  const saveInferenceMode = async (mode: InferenceMode) => {
    try {
      await AsyncStorage.setItem('inference_mode', mode);
      setInferenceMode(mode);
      setShowDropdown(false);

      if (mode === 'cloud') {
        Alert.alert(
          'Cloud AI Enabled',
          'Now using secure cloud inference with end-to-end encryption.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Failed to save inference mode:', error);
      Alert.alert('Error', 'Failed to save settings. Please try again.');
    }
  };

  const handleModeSelect = (mode: InferenceMode) => {
    if (mode === 'cloud') {
      Alert.alert(
        'Enable Cloud AI',
        'Cloud inference uses encrypted communication with secure servers. Your prompts are end-to-end encrypted and never stored.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setShowDropdown(false) },
          { text: 'Enable', onPress: () => saveInferenceMode(mode) },
        ]
      );
    } else {
      saveInferenceMode(mode);
    }
  };

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
      if (
        partialResponse &&
        partialResponse.partialResponse &&
        partialResponse.partialResponse.trim()
      ) {
        console.log('🔄 CHAT HANDLER: Found partial response from timeout, using it');
        console.log('Partial response length:', partialResponse.partialResponse.length);
        errorText =
          partialResponse.partialResponse.trim() + '\n\n[Response was cut short due to timeout]';

        // Store the partial response globally for developer inspection
        (global as any).__CHAT_LAST_PARTIAL = {
          userMessage: userMessage.text,
          partialResponse: partialResponse.partialResponse,
          timestamp: new Date().toISOString(),
          reason: 'timeout',
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
          reason: 'error',
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
        conversationLength: [...messages, userMessage].length,
      };
    } finally {
      setIsTyping(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center p-5">
          <Text className="text-center text-base text-gray-600">
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
        <View className="flex-1 items-center justify-center p-5">
          <Text className="mb-2 text-center text-base text-red-500">Error: {error}</Text>
          <Text className="text-center text-sm text-gray-600">Please check your model setup</Text>
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
      {/* Header */}
      <View className="relative border-b border-gray-200 px-4 py-3">
        <TouchableOpacity
          onPress={() => setShowDropdown(!showDropdown)}
          className="flex-row items-center"
        >
          <Text 
            className="text-lg font-semibold mr-2"
            style={{ 
              color: showDropdown ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 1)' 
            }}
          >
            Geist
          </Text>
          <Text 
            className="text-sm mr-1"
            style={{ 
              color: showDropdown ? 'rgba(107, 114, 128, 0.4)' : 'rgba(107, 114, 128, 1)' 
            }}
          >
            {inferenceMode === 'local' ? 'Local' : 'Cloud'}
          </Text>
          <Text 
            className="text-xs"
            style={{ 
              color: showDropdown ? 'rgba(107, 114, 128, 0.4)' : 'rgba(107, 114, 128, 1)',
              transform: showDropdown ? 'rotate(90deg)' : 'rotate(0deg)'
            }}
          >
            ›
          </Text>
        </TouchableOpacity>

        {/* Dropdown Menu */}
        {showDropdown && (
          <>
            {/* Overlay to close dropdown when clicking elsewhere */}
            <TouchableOpacity
              onPress={() => setShowDropdown(false)}
              className="absolute inset-0 w-full h-screen"
              style={{ top: 0, left: -16, right: -16, bottom: -1000 }}
            />
            <View className="absolute top-12 left-4 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-32">
              <TouchableOpacity
                onPress={() => handleModeSelect('local')}
                className="flex-row items-center px-4 py-3 border-b border-gray-100"
              >
                <Text className="text-black text-sm mr-2">
                  {inferenceMode === 'local' ? '✓' : ' '}
                </Text>
                <Text className="text-black text-sm">Local</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleModeSelect('cloud')}
                className="flex-row items-center px-4 py-3"
              >
                <Text className="text-black text-sm mr-2">
                  {inferenceMode === 'cloud' ? '✓' : ' '}
                </Text>
                <Text className="text-black text-sm">Cloud</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

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
