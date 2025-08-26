import { useState, useEffect } from 'react';
import { 
  Chat, 
  Message, 
  ChatWithMessages,
  createChat, 
  getChat, 
  getChats, 
  addMessage as addMessageToChat,
  initializeDatabase,
  isDatabaseInitialized,
  getChats as getChatsFromDB,
  deleteChat as deleteChatFromDB,
  renameChat as renameChatFromDB,
  pinChat as pinChatFromDB,
  archiveChat as archiveChatFromDB,
  getChatTitle
} from '../lib/chatStorage';

// Legacy Message type for backward compatibility
export interface LegacyMessage {
  id: string;
  text: string;
  role: 'user' | 'assistant';
  timestamp: number;
}

export const useChatStorage = (chatId?: number) => {
  const [currentChat, setCurrentChat] = useState<ChatWithMessages | null>(null);
  const [messages, setMessages] = useState<LegacyMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize database on mount
  useEffect(() => {
    const init = async () => {
      try {
        await initializeDatabase();
      } catch (err) {
        console.error('Failed to initialize database:', err);
        setError('Failed to initialize chat storage');
      }
    };
    init();
  }, []);

  // Load chat when chatId changes
  useEffect(() => {
    if (chatId) {
      loadChat(chatId);
    } else {
      setMessages([]);
      setCurrentChat(null);
      setIsLoading(false);
    }
  }, [chatId]);

  const loadChat = async (id: number) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const chat = await getChat(id);
      if (chat) {
        // Get computed title
        const computedTitle = await getChatTitle(id);
        const chatWithComputedTitle = {
          ...chat,
          title: computedTitle
        };
        
        setCurrentChat(chatWithComputedTitle);
        // Convert SQLite messages to legacy format for compatibility
        const legacyMessages: LegacyMessage[] = chat.messages.map(msg => ({
          id: msg.id.toString(),
          text: msg.content,
          role: msg.role,
          timestamp: msg.created_at,
        }));
        setMessages(legacyMessages);
      } else {
        setError('Chat not found');
      }
    } catch (err) {
      console.error('Failed to load chat:', err);
      setError('Failed to load chat');
    } finally {
      setIsLoading(false);
    }
  };

  const createNewChat = async (): Promise<number> => {
    try {
      console.log('🆕 createNewChat: Starting...');
      
      // Ensure database is initialized
      console.log('🆕 createNewChat: Checking if database is initialized...');
      const isInitialized = isDatabaseInitialized();
      console.log('🆕 createNewChat: Database initialized:', isInitialized);
      
      if (!isInitialized) {
        console.log('🆕 createNewChat: Initializing database...');
        await initializeDatabase();
        console.log('🆕 createNewChat: Database initialization complete');
      }
      
      console.log('🆕 createNewChat: Creating chat...');
      const newChatId = await createChat(); // No default title needed
      console.log('✅ Created new chat with ID:', newChatId);
      return newChatId;
    } catch (err) {
      console.error('❌ Failed to create new chat:', err);
      console.error('❌ Error details:', err instanceof Error ? err.message : 'Unknown error');
      console.error('❌ Error stack:', err instanceof Error ? err.stack : 'No stack trace');
      throw err;
    }
  };

  const addMessage = async (message: LegacyMessage): Promise<void> => {
    if (!chatId) {
      throw new Error('No active chat');
    }

    try {
      // Add message to SQLite
      await addMessageToChat(chatId, message.role, message.text);
      
      // Update local state
      setMessages(prev => [...prev, message]);
      
      // Reload chat to get updated data (including auto-title)
      await loadChat(chatId);
    } catch (err) {
      console.error('Failed to add message:', err);
      throw err;
    }
  };

  const clearMessages = () => {
    setMessages([]);
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

  // Additional functions for ChatDrawer integration
  const getChats = async (options: { includeArchived?: boolean } = {}) => {
    return await getChatsFromDB(options);
  };

  const deleteChat = async (chatId: number) => {
    await deleteChatFromDB(chatId);
    // If we're deleting the current chat, clear the current chat
    if (chatId === currentChatId) {
      setCurrentChatId(undefined);
      setMessages([]);
      setCurrentChat(null);
    }
  };

  const renameChat = async (chatId: number, title: string) => {
    await renameChatFromDB(chatId, title);
    // Update current chat if it's the one being renamed
    if (chatId === currentChatId && currentChat) {
      setCurrentChat({ ...currentChat, title });
    }
  };

  const pinChat = async (chatId: number, pinned: boolean) => {
    await pinChatFromDB(chatId, pinned);
    // Update current chat if it's the one being pinned
    if (chatId === currentChatId && currentChat) {
      setCurrentChat({ ...currentChat, pinned: pinned ? 1 : 0 });
    }
  };

  const archiveChat = async (chatId: number, archived: boolean) => {
    await archiveChatFromDB(chatId, archived);
    // If we're archiving the current chat, clear the current chat
    if (chatId === currentChatId && archived) {
      setCurrentChatId(undefined);
      setMessages([]);
      setCurrentChat(null);
    }
  };

  return {
    messages,
    currentChat,
    isLoading,
    error,
    addMessage,
    createNewChat,
    clearMessages,
    logChatHistoryForLLM,
    // ChatDrawer functions
    getChats,
    deleteChat,
    renameChat,
    pinChat,
    archiveChat,
  };
};