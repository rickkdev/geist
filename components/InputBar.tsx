import React from 'react';
import { View, TextInput, TouchableOpacity, Text } from 'react-native';

interface InputBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
}

const InputBar: React.FC<InputBarProps> = ({ value, onChangeText, onSend }) => {
  return (
    <View className="flex-row items-end p-2 bg-gray-50">
      <TextInput
        className="flex-1 min-h-[40px] max-h-[100px] rounded-2xl bg-white px-3 py-2 mr-2 border border-gray-200"
        value={value}
        onChangeText={onChangeText}
        placeholder="Type a message..."
        multiline
      />
      <TouchableOpacity className="bg-blue-600 rounded-2xl px-4 py-2.5 justify-center items-center" onPress={onSend} disabled={!value.trim()}>
        <Text className="text-white font-bold">Send</Text>
      </TouchableOpacity>
    </View>
  );
};

export default InputBar;
