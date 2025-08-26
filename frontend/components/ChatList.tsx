import React, { forwardRef, useImperativeHandle } from 'react';
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

export interface ChatListRef {
  scrollToBottom: () => void;
}

const ChatList = forwardRef<ChatListRef, ChatListProps>(({ messages }, ref) => {
  const flatListRef = React.useRef<FlatList>(null);

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      if (messages.length > 0) {
        flatListRef.current?.scrollToEnd({ animated: true });
      }
    },
  }));

  return (
    <FlatList
      ref={flatListRef}
      data={messages}
      renderItem={({ item }) => <MessageBubble message={item} />}
      keyExtractor={(item) => item.id}
      contentContainerClassName="flex-grow justify-end p-3"
    />
  );
});

export default ChatList;
