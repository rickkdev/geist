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
import { useCloudInference } from '../hooks/useCloudInference';
import { useChatStorage, LegacyMessage } from '../hooks/useChatStorage';
import MinimalLogger from '../lib/minimalLogger';


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
    interrupt: interruptCloud,
    clearError: clearCloudError,
    initialize: initializeCloud,
  } = useCloudInference({ autoInitialize: true });
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState('');
  const [showDrawer, setShowDrawer] = useState(false);

  // Animation for sliding the app content
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Ref for ChatList to scroll to bottom
  const chatListRef = useRef<ChatListRef>(null);

  useEffect(() => {
    // Load the last active chat or create a default one
    initializeChat();
  }, []);

  const initializeChat = async () => {
    try {
      // Try to load the last active chat ID
      const savedChatId = await AsyncStorage.getItem('current_chat_id');
      if (savedChatId) {
        const chatId = parseInt(savedChatId);
        setCurrentChatId(chatId);
        return;
      }

      // If no saved chat, create a new one only if needed
      const newChatId = await createNewChat();
      setCurrentChatId(newChatId);
    } catch (error) {
      Alert.alert('Error', 'Failed to initialize chat. Please restart the app.');
    }
  };

  // Save current chat ID to storage when it changes
  useEffect(() => {
    const saveChatId = async () => {
      if (currentChatId) {
        try {
          await AsyncStorage.setItem('current_chat_id', currentChatId.toString());
        } catch (error) {
          // Failed to save chat ID to storage
        }
      }
    };

    saveChatId();
  }, [currentChatId]);


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
        // The SQLite storage automatically persists data
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [currentChatId, messages.length]);




  const handleSend = async () => {
    // Ensure we have an active chat
    if (!currentChatId) {
      try {
        const newChatId = await createNewChat();
        setCurrentChatId(newChatId);
      } catch (error) {
        Alert.alert('Error', 'Failed to create chat. Please try again.');
        return;
      }
    }

    // Initialize cloud inference if needed
    if (!cloudInitialized && !cloudLoading) {
      try {
        await initializeCloud();
      } catch (error) {
        return;
      }
    }

    // Check cloud readiness
    if (!input.trim() || !cloudInitialized || cloudGenerating) return;

    const userMessage: LegacyMessage = {
      id: Date.now().toString(),
      text: input,
      role: 'user',
      timestamp: Date.now(),
    };

    // Add message to SQLite storage (this will also handle auto-titling)
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

      // Use cloud inference
      const cloudMessages = conversationHistory.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.text,
      }));

      await askCloud(cloudMessages, (token: string) => {
        fullResponse += token;
        setStreamingMessage(fullResponse);
      });

      const replyText = fullResponse;

      // Only save message if we have content
      if (replyText || fullResponse) {
        const assistantMessage: LegacyMessage = {
          id: assistantId,
          text: replyText || fullResponse,
          role: 'assistant',
          timestamp: Date.now(),
        };
        await addMessage(assistantMessage);
        
        // Log the completed conversation
        MinimalLogger.logChatSession(userMessage.text, replyText || fullResponse, 'cloud');
      }
      setStreamingMessage('');

      // Scroll to bottom after adding message
      setTimeout(() => {
        chatListRef.current?.scrollToBottom();
      }, 100);

      // Log the entire chat history after each message exchange
      logChatHistoryForLLM();
    } catch (err: any) {
      // Check if this was an interruption first (not an error)
      const wasInterrupted = err?.message?.toLowerCase().includes('interrupted');
      
      if (wasInterrupted) {
        // Save any partial response we have
        if (streamingMessage && streamingMessage.trim()) {
          const assistantMessage: LegacyMessage = {
            id: (Date.now() + 1).toString(),
            text: streamingMessage.trim() + '\n\n[Response interrupted]',
            role: 'assistant',
            timestamp: Date.now(),
          };
          await addMessage(assistantMessage);
          
          // Log the interrupted conversation
          MinimalLogger.logChatSession(userMessage.text, streamingMessage.trim() + '\n\n[Response interrupted]', 'cloud');
        }
        setStreamingMessage('');
        setIsTyping(false);
        return;
      }

      let errorText = `Sorry, I encountered an error processing your message.`;

      // Handle cloud inference errors
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

      const errorMessage: LegacyMessage = {
        id: (Date.now() + 1).toString(),
        text: errorText,
        role: 'assistant',
        timestamp: Date.now(),
      };
      await addMessage(errorMessage);
      
      // Log the error conversation
      MinimalLogger.logChatSession(userMessage.text, errorText, 'cloud');

      // Log error details for debugging
      (global as any).__CHAT_LAST_ERROR = {
        userMessage: userMessage.text,
        error: err,
        inferenceMode: 'cloud',
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
    setCurrentChatId(chatId);
    // Drawer closing is now handled by ChatDrawer component
  };

  const handleInterrupt = () => {
    // Immediate UI feedback
    setIsTyping(false);
    setStreamingMessage('');
    
    // Trigger cloud interruption without waiting
    interruptCloud();
  };

  const handleNewChat = async () => {
    try {
      // Auto-interrupt any ongoing inference
      if (cloudGenerating) {
        handleInterrupt();
      }

      // Create a new chat
      const newChatId = await createNewChat();

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
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to create new chat. Please try again.');
    }
  };

  // Show loading state for cloud
  const isCurrentlyLoading = cloudLoading;
  const currentError = cloudError;

  // Show loading when switching chats
  const isChatLoading = !currentChatId || isLoading;

  if (isCurrentlyLoading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center p-5">
          <Text className="text-center text-base text-gray-600">
            Initializing secure cloud connection...
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
        // Could send to analytics or error reporting service
      }}
      fallback={(error, retry) => (
        <SafeAreaView className="flex-1 bg-white">
          <View className="flex-1 items-center justify-center p-5">
            <Text className="mb-3 text-center text-lg font-semibold text-red-600">
              ☁️ Cloud Service Error
            </Text>
            <Text className="mb-4 text-center text-gray-700">
              There was a problem with cloud inference. Please check your connection and try again.
            </Text>
            <Text className="mb-4 text-center text-xs text-gray-500">{error.message}</Text>
            <TouchableOpacity onPress={retry} className="mb-3 rounded-lg bg-blue-500 px-6 py-3">
              <Text className="text-center font-medium text-white">Retry Cloud AI</Text>
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

              {/* Center - Title */}
              <View className="flex-row items-center">
                <Text className="text-lg font-medium text-black">Geist</Text>
              </View>

              {/* Right side - New Chat Button */}
              <View className="ml-auto">
                <NewChatButton onPress={handleNewChat} />
              </View>
            </View>

          </View>

          <View className="flex-1 pb-2">
            <ChatList ref={chatListRef} messages={displayMessages} />
            {isTyping && !streamingMessage && <TypingIndicator />}
          </View>
          <InputBar
            value={input}
            onChangeText={setInput}
            onSend={handleSend}
            onInterrupt={handleInterrupt}
            disabled={isTyping || cloudGenerating}
            isStreaming={isTyping || cloudGenerating}
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
