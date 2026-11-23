"""Unit tests for EPSS Live Integration and Automated Git Diff / PR Generation."""

import pytest
from httpx import AsyncClient, ASGITransport
import aiosqlite

from app.agents.analyst import analyze_findings
from app.agents.remediation import create_remediation_pr, generate_remediation_diff
from app.clients.epss import EPSSClient
from app.coordinator import Coordinator
from app.db import init_db
from app.main import app


@pytest.fixture(autouse=True)
async def setup_test_database():
    """Ensure clean schema for each test."""
    await init_db()


@pytest.mark.asyncio
async def test_epss_client_live_query() -> None:
    """Verify live EPSS scores can be fetched for known CVEs."""
    client = EPSSClient()
    scores = await client.get_scores(["CVE-2023-32681", "CVE-2018-1000656"])

    assert len(scores) >= 1
    for cve, data in scores.items():
        assert "epss" in data
        assert "percentile" in data
        assert 0.0 <= data["epss"] <= 1.0
        assert 0.0 <= data["percentile"] <= 1.0


@pytest.mark.asyncio
async def test_analyst_attaches_epss_metrics() -> None:
    """Verify Analyst agent enriches findings with live EPSS probability and percentile."""
    raw_findings = [
        {
            "package": "requests",
            "ecosystem": "PyPI",
            "version": "2.20.0",
            "vuln_id": "CVE-2023-32681",
            "aliases": [],
            "severity": "HIGH",
            "summary": "Header leak",
            "fixed_version": "2.31.0",
        }
    ]
    results = await analyze_findings(raw_findings, api_key="")
    assert len(results) == 1
    assert "epss_score" in results[0]
    assert "epss_percentile" in results[0]
    assert results[0]["epss_score"] >= 0.0


def test_generate_remediation_diff() -> None:
    """Verify that unified git diff correctly updates pinned versions in requirements and package.json."""
    findings = [
        {
            "package": "requests",
            "ecosystem": "PyPI",
            "version": "2.20.0",
            "vuln_id": "CVE-2023-32681",
            "fixed_version": "2.32.4",
        },
        {
            "package": "lodash",
            "ecosystem": "npm",
            "version": "4.17.15",
            "vuln_id": "GHSA-p6mc-m468-83gw",
            "fixed_version": "4.17.21",
        },
    ]

    raw_req = "requests==2.20.0\nurllib3==1.25.8\n"
    raw_pkg = '{\n  "dependencies": {\n    "lodash": "^4.17.15"\n  }\n}'

    diff_data = generate_remediation_diff(
        repo="org/app",
        findings=findings,
        raw_req=raw_req,
        raw_pkg=raw_pkg,
    )

    patch = diff_data["patch"]
    assert "-requests==2.20.0" in patch
    assert "+requests==2.32.4" in patch
    assert "-    \"lodash\": \"^4.17.15\"" in patch
    assert "+    \"lodash\": \"^4.17.21\"" in patch


@pytest.mark.asyncio
async def test_create_remediation_pr_dry_run() -> None:
    """Verify create_remediation_pr returns valid branch and preview URL in dry-run mode."""
    findings = [{"package": "requests", "fixed_version": "2.32.4", "priority": "P0"}]
    diff_data = {"patch": "--- a/req.txt\n+++ b/req.txt\n@@ -1 +1 @@\n-requests==2.20.0\n+requests==2.32.4"}

    pr_url = await create_remediation_pr(
        run_id=55,
        repo="demo/vulnerable-app",
        findings=findings,
        diff_data=diff_data,
        force_dry_run=True,
    )
    assert pr_url is not None
    assert "preview-run-55" in pr_url


@pytest.mark.asyncio
async def test_create_pr_api_endpoint() -> None:
    """Verify POST /api/runs/{run_id}/create-pr generates PR and returns valid JSON."""
    coordinator = Coordinator()
    run_id = await coordinator.create_run(repo="demo/vulnerable-app", trigger="manual")

    deps = [{"ecosystem": "PyPI", "name": "requests", "version": "2.20.0"}]
    await coordinator.execute_run(run_id=run_id, custom_scanner_deps=deps)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(f"/api/runs/{run_id}/create-pr")
        assert resp.status_code == 200
        data = resp.json()
        assert "pr_url" in data
        assert "branch" in data
        assert f"vulnwatch/fix-run-{run_id}" in data["branch"]
