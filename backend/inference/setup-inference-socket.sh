#!/bin/bash

# Setup script for inference UNIX socket
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LLAMA_DIR="$SCRIPT_DIR/llama.cpp"

echo "Setting up inference UNIX socket..."

# 1. Create users if they don't exist
if ! id -u inference &>/dev/null; then
    echo "Creating inference user..."
    sudo useradd -r -s /bin/false -d /nonexistent inference
fi

if ! getent group router &>/dev/null; then
    echo "Creating router group..."
    sudo groupadd router
fi

# 2. Create directories and set permissions
echo "Setting up directories..."
sudo mkdir -p /opt/llama.cpp
sudo cp -r "$LLAMA_DIR"/* /opt/llama.cpp/
sudo chown -R inference:inference /opt/llama.cpp
sudo chmod +x /opt/llama.cpp/build/bin/llama-server

# 3. Install systemd services
echo "Installing systemd services..."
sudo cp "$SCRIPT_DIR/llama-inference.service" /etc/systemd/system/
sudo cp "$SCRIPT_DIR/inference-socket.service" /etc/systemd/system/

# 4. Reload systemd and enable services
echo "Enabling services..."
sudo systemctl daemon-reload
sudo systemctl enable llama-inference.service
sudo systemctl enable inference-socket.service

# 5. Test the setup (without starting services)
echo "Testing configuration..."
sudo systemctl start llama-inference.service
sleep 5
sudo systemctl start inference-socket.service
sleep 2

# 6. Test socket connectivity
echo "Testing UNIX socket connectivity..."
if curl --unix-socket /run/inference.sock http://localhost/health &>/dev/null; then
    echo "✅ UNIX socket setup successful!"
else
    echo "❌ UNIX socket test failed"
    sudo systemctl status llama-inference.service
    sudo systemctl status inference-socket.service
    exit 1
fi

echo "
Setup complete! Services are now running:
- llama-inference.service: Llama.cpp HTTP server on localhost:8001
- inference-socket.service: UNIX socket proxy at /run/inference.sock

To manage the services:
  sudo systemctl start|stop|restart llama-inference.service
  sudo systemctl start|stop|restart inference-socket.service
  sudo systemctl status llama-inference.service
  sudo systemctl status inference-socket.service

To test:
  curl --unix-socket /run/inference.sock http://localhost/health
"