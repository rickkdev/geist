import React from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import MessageBubble from './MessageBubble';
import { Message } from '../screens/ChatScreen';

interface ChatListProps {
  messages: Message[];
}

const ChatList: React.FC<ChatListProps> = ({ messages }) => {
  return (
    <FlatList
      data={messages}
      renderItem={({ item }) => <MessageBubble message={item} />}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.container}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    padding: 12,
  },
});

export default ChatList;
