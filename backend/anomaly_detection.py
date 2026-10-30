
def detect_anomalies(report: dict, duration_seconds: float) -> list:
    """Detect potential ETL anomalies using predefined rules."""

    anomalies = []

    original_rows = report.get("original_rows", 0)
    missing_cells = report.get("missing_cells_detected", 0)
    duplicates = report.get("removed_duplicates", 0)
    invalid_emails = report.get("invalid_email_rows_removed", 0)
    rejected_rows = report.get("rejected_rows", 0)
    columns = report.get("columns", [])

    if original_rows > 0:
        total_cells = max(original_rows * len(columns), 1)

        missing_rate = missing_cells / total_cells
        rejection_rate = rejected_rows / original_rows

        if missing_rate > 0.20:
            anomalies.append({
                "type": "high_missing_values",
                "severity": "warning",
                "message": (
                    f"{missing_rate:.1%} of CSV cells are missing."
                ),
            })

        if rejection_rate > 0.20:
            anomalies.append({
                "type": "high_rejection_rate",
                "severity": "critical",
                "message": (
                    f"{rejection_rate:.1%} of rows were rejected."
                ),
            })

    if duplicates > 0:
        anomalies.append({
            "type": "duplicate_rows",
            "severity": "warning",
            "message": f"{duplicates} duplicate rows were removed.",
        })

    if invalid_emails > 0:
        anomalies.append({
            "type": "invalid_emails",
            "severity": "warning",
            "message": (
                f"{invalid_emails} rows with invalid or missing "
                "emails were removed."
            ),
        })

    if duration_seconds > 10:
        anomalies.append({
            "type": "slow_pipeline",
            "severity": "warning",
            "message": (
                f"Pipeline took {duration_seconds:.3f} seconds, "
                "exceeding the 10-second threshold."
            ),
        })

    return anomalies
