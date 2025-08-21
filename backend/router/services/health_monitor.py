import asyncio
import logging
import time
from typing import Dict, List, Set
from dataclasses import dataclass, field
from enum import Enum

import httpx
from config import Settings


class NodeStatus(Enum):
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


@dataclass
class NodeHealth:
    endpoint: str
    status: NodeStatus = NodeStatus.UNKNOWN
    consecutive_failures: int = 0
    consecutive_successes: int = 0
    last_check: float = field(default_factory=time.time)
    last_error: str = ""


class HealthMonitor:
    """
    Monitors the health of inference endpoints and manages node rotation.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.nodes: Dict[str, NodeHealth] = {}
        self.healthy_nodes: Set[str] = set()
        self.current_node_index = 0
        self.lock = asyncio.Lock()
        self.health_check_task: asyncio.Task = None
        self.client: httpx.AsyncClient = None

    async def startup(self):
        """Initialize health monitor and start periodic checks."""
        # Initialize health tracking for all endpoints
        endpoints = self._get_all_endpoints()
        for endpoint in endpoints:
            self.nodes[endpoint] = NodeHealth(endpoint=endpoint)

        # Create HTTP client for health checks
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.settings.HEALTH_CHECK_TIMEOUT_SECONDS)
        )

        # Start periodic health checks
        if endpoints:
            self.health_check_task = asyncio.create_task(self._periodic_health_check())
            logging.info(f"Started health monitoring for {len(endpoints)} endpoints")

    async def shutdown(self):
        """Stop health monitoring and cleanup."""
        if self.health_check_task:
            self.health_check_task.cancel()
            try:
                await self.health_check_task
            except asyncio.CancelledError:
                pass

        if self.client:
            await self.client.aclose()

    def _get_all_endpoints(self) -> List[str]:
        """Get all configured inference endpoints."""
        if self.settings.INFERENCE_TRANSPORT == "unix":
            # For UNIX sockets, we monitor the local endpoint
            socket_path = self.settings.get_inference_socket_path()
            return ["unix_socket"] if socket_path else []
        else:
            # For HTTP/HTTPS endpoints
            return self.settings.get_inference_https_urls()

    async def _periodic_health_check(self):
        """Periodically check the health of all nodes."""
        while True:
            try:
                await self._check_all_nodes()
                await asyncio.sleep(self.settings.HEALTH_CHECK_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logging.error(f"Health check error: {e}")
                await asyncio.sleep(self.settings.HEALTH_CHECK_INTERVAL_SECONDS)

    async def _check_all_nodes(self):
        """Check health of all configured nodes."""
        async with self.lock:
            for endpoint in self.nodes:
                await self._check_node_health(endpoint)

    async def _check_node_health(self, endpoint: str):
        """Check health of a specific node."""
        node = self.nodes[endpoint]

        try:
            is_healthy = await self._perform_health_check(endpoint)

            if is_healthy:
                node.consecutive_failures = 0
                node.consecutive_successes += 1
                node.last_error = ""

                # Mark as healthy if it meets the threshold
                if (
                    node.status != NodeStatus.HEALTHY
                    and node.consecutive_successes >= self.settings.HEALTHY_THRESHOLD
                ):
                    node.status = NodeStatus.HEALTHY
                    self.healthy_nodes.add(endpoint)
                    logging.info(f"Node {endpoint} marked as healthy")

            else:
                node.consecutive_successes = 0
                node.consecutive_failures += 1

                # Mark as unhealthy if it meets the threshold
                if (
                    node.status != NodeStatus.UNHEALTHY
                    and node.consecutive_failures >= self.settings.UNHEALTHY_THRESHOLD
                ):
                    node.status = NodeStatus.UNHEALTHY
                    self.healthy_nodes.discard(endpoint)
                    logging.warning(f"Node {endpoint} marked as unhealthy")

        except Exception as e:
            node.consecutive_successes = 0
            node.consecutive_failures += 1
            node.last_error = str(e)
            logging.error(f"Health check failed for {endpoint}: {e}")

        node.last_check = time.time()

    async def _perform_health_check(self, endpoint: str) -> bool:
        """Perform actual health check for an endpoint."""
        try:
            if endpoint == "unix_socket":
                # For UNIX socket, check if socket exists and is accessible
                socket_path = self.settings.get_inference_socket_path()
                if not socket_path:
                    return False

                import os

                if not os.path.exists(socket_path):
                    return False

                # Try a simple request to the socket
                unix_client = httpx.AsyncClient(
                    transport=httpx.AsyncHTTPTransport(uds=socket_path),
                    timeout=httpx.Timeout(self.settings.HEALTH_CHECK_TIMEOUT_SECONDS),
                )

                try:
                    response = await unix_client.get("http://localhost/v1/models")
                    return response.status_code == 200
                finally:
                    await unix_client.aclose()

            else:
                # For HTTP/HTTPS endpoints
                response = await self.client.get(f"{endpoint}/v1/models")
                return response.status_code == 200

        except Exception as e:
            logging.debug(f"Health check failed for {endpoint}: {e}")
            return False

    async def get_healthy_endpoint(self) -> str:
        """Get a healthy endpoint using round-robin selection."""
        async with self.lock:
            if not self.healthy_nodes:
                # No healthy nodes, return the first configured endpoint as fallback
                endpoints = self._get_all_endpoints()
                if endpoints:
                    return endpoints[0]
                raise RuntimeError("No inference endpoints available")

            # Convert to list for round-robin
            healthy_list = list(self.healthy_nodes)
            endpoint = healthy_list[self.current_node_index % len(healthy_list)]
            self.current_node_index += 1

            return endpoint

    def get_health_status(self) -> Dict:
        """Get current health status of all nodes."""
        status = {}
        for endpoint, node in self.nodes.items():
            status[endpoint] = {
                "status": node.status.value,
                "consecutive_failures": node.consecutive_failures,
                "consecutive_successes": node.consecutive_successes,
                "last_check": node.last_check,
                "last_error": node.last_error,
            }
        return status

    def get_healthy_node_count(self) -> int:
        """Get the number of currently healthy nodes."""
        return len(self.healthy_nodes)
