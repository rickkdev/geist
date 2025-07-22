import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const TypingIndicator: React.FC = () => (
  <View style={styles.container}>
    <Text style={styles.text}>Assistant is typing...</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: 4,
  },
  text: {
    color: '#6b7280',
    fontSize: 14,
    fontStyle: 'italic',
  },
});

export default TypingIndicator;
