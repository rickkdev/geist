import React from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';

interface InputBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
}

const InputBar: React.FC<InputBarProps> = ({ value, onChangeText, onSend }) => {
  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder="Type a message..."
        multiline
      />
      <TouchableOpacity style={styles.button} onPress={onSend} disabled={!value.trim()}>
        <Text style={styles.buttonText}>Send</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    backgroundColor: '#f9fafb',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: 16,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 1,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default InputBar;
