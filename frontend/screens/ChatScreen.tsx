import React, { useState, useEffect } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, Alert } from 'react-native';
import ChatList from '../components/ChatList';
import InputBar from '../components/InputBar';
import TypingIndicator from '../components/TypingIndicator';
import CloudInferenceErrorBoundary from '../components/CloudInferenceErrorBoundary';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLlama } from '../hooks/useLlama';
import { useCloudInference } from '../hooks/useCloudInference';
import { useChatHistory } from '../hooks/useChatHistory';
import { Message } from '../lib/chatStorage';

type InferenceMode = 'local' | 'cloud';

const ChatScreen: React.FC = () => {
  const { messages, addMessage, logChatHistoryForLLM } = useChatHistory();
  const { isReady, loading, error, downloadProgress, ask } = useLlama();
  const { 
    isInitialized: cloudInitialized, 
    isLoading: cloudLoading,
    isGenerating: cloudGenerating,
    error: cloudError,
    connectionStatus,
    isRetrying,
    retryAttempt,
    rateLimitedUntil,
    ask: askCloud,
    clearError: clearCloudError,
    initialize: initializeCloud
  } = useCloudInference({ autoInitialize: false });
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [inferenceMode, setInferenceMode] = useState<InferenceMode>('local');
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    loadInferenceMode();
  }, []);

  // Initialize cloud inference when mode changes to cloud
  useEffect(() => {
    if (inferenceMode === 'cloud' && !cloudInitialized && !cloudLoading) {
      initializeCloud().catch(error => {
        console.error('Auto-initialization failed:', error);
      });
    }
  }, [inferenceMode, cloudInitialized, cloudLoading, initializeCloud]);

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
    } else if (mode === 'local') {
      Alert.alert(
        'Switch to Local AI',
        'Local inference uses the AI model running directly on your device. This provides privacy but with lower quality responses.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setShowDropdown(false) },
          { text: 'Switch', onPress: () => saveInferenceMode(mode) },
        ]
      );
    } else {
      saveInferenceMode(mode);
    }
  };

  const handleSend = async () => {
    // Initialize cloud inference if needed
    if (inferenceMode === 'cloud' && !cloudInitialized && !cloudLoading) {
      try {
        await initializeCloud();
      } catch (error) {
        console.error('Failed to initialize cloud inference:', error);
        return;
      }
    }
    
    // Check readiness based on inference mode
    const isInferenceReady = inferenceMode === 'local' ? isReady : cloudInitialized;
    const isCurrentlyGenerating = inferenceMode === 'local' ? isTyping : cloudGenerating;
    
    if (!input.trim() || !isInferenceReady || isCurrentlyGenerating) return;

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

    // Clear any previous cloud errors
    if (cloudError) {
      clearCloudError();
    }

    try {
      const assistantId = (Date.now() + 1).toString();
      let fullResponse = '';

      // Pass the entire conversation history including the new user message
      const conversationHistory = [...messages, userMessage];

      console.log('🎯 CHAT HANDLER: Starting', inferenceMode, 'LLM request');
      console.log('📊 Conversation length:', conversationHistory.length, 'messages');

      let replyText: string | undefined;
      
      if (inferenceMode === 'cloud') {
        // Use cloud inference
        const cloudMessages = conversationHistory.map(msg => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.text
        }));
        
        await askCloud(cloudMessages, (token: string) => {
          fullResponse += token;
          setStreamingMessage(fullResponse);
        });
        
        replyText = fullResponse;
      } else {
        // Use local inference
        replyText = await ask(conversationHistory, (token: string) => {
          fullResponse += token;
          setStreamingMessage(fullResponse);
        });
      }

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
      console.error('💥 CHAT HANDLER:', inferenceMode, 'LLM request failed:', err);

      let errorText = `Sorry, I encountered an error processing your message${inferenceMode === 'cloud' ? ' (cloud inference)' : ' (local inference)'}.`;
      
      // Handle cloud inference errors differently
      if (inferenceMode === 'cloud') {
        let fallbackMessage = '';
        
        if (cloudError) {
          // Parse error type for better user messaging
          if (cloudError.includes('Network error') || cloudError.includes('fetch failed')) {
            fallbackMessage = '🌐 Unable to reach cloud servers. Please check your internet connection and try again.';
          } else if (cloudError.includes('Rate limited') || cloudError.includes('429')) {
            fallbackMessage = '⏳ Cloud servers are busy. Please wait a moment and try again.';
          } else if (cloudError.includes('timeout')) {
            fallbackMessage = '⏱️ Cloud request timed out. The servers may be overloaded. Please try again.';
          } else if (cloudError.includes('500') || cloudError.includes('502') || cloudError.includes('503')) {
            fallbackMessage = '🔧 Cloud servers are temporarily unavailable. Please try again in a few moments.';
          } else {
            fallbackMessage = `💥 Cloud inference error: ${cloudError}`;
          }
          errorText = fallbackMessage;
        } else if (err instanceof Error) {
          if (err.message.includes('Network Error') || err.message.includes('fetch')) {
            errorText = '🌐 Network connection failed. Please check your internet and try again.';
          } else if (err.message.includes('timeout')) {
            errorText = '⏱️ Request timed out. The cloud service may be overloaded.';
          } else {
            errorText = `💥 Cloud inference failed: ${err.message}`;
          }
        }
        
        // If we have streaming message, preserve it with context
        if (streamingMessage && streamingMessage.trim()) {
          errorText = streamingMessage.trim() + '\n\n[⚠️ Response interrupted - ' + (fallbackMessage || 'Cloud connection lost') + ']';
        }
        
        // Add suggestion to switch to local mode for persistent issues
        if (cloudError && (cloudError.includes('Network') || cloudError.includes('timeout') || cloudError.includes('500'))) {
          errorText += '\n\n💡 Consider switching to Local mode for offline use.';
        }
      } else {
        // Handle local inference errors (existing logic)
        const partialResponse = (global as any).__LLAMA_LAST_PARTIAL_RESPONSE;
        const lastError = (global as any).__LLAMA_LAST_ERROR;

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
        inferenceMode,
        timestamp: new Date().toISOString(),
        conversationLength: [...messages, userMessage].length,
      };
    } finally {
      setIsTyping(false);
    }
  };

  // Show loading state based on inference mode
  const isCurrentlyLoading = inferenceMode === 'local' ? loading : cloudLoading;
  const currentError = inferenceMode === 'local' ? error : cloudError;
  
  if (isCurrentlyLoading || (inferenceMode === 'local' && loading)) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center p-5">
          <Text className="text-center text-base text-gray-600">
            {inferenceMode === 'cloud' && cloudLoading
              ? 'Initializing secure cloud connection...'
              : downloadProgress > 0 && downloadProgress < 100
              ? `Downloading model... ${Math.round(downloadProgress)}%`
              : 'Initializing AI model...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (currentError && inferenceMode === 'local') {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center p-5">
          <Text className="mb-2 text-center text-base text-red-500">Error: {currentError}</Text>
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
    <CloudInferenceErrorBoundary
      onError={(error, errorInfo) => {
        console.error('CloudInference Error Boundary triggered:', error, errorInfo);
        // Could send to analytics or error reporting service
      }}
      fallback={(error, retry) => (
        <SafeAreaView className="flex-1 bg-white">
          <View className="flex-1 items-center justify-center p-5">
            <Text className="text-lg font-semibold text-red-600 mb-3 text-center">
              ☁️ Cloud Service Error
            </Text>
            <Text className="text-gray-700 mb-4 text-center">
              There was a problem with cloud inference. You can retry or switch to local AI.
            </Text>
            <Text className="text-xs text-gray-500 mb-4 text-center">
              {error.message}
            </Text>
            <TouchableOpacity
              onPress={retry}
              className="bg-blue-500 rounded-lg py-3 px-6 mb-3">
              <Text className="text-white font-medium text-center">Retry Cloud AI</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setInferenceMode('local')}
              className="bg-gray-100 rounded-lg py-3 px-6">
              <Text className="text-gray-700 font-medium text-center">Switch to Local AI</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}
    >
      <SafeAreaView className="flex-1 bg-white">
        {/* Header */}
        <View className="relative border-b border-gray-200 px-4 py-3">
        {/* Main Header Button - Clickable area that toggles dropdown */}
        <TouchableOpacity
          onPress={() => setShowDropdown(!showDropdown)}
          className="flex-row items-center">
          {/* App Name "Geist" - Black text that dims when dropdown is open */}
          <Text
            className="mr-2 text-lg font-semibold"
            style={{
              color: showDropdown ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 1)',
            }}>
            Geist
          </Text>

          {/* Current Mode Display - Shows "Local" or "Cloud" with status indicator */}
          <View className="flex-row items-center mr-1">
            <Text
              className="text-sm mr-1"
              style={{
                color: showDropdown ? 'rgba(107, 114, 128, 0.4)' : 'rgba(107, 114, 128, 1)',
              }}>
              {inferenceMode === 'local' ? 'Local' : 'Cloud'}
            </Text>
            
            {/* Connection Status Indicator */}
            {inferenceMode === 'cloud' && (
              <View className="flex-row items-center">
                {connectionStatus === 'connected' && (
                  <View className="w-2 h-2 bg-green-500 rounded-full" />
                )}
                {connectionStatus === 'connecting' && (
                  <View className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                )}
                {connectionStatus === 'error' && (
                  <View className="w-2 h-2 bg-red-500 rounded-full" />
                )}
                {connectionStatus === 'rate_limited' && (
                  <View className="w-2 h-2 bg-orange-500 rounded-full" />
                )}
                {connectionStatus === 'disconnected' && (
                  <View className="w-2 h-2 bg-gray-400 rounded-full" />
                )}
                {isRetrying && (
                  <Text className="ml-1 text-xs text-gray-500">
                    ({retryAttempt}/3)
                  </Text>
                )}
                {rateLimitedUntil && rateLimitedUntil > Date.now() && (
                  <Text className="ml-1 text-xs text-orange-600">
                    {Math.ceil((rateLimitedUntil - Date.now()) / 1000)}s
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Dropdown Arrow - Right arrow "›" that rotates down when dropdown opens */}
          <Text
            className="text-xs"
            style={{
              color: showDropdown ? 'rgba(107, 114, 128, 0.4)' : 'rgba(107, 114, 128, 1)',
              transform: showDropdown ? 'rotate(90deg)' : 'rotate(0deg)',
            }}>
            ›
          </Text>
        </TouchableOpacity>

        {/* Dropdown Menu - Only visible when showDropdown is true */}
        {showDropdown && (
          <>
            {/* Invisible Overlay - Covers entire screen to detect clicks outside dropdown */}
            <TouchableOpacity
              onPress={() => setShowDropdown(false)}
              className="absolute inset-0 h-screen w-full"
              style={{ top: 0, left: -16, right: -16, bottom: -1000 }}
            />

            {/* Dropdown Container - White box with shadow containing menu options */}
            <View className="absolute left-16 top-16 z-10 w-60 rounded-lg bg-white shadow-lg">
              {/* GPT-OSS Title */}
              <View className="border-b border-gray-100 px-4 py-3">
                <Text className="text-base font-medium text-black">GPT-OSS</Text>
              </View>

              {/* Cloud Mode Option - First menu item with checkmark if selected */}
              <TouchableOpacity
                onPress={() => handleModeSelect('cloud')}
                className="flex-row items-start border-b border-gray-100 px-4 py-3">
                {/* Checkmark for Cloud Mode - Shows "✓" if cloud mode is active */}
                <View className="mr-2 w-4 items-center pt-0.5">
                  <Text className="text-base text-black">
                    {inferenceMode === 'cloud' ? '✓' : ''}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-base text-black">Cloud</Text>
                  <Text className="text-sm text-gray-500">
                    End-to-end encrypted and never stored, high quality.
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Local Mode Option - Second menu item with checkmark if selected */}
              <TouchableOpacity
                onPress={() => handleModeSelect('local')}
                className="flex-row items-start px-4 pb-4 pt-3">
                {/* Checkmark for Local Mode - Shows "✓" if local mode is active */}
                <View className="mr-2 w-4 items-center pt-0.5">
                  <Text className="text-base text-black">
                    {inferenceMode === 'local' ? '✓' : ''}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-base text-black">Local</Text>
                  <Text className="text-sm text-gray-500">
                    LLM hosted on your phone, overall lower quality.
                  </Text>
                </View>
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
        disabled={(inferenceMode === 'local' ? !isReady : false) || isTyping || cloudGenerating}
      />
      </SafeAreaView>
    </CloudInferenceErrorBoundary>
  );
};

export default ChatScreen;
