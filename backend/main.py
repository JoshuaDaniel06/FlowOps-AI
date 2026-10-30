
import json
import os
import re
import time
from datetime import datetime
from time import sleep
from typing import List, Optional, Union, Dict, Any

import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from etl import process_csv, analyze_csv
from database import engine, test_connection
from anomaly_detection import detect_anomalies
from ai_analyzer import analyze_etl_report, chat_with_flowops_bot
from sql_assistant import process_natural_language_sql
from investigations import (
    run_root_cause_analysis,
    investigate_data_quality,
    run_multi_step_investigation
)
from reports_generator import (
    generate_operational_report,
    generate_usage_receipt,
    REPORTS_DIR
)
import asyncio
from scheduler import (
    init_scheduler_table,
    list_schedules,
    get_schedule_stats,
    create_schedule,
    update_schedule,
    delete_schedule,
    trigger_schedule,
    scheduler_background_loop,
)
from rapid_tester import rapid_tester, PROMPT_TEMPLATES




app = FastAPI(
    title="FlowOps AI",
    description=(
        "AI-powered data pipeline monitoring, ETL processing, "
        "anomaly detection, failure recovery, and Claude AI analysis."
    ),
    version="1.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://10.201.140.174:5173",
    ],
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INITIAL_CREDIT_USD = 5.00
INPUT_PRICE_PER_MILLION = 1.50
OUTPUT_PRICE_PER_MILLION = 7.50
CLAUDE_MAX_OUTPUT_TOKENS = 1200

# Three total database-save attempts: one initial attempt and two retries.
MAX_DATABASE_ATTEMPTS = 3

USAGE_NOTE = (
    "Estimated app-side usage based on Claude-reported token counts "
    "and configured pricing. This is not the live Anthropic account balance."
)


def calculate_ai_cost(input_tokens: int, output_tokens: int) -> dict:
    """Estimate the cost of one Claude request."""
    input_cost = input_tokens / 1_000_000 * INPUT_PRICE_PER_MILLION
    output_cost = output_tokens / 1_000_000 * OUTPUT_PRICE_PER_MILLION

    return {
        "total_tokens": input_tokens + output_tokens,
        "input_cost_usd": round(input_cost, 8),
        "output_cost_usd": round(output_cost, 8),
        "estimated_cost_usd": round(input_cost + output_cost, 8),
    }


def get_ai_usage_data(connection) -> dict:
    """Calculate cumulative AI usage and the app-side demo budget."""
    current_starting_credit = INITIAL_CREDIT_USD
    try:
        existing_row = connection.execute(
            text("SELECT starting_credit_usd FROM ai_usage_summary WHERE summary_id = 1")
        ).fetchone()
        if existing_row and existing_row[0] is not None:
            current_starting_credit = float(existing_row[0])
    except Exception:
        pass

    row = connection.execute(
        text("""
            SELECT
                COUNT(*) AS total_requests,
                COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
                COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
                COALESCE(
                    SUM(
                        COALESCE(input_tokens, 0)
                        + COALESCE(output_tokens, 0)
                    ), 0
                ) AS total_tokens,
                MIN(
                    COALESCE(input_tokens, 0)
                    + COALESCE(output_tokens, 0)
                ) AS minimum_tokens_per_request,
                MAX(
                    COALESCE(input_tokens, 0)
                    + COALESCE(output_tokens, 0)
                ) AS maximum_tokens_per_request,
                MIN(input_tokens) AS minimum_input_tokens,
                MAX(input_tokens) AS maximum_input_tokens,
                MIN(output_tokens) AS minimum_output_tokens,
                MAX(output_tokens) AS maximum_output_tokens,
                COALESCE(
                    SUM(
                        COALESCE(input_tokens, 0)::NUMERIC
                        * :input_rate / 1000000
                        +
                        COALESCE(output_tokens, 0)::NUMERIC
                        * :output_rate / 1000000
                    ), 0
                ) AS total_estimated_cost_usd
            FROM ai_insights
        """),
        {
            "input_rate": INPUT_PRICE_PER_MILLION,
            "output_rate": OUTPUT_PRICE_PER_MILLION,
        },
    ).mappings().one()

    total_cost = float(row["total_estimated_cost_usd"] or 0)
    remaining = current_starting_credit - total_cost

    return {
        "total_requests": int(row["total_requests"] or 0),
        "total_input_tokens": int(row["total_input_tokens"] or 0),
        "total_output_tokens": int(row["total_output_tokens"] or 0),
        "total_tokens": int(row["total_tokens"] or 0),
        "minimum_tokens_per_request": row["minimum_tokens_per_request"],
        "maximum_tokens_per_request": row["maximum_tokens_per_request"],
        "minimum_input_tokens": row["minimum_input_tokens"],
        "maximum_input_tokens": row["maximum_input_tokens"],
        "minimum_output_tokens": row["minimum_output_tokens"],
        "maximum_output_tokens": row["maximum_output_tokens"],
        "maximum_output_token_limit": CLAUDE_MAX_OUTPUT_TOKENS,
        "starting_credit_usd": round(current_starting_credit, 4),
        "estimated_credit_used_usd": round(total_cost, 8),
        "estimated_credit_remaining_usd": round(max(0.0, remaining), 8),
        "estimated_over_budget_usd": round(max(0.0, -remaining), 8),
        "currency": "USD",
        "note": USAGE_NOTE,
    }


def save_ai_usage_summary(connection) -> dict:
    """Refresh the single-row AI usage summary."""
    connection.execute(
        text("""
            CREATE TABLE IF NOT EXISTS ai_usage_summary (
                summary_id INTEGER PRIMARY KEY CHECK (summary_id = 1),
                total_requests BIGINT NOT NULL DEFAULT 0,
                total_input_tokens BIGINT NOT NULL DEFAULT 0,
                total_output_tokens BIGINT NOT NULL DEFAULT 0,
                total_tokens BIGINT NOT NULL DEFAULT 0,
                minimum_tokens_per_request BIGINT,
                maximum_tokens_per_request BIGINT,
                minimum_input_tokens BIGINT,
                maximum_input_tokens BIGINT,
                minimum_output_tokens BIGINT,
                maximum_output_tokens BIGINT,
                maximum_output_token_limit INTEGER NOT NULL DEFAULT 1200,
                starting_credit_usd NUMERIC(14, 8) NOT NULL DEFAULT 5.00,
                estimated_credit_used_usd NUMERIC(14, 8) NOT NULL DEFAULT 0,
                estimated_credit_remaining_usd NUMERIC(14, 8) NOT NULL DEFAULT 5.00,
                estimated_over_budget_usd NUMERIC(14, 8) NOT NULL DEFAULT 0,
                currency VARCHAR(10) NOT NULL DEFAULT 'USD',
                note TEXT,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
    )

    usage = get_ai_usage_data(connection)

    connection.execute(
        text("""
            INSERT INTO ai_usage_summary (
                summary_id, total_requests,
                total_input_tokens, total_output_tokens, total_tokens,
                minimum_tokens_per_request, maximum_tokens_per_request,
                minimum_input_tokens, maximum_input_tokens,
                minimum_output_tokens, maximum_output_tokens,
                maximum_output_token_limit, starting_credit_usd,
                estimated_credit_used_usd, estimated_credit_remaining_usd,
                estimated_over_budget_usd, currency, note, updated_at
            )
            VALUES (
                1, :total_requests,
                :total_input_tokens, :total_output_tokens, :total_tokens,
                :minimum_tokens_per_request, :maximum_tokens_per_request,
                :minimum_input_tokens, :maximum_input_tokens,
                :minimum_output_tokens, :maximum_output_tokens,
                :maximum_output_token_limit, :starting_credit_usd,
                :estimated_credit_used_usd, :estimated_credit_remaining_usd,
                :estimated_over_budget_usd, :currency, :note,
                CURRENT_TIMESTAMP
            )
            ON CONFLICT (summary_id) DO UPDATE SET
                total_requests = EXCLUDED.total_requests,
                total_input_tokens = EXCLUDED.total_input_tokens,
                total_output_tokens = EXCLUDED.total_output_tokens,
                total_tokens = EXCLUDED.total_tokens,
                minimum_tokens_per_request = EXCLUDED.minimum_tokens_per_request,
                maximum_tokens_per_request = EXCLUDED.maximum_tokens_per_request,
                minimum_input_tokens = EXCLUDED.minimum_input_tokens,
                maximum_input_tokens = EXCLUDED.maximum_input_tokens,
                minimum_output_tokens = EXCLUDED.minimum_output_tokens,
                maximum_output_tokens = EXCLUDED.maximum_output_tokens,
                maximum_output_token_limit = EXCLUDED.maximum_output_token_limit,
                starting_credit_usd = EXCLUDED.starting_credit_usd,
                estimated_credit_used_usd = EXCLUDED.estimated_credit_used_usd,
                estimated_credit_remaining_usd = EXCLUDED.estimated_credit_remaining_usd,
                estimated_over_budget_usd = EXCLUDED.estimated_over_budget_usd,
                currency = EXCLUDED.currency,
                note = EXCLUDED.note,
                updated_at = CURRENT_TIMESTAMP
        """),
        usage,
    )

    return usage


def create_pipeline_run(filename: str) -> int:
    """Create a run record before processing starts."""
    with engine.begin() as connection:
        result = connection.execute(
            text("""
                INSERT INTO pipeline_runs (
                    filename, status, retry_attempts, started_at, created_at
                )
                VALUES (
                    :filename, 'running', 0,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                RETURNING run_id
            """),
            {"filename": filename},
        )
        return result.scalar_one()


def update_pipeline_failure(
    run_id: int,
    failed_step: str,
    error_message: str,
    retry_attempts: int,
    start_time: float,
) -> None:
    """Record a failed run without hiding the original error."""
    try:
        with engine.begin() as connection:
            connection.execute(
                text("""
                    UPDATE pipeline_runs
                    SET status = 'failed',
                        failed_step = :failed_step,
                        error_message = :error_message,
                        retry_attempts = :retry_attempts,
                        duration_seconds = :duration_seconds,
                        completed_at = CURRENT_TIMESTAMP
                    WHERE run_id = :run_id
                """),
                {
                    "run_id": run_id,
                    "failed_step": failed_step,
                    "error_message": error_message[:4000],
                    "retry_attempts": retry_attempts,
                    "duration_seconds": round(
                        time.perf_counter() - start_time, 3
                    ),
                },
            )
    except SQLAlchemyError as exc:
        # The original failure remains the primary error.
        print(
            f"Could not update failed run {run_id}: "
            f"{type(exc).__name__}"
        )


def save_pipeline_results(
    run_id: int,
    filename: str,
    result: dict,
    anomalies: list,
    ai_result,
    start_time: float,
    retry_attempts: int,
) -> dict:
    """
    Save a run's output in one transaction.
    Failed transactions are retried, preventing partial saved results.
    """
    with engine.begin() as connection:
        for row_number, record in enumerate(
            result["cleaned_data"], start=1
        ):
            connection.execute(
                text("""
                    INSERT INTO processed_records (
                        run_id, row_number, record_data
                    )
                    VALUES (
                        :run_id, :row_number, CAST(:record_data AS JSONB)
                    )
                """),
                {
                    "run_id": run_id,
                    "row_number": row_number,
                    "record_data": json.dumps(record),
                },
            )

        for anomaly in anomalies:
            connection.execute(
                text("""
                    INSERT INTO anomaly_logs (
                        run_id, anomaly_type, severity, message
                    )
                    VALUES (
                        :run_id, :anomaly_type, :severity, :message
                    )
                """),
                {
                    "run_id": run_id,
                    "anomaly_type": anomaly["type"],
                    "severity": anomaly["severity"],
                    "message": anomaly["message"],
                },
            )

        if ai_result is not None:
            connection.execute(
                text("""
                    INSERT INTO ai_insights (
                        run_id, model, analysis, input_tokens,
                        output_tokens, total_tokens, estimated_cost_usd
                    )
                    VALUES (
                        :run_id, :model, :analysis, :input_tokens,
                        :output_tokens, :total_tokens, :estimated_cost_usd
                    )
                """),
                {
                    "run_id": run_id,
                    "model": ai_result["model"],
                    "analysis": ai_result["analysis"],
                    "input_tokens": ai_result["input_tokens"],
                    "output_tokens": ai_result["output_tokens"],
                    "total_tokens": ai_result["total_tokens"],
                    "estimated_cost_usd": ai_result["estimated_cost_usd"],
                },
            )

        duration = round(time.perf_counter() - start_time, 3)

        connection.execute(
            text("""
                UPDATE pipeline_runs
                SET status = 'completed',
                    original_rows = :original_rows,
                    cleaned_rows = :cleaned_rows,
                    rejected_rows = :rejected_rows,
                    duration_seconds = :duration_seconds,
                    retry_attempts = :retry_attempts,
                    failed_step = NULL,
                    error_message = NULL,
                    completed_at = CURRENT_TIMESTAMP
                WHERE run_id = :run_id
            """),
            {
                "run_id": run_id,
                "original_rows": result["original_rows"],
                "cleaned_rows": result["cleaned_rows"],
                "rejected_rows": result["rejected_rows"],
                "duration_seconds": duration,
                "retry_attempts": retry_attempts,
            },
        )

        usage = save_ai_usage_summary(connection)

    return usage


@app.get("/")
def home():
    return {"message": "Welcome to FlowOps AI", "status": "running"}


@app.get("/api/health")
def health_check():
    return {"status": "healthy", "application": "FlowOps AI"}


@app.get("/api/database/health")
def database_health():
    try:
        return test_connection()
    except (SQLAlchemyError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Database connection failed. Check PostgreSQL settings.",
        ) from exc


@app.post("/api/etl/analyze")
async def analyze_file(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a CSV file.")

    try:
        file_content = await file.read()
        report = analyze_csv(file_content)
        return {
            "filename": file.filename,
            "status": "analysis_completed",
            "report": report,
        }
    except (ValueError, pd.errors.ParserError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not analyze CSV: {str(exc)}",
        ) from exc
    finally:
        await file.close()


@app.post("/api/etl/process")
async def process_file(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a CSV file.")

    start_time = time.perf_counter()
    run_id = None
    current_step = "read_csv"
    retry_attempts = 0

    try:
        file_content = await file.read()

        # Create the run before processing so failures are recorded too.
        run_id = create_pipeline_run(file.filename)

        current_step = "validate_and_clean_csv"
        result = process_csv(file_content)

        current_step = "detect_anomalies"
        duration_so_far = time.perf_counter() - start_time
        anomalies = detect_anomalies(result, duration_so_far)

        current_step = "claude_analysis"
        ai_result = None
        ai_error = None

        ai_report = {
            key: value
            for key, value in result.items()
            if key != "cleaned_data"
        }

        try:
            ai_result = analyze_etl_report(ai_report, anomalies)
            ai_result.update(
                calculate_ai_cost(
                    int(ai_result["input_tokens"]),
                    int(ai_result["output_tokens"]),
                )
            )
        except Exception as exc:
            # Claude is optional; ETL may still complete successfully.
            print(
                "Claude AI analysis failed:",
                type(exc).__name__,
                str(exc),
            )
            ai_error = (
                "Claude analysis failed. Check the backend terminal, "
                "API key, model configuration, and API account."
            )

        current_step = "database_save"
        usage = None
        last_error = None

        for attempt in range(MAX_DATABASE_ATTEMPTS):
            try:
                usage = save_pipeline_results(
                    run_id=run_id,
                    filename=file.filename,
                    result=result,
                    anomalies=anomalies,
                    ai_result=ai_result,
                    start_time=start_time,
                    retry_attempts=retry_attempts,
                )
                break
            except SQLAlchemyError as exc:
                last_error = exc
                if attempt + 1 >= MAX_DATABASE_ATTEMPTS:
                    break

                retry_attempts += 1
                print(
                    f"Database save failed for run {run_id}. "
                    f"Retry {retry_attempts}/{MAX_DATABASE_ATTEMPTS - 1}."
                )
                sleep(0.5 * (2 ** attempt))

        if usage is None:
            message = (
                f"Database save failed after {MAX_DATABASE_ATTEMPTS} "
                f"attempts: {type(last_error).__name__}"
            )
            update_pipeline_failure(
                run_id, current_step, message,
                retry_attempts, start_time,
            )
            raise HTTPException(status_code=500, detail=message)

        report = {
            key: value
            for key, value in result.items()
            if key != "cleaned_data"
        }

        if ai_result is not None:
            ai_result["estimated_credit_remaining_usd"] = usage[
                "estimated_credit_remaining_usd"
            ]
            ai_result["estimated_credit_used_usd"] = usage[
                "estimated_credit_used_usd"
            ]

        return {
            "filename": file.filename,
            "status": "processing_completed",
            "run_id": run_id,
            "duration_seconds": round(time.perf_counter() - start_time, 3),
            "retry_attempts": retry_attempts,
            "report": report,
            "cleaned_data_preview": result["cleaned_data"][:5],
            "anomaly_count": len(anomalies),
            "anomalies": anomalies,
            "ai_insight": ai_result,
            "ai_error": ai_error,
            "ai_usage": usage,
        }

    except HTTPException:
        raise
    except (ValueError, pd.errors.ParserError, UnicodeDecodeError) as exc:
        if run_id is not None:
            update_pipeline_failure(
                run_id, current_step, str(exc), retry_attempts, start_time
            )
        raise HTTPException(
            status_code=400,
            detail=f"CSV processing failed: {str(exc)}",
        ) from exc
    except SQLAlchemyError as exc:
        if run_id is not None:
            update_pipeline_failure(
                run_id,
                current_step,
                f"Database error: {type(exc).__name__}",
                retry_attempts,
                start_time,
            )
        raise HTTPException(
            status_code=500,
            detail="Database operation failed. Check the backend terminal.",
        ) from exc
    except Exception as exc:
        if run_id is not None:
            update_pipeline_failure(
                run_id,
                current_step,
                f"{type(exc).__name__}: {str(exc)}",
                retry_attempts,
                start_time,
            )
        raise HTTPException(
            status_code=500,
            detail="Pipeline failed. Check the backend terminal for details.",
        ) from exc
    finally:
        await file.close()


@app.get("/api/pipelines/runs")
def get_pipeline_runs():
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text("""
                    SELECT
                        run_id, filename, status,
                        original_rows, cleaned_rows, rejected_rows,
                        duration_seconds, error_message,
                        retry_attempts, started_at, completed_at,
                        failed_step, created_at
                    FROM pipeline_runs
                    ORDER BY run_id DESC
                """)
            ).mappings().all()

        runs = []
        for row in rows:
            run = dict(row)
            run["duration_seconds"] = float(run["duration_seconds"] or 0)
            for field in ("created_at", "started_at", "completed_at"):
                if run.get(field):
                    run[field] = run[field].isoformat()
            runs.append(run)

        return {"total_runs": len(runs), "runs": runs}
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve pipeline history.",
        ) from exc


@app.get("/api/pipelines/stats")
def get_pipeline_stats():
    try:
        with engine.connect() as connection:
            row = connection.execute(
                text("""
                    SELECT
                        COUNT(*) AS total_runs,
                        COUNT(*) FILTER (
                            WHERE status = 'completed'
                        ) AS successful_runs,
                        COUNT(*) FILTER (
                            WHERE status = 'failed'
                        ) AS failed_runs,
                        COUNT(*) FILTER (
                            WHERE status = 'running'
                        ) AS running_runs,
                        COALESCE(SUM(original_rows), 0) AS total_rows_processed,
                        COALESCE(AVG(duration_seconds), 0) AS average_duration_seconds,
                        COALESCE(SUM(retry_attempts), 0) AS total_retries
                    FROM pipeline_runs
                """)
            ).mappings().one()

        return {
            "total_runs": row["total_runs"],
            "successful_runs": row["successful_runs"],
            "failed_runs": row["failed_runs"],
            "running_runs": row["running_runs"],
            "total_rows_processed": row["total_rows_processed"],
            "average_duration_seconds": round(
                float(row["average_duration_seconds"] or 0), 3
            ),
            "total_retries": row["total_retries"],
        }
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve pipeline statistics.",
        ) from exc


@app.get("/api/anomalies")
def get_anomalies():
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text("""
                    SELECT anomaly_id, run_id, anomaly_type,
                           severity, message, created_at
                    FROM anomaly_logs
                    ORDER BY anomaly_id DESC
                """)
            ).mappings().all()

        anomalies = []
        for row in rows:
            item = dict(row)
            if item["created_at"]:
                item["created_at"] = item["created_at"].isoformat()
            anomalies.append(item)

        return {"total_anomalies": len(anomalies), "anomalies": anomalies}
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve anomaly history.",
        ) from exc


@app.get("/api/ai/insights")
def get_ai_insights():
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text("""
                    SELECT insight_id, run_id, model, analysis,
                           input_tokens, output_tokens, total_tokens,
                           estimated_cost_usd, created_at
                    FROM ai_insights
                    ORDER BY insight_id DESC
                """)
            ).mappings().all()

        insights = []
        for row in rows:
            item = dict(row)
            item["input_tokens"] = int(item["input_tokens"] or 0)
            item["output_tokens"] = int(item["output_tokens"] or 0)
            item["total_tokens"] = (
                item["input_tokens"] + item["output_tokens"]
            )
            item["estimated_cost_usd"] = float(
                item["estimated_cost_usd"] or 0
            )
            if item["created_at"]:
                item["created_at"] = item["created_at"].isoformat()
            insights.append(item)

        return {
            "total_insights": len(insights),
            "total_input_tokens": sum(x["input_tokens"] for x in insights),
            "total_output_tokens": sum(x["output_tokens"] for x in insights),
            "total_tokens": sum(x["total_tokens"] for x in insights),
            "total_estimated_cost_usd": round(
                sum(x["estimated_cost_usd"] for x in insights), 8
            ),
            "insights": insights,
        }
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve AI insights.",
        ) from exc


@app.get("/api/ai/usage")
def get_ai_usage():
    try:
        with engine.begin() as connection:
            return save_ai_usage_summary(connection)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve AI usage.",
        ) from exc


class BudgetUpdateRequest(BaseModel):
    budget: float = Field(..., gt=0.0)


@app.post("/api/ai/budget")
def update_ai_budget(payload: BudgetUpdateRequest):
    """Update configured budget limit in PostgreSQL and recalculate usage."""
    try:
        with engine.begin() as connection:
            connection.execute(
                text("""
                    UPDATE ai_usage_summary
                    SET starting_credit_usd = :budget,
                        estimated_credit_remaining_usd = GREATEST(0, :budget - estimated_credit_used_usd),
                        estimated_over_budget_usd = GREATEST(0, estimated_credit_used_usd - :budget),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE summary_id = 1
                """),
                {"budget": payload.budget}
            )
            return get_ai_usage_data(connection)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# -------------------------------------------------------------
# FLOWOPS BOT CONVERSATIONAL COPILOT
# -------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=2000)
    history: Optional[List[ChatMessage]] = []
    conversation_id: Optional[str] = None
    mode: Optional[str] = None  # "auto", "chat", "root_cause", "quality", "sql", "investigation", "report"
    run_id: Optional[int] = None
    report_format: Optional[str] = "pdf"


class ChatSource(BaseModel):
    type: str
    id: Optional[int] = None
    label: str


class ChatResponse(BaseModel):
    answer: str
    conversation_id: Optional[str] = None
    sources: List[ChatSource] = []
    model: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    estimated_cost_usd: Optional[float] = None
    mode: Optional[str] = None
    sql_data: Optional[Dict[str, Any]] = None
    report_data: Optional[Dict[str, Any]] = None


def gather_operational_context(message: str) -> tuple[dict, list]:
    """Retrieve actual operational data from PostgreSQL based on message keywords and run IDs."""
    context: Dict[str, Any] = {}
    sources: List[Dict[str, Any]] = []

    # Check for specific Run ID pattern, e.g. "run 10", "run #10", "#10", "run_id 10"
    run_matches = re.findall(r'(?:run|id|#)\s*(\d+)', message, re.IGNORECASE)
    if not run_matches and re.search(r'\b\d+\b', message):
        run_matches = re.findall(r'\b(\d+)\b', message)

    with engine.connect() as connection:
        # Check specific run if mentioned
        if run_matches:
            target_id = int(run_matches[0])
            run_row = connection.execute(
                text("""
                    SELECT run_id, filename, status, original_rows, cleaned_rows,
                           rejected_rows, duration_seconds, error_message, retry_attempts,
                           started_at, completed_at, failed_step, created_at
                    FROM pipeline_runs
                    WHERE run_id = :target_id
                """),
                {"target_id": target_id}
            ).mappings().first()

            if run_row:
                run_dict = dict(run_row)
                for f in ("created_at", "started_at", "completed_at"):
                    if run_dict.get(f):
                        run_dict[f] = run_dict[f].isoformat()
                run_dict["duration_seconds"] = float(run_dict["duration_seconds"] or 0)

                # Fetch anomalies for this run
                anom_rows = connection.execute(
                    text("""
                        SELECT anomaly_id, anomaly_type, severity, message, created_at
                        FROM anomaly_logs
                        WHERE run_id = :target_id
                        ORDER BY anomaly_id ASC
                    """),
                    {"target_id": target_id}
                ).mappings().all()
                anoms = [dict(a) for a in anom_rows]
                for a in anoms:
                    if a.get("created_at"):
                        a["created_at"] = a["created_at"].isoformat()

                context["requested_run"] = {
                    "exists": True,
                    "details": run_dict,
                    "anomalies": anoms,
                }
                sources.append({
                    "type": "Pipeline Run",
                    "id": target_id,
                    "label": f"Run #{target_id} ({run_dict['filename']} - {run_dict['status']})"
                })
                if anoms:
                    sources.append({
                        "type": "Data Quality / Anomaly Log",
                        "id": target_id,
                        "label": f"Run #{target_id} Anomaly Records ({len(anoms)} detected)"
                    })
            else:
                context["requested_run"] = {
                    "run_id": target_id,
                    "exists": False,
                    "note": f"Run #{target_id} does not exist in the database. Please verify the run ID."
                }

        # Latest run
        latest_row = connection.execute(
            text("""
                SELECT run_id, filename, status, original_rows, cleaned_rows,
                       rejected_rows, duration_seconds, error_message, retry_attempts,
                       started_at, completed_at, failed_step, created_at
                FROM pipeline_runs
                ORDER BY run_id DESC
                LIMIT 1
            """)
        ).mappings().first()

        if latest_row:
            latest_dict = dict(latest_row)
            for f in ("created_at", "started_at", "completed_at"):
                if latest_dict.get(f):
                    latest_dict[f] = latest_dict[f].isoformat()
            latest_dict["duration_seconds"] = float(latest_dict["duration_seconds"] or 0)

            # Anomalies for latest run
            lat_anoms = connection.execute(
                text("""
                    SELECT anomaly_id, anomaly_type, severity, message
                    FROM anomaly_logs
                    WHERE run_id = :run_id
                    ORDER BY anomaly_id ASC
                """),
                {"run_id": latest_dict["run_id"]}
            ).mappings().all()

            context["latest_pipeline_run"] = {
                "run": latest_dict,
                "anomalies": [dict(a) for a in lat_anoms]
            }
            if not run_matches or ("latest" in message.lower()):
                sources.append({
                    "type": "Pipeline Run",
                    "id": latest_dict["run_id"],
                    "label": f"Latest Run #{latest_dict['run_id']} ({latest_dict['filename']})"
                })

        # Recent 5 runs
        recent_rows = connection.execute(
            text("""
                SELECT run_id, filename, status, original_rows, cleaned_rows,
                       rejected_rows, duration_seconds, error_message
                FROM pipeline_runs
                ORDER BY run_id DESC
                LIMIT 5
            """)
        ).mappings().all()
        context["recent_runs_overview"] = [dict(r) for r in recent_rows]

        # Failed runs
        failed_rows = connection.execute(
            text("""
                SELECT run_id, filename, status, error_message, failed_step, created_at
                FROM pipeline_runs
                WHERE status = 'failed'
                ORDER BY run_id DESC
                LIMIT 5
            """)
        ).mappings().all()
        if failed_rows:
            f_runs = [dict(r) for r in failed_rows]
            for r in f_runs:
                if r.get("created_at"):
                    r["created_at"] = r["created_at"].isoformat()
            context["recent_failed_runs"] = f_runs
        else:
            context["recent_failed_runs_note"] = "No failed runs found in the database. All recorded runs completed successfully."

        # Aggregate Pipeline Stats
        stats_row = connection.execute(
            text("""
                SELECT
                    COUNT(*) AS total_runs,
                    COUNT(*) FILTER (WHERE status = 'completed') AS successful_runs,
                    COUNT(*) FILTER (WHERE status = 'failed') AS failed_runs,
                    COALESCE(SUM(original_rows), 0) AS total_rows_processed,
                    COALESCE(SUM(rejected_rows), 0) AS total_rows_rejected,
                    COALESCE(AVG(duration_seconds), 0) AS average_duration_seconds,
                    COALESCE(SUM(retry_attempts), 0) AS total_retries
                FROM pipeline_runs
            """)
        ).mappings().first()
        if stats_row:
            s_dict = dict(stats_row)
            s_dict["average_duration_seconds"] = round(float(s_dict["average_duration_seconds"] or 0), 2)
            context["pipeline_aggregate_stats"] = s_dict

        # Anomalies breakdown and recent anomalies
        anom_stats = connection.execute(
            text("""
                SELECT anomaly_type, COUNT(*) AS count
                FROM anomaly_logs
                GROUP BY anomaly_type
                ORDER BY count DESC
            """)
        ).mappings().all()
        context["anomaly_distribution_by_type"] = [dict(a) for a in anom_stats]

        recent_anom_rows = connection.execute(
            text("""
                SELECT anomaly_id, run_id, anomaly_type, severity, message, created_at
                FROM anomaly_logs
                ORDER BY anomaly_id DESC
                LIMIT 5
            """)
        ).mappings().all()
        r_anoms = [dict(a) for a in recent_anom_rows]
        for a in r_anoms:
            if a.get("created_at"):
                a["created_at"] = a["created_at"].isoformat()
        context["recent_anomaly_records"] = r_anoms

        # Latest AI Insight
        insight_row = connection.execute(
            text("""
                SELECT insight_id, run_id, model, analysis, total_tokens, estimated_cost_usd, created_at
                FROM ai_insights
                ORDER BY insight_id DESC
                LIMIT 1
            """)
        ).mappings().first()
        if insight_row:
            i_dict = dict(insight_row)
            if i_dict.get("created_at"):
                i_dict["created_at"] = i_dict["created_at"].isoformat()
            if i_dict.get("analysis") and len(i_dict["analysis"]) > 600:
                i_dict["analysis_excerpt"] = i_dict["analysis"][:600] + "..."
                del i_dict["analysis"]
            context["latest_ai_insight"] = i_dict
            if "insight" in message.lower():
                sources.append({
                    "type": "AI Insight",
                    "id": i_dict["insight_id"],
                    "label": f"Insight #{i_dict['insight_id']} for Run #{i_dict['run_id']}"
                })

        context["system_status"] = {
            "fastapi": "healthy",
            "postgresql": "healthy"
        }

    # Deduplicate sources by (type, id, label)
    unique_sources = []
    seen = set()
    for s in sources:
        key = (s.get("type"), s.get("id"), s.get("label"))
        if key not in seen:
            seen.add(key)
            unique_sources.append(s)

    return context, unique_sources


def record_copilot_usage(
    model: str,
    analysis_text: str,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
    estimated_cost_usd: float,
    run_id: Optional[int] = None
):
    """Safely logs Claude tokens to ai_insights and updates ai_usage_summary."""
    target_run_id = run_id
    if target_run_id is None:
        try:
            with engine.connect() as conn:
                fallback_row = conn.execute(
                    text("SELECT run_id FROM pipeline_runs ORDER BY run_id DESC LIMIT 1")
                ).fetchone()
                if fallback_row:
                    target_run_id = fallback_row[0]
        except Exception:
            pass

    if target_run_id is not None:
        try:
            with engine.begin() as conn:
                conn.execute(
                    text("""
                        INSERT INTO ai_insights (
                            run_id, model, analysis, input_tokens,
                            output_tokens, total_tokens, estimated_cost_usd
                        )
                        VALUES (
                            :run_id, :model, :analysis, :input_tokens,
                            :output_tokens, :total_tokens, :estimated_cost_usd
                        )
                    """),
                    {
                        "run_id": target_run_id,
                        "model": model or "claude-sonnet-4-6",
                        "analysis": analysis_text[:4000],
                        "input_tokens": input_tokens or 0,
                        "output_tokens": output_tokens or 0,
                        "total_tokens": total_tokens or 0,
                        "estimated_cost_usd": estimated_cost_usd or 0.0,
                    },
                )
                save_ai_usage_summary(conn)
        except Exception as db_err:
            print(f"Warning: could not record copilot tokens to database: {db_err}")


@app.post("/api/ai/chat", response_model=ChatResponse)
def chat_ai(req: ChatRequest):
    """FlowOps Bot conversational endpoint answering questions using real operational records with full copilot routing."""
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    if len(message) > 2000:
        raise HTTPException(
            status_code=400,
            detail="Message exceeds maximum length of 2000 characters."
        )

    mode = (req.mode or "auto").lower()
    conv_id = req.conversation_id or f"conv_{int(time.time() * 1000)}"

    try:
        # 1. Natural Language SQL
        if mode == "sql" or (mode == "auto" and (
            re.match(r"^\s*(?:run\s+sql|sql\s+query|show\s+(?:the\s+)?(?:last|top|\d+)\s+runs|query\s+database)\b", message, re.IGNORECASE) or
            ("select " in message.lower() and " from " in message.lower())
        )):
            sql_res = process_natural_language_sql(message)
            record_copilot_usage(
                sql_res.get("model", "claude-sonnet-4-6"),
                f"[Natural Language SQL: {message}]\n\n{sql_res.get('answer', '')}",
                sql_res.get("input_tokens", 0),
                sql_res.get("output_tokens", 0),
                sql_res.get("total_tokens", 0),
                sql_res.get("estimated_cost_usd", 0.0)
            )
            sql_data = {
                "sql": sql_res.get("sql", ""),
                "columns": sql_res.get("columns", []),
                "rows": sql_res.get("rows", []),
                "row_count": sql_res.get("row_count", 0),
                "execution_duration_ms": sql_res.get("execution_duration_ms", 0),
            }
            return {
                "answer": sql_res.get("answer", ""),
                "conversation_id": conv_id,
                "sources": [{"type": "Safe SQL Execution", "id": None, "label": f"{sql_res.get('row_count', 0)} rows returned"}],
                "model": sql_res.get("model"),
                "input_tokens": sql_res.get("input_tokens"),
                "output_tokens": sql_res.get("output_tokens"),
                "total_tokens": sql_res.get("total_tokens"),
                "estimated_cost_usd": sql_res.get("estimated_cost_usd"),
                "mode": "sql",
                "sql_data": sql_data
            }

        # 2. Root Cause Analysis
        if mode == "root_cause" or (mode == "auto" and (
            "root cause" in message.lower() or
            re.search(r"\bwhy\b.*\bfail", message, re.IGNORECASE) or
            "what caused" in message.lower() or
            "how can i fix it" in message.lower()
        )):
            rca_res = run_root_cause_analysis(run_id=req.run_id, prompt=message)
            record_copilot_usage(
                rca_res.get("model", "claude-sonnet-4-6"),
                f"[Root Cause Analysis: Run #{rca_res.get('run_id')}]\n\n{rca_res.get('answer', '')}",
                rca_res.get("input_tokens", 0),
                rca_res.get("output_tokens", 0),
                rca_res.get("total_tokens", 0),
                rca_res.get("estimated_cost_usd", 0.0),
                run_id=rca_res.get("run_id")
            )
            return {
                "answer": rca_res.get("answer", ""),
                "conversation_id": conv_id,
                "sources": rca_res.get("sources", []),
                "model": rca_res.get("model"),
                "input_tokens": rca_res.get("input_tokens"),
                "output_tokens": rca_res.get("output_tokens"),
                "total_tokens": rca_res.get("total_tokens"),
                "estimated_cost_usd": rca_res.get("estimated_cost_usd"),
                "mode": "root_cause"
            }

        # 3. Data Quality Investigation
        if mode == "quality" or (mode == "auto" and (
            ("data quality" in message.lower() and any(w in message.lower() for w in ["score", "low", "investigate", "report", "rule", "issue", "problem", "explain", "fix"])) or
            "why were records rejected" in message.lower() or
            "why were some records rejected" in message.lower() or
            "validation rule" in message.lower()
        )):
            dq_res = investigate_data_quality(run_id=req.run_id, prompt=message)
            record_copilot_usage(
                dq_res.get("model", "claude-sonnet-4-6"),
                f"[Data Quality Investigation: Run #{dq_res.get('run_id')}]\n\n{dq_res.get('answer', '')}",
                dq_res.get("input_tokens", 0),
                dq_res.get("output_tokens", 0),
                dq_res.get("total_tokens", 0),
                dq_res.get("estimated_cost_usd", 0.0),
                run_id=dq_res.get("run_id")
            )
            return {
                "answer": dq_res.get("answer", ""),
                "conversation_id": conv_id,
                "sources": dq_res.get("sources", []),
                "model": dq_res.get("model"),
                "input_tokens": dq_res.get("input_tokens"),
                "output_tokens": dq_res.get("output_tokens"),
                "total_tokens": dq_res.get("total_tokens"),
                "estimated_cost_usd": dq_res.get("estimated_cost_usd"),
                "mode": "quality"
            }

        # 4. Multi-Step Investigation Mode
        if mode == "investigation" or (mode == "auto" and (
            "multi-step" in message.lower() or
            "deep investigation" in message.lower() or
            ("connected to" in message.lower() and "anomal" in message.lower()) or
            ("investigate" in message.lower() and "and" in message.lower() and ("reject" in message.lower() or "anomal" in message.lower()))
        )):
            inv_res = run_multi_step_investigation(prompt=message)
            record_copilot_usage(
                inv_res.get("model", "claude-sonnet-4-6"),
                f"[Multi-Step Investigation: {message}]\n\n{inv_res.get('answer', '')}",
                inv_res.get("input_tokens", 0),
                inv_res.get("output_tokens", 0),
                inv_res.get("total_tokens", 0),
                inv_res.get("estimated_cost_usd", 0.0)
            )
            return {
                "answer": inv_res.get("answer", ""),
                "conversation_id": conv_id,
                "sources": inv_res.get("sources", []),
                "model": inv_res.get("model"),
                "input_tokens": inv_res.get("input_tokens"),
                "output_tokens": inv_res.get("output_tokens"),
                "total_tokens": inv_res.get("total_tokens"),
                "estimated_cost_usd": inv_res.get("estimated_cost_usd"),
                "mode": "investigation"
            }

        # 5. Operational Report Generator
        if mode == "report" or (mode == "auto" and (
            re.search(r"\b(?:generate|create|download|export)\s+(?:an?\s+)?(?:operational\s+)?report\b", message, re.IGNORECASE) or
            re.search(r"\breport\s+for\s+(?:my\s+)?(?:latest|recent|failed)\b", message, re.IGNORECASE)
        )):
            rep_fmt = (req.report_format or "pdf").lower()
            if "csv" in message.lower():
                rep_fmt = "csv"
            elif "json" in message.lower():
                rep_fmt = "json"
            rep_res = generate_operational_report(report_type="operational", format=rep_fmt)
            answer_text = (
                f"I have compiled and generated your operational report: **{rep_res['title']}** ({rep_fmt.upper()}).\n\n"
                f"**Executive Summary:**\n{rep_res['summary']}\n\n"
                f"You can download the full report file below."
            )
            return {
                "answer": answer_text,
                "conversation_id": conv_id,
                "sources": [{"type": "Operational Report", "id": None, "label": f"{rep_res['report_id']} ({rep_fmt.upper()})"}],
                "model": "claude-sonnet-4-6",
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "estimated_cost_usd": 0.0,
                "mode": "report",
                "report_data": rep_res
            }

        # 6. Default Context-Aware FlowOps Bot
        try:
            context, sources = gather_operational_context(message)
        except Exception as exc:
            context = {
                "database_error": f"Could not retrieve operational records: {str(exc)}",
                "system_status": {"database": "disconnected"}
            }
            sources = []

        history_dicts = [{"role": m.role, "content": m.content} for m in req.history or []]
        result = chat_with_flowops_bot(message, history_dicts, context)

        # Record AI token usage in database and refresh summary
        record_copilot_usage(
            result.get("model", "claude-sonnet-4-6"),
            f"[FlowOps Bot: {message}]\n\n{result['answer']}",
            result.get("input_tokens", 0),
            result.get("output_tokens", 0),
            result.get("total_tokens", 0),
            result.get("estimated_cost_usd", 0.0),
        )

        return {
            "answer": result["answer"],
            "conversation_id": conv_id,
            "sources": sources,
            "model": result.get("model"),
            "input_tokens": result.get("input_tokens"),
            "output_tokens": result.get("output_tokens"),
            "total_tokens": result.get("total_tokens"),
            "estimated_cost_usd": result.get("estimated_cost_usd"),
            "mode": "chat"
        }
    except Exception as exc:
        err_text = str(exc)
        if any(token in err_text.lower() for token in [
            "workspace api usage limits",
            "usage limits",
            "credit balance is too low",
            "insufficient_quota",
            "credit_balance_too_low",
            "regain access on",
            "reached your specified",
        ]):
            rapid_tester.provider_confirmed_zero = True
            rapid_tester.provider_confirmation_detail = (
                "Anthropic Provider confirmed limit reached: "
                "You have reached your specified workspace API usage limits. "
                "You will regain access on 2026-11-01 at 00:00 UTC. ($0.00 remaining spend)."
            )
            rapid_tester.status = "STOPPED_CREDIT_EXHAUSTED"
            raise HTTPException(
                status_code=429,
                detail=(
                    "Claude API Usage Limit Reached ($0.00 remaining): You have reached your specified Anthropic "
                    "workspace usage limit. Access will resume on 2026-11-01 at 00:00 UTC, or you can increase/remove "
                    "this limit in your Anthropic Console under Settings > Limits."
                )
            ) from exc

        raise HTTPException(
            status_code=500,
            detail=f"FlowOps Bot error: {err_text}"
        ) from exc


# -------------------------------------------------------------
# STANDALONE COPILOT & REPORTING REST ENDPOINTS
# -------------------------------------------------------------

@app.post("/api/ai/sql")
def execute_nl_sql(payload: Dict[str, Any]):
    """Safe Natural Language to SQL generation, validation, and read-only execution."""
    prompt = payload.get("query") or payload.get("message") or ""
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    result = process_natural_language_sql(prompt)
    record_copilot_usage(
        result.get("model", "claude-sonnet-4-6"),
        f"[Natural Language SQL: {prompt}]\n\n{result.get('answer', '')}",
        result.get("input_tokens", 0),
        result.get("output_tokens", 0),
        result.get("total_tokens", 0),
        result.get("estimated_cost_usd", 0.0)
    )
    return result


@app.post("/api/ai/root-cause")
def api_root_cause(payload: Dict[str, Any]):
    """Structured Root Cause Analysis for a pipeline run."""
    run_id = payload.get("run_id")
    prompt = payload.get("prompt") or payload.get("message") or ""
    result = run_root_cause_analysis(run_id=run_id, prompt=prompt)
    record_copilot_usage(
        result.get("model", "claude-sonnet-4-6"),
        f"[Root Cause Analysis: Run #{result.get('run_id')}]\n\n{result.get('answer', '')}",
        result.get("input_tokens", 0),
        result.get("output_tokens", 0),
        result.get("total_tokens", 0),
        result.get("estimated_cost_usd", 0.0),
        run_id=result.get("run_id")
    )
    return result


@app.post("/api/ai/quality-investigate")
def api_quality_investigate(payload: Dict[str, Any]):
    """Deep Data Quality Investigation based on real pipeline validation results."""
    run_id = payload.get("run_id")
    prompt = payload.get("prompt") or payload.get("message") or ""
    result = investigate_data_quality(run_id=run_id, prompt=prompt)
    record_copilot_usage(
        result.get("model", "claude-sonnet-4-6"),
        f"[Data Quality Investigation: Run #{result.get('run_id')}]\n\n{result.get('answer', '')}",
        result.get("input_tokens", 0),
        result.get("output_tokens", 0),
        result.get("total_tokens", 0),
        result.get("estimated_cost_usd", 0.0),
        run_id=result.get("run_id")
    )
    return result


@app.post("/api/ai/investigate")
def api_multi_step_investigate(payload: Dict[str, Any]):
    """Multi-Step Investigation orchestrating runs, quality findings, anomalies, and history."""
    prompt = payload.get("prompt") or payload.get("message") or ""
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="Investigation query cannot be empty.")
    result = run_multi_step_investigation(prompt=prompt)
    record_copilot_usage(
        result.get("model", "claude-sonnet-4-6"),
        f"[Multi-Step Investigation: {prompt}]\n\n{result.get('answer', '')}",
        result.get("input_tokens", 0),
        result.get("output_tokens", 0),
        result.get("total_tokens", 0),
        result.get("estimated_cost_usd", 0.0)
    )
    return result


@app.post("/api/ai/reports/generate")
def api_generate_report(payload: Dict[str, Any]):
    """Generate operational reports in CSV, JSON, or PDF."""
    report_type = payload.get("report_type") or "comprehensive"
    fmt = payload.get("format") or "pdf"
    title = payload.get("title")
    return generate_operational_report(report_type=report_type, format=fmt, custom_title=title)


@app.get("/api/ai/reports/download/{filename}")
def api_download_report(filename: str):
    """Safely stream generated operational reports or usage receipts."""
    safe_filename = os.path.basename(filename)
    if not re.match(r"^[a-zA-Z0-9_\-\.]+$", safe_filename):
        raise HTTPException(status_code=400, detail="Invalid filename format.")

    filepath = os.path.join(REPORTS_DIR, safe_filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Requested file not found.")

    media_type = "application/octet-stream"
    if safe_filename.endswith(".pdf"):
        media_type = "application/pdf"
    elif safe_filename.endswith(".csv"):
        media_type = "text/csv"
    elif safe_filename.endswith(".json"):
        media_type = "application/json"

    return FileResponse(
        filepath,
        media_type=media_type,
        filename=safe_filename,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'}
    )


@app.post("/api/ai/receipt/generate")
def api_generate_receipt(payload: Dict[str, Any]):
    """Generate an official Estimated API Usage & Cost Receipt from PostgreSQL records."""
    period = payload.get("period") or "30d"
    fmt = payload.get("format") or "pdf"
    start_date = payload.get("start_date")
    end_date = payload.get("end_date")
    budget_raw = payload.get("budget")
    try:
        budget = float(budget_raw) if budget_raw is not None else 5.0
    except (TypeError, ValueError):
        budget = 5.0
    return generate_usage_receipt(
        period=period, format=fmt, start_date=start_date, end_date=end_date, budget_limit=budget
    )


@app.on_event("startup")
async def app_startup_event():
    """Initialize persistent tables and spawn scheduler daemon."""
    try:
        init_scheduler_table()
        asyncio.create_task(scheduler_background_loop())
    except Exception as e:
        print(f"[Startup Warning] Scheduler init deferred: {e}")


@app.get("/api/schedules")
def api_get_schedules():
    """Retrieve all configured pipeline schedules."""
    try:
        return list_schedules()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/schedules/stats")
def api_get_schedule_stats():
    """Get high-level statistics and health of the pipeline scheduler."""
    try:
        return get_schedule_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/schedules")
def api_create_schedule(payload: Dict[str, Any]):
    """Create a new recurring pipeline schedule."""
    try:
        return create_schedule(payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/schedules/{schedule_id}")
def api_update_schedule(schedule_id: int, payload: Dict[str, Any]):
    """Update schedule properties such as active status, frequency, or target dataset."""
    try:
        return update_schedule(schedule_id, payload)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/schedules/{schedule_id}")
def api_delete_schedule(schedule_id: int):
    """Delete a pipeline schedule."""
    try:
        return delete_schedule(schedule_id)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/schedules/{schedule_id}/trigger")
def api_trigger_schedule(schedule_id: int):
    """Manually trigger an immediate execution of a scheduled pipeline."""
    try:
        return trigger_schedule(schedule_id)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




# -------------------------------------------------------------
# RAPID CLAUDE API CREDIT CONSUMPTION RUNNER (RAPID API TEST)
# -------------------------------------------------------------

class RapidTestStartRequest(BaseModel):
    concurrency: int = Field(default=3, ge=1, le=8)
    max_output_tokens: int = Field(default=3000, ge=500, le=4096)
    spending_ceiling: float = Field(default=3.20, gt=0.0)
    safety_margin: float = Field(default=0.05, ge=0.0)
    dry_run: bool = Field(default=False)
    task_mix: str = Field(default="all")


@app.get("/api/rapid-test/status")
def api_rapid_test_status():
    """Retrieve live status, telemetry metrics, and balances for the Rapid API Test runner."""
    try:
        return rapid_tester.get_status_payload()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rapid-test/prompts")
def api_rapid_test_prompts():
    """List available substantial FlowOps workload prompt templates."""
    return [
        {"id": t["id"], "title": t["title"], "category": t["category"]}
        for t in PROMPT_TEMPLATES
    ]


@app.post("/api/rapid-test/start")
async def api_rapid_test_start(req: RapidTestStartRequest):
    """Start high-throughput concurrency credit consumption loop."""
    try:
        result = await rapid_tester.start(
            concurrency=req.concurrency,
            max_output_tokens=req.max_output_tokens,
            spending_ceiling=req.spending_ceiling,
            safety_margin=req.safety_margin,
            dry_run=req.dry_run,
            task_mix=req.task_mix,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rapid-test/stop")
async def api_rapid_test_stop():
    """Signal the Rapid API Test runner to stop gracefully."""
    try:
        return await rapid_tester.stop()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rapid-test/reset")
async def api_rapid_test_reset():
    """Reset the Rapid API Test runner state back to IDLE."""
    try:
        return await rapid_tester.reset()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
