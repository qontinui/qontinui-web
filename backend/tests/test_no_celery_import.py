"""Regression guard — Celery/RedBeat must stay dead.

Celery + RedBeat were deleted (plan 2026-07-12-backend-inprocess-scheduler):
prod runs only ``web: uvicorn`` and no worker/beat process was ever deployed,
so every Celery task silently never executed. All periodic work now runs in the
in-process asyncio scheduler (:mod:`app.core.scheduler`).

This test bans the dead pattern from coming back — the same "ban the dead
pattern" idiom coord uses for its schema-authorship test. It scans the AST of
every module under ``app/`` for a Celery/RedBeat import, so a re-introduced
dependency fails CI instead of quietly re-creating a never-running task queue.

Comments and docstrings that MENTION celery (explaining why it's gone) are fine
— only real imports fail.
"""

from __future__ import annotations

import ast
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent / "app"

BANNED_ROOTS = {"celery", "redbeat", "celery_redbeat", "flower"}


def _banned(module: str | None) -> bool:
    """True if ``module`` is (or is inside) a banned package."""
    if not module:
        return False
    return module.split(".")[0] in BANNED_ROOTS


def _offending_imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    hits: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if _banned(alias.name):
                    hits.append(f"{path}:{node.lineno}: import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            # Ignore relative imports (node.level > 0); they can't reach celery.
            if node.level == 0 and _banned(node.module):
                hits.append(f"{path}:{node.lineno}: from {node.module} import ...")
    return hits


def test_no_celery_or_redbeat_import_under_app() -> None:
    """No module under app/ may import celery or redbeat."""
    offenders: list[str] = []
    for path in APP_ROOT.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        offenders.extend(_offending_imports(path))

    assert not offenders, (
        "Celery/RedBeat imports are banned — periodic work belongs in "
        "app.core.scheduler (the in-process asyncio scheduler). Found:\n"
        + "\n".join(offenders)
    )


def test_celery_app_module_is_gone() -> None:
    """The old Celery entrypoint must not come back."""
    assert not (APP_ROOT / "celery_app.py").exists(), (
        "app/celery_app.py is back — Celery was deleted; use app.core.scheduler."
    )
    assert not (APP_ROOT / "services" / "redbeat_manager.py").exists(), (
        "app/services/redbeat_manager.py is back — schedule state lives in "
        "scheduled_workflow_runs.next_fire_at, not Redis."
    )


def test_scheduler_registers_the_former_celery_beat_tasks() -> None:
    """The four former beat tasks + dispatch + cleanups are registered."""
    from app.core.scheduler import scheduler

    registered = set(scheduler.status())
    expected = {
        "memory_decay",
        "memory_reindex",
        "memory_consolidate",
        "memory_bridge_sync",
        "scheduled_dispatch",
        "clipboard_cleanup",
        "file_cleanup",
    }
    missing = expected - registered
    assert not missing, f"scheduler lost tasks: {sorted(missing)}"
