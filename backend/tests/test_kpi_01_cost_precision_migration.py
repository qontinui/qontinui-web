"""Behaviour test for the ``kpi_01`` revision.

Plan ``2026-10-09-kpi-telemetry-and-dashboards`` Phase 0. Pins the contract the
runner writer relies on: ``kpi_01`` adds
``project.phase_token_usage.cost_microusd`` (BIGINT NULL) and ``cost_source``
(TEXT NULL) with ``ck_phase_token_usage_cost_source`` and
``ck_phase_token_usage_cost_microusd_nonneg``; its downgrade removes
all four. Each CHECK is asserted by its exact definition and by a refused
write, and the re-run path (objects already present) is exercised.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
)

_KPI01 = "kpi_01_phase_token_usage_cost_precision"
_KPI01_FILENAME = "kpi_01_phase_token_usage_cost_precision.py"


def _parent_revision_id() -> str:
    """Parse ``kpi_01``'s own ``down_revision`` at runtime.

    Never hardcode the parent: the revision is re-pointed at whatever head
    lands ahead of it.
    """
    source = (backend_root() / "alembic" / "versions" / _KPI01_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _KPI01_FILENAME)


_PARENT = _parent_revision_id()

_TABLE = "project.phase_token_usage"
_CHECK_DEFS: dict[str, str] = {
    "ck_phase_token_usage_cost_source": (
        "CHECK ((cost_source = ANY (ARRAY['reported'::text, 'estimated'::text])))"
    ),
    "ck_phase_token_usage_cost_microusd_nonneg": (
        "CHECK (((cost_microusd IS NULL) OR (cost_microusd >= 0)))"
    ),
}


def _constraint_def(engine: Engine, name: str, relation: str) -> str | None:
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conname = :name AND conrelid = CAST(:rel AS regclass)
                """
            ),
            {"name": name, "rel": relation},
        ).scalar_one_or_none()


def _assert_absent(engine: Engine) -> None:
    """Neither column nor either CHECK exists: the pre-``kpi_01`` shape."""
    for column in ("cost_microusd", "cost_source"):
        assert column_info(engine, "phase_token_usage", column, "project") is None
    for name in _CHECK_DEFS:
        assert _constraint_def(engine, name, _TABLE) is None, name


def _assert_present(engine: Engine) -> None:
    """Both columns and both CHECKs exist, each by its exact definition."""
    assert column_info(engine, "phase_token_usage", "cost_microusd", "project") == (
        "bigint",
        "YES",
        None,
    )
    assert column_info(engine, "phase_token_usage", "cost_source", "project") == (
        "text",
        "YES",
        None,
    )
    for name, expected in _CHECK_DEFS.items():
        assert _constraint_def(engine, name, _TABLE) == expected, name


def _update_refused(engine: Engine, constraint: str, assignment: str) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE project.phase_token_usage SET {assignment} "
                    "WHERE task_run_id = 'kpi-test-run'"
                )
            )
    assert constraint in str(excinfo.value), str(excinfo.value)


def _update(engine: Engine, assignment: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"UPDATE project.phase_token_usage SET {assignment} "
                "WHERE task_run_id = 'kpi-test-run'"
            )
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_kpi_01_shape_constraint_and_reversal() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "kpi_usage_test") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT)
        _assert_absent(engine)

        run_alembic(root, url, "upgrade", _KPI01)
        _assert_present(engine)

        # And each CHECK actually refuses: an UPDATE to a bad value fails
        # (a no-row UPDATE would not reach the CHECK, so seed a real row first).
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO project.task_runs (id, task_name, status)
                    VALUES ('kpi-test-run', 'kpi', 'running')
                    """
                )
            )
            conn.execute(
                text(
                    """
                    INSERT INTO project.phase_token_usage (task_run_id, phase)
                    VALUES ('kpi-test-run', 'p')
                    """
                )
            )
        _update_refused(
            engine, "ck_phase_token_usage_cost_source", "cost_source = 'guessed'"
        )
        _update_refused(
            engine, "ck_phase_token_usage_cost_microusd_nonneg", "cost_microusd = -1"
        )
        # Every vocabulary value, zero cost, and a return to NULL are accepted.
        _update(engine, "cost_source = 'reported', cost_microusd = 1234")
        _update(engine, "cost_source = 'estimated', cost_microusd = 0")
        _update(engine, "cost_source = NULL, cost_microusd = NULL")

        # --- re-run: the IF NOT EXISTS / pg_constraint guards --------------
        # Re-apply kpi_01 over a schema that already has every object it adds.
        run_alembic(root, url, "stamp", _PARENT)
        run_alembic(root, url, "upgrade", _KPI01)
        _assert_present(engine)

        # --- reversal ------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT)
        _assert_absent(engine)
