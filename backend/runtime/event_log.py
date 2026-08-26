"""Durable append-only log for run events.

Run events are a case's visible history: the activity feed, the timeline rail and the
audit trail all read them back long after the run that produced them has ended, and a
Cloud Run restart must not erase them.

Writes are handed to a background thread rather than performed inline. A phase narrates
itself by pushing an event, and the live SSE stream serves those events out of memory —
if the push had to wait on a database round trip, a slow write would surface as a stalled
agent. Persistence therefore trails the live view by milliseconds and never blocks it.
"""

from __future__ import annotations

import atexit
import logging
import queue
import threading
import time
from typing import Any

from backend.state import store

_logger = logging.getLogger("caserelay.event_log")

# A run produces tens of events, so the queue only ever holds a backlog if Firestore is
# unreachable. Capping it means that failure costs lost history rather than the process.
_QUEUE_MAX = 5000

_FLUSH_TIMEOUT = 60.0


class _EventWriter:
    """Serialises durable event writes onto one background thread.

    One thread draining one FIFO queue keeps events stored in the order they were pushed,
    so the persisted history matches what the live stream showed. Sequence numbers are
    assigned by the caller at push time, so ordering does not depend on write timing.
    """

    def __init__(self) -> None:
        self._queue: queue.Queue[tuple[str, int, dict[str, Any]]] = queue.Queue(maxsize=_QUEUE_MAX)
        self._thread: threading.Thread | None = None
        self._start_lock = threading.Lock()
        self._dropped = 0

    def _ensure_running(self) -> None:
        thread = self._thread
        if thread is not None and thread.is_alive():
            return
        with self._start_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._drain, name="run-event-writer", daemon=True)
            self._thread.start()

    def append(self, run_id: str, seq: int, event: dict[str, Any]) -> None:
        if not store.enabled() or not run_id:
            return
        self._ensure_running()
        try:
            self._queue.put_nowait((run_id, seq, dict(event)))
        except queue.Full:
            self._dropped += 1
            _logger.warning(
                "run event queue full; dropped event %d for run %s (%d dropped in total)",
                seq, run_id, self._dropped,
            )

    def _drain(self) -> None:
        while True:
            run_id, seq, event = self._queue.get()
            try:
                store.save_run_event(run_id, seq, event)
            except Exception as exc:  # noqa: BLE001
                _logger.warning("could not persist event %d for run %s: %s", seq, run_id, exc)
            finally:
                self._queue.task_done()

    def flush(self, timeout: float = _FLUSH_TIMEOUT) -> bool:
        """Wait for queued events to be written. Returns False if the timeout was hit.

        Called when a run finishes and at interpreter exit, so a redeploy that lands
        moments after a run completes still leaves that run's history readable. The
        budget allows for a run's worth of events at the round-trip latency of a client
        running well away from the database, which is far slower than the deployment.
        """
        deadline = time.monotonic() + timeout
        while not self._queue.empty() or self._queue.unfinished_tasks:
            if time.monotonic() > deadline:
                _logger.warning("flush timed out with %d event(s) unwritten", self._queue.unfinished_tasks)
                return False
            time.sleep(0.02)
        return True


_writer = _EventWriter()


def append(run_id: str, seq: int, event: dict[str, Any]) -> None:
    _writer.append(run_id, seq, event)


def flush(timeout: float = _FLUSH_TIMEOUT) -> bool:
    return _writer.flush(timeout=timeout)


atexit.register(flush, 15.0)
