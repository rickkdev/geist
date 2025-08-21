#!/usr/bin/env python3
"""
Configuration Management Validation Script

Tests the configuration system to ensure proper environment switching
and configuration loading works correctly.
"""

import os
import sys
import shutil

# Add current directory to path to import config
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_development_config():
    """Test development configuration loading."""
    print("🧪 Testing development configuration...")
    
    # Set environment variable
    os.environ['ENVIRONMENT'] = 'development'
    
    # Create temporary .env file with development config
    with open('.env.test', 'w') as f:
        f.write("""
ENVIRONMENT=development
INFERENCE_TRANSPORT=unix
INFERENCE_ENDPOINTS=["/run/inference.sock"]
SSL_ENABLED=false
DEV_DEBUG=true
DISABLE_DOCS=false
LOG_LEVEL=DEBUG
RATE_LIMIT_PER_MINUTE=120
""".strip())
    
    # Backup original .env if it exists
    env_backup = None
    if os.path.exists('.env'):
        env_backup = '.env.backup_test'
        shutil.copy('.env', env_backup)
    
    # Copy test config to .env
    shutil.copy('.env.test', '.env')
    
    try:
        # Import and test config
        from config import get_settings
        
        # Clear settings cache
        get_settings.cache_clear()
        
        settings = get_settings()
        
        # Test development-specific settings
        assert settings.ENVIRONMENT == 'development'
        assert settings.is_development() == True
        assert settings.is_production() == False
        assert settings.INFERENCE_TRANSPORT == 'unix'
        assert settings.SSL_ENABLED == False
        assert settings.DEV_DEBUG == True
        assert settings.should_enable_cors() == True
        assert settings.DISABLE_DOCS == False
        assert settings.LOG_LEVEL == 'DEBUG'
        assert settings.RATE_LIMIT_PER_MINUTE == 120
        
        # Test helper methods
        assert settings.get_inference_socket_path() == '/run/inference.sock'
        assert settings.get_inference_https_urls() == []
        assert settings.should_use_mtls() == False
        
        print("   ✅ Development configuration validated successfully")
        
    finally:
        # Cleanup
        os.remove('.env.test')
        if env_backup:
            shutil.move(env_backup, '.env')
        elif os.path.exists('.env'):
            os.remove('.env')

def test_production_config():
    """Test production configuration loading."""
    print("🧪 Testing production configuration...")
    
    # Set environment variable
    os.environ['ENVIRONMENT'] = 'production'
    
    # Create temporary .env file with production config
    with open('.env.test', 'w') as f:
        f.write("""
ENVIRONMENT=production
INFERENCE_TRANSPORT=https
INFERENCE_ENDPOINTS=["https://10.0.0.2:8001", "https://10.0.0.3:8001"]
SSL_ENABLED=true
SSL_KEYFILE=/etc/llm-router/certs/server.key
SSL_CERTFILE=/etc/llm-router/certs/server.crt
DEV_DEBUG=false
DISABLE_DOCS=true
LOG_LEVEL=INFO
RATE_LIMIT_PER_MINUTE=60
MTLS_ENABLED=true
MTLS_CLIENT_CERT_PATH=/etc/llm-router/certs/router-cert.pem
""".strip())
    
    # Backup original .env if it exists
    env_backup = None
    if os.path.exists('.env'):
        env_backup = '.env.backup_test'
        shutil.copy('.env', env_backup)
    
    # Copy test config to .env
    shutil.copy('.env.test', '.env')
    
    try:
        # Import and test config (clear cache first)
        from config import get_settings
        
        # Clear settings cache
        get_settings.cache_clear()
        
        settings = get_settings()
        
        # Test production-specific settings
        assert settings.ENVIRONMENT == 'production'
        assert settings.is_development() == False
        assert settings.is_production() == True
        assert settings.INFERENCE_TRANSPORT == 'https'
        assert settings.SSL_ENABLED == True
        assert settings.DEV_DEBUG == False
        assert settings.should_enable_cors() == False
        assert settings.DISABLE_DOCS == True
        assert settings.LOG_LEVEL == 'INFO'
        assert settings.RATE_LIMIT_PER_MINUTE == 60
        assert settings.MTLS_ENABLED == True
        
        # Test helper methods
        assert settings.get_inference_socket_path() == None
        assert len(settings.get_inference_https_urls()) > 0
        assert settings.should_use_mtls() == True
        
        # Test production endpoints
        prod_endpoints = settings.get_production_endpoints()
        assert len(prod_endpoints) > 0
        assert all(url.startswith("https://10.0.0.") for url in prod_endpoints)
        
        print("   ✅ Production configuration validated successfully")
        
    finally:
        # Cleanup
        os.remove('.env.test')
        if env_backup:
            shutil.move(env_backup, '.env')
        elif os.path.exists('.env'):
            os.remove('.env')

def test_environment_switching():
    """Test environment switching functionality."""
    print("🧪 Testing environment switching...")
    
    # Test that configuration changes when environment changes
    original_env = os.environ.get('ENVIRONMENT')
    
    try:
        # Clear any cached settings
        from config import get_settings
        get_settings.cache_clear()
        
        # Test switching between environments
        os.environ['ENVIRONMENT'] = 'development'
        dev_settings = get_settings()
        assert dev_settings.is_development()
        
        get_settings.cache_clear()
        
        os.environ['ENVIRONMENT'] = 'production'
        prod_settings = get_settings()
        assert prod_settings.is_production()
        
        # Verify they have different configurations
        assert dev_settings.INFERENCE_TRANSPORT != prod_settings.INFERENCE_TRANSPORT
        assert dev_settings.should_enable_cors() != prod_settings.should_enable_cors()
        
        print("   ✅ Environment switching validated successfully")
        
    finally:
        # Restore original environment
        if original_env:
            os.environ['ENVIRONMENT'] = original_env
        elif 'ENVIRONMENT' in os.environ:
            del os.environ['ENVIRONMENT']

def main():
    """Run all configuration tests."""
    print("🔧 Configuration Management Validation")
    print("=====================================")
    
    try:
        test_development_config()
        test_production_config()
        test_environment_switching()
        
        print("\n✅ All configuration tests passed!")
        print("\n🚀 Configuration management system is working correctly")
        print("\n📚 For more information, see: docs/configuration-guide.md")
        
    except AssertionError as e:
        print(f"\n❌ Configuration test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n💥 Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()