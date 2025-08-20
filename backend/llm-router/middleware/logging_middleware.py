import logging
import sys
from typing import Dict, Any
from datetime import datetime

from config import get_settings


class SanitizedFormatter(logging.Formatter):
    """
    Custom logging formatter that sanitizes sensitive data.
    """
    
    SENSITIVE_FIELDS = {
        'encapsulated_key', 'ciphertext', 'aad', 'device_pubkey',
        'authorization', 'cookie', 'session', 'token', 'key',
        'password', 'secret', 'private'
    }
    
    def format(self, record: logging.LogRecord) -> str:
        # Sanitize the message
        if hasattr(record, 'args') and record.args:
            record.args = tuple(self._sanitize_value(arg) for arg in record.args)
        
        record.msg = self._sanitize_value(record.msg)
        
        return super().format(record)
    
    def _sanitize_value(self, value: Any) -> Any:
        """Sanitize sensitive values."""
        if isinstance(value, str):
            return self._sanitize_string(value)
        elif isinstance(value, dict):
            return self._sanitize_dict(value)
        elif isinstance(value, (list, tuple)):
            return type(value)(self._sanitize_value(item) for item in value)
        return value
    
    def _sanitize_string(self, text: str) -> str:
        """Sanitize sensitive information in strings."""
        if any(field in text.lower() for field in self.SENSITIVE_FIELDS):
            return "[REDACTED]"
        return text
    
    def _sanitize_dict(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Sanitize sensitive keys in dictionaries."""
        sanitized = {}
        for key, value in data.items():
            if key.lower() in self.SENSITIVE_FIELDS:
                sanitized[key] = "[REDACTED]"
            else:
                sanitized[key] = self._sanitize_value(value)
        return sanitized


def setup_secure_logging():
    """
    Configure secure logging that prevents sensitive data leakage.
    """
    settings = get_settings()
    
    # Remove all existing handlers
    root_logger = logging.getLogger()
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Configure root logger
    root_logger.setLevel(getattr(logging, settings.LOG_LEVEL.upper()))
    
    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(getattr(logging, settings.LOG_LEVEL.upper()))
    
    # Create sanitized formatter
    formatter = SanitizedFormatter(
        fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(formatter)
    
    # Add handler to root logger
    root_logger.addHandler(console_handler)
    
    # Disable uvicorn access logs if configured
    if settings.DISABLE_ACCESS_LOGS:
        uvicorn_access_logger = logging.getLogger("uvicorn.access")
        uvicorn_access_logger.handlers = []
        uvicorn_access_logger.propagate = False
    
    # Configure specific loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    
    # Log startup
    logger = logging.getLogger(__name__)
    logger.info(f"Secure logging initialized - Level: {settings.LOG_LEVEL}")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Access logs disabled: {settings.DISABLE_ACCESS_LOGS}")


class RequestLoggingFilter(logging.Filter):
    """
    Filter that prevents logging of request/response bodies.
    """
    
    def __init__(self, settings):
        super().__init__()
        self.settings = settings
    
    def filter(self, record: logging.LogRecord) -> bool:
        # Skip request body logging if disabled
        if (self.settings.DISABLE_REQUEST_BODY_LOGGING and 
            hasattr(record, 'pathname') and 'request' in record.getMessage().lower()):
            return False
        
        # Skip response body logging if disabled
        if (self.settings.DISABLE_RESPONSE_BODY_LOGGING and 
            hasattr(record, 'pathname') and 'response' in record.getMessage().lower()):
            return False
        
        return True


def get_security_logger(name: str) -> logging.Logger:
    """
    Get a logger configured for security-sensitive components.
    """
    logger = logging.getLogger(name)
    
    # Add request logging filter
    settings = get_settings()
    if settings.DISABLE_REQUEST_BODY_LOGGING or settings.DISABLE_RESPONSE_BODY_LOGGING:
        logger.addFilter(RequestLoggingFilter(settings))
    
    return logger


def log_security_event(event_type: str, details: Dict[str, Any], level: int = logging.WARNING):
    """
    Log security-related events with proper sanitization.
    """
    logger = get_security_logger("security")
    
    # Sanitize details
    sanitized_details = SanitizedFormatter()._sanitize_dict(details)
    
    # Add timestamp
    sanitized_details['timestamp'] = datetime.utcnow().isoformat()
    sanitized_details['event_type'] = event_type
    
    logger.log(level, f"Security event: {event_type}", extra=sanitized_details)