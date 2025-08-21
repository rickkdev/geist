"""
Locust Load Testing Script for LLM Router

Alternative to k6 for load testing with Python-based scenarios.
Provides more advanced user behavior simulation and custom logic.

Features:
- Realistic user behavior patterns
- Dynamic payload generation
- Custom metrics collection
- Error analysis and reporting
- Gradual load ramping
"""

import base64
import json
import random
import time
from datetime import datetime, timezone

from locust import HttpUser, task, between, events


class LLMRouterUser(HttpUser):
    """
    Simulates a mobile app user interacting with the LLM Router.
    """

    # Wait time between tasks (simulating user thinking/reading time)
    wait_time = between(1, 10)

    # User session state
    device_pubkey = None
    session_id = None

    def on_start(self):
        """Initialize user session."""
        self.device_pubkey = base64.b64encode(
            f"device_key_{self.user_id}_{random.randint(1000, 9999)}".encode()[
                :32
            ].ljust(32, b"_")
        ).decode("ascii")

        self.session_id = f"session_{self.user_id}_{int(time.time())}"

        # Test initial connectivity
        self.test_health_check()
        self.get_public_keys()

    def test_health_check(self):
        """Test health endpoint."""
        with self.client.get("/health", catch_response=True) as response:
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "healthy":
                    response.success()
                else:
                    response.failure(f"Health check failed: {data}")
            else:
                response.failure(f"Health check returned {response.status_code}")

    def get_public_keys(self):
        """Get router public keys for HPKE."""
        with self.client.get("/api/pubkey", catch_response=True) as response:
            if response.status_code == 200:
                data = response.json()
                if "current_pubkey" in data and len(data["current_pubkey"]) > 0:
                    response.success()
                    self.router_pubkey = data["current_pubkey"]
                else:
                    response.failure("Invalid pubkey response")
            else:
                response.failure(f"Pubkey endpoint returned {response.status_code}")

    def create_hpke_request(self, payload):
        """Create HPKE-encrypted request (simplified for testing)."""
        payload_json = json.dumps(payload)
        ciphertext = base64.b64encode(payload_json.encode("utf-8")).decode("ascii")

        return {
            "encapsulated_key": base64.b64encode(
                b"mock_encapsulated_key_32bytes__"
            ).decode("ascii"),
            "ciphertext": ciphertext,
            "aad": base64.b64encode(b"locust_test_aad").decode("ascii"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request_id": f"locust-{self.session_id}-{int(time.time() * 1000)}-{random.randint(1000, 9999)}",
            "device_pubkey": self.device_pubkey,
        }

    @task(60)
    def short_chat_query(self):
        """Send a short chat query (most common scenario)."""
        queries = [
            "What is the weather like today?",
            "How do I cook pasta?",
            "What's the capital of Japan?",
            "Tell me a joke",
            "What time is it?",
            "How are you doing?",
            "What's 2+2?",
            "Hello there!",
            "Good morning",
            "Help me with math",
        ]

        payload = {
            "messages": [{"role": "user", "content": random.choice(queries)}],
            "temperature": round(random.uniform(0.5, 1.0), 2),
            "max_tokens": random.randint(20, 100),
        }

        self.send_chat_request(payload, "short_query")

    @task(30)
    def medium_chat_query(self):
        """Send a medium-length chat query."""
        queries = [
            "Explain the concept of artificial intelligence and its applications in modern technology",
            "What are the main differences between renewable and non-renewable energy sources?",
            "Can you help me understand the basics of investing in the stock market?",
            "Write a short story about a robot learning to feel emotions",
            "Explain the process of photosynthesis in plants",
            "What are some effective study techniques for college students?",
            "Describe the history and cultural significance of the Great Wall of China",
            "How does the human immune system work to protect against diseases?",
        ]

        payload = {
            "messages": [{"role": "user", "content": random.choice(queries)}],
            "temperature": round(random.uniform(0.6, 0.9), 2),
            "max_tokens": random.randint(150, 300),
        }

        self.send_chat_request(payload, "medium_query")

    @task(10)
    def long_chat_query(self):
        """Send a long, complex chat query."""
        queries = [
            "Provide a comprehensive analysis of the economic impact of climate change, including short-term and long-term effects on global markets, agriculture, and human migration patterns. Please include specific examples and potential mitigation strategies.",
            "Write a detailed technical explanation of how machine learning algorithms work, including the differences between supervised, unsupervised, and reinforcement learning, with practical examples of each approach.",
            "Create a complete business plan for a sustainable technology startup, including market analysis, competitive landscape, financial projections, and implementation timeline.",
            "Explain the complete process of software development from initial concept to deployment, including project management methodologies, testing strategies, and maintenance considerations.",
        ]

        payload = {
            "messages": [{"role": "user", "content": random.choice(queries)}],
            "temperature": round(random.uniform(0.7, 1.0), 2),
            "max_tokens": random.randint(400, 800),
        }

        self.send_chat_request(payload, "long_query")

    @task(15)
    def streaming_chat_query(self):
        """Test streaming chat responses."""
        queries = [
            "Write a short poem about technology",
            "Explain quantum computing step by step",
            "Tell me about the solar system",
            "What are the benefits of exercise?",
            "Describe the process of making bread",
        ]

        payload = {
            "messages": [{"role": "user", "content": random.choice(queries)}],
            "temperature": round(random.uniform(0.6, 0.9), 2),
            "max_tokens": random.randint(100, 300),
        }

        hpke_request = self.create_hpke_request(payload)

        with self.client.post(
            "/api/chat",
            json=hpke_request,
            headers={"Accept": "text/event-stream"},
            name="streaming_chat",
            catch_response=True,
        ) as response:
            if response.status_code == 200:
                if "text/event-stream" in response.headers.get("content-type", ""):
                    response.success()
                else:
                    response.failure("Expected streaming response")
            else:
                response.failure(f"Streaming request failed: {response.status_code}")

    @task(5)
    def multi_turn_conversation(self):
        """Simulate a multi-turn conversation."""
        conversation = [
            {
                "role": "user",
                "content": "Hello, can you help me with a programming question?",
            },
            {
                "role": "assistant",
                "content": "Of course! I'd be happy to help you with programming. What specific question do you have?",
            },
            {"role": "user", "content": "How do I sort a list in Python?"},
            {
                "role": "assistant",
                "content": "You can sort a list in Python using the sort() method or the sorted() function. Would you like me to show you examples?",
            },
            {"role": "user", "content": "Yes, please show me both methods"},
        ]

        # Send the full conversation context
        payload = {"messages": conversation, "temperature": 0.7, "max_tokens": 200}

        self.send_chat_request(payload, "multi_turn")

    def send_chat_request(self, payload, request_type):
        """Send a chat request with error handling and metrics."""
        hpke_request = self.create_hpke_request(payload)

        start_time = time.time()

        with self.client.post(
            "/api/chat",
            json=hpke_request,
            name=f"chat_{request_type}",
            catch_response=True,
        ) as response:
            end_time = time.time()
            duration = (end_time - start_time) * 1000  # Convert to milliseconds

            # Record custom metrics
            events.request.fire(
                request_type="HPKE_DECRYPTION",
                name=f"decrypt_{request_type}",
                response_time=duration,
                response_length=len(response.content),
                exception=None,
            )

            if response.status_code == 200:
                try:
                    # Try to parse response
                    if response.headers.get("content-type", "").startswith(
                        "application/json"
                    ):
                        data = response.json()
                        if "choices" in data or "error" not in data:
                            response.success()
                        else:
                            response.failure(
                                f"API error: {data.get('error', 'Unknown error')}"
                            )
                    elif "text/event-stream" in response.headers.get(
                        "content-type", ""
                    ):
                        if "data:" in response.text:
                            response.success()
                        else:
                            response.failure("Invalid streaming response")
                    else:
                        response.failure(
                            f"Unexpected content type: {response.headers.get('content-type')}"
                        )
                except Exception as e:
                    response.failure(f"Response parsing error: {str(e)}")
            elif response.status_code == 429:
                response.failure("Rate limited")
                # Implement backoff strategy
                time.sleep(random.uniform(1, 3))
            elif response.status_code == 400:
                response.failure("Bad request - HPKE validation failed")
            else:
                response.failure(f"HTTP {response.status_code}")

    @task(2)
    def test_rate_limiting(self):
        """Test rate limiting by sending rapid requests."""
        # Send multiple requests quickly
        for i in range(5):
            payload = {
                "messages": [{"role": "user", "content": f"Rate limit test {i}"}],
                "temperature": 0.7,
                "max_tokens": 50,
            }

            hpke_request = self.create_hpke_request(payload)

            with self.client.post(
                "/api/chat",
                json=hpke_request,
                name="rate_limit_test",
                catch_response=True,
            ) as response:
                if response.status_code == 429:
                    response.success()  # Rate limiting is working correctly
                    break
                elif response.status_code == 200:
                    continue  # Request succeeded, try next
                else:
                    response.failure(f"Unexpected status: {response.status_code}")

            time.sleep(0.1)  # Small delay between rapid requests

    @task(1)
    def test_invalid_requests(self):
        """Test system behavior with invalid requests."""
        invalid_scenarios = [
            # Invalid base64
            {
                "encapsulated_key": "invalid-base64!@#",
                "ciphertext": "also-invalid!@#",
                "aad": base64.b64encode(b"test_aad").decode("ascii"),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "request_id": f"invalid-{int(time.time())}",
                "device_pubkey": self.device_pubkey,
            },
            # Missing fields
            {
                "encapsulated_key": base64.b64encode(b"test").decode("ascii"),
                # Missing other required fields
            },
            # Expired timestamp
            {
                "encapsulated_key": base64.b64encode(b"test_key").decode("ascii"),
                "ciphertext": base64.b64encode(b"test_data").decode("ascii"),
                "aad": base64.b64encode(b"test_aad").decode("ascii"),
                "timestamp": "2020-01-01T00:00:00Z",  # Very old timestamp
                "request_id": f"expired-{int(time.time())}",
                "device_pubkey": self.device_pubkey,
            },
        ]

        scenario = random.choice(invalid_scenarios)

        with self.client.post(
            "/api/chat", json=scenario, name="invalid_request", catch_response=True
        ) as response:
            if response.status_code in [400, 422]:
                response.success()  # Expected error response
            else:
                response.failure(f"Expected 4xx error, got {response.status_code}")


class StressTestUser(LLMRouterUser):
    """
    High-intensity user for stress testing.
    Sends requests more frequently with less wait time.
    """

    wait_time = between(0.5, 2.0)  # Much shorter wait times

    @task(80)
    def rapid_short_queries(self):
        """Send short queries rapidly."""
        payload = {
            "messages": [{"role": "user", "content": "Quick test"}],
            "temperature": 0.7,
            "max_tokens": 20,
        }
        self.send_chat_request(payload, "stress_short")

    @task(20)
    def rapid_medium_queries(self):
        """Send medium queries rapidly."""
        payload = {
            "messages": [
                {"role": "user", "content": "Explain machine learning briefly"}
            ],
            "temperature": 0.8,
            "max_tokens": 100,
        }
        self.send_chat_request(payload, "stress_medium")


# Custom event handlers for detailed metrics
@events.init.add_listener
def on_locust_init(environment, **kwargs):
    """Initialize custom metrics tracking."""
    print("Initializing LLM Router load test...")


@events.request.add_listener
def on_request(request_type, name, response_time, response_length, exception, **kwargs):
    """Log custom request metrics."""
    if request_type == "HPKE_DECRYPTION":
        # Track HPKE-specific metrics
        print(f"HPKE {name}: {response_time:.2f}ms, {response_length} bytes")


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Log test start."""
    print(f"Load test starting with {environment.runner.user_count} users...")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Log test completion and summary."""
    print("Load test completed!")

    # Print summary statistics
    stats = environment.runner.stats
    print(f"Total requests: {stats.total.num_requests}")
    print(f"Failed requests: {stats.total.num_failures}")
    print(f"Average response time: {stats.total.avg_response_time:.2f}ms")
    print(f"95th percentile: {stats.total.get_response_time_percentile(0.95):.2f}ms")
    print(f"Requests per second: {stats.total.total_rps:.2f}")


# Example usage:
# locust -f locust-load-test.py --host=http://localhost:8000 -u 50 -r 5 -t 10m
# locust -f locust-load-test.py --host=http://localhost:8000 --headless -u 100 -r 10 -t 5m --html=report.html
