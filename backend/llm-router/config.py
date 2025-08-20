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
    INFERENCE_ENDPOINTS: List[str] = ["/run/inference.sock"]  # UNIX socket paths or HTTPS URLs
    INFERENCE_TIMEOUT_SECONDS: int = 60
    INFERENCE_CONNECT_TIMEOUT_SECONDS: int = 10
    INFERENCE_READ_TIMEOUT_SECONDS: int = 120  # Longer read timeout for streaming
    INFERENCE_WRITE_TIMEOUT_SECONDS: int = 30  # Write timeout for requests
    REQUEST_BUDGET_SECONDS: int = 300  # Maximum total time per request
    ENABLE_CLIENT_DISCONNECT_CANCELLATION: bool = True  # Cancel on client disconnect
    
    # Health check settings
    HEALTH_CHECK_INTERVAL_SECONDS: int = 30  # How often to check node health
    HEALTH_CHECK_TIMEOUT_SECONDS: int = 5    # Timeout for each health check
    UNHEALTHY_THRESHOLD: int = 3             # Consecutive failures before marking unhealthy
    HEALTHY_THRESHOLD: int = 2               # Consecutive successes before marking healthy
    
    # Production mTLS settings
    MTLS_ENABLED: bool = False  # Enable mTLS for production
    MTLS_CLIENT_CERT_PATH: Optional[str] = None  # Client certificate for mTLS
    MTLS_CLIENT_KEY_PATH: Optional[str] = None   # Client private key for mTLS
    MTLS_CA_CERT_PATH: Optional[str] = None      # CA certificate for verification
    MTLS_VERIFY_HOSTNAME: bool = True            # Verify hostname in certificates
    
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
        env_file = [".env"]  # Primary env file
        env_file_encoding = "utf-8"
        case_sensitive = True
        
        @classmethod
        def prepare_field_env_vars(cls, field_name: str, field_info):
            """Customize environment variable sources based on current environment."""
            env_vars = [field_name]
            
            # Check if we have an environment-specific override
            current_env = os.environ.get("ENVIRONMENT", "development")
            if current_env in ["development", "production"]:
                env_vars.append(f"{current_env.upper()}_{field_name}")
                
            return env_vars
    
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
    
    def get_production_endpoints(self) -> List[str]:
        """Get production inference endpoints with WireGuard IPs."""
        if self.is_production() and self.INFERENCE_TRANSPORT == "https":
            # Production endpoints should use WireGuard private network IPs
            return [url for url in self.INFERENCE_ENDPOINTS if url.startswith("https://10.0.0.")]
        return []
    
    def should_use_mtls(self) -> bool:
        """Check if mTLS should be enabled for inference connections."""
        return self.is_production() and self.MTLS_ENABLED and self.INFERENCE_TRANSPORT == "https"


@lru_cache()
def get_settings() -> Settings:
    """
    Get cached settings instance.
    This function uses lru_cache to ensure we only create one Settings instance.
    """
    return Settings()