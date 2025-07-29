import React from 'react';
import { FlatList } from 'react-native';
import MessageBubble from './MessageBubble';
import { Message } from '../lib/chatStorage';

interface ChatListProps {
  messages: Message[];
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
