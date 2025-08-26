import { useEffect, useState } from 'react';
import {
  initializeDatabase,
  createChat,
  getChats,
  getChat,
  addMessage,
  renameChat,
  pinChat,
  archiveChat,
  deleteChat,
  getMessageCount,
  Chat,
  Message,
  ChatWithMessages,
} from '../lib/chatStorage';

export function useChatStorage() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize database on first use
  useEffect(() => {
    if (!isInitialized && !isInitializing) {
      setIsInitializing(true);
      initializeDatabase()
        .then(() => {
          setIsInitialized(true);
          setError(null);
        })
        .catch((err) => {
          setError(err.message);
          console.error('Failed to initialize database:', err);
        })
        .finally(() => {
          setIsInitializing(false);
        });
    }
  }, [isInitialized, isInitializing]);

  // Wrapper functions that ensure database is initialized
  const ensureInitialized = () => {
    if (!isInitialized) {
      throw new Error('Database not initialized');
    }
  };

  return {
    isInitialized,
    isInitializing,
    error,
    
    // Chat operations
    createChat: async (title?: string) => {
      ensureInitialized();
      return createChat(title);
    },
    
    getChats: async (options?: { includeArchived?: boolean }) => {
      ensureInitialized();
      return getChats(options);
    },
    
    getChat: async (chatId: number, options?: { limit?: number; offset?: number }) => {
      ensureInitialized();
      return getChat(chatId, options);
    },
    
    addMessage: async (chatId: number, role: 'user' | 'assistant', content: string) => {
      ensureInitialized();
      return addMessage(chatId, role, content);
    },
    
    renameChat: async (chatId: number, title: string) => {
      ensureInitialized();
      return renameChat(chatId, title);
    },
    
    pinChat: async (chatId: number, pinned: boolean) => {
      ensureInitialized();
      return pinChat(chatId, pinned);
    },
    
    archiveChat: async (chatId: number, archived: boolean) => {
      ensureInitialized();
      return archiveChat(chatId, archived);
    },
    
    deleteChat: async (chatId: number) => {
      ensureInitialized();
      return deleteChat(chatId);
    },
    
    getMessageCount: async (chatId: number) => {
      ensureInitialized();
      return getMessageCount(chatId);
    },
  };
}