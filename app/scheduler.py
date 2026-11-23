"""Simple background asyncio scheduler for periodic repository scanning."""

import asyncio
from typing import Optional
import aiosqlite

from app.config import DATABASE_PATH, SCAN_INTERVAL_MIN
from app.coordinator import Coordinator


class BackgroundScheduler:
    """Asyncio background task scheduler for watched repositories."""

    def __init__(self, interval_minutes: int = SCAN_INTERVAL_MIN, db_path: str = DATABASE_PATH) -> None:
        self.interval_seconds = max(interval_minutes, 1) * 60
        self.db_path = db_path
        self._task: Optional[asyncio.Task] = None
        self._running: bool = False

    async def _loop(self) -> None:
        """Periodic scanning loop."""
        while self._running:
            try:
                await asyncio.sleep(self.interval_seconds)
                if not self._running:
                    break

                async with aiosqlite.connect(self.db_path) as db:
                    db.row_factory = aiosqlite.Row
                    cursor = await db.execute(
                        "SELECT full_name FROM repos WHERE watched = 1"
                    )
                    watched_repos = await cursor.fetchall()

                coordinator = Coordinator(db_path=self.db_path)
                for row in watched_repos:
                    repo_name = row["full_name"]
                    run_id = await coordinator.create_run(repo=repo_name, trigger="schedule")
                    asyncio.create_task(coordinator.execute_run(run_id=run_id))
            except asyncio.CancelledError:
                break
            except Exception:
                # Keep scheduler resilient against temporary errors
                await asyncio.sleep(10)

    def start(self) -> None:
        """Start scheduler background task."""
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._loop())

    def stop(self) -> None:
        """Stop scheduler."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()


# Global scheduler instance
scheduler = BackgroundScheduler()
