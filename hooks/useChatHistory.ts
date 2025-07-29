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

  return {
    messages,
    isLoading,
    addMessage,
    addMessages,
    clearHistory,
  };
};