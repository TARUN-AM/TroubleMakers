"""Remediation agent: formats fix plan, upgrade commands, and creates GitHub issues."""

import os
from typing import Any, Dict, List, Optional
import httpx

from app.clients.github import GitHubClient
from app.config import DRY_RUN, GITHUB_TOKEN
from app.events import log_event


def format_remediation_issue_body(
    run_id: int, repo: str, findings: List[Dict[str, Any]], is_urgent: bool
) -> str:
    """Format rich GitHub Issue Markdown with summary table, P0s first, and fix commands."""
    priority_order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    sorted_findings = sorted(
        findings, key=lambda f: (priority_order.get(f.get("priority", "P3"), 3), f["package"])
    )

    p0_count = sum(1 for f in sorted_findings if f.get("priority") == "P0")
    p1_count = sum(1 for f in sorted_findings if f.get("priority") == "P1")

    lines: List[str] = [
        f"## Vulnerability Watch Remediation Plan",
        f"**Repository:** `{repo}` &bull; **Run ID:** `#{run_id}`\n",
    ]

    if is_urgent:
        lines.append(
            "> [!CAUTION]\n"
            f"> **URGENT:** {p0_count} actively exploited or critical severity (P0) "
            "vulnerabilities were detected. Immediate remediation is strongly recommended.\n"
        )

    # Summary table
    lines.append("### Summary of Findings\n")
    lines.append("| Priority | Package | Ecosystem | Current | Fixed | Vulnerability | In KEV |")
    lines.append("|:---:|:---|:---:|:---:|:---:|:---|:---:|")
    for f in sorted_findings:
        prio = f.get("priority", "P3")
        in_kev_icon = "Yes" if f.get("in_kev") else "No"
        fixed = f.get("fixed_version") or "Investigate"
        vuln_link = f"[{f['vuln_id']}](https://osv.dev/vulnerability/{f['vuln_id']})"
        lines.append(
            f"| **{prio}** | `{f['package']}` | {f['ecosystem']} | `{f['version']}` | "
            f"`{fixed}` | {vuln_link} | {in_kev_icon} |"
        )

    # Upgrade instructions
    lines.append("\n### Recommended Upgrade Commands\n")
    pip_upgrades: List[str] = []
    npm_upgrades: List[str] = []

    for f in sorted_findings:
        fix = f.get("fixed_version")
        if fix:
            if f["ecosystem"] == "PyPI":
                pip_upgrades.append(f"{f['package']}>={fix}")
            elif f["ecosystem"] == "npm":
                npm_upgrades.append(f"{f['package']}@{fix}")

    if pip_upgrades:
        lines.append("```bash\n# Upgrade Python dependencies\npip install --upgrade " + " ".join(dict.fromkeys(pip_upgrades)) + "\n```\n")
    if npm_upgrades:
        lines.append("```bash\n# Upgrade npm packages\nnpm install " + " ".join(dict.fromkeys(npm_upgrades)) + "\n```\n")

    # Detailed Impact Section
    lines.append("### Impact Assessment\n")
    for f in sorted_findings:
        lines.append(
            f"- **`{f['package']}`** ({f.get('priority', 'P3')}) &mdash; {f.get('impact', 'No impact details.')}"
        )

    lines.append(
        f"\n---\n*Generated autonomously by [Vulnerability Watch](http://localhost:8000/runs/{run_id})*"
    )
    return "\n".join(lines)


async def create_remediation_issue(
    run_id: int,
    repo: str,
    findings: List[Dict[str, Any]],
    is_urgent: bool,
    force_dry_run: Optional[bool] = None,
    db_path: Optional[str] = None,
) -> Optional[str]:
    """Create GitHub issue or render dry-run preview."""
    is_dry = DRY_RUN if force_dry_run is None else force_dry_run
    p0_count = sum(1 for f in findings if f.get("priority") == "P0")
    title = f"[Vulnerability Watch] Security Remediation Plan"
    if is_urgent:
        title = f"[URGENT] {title} ({p0_count} P0 detected)"

    body = format_remediation_issue_body(run_id, repo, findings, is_urgent)

    if is_dry or not GITHUB_TOKEN:
        await log_event(
            run_id,
            "Remediation",
            "info",
            f"DRY_RUN mode active: Rendered issue markdown locally ({len(findings)} findings).",
            db_path=db_path,
        )
        return f"https://github.com/{repo}/issues/preview-run-{run_id}"

    # Real GitHub API issue creation
    url = f"https://api.github.com/repos/{repo}/issues"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "User-Agent": "VulnerabilityWatch-Agent/1.0",
    }
    payload = {"title": title, "body": body}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            issue_url = data.get("html_url")
            await log_event(
                run_id,
                "Remediation",
                "info",
                f"Successfully created GitHub issue: {issue_url}",
                db_path=db_path,
            )
            return issue_url
    except Exception as e:
        await log_event(
            run_id, "Remediation", "error", f"Failed to post GitHub issue: {e}", db_path=db_path
        )
        return None
