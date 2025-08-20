import logging
from contextlib import asynccontextmanager
from typing import Dict, Any

from fastapi import FastAPI, Request, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sse_starlette.sse import EventSourceResponse
import uvicorn

from config import get_settings
from models import ChatRequest, HealthResponse, PubkeyResponse, MetricsResponse
from services.inference_client import InferenceClient
from services.hpke_service import HPKEService
from services.rate_limiter import RateLimiter
from services.circuit_breaker import CircuitBreaker
from middleware.logging_middleware import setup_secure_logging


# Initialize settings
settings = get_settings()

# Initialize services
inference_client = InferenceClient(settings)
hpke_service = HPKEService(settings)
rate_limiter = RateLimiter(settings)
circuit_breaker = CircuitBreaker(settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    setup_secure_logging()
    await inference_client.startup()
    yield
    # Shutdown
    await inference_client.shutdown()


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
        decrypted_payload = hpke_service.decrypt_request(chat_request)
        
        # Create streaming generator
        async def event_stream():
            try:
                async for chunk in inference_client.stream_chat(decrypted_payload):
                    # Re-encrypt each chunk with HPKE
                    encrypted_chunk = hpke_service.encrypt_chunk(chunk)
                    yield {
                        "event": "chunk",
                        "data": encrypted_chunk
                    }
                    
                # Send end event
                yield {
                    "event": "end",
                    "data": ""
                }
                
                circuit_breaker.record_success()
                
            except Exception as e:
                circuit_breaker.record_failure()
                logging.error(f"Stream error: {type(e).__name__}")
                yield {
                    "event": "error",
                    "data": "Internal server error"
                }
        
        return EventSourceResponse(event_stream())
        
    except Exception as e:
        circuit_breaker.record_failure()
        logging.error(f"Chat endpoint error: {type(e).__name__}")
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
                "timestamp": settings.get_current_timestamp(),
                "version": "1.0.0"
            }
        )
    except Exception as e:
        logging.error(f"Health check error: {type(e).__name__}")
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "unhealthy",
                "timestamp": settings.get_current_timestamp(),
                "version": "1.0.0"
            }
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