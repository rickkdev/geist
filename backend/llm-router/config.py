import os
from typing import List, Optional
from datetime import datetime, timezone
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Application settings with environment-based configuration.
    """
    # Environment
    ENVIRONMENT: str = "development"  # "development" | "production"
    
    # Server settings
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    SSL_ENABLED: bool = False
    SSL_KEYFILE: Optional[str] = None
    SSL_CERTFILE: Optional[str] = None
    
    # Streaming settings
    STREAMING_ENABLED: bool = True
    
    # Security settings
    REQUEST_TTL_SECONDS: int = 60
    DISABLE_DOCS: bool = True  # Disable FastAPI docs in production
    
    # Inference transport settings
    INFERENCE_TRANSPORT: str = "unix"  # "unix" | "https"
    INFERENCE_ENDPOINTS: List[str] = ["/tmp/inference.sock"]  # UNIX socket paths or HTTPS URLs
    INFERENCE_TIMEOUT_SECONDS: int = 60
    INFERENCE_CONNECT_TIMEOUT_SECONDS: int = 10
    
    # Circuit breaker settings
    CIRCUIT_BREAKER_THRESHOLD: int = 5
    CIRCUIT_RESET_SECONDS: int = 30
    CIRCUIT_BREAKER_ENABLED: bool = True
    
    # Rate limiting settings
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_BURST: int = 30
    RATE_LIMIT_ENABLED: bool = True
    
    # HPKE settings
    ROUTER_HPKE_PRIVATE_KEY_PATH: str = "./dev-keys/hpke-private.key"
    ROUTER_HPKE_PUBLIC_KEY_PATH: str = "./dev-keys/hpke-public.key"
    HPKE_KEY_ROTATION_HOURS: int = 24
    
    # Logging settings
    LOG_LEVEL: str = "INFO"
    DISABLE_ACCESS_LOGS: bool = True
    DISABLE_REQUEST_BODY_LOGGING: bool = True
    DISABLE_RESPONSE_BODY_LOGGING: bool = True
    
    # Memory and security settings
    MLOCK_SECRETS: bool = True  # Use mlock for sensitive data
    DISABLE_SWAP_USAGE: bool = True
    
    # Monitoring settings
    METRICS_ENABLED: bool = True
    PROMETHEUS_PUSHGATEWAY_URL: Optional[str] = None
    
    # Development settings
    DEV_RELOAD: bool = False
    DEV_DEBUG: bool = False
    
    class Config:
        env_file = [".env", ".env.development"]  # Try .env.development if it exists
        env_file_encoding = "utf-8"
        case_sensitive = True
    
    def get_current_timestamp(self) -> datetime:
        """Get current UTC timestamp."""
        return datetime.now(timezone.utc)
    
    def is_development(self) -> bool:
        """Check if running in development mode."""
        return self.ENVIRONMENT == "development"
    
    def is_production(self) -> bool:
        """Check if running in production mode."""
        return self.ENVIRONMENT == "production"
    
    def get_inference_socket_path(self) -> Optional[str]:
        """Get the UNIX socket path for inference if using unix transport."""
        if self.INFERENCE_TRANSPORT == "unix" and self.INFERENCE_ENDPOINTS:
            return self.INFERENCE_ENDPOINTS[0]
        return None
    
    def get_inference_https_urls(self) -> List[str]:
        """Get HTTP/HTTPS URLs for inference servers if using http/https transport."""
        if self.INFERENCE_TRANSPORT in ["http", "https"]:
            return [url for url in self.INFERENCE_ENDPOINTS if url.startswith(("http://", "https://"))]
        return []
    
    def should_enable_cors(self) -> bool:
        """Determine if CORS should be enabled (only in development)."""
        return self.is_development()


@lru_cache()
def get_settings() -> Settings:
    """
    Get cached settings instance.
    This function uses lru_cache to ensure we only create one Settings instance.
    """
    return Settings()