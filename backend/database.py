import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

ENV_FILE = Path(__file__).resolve().parent / ".env"
load_dotenv(ENV_FILE)
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing from the backend .env file.")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)


def test_connection():
    try:
        with engine.connect() as connection:
            result = connection.execute(
                text("SELECT current_database(), version()")
            )
            database_name, version = result.fetchone()

            return {
                "connected": True,
                "database": database_name,
                "version": version,
            }

    except SQLAlchemyError as exc:
        raise RuntimeError(
            "Could not connect to PostgreSQL. "
            "Check the server, database name, username, and password."
        ) from exc
