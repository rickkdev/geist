import React from 'react';
import { View, TextInput, TouchableOpacity, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';

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
    <View className="p-2">
      <View className="flex-row items-center">
        <View className="flex-1 h-11 rounded-full px-4 justify-center" style={{backgroundColor: '#f8f8f8'}}>
          <TextInput
            className="bg-transparent pl-2"
            value={value}
            onChangeText={onChangeText}
            placeholder="Ask anything"
            multiline={false}
            editable={!disabled}
            style={{fontSize: 15, paddingTop: 0, paddingBottom: 0}}
          />
        </View>
        <TouchableOpacity 
          className="justify-center items-center ml-2" 
          onPress={isStreaming ? onInterrupt : onSend} 
          disabled={isDisabled && !isStreaming}
        >
        {isStreaming ? (
          // Pause icon - white rectangle on black rounded background
          <View className="w-11 h-11 rounded-full bg-black items-center justify-center">
            <View className="w-4 h-4 rounded-sm bg-white" />
          </View>
        ) : (
          <View className="w-11 h-11 rounded-full bg-black items-center justify-center">
            <Svg width={22} height={22} viewBox="0 0 24 24" strokeWidth={1.5} stroke="white" fill="none">
              <Path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
            </Svg>
          </View>
        )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default InputBar;
