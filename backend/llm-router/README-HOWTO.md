# 🚀 How to Run the LLM Router

Simple guide for starting the development and production servers.

## 🔧 Development Mode (Simple)

**What you need:**
- llama.cpp built and ready
- A model file downloaded
- Python environment set up

**Start everything:**
```bash
./start-dev.sh
```

**That's it!** This script will:
1. Start llama.cpp server on localhost:8001
2. Start FastAPI router on localhost:8000
3. Handle all the setup automatically
4. Stop everything when you press Ctrl+C

**Test it works:**
```bash
# Health check
curl http://localhost:8000/health

# Send encrypted request
python3 create_hpke_request.py "Hello!" | grep curl | bash
```

## 🏭 Production Mode (Advanced)

**For production deployment on actual servers:**

```bash
sudo ./start-prod.sh
```

This handles systemd services, WireGuard, certificates, etc.

## 📁 What Files Matter

**For development, you only need:**
- `start-dev.sh` - Start everything
- `main.py` - Your FastAPI router (already exists)
- llama.cpp built in `../llama.cpp/`
- A model file

**The other files are for:**
- Production deployment (systemd, WireGuard, certificates)
- Security hardening
- Network configuration
- Documentation

## 🔍 If Something Goes Wrong

**Development issues:**
```bash
# Check if llama.cpp is built
ls ../llama.cpp/build/bin/llama-server

# Check if model exists
ls ../llama.cpp/models/*.gguf

# Check ports are free
lsof -i :8000
lsof -i :8001
```

**Still stuck?**
- Check the terminal output from `start-dev.sh`
- The script shows exactly what went wrong
- Make sure you're in the right directory

## 🎯 Summary

**For development:** Just run `./start-dev.sh`

**For production:** Run `sudo ./start-prod.sh` on your servers

The development script replaces all the complex systemd/UNIX socket setup with a simple approach that just works for testing and development.