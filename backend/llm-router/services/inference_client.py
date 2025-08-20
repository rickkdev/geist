import asyncio
import json
import logging
import time
from typing import AsyncGenerator, Dict, List, Optional

import httpx
from config import Settings
from models import DecryptedChatPayload
from services.health_monitor import HealthMonitor


class InferenceClient:
    """
    Client for communicating with llama.cpp inference server via UNIX socket or HTTPS.
    """
    
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client: Optional[httpx.AsyncClient] = None
        self.health_monitor = HealthMonitor(settings)
        self.active_streams = 0
        self.total_requests = 0
        self.latency_samples: List[float] = []
        self.error_count = 0
        
    async def startup(self):
        """Initialize the HTTP client and health monitor."""
        # Start health monitoring
        await self.health_monitor.startup()
        if self.settings.INFERENCE_TRANSPORT == "unix":
            # For UNIX socket communication - skip if socket doesn't exist
            socket_path = self.settings.get_inference_socket_path()
            if socket_path:
                import os
                if os.path.exists(socket_path):
                    self.client = httpx.AsyncClient(
                        transport=httpx.AsyncHTTPTransport(uds=socket_path),
                        timeout=httpx.Timeout(
                            connect=self.settings.INFERENCE_CONNECT_TIMEOUT_SECONDS,
                            read=self.settings.INFERENCE_READ_TIMEOUT_SECONDS,
                            write=self.settings.INFERENCE_WRITE_TIMEOUT_SECONDS,
                            pool=self.settings.INFERENCE_TIMEOUT_SECONDS
                        )
                    )
                else:
                    logging.warning(f"UNIX socket {socket_path} not found - inference will be unavailable")
                    self.client = None
            else:
                raise ValueError("UNIX socket path not configured")
        else:
            # For HTTP/HTTPS communication in production or development
            client_kwargs = {
                "timeout": httpx.Timeout(
                    connect=self.settings.INFERENCE_CONNECT_TIMEOUT_SECONDS,
                    read=self.settings.INFERENCE_READ_TIMEOUT_SECONDS,
                    write=self.settings.INFERENCE_WRITE_TIMEOUT_SECONDS,
                    pool=self.settings.INFERENCE_TIMEOUT_SECONDS
                )
            }
            
            # Add mTLS configuration for production
            if self.settings.should_use_mtls():
                import ssl
                
                # Create SSL context for mTLS
                ssl_context = ssl.create_default_context()
                
                # Load client certificate and key
                if self.settings.MTLS_CLIENT_CERT_PATH and self.settings.MTLS_CLIENT_KEY_PATH:
                    ssl_context.load_cert_chain(
                        self.settings.MTLS_CLIENT_CERT_PATH,
                        self.settings.MTLS_CLIENT_KEY_PATH
                    )
                
                # Load CA certificate for verification
                if self.settings.MTLS_CA_CERT_PATH:
                    ssl_context.load_verify_locations(self.settings.MTLS_CA_CERT_PATH)
                
                # Configure hostname verification
                if not self.settings.MTLS_VERIFY_HOSTNAME:
                    ssl_context.check_hostname = False
                    ssl_context.verify_mode = ssl.CERT_NONE
                
                client_kwargs["verify"] = ssl_context
                logging.info("mTLS enabled for inference client")
            
            self.client = httpx.AsyncClient(**client_kwargs)
    
    async def shutdown(self):
        """Close the HTTP client and health monitor."""
        if self.client:
            await self.client.aclose()
        await self.health_monitor.shutdown()
    
    async def health_check(self) -> bool:
        """Check if any inference servers are healthy."""
        return self.health_monitor.get_healthy_node_count() > 0
    
    async def stream_chat(self, payload: DecryptedChatPayload, request_id: str = None) -> AsyncGenerator[str, None]:
        """
        Stream chat completion from inference server with request budget and cancellation support.
        """
        if not self.client:
            raise RuntimeError("Client not initialized")
        
        self.active_streams += 1
        self.total_requests += 1
        start_time = time.time()
        
        # Set up request budget timeout
        budget_timeout = self.settings.REQUEST_BUDGET_SECONDS
        request_deadline = start_time + budget_timeout
        
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
            
            # Choose endpoint using health monitor
            if self.settings.INFERENCE_TRANSPORT == "unix":
                url = "http://localhost/v1/chat/completions"
            else:
                # Get a healthy endpoint from the health monitor
                healthy_endpoint = await self.health_monitor.get_healthy_endpoint()
                if healthy_endpoint == "unix_socket":
                    url = "http://localhost/v1/chat/completions"
                else:
                    url = f"{healthy_endpoint}/v1/chat/completions"
            
            async with self.client.stream(
                "POST",
                url,
                json=request_data,
                headers={"Content-Type": "application/json"}
            ) as response:
                response.raise_for_status()
                
                async for line in response.aiter_lines():
                    # Check request budget timeout
                    current_time = time.time()
                    if current_time > request_deadline:
                        logging.warning(f"Request {request_id} exceeded budget timeout of {budget_timeout}s")
                        raise asyncio.TimeoutError("Request budget exceeded")
                    
                    if line.startswith("data: "):
                        data = line[6:]  # Remove "data: " prefix
                        
                        if data.strip() == "[DONE]":
                            break
                        
                        try:
                            chunk_data = json.loads(data)
                            if "choices" in chunk_data and chunk_data["choices"]:
                                delta = chunk_data["choices"][0].get("delta", {})
                                if "content" in delta and delta["content"] is not None:
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
    
    def get_health_status(self) -> Dict:
        """Get detailed health status of all monitored nodes."""
        return self.health_monitor.get_health_status()
    
    def get_healthy_node_count(self) -> int:
        """Get the number of currently healthy nodes."""
        return self.health_monitor.get_healthy_node_count()