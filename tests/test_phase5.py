"""Unit tests for Phase 5: Remediation agent, Markdown generation, and DRY_RUN mode."""

import pytest
from app.agents.remediation import create_remediation_issue, format_remediation_issue_body


def test_format_remediation_issue_body_p0_first() -> None:
    """Verify that findings are formatted properly with P0s prioritized at top."""
    findings = [
        {
            "package": "urllib3",
            "ecosystem": "PyPI",
            "version": "1.25.8",
            "vuln_id": "GHSA-wqvq-5m8c-6g24",
            "severity": "MEDIUM",
            "priority": "P2",
            "in_kev": 0,
            "fixed_version": "1.25.9",
            "impact": "Medium impact CRLF injection.",
        },
        {
            "package": "requests",
            "ecosystem": "PyPI",
            "version": "2.20.0",
            "vuln_id": "CVE-2023-32681",
            "severity": "HIGH",
            "priority": "P0",
            "in_kev": 1,
            "fixed_version": "2.31.0",
            "impact": "Actively exploited credential leakage.",
        },
        {
            "package": "lodash",
            "ecosystem": "npm",
            "version": "4.17.15",
            "vuln_id": "GHSA-p6mc-m468-83gw",
            "severity": "HIGH",
            "priority": "P1",
            "in_kev": 0,
            "fixed_version": "4.17.19",
            "impact": "Prototype pollution vulnerability.",
        },
    ]

    body = format_remediation_issue_body(run_id=42, repo="owner/test-app", findings=findings, is_urgent=True)

    # Urgent banner
    assert "> [!CAUTION]" in body
    assert "URGENT:" in body

    # Summary table header
    assert "| Priority | Package | Ecosystem | Current | Fixed | Vulnerability | In KEV |" in body

    # Upgrade instructions
    assert "pip install --upgrade" in body
    assert "requests>=2.31.0" in body
    assert "urllib3>=1.25.9" in body
    assert "npm install" in body
    assert "lodash@4.17.19" in body

    # Check ordering: P0 table row should appear before P1 and P2
    p0_idx = body.find("`requests`")
    p1_idx = body.find("`lodash`")
    p2_idx = body.find("`urllib3`")
    assert p0_idx < p1_idx < p2_idx


@pytest.mark.asyncio
async def test_create_remediation_issue_dry_run(tmp_path) -> None:
    """Verify that force_dry_run=True returns a preview URL and does not call GitHub."""
    from app.db import init_db
    test_db = str(tmp_path / "rem_test.db")
    await init_db(test_db)

    findings = [
        {
            "package": "requests",
            "ecosystem": "PyPI",
            "version": "2.20.0",
            "vuln_id": "GHSA-xxxx",
            "priority": "P1",
            "in_kev": 0,
            "fixed_version": "2.31.0",
        }
    ]
    issue_url = await create_remediation_issue(
        run_id=99,
        repo="my-org/my-repo",
        findings=findings,
        is_urgent=False,
        force_dry_run=True,
        db_path=test_db,
    )
    assert issue_url is not None
    assert "preview-run-99" in issue_url
