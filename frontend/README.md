# Geist - React Native AI Chat App

A React Native app with Expo that provides both local and cloud AI inference capabilities with end-to-end encryption.

## Features

- 🤖 **Dual AI Modes**: Local on-device AI and secure cloud AI inference
- 🔒 **End-to-End Encryption**: Cloud messages are encrypted using HPKE
- 📱 **Cross-Platform**: Built with React Native and Expo
- 💾 **Chat History**: Persistent chat storage with AsyncStorage
- 🎨 **Modern UI**: Built with NativeWind (Tailwind CSS for React Native)
- 🔐 **Biometric Security**: PIN and biometric authentication

## Tech Stack

- **Framework**: React Native 0.79.5 + Expo 53.0.20
- **AI**: Local LLM with llama.rn + Cloud inference
- **Styling**: NativeWind (Tailwind CSS)
- **Crypto**: @noble/ciphers, @noble/curves, @noble/hashes
- **Storage**: AsyncStorage, Expo SecureStore
- **Auth**: Expo Local Authentication

## Quick Start

### Development Deployment:

```bash
# Terminal 1: Start Metro bundler
npx react-native start
# or
npx expo start --clear

# Terminal 2: Serve models locally (if using local AI)
cd models && npx http-server . -p 3000 --cors

# Terminal 3: Run iOS app
npx react-native run-ios
```

### Full Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development:**
   ```bash
   npx expo start --clear    # Start Metro bundler
   npx react-native run-ios  # Build and run iOS app
   ```

## Known Issues & Solutions

### 🔧 Swift Compilation Error (iOS 15.1 + Expo 53.x)

**Problem**: Build fails with `value of type 'some View' has no member 'onGeometryChange'`

**Root Cause**: The `onGeometryChange` API requires iOS 17.0+ but the project targets iOS 15.1

**Solution**:
1. **Use the correct build command:**
   ```bash
   npx react-native run-ios  # ✅ Works reliably
   # instead of
   npx expo run:ios          # ❌ May fail with Swift errors
   ```

2. **Manual Fix** (if needed):
   Edit `node_modules/expo-modules-core/ios/Core/Views/SwiftUI/AutoSizingStack.swift`:
   
   Replace the problematic `onGeometryChange` availability check with universal `GeometryReader` approach:
   ```swift
   public var body: some SwiftUI.View {
     // Use GeometryReader for all iOS versions to avoid Swift compilation issues
     if proxy !== ShadowNodeProxy.SHADOW_NODE_MOCK_PROXY {
       content.overlay {
         GeometryReader { geometry in
           Color.clear.onAppear {
             var size = geometry.size
             size.width = axis.contains(.horizontal) ? size.width : ShadowNodeProxy.UNDEFINED_SIZE
             size.height = axis.contains(.vertical) ? size.height : ShadowNodeProxy.UNDEFINED_SIZE
             proxy.setViewSize?(size)
           }
         }
         .hidden()
       }
     } else {
       content
     }
   }
   ```

### 🧹 Cache Issues

If you encounter module resolution errors:
```bash
# Clear all caches
npx expo start --clear
rm -rf node_modules && npm install
cd ios && pod install --repo-update
```

## Build Commands

```bash
# Development
npm start                    # expo start
npx expo start --clear      # start with cleared cache

# Build and run
npx react-native run-ios    # iOS (recommended)
npx expo run:ios           # iOS (alternative, may have Swift issues)
npx react-native run-android # Android

# Code quality
npm run lint               # ESLint + Prettier check
npm run format            # ESLint + Prettier fix

# Other
npx expo prebuild         # Generate native code
```

## Project Structure

```
frontend/
├── components/           # Reusable UI components
│   ├── ChatList.tsx     # Chat message list
│   ├── InputBar.tsx     # Message input component
│   └── ...
├── screens/             # App screens
│   ├── ChatScreen.tsx   # Main chat interface
│   ├── SettingsScreen.tsx
│   └── ...
├── hooks/               # Custom React hooks
│   ├── useLlama.ts      # Local AI inference
│   ├── useCloudInference.ts # Cloud AI inference
│   └── ...
├── lib/                 # Utilities and services
│   ├── chatStorage.ts   # Chat persistence
│   ├── hpkeClient.ts    # Encryption client
│   └── ...
├── models/              # AI model files
├── ios/                 # iOS native code
└── android/             # Android native code
```

## Development Guidelines

- **Styling**: Use NativeWind (Tailwind CSS) for all styling needs
- **Components**: Structure new components in the `components/` folder
- **State Management**: Use React hooks and context for state management
- **Security**: Never log or store sensitive data unencrypted
- **Testing**: Ensure changes work on both iOS and Android

## Troubleshooting

### Build Issues
- Always try `npx react-native run-ios` first for iOS builds
- Clear Metro cache with `npx expo start --clear` if module resolution fails
- Check that all dependencies are properly installed with `npm install`

### iOS Specific
- Ensure Xcode is up to date
- Check iOS deployment target is set to 15.1 in project settings
- Verify pod dependencies with `cd ios && pod install`

### Android Specific
- Ensure Android SDK and emulator are properly set up
- Check `android/` folder for any configuration issues
