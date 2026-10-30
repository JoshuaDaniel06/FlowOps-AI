import csv
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional
from sqlalchemy import text
from anthropic import Anthropic

from database import engine

# ReportLab imports for formatted PDF generation
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

REPORTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports_cache")
os.makedirs(REPORTS_DIR, exist_ok=True)

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")


def sanitize_csv_cell(val: Any) -> Any:
    """Prevent CSV formula injection by prepending ' if value begins with dangerous characters."""
    if isinstance(val, str):
        if val and val[0] in ("=", "+", "-", "@", "\t", "\r"):
            return f"'{val}"
    return val


def parse_period_dates(period: str, start_date_str: Optional[str] = None, end_date_str: Optional[str] = None):
    """Parses standard reporting periods into ISO datetime bounds."""
    now = datetime.now(timezone.utc)
    if period == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = now
    elif period == "7d":
        start = now - timedelta(days=7)
        end = now
    elif period == "30d":
        start = now - timedelta(days=30)
        end = now
    elif period == "this_month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = now
    elif period == "custom" and start_date_str:
        try:
            start = datetime.fromisoformat(start_date_str.replace("Z", "+00:00"))
            if end_date_str:
                end = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))
            else:
                end = now
        except Exception:
            start = now - timedelta(days=30)
            end = now
    else:  # "all" or fallback
        start = datetime(2020, 1, 1, tzinfo=timezone.utc)
        end = now

    return start, end


def detect_insight_feature(analysis_text: str) -> str:
    """Helper to detect operation or feature category from recorded analysis text."""
    if not analysis_text:
        return "ETL Analysis"
    first_line = analysis_text.split("\n")[0].strip().lower()
    if "root cause" in first_line:
        return "Root Cause Analysis"
    if "data quality" in first_line or "quality audit" in first_line:
        return "Data Quality Investigator"
    if "sql" in first_line or "query" in first_line:
        return "Natural Language SQL"
    if "investigation" in first_line:
        return "Multi-Step Investigation"
    if "report" in first_line:
        return "Operational Report"
    if "flowops bot" in first_line:
        return "FlowOps Bot Chat"
    return "ETL Pipeline Analysis"


# =====================================================================
# FEATURE 6: OPERATIONAL REPORT GENERATOR
# =====================================================================

def generate_operational_report(
    report_type: str = "comprehensive",
    format: str = "pdf",
    custom_title: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generates an operational report in CSV, JSON, or PDF based on real FlowOps AI data.
    """
    report_id = f"OPS-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    generated_at = datetime.now(timezone.utc).isoformat()

    # 1. Gather real operational data from PostgreSQL
    with engine.connect() as conn:
        # Runs summary
        runs_raw = conn.execute(
            text("""
                SELECT run_id, filename, status, original_rows, cleaned_rows,
                       rejected_rows, duration_seconds, error_message, failed_step,
                       created_at
                FROM pipeline_runs
                ORDER BY run_id DESC
                LIMIT 20
            """)
        ).mappings().all()

        runs = []
        for r in runs_raw:
            rd = dict(r)
            if rd.get("created_at"):
                rd["created_at"] = rd["created_at"].isoformat()
            rd["duration_seconds"] = float(rd["duration_seconds"] or 0)
            runs.append(rd)

        # Aggregate stats
        stats_row = conn.execute(
            text("""
                SELECT
                    COUNT(*) AS total_runs,
                    COUNT(*) FILTER (WHERE status = 'completed') AS successful_runs,
                    COUNT(*) FILTER (WHERE status = 'failed') AS failed_runs,
                    COALESCE(SUM(original_rows), 0) AS total_original_rows,
                    COALESCE(SUM(cleaned_rows), 0) AS total_cleaned_rows,
                    COALESCE(SUM(rejected_rows), 0) AS total_rejected_rows,
                    COALESCE(AVG(duration_seconds), 0) AS avg_duration_seconds
                FROM pipeline_runs
            """)
        ).mappings().first()
        stats = dict(stats_row) if stats_row else {}
        if stats.get("avg_duration_seconds"):
            stats["avg_duration_seconds"] = round(float(stats["avg_duration_seconds"]), 2)

        # Anomalies
        anoms_raw = conn.execute(
            text("""
                SELECT anomaly_id, run_id, anomaly_type, severity, message, created_at
                FROM anomaly_logs
                ORDER BY anomaly_id DESC
                LIMIT 15
            """)
        ).mappings().all()

        anomalies = []
        for a in anoms_raw:
            ad = dict(a)
            if ad.get("created_at"):
                ad["created_at"] = ad["created_at"].isoformat()
            anomalies.append(ad)

        # AI Usage
        ai_row = conn.execute(
            text("""
                SELECT total_requests, total_tokens, estimated_credit_used_usd
                FROM ai_usage_summary
                ORDER BY summary_id DESC
                LIMIT 1
            """)
        ).mappings().first()
        ai_summary = dict(ai_row) if ai_row else {}

    # Calculate overall rejection rate
    tot_orig = stats.get("total_original_rows", 0)
    tot_rej = stats.get("total_rejected_rows", 0)
    rejection_rate = round((tot_rej / tot_orig * 100), 2) if tot_orig > 0 else 0.0

    title = custom_title or f"FlowOps AI Operational Performance Report ({report_type.capitalize()})"

    # Generate Claude Executive Summary
    api_key = os.getenv("ANTHROPIC_API_KEY")
    client = Anthropic(api_key=api_key) if api_key else None

    executive_summary = (
        f"FlowOps AI has executed {stats.get('total_runs', 0)} total pipeline runs with "
        f"{stats.get('successful_runs', 0)} successful completions and {stats.get('failed_runs', 0)} failures. "
        f"A total of {tot_orig:,} rows were ingested with {tot_rej:,} rows rejected ({rejection_rate}% overall rejection rate). "
        f"{len(anomalies)} anomalies were logged during this operational cycle."
    )
    recommendations = [
        "Audit ingestion sources with high rejection rates to fix invalid email formats before ingestion.",
        "Monitor execution duration on batch sizes exceeding 10 rows to prevent slow_pipeline anomaly triggers.",
        "Ensure pipeline retry policies continue to protect against transient database connectivity failures."
    ]

    if client:
        try:
            brief_resp = client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=300,
                messages=[{
                    "role": "user",
                    "content": f"Generate a concise 2-sentence executive summary and 3 bullet point recommendations for this data engineering pipeline status:\n"
                               f"Stats: {json.dumps(stats)}\nAnomalies count: {len(anomalies)}\nRejection rate: {rejection_rate}%."
                }]
            )
            ai_text = "".join(b.text for b in brief_resp.content if b.type == "text").strip()
            if ai_text:
                executive_summary = ai_text
        except Exception:
            pass

    report_payload = {
        "report_id": report_id,
        "title": title,
        "generated_at": generated_at,
        "report_type": report_type,
        "data_sources": [
            "PostgreSQL pipeline_runs",
            "PostgreSQL anomaly_logs",
            "PostgreSQL ai_usage_summary"
        ],
        "statistics": {
            **stats,
            "overall_rejection_rate_pct": rejection_rate
        },
        "executive_summary": executive_summary,
        "recent_runs": runs,
        "anomalies": anomalies,
        "ai_usage": ai_summary,
        "recommendations": recommendations,
        "limitations": "Report includes only pipeline executions and anomaly logs verified in PostgreSQL."
    }

    # Generate File according to format
    format_clean = format.lower().strip()
    if format_clean == "csv":
        filename = f"{report_id}.csv"
        filepath = os.path.join(REPORTS_DIR, filename)
        _write_operational_csv(report_payload, filepath)
    elif format_clean == "json":
        filename = f"{report_id}.json"
        filepath = os.path.join(REPORTS_DIR, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(report_payload, f, indent=2, default=str)
    else:  # pdf
        format_clean = "pdf"
        filename = f"{report_id}.pdf"
        filepath = os.path.join(REPORTS_DIR, filename)
        _write_operational_pdf(report_payload, filepath)

    return {
        "success": True,
        "report_id": report_id,
        "title": title,
        "format": format_clean,
        "filename": filename,
        "download_url": f"/api/ai/reports/download/{filename}",
        "generated_at": generated_at,
        "summary": executive_summary
    }


def _write_operational_csv(data: Dict[str, Any], filepath: str):
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["# FlowOps AI Operational Performance Report"])
        writer.writerow(["Report ID", data["report_id"]])
        writer.writerow(["Generated At", data["generated_at"]])
        writer.writerow(["Title", sanitize_csv_cell(data["title"])])
        writer.writerow([])
        writer.writerow(["# Executive Summary"])
        writer.writerow([sanitize_csv_cell(data["executive_summary"])])
        writer.writerow([])
        writer.writerow(["# Aggregated Pipeline Metrics"])
        for k, v in data["statistics"].items():
            writer.writerow([k, sanitize_csv_cell(v)])
        writer.writerow([])
        writer.writerow(["# Recent Pipeline Runs"])
        writer.writerow(["Run ID", "Filename", "Status", "Original Rows", "Cleaned Rows", "Rejected Rows", "Duration (s)", "Created At"])
        for r in data["recent_runs"]:
            writer.writerow([
                r.get("run_id"),
                sanitize_csv_cell(r.get("filename")),
                r.get("status"),
                r.get("original_rows"),
                r.get("cleaned_rows"),
                r.get("rejected_rows"),
                r.get("duration_seconds"),
                r.get("created_at")
            ])
        writer.writerow([])
        writer.writerow(["# Detected Anomalies"])
        writer.writerow(["Anomaly ID", "Run ID", "Type", "Severity", "Message", "Created At"])
        for a in data["anomalies"]:
            writer.writerow([
                a.get("anomaly_id"),
                a.get("run_id"),
                a.get("anomaly_type"),
                a.get("severity"),
                sanitize_csv_cell(a.get("message")),
                a.get("created_at")
            ])


def _write_operational_pdf(data: Dict[str, Any], filepath: str):
    doc = SimpleDocTemplate(
        filepath,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Heading1"],
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#1e293b"),
        spaceAfter=4
    )
    subtitle_style = ParagraphStyle(
        "DocSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=15
    )
    h2_style = ParagraphStyle(
        "SectionH2",
        parent=styles["Heading2"],
        fontSize=13,
        leading=17,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=12,
        spaceAfter=6
    )
    body_style = ParagraphStyle(
        "BodyTextCustom",
        parent=styles["Normal"],
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#334155")
    )
    cell_bold = ParagraphStyle(
        "CellBold",
        parent=styles["Normal"],
        fontSize=8.5,
        leading=11,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#1e293b")
    )
    cell_normal = ParagraphStyle(
        "CellNormal",
        parent=styles["Normal"],
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#334155")
    )

    elements = []

    # Title & Metadata Header
    elements.append(Paragraph(data["title"], title_style))
    meta_text = f"Report ID: <b>{data['report_id']}</b> &nbsp;|&nbsp; Generated: <b>{data['generated_at'][:19].replace('T', ' ')} UTC</b> &nbsp;|&nbsp; Platform: <b>FlowOps AI</b>"
    elements.append(Paragraph(meta_text, subtitle_style))
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#cbd5e1"), spaceAfter=12))

    # Executive Summary Box
    elements.append(Paragraph("Executive Summary", h2_style))
    summary_p = Paragraph(data["executive_summary"], body_style)
    summary_table = Table([[summary_p]], colWidths=[540])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 10))

    # KPI Statistics Grid
    elements.append(Paragraph("Pipeline Operations Overview", h2_style))
    stats = data["statistics"]
    kpi_data = [
        [
            Paragraph("Total Pipeline Runs", cell_bold), Paragraph(str(stats.get("total_runs", 0)), cell_normal),
            Paragraph("Successful Runs", cell_bold), Paragraph(str(stats.get("successful_runs", 0)), cell_normal)
        ],
        [
            Paragraph("Failed Runs", cell_bold), Paragraph(str(stats.get("failed_runs", 0)), cell_normal),
            Paragraph("Avg Duration", cell_bold), Paragraph(f"{stats.get('avg_duration_seconds', 0)}s", cell_normal)
        ],
        [
            Paragraph("Total Rows Ingested", cell_bold), Paragraph(f"{stats.get('total_original_rows', 0):,}", cell_normal),
            Paragraph("Cleaned Rows", cell_bold), Paragraph(f"{stats.get('total_cleaned_rows', 0):,}", cell_normal)
        ],
        [
            Paragraph("Rejected Rows", cell_bold), Paragraph(f"{stats.get('total_rejected_rows', 0):,}", cell_normal),
            Paragraph("Rejection Rate", cell_bold), Paragraph(f"{stats.get('overall_rejection_rate_pct', 0)}%", cell_normal)
        ]
    ]
    kpi_table = Table(kpi_data, colWidths=[135, 135, 135, 135])
    kpi_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    elements.append(kpi_table)
    elements.append(Spacer(1, 10))

    # Recent Pipeline Runs Table
    elements.append(Paragraph("Recent Pipeline Executions", h2_style))
    runs_headers = [
        Paragraph("Run ID", cell_bold),
        Paragraph("Filename", cell_bold),
        Paragraph("Status", cell_bold),
        Paragraph("Rows (Orig / Clean / Rej)", cell_bold),
        Paragraph("Duration", cell_bold),
        Paragraph("Executed", cell_bold)
    ]
    runs_rows = [runs_headers]
    for r in data["recent_runs"][:8]:
        row_counts = f"{r.get('original_rows', 0)} / {r.get('cleaned_rows', 0)} / {r.get('rejected_rows', 0)}"
        dur = f"{r.get('duration_seconds', 0):.2f}s"
        created = (r.get("created_at") or "")[:16].replace("T", " ")
        runs_rows.append([
            Paragraph(f"#{r.get('run_id')}", cell_normal),
            Paragraph(str(r.get("filename") or ""), cell_normal),
            Paragraph(str(r.get("status") or ""), cell_normal),
            Paragraph(row_counts, cell_normal),
            Paragraph(dur, cell_normal),
            Paragraph(created, cell_normal),
        ])
    runs_table = Table(runs_rows, colWidths=[45, 155, 65, 125, 60, 90])
    runs_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    elements.append(runs_table)
    elements.append(Spacer(1, 10))

    # Anomalies Section
    if data["anomalies"]:
        elements.append(Paragraph("Recent Operational Anomalies", h2_style))
        anom_headers = [
            Paragraph("Anomaly ID", cell_bold),
            Paragraph("Run #", cell_bold),
            Paragraph("Type", cell_bold),
            Paragraph("Severity", cell_bold),
            Paragraph("Message", cell_bold)
        ]
        anom_rows = [anom_headers]
        for a in data["anomalies"][:6]:
            anom_rows.append([
                Paragraph(f"#{a.get('anomaly_id')}", cell_normal),
                Paragraph(f"#{a.get('run_id')}", cell_normal),
                Paragraph(str(a.get("anomaly_type") or ""), cell_normal),
                Paragraph(str(a.get("severity") or ""), cell_normal),
                Paragraph(str(a.get("message") or ""), cell_normal),
            ])
        anom_table = Table(anom_rows, colWidths=[60, 45, 100, 65, 270])
        anom_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#fef2f2")),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#fecaca")),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ]))
        elements.append(anom_table)
        elements.append(Spacer(1, 10))

    # Recommendations
    elements.append(Paragraph("Recommended Engineering Actions", h2_style))
    for rec in data["recommendations"]:
        elements.append(Paragraph(f"• {rec}", body_style))
        elements.append(Spacer(1, 3))

    doc.build(elements)


# =====================================================================
# ADDITIONAL FEATURE: DOWNLOADABLE API USAGE & COST RECEIPT
# =====================================================================

def generate_usage_receipt(
    period: str = "30d",
    format: str = "pdf",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    budget_limit: Optional[float] = 5.0
) -> Dict[str, Any]:
    """
    Generates an official Estimated API Usage & Cost Receipt from PostgreSQL records.
    Filters by period: today, 7d, 30d, this_month, custom, or all.
    Supported formats: pdf, csv, json.
    """
    receipt_id = f"RCP-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    start_dt, end_dt = parse_period_dates(period, start_date, end_date)
    generated_at = datetime.now(timezone.utc).isoformat()

    # Query real ai_insights within period
    with engine.connect() as conn:
        insights_query = text("""
            SELECT insight_id, run_id, model, analysis, input_tokens,
                   output_tokens, total_tokens, estimated_cost_usd, created_at
            FROM ai_insights
            WHERE created_at >= :start_dt AND created_at <= :end_dt
            ORDER BY insight_id ASC
        """)
        raw_insights = conn.execute(
            insights_query,
            {"start_dt": start_dt, "end_dt": end_dt}
        ).mappings().all()

        # If period yielded 0 and user selected 'all' or fallback, grab all
        if not raw_insights and period in ("all", "30d"):
            raw_insights = conn.execute(
                text("""
                    SELECT insight_id, run_id, model, analysis, input_tokens,
                           output_tokens, total_tokens, estimated_cost_usd, created_at
                    FROM ai_insights
                    ORDER BY insight_id ASC
                """)
            ).mappings().all()

        ledger_rows = []
        total_input_tokens = 0
        total_output_tokens = 0
        total_tokens = 0
        model_counts = {}
        feature_counts = {}

        for item in raw_insights:
            d = dict(item)
            inp = int(d.get("input_tokens") or 0)
            out = int(d.get("output_tokens") or 0)
            tot = int(d.get("total_tokens") or (inp + out))
            cost = float(d.get("estimated_cost_usd") or (((inp / 1e6) * 3.0) + ((out / 1e6) * 15.0)))
            inp_cost = round((inp / 1e6) * 3.0, 6)
            out_cost = round((out / 1e6) * 15.0, 6)
            created_iso = d.get("created_at").isoformat() if hasattr(d.get("created_at"), "isoformat") else str(d.get("created_at") or "")

            total_input_tokens += inp
            total_output_tokens += out
            total_tokens += tot

            model_name = d.get("model") or "claude-sonnet-4-6"
            feature_name = detect_insight_feature(d.get("analysis") or "")

            model_counts[model_name] = model_counts.get(model_name, 0) + 1
            feature_counts[feature_name] = feature_counts.get(feature_name, 0) + 1

            ledger_rows.append({
                "insight_id": d.get("insight_id"),
                "run_id": d.get("run_id"),
                "timestamp": created_iso,
                "provider": "Anthropic",
                "model": model_name,
                "feature": feature_name,
                "input_tokens": inp,
                "output_tokens": out,
                "total_tokens": tot,
                "estimated_input_cost_usd": inp_cost,
                "estimated_output_cost_usd": out_cost,
                "estimated_total_cost_usd": round(cost, 6)
            })

    total_requests = len(ledger_rows)
    est_input_cost = round((total_input_tokens / 1e6) * 3.0, 6)
    est_output_cost = round((total_output_tokens / 1e6) * 15.0, 6)
    est_total_cost = round(est_input_cost + est_output_cost, 6)
    avg_tokens_per_request = round(total_tokens / total_requests) if total_requests > 0 else 0

    init_budget = float(budget_limit if budget_limit is not None else 5.0)
    incurred_cost = round(est_total_cost, 6)
    remaining_balance = round(max(0.0, init_budget - incurred_cost), 6)
    util_rate = round((incurred_cost / init_budget * 100), 2) if init_budget > 0 else 0.0

    budget_statement = {
        "initial_budget_usd": init_budget,
        "incurred_cost_usd": incurred_cost,
        "remaining_balance_usd": remaining_balance,
        "utilization_percentage": util_rate,
        "currency": "USD ($)",
        "statement_note": f"Starting allocation: ${init_budget:.2f} USD | Net Incurred Cost: -${incurred_cost:.4f} USD | Remaining Balance: ${remaining_balance:.4f} USD."
    }

    receipt_payload = {
        "receipt_id": receipt_id,
        "application": "FlowOps AI",
        "generated_at": generated_at,
        "reporting_period": {
            "period_type": period,
            "start_date": start_dt.isoformat(),
            "end_date": end_dt.isoformat()
        },
        "currency": "USD ($)",
        "pricing_configuration": {
            "claude_model": CLAUDE_MODEL,
            "input_price_per_million_usd": 3.00,
            "output_price_per_million_usd": 15.00
        },
        "budget_statement": budget_statement,
        "disclaimer": "This document represents an Estimated API Usage & Cost Receipt calculated from recorded token telemetry. It is not an official Anthropic monthly invoice.",
        "usage_summary": {
            "ai_provider": "Anthropic (Claude)",
            "total_requests": total_requests,
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
            "total_tokens": total_tokens,
            "average_tokens_per_request": avg_tokens_per_request,
            "requests_by_model": model_counts,
            "requests_by_feature": feature_counts
        },
        "cost_breakdown": {
            "estimated_input_cost_usd": est_input_cost,
            "estimated_output_cost_usd": est_output_cost,
            "estimated_total_cost_usd": est_total_cost
        },
        "ledger": ledger_rows,
        "notes": [
            f"Applied Claude 3.5 Sonnet / {CLAUDE_MODEL} rates ($3.00/M input, $15.00/M output).",
            "Token usage counts are captured directly from Anthropic API response headers.",
            "Database queries, ETL operations, and local frontend actions do not consume AI tokens."
        ]
    }

    format_clean = format.lower().strip()
    if format_clean == "csv":
        filename = f"{receipt_id}.csv"
        filepath = os.path.join(REPORTS_DIR, filename)
        _write_receipt_csv(receipt_payload, filepath)
    elif format_clean == "json":
        filename = f"{receipt_id}.json"
        filepath = os.path.join(REPORTS_DIR, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(receipt_payload, f, indent=2, default=str)
    else:  # pdf
        format_clean = "pdf"
        filename = f"{receipt_id}.pdf"
        filepath = os.path.join(REPORTS_DIR, filename)
        _write_receipt_pdf(receipt_payload, filepath)

    return {
        "success": True,
        "receipt_id": receipt_id,
        "period": period,
        "format": format_clean,
        "filename": filename,
        "download_url": f"/api/ai/reports/download/{filename}",
        "total_requests": total_requests,
        "total_tokens": total_tokens,
        "estimated_total_cost_usd": est_total_cost,
        "initial_budget_usd": init_budget,
        "remaining_balance_usd": remaining_balance,
        "budget_utilization_pct": util_rate,
        "generated_at": generated_at
    }


def _write_receipt_csv(data: Dict[str, Any], filepath: str):
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["# FlowOps AI — API Usage & Estimated Cost Receipt"])
        writer.writerow(["Receipt ID", data["receipt_id"]])
        writer.writerow(["Application", data["application"]])
        writer.writerow(["Generated At", data["generated_at"]])
        writer.writerow(["Period", data["reporting_period"]["period_type"]])
        writer.writerow(["Start Date", data["reporting_period"]["start_date"]])
        writer.writerow(["End Date", data["reporting_period"]["end_date"]])
        writer.writerow(["Currency", data["currency"]])
        writer.writerow([])
        writer.writerow(["# Cost & Token Totals"])
        writer.writerow(["Total Requests", data["usage_summary"]["total_requests"]])
        writer.writerow(["Total Input Tokens", data["usage_summary"]["total_input_tokens"]])
        writer.writerow(["Total Output Tokens", data["usage_summary"]["total_output_tokens"]])
        writer.writerow(["Total Tokens", data["usage_summary"]["total_tokens"]])
        writer.writerow(["Estimated Input Cost ($)", data["cost_breakdown"]["estimated_input_cost_usd"]])
        writer.writerow(["Estimated Output Cost ($)", data["cost_breakdown"]["estimated_output_cost_usd"]])
        writer.writerow(["Estimated Total Cost ($)", data["cost_breakdown"]["estimated_total_cost_usd"]])
        writer.writerow([])
        b = data.get("budget_statement", {})
        writer.writerow(["# Account Budget Allocation & Net Balance Statement"])
        writer.writerow(["Configured Starting Budget / Credit ($)", f"{b.get('initial_budget_usd', 5.0):.2f}"])
        writer.writerow(["Less Incurred API Cost (Reduction) ($)", f"-{b.get('incurred_cost_usd', 0.0):.4f}"])
        writer.writerow(["Net Remaining Account Balance ($)", f"{b.get('remaining_balance_usd', 5.0):.4f}"])
        writer.writerow(["Budget Utilization Rate (%)", f"{b.get('utilization_percentage', 0.0):.2f}%"])
        writer.writerow([])
        writer.writerow(["# Transaction Ledger"])
        writer.writerow([
            "Insight ID", "Run ID", "Timestamp", "Provider", "Model",
            "Feature", "Input Tokens", "Output Tokens", "Total Tokens",
            "Input Cost ($)", "Output Cost ($)", "Total Cost ($)"
        ])
        for row in data["ledger"]:
            writer.writerow([
                row["insight_id"],
                row["run_id"],
                row["timestamp"],
                row["provider"],
                row["model"],
                sanitize_csv_cell(row["feature"]),
                row["input_tokens"],
                row["output_tokens"],
                row["total_tokens"],
                row["estimated_input_cost_usd"],
                row["estimated_output_cost_usd"],
                row["estimated_total_cost_usd"],
            ])
        writer.writerow([])
        writer.writerow(["# Disclaimer"])
        writer.writerow([sanitize_csv_cell(data["disclaimer"])])


def _write_receipt_pdf(data: Dict[str, Any], filepath: str):
    doc = SimpleDocTemplate(
        filepath,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "ReceiptTitle",
        parent=styles["Heading1"],
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=3
    )
    subtitle_style = ParagraphStyle(
        "ReceiptSubtitle",
        parent=styles["Normal"],
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=12
    )
    h2_style = ParagraphStyle(
        "ReceiptH2",
        parent=styles["Heading2"],
        fontSize=11.5,
        leading=15,
        textColor=colors.HexColor("#1e293b"),
        spaceBefore=10,
        spaceAfter=5
    )
    cell_bold = ParagraphStyle(
        "RCellBold",
        parent=styles["Normal"],
        fontSize=8,
        leading=10,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#0f172a")
    )
    cell_normal = ParagraphStyle(
        "RCellNormal",
        parent=styles["Normal"],
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor("#334155")
    )
    disclaimer_style = ParagraphStyle(
        "Disclaimer",
        parent=styles["Normal"],
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor("#94a3b8"),
        fontName="Helvetica-Oblique"
    )

    elements = []

    # Header Banner
    elements.append(Paragraph("FLOWOPS AI — API USAGE & COST RECEIPT", title_style))
    period_label = f"Period: <b>{data['reporting_period']['period_type'].upper()}</b> &nbsp;|&nbsp; Receipt Ref: <b>{data['receipt_id']}</b> &nbsp;|&nbsp; Generated: <b>{data['generated_at'][:19].replace('T', ' ')} UTC</b>"
    elements.append(Paragraph(period_label, subtitle_style))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#0ea5e9"), spaceAfter=10))

    # Aggregate KPI Summary Table
    u = data["usage_summary"]
    c = data["cost_breakdown"]
    kpi_rows = [
        [
            Paragraph("Total API Requests", cell_bold), Paragraph(str(u["total_requests"]), cell_normal),
            Paragraph("Estimated Input Cost", cell_bold), Paragraph(f"${c['estimated_input_cost_usd']:.4f}", cell_normal)
        ],
        [
            Paragraph("Total Input Tokens", cell_bold), Paragraph(f"{u['total_input_tokens']:,}", cell_normal),
            Paragraph("Estimated Output Cost", cell_bold), Paragraph(f"${c['estimated_output_cost_usd']:.4f}", cell_normal)
        ],
        [
            Paragraph("Total Output Tokens", cell_bold), Paragraph(f"{u['total_output_tokens']:,}", cell_normal),
            Paragraph("Estimated Total Cost", cell_bold), Paragraph(f"${c['estimated_total_cost_usd']:.4f} USD", cell_bold)
        ],
        [
            Paragraph("Total Tokens Consumed", cell_bold), Paragraph(f"{u['total_tokens']:,}", cell_normal),
            Paragraph("Average Tokens / Req", cell_bold), Paragraph(f"{u['average_tokens_per_request']:,}", cell_normal)
        ]
    ]
    summary_table = Table(kpi_rows, colWidths=[135, 135, 135, 135])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 10))

    # Account Budget Allocation & Net Balance Statement
    b = data.get("budget_statement", {})
    init_b = b.get("initial_budget_usd", 5.0)
    inc_c = b.get("incurred_cost_usd", 0.0)
    rem_b = b.get("remaining_balance_usd", 5.0)
    util_r = b.get("utilization_percentage", 0.0)

    elements.append(Paragraph("Account Budget Allocation & Net Balance Statement", h2_style))
    budget_red_style = ParagraphStyle("RedCost", parent=cell_bold, textColor=colors.HexColor("#dc2626"))
    budget_green_style = ParagraphStyle("GreenBal", parent=cell_bold, textColor=colors.HexColor("#16a34a"))
    budget_rows = [
        [
            Paragraph("Configured Starting Budget / Credit", cell_bold),
            Paragraph(f"${init_b:.2f} USD", cell_bold),
            Paragraph("Less Incurred Cost (Cost Reduction)", cell_bold),
            Paragraph(f"-${inc_c:.4f} USD", budget_red_style),
        ],
        [
            Paragraph("Net Remaining Account Balance", cell_bold),
            Paragraph(f"${rem_b:.4f} USD", budget_green_style),
            Paragraph("Budget Utilization Rate", cell_bold),
            Paragraph(f"{util_r:.2f}% of ${init_b:.2f}", cell_normal),
        ]
    ]
    budget_table = Table(budget_rows, colWidths=[150, 120, 150, 120])
    budget_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f0fdf4")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#86efac")),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(budget_table)
    elements.append(Spacer(1, 10))

    # Detailed Transaction Ledger
    elements.append(Paragraph("Detailed API Request Ledger", h2_style))
    ledger_headers = [
        Paragraph("ID", cell_bold),
        Paragraph("Timestamp", cell_bold),
        Paragraph("Run", cell_bold),
        Paragraph("Model", cell_bold),
        Paragraph("Feature", cell_bold),
        Paragraph("In Tokens", cell_bold),
        Paragraph("Out Tokens", cell_bold),
        Paragraph("Est Cost ($)", cell_bold),
    ]
    ledger_data = [ledger_headers]
    for row in data["ledger"][:35]:  # Fits cleanly on page
        ts = row["timestamp"][:16].replace("T", " ")
        ledger_data.append([
            Paragraph(f"#{row['insight_id']}", cell_normal),
            Paragraph(ts, cell_normal),
            Paragraph(f"#{row['run_id']}" if row['run_id'] else "-", cell_normal),
            Paragraph(row['model'], cell_normal),
            Paragraph(row['feature'][:22], cell_normal),
            Paragraph(f"{row['input_tokens']:,}", cell_normal),
            Paragraph(f"{row['output_tokens']:,}", cell_normal),
            Paragraph(f"${row['estimated_total_cost_usd']:.4f}", cell_normal),
        ])

    ledger_table = Table(ledger_data, colWidths=[35, 85, 35, 95, 115, 55, 55, 65])
    ledger_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#0f172a")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    # Adjust header text color
    for i in range(len(ledger_headers)):
        ledger_headers[i].style.textColor = colors.white

    elements.append(ledger_table)
    elements.append(Spacer(1, 10))

    # Notes & Disclaimer
    elements.append(Paragraph("Calculation Notes & Disclaimers", h2_style))
    for n in data["notes"]:
        elements.append(Paragraph(f"• {n}", cell_normal))
        elements.append(Spacer(1, 2))

    elements.append(Spacer(1, 6))
    elements.append(Paragraph(data["disclaimer"], disclaimer_style))

    doc.build(elements)
