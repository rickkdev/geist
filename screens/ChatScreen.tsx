import React, { useState } from 'react';
import { SafeAreaView, View, StyleSheet } from 'react-native';
import ChatList from '../components/ChatList';
import InputBar from '../components/InputBar';
import TypingIndicator from '../components/TypingIndicator';
import { sendMessageToLLM } from '../lib/llmClient';

export interface Message {
  id: string;
  text: string;
  role: 'user' | 'assistant';
  timestamp: number;
}

const initialMessages: Message[] = [
  { id: '1', text: 'Hello! How can I help you today?', role: 'assistant', timestamp: Date.now() },
];

const ChatScreen: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  // TODO: Add send message logic and typing simulation
  const handleSend = async () => {
    if (!input.trim()) return;
    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      role: 'user',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);
    const replyText = await sendMessageToLLM(input);
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      text: replyText,
      role: 'assistant',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsTyping(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.chatList}>
        <ChatList messages={messages} />
        {isTyping && <TypingIndicator />}
      </View>
      <InputBar value={input} onChangeText={setInput} onSend={handleSend} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  chatList: { flex: 1, paddingBottom: 8 },
});

export default ChatScreen;
