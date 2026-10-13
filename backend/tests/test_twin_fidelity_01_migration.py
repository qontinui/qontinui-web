"""Behaviour test for the ``twin_fidelity_01`` revision.

Plan ``2026-10-11-twin-honesty-and-reachability`` Phase 4a. Pins the contract
coord's ``twin_fidelity_store`` relies on: the column set, the recency index,
every CHECK by a refused row (including that an unsampled
``stale_at_decision_violations`` is NULL rather than 0), and the reversal.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import json
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

_REV = "twin_fidelity_01_coord_twin_fidelity_observations"
_REV_FILENAME = f"{_REV}.py"


def _parent_revision_id() -> str:
    """Parse the revision's own ``down_revision`` at runtime, never hardcoded."""
    source = (backend_root() / "alembic" / "versions" / _REV_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REV_FILENAME)


_PARENT = _parent_revision_id()

_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("bigint", "NO"),
    "computed_at": ("timestamp with time zone", "NO"),
    "replica_id": ("text", "NO"),
    "bound_secs": ("integer", "NO"),
    "total": ("integer", "NO"),
    "observed_count": ("integer", "NO"),
    "blind_count": ("integer", "NO"),
    "honesty_violations": ("integer", "NO"),
    "stale_evidence_violations": ("integer", "NO"),
    "stale_at_decision_violations": ("integer", "YES"),
    "observability_rate": ("double precision", "YES"),
    "subspaces": ("jsonb", "NO"),
}

_VALID: dict[str, object] = {
    "computed_at": datetime(2026, 10, 12, 0, 0, tzinfo=UTC),
    "replica_id": "coord-a",
    "bound_secs": 3600,
    "total": 13,
    "observed_count": 9,
    "blind_count": 4,
    "honesty_violations": 1,
    "stale_evidence_violations": 1,
    "stale_at_decision_violations": None,
    "observability_rate": 9 / 13,
    "subspaces": json.dumps([{"subspace": "git", "observed": True}]),
}

_INSERT = text(
    """
    INSERT INTO coord.twin_fidelity_observations
        (computed_at, replica_id, bound_secs, total, observed_count, blind_count,
         honesty_violations, stale_evidence_violations,
         stale_at_decision_violations, observability_rate, subspaces)
    VALUES (:computed_at, :replica_id, :bound_secs, :total, :observed_count,
            :blind_count, :honesty_violations, :stale_evidence_violations,
            :stale_at_decision_violations, :observability_rate,
            CAST(:subspaces AS jsonb))
    """
)


def _columns(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord'
                   AND table_name = 'twin_fidelity_observations'
                """
            )
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


# Exact definitions as pg_get_constraintdef renders them, so dropping any
# conjunct of a CHECK fails this test, not only a refused row.
_CHECK_DEFS: dict[str, str] = {
    "ck_twin_fidelity_obs_bound_positive": "CHECK ((bound_secs > 0))",
    "ck_twin_fidelity_obs_counts_nonneg": (
        "CHECK (((total >= 0) AND (observed_count >= 0) AND (blind_count >= 0) "
        "AND (honesty_violations >= 0) AND (stale_evidence_violations >= 0) "
        "AND ((stale_at_decision_violations IS NULL) "
        "OR (stale_at_decision_violations >= 0))))"
    ),
    "ck_twin_fidelity_obs_counts_within_total": (
        "CHECK (((observed_count + blind_count) <= total))"
    ),
    "ck_twin_fidelity_obs_rate_range": (
        "CHECK (((observability_rate IS NULL) OR ((observability_rate >= (0)::double "
        "precision) AND (observability_rate <= (1)::double precision))))"
    ),
    "ck_twin_fidelity_obs_rate_iff_total": (
        "CHECK (((total = 0) = (observability_rate IS NULL)))"
    ),
    "ck_twin_fidelity_obs_subspaces_array": (
        "CHECK ((jsonb_typeof(subspaces) = 'array'::text))"
    ),
}


def _constraint_def(engine: Engine, name: str) -> str | None:
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conname = :name
                   AND conrelid = 'coord.twin_fidelity_observations'::regclass
                """
            ),
            {"name": name},
        ).scalar_one_or_none()


def _refused(engine: Engine, constraint: str, **overrides: object) -> None:
    """Insert a row with ``overrides`` applied; ``constraint`` must refuse it."""
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(_INSERT, {**_VALID, **overrides})
    assert constraint in str(excinfo.value), str(excinfo.value)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_twin_fidelity_01_shape_constraints_and_reversal() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "twin_fidelity_obs_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT)
        assert not table_exists(engine, "coord", "twin_fidelity_observations")

        run_alembic(root, url, "upgrade", _REV)
        assert table_exists(engine, "coord", "twin_fidelity_observations")
        assert _columns(engine) == _COLUMNS
        assert index_exists(engine, "ix_twin_fidelity_observations_computed_at")
        indexdef = scalar(
            engine,
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'coord' "
            "AND indexname = 'ix_twin_fidelity_observations_computed_at'",
        )
        assert isinstance(indexdef, str)
        assert indexdef.endswith("(computed_at DESC)"), indexdef
        comment = scalar(
            engine,
            "SELECT obj_description('coord.twin_fidelity_observations'::regclass)",
        )
        assert isinstance(comment, str)
        assert comment.startswith("One row per twin-fidelity report"), comment

        for name, expected in _CHECK_DEFS.items():
            assert _constraint_def(engine, name) == expected, name

        # A valid row, with an unsampled decision count, round-trips as NULL.
        with engine.begin() as conn:
            conn.execute(_INSERT, _VALID)
            # observed + blind below total is accepted (the CHECK is <=, not =),
            # and so is an empty report with no rate.
            conn.execute(_INSERT, {**_VALID, "blind_count": 3})
            conn.execute(
                _INSERT,
                {
                    **_VALID,
                    "total": 0,
                    "observed_count": 0,
                    "blind_count": 0,
                    "observability_rate": None,
                },
            )
        assert (
            scalar(
                engine,
                "SELECT bool_and(stale_at_decision_violations IS NULL) "
                "FROM coord.twin_fidelity_observations",
            )
            is True
        )

        _refused(engine, "ck_twin_fidelity_obs_bound_positive", bound_secs=0)
        _refused(engine, "ck_twin_fidelity_obs_counts_nonneg", blind_count=-1)
        _refused(
            engine,
            "ck_twin_fidelity_obs_counts_nonneg",
            stale_at_decision_violations=-1,
        )
        _refused(
            engine,
            "ck_twin_fidelity_obs_counts_within_total",
            observed_count=10,
            blind_count=4,
        )
        _refused(engine, "ck_twin_fidelity_obs_rate_range", observability_rate=1.5)
        _refused(engine, "ck_twin_fidelity_obs_rate_iff_total", observability_rate=None)
        _refused(
            engine,
            "ck_twin_fidelity_obs_subspaces_array",
            subspaces=json.dumps({"git": True}),
        )

        # --- reversal ------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT)
        assert not table_exists(engine, "coord", "twin_fidelity_observations")
        assert not index_exists(engine, "ix_twin_fidelity_observations_computed_at")
