import React, { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Animated,
  Dimensions,
  Platform,
  AppState,
} from 'react-native';
import ChatList, { ChatListRef } from '../components/ChatList';
import InputBar from '../components/InputBar';
import TypingIndicator from '../components/TypingIndicator';
import CloudInferenceErrorBoundary from '../components/CloudInferenceErrorBoundary';
import ChatDrawer from '../components/ChatDrawer';
import HamburgerIcon from '../components/HamburgerIcon';
import NewChatButton from '../components/NewChatButton';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLlama } from '../hooks/useLlama';
import { useCloudInference } from '../hooks/useCloudInference';
import { useChatStorage, LegacyMessage } from '../hooks/useChatStorage';

type InferenceMode = 'local' | 'cloud';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(288, SCREEN_WIDTH * 0.85);

const ChatScreen: React.FC = () => {
  const [currentChatId, setCurrentChatId] = useState<number | undefined>();
  const {
    messages,
    addMessage,
    createNewChat,
    logChatHistoryForLLM,
    isLoading,
    error: chatError,
    currentChat,
  } = useChatStorage(currentChatId);
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
    initialize: initializeCloud,
  } = useCloudInference({ autoInitialize: false });
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [inferenceMode, setInferenceMode] = useState<InferenceMode>('local');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);

  // Animation for sliding the app content
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Ref for ChatList to scroll to bottom
  const chatListRef = useRef<ChatListRef>(null);

  useEffect(() => {
    loadInferenceMode();
    // Load the last active chat or create a default one
    initializeChat();
  }, []);

  const initializeChat = async () => {
    try {
      // Try to load the last active chat ID
      const savedChatId = await AsyncStorage.getItem('current_chat_id');
      if (savedChatId) {
        const chatId = parseInt(savedChatId);
        console.log('🔄 Restoring last active chat:', chatId);
        setCurrentChatId(chatId);
        return;
      }

      // If no saved chat, create a new one only if needed
      console.log('🔄 No previous chat found, initializing default chat...');
      const newChatId = await createNewChat();
      setCurrentChatId(newChatId);
      console.log('✅ Default chat initialized with ID:', newChatId);
    } catch (error) {
      console.error('❌ Failed to initialize chat:', error);
      Alert.alert('Error', 'Failed to initialize chat. Please restart the app.');
    }
  };

  // Save current chat ID to storage when it changes
  useEffect(() => {
    const saveChatId = async () => {
      if (currentChatId) {
        try {
          await AsyncStorage.setItem('current_chat_id', currentChatId.toString());
          console.log('💾 Saved current chat ID to storage:', currentChatId);
        } catch (error) {
          console.error('❌ Failed to save chat ID to storage:', error);
        }
      }
    };

    saveChatId();
  }, [currentChatId]);

  // Initialize cloud inference when mode changes to cloud
  useEffect(() => {
    if (inferenceMode === 'cloud' && !cloudInitialized && !cloudLoading) {
      initializeCloud().catch((error) => {
        console.error('Auto-initialization failed:', error);
      });
    }
  }, [inferenceMode, cloudInitialized, cloudLoading, initializeCloud]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        chatListRef.current?.scrollToBottom();
      }, 100);
    }
  }, [messages.length]);

  // Persist chat state when app goes to background
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        console.log('📱 App going to background, ensuring chat persistence...');
        // The SQLite storage automatically persists data, but we can log for debugging
        if (currentChatId && messages.length > 0) {
          console.log(`💾 Persisting chat ${currentChatId} with ${messages.length} messages`);
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [currentChatId, messages.length]);

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
    // Ensure we have an active chat
    if (!currentChatId) {
      console.log('⚠️ No active chat, creating one...');
      try {
        const newChatId = await createNewChat();
        setCurrentChatId(newChatId);
      } catch (error) {
        console.error('❌ Failed to create chat for message:', error);
        Alert.alert('Error', 'Failed to create chat. Please try again.');
        return;
      }
    }

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

    console.log('📝 Adding user message to chat ID:', currentChatId);
    const userMessage: LegacyMessage = {
      id: Date.now().toString(),
      text: input,
      role: 'user',
      timestamp: Date.now(),
    };

    // Add message to SQLite storage (this will also handle auto-titling)
    await addMessage(userMessage);
    console.log('✅ User message added successfully');
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
        const cloudMessages = conversationHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.text,
        }));

        await askCloud(cloudMessages, (token: string) => {
          fullResponse += token;
          setStreamingMessage(fullResponse);
        });

        replyText = fullResponse;
      } else {
        // Use local inference - convert LegacyMessage to SQLite Message format
        const localMessages = conversationHistory.map((msg) => ({
          id: parseInt(msg.id),
          chat_id: currentChatId!, // We know it's defined now due to validation above
          role: msg.role,
          content: msg.text,
          created_at: msg.timestamp,
        }));
        replyText = await ask(localMessages, (token: string) => {
          fullResponse += token;
          setStreamingMessage(fullResponse);
        });
      }

      const assistantMessage: LegacyMessage = {
        id: assistantId,
        text: replyText || fullResponse,
        role: 'assistant',
        timestamp: Date.now(),
      };
      await addMessage(assistantMessage);
      setStreamingMessage('');

      console.log('✅ CHAT HANDLER: Successfully added assistant message');

      // Scroll to bottom after adding message
      setTimeout(() => {
        chatListRef.current?.scrollToBottom();
      }, 100);

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
            fallbackMessage =
              '🌐 Unable to reach cloud servers. Please check your internet connection and try again.';
          } else if (cloudError.includes('Rate limited') || cloudError.includes('429')) {
            fallbackMessage = '⏳ Cloud servers are busy. Please wait a moment and try again.';
          } else if (cloudError.includes('timeout')) {
            fallbackMessage =
              '⏱️ Cloud request timed out. The servers may be overloaded. Please try again.';
          } else if (
            cloudError.includes('500') ||
            cloudError.includes('502') ||
            cloudError.includes('503')
          ) {
            fallbackMessage =
              '🔧 Cloud servers are temporarily unavailable. Please try again in a few moments.';
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
          errorText =
            streamingMessage.trim() +
            '\n\n[⚠️ Response interrupted - ' +
            (fallbackMessage || 'Cloud connection lost') +
            ']';
        }

        // Add suggestion to switch to local mode for persistent issues
        if (
          cloudError &&
          (cloudError.includes('Network') ||
            cloudError.includes('timeout') ||
            cloudError.includes('500'))
        ) {
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
          errorText =
            lastError.partialResponse.trim() + '\n\n[Response was interrupted by an error]';

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

      const errorMessage: LegacyMessage = {
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

  // Handle drawer animation
  useEffect(() => {
    if (showDrawer) {
      Animated.timing(slideAnim, {
        toValue: DRAWER_WIDTH,
        duration: 250,
        useNativeDriver: true,
      }).start();
    } else {
      // Use a shorter duration for closing to make it more responsive
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }
  }, [showDrawer]);

  const handleDrawerOpen = () => {
    setShowDrawer(true);
  };

  const handleDrawerClose = () => {
    setShowDrawer(false);
  };

  const handleChatSelect = (chatId: number) => {
    console.log('🔄 Switching to chat ID:', chatId);
    setCurrentChatId(chatId);
    // Drawer closing is now handled by ChatDrawer component
  };

  const handleNewChat = async () => {
    try {
      console.log('🆕 Creating new chat...');

      // Create a new chat
      const newChatId = await createNewChat();
      console.log('✅ New chat created with ID:', newChatId);

      setCurrentChatId(newChatId);
      handleDrawerClose();

      // Add haptic feedback if available (optional)
      if (Platform.OS === 'ios') {
        try {
          // Try to use React Native's built-in haptics if available
          const { HapticFeedback } = require('react-native');
          if (HapticFeedback && HapticFeedback.trigger) {
            HapticFeedback.trigger('impactLight');
          }
        } catch (error) {
          // Haptic feedback not available, ignore
          console.log('📱 Haptic feedback not available');
        }
      }

      console.log('🎉 New chat setup complete');
    } catch (error) {
      console.error('❌ Failed to create new chat:', error);
      Alert.alert('Error', 'Failed to create new chat. Please try again.');
    }
  };

  // Show loading state based on inference mode
  const isCurrentlyLoading = inferenceMode === 'local' ? loading : cloudLoading;
  const currentError = inferenceMode === 'local' ? error : cloudError;

  // Show loading when switching chats
  const isChatLoading = !currentChatId || isLoading;

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

  // Show loading when switching chats
  if (isChatLoading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center p-5">
          <Text className="text-center text-base text-gray-600">
            {!currentChatId ? 'Creating new chat...' : 'Loading chat...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show error for chat loading issues
  if (chatError) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center p-5">
          <Text className="mb-2 text-center text-base text-red-500">Chat Error: {chatError}</Text>
          <Text className="text-center text-sm text-gray-600">Please try restarting the app</Text>
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
            <Text className="mb-3 text-center text-lg font-semibold text-red-600">
              ☁️ Cloud Service Error
            </Text>
            <Text className="mb-4 text-center text-gray-700">
              There was a problem with cloud inference. You can retry or switch to local AI.
            </Text>
            <Text className="mb-4 text-center text-xs text-gray-500">{error.message}</Text>
            <TouchableOpacity onPress={retry} className="mb-3 rounded-lg bg-blue-500 px-6 py-3">
              <Text className="text-center font-medium text-white">Retry Cloud AI</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setInferenceMode('local')}
              className="rounded-lg bg-gray-100 px-6 py-3">
              <Text className="text-center font-medium text-gray-700">Switch to Local AI</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}>
      {/* Main App Content */}
      <Animated.View
        style={{
          flex: 1,
          transform: [{ translateX: slideAnim }],
        }}>
        <SafeAreaView className="flex-1 bg-white">
          {/* Header */}
          <View className="relative border-b border-gray-200 px-4 py-3">
            {/* Header Row */}
            <View className="flex-row items-center">
              {/* Left side - Hamburger Menu */}
              <TouchableOpacity onPress={handleDrawerOpen} className="-ml-2 mr-2 p-2">
                <HamburgerIcon size={20} color="#374151" />
              </TouchableOpacity>

              {/* Left side - Main Header Button - Clickable area that toggles dropdown */}
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

                {/* Chat Title - Show current chat title if available and not "New Chat" */}
                {currentChat && currentChat.title && currentChat.title !== 'New Chat' && (
                  <Text
                    className="mr-2 text-sm text-gray-600"
                    style={{
                      color: showDropdown ? 'rgba(107, 114, 128, 0.4)' : 'rgba(107, 114, 128, 1)',
                    }}>
                    • {currentChat.title}
                  </Text>
                )}

                {/* Current Mode Display - Shows "Local" or "Cloud" with status indicator */}
                <View className="mr-1 flex-row items-center">
                  <Text
                    className="mr-1 text-sm"
                    style={{
                      color: showDropdown ? 'rgba(107, 114, 128, 0.4)' : 'rgba(107, 114, 128, 1)',
                    }}>
                    {inferenceMode === 'local' ? 'Local' : 'Cloud'}
                  </Text>

                  {/* Connection Status Indicator */}
                  {inferenceMode === 'cloud' && (
                    <View className="flex-row items-center">
                      {connectionStatus === 'connected' && (
                        <View className="h-2 w-2 rounded-full bg-green-500" />
                      )}
                      {connectionStatus === 'connecting' && (
                        <View className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                      )}
                      {connectionStatus === 'error' && (
                        <View className="h-2 w-2 rounded-full bg-red-500" />
                      )}
                      {connectionStatus === 'rate_limited' && (
                        <View className="h-2 w-2 rounded-full bg-orange-500" />
                      )}
                      {connectionStatus === 'disconnected' && (
                        <View className="h-2 w-2 rounded-full bg-gray-400" />
                      )}
                      {isRetrying && (
                        <Text className="ml-1 text-xs text-gray-500">({retryAttempt}/3)</Text>
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

              {/* Right side - New Chat Button */}
              <View className="ml-auto">
                <NewChatButton onPress={handleNewChat} />
              </View>
            </View>

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
                <View className="absolute left-12 top-16 z-10 w-60 rounded-lg bg-white shadow-lg">
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
            <ChatList ref={chatListRef} messages={displayMessages} />
            {isTyping && !streamingMessage && <TypingIndicator />}
          </View>
          <InputBar
            value={input}
            onChangeText={setInput}
            onSend={handleSend}
            disabled={(inferenceMode === 'local' ? !isReady : false) || isTyping || cloudGenerating}
          />
        </SafeAreaView>

        {/* Overlay for main content when drawer is open */}
        {showDrawer && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.01)',
              zIndex: 5,
            }}
          />
        )}
      </Animated.View>

      {/* Chat Drawer */}
      <ChatDrawer
        isVisible={showDrawer}
        onClose={handleDrawerClose}
        onChatSelect={handleChatSelect}
        activeChatId={currentChatId}
        onNewChat={handleNewChat}
      />
    </CloudInferenceErrorBoundary>
  );
};

export default ChatScreen;
