import logging
import base64
import asyncio
from contextlib import asynccontextmanager
from typing import Dict, Any

from fastapi import FastAPI, Request, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sse_starlette.sse import EventSourceResponse
import uvicorn

from config import get_settings
from models import ChatRequest, HealthResponse, PubkeyResponse, MetricsResponse, InferenceRequest
from services.inference_client import InferenceClient
from services.inference_service import InferenceService
from services.hpke_service import HPKEService
from services.rate_limiter import RateLimiter
from services.circuit_breaker import CircuitBreaker
from middleware.logging_middleware import setup_secure_logging


# Initialize settings
settings = get_settings()

# Initialize services
inference_client = InferenceClient(settings)
inference_service = InferenceService(settings)
hpke_service = HPKEService(settings)
rate_limiter = RateLimiter(settings)
circuit_breaker = CircuitBreaker(settings)

# Background task for key rotation
async def key_rotation_task():
    """Background task to periodically check and rotate HPKE keys."""
    while True:
        try:
            if hpke_service.should_rotate_keys():
                hpke_service.rotate_keys()
            await asyncio.sleep(3600)  # Check every hour
        except Exception as e:
            logging.error(f"Key rotation task error: {e}")
            await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    setup_secure_logging()
    await inference_client.startup()
    await inference_service.startup()
    
    # Start key rotation background task
    key_rotation_task_handle = asyncio.create_task(key_rotation_task())
    
    yield
    
    # Shutdown
    key_rotation_task_handle.cancel()
    try:
        await key_rotation_task_handle
    except asyncio.CancelledError:
        pass
    await inference_client.shutdown()
    await inference_service.shutdown()


# Initialize FastAPI app
app = FastAPI(
    title="Privacy-Focused LLM Router",
    description="Secure, end-to-end encrypted LLM inference router",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,  # Disable docs in production
    redoc_url=None,  # Disable redoc in production
)

# Add CORS middleware (configure restrictively in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.ENVIRONMENT == "development" else [],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.post("/api/chat")
async def chat_endpoint(request: Request, chat_request: ChatRequest):
    """
    Main chat endpoint that accepts HPKE-encrypted requests and streams 
    HPKE-encrypted chunks back via Server-Sent Events.
    """
    client_ip = request.client.host
    
    # Rate limiting
    if not rate_limiter.allow_request(client_ip, chat_request.device_pubkey):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded"
        )
    
    # Circuit breaker check
    if not circuit_breaker.can_make_request():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable"
        )
    
    try:
        # Decrypt the request using HPKE
        logging.info(f"Decrypting request {chat_request.request_id}")
        decrypted_payload = hpke_service.decrypt_request(chat_request)
        logging.info(f"Decrypted payload: {decrypted_payload.messages[0]['content'][:50]}...")
        
        # Convert decrypted payload to inference request with parameter guardrails
        inference_request = InferenceRequest(
            messages=decrypted_payload.messages,
            temperature=decrypted_payload.temperature,
            top_p=decrypted_payload.top_p,
            max_tokens=decrypted_payload.max_tokens,
            request_id=chat_request.request_id
        )
        
        # Create streaming generator with client disconnect detection and per-chunk HPKE encryption
        async def event_stream():
            chunk_sequence = 0
            try:
                logging.info(f"Starting encrypted streaming for request {chat_request.request_id}")
                
                # Stream tokens from new inference service with SSE parsing
                async for token in inference_service.stream_inference(inference_request):
                    # Check if client is still connected (if cancellation is enabled)
                    if settings.ENABLE_CLIENT_DISCONNECT_CANCELLATION:
                        if await request.is_disconnected():
                            logging.info(f"Client disconnected for request {chat_request.request_id}, cancelling stream")
                            break
                    
                    # Per-chunk HPKE encryption - encrypt each token individually
                    client_pubkey = base64.b64decode(chat_request.device_pubkey)
                    encrypted_chunk = hpke_service.encrypt_chunk(token, client_pubkey, chunk_sequence)
                    logging.debug(f"Encrypted token {chunk_sequence}: {token[:30]}...")
                    
                    # Send encrypted chunk as SSE event
                    yield {"data": encrypted_chunk, "event": "chunk"}
                    chunk_sequence += 1
                    
                # Send end event (also encrypted)
                end_encrypted = hpke_service.encrypt_chunk("", client_pubkey, chunk_sequence)
                yield {"data": end_encrypted, "event": "end"}
                
                circuit_breaker.record_success()
                
            except asyncio.TimeoutError as e:
                circuit_breaker.record_failure()
                logging.warning(f"Request {chat_request.request_id} timeout: {e}")
                yield {"data": "Request timeout", "event": "error"}
            except Exception as e:
                circuit_breaker.record_failure()
                logging.error(f"Stream error: {type(e).__name__}")
                yield {"data": "Internal server error", "event": "error"}
        
        return EventSourceResponse(event_stream())
        
    except Exception as e:
        circuit_breaker.record_failure()
        logging.error(f"Chat endpoint error: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@app.post("/inference")
async def inference_endpoint(request: Request, inference_request: InferenceRequest):
    """
    Dedicated inference endpoint that accepts plaintext requests and streams 
    tokens back via Server-Sent Events. This is step 9 implementation.
    """
    client_ip = request.client.host
    
    # Basic rate limiting (could extend with device-based limiting if needed)
    request_key = f"inference_{client_ip}"
    if not rate_limiter.allow_request(client_ip, request_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded"
        )
    
    # Circuit breaker check
    if not circuit_breaker.can_make_request():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable"
        )
    
    try:
        logging.info(f"Starting inference for request {inference_request.request_id}")
        logging.debug(f"Message: {inference_request.messages[0]['content'][:50]}...")
        
        # Create streaming generator
        async def token_stream():
            chunk_sequence = 0
            try:
                # Stream tokens from llama.cpp via inference service
                async for token in inference_service.stream_inference(inference_request):
                    # Check if client is still connected
                    if settings.ENABLE_CLIENT_DISCONNECT_CANCELLATION:
                        if await request.is_disconnected():
                            logging.info(f"Client disconnected for request {inference_request.request_id}")
                            break
                    
                    # Yield token as SSE event
                    yield {"data": token, "event": "token"}
                    chunk_sequence += 1
                    
                # Send completion event
                yield {"data": "", "event": "done"}
                
                circuit_breaker.record_success()
                
            except asyncio.TimeoutError as e:
                circuit_breaker.record_failure()
                logging.warning(f"Request {inference_request.request_id} timeout: {e}")
                yield {"data": "Request timeout", "event": "error"}
            except Exception as e:
                circuit_breaker.record_failure()
                logging.error(f"Inference stream error: {type(e).__name__}")
                yield {"data": "Internal server error", "event": "error"}
        
        return EventSourceResponse(token_stream())
        
    except Exception as e:
        circuit_breaker.record_failure()
        logging.error(f"Inference endpoint error: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@app.get("/api/pubkey", response_model=PubkeyResponse)
async def get_public_keys():
    """
    Returns current and next router HPKE public keys for key rotation.
    """
    try:
        keys = hpke_service.get_public_keys()
        return PubkeyResponse(**keys)
    except Exception as e:
        logging.error(f"Pubkey endpoint error: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint for liveness and readiness probes.
    Returns no sensitive information.
    """
    try:
        inference_healthy = await inference_client.health_check()
        
        status_code = status.HTTP_200_OK if inference_healthy else status.HTTP_503_SERVICE_UNAVAILABLE
        
        return JSONResponse(
            status_code=status_code,
            content={
                "status": "healthy" if inference_healthy else "unhealthy",
                "timestamp": settings.get_current_timestamp().isoformat(),
                "version": "1.0.0"
            }
        )
    except Exception as e:
        logging.error(f"Health check error: {type(e).__name__}")
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "unhealthy",
                "timestamp": settings.get_current_timestamp().isoformat(),
                "version": "1.0.0"
            }
        )


@app.post("/api/chat/debug")
async def chat_debug_endpoint(request: Request, chat_request: ChatRequest):
    """
    Debug version of chat endpoint to isolate issues.
    """
    try:
        logging.info(f"DEBUG: Received request {chat_request.request_id}")
        
        # Test HPKE decryption
        decrypted_payload = hpke_service.decrypt_request(chat_request)
        logging.info(f"DEBUG: Decrypted successfully: {decrypted_payload.messages[0]['content']}")
        
        # Return simple response instead of streaming
        return JSONResponse({
            "status": "success",
            "message": "HPKE decryption successful",
            "decrypted_content": decrypted_payload.messages[0]['content'],
            "max_tokens": decrypted_payload.max_tokens
        })
        
    except Exception as e:
        logging.error(f"DEBUG: Error in chat debug: {type(e).__name__}: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "type": type(e).__name__}
        )


@app.get("/metrics", response_model=MetricsResponse)
async def metrics_endpoint():
    """
    Prometheus metrics endpoint. Returns no payloads or sensitive data.
    """
    try:
        metrics = {
            "active_streams": inference_client.get_active_streams(),
            "total_requests": rate_limiter.get_total_requests(),
            "circuit_breaker_state": circuit_breaker.get_state(),
            "inference_latency_p50": inference_client.get_latency_p50(),
            "inference_latency_p95": inference_client.get_latency_p95(),
            "tokens_per_second": inference_client.get_tokens_per_second(),
            "error_rate_5xx": inference_client.get_error_rate(),
            "healthy_nodes": inference_client.get_healthy_node_count(),
            "node_health_status": inference_client.get_health_status(),
        }
        return MetricsResponse(**metrics)
    except Exception as e:
        logging.error(f"Metrics endpoint error: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        ssl_keyfile=settings.SSL_KEYFILE if settings.SSL_ENABLED else None,
        ssl_certfile=settings.SSL_CERTFILE if settings.SSL_ENABLED else None,
        reload=settings.ENVIRONMENT == "development",
        access_log=False,  # Disable access logs to prevent sensitive data logging
    )