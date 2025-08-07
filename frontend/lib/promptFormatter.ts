import { Message } from './chatStorage';

export interface FormattedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Alternative format for DeepSeek models that might work better
export const formatPromptSimple = (messages: Message[]): string => {
  const lastMessage = messages[messages.length - 1];
  if (lastMessage && lastMessage.role === 'user') {
    return `User: ${lastMessage.text}\n\nAssistant:`;
  }
  
  let prompt = "You are a helpful AI assistant.\n\n";
  messages.forEach(({ role, text }) => {
    const roleName = role === 'user' ? 'User' : 'Assistant';
    prompt += `${roleName}: ${text}\n\n`;
  });
  prompt += "Assistant:";
  return prompt;
};

export const formatPrompt = (messages: Message[]): string => {
  // Add system prompt for better behavior
  const systemPrompt = "You are a helpful AI assistant. Give clear, concise, and accurate answers.";
  
  const formattedMessages: FormattedMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map(({ role, text }) => ({
      role: (role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system') as 'user' | 'assistant' | 'system',
      content: text,
    }))
  ];

  const prompt =
    formattedMessages
      .map(({ role, content }) => `<|im_start|>${role}\n${content}<|im_end|>`)
      .join('\n') + '\n<|im_start|>assistant\n';

  return prompt;
};

export const formatSinglePrompt = (userMessage: string): string => {
  const systemPrompt = "You are a helpful AI assistant. Give clear, concise, and accurate answers.";
  return `<|im_start|>system\n${systemPrompt}<|im_end|>\n<|im_start|>user\n${userMessage}<|im_end|>\n<|im_start|>assistant\n`;
};

export const formatWithSystemPrompt = (messages: Message[], systemPrompt?: string): string => {
  const formattedMessages: FormattedMessage[] = [];

  if (systemPrompt) {
    formattedMessages.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  formattedMessages.push(
    ...messages.map(({ role, text }) => ({
      role: (role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system') as 'user' | 'assistant' | 'system',
      content: text,
    }))
  );

  const prompt =
    formattedMessages
      .map(({ role, content }) => `<|im_start|>${role}\n${content}<|im_end|>`)
      .join('\n') + '\n<|im_start|>assistant\n';

  return prompt;
};
