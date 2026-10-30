import pandas as pd
from io import BytesIO
import re


def process_csv(file_content: bytes) -> dict:
    """Validate and clean CSV data for the FlowOps AI ETL pipeline."""

    df = pd.read_csv(BytesIO(file_content))

    if df.empty:
        raise ValueError("The CSV contains no data rows.")

    if len(df.columns) == 0:
        raise ValueError("The CSV has no columns.")

    # Normalize column names and remove surrounding spaces from text.
    df.columns = [str(col).strip() for col in df.columns]

    if not all(df.columns):
        raise ValueError("The CSV contains an empty column name.")

    if df.columns.duplicated().any():
        raise ValueError("The CSV contains duplicate column names.")

    original_rows = len(df)

    for column in df.select_dtypes(include=["object", "string"]).columns:
        df[column] = df[column].apply(
            lambda value: value.strip() if isinstance(value, str) else value
        )

    # Count missing cells before cleaning.
    missing_cells = int(df.isnull().sum().sum())

    # Remove fully duplicated records.
    duplicate_rows = int(df.duplicated().sum())
    df = df.drop_duplicates().copy()

    # If an email column exists, identify records with invalid emails.
    email_column = next(
    (column for column in df.columns if column.lower() == "email"),
    None,
)

    invalid_email_rows = 0

    if email_column is not None:
        email_pattern = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

    valid_email = df[email_column].apply(
        lambda value: (
            isinstance(value, str)
            and bool(email_pattern.fullmatch(value))
        )
    )

    invalid_email_rows = int((~valid_email).sum())
    df = df.loc[valid_email].copy()


    # Convert missing values to JSON-safe None values.
    cleaned_records = (
        df.astype(object)
        .where(pd.notna(df), None)
        .to_dict(orient="records")
    )

    return {
        "original_rows": original_rows,
        "cleaned_rows": len(df),
        "removed_duplicates": duplicate_rows,
        "missing_cells_detected": missing_cells,
        "invalid_email_rows_removed": invalid_email_rows,
        "rejected_rows": original_rows - len(df),
        "columns": df.columns.tolist(),
        "cleaned_data": cleaned_records,
    }


def analyze_csv(file_content: bytes) -> dict:
    """Maintain the existing analysis endpoint's general report."""

    result = process_csv(file_content)

    return {
        "total_rows": result["original_rows"],
        "total_columns": len(result["columns"]),
        "missing_cells": result["missing_cells_detected"],
        "duplicate_rows": result["removed_duplicates"],
        "column_names": result["columns"],
        "cleaned_rows": result["cleaned_rows"],
        "invalid_email_rows_removed": result["invalid_email_rows_removed"],
        "preview": result["cleaned_data"][:5],
    }