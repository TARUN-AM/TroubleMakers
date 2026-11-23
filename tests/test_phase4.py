"""Unit tests for Phase 4: Coordinator autonomy rules and lifecycle."""

import pytest
import aiosqlite
from app.coordinator import Coordinator, compute_findings_hash
from app.db import init_db


@pytest.fixture
async def setup_test_db(tmp_path):
    """Fixture to set up a clean temporary SQLite database for each test."""
    db_file = str(tmp_path / "coordinator_test.db")
    await init_db(db_file)
    return db_file


@pytest.mark.asyncio
async def test_rule1_zero_dependencies_clean_exit(setup_test_db) -> None:
    """Autonomy Rule 1: Zero dependencies cleanly finishes run without errors or issues."""
    coordinator = Coordinator(db_path=setup_test_db)
    run_id = await coordinator.create_run("org/empty-repo", trigger="manual")

    result = await coordinator.execute_run(run_id, custom_scanner_deps=[])
    assert result["status"] == "done"
    assert "No dependencies found" in result["summary"]
    assert result["findings"] == []

    # Check database state
    async with aiosqlite.connect(setup_test_db) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM runs WHERE id = ?", (run_id,))
        row = await cur.fetchone()
        assert row["status"] == "done"
        assert row["issue_url"] is None


@pytest.mark.asyncio
async def test_rule4_zero_vulnerabilities_all_clear(setup_test_db) -> None:
    """Autonomy Rule 4: Clean dependencies with no vulnerabilities exits all clear."""
    coordinator = Coordinator(db_path=setup_test_db)
    run_id = await coordinator.create_run("org/safe-repo", trigger="manual")

    # Pass a modern dependency with 0 known vulns or mock
    safe_deps = [{"ecosystem": "PyPI", "name": "safe-package-xyz-12345", "version": "99.0.0"}]
    result = await coordinator.execute_run(run_id, custom_scanner_deps=safe_deps)
    assert result["status"] == "done"
    assert "All clear" in result["summary"]
    assert result["findings"] == []


@pytest.mark.asyncio
async def test_rule6_demo_failure_injection_retry(setup_test_db) -> None:
    """Autonomy Rule 6: Injected failure causes attempt 1 to fail, retrying and succeeding."""
    coordinator = Coordinator(db_path=setup_test_db)
    run_id = await coordinator.create_run("org/test-repo", trigger="manual")

    deps = [{"ecosystem": "PyPI", "name": "requests", "version": "2.20.0"}]
    result = await coordinator.execute_run(run_id, inject_failure=True, custom_scanner_deps=deps)

    assert result["status"] == "done"
    assert len(result["findings"]) > 0

    # Verify tasks table recorded retry
    async with aiosqlite.connect(setup_test_db) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM tasks WHERE run_id = ? AND agent = 'Advisory'", (run_id,))
        tasks = await cur.fetchall()
        assert len(tasks) == 1
        assert tasks[0]["attempts"] >= 2
        assert tasks[0]["status"] == "done"


@pytest.mark.asyncio
async def test_rule5_duplicate_suppression(setup_test_db) -> None:
    """Autonomy Rule 5: Suppress duplicate issue creation for identical findings hash."""
    coordinator = Coordinator(db_path=setup_test_db)

    # Pre-populate an existing completed run with an issue_url and finding_hash
    test_hash = "abc123hash"
    async with aiosqlite.connect(setup_test_db) as db:
        await db.execute(
            "INSERT INTO runs (repo, trigger, status, finding_hash, issue_url) "
            "VALUES ('org/dup-repo', 'manual', 'done', ?, 'https://github.com/org/dup-repo/issues/1')",
            (test_hash,),
        )
        await db.commit()

    is_dup = await coordinator._check_duplicate_issue("org/dup-repo", test_hash)
    assert is_dup is True

    is_not_dup = await coordinator._check_duplicate_issue("org/other-repo", test_hash)
    assert is_not_dup is False
