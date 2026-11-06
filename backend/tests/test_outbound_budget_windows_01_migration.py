"""Behaviour test for the ``outbound_budget_windows_01`` revision.

Pins the contract coord's outbound-budget observer (the per-window fold) and
the ``coord_query_outbound_budget`` history read rely on (plan
``2026-10-31-merge-train-checkpoint-3-misses-with-no-owning-plan`` Phase 3,
row 1.5):

1. **Shape**: the exact column contract, every constraint and index by name and
   definition, and the table comment. All of it is gone after downgrade.
2. **One row per window**: ``(dependency, resource, reset_at)`` is the
   ``ON CONFLICT`` target, and the fold coord issues (``LEAST`` the minimum,
   ``GREATEST`` the span, ``+1`` the count) keeps the minimum when a later,
   higher reading arrives.
3. **A missing reading is not a row**: ``reset_at`` and both remaining figures
   are NOT NULL; negative figures, ``min > last``, a zero count and an
   inverted span are refused by their named constraints.
4. **Re-running is harmless**: with rows present, ``stamp <parent>`` then
   ``upgrade`` again changes nothing (every statement is ``IF NOT EXISTS``).

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import pytest
from sqlalchemy import TextClause, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
    table_exists,
)

_REVISION_ID = "outbound_budget_windows_01"
_REVISION_FILENAME = "outbound_budget_windows_01_per_window_rollup.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_TABLE = "outbound_budget_windows"
_TIMESTAMPTZ = "timestamp with time zone"

_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("bigint", "NO"),
    "dependency": ("text", "NO"),
    "resource": ("text", "NO"),
    "reset_at": (_TIMESTAMPTZ, "NO"),
    "limit_total": ("bigint", "YES"),
    "min_remaining": ("bigint", "NO"),
    "last_remaining": ("bigint", "NO"),
    "sample_count": ("integer", "NO"),
    "first_observed_at": (_TIMESTAMPTZ, "NO"),
    "last_observed_at": (_TIMESTAMPTZ, "NO"),
}

_EXPECTED_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "outbound_budget_windows_pkey": ("p", "PRIMARY KEY (id)"),
    "outbound_budget_windows_dependency_resource_reset_uq": (
        "u",
        "UNIQUE (dependency, resource, reset_at)",
    ),
    "ck_outbound_budget_windows_remaining_nonneg": (
        "c",
        "CHECK (((min_remaining >= 0) AND (last_remaining >= 0)))",
    ),
    "ck_outbound_budget_windows_min_le_last": (
        "c",
        "CHECK ((min_remaining <= last_remaining))",
    ),
    "ck_outbound_budget_windows_sample_count_pos": (
        "c",
        "CHECK ((sample_count >= 1))",
    ),
    "ck_outbound_budget_windows_span_ordered": (
        "c",
        "CHECK ((first_observed_at <= last_observed_at))",
    ),
}

_EXPECTED_INDEXES: dict[str, str] = {
    "outbound_budget_windows_pkey": (
        "CREATE UNIQUE INDEX outbound_budget_windows_pkey "
        "ON coord.outbound_budget_windows USING btree (id)"
    ),
    "outbound_budget_windows_dependency_resource_reset_uq": (
        "CREATE UNIQUE INDEX outbound_budget_windows_dependency_resource_reset_uq "
        "ON coord.outbound_budget_windows USING btree (dependency, resource, reset_at)"
    ),
    "idx_outbound_budget_windows_last_observed": (
        "CREATE INDEX idx_outbound_budget_windows_last_observed "
        "ON coord.outbound_budget_windows USING btree (last_observed_at)"
    ),
}

# The fold coord's observer issues, in the shape it issues it: one reading per
# call, folded into the window's row.
_FOLD = text(
    """
    INSERT INTO coord.outbound_budget_windows AS cur
        (dependency, resource, reset_at, limit_total, min_remaining,
         last_remaining, sample_count, first_observed_at, last_observed_at)
    VALUES (:dep, :res, :reset_at, :limit_total, :remaining, :remaining, 1,
            :observed_at, :observed_at)
    ON CONFLICT ON CONSTRAINT outbound_budget_windows_dependency_resource_reset_uq
    DO UPDATE SET
        limit_total = COALESCE(EXCLUDED.limit_total, cur.limit_total),
        min_remaining = LEAST(cur.min_remaining, EXCLUDED.min_remaining),
        last_remaining = CASE WHEN EXCLUDED.last_observed_at >= cur.last_observed_at
                              THEN EXCLUDED.last_remaining
                              ELSE cur.last_remaining END,
        sample_count = cur.sample_count + 1,
        first_observed_at = LEAST(cur.first_observed_at, EXCLUDED.first_observed_at),
        last_observed_at = GREATEST(cur.last_observed_at, EXCLUDED.last_observed_at)
    """
)

_INSERT_RAW = text(
    """
    INSERT INTO coord.outbound_budget_windows
        (dependency, resource, reset_at, limit_total, min_remaining,
         last_remaining, sample_count, first_observed_at, last_observed_at)
    VALUES (:dep, :res, :reset_at, :limit_total, :min_remaining,
            :last_remaining, :sample_count, :first_observed_at, :last_observed_at)
    """
)

_RESET = "2026-11-06T14:00:00+00:00"
# Every row this test writes carries this dependency, and every count is
# scoped to it, so no assertion reads rows the test did not write.
_DEP = "github-obw01-test"


def _reading(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "dep": _DEP,
        "res": "core:134903706",
        "reset_at": _RESET,
        "limit_total": 5000,
        "remaining": 4000,
        "observed_at": "2026-11-06T13:10:00+00:00",
    }
    params.update(overrides)
    return params


def _raw(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "dep": _DEP,
        "res": "core:134903706",
        "reset_at": _RESET,
        "limit_total": 5000,
        "min_remaining": 10,
        "last_remaining": 20,
        "sample_count": 1,
        "first_observed_at": "2026-11-06T13:10:00+00:00",
        "last_observed_at": "2026-11-06T13:20:00+00:00",
    }
    params.update(overrides)
    return params


def _columns(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _constraints(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, contype::text, pg_get_constraintdef(oid)
                  FROM pg_constraint
                 WHERE conrelid = to_regclass('coord.' || :table)
                   AND contype <> 'n'
                """
            ),
            {"table": _TABLE},
        ).all()
    return {name: (contype, definition) for name, contype, definition in rows}


def _indexes(engine: Engine) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef
                  FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _assert_shape(engine: Engine) -> None:
    assert _columns(engine) == _EXPECTED_COLUMNS
    assert _constraints(engine) == _EXPECTED_CONSTRAINTS
    assert _indexes(engine) == _EXPECTED_INDEXES
    with engine.connect() as conn:
        comment = conn.execute(
            text("SELECT obj_description(to_regclass('coord.' || :t), 'pg_class')"),
            {"t": _TABLE},
        ).scalar_one()
        assert comment and "2026-10-31-merge-train-checkpoint-3" in comment
        identity = conn.execute(
            text(
                "SELECT is_identity, identity_generation FROM information_schema.columns "
                "WHERE table_schema = 'coord' AND table_name = :t AND column_name = 'id'"
            ),
            {"t": _TABLE},
        ).one()
        assert tuple(identity) == ("YES", "ALWAYS")


def _assert_absent(engine: Engine) -> None:
    assert not table_exists(engine, "coord", _TABLE), f"coord.{_TABLE} is present"
    assert _indexes(engine) == {}, f"coord.{_TABLE} left indexes behind"


def _count(engine: Engine) -> int:
    """Rows this test wrote (scoped to its own ``_DEP``)."""
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    "SELECT count(*) FROM coord.outbound_budget_windows "
                    "WHERE dependency = :dep"
                ),
                {"dep": _DEP},
            ).scalar_one()
        )


def _exec(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(statement, params)


def _refused(
    engine: Engine,
    statement: TextClause,
    params: dict[str, object],
    constraint: str | None,
) -> None:
    """The insert is refused, and by the named constraint (None = a NOT NULL)."""
    with pytest.raises(IntegrityError) as refusal, engine.begin() as conn:
        conn.execute(statement, params)
    diag = getattr(refusal.value.orig, "diag", None)
    if constraint is None:
        assert getattr(diag, "sqlstate", None) == "23502", "expected a NOT NULL refusal"
        return
    refused_by = getattr(diag, "constraint_name", None)
    assert refused_by == constraint, (
        f"refused by {refused_by!r}, expected {constraint!r}"
    )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_outbound_budget_windows_01_creates_the_rollup_and_enforces_its_contract() -> (
    None
):
    """Shape, the per-window fold, refusals, re-run, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "obwindows01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision: the table does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 2. Apply: exact columns, constraints, indexes, comment, identity.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)

        # 3. Three readings of one window fold into ONE row. The budget dips
        #    to 0, then a lagging replica reports a higher figure later: the
        #    minimum stays 0, the latest reading is the lagging one.
        _exec(engine, _FOLD, _reading(remaining=120))
        _exec(
            engine,
            _FOLD,
            _reading(remaining=0, observed_at="2026-11-06T13:30:00+00:00"),
        )
        _exec(
            engine,
            _FOLD,
            _reading(remaining=900, observed_at="2026-11-06T13:40:00+00:00"),
        )
        # An out-of-order (earlier) reading widens the span but does not
        # replace last_remaining.
        _exec(
            engine,
            _FOLD,
            _reading(remaining=150, observed_at="2026-11-06T13:05:00+00:00"),
        )
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT min_remaining, last_remaining, sample_count, "
                    "first_observed_at = CAST(:first AS timestamptz), "
                    "last_observed_at = CAST(:last AS timestamptz) "
                    "FROM coord.outbound_budget_windows "
                    "WHERE dependency = :dep AND resource = 'core:134903706' "
                    "AND reset_at = CAST(:reset AS timestamptz)"
                ),
                {
                    "dep": _DEP,
                    "reset": _RESET,
                    "first": "2026-11-06T13:05:00+00:00",
                    "last": "2026-11-06T13:40:00+00:00",
                },
            ).one()
        assert tuple(row) == (0, 900, 4, True, True)

        # 4. A new window is a new row; another bucket is another row.
        _exec(engine, _FOLD, _reading(reset_at="2026-11-06T15:00:00+00:00"))
        _exec(engine, _FOLD, _reading(res="graphql:134903706"))
        assert _count(engine) == 3

        # 5. A missing reading is not a row.
        _refused(engine, _INSERT_RAW, _raw(reset_at=None), None)
        _refused(engine, _INSERT_RAW, _raw(min_remaining=None), None)
        _refused(engine, _INSERT_RAW, _raw(last_remaining=None), None)

        # 6. Every CHECK refuses by its own name.
        _refused(
            engine,
            _INSERT_RAW,
            _raw(min_remaining=-1),
            "ck_outbound_budget_windows_remaining_nonneg",
        )
        _refused(
            engine,
            _INSERT_RAW,
            _raw(min_remaining=30, last_remaining=20),
            "ck_outbound_budget_windows_min_le_last",
        )
        _refused(
            engine,
            _INSERT_RAW,
            _raw(sample_count=0),
            "ck_outbound_budget_windows_sample_count_pos",
        )
        _refused(
            engine,
            _INSERT_RAW,
            _raw(
                first_observed_at="2026-11-06T13:30:00+00:00",
                last_observed_at="2026-11-06T13:20:00+00:00",
            ),
            "ck_outbound_budget_windows_span_ordered",
        )
        # A null limit_total is a legitimate reading.
        _exec(
            engine,
            _INSERT_RAW,
            _raw(res="search:134903706", limit_total=None),
        )

        # 7. Re-running is harmless: rewind the stamp and apply again.
        rows_before = _count(engine)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert _count(engine) == rows_before

        # 8. Downgrade: the table, its constraints and indexes are gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 9. Re-apply: the downgrade left no residue.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert _count(engine) == 0
