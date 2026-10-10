"""Behaviour test for the ``kpi_01`` / ``kpi_02`` revisions.

Plan ``2026-10-09-kpi-telemetry-and-dashboards`` Phases 0 and 1. Pins the
contracts the runner and coord writers rely on:

1. ``kpi_01`` adds ``project.phase_token_usage.cost_microusd`` (BIGINT NULL) and
   ``cost_source`` (TEXT NULL) with ``ck_phase_token_usage_cost_source``, and
   its downgrade removes all three. The CHECK is asserted by its exact
   definition and by a refused write.
2. ``kpi_02`` creates ``coord.session_usage`` with the exact column contract,
   the composite primary key (an UPSERT target), every CHECK by its exact
   definition and by a refused row, the ``cost_source``
   vocabulary, honest defaults, and the feed index; downgrade drops it all.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

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
    index_exists,
    run_alembic,
    scalar,
    table_exists,
)

_KPI01 = "kpi_01_phase_token_usage_cost_precision"
_KPI01_FILENAME = "kpi_01_phase_token_usage_cost_precision.py"
_KPI02 = "kpi_02_coord_session_usage"


def _parent_revision_id() -> str:
    """Parse ``kpi_01``'s own ``down_revision`` at runtime.

    Never hardcode the parent: the pair is re-pointed at whatever head lands
    ahead of it.
    """
    source = (backend_root() / "alembic" / "versions" / _KPI01_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _KPI01_FILENAME)


_PARENT = _parent_revision_id()

_SESSION_USAGE_COLUMNS: dict[str, tuple[str, str]] = {
    "tenant_id": ("uuid", "NO"),
    "agent_session_id": ("uuid", "NO"),
    "model": ("text", "NO"),
    "input_tokens": ("bigint", "NO"),
    "output_tokens": ("bigint", "NO"),
    "cache_creation_input_tokens": ("bigint", "NO"),
    "cache_read_input_tokens": ("bigint", "NO"),
    "cost_microusd": ("bigint", "YES"),
    "cost_source": ("text", "YES"),
    "first_turn_at": ("timestamp with time zone", "YES"),
    "last_turn_at": ("timestamp with time zone", "YES"),
    "turn_count": ("integer", "NO"),
    "created_at": ("timestamp with time zone", "NO"),
    "updated_at": ("timestamp with time zone", "NO"),
}

_TENANT = uuid.UUID("3f6b1d2e-8a47-4c95-b0e3-6d1a9f2c7e58")
_S1 = uuid.UUID("0b7e2c41-9d3a-4f68-a215-7c8e1f4d2b90")
_S2 = uuid.UUID("5a19f3d8-2c6e-4b07-9e81-d4c2a7b06f13")
_S3 = uuid.UUID("c84d0e2a-71b5-4a39-8f6c-1e9b3d5a7c24")

_INSERT = text(
    """
    INSERT INTO coord.session_usage
        (tenant_id, agent_session_id, model, cost_source)
    VALUES (:tid, :sid, :model, :source)
    """
)


def _session_usage_columns(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = 'session_usage'
                """
            )
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


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


def _refused(engine: Engine, params: dict[str, object]) -> None:
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(_INSERT, params)


def _refused_row(engine: Engine, constraint: str, **columns: object) -> None:
    """Insert a ``session_usage`` row with ``columns`` set; ``constraint`` must refuse it."""
    names = ["tenant_id", "agent_session_id", "model", *columns]
    sql = text(
        f"INSERT INTO coord.session_usage ({', '.join(names)}) "
        f"VALUES ({', '.join(':' + n for n in names)})"
    )
    params = {"tenant_id": _TENANT, "agent_session_id": uuid.uuid4(), "model": "m"}
    params.update(columns)
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(sql, params)
    assert constraint in str(excinfo.value), str(excinfo.value)


_CHECK_DEFS: dict[str, str] = {
    "ck_session_usage_cost_source": (
        "CHECK ((cost_source = ANY (ARRAY['reported'::text, 'estimated'::text])))"
    ),
    "ck_session_usage_tokens_nonneg": (
        "CHECK (((input_tokens >= 0) AND (output_tokens >= 0) "
        "AND (cache_creation_input_tokens >= 0) AND (cache_read_input_tokens >= 0)))"
    ),
    "ck_session_usage_turn_count_nonneg": "CHECK ((turn_count >= 0))",
    "ck_session_usage_cost_microusd_nonneg": (
        "CHECK (((cost_microusd IS NULL) OR (cost_microusd >= 0)))"
    ),
    "ck_session_usage_turn_order": (
        "CHECK (((first_turn_at IS NULL) OR (last_turn_at IS NULL) "
        "OR (first_turn_at <= last_turn_at)))"
    ),
}


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_kpi_01_and_02_shape_constraints_and_reversal() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "kpi_usage_test") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT)
        assert (
            column_info(engine, "phase_token_usage", "cost_microusd", "project") is None
        )
        assert not table_exists(engine, "coord", "session_usage")

        # --- kpi_01: phase_token_usage precision columns -------------------
        run_alembic(root, url, "upgrade", _KPI01)
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
        definition = _constraint_def(
            engine, "ck_phase_token_usage_cost_source", "project.phase_token_usage"
        )
        assert definition == (
            "CHECK ((cost_source = ANY (ARRAY['reported'::text, 'estimated'::text])))"
        )
        # And it actually refuses: an UPDATE to an off-vocabulary value fails
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
        with pytest.raises(IntegrityError) as excinfo:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE project.phase_token_usage SET cost_source = 'guessed' "
                        "WHERE task_run_id = 'kpi-test-run'"
                    )
                )
        assert "ck_phase_token_usage_cost_source" in str(excinfo.value)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE project.phase_token_usage "
                    "SET cost_source = 'reported', cost_microusd = 1234 "
                    "WHERE task_run_id = 'kpi-test-run'"
                )
            )

        # --- kpi_02: coord.session_usage -----------------------------------
        run_alembic(root, url, "upgrade", _KPI02)
        assert table_exists(engine, "coord", "session_usage")
        assert _session_usage_columns(engine) == _SESSION_USAGE_COLUMNS
        assert index_exists(engine, "ix_session_usage_tenant_last_turn_at")
        indexdef = scalar(
            engine,
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'coord' "
            "AND indexname = 'ix_session_usage_tenant_last_turn_at'",
        )
        assert isinstance(indexdef, str)
        assert indexdef.endswith("(tenant_id, last_turn_at DESC NULLS LAST)"), indexdef
        for name, expected in _CHECK_DEFS.items():
            assert _constraint_def(engine, name, "coord.session_usage") == expected, (
                name
            )
        pk = _constraint_def(engine, "pk_session_usage", "coord.session_usage")
        assert pk == "PRIMARY KEY (tenant_id, agent_session_id, model)"

        # Defaults are honest: zero counters, NULL cost and NULL source.
        with engine.begin() as conn:
            conn.execute(
                _INSERT,
                {"tid": _TENANT, "sid": _S1, "model": "m-a", "source": None},
            )
        assert (
            scalar(
                engine,
                """
            SELECT (input_tokens, output_tokens, cache_creation_input_tokens,
                    cache_read_input_tokens, turn_count)::text
              FROM coord.session_usage
             WHERE agent_session_id = :sid AND model = 'm-a'
            """,
                sid=_S1,
            )
            == "(0,0,0,0,0)"
        )
        assert (
            scalar(
                engine,
                "SELECT cost_microusd IS NULL AND cost_source IS NULL "
                "FROM coord.session_usage WHERE agent_session_id = :sid",
                sid=_S1,
            )
            is True
        )

        # Both vocabulary values accepted; a second model is a second row.
        with engine.begin() as conn:
            conn.execute(
                _INSERT,
                {"tid": _TENANT, "sid": _S1, "model": "m-b", "source": "reported"},
            )
            conn.execute(
                _INSERT,
                {"tid": _TENANT, "sid": _S2, "model": "m-a", "source": "estimated"},
            )

        # Unknown vocabulary and a duplicate key are refused.
        _refused(
            engine, {"tid": _TENANT, "sid": _S3, "model": "m", "source": "guessed"}
        )
        _refused(engine, {"tid": _TENANT, "sid": _S1, "model": "m-a", "source": None})

        # Each sanity CHECK refuses its bad row.
        for column in (
            "input_tokens",
            "output_tokens",
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
        ):
            _refused_row(engine, "ck_session_usage_tokens_nonneg", **{column: -1})
        _refused_row(engine, "ck_session_usage_turn_count_nonneg", turn_count=-1)
        _refused_row(engine, "ck_session_usage_cost_microusd_nonneg", cost_microusd=-1)
        _refused_row(
            engine,
            "ck_session_usage_turn_order",
            first_turn_at=datetime(2026, 10, 9, 12, 0, tzinfo=UTC),
            last_turn_at=datetime(2026, 10, 9, 11, 0, tzinfo=UTC),
        )
        # Boundary values are accepted: zero cost, equal turn bounds, one bound.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.session_usage
                        (tenant_id, agent_session_id, model, cost_microusd,
                         first_turn_at, last_turn_at)
                    VALUES (:tid, :sid, 'm', 0, :t, :t),
                           (:tid, :sid, 'm-only-first', NULL, :t, NULL)
                    """
                ),
                {
                    "tid": _TENANT,
                    "sid": _S3,
                    "t": datetime(2026, 10, 9, 12, 0, tzinfo=UTC),
                },
            )

        # --- reversal ------------------------------------------------------
        run_alembic(root, url, "downgrade", _KPI01)
        assert not table_exists(engine, "coord", "session_usage")
        assert not index_exists(engine, "ix_session_usage_tenant_last_turn_at")

        run_alembic(root, url, "downgrade", _PARENT)
        assert (
            column_info(engine, "phase_token_usage", "cost_microusd", "project") is None
        )
        assert (
            column_info(engine, "phase_token_usage", "cost_source", "project") is None
        )
        assert (
            _constraint_def(
                engine, "ck_phase_token_usage_cost_source", "project.phase_token_usage"
            )
            is None
        )
