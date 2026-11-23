"""Unit tests for Phase 6 & 7: Triggers, Webhooks, Scheduler, and API endpoints."""

import hashlib
import hmac
import json
import pytest
from httpx import AsyncClient, ASGITransport
import aiosqlite

from app.main import app, verify_github_signature
from app.db import init_db


@pytest.fixture(autouse=True)
async def setup_app_db():
    """Ensure database schema is initialized for API tests."""
    await init_db()


def test_verify_github_signature() -> None:
    """Test HMAC constant-time signature verification."""
    secret = "test_webhook_secret_123"
    payload = b'{"action": "test"}'
    valid_mac = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    valid_header = f"sha256={valid_mac}"

    assert verify_github_signature(payload, valid_header, secret) is True
    assert verify_github_signature(payload, "sha256=invalidhash", secret) is False
    assert verify_github_signature(payload, None, secret) is False


@pytest.mark.asyncio
async def test_repo_crud_endpoints() -> None:
    """Test repository management endpoints (add, list, toggle, delete)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Add repo
        resp = await client.post("/api/repos", json={"full_name": "test-org/test-repo-1"})
        assert resp.status_code == 201
        repo_data = resp.json()
        repo_id = repo_data["id"]
        assert repo_data["watched"] == 1

        # List repos
        list_resp = await client.get("/api/repos")
        assert list_resp.status_code == 200
        repos = list_resp.json()["repos"]
        assert any(r["id"] == repo_id for r in repos)

        # Toggle watch
        patch_resp = await client.patch(f"/api/repos/{repo_id}", json={"watched": 0})
        assert patch_resp.status_code == 200
        assert patch_resp.json()["watched"] == 0

        # Delete repo
        del_resp = await client.delete(f"/api/repos/{repo_id}")
        assert del_resp.status_code == 200


@pytest.mark.asyncio
async def test_simulate_push_endpoint() -> None:
    """Test simulate push endpoint triggering a run."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/simulate-push",
            json={"repo": "demo/vulnerable-app", "touched_files": ["requirements.txt"]},
        )
        assert resp.status_code == 202
        data = resp.json()
        assert data["status"] == "accepted"
        assert "run_id" in data


@pytest.mark.asyncio
async def test_webhook_endpoint() -> None:
    """Test GitHub webhook HMAC verification and dependency file detection."""
    from app.config import GITHUB_WEBHOOK_SECRET
    secret = GITHUB_WEBHOOK_SECRET or "demo_webhook_secret"

    # Push touching requirements.txt
    payload = {
        "repository": {"full_name": "demo/vulnerable-app"},
        "commits": [{"added": ["requirements.txt"], "modified": [], "removed": []}],
    }
    raw_body = json.dumps(payload).encode()
    mac = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Valid signature
        headers = {
            "X-Hub-Signature-256": f"sha256={mac}",
            "X-GitHub-Event": "push",
            "Content-Type": "application/json",
        }
        resp = await client.post("/webhook/github", content=raw_body, headers=headers)
        assert resp.status_code == 202
        assert resp.json()["status"] == "accepted"

        # Invalid signature
        bad_headers = {
            "X-Hub-Signature-256": "sha256=bad",
            "X-GitHub-Event": "push",
            "Content-Type": "application/json",
        }
        bad_resp = await client.post("/webhook/github", content=raw_body, headers=bad_headers)
        assert bad_resp.status_code == 401


@pytest.mark.asyncio
async def test_runs_api_and_detail() -> None:
    """Test creating run and fetching run detail."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create run
        resp = await client.post("/api/runs", json={"repo": "demo/vulnerable-app"})
        assert resp.status_code == 201
        run_id = resp.json()["run_id"]

        # Get run detail
        detail_resp = await client.get(f"/api/runs/{run_id}")
        assert detail_resp.status_code == 200
        data = detail_resp.json()
        assert data["run"]["id"] == run_id
        assert "tasks" in data
        assert "events" in data
