"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import HOST, PORT
from app.db import init_db

BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize DB and background services on startup."""
    await init_db()
    yield


app = FastAPI(
    title="Vulnerability Watch",
    description="Autonomous Multi-Agent Security Remediation",
    version="1.0.0",
    lifespan=lifespan,
)

# Mount static files
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


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
