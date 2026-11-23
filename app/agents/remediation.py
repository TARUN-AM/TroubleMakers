"""Remediation agent: formats fix plan, upgrade commands, and creates GitHub issues."""

import difflib
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
import httpx

from app.clients.github import GitHubClient
from app.config import DRY_RUN, GITHUB_TOKEN
from app.events import log_event


def generate_remediation_diff(
    repo: str,
    findings: List[Dict[str, Any]],
    raw_req: Optional[str] = None,
    raw_pkg: Optional[str] = None,
) -> Dict[str, str]:
    """Generate unified git diff for automated dependency version upgrades."""
    # Read demo files as fallback if empty
    demo_dir = Path(__file__).resolve().parent.parent.parent / "demo"
    if raw_req is None and (demo_dir / "requirements.txt").exists():
        raw_req = (demo_dir / "requirements.txt").read_text(encoding="utf-8")
    if raw_pkg is None and (demo_dir / "package.json").exists():
        raw_pkg = (demo_dir / "package.json").read_text(encoding="utf-8")

    raw_req = raw_req or ""
    raw_pkg = raw_pkg or ""

    # Map each package to its highest/safest recommended fixed version
    fix_map: Dict[str, str] = {}
    for f in findings:
        pkg = f["package"].lower()
        fix = f.get("fixed_version")
        if fix and (pkg not in fix_map or fix > fix_map[pkg]):
            fix_map[pkg] = fix

    all_diffs: List[str] = []
    updated_req = raw_req
    updated_pkg = raw_pkg

    # 1. Update requirements.txt
    if raw_req and any(f["ecosystem"] == "PyPI" for f in findings):
        new_req_lines: List[str] = []
        for line in raw_req.splitlines():
            matched = False
            for pkg, fix in fix_map.items():
                pattern = rf"^({re.escape(pkg)})\s*([=><~^]+)\s*([a-zA-Z0-9_\-\.\+]+)"
                if re.match(pattern, line.strip(), re.IGNORECASE):
                    new_req_lines.append(f"{pkg}=={fix}")
                    matched = True
                    break
            if not matched:
                new_req_lines.append(line)

        updated_req = "\n".join(new_req_lines)
        req_diff = list(
            difflib.unified_diff(
                raw_req.splitlines(),
                new_req_lines,
                fromfile="a/requirements.txt (current)",
                tofile="b/requirements.txt (remediated)",
                lineterm="",
            )
        )
        if req_diff:
            all_diffs.extend(req_diff)

    # 2. Update package.json
    if raw_pkg and any(f["ecosystem"] == "npm" for f in findings):
        try:
            pkg_data = json.loads(raw_pkg)
            modified = False
            for key in ("dependencies", "devDependencies"):
                if isinstance(pkg_data.get(key), dict):
                    for pkg_name, cur_v in pkg_data[key].items():
                        if pkg_name.lower() in fix_map:
                            pkg_data[key][pkg_name] = f"^{fix_map[pkg_name.lower()]}"
                            modified = True
            if modified:
                updated_pkg = json.dumps(pkg_data, indent=2) + "\n"
                pkg_diff = list(
                    difflib.unified_diff(
                        raw_pkg.splitlines(),
                        updated_pkg.splitlines(),
                        fromfile="a/package.json (current)",
                        tofile="b/package.json (remediated)",
                        lineterm="",
                    )
                )
                if pkg_diff:
                    all_diffs.extend(pkg_diff)
        except Exception:
            pass

    full_patch = "\n".join(all_diffs)
    return {
        "patch": full_patch,
        "requirements": updated_req,
        "package_json": updated_pkg,
    }


async def create_remediation_pr(
    run_id: int,
    repo: str,
    findings: List[Dict[str, Any]],
    diff_data: Dict[str, str],
    is_urgent: bool = False,
    force_dry_run: Optional[bool] = None,
    db_path: Optional[str] = None,
) -> Optional[str]:
    """Autonomous Pull Request generator with automated safe dependency upgrades."""
    is_dry = DRY_RUN if force_dry_run is None else force_dry_run
    branch_name = f"vulnwatch/fix-run-{run_id}"

    if is_dry or not GITHUB_TOKEN:
        await log_event(
            run_id,
            "Remediation",
            "info",
            f"Autonomous Pull Request generated (branch: {branch_name}, DRY_RUN active).",
            db_path=db_path,
        )
        return f"https://github.com/{repo}/pull/preview-run-{run_id}"

    # Real GitHub Pull Request creation
    try:
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": f"Bearer {GITHUB_TOKEN}",
            "User-Agent": "VulnerabilityWatch-Agent/1.0",
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            # 1. Fetch repo info & default branch
            repo_resp = await client.get(f"https://api.github.com/repos/{repo}", headers=headers)
            repo_resp.raise_for_status()
            default_branch = repo_resp.json().get("default_branch", "main")

            # 2. Get default branch head commit SHA
            ref_resp = await client.get(
                f"https://api.github.com/repos/{repo}/git/ref/heads/{default_branch}", headers=headers
            )
            ref_resp.raise_for_status()
            base_sha = ref_resp.json()["object"]["sha"]

            # 3. Create branch
            create_ref_payload = {"ref": f"refs/heads/{branch_name}", "sha": base_sha}
            await client.post(
                f"https://api.github.com/repos/{repo}/git/refs",
                json=create_ref_payload,
                headers=headers,
            )

            # 4. Open Pull Request
            p0_count = sum(1 for f in findings if f.get("priority") == "P0")
            title = f"[Vulnerability Watch] Security Remediation: Upgrade {len(findings)} dependencies"
            if is_urgent:
                title = f"[URGENT] {title} ({p0_count} P0)"

            pr_body = (
                f"## Automated Security Remediation\n\n"
                f"This pull request was autonomously prepared by **Vulnerability Watch** "
                f"to resolve known vulnerabilities identified in Run `#{run_id}`.\n\n"
                f"### Changes applied\n"
                f"```diff\n{diff_data.get('patch', 'No diff available.')[:1500]}\n```\n\n"
                f"Generated autonomously by Vulnerability Watch."
            )
            pr_payload = {
                "title": title,
                "head": branch_name,
                "base": default_branch,
                "body": pr_body,
            }
            pr_resp = await client.post(
                f"https://api.github.com/repos/{repo}/pulls", json=pr_payload, headers=headers
            )
            pr_resp.raise_for_status()
            pr_url = pr_resp.json().get("html_url")

            await log_event(
                run_id,
                "Remediation",
                "info",
                f"Successfully opened GitHub Pull Request: {pr_url}",
                db_path=db_path,
            )
            return pr_url
    except Exception as e:
        await log_event(
            run_id, "Remediation", "warning", f"Could not create GitHub PR: {e}", db_path=db_path
        )
        return None


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
