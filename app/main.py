"""FastAPI application entry point, API routes, and Server-Sent Events."""

import asyncio
from contextlib import asynccontextmanager
import hashlib
import hmac
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional
import aiosqlite
from fastapi import FastAPI, Header, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from app.agents.remediation import (
    create_remediation_pr,
    format_remediation_issue_body,
    generate_remediation_diff,
)
from app.clients.github import validate_repo_name
from app.config import (
    DATABASE_PATH,
    DEMO_INJECT_FAILURE,
    GITHUB_WEBHOOK_SECRET,
    HOST,
    PORT,
)
from app.coordinator import Coordinator
from app.db import init_db
from app.events import event_bus
from app.scheduler import scheduler

BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


def verify_github_signature(
    payload: bytes, signature_header: Optional[str], secret: str
) -> bool:
    """Constant-time HMAC SHA-256 verification of GitHub webhook signatures."""
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    mac = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, signature_header[7:])


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize DB and background scheduler on startup."""
    await init_db()
    scheduler.start()
    yield
    scheduler.stop()


app = FastAPI(
    title="Vulnerability Watch",
    description="Autonomous Multi-Agent Security Remediation",
    version="1.0.0",
    lifespan=lifespan,
)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


class CreateRunRequest(BaseModel):
    repo: str
    inject_failure: Optional[bool] = None


class AddRepoRequest(BaseModel):
    full_name: str


class ToggleRepoRequest(BaseModel):
    watched: Optional[int] = None


class SimulatePushRequest(BaseModel):
    repo: str
    touched_files: List[str] = Field(default_factory=lambda: ["requirements.txt"])


@app.get("/api/health")
async def health_check() -> JSONResponse:
    """Health check endpoint."""
    return JSONResponse(
        content={
            "status": "ok",
            "version": "1.0.0",
            "database": "connected",
        }
    )


@app.get("/", response_class=HTMLResponse)
async def dashboard_view(request: Request) -> HTMLResponse:
    """Dashboard UI view."""
    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={},
    )


@app.get("/runs/{run_id}", response_class=HTMLResponse)
async def run_view(request: Request, run_id: int) -> HTMLResponse:
    """Run detail UI view."""
    return templates.TemplateResponse(
        request=request,
        name="run.html",
        context={"run_id": run_id},
    )


@app.post("/api/runs", status_code=status.HTTP_201_CREATED)
async def create_run(req: CreateRunRequest) -> JSONResponse:
    """Trigger a new scan run."""
    repo = req.repo.strip()
    if repo.lower() not in ("demo", "demo/vulnerable-app", "local/demo") and not validate_repo_name(repo):
        raise HTTPException(
            status_code=400,
            detail="Invalid repository format. Expected 'owner/repo' (e.g. psf/requests)",
        )

    coordinator = Coordinator()
    run_id = await coordinator.create_run(repo=repo, trigger="manual")
    inject = req.inject_failure if req.inject_failure is not None else DEMO_INJECT_FAILURE
    asyncio.create_task(coordinator.execute_run(run_id=run_id, inject_failure=inject))

    return JSONResponse(
        status_code=status.HTTP_201_CREATED,
        content={"run_id": run_id, "repo": repo, "status": "queued"},
    )


@app.get("/api/runs")
async def list_runs() -> JSONResponse:
    """List recent scan runs."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT r.*, COUNT(f.id) as findings_count
            FROM runs r
            LEFT JOIN findings f ON r.id = f.run_id
            GROUP BY r.id
            ORDER BY r.id DESC
            LIMIT 50
            """
        )
        rows = await cursor.fetchall()
        runs = [dict(r) for r in rows]
    return JSONResponse(content={"runs": runs})


@app.get("/api/runs/{run_id}")
async def get_run_detail(run_id: int) -> JSONResponse:
    """Get full details of a specific run."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Run
        cur = await db.execute("SELECT * FROM runs WHERE id = ?", (run_id,))
        run_row = await cur.fetchone()
        if not run_row:
            raise HTTPException(status_code=404, detail="Run not found")
        run_data = dict(run_row)

        # Tasks
        cur = await db.execute(
            "SELECT * FROM tasks WHERE run_id = ? ORDER BY id ASC", (run_id,)
        )
        tasks = [dict(r) for r in await cur.fetchall()]

        # Findings
        cur = await db.execute(
            "SELECT * FROM findings WHERE run_id = ? ORDER BY id ASC", (run_id,)
        )
        findings = [dict(r) for r in await cur.fetchall()]

        # Events
        cur = await db.execute(
            "SELECT * FROM events WHERE run_id = ? ORDER BY id ASC", (run_id,)
        )
        events = [dict(r) for r in await cur.fetchall()]

    issue_preview = ""
    diff_patch = ""
    if findings:
        issue_preview = format_remediation_issue_body(
            run_id=run_id,
            repo=run_data["repo"],
            findings=findings,
            is_urgent=bool(run_data["urgent"]),
        )
        diff_data = generate_remediation_diff(run_data["repo"], findings)
        diff_patch = diff_data.get("patch", "")

    return JSONResponse(
        content={
            "run": run_data,
            "tasks": tasks,
            "findings": findings,
            "events": events,
            "issue_preview": issue_preview,
            "diff_patch": diff_patch,
        }
    )


@app.post("/api/runs/{run_id}/create-pr")
async def trigger_run_pr(run_id: int) -> JSONResponse:
    """On-demand trigger to generate and open a GitHub Pull Request for a run."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM runs WHERE id = ?", (run_id,))
        run_row = await cur.fetchone()
        if not run_row:
            raise HTTPException(status_code=404, detail="Run not found")
        run_data = dict(run_row)

        cur = await db.execute("SELECT * FROM findings WHERE run_id = ?", (run_id,))
        findings = [dict(r) for r in await cur.fetchall()]

    if not findings:
        raise HTTPException(status_code=400, detail="No findings to remediate for this run")

    diff_data = generate_remediation_diff(run_data["repo"], findings)
    pr_url = await create_remediation_pr(
        run_id=run_id,
        repo=run_data["repo"],
        findings=findings,
        diff_data=diff_data,
        is_urgent=bool(run_data["urgent"]),
    )

    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("UPDATE runs SET pr_url = ? WHERE id = ?", (pr_url, run_id))
        await db.commit()

    return JSONResponse(content={"pr_url": pr_url, "branch": f"vulnwatch/fix-run-{run_id}"})


@app.get("/api/runs/{run_id}/stream")
async def stream_run_events(run_id: int) -> StreamingResponse:
    """Server-Sent Events endpoint streaming real-time run updates."""
    return StreamingResponse(
        event_bus.subscribe(run_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/repos")
async def list_repos() -> JSONResponse:
    """List watched repositories."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM repos ORDER BY full_name ASC")
        repos = [dict(r) for r in await cur.fetchall()]
    return JSONResponse(content={"repos": repos})


@app.post("/api/repos", status_code=status.HTTP_201_CREATED)
async def add_repo(req: AddRepoRequest) -> JSONResponse:
    """Add a repository to the watch list."""
    name = req.full_name.strip()
    if name.lower() not in ("demo", "demo/vulnerable-app") and not validate_repo_name(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid repository format. Expected 'owner/repo'",
        )

    async with aiosqlite.connect(DATABASE_PATH) as db:
        try:
            cur = await db.execute(
                "INSERT INTO repos (full_name, watched) VALUES (?, 1)", (name,)
            )
            await db.commit()
            repo_id = cur.lastrowid
        except Exception:
            raise HTTPException(status_code=409, detail="Repository already exists")

    return JSONResponse(
        status_code=status.HTTP_201_CREATED,
        content={"id": repo_id, "full_name": name, "watched": 1},
    )


@app.patch("/api/repos/{repo_id}")
async def toggle_repo_watch(repo_id: int, req: Optional[ToggleRepoRequest] = None) -> JSONResponse:
    """Toggle or set watched status for a repository."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM repos WHERE id = ?", (repo_id,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Repository not found")

        new_val = 1 - row["watched"] if (req is None or req.watched is None) else req.watched
        await db.execute("UPDATE repos SET watched = ? WHERE id = ?", (new_val, repo_id))
        await db.commit()

    return JSONResponse(content={"id": repo_id, "watched": new_val})


@app.delete("/api/repos/{repo_id}")
async def delete_repo(repo_id: int) -> JSONResponse:
    """Delete a repository from the database."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cur = await db.execute("DELETE FROM repos WHERE id = ?", (repo_id,))
        await db.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Repository not found")
    return JSONResponse(content={"status": "deleted", "id": repo_id})


@app.post("/webhook/github")
async def github_webhook(
    request: Request,
    x_hub_signature_256: Optional[str] = Header(None),
    x_github_event: Optional[str] = Header(None),
) -> JSONResponse:
    """Handle incoming GitHub push webhooks."""
    raw_body = await request.body()

    if GITHUB_WEBHOOK_SECRET and not verify_github_signature(
        raw_body, x_hub_signature_256, GITHUB_WEBHOOK_SECRET
    ):
        raise HTTPException(status_code=401, detail="Invalid HMAC webhook signature")

    if x_github_event != "push":
        return JSONResponse(content={"status": "ignored", "reason": f"Event '{x_github_event}' is not push"})

    payload = await request.json()
    repo_name = payload.get("repository", {}).get("full_name")
    if not repo_name:
        raise HTTPException(status_code=400, detail="Missing repository.full_name in payload")

    commits = payload.get("commits", [])
    touched_dependency = False
    for c in commits:
        files = c.get("added", []) + c.get("modified", []) + c.get("removed", [])
        for f in files:
            if f.endswith("requirements.txt") or f.endswith("package.json"):
                touched_dependency = True
                break
        if touched_dependency:
            break

    if not touched_dependency:
        return JSONResponse(content={"status": "ignored", "reason": "No dependency files touched in push"})

    coordinator = Coordinator()
    run_id = await coordinator.create_run(repo=repo_name, trigger="webhook")
    asyncio.create_task(coordinator.execute_run(run_id=run_id))

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={"status": "accepted", "run_id": run_id, "repo": repo_name},
    )


@app.post("/api/simulate-push")
async def simulate_push(req: SimulatePushRequest) -> JSONResponse:
    """Demo helper: simulate a GitHub push event touching dependency files."""
    repo = req.repo.strip()
    touched = any(
        f.endswith("requirements.txt") or f.endswith("package.json")
        for f in req.touched_files
    )

    if not touched:
        return JSONResponse(content={"status": "ignored", "reason": "No dependency files touched"})

    coordinator = Coordinator()
    run_id = await coordinator.create_run(repo=repo, trigger="push_simulation")
    asyncio.create_task(coordinator.execute_run(run_id=run_id))

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={"status": "accepted", "run_id": run_id, "repo": repo, "trigger": "push_simulation"},
    )
