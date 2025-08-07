// Mock LLM client that echoes/paraphrases the user message
export async function sendMessageToLLM(userMessage: string): Promise<string> {
  // Simulate network/model delay
  await new Promise((resolve) => setTimeout(resolve, 1200));

  // Simple paraphrase: prepend a phrase to simulate LLM response
  const paraphrased = `You said: "${userMessage}". Here's my take on it: ${userMessage.split(' ').reverse().join(' ')}`;
  return paraphrased;
}
