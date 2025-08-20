from typing import Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime


class ChatRequest(BaseModel):
    """
    Encrypted chat request from client using HPKE.
    """
    encapsulated_key: str = Field(..., description="HPKE encapsulated key (base64)")
    ciphertext: str = Field(..., description="Encrypted payload (base64)")
    aad: str = Field(..., description="Additional authenticated data (base64)")
    timestamp: datetime = Field(..., description="Request timestamp for replay protection")
    request_id: str = Field(..., description="Unique request identifier")
    device_pubkey: str = Field(..., description="Device public key for rate limiting")


class DecryptedChatPayload(BaseModel):
    """
    Decrypted chat payload after HPKE decryption.
    """
    messages: list[Dict[str, str]] = Field(..., description="Chat messages array")
    temperature: Optional[float] = Field(default=0.7, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=0.9, ge=0.0, le=1.0)
    max_tokens: Optional[int] = Field(default=2048, ge=1, le=8192)
    stream: bool = Field(default=True, description="Enable streaming response")


class PubkeyResponse(BaseModel):
    """
    Public keys response for HPKE key rotation.
    """
    current_pubkey: str = Field(..., description="Current HPKE public key (base64)")
    next_pubkey: Optional[str] = Field(None, description="Next HPKE public key for rotation (base64)")
    key_id: str = Field(..., description="Current key identifier")
    expires_at: datetime = Field(..., description="Current key expiration time")


class HealthResponse(BaseModel):
    """
    Health check response.
    """
    status: str = Field(..., description="Service health status")
    timestamp: datetime = Field(..., description="Health check timestamp")
    version: str = Field(..., description="Service version")


class MetricsResponse(BaseModel):
    """
    Prometheus metrics response (no sensitive data).
    """
    active_streams: int = Field(..., description="Number of active streaming connections")
    total_requests: int = Field(..., description="Total requests processed")
    circuit_breaker_state: str = Field(..., description="Circuit breaker state (open/closed/half-open)")
    inference_latency_p50: float = Field(..., description="50th percentile inference latency (ms)")
    inference_latency_p95: float = Field(..., description="95th percentile inference latency (ms)")
    tokens_per_second: float = Field(..., description="Average tokens per second")
    error_rate_5xx: float = Field(..., description="5xx error rate percentage")
    healthy_nodes: int = Field(..., description="Number of healthy inference nodes")
    node_health_status: Dict[str, Any] = Field(..., description="Detailed health status of all nodes")


class EncryptedChunk(BaseModel):
    """
    Encrypted response chunk for streaming.
    """
    ciphertext: str = Field(..., description="Encrypted chunk data (base64)")
    sequence: int = Field(..., description="Chunk sequence number")
    final: bool = Field(default=False, description="Whether this is the final chunk")