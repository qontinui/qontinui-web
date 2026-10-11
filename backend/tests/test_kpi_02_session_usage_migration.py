"""Behaviour test for the ``kpi_02`` revision.

Plan ``2026-10-09-kpi-telemetry-and-dashboards`` Phase 1. Pins the contract the
coord writer relies on: ``kpi_02`` creates ``coord.session_usage`` with the
exact column contract, the composite primary key (an UPSERT target), every
CHECK by its exact definition and by a refused row, the ``cost_source``
vocabulary, the cost pair, honest defaults, an ``ON CONFLICT`` upsert, the
table comment and the feed index; downgrade drops it all.

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
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    scalar,
    table_exists,
)

_KPI02 = "kpi_02_coord_session_usage"
_KPI02_FILENAME = "kpi_02_coord_session_usage.py"


def _parent_revision_id() -> str:
    """Parse ``kpi_02``'s own ``down_revision`` at runtime, never hardcoded."""
    source = (backend_root() / "alembic" / "versions" / _KPI02_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _KPI02_FILENAME)


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
        (tenant_id, agent_session_id, model, cost_microusd, cost_source)
    VALUES (:tid, :sid, :model, :cost, :source)
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


def _refused(engine: Engine, constraint: str, params: dict[str, object]) -> None:
    """Insert one ``_INSERT`` row; ``constraint`` must be the one that refuses it."""
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(_INSERT, params)
    assert constraint in str(excinfo.value), str(excinfo.value)


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
    "ck_session_usage_cost_pair": (
        "CHECK (((cost_microusd IS NULL) = (cost_source IS NULL)))"
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
def test_kpi_02_session_usage_shape_constraints_and_reversal() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "kpi_session_usage_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT)
        assert not table_exists(engine, "coord", "session_usage")

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
        comment = scalar(
            engine, "SELECT obj_description('coord.session_usage'::regclass)"
        )
        assert isinstance(comment, str)
        assert comment.startswith("Per-session, per-model Claude token and cost"), (
            comment
        )

        # Defaults are honest: zero counters, NULL cost and NULL source.
        with engine.begin() as conn:
            conn.execute(
                _INSERT,
                {
                    "tid": _TENANT,
                    "sid": _S1,
                    "model": "m-a",
                    "cost": None,
                    "source": None,
                },
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
                {
                    "tid": _TENANT,
                    "sid": _S1,
                    "model": "m-b",
                    "cost": 1234,
                    "source": "reported",
                },
            )
            conn.execute(
                _INSERT,
                {
                    "tid": _TENANT,
                    "sid": _S2,
                    "model": "m-a",
                    "cost": 0,
                    "source": "estimated",
                },
            )

        # Unknown vocabulary, a half-set cost pair and a duplicate key are refused.
        row = {"tid": _TENANT, "sid": _S3, "model": "m"}
        _refused(
            engine,
            "ck_session_usage_cost_source",
            {**row, "cost": 1, "source": "guessed"},
        )
        _refused(
            engine, "ck_session_usage_cost_pair", {**row, "cost": 1, "source": None}
        )
        _refused(
            engine,
            "ck_session_usage_cost_pair",
            {**row, "cost": None, "source": "reported"},
        )
        _refused(
            engine,
            "pk_session_usage",
            {"tid": _TENANT, "sid": _S1, "model": "m-a", "cost": None, "source": None},
        )

        # The primary key is the writer's UPSERT target: a second cumulative
        # report for the same (tenant, session, model) updates the one row
        # instead of adding one. Counters keep the larger total; the cost pair
        # is replaced together. (The writer's recency guard on the cost pair
        # is the writer's own logic, not schema, so it is not modelled here.)
        # Seed a stored total LARGER than the next report, so the assertion
        # tells GREATEST apart from plain replacement.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.session_usage SET input_tokens = 100 "
                    "WHERE agent_session_id = :sid AND model = 'm-b'"
                ),
                {"sid": _S1},
            )
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.session_usage
                        (tenant_id, agent_session_id, model, input_tokens,
                         cost_microusd, cost_source)
                    VALUES (:tid, :sid, 'm-b', 50, 2000, 'estimated')
                    ON CONFLICT (tenant_id, agent_session_id, model) DO UPDATE SET
                        input_tokens = GREATEST(
                            coord.session_usage.input_tokens, EXCLUDED.input_tokens
                        ),
                        cost_microusd = EXCLUDED.cost_microusd,
                        cost_source = EXCLUDED.cost_source
                    """
                ),
                {"tid": _TENANT, "sid": _S1},
            )
        assert (
            scalar(
                engine,
                "SELECT (count(*), max(input_tokens), max(cost_microusd), "
                "max(cost_source))::text FROM coord.session_usage "
                "WHERE agent_session_id = :sid AND model = 'm-b'",
                sid=_S1,
            )
            == "(1,100,2000,estimated)"
        )

        # Each sanity CHECK refuses its bad row.
        for column in (
            "input_tokens",
            "output_tokens",
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
        ):
            _refused_row(engine, "ck_session_usage_tokens_nonneg", **{column: -1})
        _refused_row(engine, "ck_session_usage_turn_count_nonneg", turn_count=-1)
        _refused_row(
            engine,
            "ck_session_usage_cost_microusd_nonneg",
            cost_microusd=-1,
            cost_source="reported",
        )
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
                         cost_source, first_turn_at, last_turn_at)
                    VALUES (:tid, :sid, 'm', 0, 'reported', :t, :t),
                           (:tid, :sid, 'm-only-first', NULL, NULL, :t, NULL)
                    """
                ),
                {
                    "tid": _TENANT,
                    "sid": _S3,
                    "t": datetime(2026, 10, 9, 12, 0, tzinfo=UTC),
                },
            )

        # --- reversal ------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT)
        assert not table_exists(engine, "coord", "session_usage")
        assert not index_exists(engine, "ix_session_usage_tenant_last_turn_at")
