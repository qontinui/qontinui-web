"""Shape tests for ``FleetRegistry.get_all_running_tasks``.

The runner's ``GET /task-runs/running`` returns an ENVELOPE —
``{"scope": ..., "task_runs": [...]}`` — not a bare array. It changed because
an operator read ``[]``, concluded the runner was idle, and nearly restarted
it while 23 live agent sessions were running; ``scope`` states that the list
is a port-filtered *workflow* task-run ledger and NOT a session census.

The aggregator used to accept three shapes (bare list, ``data``,
``task_runs``). Only the envelope exists now, so it reads ``task_runs``
directly — and a future shape change must surface as a logged failure with an
empty result, never as a silently-plausible "nothing is running".

Plan: 2026-08-29-no-single-answer-to-is-it-safe-to-restart-the-runner.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import patch

from app.schemas.dev_dashboard import RunnerHeartbeat
from app.services.dev_dashboard_service import FleetRegistry

SCOPE = (
    "workflow task-runs on API port 9876; NOT a session census — see /restart-readiness"
)


class _FakeResponse:
    def __init__(self, payload: Any) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> Any:
        return self._payload


class _FakeAsyncClient:
    """Stands in for ``httpx.AsyncClient`` — every GET returns one payload."""

    payload: Any = None

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    async def get(self, url: str, params: Any = None) -> _FakeResponse:
        return _FakeResponse(type(self).payload)


def _registry_with_one_runner() -> FleetRegistry:
    registry = FleetRegistry()
    asyncio.run(
        registry.register_heartbeat(
            RunnerHeartbeat(
                hostname="envelope-host",
                ip="192.168.1.77",
                port=9876,
                instance_name="primary",
                os="linux",
            )
        )
    )
    return registry


def _run(payload: Any) -> list[dict[str, Any]]:
    registry = _registry_with_one_runner()
    _FakeAsyncClient.payload = payload
    with patch(
        "app.services.dev_dashboard_service.httpx.AsyncClient",
        _FakeAsyncClient,
    ):
        return asyncio.run(registry.get_all_running_tasks())


class TestRunningTaskEnvelope:
    def test_reads_task_runs_out_of_the_envelope(self) -> None:
        tasks = _run(
            {
                "scope": SCOPE,
                "task_runs": [
                    {
                        "id": "run-1",
                        "status": "running",
                        "prompt": "do the thing",
                        "started_at": "2026-08-29T12:00:00Z",
                        "workflow_name": "wf",
                    }
                ],
            }
        )

        assert len(tasks) == 1
        assert tasks[0]["id"] == "run-1"
        assert tasks[0]["runner_id"] == "envelope-host:9876"
        assert tasks[0]["status"] == "running"
        assert tasks[0]["workflow_name"] == "wf"

    def test_empty_ledger_yields_no_tasks(self) -> None:
        assert _run({"scope": SCOPE, "task_runs": []}) == []

    def test_a_bare_array_is_no_longer_accepted(self) -> None:
        # The pre-envelope shape is gone. It must fail (logged, empty) rather
        # than be quietly tolerated by a back-compat branch.
        assert _run([{"id": "run-1", "status": "running"}]) == []
