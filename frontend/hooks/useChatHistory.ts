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
    
    const formattedHistory = messages.map(msg => ({
      role: msg.role,
      content: msg.text,
      timestamp: new Date(msg.timestamp).toISOString()
    }));
    
    
    
    const openAIFormat = messages.map(msg => ({
      role: msg.role,
      content: msg.text
    }));
    
    
    // Store in global for developer tools access
    (global as any).__CHAT_HISTORY = {
      messages: formattedHistory,
      openAIFormat,
      timestamp,
      messageCount: messages.length
    };
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