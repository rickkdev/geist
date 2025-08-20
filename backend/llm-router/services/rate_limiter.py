import time
from typing import Dict
from collections import defaultdict, deque

from config import Settings


class RateLimiter:
    """
    Rate limiter with sliding window algorithm.
    Tracks both per-IP and per-device-pubkey limits.
    """
    
    def __init__(self, settings: Settings):
        self.settings = settings
        self.enabled = settings.RATE_LIMIT_ENABLED
        
        # Sliding window storage: {identifier: deque of timestamps}
        self.ip_windows: Dict[str, deque] = defaultdict(deque)
        self.device_windows: Dict[str, deque] = defaultdict(deque)
        
        # Request counters for metrics
        self.total_requests = 0
        self.blocked_requests = 0
        
        # Window duration in seconds
        self.window_seconds = 60  # 1 minute window
        
    def allow_request(self, client_ip: str, device_pubkey: str) -> bool:
        """
        Check if request should be allowed based on rate limits.
        Returns True if allowed, False if rate limited.
        """
        if not self.enabled:
            return True
        
        self.total_requests += 1
        current_time = time.time()
        
        # Check IP-based rate limit
        if not self._check_window(self.ip_windows[client_ip], current_time):
            self.blocked_requests += 1
            return False
        
        # Check device-based rate limit
        if not self._check_window(self.device_windows[device_pubkey], current_time):
            self.blocked_requests += 1
            return False
        
        # Add timestamps to windows
        self.ip_windows[client_ip].append(current_time)
        self.device_windows[device_pubkey].append(current_time)
        
        # Cleanup old entries to prevent memory leaks
        self._cleanup_old_entries()
        
        return True
    
    def _check_window(self, window: deque, current_time: float) -> bool:
        """
        Check if request is within rate limit for given window.
        Uses sliding window with burst allowance.
        """
        # Remove expired entries
        window_start = current_time - self.window_seconds
        while window and window[0] < window_start:
            window.popleft()
        
        # Check against per-minute limit
        if len(window) >= self.settings.RATE_LIMIT_PER_MINUTE:
            return False
        
        # Check burst limit (requests in last 10 seconds)
        burst_start = current_time - 10  # 10 second burst window
        recent_requests = sum(1 for timestamp in window if timestamp >= burst_start)
        
        if recent_requests >= self.settings.RATE_LIMIT_BURST:
            return False
        
        return True
    
    def _cleanup_old_entries(self):
        """
        Periodically clean up old entries to prevent memory leaks.
        """
        # Only cleanup every 100 requests to avoid performance impact
        if self.total_requests % 100 != 0:
            return
        
        current_time = time.time()
        cutoff_time = current_time - (self.window_seconds * 2)  # Keep extra history for safety
        
        # Cleanup IP windows
        for ip, window in list(self.ip_windows.items()):
            while window and window[0] < cutoff_time:
                window.popleft()
            # Remove empty windows
            if not window:
                del self.ip_windows[ip]
        
        # Cleanup device windows
        for device, window in list(self.device_windows.items()):
            while window and window[0] < cutoff_time:
                window.popleft()
            # Remove empty windows
            if not window:
                del self.device_windows[device]
    
    def get_total_requests(self) -> int:
        """Get total number of requests processed."""
        return self.total_requests
    
    def get_blocked_requests(self) -> int:
        """Get number of blocked requests."""
        return self.blocked_requests
    
    def get_block_rate(self) -> float:
        """Get rate limit block rate as percentage."""
        if self.total_requests == 0:
            return 0.0
        return (self.blocked_requests / self.total_requests) * 100
    
    def get_current_limits(self, client_ip: str, device_pubkey: str) -> Dict[str, int]:
        """
        Get current usage for IP and device (for monitoring).
        """
        current_time = time.time()
        window_start = current_time - self.window_seconds
        
        # Count current requests in window
        ip_window = self.ip_windows.get(client_ip, deque())
        device_window = self.device_windows.get(device_pubkey, deque())
        
        ip_requests = sum(1 for timestamp in ip_window if timestamp >= window_start)
        device_requests = sum(1 for timestamp in device_window if timestamp >= window_start)
        
        return {
            "ip_requests_in_window": ip_requests,
            "device_requests_in_window": device_requests,
            "ip_limit": self.settings.RATE_LIMIT_PER_MINUTE,
            "device_limit": self.settings.RATE_LIMIT_PER_MINUTE,
            "burst_limit": self.settings.RATE_LIMIT_BURST
        }