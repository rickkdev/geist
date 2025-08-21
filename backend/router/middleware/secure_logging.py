"""
Secure Logging Middleware

Implements comprehensive logging security to prevent sensitive data leakage:
- Scrubs request/response bodies containing prompts and completions
- Removes sensitive headers and authentication data
- Implements secure error handling without data exposure
- Configures log retention and rotation policies
"""

import re
import logging
import hashlib
from typing import Any, Optional, Set
from datetime import datetime
from contextlib import contextmanager

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from config import get_settings

settings = get_settings()


class SecureLoggingFilter(logging.Filter):
    """
    Logging filter that scrubs sensitive data from log records.
    """

    # Patterns for sensitive data that should be scrubbed
    SENSITIVE_PATTERNS = [
        # HPKE encrypted data
        (r'"encapsulated_key":\s*"[^"]*"', '"encapsulated_key": "[SCRUBBED]"'),
        (r'"ciphertext":\s*"[^"]*"', '"ciphertext": "[SCRUBBED]"'),
        (r'"device_pubkey":\s*"[^"]*"', '"device_pubkey": "[SCRUBBED]"'),
        # Authentication and API keys
        (r"Authorization:\s*Bearer\s+[^\s]+", "Authorization: Bearer [SCRUBBED]"),
        (r"X-API-Key:\s*[^\s]+", "X-API-Key: [SCRUBBED]"),
        (r'"api_key":\s*"[^"]*"', '"api_key": "[SCRUBBED]"'),
        # Message content (prompts and completions)
        (r'"content":\s*"[^"]*"', '"content": "[CONTENT_SCRUBBED]"'),
        (r'"messages":\s*\[[^\]]*\]', '"messages": ["[MESSAGES_SCRUBBED]"]'),
        # Base64 encoded data (likely sensitive)
        (r'"[^"]*":\s*"[A-Za-z0-9+/]{20,}={0,2}"', '"[KEY]": "[B64_SCRUBBED]"'),
        # IP addresses (for privacy)
        (r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "[IP_SCRUBBED]"),
        # UUIDs and request IDs (can be correlation risks)
        (r'"request_id":\s*"[^"]*"', '"request_id": "[ID_SCRUBBED]"'),
        (
            r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
            "[UUID_SCRUBBED]",
        ),
        # File paths that might contain sensitive info
        (
            r"/[a-zA-Z0-9._/-]*(?:key|cert|secret|private)[a-zA-Z0-9._/-]*",
            "[PATH_SCRUBBED]",
        ),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        """
        Filter and scrub sensitive data from log records.
        """
        if hasattr(record, "getMessage"):
            message = record.getMessage()

            # Apply scrubbing patterns
            for pattern, replacement in self.SENSITIVE_PATTERNS:
                message = re.sub(pattern, replacement, message, flags=re.IGNORECASE)

            # Update the record
            record.msg = message
            record.args = ()

        return True


class SecureLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware that implements secure logging policies.
    """

    # Paths that should never log request/response bodies
    NEVER_LOG_PATHS: Set[str] = {"/api/chat", "/inference", "/api/chat/debug"}

    # Headers that should never be logged
    SENSITIVE_HEADERS: Set[str] = {
        "authorization",
        "x-api-key",
        "cookie",
        "x-forwarded-for",
        "x-real-ip",
        "x-client-ip",
    }

    def __init__(self, app: ASGIApp):
        super().__init__(app)
        self.logger = logging.getLogger("llm_router.security")

    async def dispatch(self, request: Request, call_next) -> Response:
        """
        Process request/response with secure logging.
        """
        start_time = datetime.utcnow()
        request_id = self._get_request_id(request)

        # Log request start (minimal info only)
        if not settings.DISABLE_ACCESS_LOGS:
            self._log_request_start(request, request_id)

        try:
            response = await call_next(request)

            # Log successful response
            if not settings.DISABLE_ACCESS_LOGS:
                self._log_response(request, response, start_time, request_id)

            return response

        except Exception as e:
            # Log error without sensitive data
            self._log_error(request, e, start_time, request_id)
            raise

    def _get_request_id(self, request: Request) -> str:
        """
        Generate or extract request ID for correlation.
        """
        # Use hash of timestamp + path for correlation without leaking data
        correlation_data = f"{datetime.utcnow().isoformat()}{request.url.path}"
        return hashlib.sha256(correlation_data.encode()).hexdigest()[:8]

    def _log_request_start(self, request: Request, request_id: str):
        """
        Log request start with minimal information.
        """
        # Only log safe information
        safe_info = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "timestamp": datetime.utcnow().isoformat(),
        }

        # Add safe headers only
        safe_headers = {}
        for header, value in request.headers.items():
            if header.lower() not in self.SENSITIVE_HEADERS:
                # Still truncate long headers
                safe_headers[header] = value[:100] if len(value) > 100 else value

        if safe_headers and settings.LOG_LEVEL == "DEBUG":
            safe_info["headers"] = safe_headers

        self.logger.info(f"Request started: {safe_info}")

    def _log_response(
        self,
        request: Request,
        response: Response,
        start_time: datetime,
        request_id: str,
    ):
        """
        Log response with minimal information.
        """
        duration = (datetime.utcnow() - start_time).total_seconds()

        safe_info = {
            "request_id": request_id,
            "status_code": response.status_code,
            "duration_seconds": round(duration, 3),
            "path": request.url.path,
        }

        # Log level based on status code
        if response.status_code >= 500:
            self.logger.error(f"Request failed: {safe_info}")
        elif response.status_code >= 400:
            self.logger.warning(f"Request client error: {safe_info}")
        else:
            self.logger.info(f"Request completed: {safe_info}")

    def _log_error(
        self, request: Request, error: Exception, start_time: datetime, request_id: str
    ):
        """
        Log errors without exposing sensitive data.
        """
        duration = (datetime.utcnow() - start_time).total_seconds()

        # Only log error type and general info, not details
        safe_error_info = {
            "request_id": request_id,
            "error_type": type(error).__name__,
            "path": request.url.path,
            "duration_seconds": round(duration, 3),
        }

        # In development, we can log more details
        if settings.is_development():
            safe_error_info["error_message"] = str(error)[:200]  # Truncated

        self.logger.error(f"Request error: {safe_error_info}")


def setup_secure_logging():
    """
    Configure secure logging system-wide.
    """
    # Create custom logger for LLM Router
    logger = logging.getLogger("llm_router")
    logger.setLevel(getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO))

    # Remove default handlers to prevent double logging
    logger.handlers.clear()

    # Create secure handler with scrubbing filter
    handler = logging.StreamHandler()
    handler.addFilter(SecureLoggingFilter())

    # Minimal formatter (no sensitive data)
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)

    logger.addHandler(handler)

    # Configure uvicorn logger to use same security
    uvicorn_logger = logging.getLogger("uvicorn")
    uvicorn_logger.addFilter(SecureLoggingFilter())

    uvicorn_access = logging.getLogger("uvicorn.access")
    if settings.DISABLE_ACCESS_LOGS:
        uvicorn_access.setLevel(logging.WARNING)
    else:
        uvicorn_access.addFilter(SecureLoggingFilter())

    # Disable other verbose loggers in production
    if settings.is_production():
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("asyncio").setLevel(logging.WARNING)

    logger.info(f"Secure logging configured - Level: {settings.LOG_LEVEL}")


@contextmanager
def secure_operation_context(operation_name: str, request_id: Optional[str] = None):
    """
    Context manager for secure operations that handles logging and cleanup.
    """
    logger = logging.getLogger("llm_router.security")
    start_time = datetime.utcnow()

    # Generate correlation ID if not provided
    if not request_id:
        request_id = hashlib.sha256(
            f"{operation_name}{start_time.isoformat()}".encode()
        ).hexdigest()[:8]

    try:
        logger.debug(f"Starting secure operation: {operation_name} [{request_id}]")
        yield request_id

        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.debug(
            f"Completed secure operation: {operation_name} [{request_id}] in {duration:.3f}s"
        )

    except Exception as e:
        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.error(
            f"Failed secure operation: {operation_name} [{request_id}] - {type(e).__name__} after {duration:.3f}s"
        )
        raise


def scrub_sensitive_data(data: Any) -> Any:
    """
    Utility function to scrub sensitive data from any object.
    Used for safe debugging and logging.
    """
    if isinstance(data, dict):
        scrubbed = {}
        for key, value in data.items():
            # Scrub keys that are likely sensitive
            if any(
                sensitive in key.lower()
                for sensitive in [
                    "password",
                    "key",
                    "secret",
                    "token",
                    "auth",
                    "cipher",
                    "content",
                    "message",
                ]
            ):
                scrubbed[key] = "[SCRUBBED]"
            else:
                scrubbed[key] = scrub_sensitive_data(value)
        return scrubbed

    elif isinstance(data, list):
        return [scrub_sensitive_data(item) for item in data]

    elif isinstance(data, str):
        # Scrub long strings that might be encoded data
        if len(data) > 50 and all(
            c in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
            for c in data
        ):
            return "[BASE64_SCRUBBED]"
        return data

    else:
        return data
