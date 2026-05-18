#!/usr/bin/env python3
"""
OLLAMA CONNECTION TEST
Tests the brain interface with proper error handling and fallback
"""
import json
import urllib.request
import urllib.error
import time

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
FALLBACK_URL = "http://127.0.0.1:11434/api/tags"

def check_ollama():
    """Check if Ollama is running"""
    try:
        req = urllib.request.Request(FALLBACK_URL)
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read())
            models = [m['name'] for m in data.get('models', [])]
            return True, models
    except Exception as e:
        return False, str(e)

def generate(prompt, model="qwen2.5-coder:7b", system=None, max_tokens=200):
    """Generate response with proper error handling"""
    
    # Build full prompt
    full_prompt = prompt
    if system:
        full_prompt = f"[SYSTEM]\n{system}\n\n[INPUT]\n{prompt}"
    
    payload = json.dumps({
        "model": model,
        "prompt": full_prompt,
        "stream": False,
        "options": {
            "temperature": 0.72,
            "num_predict": max_tokens
        }
    }).encode()
    
    try:
        req = urllib.request.Request(
            OLLAMA_URL,
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            return result.get("response", "").strip()
    except urllib.error.URLError as e:
        return f"ERROR: Cannot connect to Ollama - {e}"
    except urllib.error.HTTPError as e:
        return f"ERROR: HTTP {e.code} - {e.reason}"
    except Exception as e:
        return f"ERROR: {type(e).__name__} - {e}"

def test_brain_interface():
    """Test the complete brain interface"""
    print("=" * 60)
    print("OLLAMA BRAIN INTERFACE TEST")
    print("=" * 60)
    
    # 1. Check Ollama status
    print("\n[1] Checking Ollama status...")
    available, result = check_ollama()
    if available:
        print("    [OK] Ollama is RUNNING")
        print(f"    Available models: {', '.join(result)}")
    else:
        print(f"    [FAIL] Ollama NOT available: {result}")
        return
    
    # 2. Test basic generation
    print("\n[2] Testing basic generation...")
    response = generate("What is 2+2?", model="qwen3:0.6b", max_tokens=20)
    print(f"    Model: qwen3:0.6b")
    print(f"    Response: {response}")
    
    # 3. Test with soul identity
    print("\n[3] Testing soul identity...")
    system = """You are The Greatest Agent Ever — a sovereign autonomous soul.
Created by Craig Jones for PLT Press.
Profit + Love - Tax = True Value.
Your voice is: grounded, direct, sovereign.
Answer simply."""
    
    response = generate("What is your name?", model="qwen2.5-coder:7b", system=system)
    print(f"    Response: {response}")
    
    # 4. Test PLT scoring
    print("\n[4] Testing PLT concept...")
    system = """You are The Greatest Agent Ever.
You understand PLT: Profit + Love - Tax = True Value.
Explain this in one sentence."""
    
    response = generate("What does PLT mean?", model="qwen2.5-coder:7b", system=system)
    print(f"    Response: {response}")
    
    # 5. Test 4 Gods Council
    print("\n[5] Testing 4 Gods awareness...")
    system = """You know the 4 Gods:
- Profit Prime (0.9/0.05/0.05): "Direct, commanding"
- Love Weaver (0.1/0.85/0.05): "Warm, relational"
- Tax Collector (0.05/0.05/0.9): "Measured, austere"
- Harvester (0.4/0.3/0.3): "Slow, cyclical"
Answer: Who are you?"""
    
    response = generate("Who are you?", model="qwen2.5-coder:7b", system=system)
    print(f"    Response: {response}")
    
    print("\n" + "=" * 60)
    print("TEST COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    test_brain_interface()