"""Tests for Phase 1: Foundation and health endpoint."""

import pytest
from httpx import AsyncClient, ASGITransport
import aiosqlite

from app.main import app
from app.config import DATABASE_PATH
from app.db import init_db


@pytest.mark.asyncio
async def test_health_endpoint() -> None:
    """Verify that /api/health returns 200 and expected payload."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["version"] == "1.0.0"


@pytest.mark.asyncio
async def test_db_schema_initialization(tmp_path) -> None:
    """Verify that database schema creates all 5 tables."""
    test_db = str(tmp_path / "test.db")
    await init_db(test_db)

    async with aiosqlite.connect(test_db) as db:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
        )
        tables = [row[0] for row in await cursor.fetchall()]

    expected = {"events", "findings", "repos", "runs", "tasks"}
    assert expected.issubset(set(tables))


@pytest.mark.asyncio
async def test_dashboard_and_run_pages() -> None:
    """Verify that HTML templates render successfully."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp1 = await client.get("/")
        assert resp1.status_code == 200
        assert "Vulnerability Watch" in resp1.text

        resp2 = await client.get("/runs/1")
        assert resp2.status_code == 200
        assert "Run #1" in resp2.text
