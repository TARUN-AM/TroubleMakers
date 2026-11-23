"""Database connection, schema creation, and helpers."""

import json
import sqlite3
from typing import Any, AsyncGenerator
import aiosqlite
from app.config import DATABASE_PATH

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY, full_name TEXT UNIQUE NOT NULL,
  watched INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY, repo TEXT NOT NULL, trigger TEXT NOT NULL,
  status TEXT NOT NULL,            -- queued|running|done|failed
  urgent INTEGER DEFAULT 0, summary TEXT, issue_url TEXT, finding_hash TEXT,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, agent TEXT NOT NULL,
  label TEXT, status TEXT NOT NULL, -- pending|running|done|retrying|degraded|failed
  attempts INTEGER DEFAULT 0, result_json TEXT,
  started_at TEXT, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, package TEXT, ecosystem TEXT,
  version TEXT, vuln_id TEXT, aliases TEXT, severity TEXT, in_kev INTEGER DEFAULT 0,
  priority TEXT, impact TEXT, fixed_version TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, ts TEXT DEFAULT CURRENT_TIMESTAMP,
  agent TEXT, level TEXT, message TEXT
);
"""


async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """Dependency / helper to get an async database connection."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db


async def init_db(db_path: str = DATABASE_PATH) -> None:
    """Initialize database tables from schema."""
    async with aiosqlite.connect(db_path) as db:
        await db.executescript(SCHEMA_SQL)
        await db.commit()


# Synchronous init helper for CLI scripts or tests
def init_db_sync(db_path: str = DATABASE_PATH) -> None:
    """Synchronous init for testing or standalone CLI scripts."""
    with sqlite3.connect(db_path) as conn:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
