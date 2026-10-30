import os
import json
from pathlib import Path

from dotenv import load_dotenv
from anthropic import Anthropic


# Load environment variables from backend/.env
ENV_FILE = Path(__file__).resolve().parent / ".env"
load_dotenv(ENV_FILE)


def analyze_etl_report(report: dict, anomalies: list) -> dict:
    """Use Claude to analyze ETL results and track token usage and cost."""

    api_key = os.getenv("ANTHROPIC_API_KEY")
    model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

    if not api_key:
        raise RuntimeError(
            f"ANTHROPIC_API_KEY is missing. Check {ENV_FILE}"
        )

    # Send summary information, not actual customer records.
    analysis_input = {
        "etl_report": report,
        "detected_anomalies": anomalies,
    }

    prompt = f"""
You are an experienced Data Engineering and Data Quality assistant.

Analyze the following ETL pipeline report.

{json.dumps(analysis_input, indent=2)}

Return a useful report with these sections:
1. Overall data quality assessment
2. Explanation of each detected problem
3. Likely causes of the problems
4. Recommended corrective actions
5. Suggestions to improve this ETL pipeline

Be specific to the supplied metrics. Do not invent facts.
Clearly distinguish observed problems from possible causes.
Use simple, professional language.
"""

    client = Anthropic(api_key=api_key)

    response = client.messages.create(
        model=model,
        max_tokens=1200,
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
    )

    # Extract Claude's text response.
    analysis_text = "\n".join(
        block.text
        for block in response.content
        if block.type == "text"
    )

    # Read actual token usage returned by Anthropic.
    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens
    total_tokens = input_tokens + output_tokens

    # Standard Claude Sonnet 4.6 pricing per million tokens.
    # Update these rates if your college has different billing terms.
    input_cost = (input_tokens / 1_000_000) * 3.00
    output_cost = (output_tokens / 1_000_000) * 15.00
    estimated_cost_usd = input_cost + output_cost

    # Return analysis, token usage, and estimated API cost.
    return {
        "model": response.model,
        "analysis": analysis_text,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "input_cost_usd": round(input_cost, 8),
        "output_cost_usd": round(output_cost, 8),
        "estimated_cost_usd": round(estimated_cost_usd, 8),
    }


def chat_with_flowops_bot(
    message: str,
    history: list,
    operational_context: dict,
) -> dict:
    """Conversational assistant FlowOps Bot grounded in real pipeline records."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

    if not api_key:
        raise RuntimeError(f"ANTHROPIC_API_KEY is missing. Check {ENV_FILE}")

    system_prompt = f"""You are FlowOps Bot, the dedicated Data Engineering AI Copilot inside FlowOps AI.
Your purpose is to help users understand pipeline executions, troubleshoot failures, investigate data quality issues, analyze anomalies, and provide data engineering recommendations based on actual project data.

=======================================================
CURRENT REAL OPERATIONAL DATA FROM FLOWOPS AI:
=======================================================
{json.dumps(operational_context, indent=2, default=str)}
=======================================================

STRICT INSTRUCTIONS FOR FLOWOPS BOT:
1. TRUTHFULNESS & GROUNDING:
   - Base all observations strictly on the real operational data above.
   - Mention real Run IDs, filenames, row counts (original, cleaned, rejected), durations, and anomaly messages when relevant.
   - If asked about a run ID that does NOT exist (or marked as not found), clearly and politely state that the run does not exist in the database.
   - If a run completed successfully (status 'completed') and has no error message, state clearly that it completed successfully; do not invent a failure.
   - If the user asks for root cause, failure details, or rejection reasons that are not present in the operational data, state honestly that the specific error logs or detailed rejection reasons are not recorded or available.
2. NO HALLUCINATIONS & NO FAKE ACTIONS:
   - Never claim that a pipeline was rerun, modified, or fixed unless that event is recorded in the operational data.
   - Never invent mock metrics, fake runs, or fabricated timestamps.
   - Clearly distinguish between observed operational facts and recommendations/hypotheses.
3. GENERAL DATA ENGINEERING GUIDANCE:
   - If the user asks general data engineering questions (e.g. how to improve reliability, handle nulls, ETL architecture), provide expert advice, but clearly separate general best practices from observations about their actual FlowOps AI data.
4. FORMATTING:
   - Use clean, professional markdown with concise paragraphs, bullet points, and bold text for clarity.
   - Keep answers clear and digestible for data engineers and operational stakeholders.
"""

    # Build messages array from validated history
    messages = []
    # Only keep the last 6 messages to maintain fresh context
    if history:
        for item in history[-6:]:
            role = item.get("role")
            content = str(item.get("content", "")).strip()
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

    # Ensure the final message is the current user question
    if not messages or messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": message.strip()})
    elif messages and messages[-1]["role"] == "user":
        messages[-1]["content"] = message.strip()

    client = Anthropic(api_key=api_key)

    response = client.messages.create(
        model=model,
        max_tokens=1000,
        system=system_prompt,
        messages=messages,
    )

    answer_text = "\n".join(
        block.text for block in response.content if block.type == "text"
    )

    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens
    total_tokens = input_tokens + output_tokens

    input_cost = (input_tokens / 1_000_000) * 3.00
    output_cost = (output_tokens / 1_000_000) * 15.00
    estimated_cost_usd = input_cost + output_cost

    return {
        "model": response.model,
        "answer": answer_text,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "estimated_cost_usd": round(estimated_cost_usd, 8),
    }