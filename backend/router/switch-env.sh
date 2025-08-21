#!/bin/bash

# Environment Switching Script
# Easily switch between development and production configurations

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Function to show usage
show_usage() {
    echo "Usage: $0 [dev|prod|status]"
    echo ""
    echo "Commands:"
    echo "  dev     - Switch to development environment"
    echo "  prod    - Switch to production environment (requires sudo)"
    echo "  status  - Show current environment status"
    echo ""
    echo "Examples:"
    echo "  ./switch-env.sh dev"
    echo "  ./switch-env.sh prod"
    echo "  ./switch-env.sh status"
    exit 1
}

# Function to show current status
show_status() {
    echo "📊 Current Environment Status"
    echo "=============================="
    
    # Check which .env file is active
    if [ -f ".env" ]; then
        CURRENT_ENV=$(grep "^ENVIRONMENT=" .env 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "unknown")
        echo "Active Environment: $CURRENT_ENV"
        
        # Show key configuration differences
        if [ "$CURRENT_ENV" = "development" ]; then
            echo "Transport: $(grep "^INFERENCE_TRANSPORT=" .env | cut -d'=' -f2)"
            echo "Endpoints: $(grep "^INFERENCE_ENDPOINTS=" .env | cut -d'=' -f2)"
            echo "SSL: $(grep "^SSL_ENABLED=" .env | cut -d'=' -f2)"
            echo "Debug: $(grep "^DEV_DEBUG=" .env | cut -d'=' -f2)"
        elif [ "$CURRENT_ENV" = "production" ]; then
            echo "Transport: $(grep "^INFERENCE_TRANSPORT=" .env | cut -d'=' -f2)"
            echo "Endpoints: $(grep "^INFERENCE_ENDPOINTS=" .env | cut -d'=' -f2)"
            echo "SSL: $(grep "^SSL_ENABLED=" .env | cut -d'=' -f2)"
            echo "mTLS: $(grep "^MTLS_ENABLED=" .env | cut -d'=' -f2)"
        fi
    else
        echo "❌ No .env file found"
    fi
    
    echo ""
    echo "Available configurations:"
    [ -f ".env.development" ] && echo "✅ Development config available"
    [ -f ".env.production" ] && echo "✅ Production config available"
    
    echo ""
    echo "Running services:"
    if systemctl is-active --quiet llm-router-prod 2>/dev/null; then
        echo "✅ llm-router-prod (production service) is running"
    else
        echo "⏹️  llm-router-prod (production service) is not running"
    fi
    
    if systemctl is-active --quiet llama-inference 2>/dev/null; then
        echo "✅ llama-inference (development service) is running"
    else
        echo "⏹️  llama-inference (development service) is not running"
    fi
}

# Function to switch to development
switch_to_dev() {
    echo "🔧 Switching to DEVELOPMENT environment..."
    
    # Stop production services if running
    if systemctl is-active --quiet llm-router-prod 2>/dev/null; then
        echo "   → Stopping production service..."
        sudo systemctl stop llm-router-prod
    fi
    
    # Run development deployment script
    ./deploy-dev.sh
    
    echo "✅ Successfully switched to development environment"
    echo ""
    echo "🚀 Next steps:"
    echo "   ./start-dev.sh    # Start development server"
    echo "   ./switch-env.sh status    # Check status"
}

# Function to switch to production
switch_to_prod() {
    echo "🚀 Switching to PRODUCTION environment..."
    
    # Check if running as root
    if [ "$EUID" -ne 0 ]; then
        echo "❌ Production deployment requires sudo privileges"
        echo "   Please run: sudo ./switch-env.sh prod"
        exit 1
    fi
    
    # Stop development processes if running
    echo "   → Stopping any development processes..."
    pkill -f "uvicorn main:app" 2>/dev/null || true
    
    # Run production deployment script
    ./deploy-prod.sh
    
    echo "✅ Successfully switched to production environment"
    echo ""
    echo "🚀 Next steps:"
    echo "   systemctl start llm-router-prod    # Start production service"
    echo "   systemctl status llm-router-prod   # Check status"
}

# Main script logic
case "${1:-}" in
    "dev"|"development")
        switch_to_dev
        ;;
    "prod"|"production")
        switch_to_prod
        ;;
    "status"|"")
        show_status
        ;;
    *)
        echo "❌ Invalid option: $1"
        show_usage
        ;;
esac