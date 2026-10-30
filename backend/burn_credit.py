import json
import time
import urllib.request
import urllib.error

API_URL = "http://127.0.0.1:8000/api/ai/chat"
USAGE_URL = "http://127.0.0.1:8000/api/ai/usage"

PROMPT = (
    "Run an exhaustive multi-step deep investigation across all pipeline runs. "
    "Connect every anomaly to rejected records, analyze all schema constraints, "
    "write complete SQL remediation scripts with transactions and rollback safeguards, "
    "and generate verbose test suites with pytest for all edge cases."
)

print("=" * 60)
print("FlowOps AI — Credit Exhaustion Script")
print("Target: Burn remaining credit until budget reaches $0.00")
print("=" * 60)

iteration = 1

while True:
    try:
        # 1. Check current remaining credit
        with urllib.request.urlopen(USAGE_URL, timeout=30) as r:
            usage = json.loads(r.read().decode("utf-8"))
            remaining = usage.get("estimated_credit_remaining_usd", 0.0)
            used = usage.get("estimated_credit_used_usd", 0.0)
            total_reqs = usage.get("total_requests", 0)

            print(
                f"\n[Iteration {iteration}] Status: "
                f"Used: ${used:.4f} | Remaining: ${remaining:.4f} | Total Requests: {total_reqs}"
            )

            if remaining <= 0.001:
                print("\n============================================================")
                print("SUCCESS: Target credit budget has been completely exhausted!")
                print("============================================================")
                break

        # 2. Send heavy investigation prompt
        print("  -> Sending heavy Claude analysis request...")
        payload = json.dumps({"message": PROMPT, "mode": "investigation"}).encode("utf-8")
        req = urllib.request.Request(
            API_URL,
            data=payload,
            headers={"Content-Type": "application/json"}
        )

        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tokens = data.get("total_tokens", 0)
            cost = data.get("estimated_cost_usd", 0.0)
            print(f"  -> Completed: Used {tokens:,} tokens (~${cost:.4f})")

        iteration += 1
        time.sleep(1)

    except KeyboardInterrupt:
        print("\nScript stopped by user.")
        break
    except Exception as exc:
        print(f"  -> Error: {exc}. Retrying in 3 seconds...")
        time.sleep(3)
