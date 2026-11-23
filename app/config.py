"""Configuration module for Vulnerability Watch."""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from project root
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")


def _get_bool(key: str, default: bool = False) -> bool:
    """Parse a boolean environment variable."""
    val = os.getenv(key)
    if val is None:
        return default
    return val.strip().lower() in ("true", "1", "yes", "on")


def _get_int(key: str, default: int = 0) -> int:
    """Parse an integer environment variable."""
    val = os.getenv(key)
    if val is None:
        return default
    try:
        return int(val.strip())
    except ValueError:
        return default


# Server settings
HOST: str = os.getenv("HOST", "127.0.0.1")
PORT: int = _get_int("PORT", 8000)

# Database path
DATABASE_PATH: str = os.getenv("DATABASE_PATH", str(ROOT_DIR / "vulnerability_watch.db"))

# GitHub configuration
GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")
GITHUB_WEBHOOK_SECRET: str = os.getenv("GITHUB_WEBHOOK_SECRET", "demo_webhook_secret")

# Anthropic LLM configuration
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")

# Scheduler configuration
SCAN_INTERVAL_MIN: int = _get_int("SCAN_INTERVAL_MIN", 60)

# Demo & behavior flags
DRY_RUN: bool = _get_bool("DRY_RUN", True)
DEMO_INJECT_FAILURE: bool = _get_bool("DEMO_INJECT_FAILURE", False)
