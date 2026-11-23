"""Event logging and in-memory Pub/Sub for Server-Sent Events (SSE)."""

import asyncio
from collections import defaultdict
from datetime import datetime, timezone
import json
from typing import AsyncGenerator, Dict, Optional, Set
import aiosqlite
from app import config


class EventBus:
    """Manages real-time SSE event subscriptions for runs."""

    def __init__(self) -> None:
        self._subscribers: Dict[int, Set[asyncio.Queue]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, run_id: int) -> AsyncGenerator[str, None]:
        """Subscribe to events for a specific run_id and yield SSE chunks."""
        queue: asyncio.Queue = asyncio.Queue()
        async with self._lock:
            self._subscribers[run_id].add(queue)

        try:
            while True:
                data = await queue.get()
                if data is None:  # Shutdown or stream closed
                    break
                yield f"data: {json.dumps(data)}\n\n"
        finally:
            async with self._lock:
                if queue in self._subscribers[run_id]:
                    self._subscribers[run_id].remove(queue)
                if not self._subscribers[run_id]:
                    del self._subscribers[run_id]

    async def publish(self, run_id: int, payload: dict) -> None:
        """Publish payload to all active queues for the run."""
        async with self._lock:
            queues = list(self._subscribers.get(run_id, []))
        for q in queues:
            await q.put(payload)


# Global event bus instance
event_bus = EventBus()


async def log_event(
    run_id: int,
    agent: str,
    level: str,
    message: str,
    db_path: Optional[str] = None,
) -> dict:
    """Insert event into the database and broadcast via SSE."""
    target_db = db_path or config.DATABASE_PATH
    ts = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(target_db) as db:
        cursor = await db.execute(
            "INSERT INTO events (run_id, agent, level, message, ts) VALUES (?, ?, ?, ?, ?)",
            (run_id, agent, level, message, ts),
        )
        await db.commit()
        event_id = cursor.lastrowid

    event_data = {
        "type": "event",
        "id": event_id,
        "run_id": run_id,
        "ts": ts,
        "agent": agent,
        "level": level,
        "message": message,
    }
    await event_bus.publish(run_id, event_data)
    return event_data


async def broadcast_task_update(run_id: int, task: dict) -> None:
    """Broadcast a task status update to SSE subscribers."""
    payload = {
        "type": "task",
        "task": task,
    }
    await event_bus.publish(run_id, payload)


async def broadcast_run_update(run_id: int, run_data: dict) -> None:
    """Broadcast run level status updates to SSE subscribers."""
    payload = {
        "type": "run",
        "run": run_data,
    }
    await event_bus.publish(run_id, payload)
