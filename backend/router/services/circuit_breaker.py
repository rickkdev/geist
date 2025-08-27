import time
import logging
from enum import Enum
from typing import Optional

from config import Settings


class CircuitBreakerState(Enum):
    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failures detected, blocking requests
    HALF_OPEN = "half_open"  # Testing if service recovered


class CircuitBreaker:
    """
    Circuit breaker for inference service protection.
    Prevents cascading failures when inference server is down.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.enabled = settings.CIRCUIT_BREAKER_ENABLED

        # Circuit breaker state
        self.state = CircuitBreakerState.CLOSED
        self.failure_count = 0
        self.last_failure_time: Optional[float] = None
        self.success_count = 0

        # Statistics
        self.total_requests = 0
        self.total_failures = 0
        self.state_transitions = 0

    def can_make_request(self) -> bool:
        """
        Check if request should be allowed through the circuit breaker.
        """
        if not self.enabled:
            return True

        self.total_requests += 1
        current_time = time.time()

        if self.state == CircuitBreakerState.CLOSED:
            return True

        elif self.state == CircuitBreakerState.OPEN:
            # Check if enough time has passed to try half-open
            if (
                self.last_failure_time
                and current_time - self.last_failure_time
                >= self.settings.CIRCUIT_RESET_SECONDS
            ):
                self._transition_to_half_open()
                return True
            return False

        elif self.state == CircuitBreakerState.HALF_OPEN:
            # Allow limited requests to test service recovery
            return True

        return False

    def record_success(self):
        """Record a successful request."""
        if not self.enabled:
            return

        if self.state == CircuitBreakerState.HALF_OPEN:
            self.success_count += 1
            # If enough successes, transition back to closed
            if self.success_count >= 3:  # Require 3 successes
                self._transition_to_closed()
        elif self.state == CircuitBreakerState.CLOSED:
            # Reset failure count on success
            self.failure_count = 0

    def record_failure(self):
        """Record a failed request."""
        if not self.enabled:
            return

        self.total_failures += 1
        self.failure_count += 1
        self.last_failure_time = time.time()

        if self.state == CircuitBreakerState.CLOSED:
            if self.failure_count >= self.settings.CIRCUIT_BREAKER_THRESHOLD:
                self._transition_to_open()
        elif self.state == CircuitBreakerState.HALF_OPEN:
            # Failure during half-open means service still not recovered
            self._transition_to_open()

    def _transition_to_open(self):
        """Transition to OPEN state."""
        if self.state != CircuitBreakerState.OPEN:
            self.state = CircuitBreakerState.OPEN
            self.state_transitions += 1

    def _transition_to_half_open(self):
        """Transition to HALF_OPEN state."""
        if self.state != CircuitBreakerState.HALF_OPEN:
            self.state = CircuitBreakerState.HALF_OPEN
            self.success_count = 0
            self.state_transitions += 1

    def _transition_to_closed(self):
        """Transition to CLOSED state."""
        if self.state != CircuitBreakerState.CLOSED:
            self.state = CircuitBreakerState.CLOSED
            self.failure_count = 0
            self.success_count = 0
            self.state_transitions += 1

    def get_state(self) -> str:
        """Get current circuit breaker state."""
        return self.state.value

    def get_failure_count(self) -> int:
        """Get current failure count."""
        return self.failure_count

    def get_statistics(self) -> dict:
        """Get circuit breaker statistics."""
        return {
            "state": self.get_state(),
            "failure_count": self.failure_count,
            "total_requests": self.total_requests,
            "total_failures": self.total_failures,
            "state_transitions": self.state_transitions,
            "failure_rate": (self.total_failures / max(1, self.total_requests)) * 100,
            "last_failure_time": self.last_failure_time,
            "enabled": self.enabled,
        }

    def reset(self):
        """Reset circuit breaker to initial state (for testing/manual recovery)."""
        self.state = CircuitBreakerState.CLOSED
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = None
