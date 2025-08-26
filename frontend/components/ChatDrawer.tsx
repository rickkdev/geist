import React, { useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, Animated, Dimensions } from 'react-native';
import { useChatStorage } from '../hooks/useChatStorage';
import { Chat } from '../lib/chatStorage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(288, SCREEN_WIDTH * 0.85); // w-72 max-w-[85%]

interface ChatItem {
  id: number;
  title: string;
  updated_at: number;
  pinned: number;
  archived: number;
}

interface ChatDrawerProps {
  isVisible: boolean;
  onClose: () => void;
  onChatSelect: (chatId: number) => void;
  activeChatId?: number;
  onNewChat: () => void;
}

export default function ChatDrawer({
  isVisible,
  onClose,
  onChatSelect,
  activeChatId,
  onNewChat,
}: ChatDrawerProps) {
  const { getChats, deleteChat, renameChat, pinChat, archiveChat } = useChatStorage();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [showActionMenu, setShowActionMenu] = useState<number | null>(null);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');

  // Animation for drawer slide
  const translateX = React.useRef(new Animated.Value(-DRAWER_WIDTH)).current;

  // Load chats when drawer opens
  React.useEffect(() => {
    if (isVisible) {
      loadChats();
      // Animate in
      Animated.timing(translateX, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      // Animate out - faster for better responsiveness
      Animated.timing(translateX, {
        toValue: -DRAWER_WIDTH,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }
  }, [isVisible]);

  const loadChats = async () => {
    try {
      const allChats = await getChats({ includeArchived: false });
      setChats(allChats);
    } catch (error) {
      console.error('Failed to load chats:', error);
    }
  };

  const handleChatPress = (chatId: number) => {
    // Close drawer first, then select chat after animation completes
    onClose();
    // Wait for the close animation to complete before selecting chat
    setTimeout(() => {
      onChatSelect(chatId);
    }, 200);
  };

  const handleLongPress = (chat: ChatItem) => {
    setShowActionMenu(chat.id);
  };

  const handleRename = async (chatId: number, newTitle: string) => {
    try {
      await renameChat(chatId, newTitle.trim() || 'New Chat');
      await loadChats();
      setRenameId(null);
      setRenameText('');
    } catch (error) {
      console.error('Failed to rename chat:', error);
    }
  };

  const handlePin = async (chatId: number, pinned: boolean) => {
    try {
      await pinChat(chatId, !pinned);
      await loadChats();
      setShowActionMenu(null);
    } catch (error) {
      console.error('Failed to pin chat:', error);
    }
  };

  const handleArchive = async (chatId: number) => {
    try {
      await archiveChat(chatId, true);
      await loadChats();
      setShowActionMenu(null);
    } catch (error) {
      console.error('Failed to archive chat:', error);
    }
  };

  const handleDelete = async (chatId: number) => {
    try {
      await deleteChat(chatId);
      await loadChats();
      setShowActionMenu(null);
    } catch (error) {
      console.error('Failed to delete chat:', error);
    }
  };


  const renderChatItem = ({ item: chat }: { item: ChatItem }) => {
    const isActive = chat.id === activeChatId;

    return (
      <TouchableOpacity
        onPress={() => handleChatPress(chat.id)}
        onLongPress={() => handleLongPress(chat)}
        className={`mx-2 mb-1 rounded-xl px-3 py-3 ${
          isActive ? 'bg-gray-100' : 'hover:bg-gray-100'
        }`}>
        <View className="flex-row items-start justify-between">
          <View className="mr-2 flex-1">
            <Text numberOfLines={1} className="text-base font-medium text-gray-900">
              {chat.pinned ? '📌 ' : ''}
              {chat.title}
            </Text>
          </View>

          {showActionMenu === chat.id && (
            <View className="absolute right-0 top-0 z-10 rounded-lg border border-gray-200 bg-white shadow-lg">
              <TouchableOpacity
                onPress={() => setRenameId(chat.id)}
                className="border-b border-gray-200 px-4 py-2">
                <Text className="text-gray-900">Rename</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handlePin(chat.id, !!chat.pinned)}
                className="border-b border-gray-200 px-4 py-2">
                <Text className="text-gray-900">{chat.pinned ? 'Unpin' : 'Pin'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleArchive(chat.id)}
                className="border-b border-gray-200 px-4 py-2">
                <Text className="text-gray-900">Archive</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => handleDelete(chat.id)} className="px-4 py-2">
                <Text className="text-red-600">Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // Separate pinned and regular chats
  const pinnedChats = chats.filter((chat) => chat.pinned);
  const regularChats = chats.filter((chat) => !chat.pinned);

  return (
    <>
      {isVisible && (
        <>
          {/* Backdrop */}
          <TouchableOpacity
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              zIndex: 10,
            }}
            onPress={onClose}
            activeOpacity={1}
          />

          {/* Drawer Container */}
          <Animated.View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              transform: [{ translateX }],
              width: DRAWER_WIDTH,
              height: '100%',
              backgroundColor: 'white',
              zIndex: 20,
            }}
            className="border-r border-gray-200 bg-white">
            <TouchableOpacity activeOpacity={1} style={{ flex: 1 }}>
              {/* Header - Match main app header height exactly */}
              <View
                className="border-b border-gray-200 px-4"
                style={{ paddingTop: 62, paddingBottom: 12 }}>
                <Text className="text-lg font-semibold text-black">Chats</Text>
              </View>

              {/* Chat List */}
              <View className="flex-1">
                <FlatList
                  data={[]}
                  ListHeaderComponent={
                    <View>
                      {/* Pinned Section */}
                      {pinnedChats.length > 0 && (
                        <View className="px-4 py-2">
                          <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                            Pinned
                          </Text>
                          {pinnedChats.map((chat) => (
                            <View key={chat.id}>{renderChatItem({ item: chat })}</View>
                          ))}
                        </View>
                      )}

                      {/* Recent Section */}
                      {regularChats.length > 0 && (
                        <View className="px-4 py-2">
                          <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                            Recent
                          </Text>
                          {regularChats.map((chat) => (
                            <View key={chat.id}>{renderChatItem({ item: chat })}</View>
                          ))}
                        </View>
                      )}

                      {/* Empty State */}
                      {chats.length === 0 && (
                        <View className="flex-1 items-center justify-center py-12">
                          <Text className="mb-4 text-base text-gray-500">No chats yet</Text>
                          <TouchableOpacity
                            onPress={onNewChat}
                            className="rounded-lg bg-black px-6 py-3">
                            <Text className="font-medium text-white">Start your first chat</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  }
                  renderItem={() => null}
                  showsVerticalScrollIndicator={false}
                />
              </View>
            </TouchableOpacity>
          </Animated.View>
        </>
      )}

      {/* Action Menu Backdrop */}
      {showActionMenu && (
        <TouchableOpacity
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 15,
          }}
          onPress={() => setShowActionMenu(null)}
          activeOpacity={1}
        />
      )}
    </>
  );
}
