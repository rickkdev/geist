import React, { useState } from 'react';
import { SafeAreaView, View, StyleSheet } from 'react-native';
import ChatList from '../components/ChatList';
import InputBar from '../components/InputBar';
import TypingIndicator from '../components/TypingIndicator';
import { sendMessageToLLM } from '../lib/llmClient';
import { useChatHistory } from '../hooks/useChatHistory';
import { Message } from '../lib/chatStorage';

const ChatScreen: React.FC = () => {
  const { messages, isLoading, addMessage } = useChatHistory();
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      role: 'user',
      timestamp: Date.now(),
    };
    await addMessage(userMessage);
    setInput('');
    setIsTyping(true);
    
    const replyText = await sendMessageToLLM(input);
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      text: replyText,
      role: 'assistant',
      timestamp: Date.now(),
    };
    await addMessage(assistantMessage);
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
