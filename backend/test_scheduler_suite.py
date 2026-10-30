"""
Automated validation test suite for FlowOps AI Scheduled Pipelines.
Tests all endpoints, PostgreSQL table persistence, triggers, and stats.
"""

import urllib.request
import urllib.error
import json
import time

BASE_URL = "http://127.0.0.1:8000"


def request(method, path, data=None):
    url = f"{BASE_URL}{path}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            text = resp.read().decode("utf-8")
            return resp.status, json.loads(text) if text else {}
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8")
        try:
            err_json = json.loads(text)
        except Exception:
            err_json = {"detail": text}
        return e.code, err_json


def run_tests():
    print("=" * 60)
    print("FLOWOPS AI SCHEDULED PIPELINES TEST SUITE")
    print("=" * 60)

    # 1. Stats endpoint
    print("\n[TEST 1] Testing GET /api/schedules/stats ...")
    status, stats = request("GET", "/api/schedules/stats")
    assert status == 200, f"Expected 200, got {status}"
    assert "total_schedules" in stats, "Missing total_schedules in stats"
    assert "active_schedules" in stats, "Missing active_schedules in stats"
    assert "execution_engine" in stats, "Missing execution_engine in stats"
    assert stats["engine_status"] == "operational", "Expected engine_status operational"
    print(f"--> PASS: Stats retrieved successfully. Total: {stats['total_schedules']}, Engine: {stats['execution_engine']}")

    # 2. List schedules endpoint
    print("\n[TEST 2] Testing GET /api/schedules ...")
    status, schedules = request("GET", "/api/schedules")
    assert status == 200, f"Expected 200, got {status}"
    assert isinstance(schedules, list), f"Expected list of schedules, got {type(schedules)}"
    assert len(schedules) >= 3, f"Expected at least 3 seeded schedules, got {len(schedules)}"
    first_sch = schedules[0]
    print(f"--> PASS: Found {len(schedules)} schedules. First: #{first_sch['schedule_id']} '{first_sch['name']}' ({first_sch['frequency_label']})")

    # 3. Create new schedule
    print("\n[TEST 3] Testing POST /api/schedules ...")
    new_schedule_payload = {
        "name": "Integration Test Scheduled Pipeline",
        "dataset_filename": "customers.csv",
        "frequency": "every_15_mins",
        "auto_clean": True,
        "ai_diagnosis": True,
    }
    status, created = request("POST", "/api/schedules", new_schedule_payload)
    assert status == 200, f"Expected 200, got {status}: {created}"
    created_id = created["schedule_id"]
    assert created_id > 0, f"Invalid schedule_id: {created_id}"
    assert created["frequency_cron"] == "*/15 * * * *", f"Expected cron */15 * * * *, got {created['frequency_cron']}"
    assert created["is_active"] is True, "Expected active to be True"
    print(f"--> PASS: Created schedule #{created_id} ('{created['name']}')")

    # 4. Trigger schedule execution
    print(f"\n[TEST 4] Testing POST /api/schedules/{created_id}/trigger ...")
    status, trig_result = request("POST", f"/api/schedules/{created_id}/trigger")
    assert status == 200, f"Expected 200, got {status}: {trig_result}"
    assert trig_result.get("success") is True, f"Trigger failed: {trig_result}"
    run_id = trig_result.get("run_id")
    assert run_id is not None and run_id > 0, f"Invalid run_id: {run_id}"
    print(f"--> PASS: Triggered execution. Run #{run_id} created with {trig_result.get('records_processed')} records.")

    # 5. Patch schedule (Pause)
    print(f"\n[TEST 5] Testing PATCH /api/schedules/{created_id} (Pause) ...")
    status, updated = request("PATCH", f"/api/schedules/{created_id}", {"is_active": False})
    assert status == 200, f"Expected 200, got {status}: {updated}"
    assert updated["is_active"] is False, f"Expected is_active=False, got {updated['is_active']}"
    print(f"--> PASS: Schedule #{created_id} successfully paused.")

    # 6. Patch schedule (Resume)
    print(f"\n[TEST 6] Testing PATCH /api/schedules/{created_id} (Resume) ...")
    status, updated_resumed = request("PATCH", f"/api/schedules/{created_id}", {"is_active": True})
    assert status == 200, f"Expected 200, got {status}: {updated_resumed}"
    assert updated_resumed["is_active"] is True, f"Expected is_active=True, got {updated_resumed['is_active']}"
    print(f"--> PASS: Schedule #{created_id} successfully resumed.")

    # 7. Delete schedule
    print(f"\n[TEST 7] Testing DELETE /api/schedules/{created_id} ...")
    status, del_res = request("DELETE", f"/api/schedules/{created_id}")
    assert status == 200, f"Expected 200, got {status}: {del_res}"
    assert del_res.get("deleted") is True, f"Delete failed: {del_res}"
    print(f"--> PASS: Schedule #{created_id} deleted successfully.")

    # 8. Confirm deletion
    print(f"\n[TEST 8] Confirming schedule #{created_id} is deleted ...")
    status, trig_after_del = request("POST", f"/api/schedules/{created_id}/trigger")
    assert status == 404, f"Expected 404 for deleted schedule, got {status}"
    print(f"--> PASS: Endpoint returned 404 for deleted schedule #{created_id} as expected.")

    print("\n" + "=" * 60)
    print("ALL 8 SCHEDULED PIPELINES TESTS PASSED PERFECTLY!")
    print("=" * 60)


if __name__ == "__main__":
    run_tests()
