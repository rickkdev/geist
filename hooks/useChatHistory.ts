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
    console.log('=== Chat History for LLM ===');
    
    const formattedHistory = messages.map(msg => ({
      role: msg.role,
      content: msg.text,
      timestamp: new Date(msg.timestamp).toISOString()
    }));
    
    console.log('Formatted as array:', JSON.stringify(formattedHistory, null, 2));
    
    console.log('\nFormatted as conversation:');
    messages.forEach((msg, index) => {
      console.log(`[${index + 1}] ${msg.role.toUpperCase()}: ${msg.text}`);
    });
    
    console.log('\nAs OpenAI-style messages:');
    const openAIFormat = messages.map(msg => ({
      role: msg.role,
      content: msg.text
    }));
    console.log(JSON.stringify(openAIFormat, null, 2));
    
    console.log('=== End Chat History ===');
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