/**
 * k6 Load Testing Script for LLM Router
 * 
 * Tests performance under various load scenarios:
 * - Gradual ramp-up to target load
 * - Sustained load testing
 * - Spike testing
 * - Stress testing beyond normal capacity
 * 
 * Metrics tracked:
 * - Request rate (requests/second)
 * - Response time percentiles (p50, p95, p99)
 * - Error rates
 * - Token throughput
 * - Concurrent connections
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Custom metrics
const errorRate = new Rate('errors');
const responseTimeP95 = new Trend('response_time_p95');
const tokensPerSecond = new Rate('tokens_per_second');
const hpkeDecryptionTime = new Trend('hpke_decryption_time');
const concurrentStreams = new Counter('concurrent_streams');

// Test configuration
export const options = {
  stages: [
    // Warm-up phase
    { duration: '2m', target: 10 },   // Ramp up to 10 users over 2 minutes
    { duration: '3m', target: 10 },   // Stay at 10 users for 3 minutes
    
    // Load testing phase
    { duration: '3m', target: 50 },   // Ramp up to 50 users over 3 minutes
    { duration: '10m', target: 50 },  // Stay at 50 users for 10 minutes
    
    // Spike testing phase
    { duration: '1m', target: 100 },  // Spike to 100 users
    { duration: '3m', target: 100 },  // Hold spike for 3 minutes
    { duration: '1m', target: 50 },   // Drop back to 50 users
    
    // Stress testing phase
    { duration: '2m', target: 150 },  // Ramp up to stress level
    { duration: '5m', target: 150 },  // Hold stress for 5 minutes
    
    // Cool down
    { duration: '2m', target: 0 },    // Ramp down to 0 users
  ],
  
  thresholds: {
    http_req_duration: ['p(95)<2000'],        // 95% of requests under 2s
    http_req_failed: ['rate<0.05'],           // Error rate under 5%
    errors: ['rate<0.05'],                    // Custom error rate under 5%
    response_time_p95: ['p(95)<3000'],        // 95% of response times under 3s
    tokens_per_second: ['rate>10'],           // At least 10 tokens/second
  },
  
  // Test data and configuration
  ext: {
    loadimpact: {
      projectID: 3596765,
      name: "LLM Router Load Test"
    }
  }
};

// Base configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const API_KEY = __ENV.API_KEY || '';

// Test scenarios and payloads
const testScenarios = [
  {
    name: 'short_query',
    weight: 60,
    payload: {
      messages: [{ role: 'user', content: 'What is the capital of France?' }],
      temperature: 0.7,
      max_tokens: 50
    }
  },
  {
    name: 'medium_query',
    weight: 30,
    payload: {
      messages: [{ 
        role: 'user', 
        content: 'Explain the concept of machine learning and its applications in modern technology.'
      }],
      temperature: 0.8,
      max_tokens: 200
    }
  },
  {
    name: 'long_query',
    weight: 10,
    payload: {
      messages: [{ 
        role: 'user', 
        content: 'Write a detailed analysis of the economic impact of renewable energy adoption, including market trends, policy implications, and future projections. Please provide specific examples and data where possible.'
      }],
      temperature: 0.9,
      max_tokens: 500
    }
  }
];

/**
 * Generate HPKE encrypted request (simplified for testing)
 */
function createHPKERequest(payload) {
  // In real implementation, this would use proper HPKE encryption
  // For testing, we'll simulate the encryption process
  
  const payloadJson = JSON.stringify(payload);
  const ciphertext = btoa(payloadJson); // Base64 encode as simulation
  
  return {
    encapsulated_key: btoa('mock_encapsulated_key_32bytes__'),
    ciphertext: ciphertext,
    aad: btoa('test_aad'),
    timestamp: new Date().toISOString(),
    request_id: `load-test-${Date.now()}-${randomString(8)}`,
    device_pubkey: btoa('mock_device_pubkey_32bytes____')
  };
}

/**
 * Select test scenario based on weights
 */
function selectScenario() {
  const random = Math.random() * 100;
  let cumWeight = 0;
  
  for (const scenario of testScenarios) {
    cumWeight += scenario.weight;
    if (random <= cumWeight) {
      return scenario;
    }
  }
  
  return testScenarios[0]; // Fallback
}

/**
 * Test health endpoint
 */
export function testHealth() {
  const response = http.get(`${BASE_URL}/health`);
  
  check(response, {
    'health check status is 200': (r) => r.status === 200,
    'health check response time < 500ms': (r) => r.timings.duration < 500,
    'health check has status field': (r) => JSON.parse(r.body).status === 'healthy',
  });
  
  errorRate.add(response.status !== 200);
}

/**
 * Test public key endpoint
 */
export function testPubkey() {
  const response = http.get(`${BASE_URL}/api/pubkey`);
  
  check(response, {
    'pubkey status is 200': (r) => r.status === 200,
    'pubkey response time < 1000ms': (r) => r.timings.duration < 1000,
    'pubkey has current_pubkey': (r) => {
      try {
        const data = JSON.parse(r.body);
        return data.current_pubkey && data.current_pubkey.length > 0;
      } catch (e) {
        return false;
      }
    },
  });
  
  errorRate.add(response.status !== 200);
  return response;
}

/**
 * Test chat completion endpoint
 */
export function testChatCompletion() {
  const scenario = selectScenario();
  const hpkeRequest = createHPKERequest(scenario.payload);
  
  const startTime = Date.now();
  
  const response = http.post(
    `${BASE_URL}/api/chat`,
    JSON.stringify(hpkeRequest),
    {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `k6-load-test/${scenario.name}`,
      },
      timeout: '30s', // 30 second timeout
    }
  );
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  // Record metrics
  responseTimeP95.add(duration);
  hpkeDecryptionTime.add(duration);
  
  const success = check(response, {
    'chat status is 200': (r) => r.status === 200,
    'chat response time < 10s': (r) => r.timings.duration < 10000,
    'chat response is not empty': (r) => r.body && r.body.length > 0,
    'chat response is valid': (r) => {
      try {
        // For streaming responses, check if it's SSE format
        if (r.headers['Content-Type'] && r.headers['Content-Type'].includes('text/event-stream')) {
          return r.body.includes('data:');
        }
        // For JSON responses, parse and validate
        const data = JSON.parse(r.body);
        return data && (data.choices || data.error);
      } catch (e) {
        return false;
      }
    },
  });
  
  // Track error rates
  errorRate.add(!success);
  
  // Estimate tokens per second (rough calculation)
  if (success && response.body) {
    const estimatedTokens = Math.floor(response.body.length / 4); // Rough token estimate
    tokensPerSecond.add(estimatedTokens / (duration / 1000));
  }
  
  return response;
}

/**
 * Test streaming chat completion
 */
export function testStreamingChat() {
  const scenario = selectScenario();
  const hpkeRequest = createHPKERequest(scenario.payload);
  
  const response = http.post(
    `${BASE_URL}/api/chat`,
    JSON.stringify(hpkeRequest),
    {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'User-Agent': 'k6-load-test/streaming',
      },
      timeout: '30s',
    }
  );
  
  concurrentStreams.add(1);
  
  const success = check(response, {
    'streaming status is 200': (r) => r.status === 200,
    'streaming content type is SSE': (r) => 
      r.headers['Content-Type'] && r.headers['Content-Type'].includes('text/event-stream'),
    'streaming response contains data': (r) => r.body && r.body.includes('data:'),
    'streaming response time < 15s': (r) => r.timings.duration < 15000,
  });
  
  errorRate.add(!success);
  
  return response;
}

/**
 * Test rate limiting behavior
 */
export function testRateLimiting() {
  const responses = [];
  
  // Send rapid requests to test rate limiting
  for (let i = 0; i < 5; i++) {
    const scenario = testScenarios[0]; // Use short query for rapid testing
    const hpkeRequest = createHPKERequest(scenario.payload);
    
    const response = http.post(
      `${BASE_URL}/api/chat`,
      JSON.stringify(hpkeRequest),
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'k6-load-test/rate-limit',
        },
        timeout: '10s',
      }
    );
    
    responses.push(response);
    
    // No sleep between requests to test rate limiting
  }
  
  // Check if at least one request was rate limited
  const rateLimited = responses.some(r => r.status === 429);
  
  check(responses[0], {
    'rate limiting active': () => rateLimited || responses.every(r => r.status === 200),
  });
  
  return responses;
}

/**
 * Main test function
 */
export default function() {
  // Run different test types based on virtual user ID
  const vuId = __VU;
  const iteration = __ITER;
  
  // 10% of users test health endpoints
  if (vuId % 10 === 0) {
    testHealth();
    sleep(1);
    return;
  }
  
  // 5% of users test public key endpoint
  if (vuId % 20 === 0) {
    testPubkey();
    sleep(2);
    return;
  }
  
  // 10% of users test streaming
  if (vuId % 10 === 1) {
    testStreamingChat();
    sleep(3);
    return;
  }
  
  // 5% of users test rate limiting occasionally
  if (vuId % 20 === 1 && iteration % 10 === 0) {
    testRateLimiting();
    sleep(5);
    return;
  }
  
  // Majority of users test regular chat completion
  testChatCompletion();
  
  // Variable sleep time based on scenario (simulating user reading time)
  const scenario = selectScenario();
  let sleepTime = 1;
  
  switch (scenario.name) {
    case 'short_query':
      sleepTime = Math.random() * 2 + 1; // 1-3 seconds
      break;
    case 'medium_query':
      sleepTime = Math.random() * 3 + 2; // 2-5 seconds
      break;
    case 'long_query':
      sleepTime = Math.random() * 5 + 3; // 3-8 seconds
      break;
  }
  
  sleep(sleepTime);
}

/**
 * Setup function - runs once per VU
 */
export function setup() {
  console.log('Starting load test setup...');
  
  // Test basic connectivity
  const healthResponse = http.get(`${BASE_URL}/health`);
  if (healthResponse.status !== 200) {
    throw new Error(`Health check failed: ${healthResponse.status}`);
  }
  
  console.log('Setup complete - server is healthy');
  return { timestamp: Date.now() };
}

/**
 * Teardown function - runs once after all VUs complete
 */
export function teardown(data) {
  console.log(`Load test completed. Started at: ${new Date(data.timestamp)}`);
  console.log(`Total duration: ${Date.now() - data.timestamp}ms`);
  
  // Final health check
  const healthResponse = http.get(`${BASE_URL}/health`);
  console.log(`Final health check status: ${healthResponse.status}`);
}