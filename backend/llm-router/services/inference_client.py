import asyncio
import json
import logging
import time
from typing import AsyncGenerator, Dict, List, Optional
from datetime import datetime

import httpx
from config import Settings
from models import DecryptedChatPayload


class InferenceClient:
    """
    Client for communicating with llama.cpp inference server via UNIX socket or HTTPS.
    """
    
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client: Optional[httpx.AsyncClient] = None
        self.active_streams = 0
        self.total_requests = 0
        self.latency_samples: List[float] = []
        self.error_count = 0
        
    async def startup(self):
        """Initialize the HTTP client."""
        if self.settings.INFERENCE_TRANSPORT == "unix":
            # For UNIX socket communication
            socket_path = self.settings.get_inference_socket_path()
            if socket_path:
                self.client = httpx.AsyncClient(
                    transport=httpx.AsyncHTTPTransport(uds=socket_path),
                    timeout=httpx.Timeout(
                        connect=self.settings.INFERENCE_CONNECT_TIMEOUT_SECONDS,
                        read=self.settings.INFERENCE_TIMEOUT_SECONDS
                    )
                )
            else:
                raise ValueError("UNIX socket path not configured")
        else:
            # For HTTPS communication in production
            self.client = httpx.AsyncClient(
                timeout=httpx.Timeout(
                    connect=self.settings.INFERENCE_CONNECT_TIMEOUT_SECONDS,
                    read=self.settings.INFERENCE_TIMEOUT_SECONDS
                )
            )
    
    async def shutdown(self):
        """Close the HTTP client."""
        if self.client:
            await self.client.aclose()
    
    async def health_check(self) -> bool:
        """Check if inference server is healthy."""
        if not self.client:
            return False
            
        try:
            if self.settings.INFERENCE_TRANSPORT == "unix":
                response = await self.client.get("http://localhost/health")
            else:
                # For HTTPS endpoints, use the first available
                urls = self.settings.get_inference_https_urls()
                if not urls:
                    return False
                response = await self.client.get(f"{urls[0]}/health")
            
            return response.status_code == 200
        except Exception as e:
            logging.error(f"Health check failed: {type(e).__name__}")
            return False
    
    async def stream_chat(self, payload: DecryptedChatPayload) -> AsyncGenerator[str, None]:
        """
        Stream chat completion from inference server.
        """
        if not self.client:
            raise RuntimeError("Client not initialized")
        
        self.active_streams += 1
        self.total_requests += 1
        start_time = time.time()
        
        try:
            # Convert to llama.cpp chat completions format
            request_data = {
                "messages": payload.messages,
                "temperature": payload.temperature,
                "top_p": payload.top_p,
                "max_tokens": payload.max_tokens,
                "stream": True,
                "stream_options": {"include_usage": False}
            }
            
            # Choose endpoint based on transport
            if self.settings.INFERENCE_TRANSPORT == "unix":
                url = "http://localhost/v1/chat/completions"
            else:
                urls = self.settings.get_inference_https_urls()
                if not urls:
                    raise RuntimeError("No HTTPS inference endpoints configured")
                url = f"{urls[0]}/v1/chat/completions"
            
            async with self.client.stream(
                "POST",
                url,
                json=request_data,
                headers={"Content-Type": "application/json"}
            ) as response:
                response.raise_for_status()
                
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]  # Remove "data: " prefix
                        
                        if data.strip() == "[DONE]":
                            break
                        
                        try:
                            chunk_data = json.loads(data)
                            if "choices" in chunk_data and chunk_data["choices"]:
                                delta = chunk_data["choices"][0].get("delta", {})
                                if "content" in delta:
                                    yield delta["content"]
                        except json.JSONDecodeError:
                            continue
            
            # Record successful completion
            elapsed = (time.time() - start_time) * 1000  # Convert to ms
            self.latency_samples.append(elapsed)
            # Keep only last 1000 samples for memory efficiency
            if len(self.latency_samples) > 1000:
                self.latency_samples = self.latency_samples[-1000:]
                
        except Exception as e:
            self.error_count += 1
            logging.error(f"Streaming error: {type(e).__name__}")
            raise
        finally:
            self.active_streams -= 1
    
    def get_active_streams(self) -> int:
        """Get number of active streaming connections."""
        return self.active_streams
    
    def get_total_requests(self) -> int:
        """Get total number of requests processed."""
        return self.total_requests
    
    def get_latency_p50(self) -> float:
        """Get 50th percentile latency in milliseconds."""
        if not self.latency_samples:
            return 0.0
        sorted_samples = sorted(self.latency_samples)
        idx = int(len(sorted_samples) * 0.5)
        return sorted_samples[idx]
    
    def get_latency_p95(self) -> float:
        """Get 95th percentile latency in milliseconds."""
        if not self.latency_samples:
            return 0.0
        sorted_samples = sorted(self.latency_samples)
        idx = int(len(sorted_samples) * 0.95)
        return sorted_samples[idx]
    
    def get_tokens_per_second(self) -> float:
        """Get average tokens per second (placeholder implementation)."""
        # This would require tracking token counts from responses
        # For now, return a placeholder value
        return 50.0
    
    def get_error_rate(self) -> float:
        """Get 5xx error rate as percentage."""
        if self.total_requests == 0:
            return 0.0
        return (self.error_count / self.total_requests) * 100