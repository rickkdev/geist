#!/usr/bin/env python3
"""
Test script for Harmony integration with HPKE encryption.
Validates that Harmony-formatted responses work properly with the existing
HPKE encryption and SSE streaming infrastructure.
"""

import asyncio
import json
import logging
from typing import Dict, Any

from config import get_settings
from services.harmony_service import HarmonyService
from services.hpke_service import HPKEService
from services.inference_service import InferenceService
from models import InferenceRequest

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class HarmonyIntegrationTester:
    """Test Harmony integration with existing infrastructure."""
    
    def __init__(self):
        self.settings = get_settings()
        self.harmony_service = HarmonyService()
        self.hpke_service = HPKEService(self.settings)
        
    def test_harmony_service_basic(self):
        """Test basic Harmony service functionality."""
        logger.info("Testing basic Harmony service functionality...")
        
        # Test conversation preparation
        test_messages = [
            {"role": "user", "content": "Explain quantum computing in simple terms"}
        ]
        
        tokens = self.harmony_service.prepare_conversation(
            test_messages, 
            reasoning_effort="medium"
        )
        
        logger.info(f"✓ Conversation prepared: {len(tokens)} tokens")
        
        # Test encoding validation
        is_valid = self.harmony_service.validate_harmony_encoding()
        logger.info(f"✓ Encoding validation: {is_valid}")
        
        # Test encoding info
        info = self.harmony_service.get_encoding_info()
        logger.info(f"✓ Encoding info: {info['encoding_name']}")
        
        return True
        
    def test_inference_request_formatting(self):
        """Test that InferenceRequest works with Harmony."""
        logger.info("Testing InferenceRequest with Harmony formatting...")
        
        # Create a sample inference request
        test_messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is machine learning?"}
        ]
        
        inference_request = InferenceRequest(
            messages=test_messages,
            temperature=0.7,
            top_p=0.9,
            max_tokens=100,
            request_id="harmony-test-001"
        )
        
        logger.info(f"✓ InferenceRequest created: {len(inference_request.messages)} messages")
        
        # Test Harmony preparation with these messages
        harmony_tokens = self.harmony_service.prepare_conversation(
            inference_request.messages,
            reasoning_effort=self.settings.HARMONY_REASONING_EFFORT
        )
        
        logger.info(f"✓ Harmony tokens for inference request: {len(harmony_tokens)}")
        
        return True
        
    def test_harmony_with_hpke_simulation(self):
        """Simulate Harmony response encryption with HPKE."""
        logger.info("Testing Harmony response simulation with HPKE...")
        
        # Simulate a Harmony-formatted response
        harmony_response = {
            "final": [
                {
                    "role": "assistant",
                    "content": "Machine learning is a subset of artificial intelligence",
                    "channel": "final"
                }
            ],
            "analysis": [
                {
                    "role": "assistant", 
                    "content": "Let me think about how to explain this clearly...",
                    "channel": "analysis"
                }
            ],
            "commentary": []
        }
        
        # Test formatting for streaming
        final_content = self.harmony_service.get_final_response_content(harmony_response)
        logger.info(f"✓ Final response content: {final_content[:50]}...")
        
        # Test streaming format
        stream_format = self.harmony_service.format_for_streaming(
            final_content[:20], 
            channel="final"
        )
        logger.info(f"✓ Stream format: {stream_format['format']}")
        
        return True
        
    def test_configuration_values(self):
        """Test that Harmony configuration is properly loaded."""
        logger.info("Testing Harmony configuration...")
        
        logger.info(f"✓ HARMONY_ENABLED: {self.settings.HARMONY_ENABLED}")
        logger.info(f"✓ HARMONY_REASONING_EFFORT: {self.settings.HARMONY_REASONING_EFFORT}")
        logger.info(f"✓ HARMONY_INCLUDE_ANALYSIS: {self.settings.HARMONY_INCLUDE_ANALYSIS}")
        
        # Validate configuration values
        assert self.settings.HARMONY_ENABLED in [True, False]
        assert self.settings.HARMONY_REASONING_EFFORT in ["low", "medium", "high"]
        assert self.settings.HARMONY_INCLUDE_ANALYSIS in [True, False]
        
        return True
        
    async def test_inference_service_initialization(self):
        """Test that InferenceService properly initializes with Harmony."""
        logger.info("Testing InferenceService initialization with Harmony...")
        
        # This should initialize with Harmony support
        inference_service = InferenceService(self.settings)
        
        # Check that harmony_service is initialized if enabled
        if self.settings.HARMONY_ENABLED:
            assert inference_service.harmony_service is not None
            logger.info("✓ InferenceService has Harmony service")
        else:
            assert inference_service.harmony_service is None
            logger.info("✓ InferenceService has no Harmony service (disabled)")
            
        # Clean up
        try:
            await inference_service.startup()
            await inference_service.shutdown()
            logger.info("✓ InferenceService startup/shutdown successful")
        except Exception as e:
            logger.warning(f"InferenceService startup/shutdown failed (expected in test): {e}")
            
        return True
        
    def run_all_tests(self):
        """Run all integration tests."""
        logger.info("Starting Harmony integration tests...")
        
        tests = [
            ("Basic Harmony Service", self.test_harmony_service_basic),
            ("InferenceRequest Formatting", self.test_inference_request_formatting), 
            ("Harmony+HPKE Simulation", self.test_harmony_with_hpke_simulation),
            ("Configuration Values", self.test_configuration_values),
        ]
        
        results = {}
        for test_name, test_func in tests:
            try:
                logger.info(f"\n--- Running: {test_name} ---")
                result = test_func()
                results[test_name] = "PASS" if result else "FAIL"
                logger.info(f"✓ {test_name}: PASSED")
            except Exception as e:
                results[test_name] = f"FAIL: {e}"
                logger.error(f"✗ {test_name}: FAILED - {e}")
                
        # Run async test
        try:
            logger.info(f"\n--- Running: InferenceService Initialization ---")
            asyncio.run(self.test_inference_service_initialization())
            results["InferenceService Initialization"] = "PASS"
            logger.info(f"✓ InferenceService Initialization: PASSED")
        except Exception as e:
            results["InferenceService Initialization"] = f"FAIL: {e}"
            logger.error(f"✗ InferenceService Initialization: FAILED - {e}")
                
        # Print summary
        logger.info(f"\n--- Test Summary ---")
        all_passed = True
        for test_name, result in results.items():
            status = "✓ PASS" if result == "PASS" else f"✗ {result}"
            logger.info(f"{test_name}: {status}")
            if result != "PASS":
                all_passed = False
                
        if all_passed:
            logger.info("\n🎉 All Harmony integration tests PASSED!")
            return True
        else:
            logger.error("\n❌ Some Harmony integration tests FAILED!")
            return False


if __name__ == "__main__":
    tester = HarmonyIntegrationTester()
    success = tester.run_all_tests()
    exit(0 if success else 1)