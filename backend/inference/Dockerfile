FROM ghcr.io/ggml-org/llama.cpp:server

# Build arguments for the model (matching our service configuration)
ARG MODEL_REPO=TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF
ARG MODEL_FILE=tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf

# Install wget and curl for downloading models
USER root
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create models directory and download the model (using the same model as our service)
RUN mkdir -p /models && \
    wget -O /models/${MODEL_FILE} https://huggingface.co/${MODEL_REPO}/resolve/main/${MODEL_FILE}

# Switch back to non-root user
USER 1000

# Expose port 8001 (matching systemd service)
EXPOSE 8001

# Environment variables for configuration (matching systemd service)
ENV MODEL_PATH=/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
ENV HOST=0.0.0.0
ENV PORT=8001
ENV CONTEXT_SIZE=4096
ENV THREADS=0
ENV GPU_LAYERS=0

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

# Just provide the arguments (ENTRYPOINT already has /app/llama-server)
# Matching systemd service: -m model -c 4096 -ngl 0 --port 8001 --host 127.0.0.1
CMD ["--model", "/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf", \
     "--host", "0.0.0.0", \
     "--port", "8001", \
     "--ctx-size", "4096", \
     "--threads", "0", \
     "--n-gpu-layers", "0"]