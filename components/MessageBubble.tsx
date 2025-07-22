import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Message } from '../screens/ChatScreen';

interface MessageBubbleProps {
  message: Message;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  return (
    <View
      style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.assistantBubble,
        isUser ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' },
      ]}>
      <Text style={isUser ? styles.userText : styles.assistantText}>{message.text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginVertical: 4,
  },
  userBubble: {
    backgroundColor: '#2563eb',
  },
  assistantBubble: {
    backgroundColor: '#e5e7eb',
  },
  userText: {
    color: '#fff',
  },
  assistantText: {
    color: '#111827',
  },
});

export default MessageBubble;
