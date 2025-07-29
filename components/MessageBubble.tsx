import React from 'react';
import { View, Text } from 'react-native';
import { Message } from '../lib/chatStorage';

interface MessageBubbleProps {
  message: Message;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  return (
    <View
      className={`max-w-[80%] p-3 rounded-2xl my-1 ${
        isUser 
          ? 'bg-blue-600 self-end' 
          : 'bg-gray-200 self-start'
      }`}>
      <Text className={isUser ? 'text-white' : 'text-gray-900'}>{message.text}</Text>
    </View>
  );
};

export default MessageBubble;
