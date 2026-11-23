"""Coordinator agent: run lifecycle, planning, task scheduling, retries, and autonomy rules."""

import asyncio
from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Dict, List, Optional
import aiosqlite

from app.agents.advisory import check_package_vulnerabilities
from app.agents.analyst import analyze_findings
from app.agents.scanner import scan_repo
from app.config import DATABASE_PATH, DEMO_INJECT_FAILURE
from app.events import broadcast_run_update, broadcast_task_update, log_event


def compute_findings_hash(findings: List[Dict[str, Any]]) -> str:
    """Compute deterministic SHA-256 hash for sorted findings set."""
    normalized = sorted(
        [f"{f['package']}:{f['ecosystem']}:{f.get('vuln_id', '')}:{f.get('priority', '')}" for f in findings]
    )
    payload = "|".join(normalized)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


class Coordinator:
    """Orchestrates multi-agent execution pipeline with failure handling and autonomy rules."""

    def __init__(self, db_path: str = DATABASE_PATH) -> None:
        self.db_path = db_path

    async def _log(self, run_id: int, agent: str, level: str, message: str) -> dict:
        """Helper to log event with this coordinator's db_path."""
        return await log_event(run_id, agent, level, message, db_path=self.db_path)

    async def create_run(self, repo: str, trigger: str = "manual") -> int:
        """Create a new run entry in queued status."""
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "INSERT INTO runs (repo, trigger, status, urgent) VALUES (?, ?, 'queued', 0)",
                (repo, trigger),
            )
            await db.commit()
            return cursor.lastrowid

    async def _create_task(self, run_id: int, agent: str, label: str) -> int:
        """Create a tracked task for the live timeline."""
        now = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "INSERT INTO tasks (run_id, agent, label, status, attempts, started_at) "
                "VALUES (?, ?, ?, 'pending', 0, ?)",
                (run_id, agent, label, now),
            )
            await db.commit()
            task_id = cursor.lastrowid

        task_data = {
            "id": task_id,
            "run_id": run_id,
            "agent": agent,
            "label": label,
            "status": "pending",
            "attempts": 0,
        }
        await broadcast_task_update(run_id, task_data)
        return task_id

    async def _update_task(
        self,
        task_id: int,
        run_id: int,
        agent: str,
        label: str,
        status: str,
        attempts: int,
        result: Optional[Any] = None,
    ) -> None:
        """Update task status and broadcast via SSE."""
        now = datetime.now(timezone.utc).isoformat()
        res_json = json.dumps(result) if result is not None else None
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "UPDATE tasks SET status = ?, attempts = ?, result_json = ?, finished_at = ? "
                "WHERE id = ?",
                (status, attempts, res_json, now if status in ("done", "degraded", "failed") else None, task_id),
            )
            await db.commit()

        task_data = {
            "id": task_id,
            "run_id": run_id,
            "agent": agent,
            "label": label,
            "status": status,
            "attempts": attempts,
        }
        await broadcast_task_update(run_id, task_data)

    async def _run_advisory_with_retry(
        self,
        run_id: int,
        dep: Dict[str, str],
        inject_failure: bool,
    ) -> List[Dict[str, Any]]:
        """Run advisory check for one package with up to 3 attempts and backoff."""
        label = f"Advisory: {dep['name']} ({dep['version']})"
        task_id = await self._create_task(run_id, "Advisory", label)
        attempts = 0
        max_attempts = 3

        while attempts < max_attempts:
            attempts += 1
            await self._update_task(task_id, run_id, "Advisory", label, "running", attempts)

            # Failure injection rule: simulate failure on first attempt
            if inject_failure and attempts == 1:
                await self._log(
                    run_id,
                    "Advisory",
                    "warning",
                    f"Injected demo failure for {dep['name']} (attempt 1/3 simulated timeout)",
                )
                await self._update_task(task_id, run_id, "Advisory", label, "retrying", attempts)
                await asyncio.sleep(0.5)
                continue

            try:
                findings = await check_package_vulnerabilities(dep)
                await self._update_task(
                    task_id, run_id, "Advisory", label, "done", attempts, findings
                )
                return findings
            except Exception as e:
                if attempts < max_attempts:
                    await self._log(
                        run_id,
                        "Advisory",
                        "warning",
                        f"{dep['name']}: attempt {attempts}/{max_attempts} failed ({e}). Retrying...",
                    )
                    await self._update_task(task_id, run_id, "Advisory", label, "retrying", attempts)
                    await asyncio.sleep(0.4 * (2 ** (attempts - 1)))
                else:
                    await self._log(
                        run_id,
                        "Advisory",
                        "error",
                        f"{dep['name']}: failed after {max_attempts} attempts. Marked degraded.",
                    )
                    await self._update_task(task_id, run_id, "Advisory", label, "degraded", attempts)
                    return []
        return []

    async def execute_run(
        self,
        run_id: int,
        inject_failure: Optional[bool] = None,
        custom_scanner_deps: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """Execute full autonomous run lifecycle."""
        should_inject = DEMO_INJECT_FAILURE if inject_failure is None else inject_failure

        # 1. Fetch run info & mark running
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM runs WHERE id = ?", (run_id,))
            run_row = await cursor.fetchone()
            if not run_row:
                raise ValueError(f"Run {run_id} not found")
            repo = run_row["repo"]
            await db.execute(
                "UPDATE runs SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?",
                (run_id,),
            )
            await db.commit()

        await self._log(run_id, "Coordinator", "info", f"Initiated autonomous run for {repo}")
        await broadcast_run_update(run_id, {"status": "running", "repo": repo})

        # 2. Scanner Agent
        scanner_task_id = await self._create_task(run_id, "Scanner", f"Scan {repo} dependencies")
        await self._update_task(scanner_task_id, run_id, "Scanner", f"Scan {repo} dependencies", "running", 1)

        try:
            if custom_scanner_deps is not None:
                deps = custom_scanner_deps
            else:
                deps = await scan_repo(repo)
            await self._update_task(scanner_task_id, run_id, "Scanner", f"Scan {repo} dependencies", "done", 1, deps)
            await self._log(run_id, "Scanner", "info", f"Discovered {len(deps)} pinned dependencies")
        except Exception as e:
            await self._update_task(scanner_task_id, run_id, "Scanner", f"Scan {repo} dependencies", "failed", 1)
            await self._log(run_id, "Scanner", "error", f"Scanner failed: {e}")
            await self._finalize_run(run_id, "failed", f"Scanner error: {e}")
            return {"status": "failed", "error": str(e)}

        # Autonomy Rule 1: Zero dependencies found
        if not deps:
            msg = "Clean scan: No dependencies found in repository."
            await self._log(run_id, "Coordinator", "info", msg)
            await self._finalize_run(run_id, "done", msg, issue_url=None)
            return {"status": "done", "summary": msg, "findings": []}

        # 3. Parallel Advisory Agents
        await self._log(run_id, "Coordinator", "info", f"Spawning {len(deps)} parallel Advisory agents")
        advisory_coros = [
            self._run_advisory_with_retry(
                run_id=run_id,
                dep=dep,
                inject_failure=(should_inject and idx == 0),
            )
            for idx, dep in enumerate(deps)
        ]
        advisory_results = await asyncio.gather(*advisory_coros)
        raw_findings: List[Dict[str, Any]] = [f for sublist in advisory_results for f in sublist]

        # Autonomy Rule 4: No vulnerabilities found
        if not raw_findings:
            msg = f"All clear: No known vulnerabilities found across {len(deps)} dependencies."
            await self._log(run_id, "Coordinator", "info", msg)
            await self._finalize_run(run_id, "done", msg, issue_url=None)
            return {"status": "done", "summary": msg, "findings": []}

        # 4. Analyst Agent (KEV matching + priority + impact)
        analyst_task_id = await self._create_task(run_id, "Analyst", f"Assess {len(raw_findings)} findings")
        await self._update_task(analyst_task_id, run_id, "Analyst", f"Assess {len(raw_findings)} findings", "running", 1)
        await self._log(run_id, "Analyst", "info", f"Analyzing severity and CISA KEV catalog for {len(raw_findings)} findings")

        analyzed_findings = await analyze_findings(raw_findings)
        await self._update_task(analyst_task_id, run_id, "Analyst", f"Assess {len(raw_findings)} findings", "done", 1)

        # Autonomy Rule 3: Check for urgent / P0 findings
        is_urgent = any(f["priority"] == "P0" for f in analyzed_findings)
        if is_urgent:
            await self._log(
                run_id, "Coordinator", "warning", "Run marked URGENT: P0/actively-exploited vulnerabilities identified!"
            )

        # Save findings to SQLite
        await self._save_findings(run_id, analyzed_findings)

        # 5. Remediation Agent
        finding_hash = compute_findings_hash(analyzed_findings)
        is_duplicate = await self._check_duplicate_issue(repo, finding_hash)

        remediation_task_id = await self._create_task(run_id, "Remediation", "Generate fix plan and GitHub issue")
        await self._update_task(remediation_task_id, run_id, "Remediation", "Generate fix plan and GitHub issue", "running", 1)

        issue_url = None
        pr_url = None
        if is_duplicate:
            # Autonomy Rule 5: Duplicate suppression
            await self._log(
                run_id, "Remediation", "info", f"Duplicate suppressed: identical finding hash ({finding_hash}) already open."
            )
            await self._update_task(
                remediation_task_id, run_id, "Remediation", "Duplicate issue suppressed", "done", 1
            )
        else:
            from app.agents.remediation import (
                create_remediation_issue,
                create_remediation_pr,
                generate_remediation_diff,
            )
            issue_url = await create_remediation_issue(
                run_id, repo, analyzed_findings, is_urgent, db_path=self.db_path
            )
            diff_data = generate_remediation_diff(repo, analyzed_findings)
            pr_url = await create_remediation_pr(
                run_id, repo, analyzed_findings, diff_data, is_urgent=is_urgent, db_path=self.db_path
            )
            await self._update_task(
                remediation_task_id, run_id, "Remediation", "Generate fix plan and GitHub issue/PR", "done", 1
            )

        summary = f"Completed with {len(analyzed_findings)} findings ({sum(1 for f in analyzed_findings if f['priority']=='P0')} P0)."
        await self._finalize_run(
            run_id,
            status="done",
            summary=summary,
            urgent=1 if is_urgent else 0,
            issue_url=issue_url,
            pr_url=pr_url,
            finding_hash=finding_hash,
        )
        await self._log(run_id, "Coordinator", "info", f"Run completed successfully. {summary}")

        return {
            "status": "done",
            "urgent": is_urgent,
            "summary": summary,
            "findings": analyzed_findings,
            "issue_url": issue_url,
            "pr_url": pr_url,
            "finding_hash": finding_hash,
        }

    async def _save_findings(self, run_id: int, findings: List[Dict[str, Any]]) -> None:
        """Persist findings to SQLite with KEV and EPSS metrics."""
        async with aiosqlite.connect(self.db_path) as db:
            for f in findings:
                aliases_str = json.dumps(f.get("aliases", []))
                await db.execute(
                    "INSERT INTO findings (run_id, package, ecosystem, version, vuln_id, aliases, "
                    "severity, in_kev, epss_score, epss_percentile, priority, impact, fixed_version) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        run_id,
                        f["package"],
                        f["ecosystem"],
                        f["version"],
                        f["vuln_id"],
                        aliases_str,
                        f.get("severity", "UNKNOWN"),
                        f.get("in_kev", 0),
                        f.get("epss_score", 0.0),
                        f.get("epss_percentile", 0.0),
                        f.get("priority", "P3"),
                        f.get("impact", ""),
                        f.get("fixed_version"),
                    ),
                )
            await db.commit()

    async def _check_duplicate_issue(self, repo: str, finding_hash: str) -> bool:
        """Check if an open issue with the same finding hash already exists for this repo."""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, issue_url FROM runs WHERE repo = ? AND finding_hash = ? "
                "AND issue_url IS NOT NULL AND status = 'done' LIMIT 1",
                (repo, finding_hash),
            )
            row = await cursor.fetchone()
            return row is not None

    async def _finalize_run(
        self,
        run_id: int,
        status: str,
        summary: str,
        urgent: int = 0,
        issue_url: Optional[str] = None,
        pr_url: Optional[str] = None,
        finding_hash: Optional[str] = None,
    ) -> None:
        """Mark run status and finished timestamp."""
        now = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "UPDATE runs SET status = ?, summary = ?, urgent = ?, issue_url = ?, "
                "pr_url = ?, finding_hash = ?, finished_at = ? WHERE id = ?",
                (status, summary, urgent, issue_url, pr_url, finding_hash, now, run_id),
            )
            await db.commit()

        run_update = {
            "id": run_id,
            "status": status,
            "summary": summary,
            "urgent": urgent,
            "issue_url": issue_url,
            "pr_url": pr_url,
            "finished_at": now,
        }
        await broadcast_run_update(run_id, run_update)
