import React from 'react';
import { View, TextInput, TouchableOpacity, Text } from 'react-native';

interface InputBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onInterrupt?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

const InputBar: React.FC<InputBarProps> = ({ value, onChangeText, onSend, onInterrupt, disabled = false, isStreaming = false }) => {
  const isDisabled = disabled || (!value.trim() && !isStreaming);
  
  return (
    <View className="flex-row items-end p-2 bg-gray-50">
      <TextInput
        className="flex-1 min-h-[40px] max-h-[100px] rounded-2xl bg-white px-3 py-2 mr-2 border border-gray-200"
        value={value}
        onChangeText={onChangeText}
        placeholder="Type a message..."
        multiline
        editable={!disabled}
      />
      <TouchableOpacity 
        className={`rounded-2xl px-4 py-2.5 justify-center items-center ${isStreaming ? 'bg-transparent' : isDisabled ? 'bg-gray-400' : 'bg-blue-600'}`} 
        onPress={isStreaming ? onInterrupt : onSend} 
        disabled={isDisabled && !isStreaming}
      >
        {isStreaming ? (
          // Pause icon - white rectangle on black rounded background
          <View className="w-6 h-6 rounded-full bg-black items-center justify-center">
            <View className="w-3 h-3 rounded-sm bg-white" />
          </View>
        ) : (
          <Text className="text-white font-bold">Send</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

export default InputBar;
