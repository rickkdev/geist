// Import crypto polyfill first
import 'react-native-get-random-values';

import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import ChatScreen from './screens/ChatScreen';
import { initializeDatabase } from './lib/chatStorage';
import './global.css';
import './lib/debugUtils'; // Initialize debug utilities

export default function App() {
  const [isDbInitialized, setIsDbInitialized] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        await initializeDatabase();
        setIsDbInitialized(true);
      } catch (error) {
        setDbError(error instanceof Error ? error.message : 'Unknown error');
      }
    };

    initializeApp();
  }, []);

  // Show loading screen while database initializes
  if (!isDbInitialized && !dbError) {
    return (
      <View className="flex-1 bg-neutral-950 justify-center items-center">
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text className="text-neutral-200 mt-4 text-lg">Initializing Geist...</Text>
      </View>
    );
  }

  // Show error screen if database initialization fails
  if (dbError) {
    return (
      <View className="flex-1 bg-neutral-950 justify-center items-center px-6">
        <Text className="text-red-400 text-xl mb-4">⚠️ Initialization Failed</Text>
        <Text className="text-neutral-300 text-center">{dbError}</Text>
        <Text className="text-neutral-500 text-center mt-2 text-sm">
          Please restart the app or check logs for more details.
        </Text>
      </View>
    );
  }

  return <ChatScreen />;
}
