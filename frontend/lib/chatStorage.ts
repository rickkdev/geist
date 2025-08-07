import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Message {
  id: string;
  text: string;
  role: 'user' | 'assistant';
  timestamp: number;
}

const CHAT_STORAGE_KEY = 'chat_messages';

export const saveChatMessages = async (messages: Message[]): Promise<void> => {
  try {
    const jsonValue = JSON.stringify(messages);
    await AsyncStorage.setItem(CHAT_STORAGE_KEY, jsonValue);
  } catch (error) {
    console.error('Failed to save chat messages:', error);
  }
};

export const loadChatMessages = async (): Promise<Message[]> => {
  try {
    const jsonValue = await AsyncStorage.getItem(CHAT_STORAGE_KEY);
    if (jsonValue != null) {
      return JSON.parse(jsonValue);
    }
    return [];
  } catch (error) {
    console.error('Failed to load chat messages:', error);
    return [];
  }
};

export const clearChatMessages = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(CHAT_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear chat messages:', error);
  }
};