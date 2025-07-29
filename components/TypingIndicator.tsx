import React from 'react';
import { View, Text } from 'react-native';

const TypingIndicator: React.FC = () => (
  <View className="items-center my-1">
    <Text className="text-gray-500 text-sm italic">Assistant is typing...</Text>
  </View>
);

export default TypingIndicator;
