// Import crypto polyfill first
import 'react-native-get-random-values';

import React from 'react';
import ChatScreen from './screens/ChatScreen';
import './global.css';
import './lib/debugUtils'; // Initialize debug utilities

export default function App() {
  return <ChatScreen />;
}
