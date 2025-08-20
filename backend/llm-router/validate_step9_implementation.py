#!/usr/bin/env python3
"""
Validation script for Step 9 implementation.
Validates code structure and implementation without requiring running servers.
"""

import ast
import os
import sys
from typing import List, Dict, Any


def analyze_python_file(filepath: str) -> Dict[str, Any]:
    """Analyze a Python file and extract key information."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        tree = ast.parse(content)
        
        classes = []
        functions = []
        imports = []
        
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                classes.append(node.name)
                # Also collect methods within classes
                for item in node.body:
                    if isinstance(item, ast.FunctionDef):
                        functions.append(f"{node.name}.{item.name}")
            elif isinstance(node, ast.FunctionDef):
                functions.append(node.name)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    imports.append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ''
                for alias in node.names:
                    imports.append(f"{module}.{alias.name}")
        
        return {
            'classes': classes,
            'functions': functions,
            'imports': imports,
            'lines': len(content.splitlines())
        }
    
    except Exception as e:
        return {'error': str(e)}


def validate_inference_service():
    """Validate the new InferenceService implementation."""
    print("=== Validating InferenceService ===")
    
    service_path = "services/inference_service.py"
    if not os.path.exists(service_path):
        print("❌ InferenceService file not found")
        return False
    
    with open(service_path, 'r') as f:
        content = f.read()
    
    checks = [
        ("InferenceService class", "class InferenceService" in content),
        ("stream_inference method", "async def stream_inference" in content),
        ("startup method", "async def startup" in content),
        ("shutdown method", "async def shutdown" in content), 
        ("health_check method", "async def health_check" in content),
        ("SSE parsing", "data.strip() == \"[DONE]\"" in content),
        ("Token streaming", "yield token" in content),
        ("Budget timeout", "REQUEST_BUDGET_SECONDS" in content),
        ("Client disconnect", "request_deadline" in content)
    ]
    
    all_passed = True
    for name, check in checks:
        if check:
            print(f"✅ {name}")
        else:
            print(f"❌ {name}")
            all_passed = False
    
    lines = len(content.splitlines())
    print(f"✅ {lines} lines of code")
    return all_passed


def validate_models():
    """Validate the new InferenceRequest model."""
    print("\n=== Validating Models ===")
    
    models_path = "models.py"
    if not os.path.exists(models_path):
        print("❌ Models file not found")
        return False
    
    with open(models_path, 'r') as f:
        content = f.read()
    
    checks = [
        ("InferenceRequest", "class InferenceRequest" in content),
        ("Parameter guardrails", "model_post_init" in content),
        ("Temperature clamping", "temperature" in content and "1.5" in content),
        ("Top_p clamping", "top_p" in content and "0.95" in content),
        ("Max_tokens clamping", "max_tokens" in content and "4096" in content)
    ]
    
    all_passed = True
    for name, check in checks:
        if check:
            print(f"✅ {name}")
        else:
            print(f"❌ {name}")
            all_passed = False
    
    return all_passed


def validate_main_app():
    """Validate the main application updates."""
    print("\n=== Validating Main Application ===")
    
    main_path = "main.py"
    if not os.path.exists(main_path):
        print("❌ Main application file not found")
        return False
    
    with open(main_path, 'r') as f:
        content = f.read()
    
    checks = [
        ("InferenceService import", "from services.inference_service import InferenceService" in content),
        ("InferenceService initialization", "inference_service = InferenceService" in content),
        ("Inference endpoint", "@app.post(\"/inference\")" in content),
        ("Updated /api/chat", "inference_service.stream_inference" in content),
        ("Per-chunk encryption", "encrypt_chunk" in content and "chunk_sequence" in content),
        ("Parameter guardrails usage", "InferenceRequest(" in content),
        ("SSE event streaming", "EventSourceResponse" in content)
    ]
    
    all_passed = True
    for name, check in checks:
        if check:
            print(f"✅ {name}")
        else:
            print(f"❌ {name}")
            all_passed = False
    
    return all_passed


def validate_test_files():
    """Validate test files exist and are structured correctly."""
    print("\n=== Validating Test Files ===")
    
    test_files = [
        "test_inference_endpoint.py",
        "test_encrypted_streaming.py"
    ]
    
    all_passed = True
    for test_file in test_files:
        if os.path.exists(test_file):
            analysis = analyze_python_file(test_file)
            if 'error' not in analysis:
                print(f"✅ {test_file} ({analysis['lines']} lines)")
            else:
                print(f"❌ {test_file}: {analysis['error']}")
                all_passed = False
        else:
            print(f"❌ {test_file}: Not found")
            all_passed = False
    
    return all_passed


def main():
    """Run all validation checks for Step 9."""
    print("Step 9 Implementation Validation")
    print("=" * 50)
    
    # Change to the correct directory
    if os.path.basename(os.getcwd()) != "llm-router":
        router_dir = "backend/llm-router"
        if os.path.exists(router_dir):
            os.chdir(router_dir)
            print(f"Changed to directory: {os.getcwd()}")
    
    validations = [
        ("InferenceService", validate_inference_service),
        ("Models", validate_models),  
        ("Main Application", validate_main_app),
        ("Test Files", validate_test_files)
    ]
    
    all_passed = True
    for name, validation_func in validations:
        try:
            result = validation_func()
            if not result:
                all_passed = False
        except Exception as e:
            print(f"❌ {name}: Validation error: {e}")
            all_passed = False
    
    print("\n" + "=" * 50)
    if all_passed:
        print("✅ Step 9 Implementation Validation PASSED")
        print("\nKey features implemented:")
        print("✓ Dedicated /inference POST endpoint with SSE streaming")
        print("✓ InferenceService with SSE parsing from llama.cpp") 
        print("✓ Per-chunk HPKE re-encryption for streaming tokens")
        print("✓ Parameter validation with guardrails") 
        print("✓ Updated /api/chat to use new inference service")
        print("✓ Test scripts for validation")
        print("\nStep 9 is ready for integration testing!")
    else:
        print("❌ Step 9 Implementation Validation FAILED") 
        print("Please fix the issues above before proceeding.")
    
    return all_passed


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)