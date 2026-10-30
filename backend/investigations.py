import json
import os
import re
import time
from typing import Dict, Any, Optional, List
from sqlalchemy import text
from anthropic import Anthropic

from database import engine

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")


def extract_run_id_from_text(prompt: str) -> Optional[int]:
    """Helper to detect explicit run_id references like 'run #5', 'run 12', '#10'."""
    match = re.search(r"(?:run\s*#?|#)\s*(\d+)", prompt, re.IGNORECASE)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass
    return None


def run_root_cause_analysis(run_id: Optional[int] = None, prompt: str = "") -> Dict[str, Any]:
    """
    Feature 2: Structured AI Root Cause Analysis
    Retrieves real run evidence from PostgreSQL and formats a 6-part root cause investigation:
    1. Pipeline summary
    2. Observed failure
    3. Probable root cause (Confidence: High / Medium / Low)
    4. Contributing factors
    5. Recommended fix
    6. Verification
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is missing from environment.")

    # 1. Identify relevant run
    target_id = run_id or extract_run_id_from_text(prompt)

    with engine.connect() as conn:
        if target_id is not None:
            run_row = conn.execute(
                text("""
                    SELECT run_id, filename, status, original_rows, cleaned_rows,
                           rejected_rows, duration_seconds, error_message, failed_step,
                           retry_attempts, started_at, completed_at, created_at
                    FROM pipeline_runs
                    WHERE run_id = :run_id
                """),
                {"run_id": target_id}
            ).mappings().first()
        else:
            # Look for the latest failed run first
            run_row = conn.execute(
                text("""
                    SELECT run_id, filename, status, original_rows, cleaned_rows,
                           rejected_rows, duration_seconds, error_message, failed_step,
                           retry_attempts, started_at, completed_at, created_at
                    FROM pipeline_runs
                    WHERE status = 'failed'
                    ORDER BY run_id DESC
                    LIMIT 1
                """)
            ).mappings().first()

            # If no failed run exists, inspect the latest run
            if not run_row:
                run_row = conn.execute(
                    text("""
                        SELECT run_id, filename, status, original_rows, cleaned_rows,
                               rejected_rows, duration_seconds, error_message, failed_step,
                               retry_attempts, started_at, completed_at, created_at
                        FROM pipeline_runs
                        ORDER BY run_id DESC
                        LIMIT 1
                    """)
                ).mappings().first()

        if not run_row:
            return {
                "success": False,
                "answer": "No pipeline runs were found in the FlowOps AI database to analyze.",
                "run_id": None,
                "evidence": {}
            }

        run_dict = dict(run_row)
        for k in ("created_at", "started_at", "completed_at"):
            if run_dict.get(k):
                run_dict[k] = run_dict[k].isoformat()
        run_dict["duration_seconds"] = float(run_dict["duration_seconds"] or 0)

        # Retrieve related anomalies
        anom_rows = conn.execute(
            text("""
                SELECT anomaly_id, anomaly_type, severity, message, created_at
                FROM anomaly_logs
                WHERE run_id = :run_id
                ORDER BY anomaly_id ASC
            """),
            {"run_id": run_dict["run_id"]}
        ).mappings().all()

        anomalies = []
        for a in anom_rows:
            ad = dict(a)
            if ad.get("created_at"):
                ad["created_at"] = ad["created_at"].isoformat()
            anomalies.append(ad)

        # Retrieve prior run for comparison if available
        prior_run_row = conn.execute(
            text("""
                SELECT run_id, filename, status, original_rows, cleaned_rows,
                       rejected_rows, duration_seconds, error_message
                FROM pipeline_runs
                WHERE run_id < :run_id
                ORDER BY run_id DESC
                LIMIT 1
            """),
            {"run_id": run_dict["run_id"]}
        ).mappings().first()
        prior_run = dict(prior_run_row) if prior_run_row else None

    # Construct Claude prompt
    client = Anthropic(api_key=api_key)

    evidence_package = {
        "investigated_run": run_dict,
        "related_anomalies": anomalies,
        "prior_run_comparison": prior_run,
        "database_note": "Real operational data extracted from PostgreSQL."
    }

    system_prompt = """You are FlowOps AI's Principal Site Reliability & Data Operations Engineer.
You perform deep root cause analysis (RCA) on pipeline executions based strictly on real operational evidence.

MANDATORY STRUCTURE:
You must organize your answer using exactly these 6 numbered sections:

### 1. Pipeline Summary
- Run ID, Filename, actual status, duration in seconds, original/cleaned/rejected row counts.

### 2. Observed Failure
- The exact error message and failed step recorded in the database.
- Supporting evidence from logs/metrics.
- If the run status is 'completed' and no error occurred, state explicitly: 'No pipeline failure observed. Status is completed without recorded error messages.'

### 3. Probable Root Cause
- The most likely explanation based strictly on the available evidence.
- A confidence level labeled exactly as: [Confidence: High], [Confidence: Medium], or [Confidence: Low].
- Clear justification for why the operational evidence supports this conclusion.

### 4. Contributing Factors
- Associated data quality issues (e.g. high rejection rate, schema mismatches, nulls, duplicates).
- Pipeline retry attempts, timeout thresholds, or anomaly alerts.

### 5. Recommended Fix
- Specific debugging steps.
- Concrete configuration or ETL transformation adjustments.
- Safe pre-flight validation steps before rerunning the pipeline.

### 6. Verification
- Specific criteria to determine whether the fix worked when the pipeline is rerun.

SAFETY RULES:
- Never fabricate logs, stack traces, or errors.
- Clearly separate confirmed database facts from hypotheses.
- If evidence is insufficient, explicitly state what information is missing.
"""

    user_message = f"""Please perform an AI Root Cause Analysis on this pipeline run.
User query: {prompt or 'Investigate pipeline failure and explain root cause'}

Operational Evidence:
{json.dumps(evidence_package, indent=2, default=str)}
"""

    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2500,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}]
    )

    answer_text = "".join(b.text for b in resp.content if b.type == "text").strip()
    in_tok = resp.usage.input_tokens
    out_tok = resp.usage.output_tokens
    tot_tok = in_tok + out_tok
    cost = round(((in_tok / 1e6) * 3.0) + ((out_tok / 1e6) * 15.0), 8)

    return {
        "success": True,
        "run_id": run_dict["run_id"],
        "answer": answer_text,
        "evidence": evidence_package,
        "model": CLAUDE_MODEL,
        "input_tokens": in_tok,
        "output_tokens": out_tok,
        "total_tokens": tot_tok,
        "estimated_cost_usd": cost,
        "sources": [
            {
                "type": "Pipeline Run",
                "id": run_dict["run_id"],
                "label": f"Run #{run_dict['run_id']} ({run_dict['status']})"
            }
        ] + [
            {
                "type": "Anomaly Log",
                "id": a["anomaly_id"],
                "label": f"Anomaly #{a['anomaly_id']}: {a['anomaly_type']}"
            } for a in anomalies
        ]
    }


def investigate_data_quality(run_id: Optional[int] = None, prompt: str = "") -> Dict[str, Any]:
    """
    Feature 3: Deep Data Quality Investigator
    Investigates real validation metrics, rejected records, and rule failures from the existing pipeline.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is missing from environment.")

    target_id = run_id or extract_run_id_from_text(prompt)

    with engine.connect() as conn:
        if target_id is not None:
            run_row = conn.execute(
                text("""
                    SELECT run_id, filename, status, original_rows, cleaned_rows,
                           rejected_rows, duration_seconds, error_message, created_at
                    FROM pipeline_runs
                    WHERE run_id = :run_id
                """),
                {"run_id": target_id}
            ).mappings().first()
        else:
            run_row = conn.execute(
                text("""
                    SELECT run_id, filename, status, original_rows, cleaned_rows,
                           rejected_rows, duration_seconds, error_message, created_at
                    FROM pipeline_runs
                    ORDER BY run_id DESC
                    LIMIT 1
                """)
            ).mappings().first()

        if not run_row:
            return {
                "success": False,
                "answer": "No pipeline runs available to perform Data Quality Investigation.",
                "evidence": {}
            }

        run_dict = dict(run_row)
        for k in ("created_at",):
            if run_dict.get(k):
                run_dict[k] = run_dict[k].isoformat()

        # Retrieve anomalies for this run
        anoms = conn.execute(
            text("""
                SELECT anomaly_id, anomaly_type, severity, message
                FROM anomaly_logs
                WHERE run_id = :run_id
            """),
            {"run_id": run_dict["run_id"]}
        ).mappings().all()

        # Retrieve a sample of processed records to understand schema and clean state
        proc_samples = conn.execute(
            text("""
                SELECT row_number, record_data
                FROM processed_records
                WHERE run_id = :run_id
                ORDER BY row_number ASC
                LIMIT 3
            """),
            {"run_id": run_dict["run_id"]}
        ).mappings().all()

        sample_records = [dict(p) for p in proc_samples]

    rejection_pct = 0.0
    if run_dict.get("original_rows"):
        rejection_pct = round((run_dict.get("rejected_rows", 0) / run_dict["original_rows"]) * 100, 1)

    evidence = {
        "run": run_dict,
        "rejection_percentage": f"{rejection_pct}%",
        "validation_anomalies": [dict(a) for a in anoms],
        "sample_cleaned_records": sample_records,
        "rules_enforced": [
            "Missing cell detection and conversion to JSON-safe nulls",
            "Full row duplicate deduplication",
            "Email regex format validation (^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$)",
            "Column whitespace stripping and name normalization"
        ]
    }

    client = Anthropic(api_key=api_key)

    system_prompt = """You are FlowOps AI's Data Quality Investigator.
Your role is to deeply analyze data quality results, explain validation failures, prioritize issues, and recommend safe, practical corrections.

STRUCTURE YOUR RESPONSE:
### 1. Data Quality Health Summary
- Pipeline Run ID, file analyzed, total original rows vs cleaned rows vs rejected rows.
- Rejection rate and overall quality posture.

### 2. Prioritized Quality Issues
- Rank detected issues from highest to lowest severity (e.g. Critical: high rejection rate / invalid email drop; Warning: missing values, duplicates).
- Explain why each issue is ranked at its priority level based on downstream operational impact.

### 3. Rule-by-Rule Breakdown & Evidence
- Explain each validation rule applied by FlowOps AI.
- Correlate with the actual anomalies and row counts in the evidence.

### 4. Before-and-After Analysis
- Table or clear comparison of: Original Rows -> Deduplication -> Email Filtering -> Cleaned Final Rows.

### 5. Recommended Remediation & Safe Preview
- Concrete data cleansing steps (e.g. upstream email normalization, deduplication key strategy, handling missing values).
- Provide a read-only pseudo-transformation preview showing how dirty data can be sanitized safely before ingestion without modifying production tables.
"""

    user_msg = f"""Perform a Deep Data Quality Investigation based on the following real operational results.
User Question: {prompt or 'Investigate data quality issues and explain rejected records'}

Operational Evidence:
{json.dumps(evidence, indent=2, default=str)}
"""

    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2500,
        system=system_prompt,
        messages=[{"role": "user", "content": user_msg}]
    )

    answer_text = "".join(b.text for b in resp.content if b.type == "text").strip()
    in_tok = resp.usage.input_tokens
    out_tok = resp.usage.output_tokens
    tot_tok = in_tok + out_tok
    cost = round(((in_tok / 1e6) * 3.0) + ((out_tok / 1e6) * 15.0), 8)

    return {
        "success": True,
        "run_id": run_dict["run_id"],
        "answer": answer_text,
        "evidence": evidence,
        "model": CLAUDE_MODEL,
        "input_tokens": in_tok,
        "output_tokens": out_tok,
        "total_tokens": tot_tok,
        "estimated_cost_usd": cost,
        "sources": [
            {
                "type": "Data Quality Report",
                "id": run_dict["run_id"],
                "label": f"Quality Audit for Run #{run_dict['run_id']} ({rejection_pct}% rejection)"
            }
        ]
    }


def run_multi_step_investigation(prompt: str) -> Dict[str, Any]:
    """
    Feature 5: Multi-Step Investigation Mode
    Orchestrates evidence gathering across:
    1. Recent pipeline run executions and duration trends
    2. Original vs Cleaned vs Rejected row volume shifts
    3. Anomaly logs and severity correlation
    4. Temporal correlation and historical aggregate stats
    Consolidates into a structured investigation report:
    - Question
    - Evidence collected
    - Key findings
    - Analysis
    - Conclusion
    - Recommended next steps
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is missing from environment.")

    # Step 1 to 4: Collect comprehensive operational evidence
    with engine.connect() as conn:
        # Runs overview (up to 8 runs)
        runs_raw = conn.execute(
            text("""
                SELECT run_id, filename, status, original_rows, cleaned_rows,
                       rejected_rows, duration_seconds, error_message, failed_step,
                       created_at
                FROM pipeline_runs
                ORDER BY run_id DESC
                LIMIT 8
            """)
        ).mappings().all()

        recent_runs = []
        for r in runs_raw:
            rd = dict(r)
            if rd.get("created_at"):
                rd["created_at"] = rd["created_at"].isoformat()
            rd["duration_seconds"] = float(rd["duration_seconds"] or 0)
            recent_runs.append(rd)

        # Recent anomaly logs across all runs
        anom_raw = conn.execute(
            text("""
                SELECT anomaly_id, run_id, anomaly_type, severity, message, created_at
                FROM anomaly_logs
                ORDER BY anomaly_id DESC
                LIMIT 10
            """)
        ).mappings().all()

        recent_anoms = []
        for a in anom_raw:
            ad = dict(a)
            if ad.get("created_at"):
                ad["created_at"] = ad["created_at"].isoformat()
            recent_anoms.append(ad)

        # Aggregate stats
        agg_row = conn.execute(
            text("""
                SELECT
                    COUNT(*) AS total_runs,
                    COUNT(*) FILTER (WHERE status = 'completed') AS successful_runs,
                    COUNT(*) FILTER (WHERE status = 'failed') AS failed_runs,
                    COALESCE(SUM(original_rows), 0) AS total_original_rows,
                    COALESCE(SUM(rejected_rows), 0) AS total_rejected_rows,
                    COALESCE(AVG(duration_seconds), 0) AS avg_duration_seconds
                FROM pipeline_runs
            """)
        ).mappings().first()
        agg_stats = dict(agg_row) if agg_row else {}
        if agg_stats.get("avg_duration_seconds"):
            agg_stats["avg_duration_seconds"] = round(float(agg_stats["avg_duration_seconds"]), 2)

    evidence_summary = {
        "sources_checked": [
            "PostgreSQL pipeline_runs (Last 8 executions)",
            "PostgreSQL anomaly_logs (Recent 10 detected anomalies)",
            "PostgreSQL pipeline aggregate performance metrics"
        ],
        "recent_pipeline_runs": recent_runs,
        "anomaly_timeline": recent_anoms,
        "system_aggregate_stats": agg_stats
    }

    client = Anthropic(api_key=api_key)

    system_prompt = """You are FlowOps AI's Principal Operations Investigator.
You are executing a Multi-Step Deep Investigation combining multiple operational data sources.

MANDATORY STRUCTURE:
Organize your response using EXACTLY these 6 sections:

### Question
- Rephrase the user's specific inquiry.

### Evidence Collected
- List the verified operational sources retrieved and examined (run IDs, anomaly records, timestamps).

### Key Findings
- Bulleted list of verified observations with concrete numbers: Run IDs, rejection counts, durations, and anomaly types.
- State clearly what the records directly prove.

### Analysis
- Synthesize the combined data: Explain correlations, row volume trends, and timeline connections.
- CRITICAL: Never mistake temporal correlation for confirmed causation. Clearly articulate whether an anomaly directly caused a problem or merely co-occurred.

### Conclusion
- Clearly separate:
  * Confirmed Facts (grounded in the database)
  * Probable Hypotheses
  * Unknowns / Missing Information

### Recommended Next Steps
- Actionable, high-priority operational steps for the data engineering team.
"""

    user_msg = f"""Execute a Multi-Step Deep Investigation for this request:
User Investigation Query: {prompt}

Compiled Operational Evidence:
{json.dumps(evidence_summary, indent=2, default=str)}
"""

    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2500,
        system=system_prompt,
        messages=[{"role": "user", "content": user_msg}]
    )

    answer_text = "".join(b.text for b in resp.content if b.type == "text").strip()
    in_tok = resp.usage.input_tokens
    out_tok = resp.usage.output_tokens
    tot_tok = in_tok + out_tok
    cost = round(((in_tok / 1e6) * 3.0) + ((out_tok / 1e6) * 15.0), 8)

    sources = [
        {"type": "Multi-Source Investigation", "id": "runs", "label": f"{len(recent_runs)} Pipeline Runs Analyzed"},
        {"type": "Anomaly Correlation", "id": "anomalies", "label": f"{len(recent_anoms)} Anomalies Correlated"},
    ]

    return {
        "success": True,
        "answer": answer_text,
        "evidence": evidence_summary,
        "model": CLAUDE_MODEL,
        "input_tokens": in_tok,
        "output_tokens": out_tok,
        "total_tokens": tot_tok,
        "estimated_cost_usd": cost,
        "sources": sources
    }
