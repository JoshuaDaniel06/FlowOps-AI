"""
FastAPI async endpoint test suite for Rapid Claude API Test.
Tests all FastAPI endpoints directly using asyncio in Dry-Run / Simulation mode.
Zero Claude API credit consumed.
"""

import sys
import asyncio
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from main import (
    api_rapid_test_status,
    api_rapid_test_prompts,
    api_rapid_test_start,
    api_rapid_test_stop,
    api_rapid_test_reset,
    RapidTestStartRequest,
)


async def run_integration_tests():
    print("1. Testing GET /api/rapid-test/prompts...")
    prompts = api_rapid_test_prompts()
    assert len(prompts) == 5
    categories = [p["category"] for p in prompts]
    assert "ETL Architecture" in categories
    print("   -> Prompts OK:", len(prompts), "categories:", categories)

    print("2. Testing GET /api/rapid-test/status (initial IDLE)...")
    initial_status = api_rapid_test_status()
    assert initial_status["status"] == "IDLE"
    assert initial_status["pricing"]["input_per_m"] == 3.00
    assert initial_status["balances"]["estimated_remaining_balance_usd"] > 0
    print("   -> Initial status OK: IDLE, Remaining demo balance:", initial_status["balances"]["estimated_remaining_balance_usd"])

    print("3. Testing POST /api/rapid-test/start (Dry-Run Simulation Mode)...")
    req = RapidTestStartRequest(
        concurrency=2,
        max_output_tokens=2000,
        spending_ceiling=5.00,
        safety_margin=0.05,
        dry_run=True,
        task_mix="all",
    )
    start_res = await api_rapid_test_start(req)
    assert start_res["status"] == "success"
    print("   -> Start OK:", start_res["message"])

    # Allow simulated tasks to execute in event loop
    print("   -> Waiting 1.5 seconds for simulated tasks in event loop...")
    await asyncio.sleep(1.5)

    print("4. Testing GET /api/rapid-test/status (during/after execution)...")
    live_status = api_rapid_test_status()
    completed = live_status["metrics"]["completed_requests"]
    tokens = live_status["metrics"]["total_tokens"]
    cost = live_status["metrics"]["estimated_expenditure_usd"]
    assert completed >= 1
    assert tokens > 0
    assert cost > 0.0
    assert live_status["last_successful_response"] is not None
    print(f"   -> Telemetry OK: {completed} requests, {tokens:,} tokens, ${cost:.5f} spent")

    print("5. Testing POST /api/rapid-test/stop...")
    stop_res = await api_rapid_test_stop()
    assert stop_res["status"] in ("success", "ok")
    print("   -> Stop OK:", stop_res["message"])

    await asyncio.sleep(0.3)

    print("6. Testing POST /api/rapid-test/reset...")
    reset_res = await api_rapid_test_reset()
    assert reset_res["status"] == "success"
    final_status = api_rapid_test_status()
    assert final_status["status"] == "IDLE"
    assert final_status["metrics"]["completed_requests"] == 0
    print("   -> Reset OK: Runner state returned to IDLE with 0 requests.")

    print("\n=======================================================")
    print("ALL FASTAPI RAPID TEST ENDPOINT TESTS PASSED WITH 0 CREDITS SPENT!")
    print("=======================================================")


if __name__ == "__main__":
    asyncio.run(run_integration_tests())
