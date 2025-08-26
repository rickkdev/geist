# Development guidelines

- Always use tailwind / nativewind for CSS
- Structure new code in the components folder if it makes sense in new folders

## Known Issues

### Swift Compilation Error (iOS 15.1 + Expo 53.x)
If you encounter `value of type 'some View' has no member 'onGeometryChange'` error:
- The issue is in `node_modules/expo-modules-core/ios/Core/Views/SwiftUI/AutoSizingStack.swift`
- The `onGeometryChange` API requires iOS 17.0+ but project targets iOS 15.1
- **Solution**: Use `npx react-native run-ios` instead of `npx expo run:ios` for building
- **Fix**: Replace `onGeometryChange` code with `GeometryReader` approach in the file
- **Prevention**: Consider adding a postinstall script to auto-fix this issue

### Build Commands
- Use `npx react-native run-ios` for iOS builds (more reliable than `npx expo run:ios`)
- Use `npx expo start --clear` to clear Metro bundler cache if needed
