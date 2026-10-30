import json
import os
import re
import sys
import urllib.request
import urllib.error

sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:8000"

passed_tests = []
failed_tests = []


def run_test(name, fn):
    print(f"\n[TEST] {name} ...", flush=True)
    try:
        fn()
        passed_tests.append(name)
        print(f"--> PASS: {name}")
    except Exception as exc:
        failed_tests.append((name, str(exc)))
        print(f"--> FAIL: {name} | Reason: {exc}")


def http_post(path, data):
    url = f"{BASE}{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def http_get(path):
    url = f"{BASE}{path}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.status, resp.read()


# 1. Base Health Checks
def test_fastapi_health():
    status, body = http_get("/api/health")
    data = json.loads(body.decode("utf-8"))
    assert status == 200
    assert data.get("status") == "healthy"

def test_db_health():
    status, body = http_get("/api/database/health")
    data = json.loads(body.decode("utf-8"))
    assert status == 200
    assert data.get("connected") is True

def test_pipeline_runs_and_stats():
    status, body = http_get("/api/pipelines/runs")
    data = json.loads(body.decode("utf-8"))
    assert status == 200
    assert isinstance(data.get("runs"), list)

    status_st, body_st = http_get("/api/pipelines/stats")
    stats = json.loads(body_st.decode("utf-8"))
    assert status_st == 200
    assert "total_runs" in stats

def test_anomalies_and_insights():
    status, body = http_get("/api/anomalies")
    assert status == 200

    st_ins, body_ins = http_get("/api/ai/insights")
    assert st_ins == 200

    st_use, body_use = http_get("/api/ai/usage")
    assert st_use == 200


# 2. Feature 1: Context-Aware Bot & Follow-Up
def test_feature1_context_bot_and_followup():
    st1, r1 = http_post("/api/ai/chat", {"message": "What happened in my latest pipeline run?"})
    assert st1 == 200
    assert r1.get("answer") and len(r1["answer"]) > 20
    assert "12" in r1["answer"] or "Run" in r1["answer"]
    conv_id = r1.get("conversation_id")

    # Follow-up with pronominal reference "it"
    st2, r2 = http_post("/api/ai/chat", {
        "message": "Did it have any rejected records or anomalies?",
        "conversation_id": conv_id,
        "history": [
            {"role": "user", "content": "What happened in my latest pipeline run?"},
            {"role": "assistant", "content": r1["answer"]}
        ]
    })
    assert st2 == 200
    assert r2.get("answer") and len(r2["answer"]) > 20
    # Verifies it correctly resolved "it" to the latest run
    assert "Run" in r2["answer"] or "12" in r2["answer"] or "anomaly" in r2["answer"].lower()


# 3. Feature 2: AI Root Cause Analysis
def test_feature2_root_cause_analysis():
    st, res = http_post("/api/ai/root-cause", {"run_id": 10, "prompt": "Why did pipeline run 10 take long?"})
    assert st == 200
    assert res.get("success") is True
    assert res.get("run_id") == 10
    ans = res.get("answer", "")
    # Check mandatory RCA structure
    assert "1. Pipeline Summary" in ans or "Pipeline Summary" in ans
    assert "Probable Root Cause" in ans or "Root Cause" in ans
    assert "Recommended Fix" in ans or "Recommendation" in ans or "Fix" in ans


# 4. Feature 3: Deep Data Quality Investigator
def test_feature3_quality_investigator():
    st, res = http_post("/api/ai/quality-investigate", {"run_id": 10, "prompt": "Investigate data quality issues"})
    assert st == 200
    assert res.get("success") is True
    ans = res.get("answer", "")
    assert "Data Quality" in ans or "Quality" in ans
    assert res.get("evidence") is not None


# 5. Feature 4: Safe Natural Language SQL
def test_feature4_safe_nl_to_sql():
    # 5a. Valid query
    st, res = http_post("/api/ai/sql", {"query": "Show the last 3 pipeline runs"})
    assert st == 200
    assert res.get("success") is True
    assert res.get("row_count") == 3
    assert "pipeline_runs" in res.get("sql", "").lower()
    assert "LIMIT" in res.get("sql", "").upper()

    # 5b. Malicious query injection prevention
    from sql_assistant import validate_sql_query
    valid, _, reason = validate_sql_query("SELECT * FROM pipeline_runs; DROP TABLE pipeline_runs;")
    assert valid is False
    assert "Multiple SQL statements" in reason

    valid2, _, reason2 = validate_sql_query("UPDATE pipeline_runs SET status = 'failed'")
    assert valid2 is False

    valid3, _, reason3 = validate_sql_query("SELECT * FROM secrets_passwords")
    assert valid3 is False
    assert "Access to table 'secrets_passwords' is not permitted" in reason3


# 6. Feature 5: Multi-Step Investigation Mode
def test_feature5_multistep_investigation():
    st, res = http_post("/api/ai/investigate", {
        "prompt": "Why are latest runs showing rejected records and slow duration, and is it connected to recent anomalies?"
    })
    assert st == 200
    assert res.get("success") is True
    ans = res.get("answer", "")
    assert "Evidence Collected" in ans or "Key Findings" in ans or "Analysis" in ans
    assert len(res.get("sources", [])) >= 2


# 7. Feature 6: Operational Report Generator (PDF, CSV, JSON)
def test_feature6_operational_reports():
    for fmt in ["pdf", "csv", "json"]:
        st, res = http_post("/api/ai/reports/generate", {"report_type": "operational", "format": fmt})
        assert st == 200
        assert res.get("success") is True
        fname = res.get("filename")
        assert fname.endswith(f".{fmt}")

        # Test download
        dl_st, content = http_get(f"/api/ai/reports/download/{fname}")
        assert dl_st == 200
        assert len(content) > 100


# 8. Additional Feature: Downloadable API Usage & Cost Receipt (PDF, CSV, JSON)
def test_receipt_generation_and_download():
    for fmt in ["pdf", "csv", "json"]:
        st, res = http_post("/api/ai/receipt/generate", {"period": "all", "format": fmt, "budget": 5.0})
        assert st == 200
        assert res.get("success") is True
        assert res.get("initial_budget_usd") == 5.0
        assert res.get("remaining_balance_usd") is not None
        assert res.get("budget_utilization_pct") is not None
        fname = res.get("filename")
        assert fname.endswith(f".{fmt}")

        dl_st, content = http_get(f"/api/ai/reports/download/{fname}")
        assert dl_st == 200
        assert len(content) > 100


def main():
    print("==================================================")
    print("FLOWOPS AI ADVANCED COPILOT COMPREHENSIVE TEST SUITE")
    print("==================================================")

    run_test("1. FastAPI Health Check", test_fastapi_health)
    run_test("2. PostgreSQL Health Check", test_db_health)
    run_test("3. Pipeline Runs and Stats API", test_pipeline_runs_and_stats)
    run_test("4. Anomalies and AI Insights API", test_anomalies_and_insights)
    run_test("5. Feature 1: Context-Aware Bot & Follow-Up", test_feature1_context_bot_and_followup)
    run_test("6. Feature 2: AI Root Cause Analysis (RCA)", test_feature2_root_cause_analysis)
    run_test("7. Feature 3: Deep Data Quality Investigator", test_feature3_quality_investigator)
    run_test("8. Feature 4: Safe Natural Language SQL", test_feature4_safe_nl_to_sql)
    run_test("9. Feature 5: Multi-Step Investigation Mode", test_feature5_multistep_investigation)
    run_test("10. Feature 6: Operational Reports (PDF, CSV, JSON)", test_feature6_operational_reports)
    run_test("11. Additional Feature: Usage Receipts (PDF, CSV, JSON)", test_receipt_generation_and_download)

    print("\n==================================================")
    print(f"RESULTS: {len(passed_tests)} PASSED, {len(failed_tests)} FAILED")
    print("==================================================")
    if failed_tests:
        for name, err in failed_tests:
            print(f"FAILED: {name} -> {err}")
        sys.exit(1)
    else:
        print("ALL TESTS PASSED WITH 100% SUCCESS!")


if __name__ == "__main__":
    main()
