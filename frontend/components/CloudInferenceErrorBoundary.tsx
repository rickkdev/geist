import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class CloudInferenceErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Track cloud inference specific errors
    if (error.message.includes('cloud') || error.message.includes('HPKE') || error.message.includes('router')) {
      // Log to global for debugging
      (global as any).__CLOUD_INFERENCE_ERROR = {
        error: error.message,
        stack: error.stack,
        errorInfo,
        timestamp: new Date().toISOString(),
      };
    }
    
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleRetry);
      }

      const isCloudError = this.state.error.message.includes('cloud') || 
                          this.state.error.message.includes('HPKE') || 
                          this.state.error.message.includes('router');

      return (
        <View className="flex-1 items-center justify-center p-5 bg-red-50">
          <View className="bg-white rounded-lg p-6 shadow-lg max-w-sm w-full">
            <Text className="text-lg font-semibold text-red-600 mb-3 text-center">
              {isCloudError ? '☁️ Cloud Service Error' : '⚠️ Application Error'}
            </Text>
            
            <Text className="text-gray-700 mb-4 text-center">
              {isCloudError 
                ? 'There was a problem with the cloud inference service. Your local AI is still available.'
                : 'An unexpected error occurred. Please try again.'
              }
            </Text>
            
            <Text className="text-xs text-gray-500 mb-4 text-center">
              Error: {this.state.error.message}
            </Text>
            
            <TouchableOpacity
              onPress={this.handleRetry}
              className="bg-blue-500 rounded-lg py-3 px-6 mb-3"
            >
              <Text className="text-white font-medium text-center">Try Again</Text>
            </TouchableOpacity>
            
            {isCloudError && (
              <TouchableOpacity
                onPress={() => {
                  // This would ideally trigger a mode switch to local
                }}
                className="bg-gray-100 rounded-lg py-3 px-6"
              >
                <Text className="text-gray-700 font-medium text-center">Switch to Local AI</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

export default CloudInferenceErrorBoundary;