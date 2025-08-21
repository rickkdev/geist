# ✅ LLM Client App — Privacy-First Build Plan

**Stack:** React Native + Expo + NativeWind + Local Auth + Local LLM (post-eject)

---

## 🧠 Description

This app is a ChatGPT alternative that uses LLMs that are running directly on the phone with no data stored on a server as backup or API called for any AI interaction.

---

## ✅ Phase 1: UI & Mocked LLM

- [x] Set up new Expo project:
  - `npx create-expo-app llm-client-app`
  - Install NativeWind: Tailwind + NativeWind setup
  - Install Expo Router

- [x] Implement Chat UI:
  - ChatList (FlatList with user/assistant message bubbles)
  - InputBar (TextInput + send button)
  - Typing indicator

- [x] Mock LLM client:
  - Create `lib/llmClient.ts` with mocked delay + static reply
  - Integrate into chat screen logic

---

## ✅ Phase 2: Local Auth (if needed)

- [ ] (No PIN required for now; see optional section below)

---

## ✅ Phase 3: Persistent Local Chat Memory

- [x] Install AsyncStorage:
  - `npm install @react-native-async-storage/async-storage`

- [x] Implement chat persistence:
  - Store chat messages under unique thread key
  - Load on app start

- [x] Add message timestamp and role
- [ ] Optional: implement SQLite memory later

- [x] Create a hook: `useChatHistory(threadId)`

---

## ✅ Phase 4: Eject + Native Setup

- [x] Eject from Expo:
  - `npx expo eject`

- [x] Set up native build environment:
  - Xcode + Android Studio
  - Ensure app builds and runs post-eject
  - You still need to host metro server `npx react-native start`

---

## ✅ Phase 5: llama.rn Integration (Local LLM Runtime)

### 📦 Setup

- [x] Install llama.rn:
  - `npm install llama.rn`
- [x] Install model FS access:
  - `npm install react-native-fs`
- [x] Run pod install:
  - `npx pod-install`

### 🧩 Files to Implement

- [x] `lib/modelDownloader.ts`
  - Download DeepSeek GGUF model from local server or remote URL to `DocumentDirectoryPath`
  - Auto-download with progress tracking
  - Model existence checking

- [x] `lib/llama.ts`
  - Load model with `initLlama()` and return usable LLM instance
  - Streaming token support via callback
  - Context management and cleanup

- [x] `hooks/useLlama.ts`
  - Initialize model on mount
  - Expose `ask(prompt, onToken?)` API
  - Return loading + isReady state
  - Error handling and recovery

- [x] `screens/ChatScreen.tsx` (updated)
  - Replace mocked LLM client
  - Call `ask()` from `useLlama`
  - Stream assistant response using `onToken` callback
  - Loading states and error handling UI
  - NativeWind/Tailwind styling

- [x] `components/InputBar.tsx` (updated)
  - Added disabled prop support
  - Visual feedback for disabled state

### 📁 Model Storage

- [x] Implement download and storage logic for DeepSeek-R1-Distill-Qwen-7B-IQ2_M.gguf
- [x] **Download actual model file and set up local hosting**
  - Downloaded DeepSeek-R1-Distill-Qwen-7B-IQ2_M.gguf model (IQ2_M quantization)
  - Created `/models` folder and placed model file
  - **To start local server:** `cd models && npx http-server . -p 3000 --cors`
  - Model available at: `http://127.0.0.1:3000/DeepSeek-R1-Distill-Qwen-7B-IQ2_M.gguf`
- [x] Copy to device file system (not bundle) - logic implemented
- [x] Auto-download on first use with progress indicator - logic implemented

---

## ⏳ Bonus (Optional after Phase 5)

- [ ] Add settings page:
  - Model selection
  - Context window size
  - Temperature slider

- [ ] Add local analytics:
  - Generate anon UUID
  - Track usage events with opt-in
  - Send to Plausible or custom endpoint

- [ ] Crash reporting (self-hosted Sentry)

---

## 🛡 Optional: Local PIN Lock

- [ ] Add PIN-based local lock:
  - Setup PIN screen (on first run)
  - Enter PIN screen (on every launch)
  - Store encrypted PIN using SecureStore
  - Validate PIN on unlock
  - Implement authentication context/provider
  - Auto-lock app (background/inactivity)
  - Optional: PIN reset flow (after reinstall)

---

## ✅ Phase 6: Prompt Quality + Inference Stability

### 🧠 Goal

Ensure clean, stateless prompts with proper formatting and accurate, deterministic model outputs.

---

### 🔧 Fixes & Improvements

- [ ] **Prompt Formatter**
  - Create `lib/promptFormatter.ts`
  - Format prompts using **ChatML-style syntax**:
    ```ts
    export const formatPrompt = (messages) =>
      messages
        .map(({ role, content }) => {
          const r = role === 'system' ? 'system' : role === 'user' ? 'user' : 'assistant';
          return `<|im_start|>${r}\n${content}<|im_end|>`;
        })
        .join('\n') + `\n<|im_start|>assistant\n`;
    ```

- [ ] **Hard Reset Model Context Before Each Prompt**
  - Ensure `.reset()` or re-init is called in `useLlama.ask()` before new inference
  - Optional: implement sliding context window logic in `useChatHistory`

- [ ] **Log Full Prompt Sent to Model**
  - Add debug logging in `llama.ts`:
    ```ts
    console.log('🧠 Prompt:\n', fullPrompt);
    ```

- [ ] **Token Limit + Timeout**
  - Add `maxTokens` or `maxLength` guard
  - Optional: cancel generation after N seconds of streaming

- [ ] **One-Turn Mode for Debugging**
  - Add `oneShot: true` mode to `ask()` hook that disables context history
  - Useful for testing hallucination-prone prompts

- [ ] **Improve "Unknown Question" Handling**
  - Add logic to detect off-topic or excessively long responses
  - Use a fallback like: `"I'm not sure how to answer that."`

---

### 🧪 Debugging Tools (Optional)

- [ ] Add a debug screen:
  - Show formatted prompt preview
  - Show raw output token stream
  - Toggle `verboseLogs`, `oneShot`, `maxTokens` settings

  ## ✅ Phase 7: Multi-Model Support + Syntax-Aware Formatting

### 🧠 Goal

Support switching between local models with different chat formats and context behavior.

---

### 🔧 Multi-Model Prompt Formatting

- [ ] **Create prompt formatting layer**
  - Add `lib/promptFormatter.ts` with a single entry:
    ```ts
    export function formatPrompt(messages, modelId) {
      const formatter = modelFormatters[modelId] || modelFormatters.default;
      return formatter(messages);
    }
    ```

- [ ] **Create a model formatter registry**
  - Add `lib/modelFormatters.ts`:

    ```ts
    export const modelFormatters = {
      'deepseek-qwen-7b': (messages) => {
        return (
          messages
            .map(({ role, content }) => `<|im_start|>${role}\n${content}<|im_end|>`)
            .join('\n') + `\n<|im_start|>assistant\n`
        );
      },

      'llama2-7b': (messages) => {
        return (
          messages
            .map(({ role, content }) =>
              role === 'user' ? `User: ${content}` : `Assistant: ${content}`
            )
            .join('\n') + `\nAssistant:`
        );
      },

      'mistral-7b': (messages) => {
        const last = messages[messages.length - 1];
        return `### Instruction:\n${last.content}\n\n### Response:\n`;
      },

      default: (messages) => {
        return (
          messages.map(({ role, content }) => `${role}: ${content}`).join('\n') + `\nassistant:`
        );
      },
    };
    ```

- [ ] **Pass `currentModelId` to `formatPrompt()` in `useLlama.ask()`**

- [ ] **Define per-model metadata config**
  - Create `modelRegistry.ts`:
    ```ts
    export const modelRegistry = {
      'deepseek-qwen-7b': {
        format: 'chatml',
        contextWindow: 4096,
        stopSequences: ['<|im_end|>'],
      },
      'llama2-7b': {
        format: 'raw',
        contextWindow: 4096,
        stopSequences: ['</s>'],
      },
      // ...
    };
    ```

---

### 🧪 Testing Utilities

- [ ] Add internal dev screen to test:
  - Prompt preview (pre-formatted)
  - Streaming token debug log
  - Active model selector
  - System prompt injection

---

### 🧠 Future-Proofing

- [ ] Add support for:
  - Per-model `systemPrompt` logic
  - Model-specific tokenizer/token count estimation (optional)
  - Model capability flags (`supportsStreaming`, `supportsSystemPrompt`, etc.)

---

### Outcome

You'll be able to switch between LLaMA, DeepSeek, Mistral, and other local models with zero hallucination risk and proper formatting — with extensibility built in.

---

## ✅ Phase 8: Cloud vs Local Inference Toggle + Backend Integration

### 🧠 Goal

Add a switch to toggle between local on-device inference and secure cloud inference via the HPKE-encrypted backend router.

---

### 🔧 Implementation Tasks

- [x] **Add Settings Screen with Inference Mode Toggle**
  - Create `screens/SettingsScreen.tsx` with NativeWind styling
  - Add toggle switch component for "Local" vs "Cloud" inference
  - Store inference mode preference in AsyncStorage
  - Add navigation to settings from main chat screen

- [ ] **Implement HPKE Client for Encrypted Communication**
  - Create `lib/hpkeClient.ts` using @noble/curves and @noble/hashes
  - Implement X25519-HKDF-SHA256 + ChaCha20-Poly1305 encryption
  - Generate device key pair and store securely with expo-secure-store
  - Add HPKE seal/open operations for request/response encryption
  - Include replay protection with timestamp and request ID validation

- [ ] **Add Backend Router Connection**
  - Create `lib/cloudInference.ts` for backend router communication
  - Implement SSE streaming for real-time encrypted responses
  - Add certificate pinning for router TLS connection security
  - Configure router endpoint URL and public key retrieval from `/api/pubkey`
  - Handle key rotation and caching of router public keys

- [ ] **Update Chat Logic for Dual Inference Modes**
  - Modify `useLlama.ts` hook to support inference mode selection
  - Add `useCloudInference.ts` hook for encrypted backend communication
  - Update `ChatScreen.tsx` to use selected inference mode
  - Maintain consistent streaming interface for both local and cloud
  - Add loading states and error handling for cloud inference

- [ ] **Add Network and Error Handling**
  - Implement retry logic with exponential backoff for cloud requests
  - Handle network failures gracefully with fallback messaging
  - Add rate limiting awareness and user feedback
  - Create error boundary for cloud inference failures
  - Add connection status indicator in chat UI

- [ ] **Security and Key Management**
  - Generate device key pair automatically on first app launch
  - Store device private key in expo-secure-store without biometric requirements
  - Implement client-side request ID generation and replay protection
  - Add timestamp validation for cloud responses (60s window)
  - Clear sensitive cryptographic material from memory after use
  - Validate router certificate fingerprint before connections
  - All encryption happens transparently without user interaction

### 🧪 Testing and Validation

- [ ] **End-to-End Testing**
  - Test local inference continues to work unchanged
  - Verify encrypted cloud inference with backend router
  - Test toggle switching between modes mid-conversation
  - Validate HPKE encryption/decryption round-trip
  - Test network failure scenarios and recovery

- [ ] **Security Testing**
  - Verify no plaintext prompts sent over network in cloud mode
  - Test key storage and retrieval from secure store
  - Validate timestamp and replay protection mechanisms
  - Test certificate pinning and TLS validation
  - Ensure sensitive data cleanup after operations

### 📱 UI/UX Requirements

- [ ] **Settings Interface**
  - Clear toggle between "Local AI" and "Cloud AI" modes
  - Status indicators showing active inference mode
  - Connection status for cloud mode (connected/disconnected)
  - Option to test cloud connection from settings

- [ ] **Chat Experience**
  - Consistent streaming experience regardless of inference mode
  - Clear indicators when using cloud vs local inference
  - Appropriate loading states and error messages
  - Fallback messaging when cloud inference unavailable

### 🔧 Technical Dependencies

- [ ] **Required Packages**
  - `@noble/curves` and `@noble/hashes` for HPKE cryptography
  - `expo-secure-store` for secure key storage (works in ejected Expo apps)
  - Built-in fetch API for HTTP requests and SSE streaming
  - Note: Expo modules continue to work after ejection via `expo install`

### 🛡️ Security Considerations

- [ ] **End-to-End Encryption**
  - All cloud prompts encrypted with HPKE before transmission
  - Router can only decrypt in-memory, no server-side storage
  - Response chunks encrypted and streamed back to client
  - Device private keys never leave secure storage
  - Encryption happens completely transparently to user

- [ ] **Authentication and Authorization**
  - Device public key used for router authentication
  - No API keys or traditional authentication required
  - Rate limiting based on device public key identity
  - Certificate pinning for router connection security
  - No user interaction needed for security features

---

### Outcome

Users will have seamless choice between private on-device inference and secure cloud inference, with the same chat experience and guaranteed end-to-end encryption for cloud mode.
