import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import Markdown from 'react-native-markdown-display';

// Legacy Message type for compatibility
interface LegacyMessage {
  id: string;
  text: string;
  role: 'user' | 'assistant';
  timestamp: number;
}

interface MessageBubbleProps {
  message: LegacyMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  
  // Process text to ensure proper line breaks for markdown
  const processMessageText = (text: string): string => {
    // First, protect markdown bold/italic markers from being split
    let processed = text;
    
    // Add line breaks between numbered list items (but not within bold text)
    // Match: number + period + space + content + another number starting
    processed = processed.replace(/(\d+\.\s+[^0-9\n]*?)(?=\d+\.)/g, '$1\n');
    
    // Add double line break between end of list and start of new paragraph
    // Only if there's a capital letter starting a new sentence after list
    processed = processed.replace(/(\d+\.\s+.*?\.)([A-Z][a-z])/g, '$1\n\n$2');
    
    // Add line break before markdown headers (# ## ###)
    processed = processed.replace(/([^\n])(#{1,3}\s+)/g, '$1\n\n$2');
    
    return processed;
  };
  
  // Custom markdown styles
  const markdownStyles = {
    body: {
      color: isUser ? '#ffffff' : '#111827',
      fontSize: 15,
      lineHeight: 24,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 10,
    },
    strong: {
      fontWeight: '700',
      color: isUser ? '#ffffff' : '#111827',
    },
    em: {
      fontStyle: 'italic',
    },
    heading1: {
      fontSize: 22,
      fontWeight: '700',
      marginBottom: 8,
      marginTop: 12,
      color: isUser ? '#ffffff' : '#111827',
    },
    heading2: {
      fontSize: 20,
      fontWeight: '700',
      marginBottom: 6,
      marginTop: 10,
      color: isUser ? '#ffffff' : '#111827',
    },
    heading3: {
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 4,
      marginTop: 8,
      color: isUser ? '#ffffff' : '#111827',
    },
    list_item: {
      flexDirection: 'row',
      marginBottom: 8,
    },
    ordered_list_icon: {
      color: isUser ? '#ffffff' : '#374151',
      fontSize: 15,
      lineHeight: 24,
      marginRight: 10,
    },
    bullet_list_icon: {
      color: isUser ? '#ffffff' : '#374151',
      fontSize: 20,
      lineHeight: 24,
      marginRight: 10,
    },
    code_inline: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.2)' : '#f3f4f6',
      color: isUser ? '#ffffff' : '#111827',
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 4,
      fontFamily: 'monospace',
      fontSize: 14,
    },
    code_block: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : '#f3f4f6',
      padding: 12,
      borderRadius: 8,
      marginVertical: 8,
      fontFamily: 'monospace',
      fontSize: 13,
    },
    fence: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : '#f3f4f6',
      padding: 12,
      borderRadius: 8,
      marginVertical: 8,
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: isUser ? 'rgba(255,255,255,0.5)' : '#d1d5db',
      paddingLeft: 12,
      marginVertical: 8,
    },
    hr: {
      backgroundColor: isUser ? 'rgba(255,255,255,0.3)' : '#d1d5db',
      height: 1,
      marginVertical: 16,
    },
    link: {
      color: isUser ? '#93c5fd' : '#2563eb',
      textDecorationLine: 'underline',
    },
  };

  return (
    <View
      className={`max-w-[80%] p-3 rounded-2xl my-1 ${
        isUser 
          ? 'bg-blue-600 self-end' 
          : 'bg-gray-200 self-start'
      }`}>
      {isUser ? (
        <Text className="text-white">{message.text}</Text>
      ) : (
        <Markdown 
          style={markdownStyles}
          rules={{
            // Custom rule to handle soft breaks better
            softbreak: (node, children, parent, styles) => (
              <Text key={node.key}>{'\n'}</Text>
            ),
          }}
        >
          {processMessageText(message.text)}
        </Markdown>
      )}
    </View>
  );
};

export default MessageBubble;
