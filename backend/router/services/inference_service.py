import asyncio
import json
import logging
import time
from typing import AsyncGenerator, Dict, List, Optional

import httpx
from config import Settings
from models import InferenceRequest
from services.health_monitor import HealthMonitor


class InferenceService:
    """
    Dedicated service for inference endpoint with SSE token streaming.
    Parses llama.cpp SSE format and provides clean token stream.
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
        await self.health_monitor.startup()

        if self.settings.INFERENCE_TRANSPORT == "unix":
            # For UNIX socket communication
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
                            pool=self.settings.INFERENCE_TIMEOUT_SECONDS,
                        ),
                    )
                else:
                    logging.warning(
                        f"UNIX socket {socket_path} not found - inference will be unavailable"
                    )
                    self.client = None
            else:
                raise ValueError("UNIX socket path not configured")
        else:
            # For HTTP/HTTPS communication in production
            client_kwargs = {
                "timeout": httpx.Timeout(
                    connect=self.settings.INFERENCE_CONNECT_TIMEOUT_SECONDS,
                    read=self.settings.INFERENCE_READ_TIMEOUT_SECONDS,
                    write=self.settings.INFERENCE_WRITE_TIMEOUT_SECONDS,
                    pool=self.settings.INFERENCE_TIMEOUT_SECONDS,
                )
            }

            # Add mTLS configuration for production
            if self.settings.should_use_mtls():
                import ssl

                ssl_context = ssl.create_default_context()

                if (
                    self.settings.MTLS_CLIENT_CERT_PATH
                    and self.settings.MTLS_CLIENT_KEY_PATH
                ):
                    ssl_context.load_cert_chain(
                        self.settings.MTLS_CLIENT_CERT_PATH,
                        self.settings.MTLS_CLIENT_KEY_PATH,
                    )

                if self.settings.MTLS_CA_CERT_PATH:
                    ssl_context.load_verify_locations(self.settings.MTLS_CA_CERT_PATH)

                if not self.settings.MTLS_VERIFY_HOSTNAME:
                    ssl_context.check_hostname = False
                    ssl_context.verify_mode = ssl.CERT_NONE

                client_kwargs["verify"] = ssl_context
                logging.info("mTLS enabled for inference service")

            self.client = httpx.AsyncClient(**client_kwargs)

    async def shutdown(self):
        """Close the HTTP client and health monitor."""
        if self.client:
            await self.client.aclose()
        await self.health_monitor.shutdown()

    async def health_check(self) -> bool:
        """Check if any inference servers are healthy."""
        return self.health_monitor.get_healthy_node_count() > 0

    async def stream_inference(
        self, request: InferenceRequest
    ) -> AsyncGenerator[str, None]:
        """
        Stream tokens from llama.cpp SSE endpoint.

        This method:
        1. Sends request to llama.cpp /v1/chat/completions
        2. Parses the SSE response format
        3. Yields clean token strings for re-encryption by router
        """
        if not self.client:
            raise RuntimeError("Inference service not initialized")

        self.active_streams += 1
        self.total_requests += 1
        start_time = time.time()

        # Set up request budget timeout
        budget_timeout = self.settings.REQUEST_BUDGET_SECONDS
        request_deadline = start_time + budget_timeout

        try:
            # Convert to llama.cpp chat completions format
            request_data = {
                "messages": request.messages,
                "temperature": request.temperature,
                "top_p": request.top_p,
                "max_tokens": request.max_tokens,
                "stream": True,
                "stream_options": {"include_usage": False},
            }

            logging.info(f"Starting inference stream for request {request.request_id}")
            logging.debug(
                f"Request params: temp={request.temperature}, top_p={request.top_p}, max_tokens={request.max_tokens}"
            )

            # Choose endpoint using health monitor
            if self.settings.INFERENCE_TRANSPORT == "unix":
                url = "http://localhost/v1/chat/completions"
            else:
                healthy_endpoint = await self.health_monitor.get_healthy_endpoint()
                if healthy_endpoint == "unix_socket":
                    url = "http://localhost/v1/chat/completions"
                else:
                    url = f"{healthy_endpoint}/v1/chat/completions"

            async with self.client.stream(
                "POST",
                url,
                json=request_data,
                headers={"Content-Type": "application/json"},
            ) as response:
                response.raise_for_status()

                token_count = 0
                async for line in response.aiter_lines():
                    # Check request budget timeout
                    current_time = time.time()
                    if current_time > request_deadline:
                        logging.warning(
                            f"Request {request.request_id} exceeded budget timeout of {budget_timeout}s"
                        )
                        raise asyncio.TimeoutError("Request budget exceeded")

                    # Parse SSE format: lines starting with "data: "
                    if line.startswith("data: "):
                        data = line[6:]  # Remove "data: " prefix

                        # Check for completion
                        if data.strip() == "[DONE]":
                            logging.info(
                                f"Stream completed for request {request.request_id}, tokens: {token_count}"
                            )
                            break

                        try:
                            # Parse JSON chunk from llama.cpp
                            chunk_data = json.loads(data)

                            if "choices" in chunk_data and chunk_data["choices"]:
                                choice = chunk_data["choices"][0]
                                delta = choice.get("delta", {})

                                # Extract token content
                                if "content" in delta and delta["content"] is not None:
                                    token = delta["content"]
                                    if token:  # Only yield non-empty tokens
                                        token_count += 1
                                        logging.debug(
                                            f"Yielding token {token_count}: {repr(token[:50])}"
                                        )
                                        yield token

                                # Check if this is the final chunk
                                finish_reason = choice.get("finish_reason")
                                if finish_reason:
                                    logging.info(
                                        f"Stream finished for request {request.request_id}, reason: {finish_reason}"
                                    )
                                    break

                        except json.JSONDecodeError as e:
                            logging.warning(
                                f"Failed to parse SSE data: {e}, data: {data[:100]}"
                            )
                            continue
                        except Exception as e:
                            logging.error(f"Error processing SSE chunk: {e}")
                            continue

            # Record successful completion
            elapsed = (time.time() - start_time) * 1000  # Convert to ms
            self.latency_samples.append(elapsed)
            if len(self.latency_samples) > 1000:
                self.latency_samples = self.latency_samples[-1000:]

        except Exception as e:
            self.error_count += 1
            logging.error(f"Inference streaming error: {type(e).__name__}: {e}")
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
        # TODO: Implement actual token rate calculation
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
