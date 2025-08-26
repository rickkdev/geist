import React from 'react';
import { FlatList } from 'react-native';
import MessageBubble from './MessageBubble';

// Legacy Message type for compatibility
interface LegacyMessage {
  id: string;
  text: string;
  role: 'user' | 'assistant';
  timestamp: number;
}

interface ChatListProps {
  messages: LegacyMessage[];
}

const ChatList: React.FC<ChatListProps> = ({ messages }) => {
  return (
    <FlatList
      data={messages}
      renderItem={({ item }) => <MessageBubble message={item} />}
      keyExtractor={(item) => item.id}
      contentContainerClassName="flex-grow justify-end p-3"
    />
  );
};

export default ChatList;
