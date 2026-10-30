"""
Unit test suite for FlowOps AI Rapid Claude API Test Runner.
Verifies state machine transitions, dry-run simulation, spending ceiling controls,
safety margin stopping, and pricing resolution WITHOUT making external API calls.
"""

import sys
from pathlib import Path
import asyncio
import pytest

# Ensure backend directory is in python path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from rapid_tester import (
    RapidTestRunner,
    resolve_model_rates,
    calculate_request_cost,
    PROMPT_TEMPLATES,
    get_live_operational_context,
)


def test_model_pricing_resolution():
    """Verify correct pricing calculation for various Claude models."""
    sonnet_rates = resolve_model_rates("claude-sonnet-4-6")
    assert sonnet_rates["input_per_m"] == 3.00
    assert sonnet_rates["output_per_m"] == 15.00

    opus_rates = resolve_model_rates("claude-3-opus-20240229")
    assert opus_rates["input_per_m"] == 15.00
    assert opus_rates["output_per_m"] == 75.00

    haiku_rates = resolve_model_rates("claude-3-5-haiku-20241022")
    assert haiku_rates["input_per_m"] == 0.80
    assert haiku_rates["output_per_m"] == 4.00

    # Test cost calculation
    cost = calculate_request_cost("claude-sonnet-4-6", 1000, 1000, 0, 0)
    # (1000/1M * 3) + (1000/1M * 15) = 0.003 + 0.015 = 0.018
    assert abs(cost - 0.018) < 1e-6


def test_prompt_templates_coverage():
    """Verify that all 5 prompt categories generate valid prompts."""
    assert len(PROMPT_TEMPLATES) == 5
    categories = {t["category"] for t in PROMPT_TEMPLATES}
    assert "ETL Architecture" in categories
    assert "Data Quality" in categories
    assert "Pipeline Troubleshooting" in categories
    assert "Schema Validation" in categories
    assert "Operational Reports" in categories

    ctx = get_live_operational_context()
    for t in PROMPT_TEMPLATES:
        prompt = t["generate_prompt"](ctx)
        assert len(prompt) > 200
        assert "FlowOps AI" in prompt


@pytest.mark.asyncio
async def test_runner_dry_run_simulation_lifecycle():
    """Test start, execution, live telemetry, and user stop in dry-run simulation mode."""
    runner = RapidTestRunner()

    # Initial state
    assert runner.status == "IDLE"
    payload = runner.get_status_payload()
    assert payload["status"] == "IDLE"
    assert payload["metrics"]["completed_requests"] == 0

    # Start simulation with 2 concurrency and comfortable ceiling
    res = await runner.start(
        concurrency=2,
        max_output_tokens=1500,
        spending_ceiling=5.00,
        safety_margin=0.05,
        dry_run=True,
    )
    assert res["status"] == "success"
    assert runner.status == "RUNNING"

    # Wait briefly for simulated workers to run
    await asyncio.sleep(1.2)

    status = runner.get_status_payload()
    assert status["metrics"]["completed_requests"] >= 1
    assert status["metrics"]["total_tokens"] > 0
    assert status["metrics"]["estimated_expenditure_usd"] > 0.0
    assert status["last_successful_response"] is not None

    # Gracefully stop
    stop_res = await runner.stop("Test finished")
    assert stop_res["status"] == "success"

    # Wait for drain
    await asyncio.sleep(0.5)
    assert runner.status in ("STOPPED_BY_USER", "STOPPING", "STOPPED_CEILING_REACHED")

    # Reset
    reset_res = await runner.reset()
    assert reset_res["status"] == "success"
    assert runner.status == "IDLE"
    assert runner.completed_requests == 0


@pytest.mark.asyncio
async def test_spending_ceiling_stop():
    """Verify runner automatically terminates when spending ceiling is reached."""
    runner = RapidTestRunner()

    # Set very small ceiling that will be exceeded on first simulated batch
    await runner.start(
        concurrency=1,
        max_output_tokens=3000,
        spending_ceiling=0.02,
        safety_margin=0.005,
        dry_run=True,
    )

    # Let it run for 2 seconds
    await asyncio.sleep(1.5)

    assert runner.status in ("STOPPED_CEILING_REACHED", "STOPPING")
    assert runner.estimated_expenditure >= (runner.spending_ceiling - runner.safety_margin)

    await runner.reset()
