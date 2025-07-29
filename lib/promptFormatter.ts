import { Message } from './chatStorage';

export interface FormattedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const formatPrompt = (messages: Message[]): string => {
  const formattedMessages: FormattedMessage[] = messages.map(({ role, text }) => ({
    role: role === 'user' ? 'user' : 'assistant',
    content: text,
  }));

  const prompt = formattedMessages
    .map(({ role, content }) => `<|im_start|>${role}\n${content}<|im_end|>`)
    .join('\n') + '\n<|im_start|>assistant\n';

  return prompt;
};

export const formatSinglePrompt = (userMessage: string): string => {
  return `<|im_start|>user\n${userMessage}<|im_end|>\n<|im_start|>assistant\n`;
};

export const formatWithSystemPrompt = (messages: Message[], systemPrompt?: string): string => {
  const formattedMessages: FormattedMessage[] = [];
  
  if (systemPrompt) {
    formattedMessages.push({
      role: 'system',
      content: systemPrompt,
    });
  }
  
  formattedMessages.push(...messages.map(({ role, text }) => ({
    role: role === 'user' ? 'user' : 'assistant',
    content: text,
  })));

  const prompt = formattedMessages
    .map(({ role, content }) => `<|im_start|>${role}\n${content}<|im_end|>`)
    .join('\n') + '\n<|im_start|>assistant\n';

  return prompt;
};