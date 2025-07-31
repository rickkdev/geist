import { useState, useEffect } from 'react';
import { Message, saveChatMessages, loadChatMessages } from '../lib/chatStorage';

const initialMessages: Message[] = [
  { id: '1', text: 'Hello! How can I help you today?', role: 'assistant', timestamp: Date.now() },
];

export const useChatHistory = () => {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadMessages = async () => {
      try {
        const savedMessages = await loadChatMessages();
        if (savedMessages.length > 0) {
          setMessages(savedMessages);
        }
      } catch (error) {
        console.error('Failed to load messages:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadMessages();
  }, []);

  const addMessage = async (message: Message) => {
    return new Promise<void>((resolve) => {
      setMessages(prevMessages => {
        const newMessages = [...prevMessages, message];
        saveChatMessages(newMessages).then(() => resolve());
        return newMessages;
      });
    });
  };

  const addMessages = async (newMessages: Message[]) => {
    return new Promise<void>((resolve) => {
      setMessages(prevMessages => {
        const updatedMessages = [...prevMessages, ...newMessages];
        saveChatMessages(updatedMessages).then(() => resolve());
        return updatedMessages;
      });
    });
  };

  const clearHistory = async () => {
    setMessages(initialMessages);
    await saveChatMessages(initialMessages);
  };

  const logChatHistoryForLLM = () => {
    const timestamp = new Date().toISOString();
    console.log(`📚 CHAT HISTORY LOG - ${timestamp}`);
    console.log('='.repeat(70));
    
    const formattedHistory = messages.map(msg => ({
      role: msg.role,
      content: msg.text,
      timestamp: new Date(msg.timestamp).toISOString()
    }));
    
    console.log('📊 Stats:', `${messages.length} messages, last updated: ${timestamp}`);
    console.log('');
    
    console.log('💬 Conversation View:');
    messages.forEach((msg, index) => {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      const preview = msg.text.length > 100 ? msg.text.slice(0, 100) + '...' : msg.text;
      console.log(`[${index + 1}] ${time} - ${msg.role.toUpperCase()}: ${preview}`);
    });
    
    console.log('');
    console.log('📋 OpenAI Format (for debugging):');
    const openAIFormat = messages.map(msg => ({
      role: msg.role,
      content: msg.text
    }));
    console.log(JSON.stringify(openAIFormat, null, 2));
    
    console.log('');
    console.log('🔍 Developer Tools Access:');
    console.log('Access full history: global.__CHAT_HISTORY');
    console.log('Last partial response: global.__CHAT_LAST_PARTIAL');  
    console.log('Last error: global.__CHAT_LAST_ERROR');
    console.log('Last LLM response: global.__LLAMA_LAST_RESPONSE');
    console.log('Last LLM timeout: global.__LLAMA_LAST_PARTIAL_RESPONSE');
    
    // Store in global for developer tools access
    (global as any).__CHAT_HISTORY = {
      messages: formattedHistory,
      openAIFormat,
      timestamp,
      messageCount: messages.length
    };
    
    console.log('='.repeat(70));
  };

  return {
    messages,
    isLoading,
    addMessage,
    addMessages,
    clearHistory,
    logChatHistoryForLLM,
  };
};