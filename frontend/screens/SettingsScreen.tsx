import React, { useState, useEffect } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, Switch, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCloudInference } from '../hooks/useCloudInference';

type InferenceMode = 'local' | 'cloud';

interface SettingsScreenProps {
  onBack?: () => void;
}

const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack }) => {
  const [inferenceMode, setInferenceMode] = useState<InferenceMode>('local');
  const [loading, setLoading] = useState(true);
  const [testingConnection, setTestingConnection] = useState(false);
  const { testConnection, isConnected, error: cloudError } = useCloudInference({ autoInitialize: false });

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
      // Failed to load inference mode
    } finally {
      setLoading(false);
    }
  };

  const saveInferenceMode = async (mode: InferenceMode) => {
    try {
      await AsyncStorage.setItem('inference_mode', mode);
      setInferenceMode(mode);
      
      // Show confirmation to user
      Alert.alert(
        'Settings Saved',
        `Inference mode changed to ${mode === 'local' ? 'Local AI' : 'Cloud AI'}`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to save settings. Please try again.');
    }
  };

  const handleToggleInference = (value: boolean) => {
    const newMode: InferenceMode = value ? 'cloud' : 'local';
    
    if (newMode === 'cloud') {
      Alert.alert(
        'Cloud AI Mode',
        'Cloud inference uses encrypted communication with secure servers. Your prompts are end-to-end encrypted and never stored.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Enable', onPress: () => saveInferenceMode(newMode) }
        ]
      );
    } else {
      saveInferenceMode(newMode);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    
    try {
      const success = await testConnection();
      
      Alert.alert(
        'Connection Test',
        success 
          ? '✅ Successfully connected to cloud inference server' 
          : `❌ Failed to connect: ${cloudError || 'Unknown error'}`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      Alert.alert(
        'Connection Test',
        `❌ Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        [{ text: 'OK' }]
      );
    } finally {
      setTestingConnection(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 justify-center items-center">
          <Text className="text-base text-gray-600">Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200">
        <TouchableOpacity onPress={onBack} className="p-2">
          <Text className="text-blue-500 text-base">← Back</Text>
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-gray-900">Settings</Text>
        <View className="w-12" />
      </View>

      {/* Settings Content */}
      <View className="flex-1 p-4">
        {/* Inference Mode Section */}
        <View className="bg-gray-50 rounded-lg p-4 mb-6">
          <Text className="text-lg font-semibold text-gray-900 mb-2">AI Inference</Text>
          <Text className="text-sm text-gray-600 mb-4">
            Choose where AI processing happens
          </Text>

          {/* Local AI Option */}
          <View className="flex-row items-center justify-between py-3 border-b border-gray-200">
            <View className="flex-1">
              <Text className="text-base font-medium text-gray-900">Local AI</Text>
              <Text className="text-sm text-gray-600 mt-1">
                Process on your device • Private • Works offline
              </Text>
            </View>
            <View className="ml-4">
              {inferenceMode === 'local' ? (
                <View className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                  <Text className="text-white text-xs">✓</Text>
                </View>
              ) : (
                <View className="w-6 h-6 border-2 border-gray-300 rounded-full" />
              )}
            </View>
          </View>

          {/* Cloud AI Option */}
          <View className="flex-row items-center justify-between py-3">
            <View className="flex-1">
              <Text className="text-base font-medium text-gray-900">Cloud AI</Text>
              <Text className="text-sm text-gray-600 mt-1">
                Secure cloud processing • End-to-end encrypted • Faster responses
              </Text>
            </View>
            <View className="ml-4">
              <Switch
                value={inferenceMode === 'cloud'}
                onValueChange={handleToggleInference}
                trackColor={{ false: '#d1d5db', true: '#3b82f6' }}
                thumbColor={inferenceMode === 'cloud' ? '#ffffff' : '#f3f4f6'}
              />
            </View>
          </View>
        </View>

        {/* Current Status */}
        <View className="bg-blue-50 rounded-lg p-4 mb-6">
          <Text className="text-sm font-medium text-blue-900 mb-1">Current Mode</Text>
          <Text className="text-base text-blue-700">
            {inferenceMode === 'local' ? 'Local AI Processing' : 'Cloud AI Processing'}
          </Text>
          {inferenceMode === 'cloud' && (
            <Text className="text-xs text-blue-600 mt-2">
              🔒 All communication is end-to-end encrypted
            </Text>
          )}
        </View>

        {/* Connection Status (for cloud mode) */}
        {inferenceMode === 'cloud' && (
          <View className={`rounded-lg p-4 ${isConnected ? 'bg-green-50' : cloudError ? 'bg-red-50' : 'bg-yellow-50'}`}>
            <Text className={`text-sm font-medium mb-1 ${isConnected ? 'text-green-900' : cloudError ? 'text-red-900' : 'text-yellow-900'}`}>
              Connection Status
            </Text>
            <Text className={`text-sm ${isConnected ? 'text-green-700' : cloudError ? 'text-red-700' : 'text-yellow-700'}`}>
              {isConnected ? '✅ Connected to secure cloud inference' : 
               cloudError ? '❌ Connection error' :
               '⏳ Ready for secure cloud inference'}
            </Text>
            {cloudError && (
              <Text className="text-xs text-red-600 mt-1">{cloudError}</Text>
            )}
            <TouchableOpacity 
              className="mt-2" 
              onPress={handleTestConnection}
              disabled={testingConnection}
            >
              <Text className={`text-xs underline ${isConnected ? 'text-green-600' : cloudError ? 'text-red-600' : 'text-yellow-600'}`}>
                {testingConnection ? 'Testing...' : 'Test connection'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

export default SettingsScreen;