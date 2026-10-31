"""Behaviour test for the ``launch_budget_01`` revision.

Pins the contract coord's launch-budget ingest, ledger doors and decision
(plan ``2026-10-29-launch-budget-is-a-coord-answer-not-a-per-box-script``
Phase 3) rely on:

1. **Shape**: both tables with their exact column contracts, every constraint
   by name and definition, and every index by its exact definition. All of it
   is gone after downgrade.
2. **UNKNOWN is not zero**: every usage figure defaults to NULL, and only a
   negative percent or a non-array ``model_limits`` is refused.
3. **The ledger's honest defaults**: ``pending`` false, ``work_type``
   ``unknown``, ``finished_at`` / ``status`` NULL until a finish. A blank
   ``label`` or ``launcher`` is refused. ``status`` / ``work_type`` /
   ``launcher`` carry no vocabulary CHECK (coord validates them at ingest).
4. **Re-running is harmless**: with rows present, ``stamp <parent>`` then
   ``upgrade`` again changes nothing (every statement is ``IF NOT EXISTS``).

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import json
import uuid

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

_REVISION_ID = "launch_budget_01"
_REVISION_FILENAME = "launch_budget_01_samples_and_ledger.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_SAMPLES = "account_usage_samples"
_LEDGER = "launch_ledger"
_TIMESTAMPTZ = "timestamp with time zone"
_DOUBLE = "double precision"

_EXPECTED_SAMPLE_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "device_id": ("uuid", "NO"),
    "account_label": ("text", "NO"),
    "account_hash": ("text", "YES"),
    "sampled_at": (_TIMESTAMPTZ, "NO"),
    "session_pct": (_DOUBLE, "YES"),
    "session_resets_at": (_TIMESTAMPTZ, "YES"),
    "weekly_pct": (_DOUBLE, "YES"),
    "weekly_resets_at": (_TIMESTAMPTZ, "YES"),
    "model_limits": ("jsonb", "NO"),
    "status": ("text", "YES"),
    "exhausted": ("boolean", "YES"),
    "error": ("boolean", "NO"),
    "source": ("text", "YES"),
}

_EXPECTED_LEDGER_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "device_id": ("uuid", "YES"),
    "account_label": ("text", "NO"),
    "account_hash": ("text", "YES"),
    "launcher": ("text", "NO"),
    "label": ("text", "NO"),
    "work_type": ("text", "NO"),
    "coord_session_id": ("uuid", "YES"),
    "pending": ("boolean", "NO"),
    "launched_at": (_TIMESTAMPTZ, "NO"),
    "finished_at": (_TIMESTAMPTZ, "YES"),
    "status": ("text", "YES"),
    "created_at": (_TIMESTAMPTZ, "NO"),
    "updated_at": (_TIMESTAMPTZ, "NO"),
}

_EXPECTED_SAMPLE_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "account_usage_samples_pkey": ("p", "PRIMARY KEY (id)"),
    "ck_account_usage_samples_session_pct_nonneg": (
        "c",
        "CHECK (((session_pct IS NULL) OR (session_pct >= (0)::double precision)))",
    ),
    "ck_account_usage_samples_weekly_pct_nonneg": (
        "c",
        "CHECK (((weekly_pct IS NULL) OR (weekly_pct >= (0)::double precision)))",
    ),
    "ck_account_usage_samples_model_limits_array": (
        "c",
        "CHECK ((jsonb_typeof(model_limits) = 'array'::text))",
    ),
}

_EXPECTED_LEDGER_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "launch_ledger_pkey": ("p", "PRIMARY KEY (id)"),
    "ck_launch_ledger_label_nonblank": ("c", "CHECK ((btrim(label) <> ''::text))"),
    "ck_launch_ledger_launcher_nonblank": (
        "c",
        "CHECK ((btrim(launcher) <> ''::text))",
    ),
}

_EXPECTED_SAMPLE_INDEXES: dict[str, str] = {
    "account_usage_samples_pkey": (
        "CREATE UNIQUE INDEX account_usage_samples_pkey ON coord.account_usage_samples "
        "USING btree (id)"
    ),
    "ix_account_usage_samples_tenant_hash_sampled": (
        "CREATE INDEX ix_account_usage_samples_tenant_hash_sampled "
        "ON coord.account_usage_samples USING btree "
        "(tenant_id, account_hash, sampled_at DESC) WHERE (account_hash IS NOT NULL)"
    ),
    "ix_account_usage_samples_device_label_sampled": (
        "CREATE INDEX ix_account_usage_samples_device_label_sampled "
        "ON coord.account_usage_samples USING btree "
        "(tenant_id, device_id, account_label, sampled_at DESC)"
    ),
    "ix_account_usage_samples_sampled": (
        "CREATE INDEX ix_account_usage_samples_sampled "
        "ON coord.account_usage_samples USING btree (sampled_at)"
    ),
}

_EXPECTED_LEDGER_INDEXES: dict[str, str] = {
    "launch_ledger_pkey": (
        "CREATE UNIQUE INDEX launch_ledger_pkey ON coord.launch_ledger USING btree (id)"
    ),
    "ix_launch_ledger_open": (
        "CREATE INDEX ix_launch_ledger_open ON coord.launch_ledger USING btree "
        "(tenant_id, account_hash, account_label) WHERE (finished_at IS NULL)"
    ),
    "ix_launch_ledger_work_type_launched": (
        "CREATE INDEX ix_launch_ledger_work_type_launched ON coord.launch_ledger "
        "USING btree (tenant_id, work_type, launched_at)"
    ),
    "ix_launch_ledger_open_session": (
        "CREATE INDEX ix_launch_ledger_open_session ON coord.launch_ledger "
        "USING btree (coord_session_id) "
        "WHERE ((finished_at IS NULL) AND (coord_session_id IS NOT NULL))"
    ),
}

_TENANT = uuid.UUID("5d2a7f10-3c84-4b6e-9a21-0f7e6c3b8d42")
_DEVICE = uuid.UUID("a8c3e1f5-6b27-4d90-8e14-2f5b7c9a0d63")

_INSERT_SAMPLE = text(
    """
    INSERT INTO coord.account_usage_samples
        (tenant_id, device_id, account_label, account_hash,
         session_pct, weekly_pct, model_limits)
    VALUES (:tid, :device, :label, :hash, :session_pct, :weekly_pct,
            CAST(:model_limits AS jsonb))
    """
)

_INSERT_LAUNCH = text(
    """
    INSERT INTO coord.launch_ledger
        (tenant_id, device_id, account_label, launcher, label, launched_at, status)
    VALUES (:tid, :device, :label, :launcher, :run_label, :launched_at, :status)
    """
)


def _sample(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "device": _DEVICE,
        "label": ".claude-gmail",
        "hash": None,
        "session_pct": None,
        "weekly_pct": None,
        "model_limits": "[]",
    }
    params.update(overrides)
    return params


def _launch(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "device": _DEVICE,
        "label": ".claude-gmail",
        "launcher": "vet-imp-sweep",
        "run_label": "2026-10-29-some-plan",
        "launched_at": "2026-10-31T10:00:00+00:00",
        "status": None,
    }
    params.update(overrides)
    return params


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": table},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _constraints(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
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
            {"table": table},
        ).all()
    return {name: (contype, definition) for name, contype, definition in rows}


def _indexes(engine: Engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef
                  FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = :table
                """
            ),
            {"table": table},
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _assert_shape(engine: Engine) -> None:
    assert _columns(engine, _SAMPLES) == _EXPECTED_SAMPLE_COLUMNS
    assert _columns(engine, _LEDGER) == _EXPECTED_LEDGER_COLUMNS
    assert _constraints(engine, _SAMPLES) == _EXPECTED_SAMPLE_CONSTRAINTS
    assert _constraints(engine, _LEDGER) == _EXPECTED_LEDGER_CONSTRAINTS
    assert _indexes(engine, _SAMPLES) == _EXPECTED_SAMPLE_INDEXES
    assert _indexes(engine, _LEDGER) == _EXPECTED_LEDGER_INDEXES
    with engine.connect() as conn:
        for table in (_SAMPLES, _LEDGER):
            comment = conn.execute(
                text("SELECT obj_description(to_regclass('coord.' || :t), 'pg_class')"),
                {"t": table},
            ).scalar_one()
            assert comment and "2026-10-29-launch-budget" in comment, table


def _assert_absent(engine: Engine) -> None:
    for table in (_SAMPLES, _LEDGER):
        assert not table_exists(engine, "coord", table), f"coord.{table} is present"
        assert _indexes(engine, table) == {}, f"coord.{table} left indexes behind"


def _count(engine: Engine, table: str) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(text(f"SELECT count(*) FROM coord.{table}")).scalar_one()
        )


def _insert(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(statement, params)


def _refused(
    engine: Engine,
    statement: TextClause,
    params: dict[str, object],
    constraint: str,
) -> None:
    """The insert is refused, and by the named constraint, not by another one."""
    with pytest.raises(IntegrityError) as refusal, engine.begin() as conn:
        conn.execute(statement, params)
    refused_by = getattr(
        getattr(refusal.value.orig, "diag", None), "constraint_name", None
    )
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
def test_launch_budget_01_creates_both_tables_and_enforces_their_contract() -> None:
    """Shape, UNKNOWN-is-not-zero, ledger defaults, re-run, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "launchbudget01_test") as (
        engine,
        url,
    ):
        # 1. Parent revision: neither table exists yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 2. Apply: exact columns, constraints, indexes and table comments.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)

        # 3. A sample with no figures stores NULLs, never zeros.
        _insert(engine, _INSERT_SAMPLE, _sample())
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT session_pct, weekly_pct, exhausted, error, model_limits "
                    "FROM coord.account_usage_samples"
                )
            ).one()
        assert row == (None, None, None, False, [])

        # 4. Real readings, including an over-100 percent and a model cap.
        limits = json.dumps([{"model": "Fable", "utilization": 0.4, "resets_at": 1}])
        _insert(
            engine,
            _INSERT_SAMPLE,
            _sample(
                hash="ab" * 32, session_pct=103.5, weekly_pct=46.0, model_limits=limits
            ),
        )

        # 5. A negative percent and a non-array model_limits are refused.
        _refused(
            engine,
            _INSERT_SAMPLE,
            _sample(session_pct=-1.0),
            "ck_account_usage_samples_session_pct_nonneg",
        )
        _refused(
            engine,
            _INSERT_SAMPLE,
            _sample(weekly_pct=-0.5),
            "ck_account_usage_samples_weekly_pct_nonneg",
        )
        _refused(
            engine,
            _INSERT_SAMPLE,
            _sample(model_limits='{"model": "Fable"}'),
            "ck_account_usage_samples_model_limits_array",
        )

        # 6. Ledger defaults: open, not pending, work_type unknown.
        _insert(engine, _INSERT_LAUNCH, _launch())
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT pending, work_type, finished_at, status "
                    "FROM coord.launch_ledger"
                )
            ).one()
        assert row == (False, "unknown", None, None)

        # 7. No vocabulary CHECK on status / launcher; blanks are refused.
        _insert(
            engine,
            _INSERT_LAUNCH,
            _launch(launcher="coord:unit_continuation", status="orphaned", device=None),
        )
        _refused(
            engine,
            _INSERT_LAUNCH,
            _launch(run_label="  "),
            "ck_launch_ledger_label_nonblank",
        )
        _refused(
            engine,
            _INSERT_LAUNCH,
            _launch(launcher=""),
            "ck_launch_ledger_launcher_nonblank",
        )

        # 8. Re-running is harmless: rewind the stamp and apply again.
        rows_before = (_count(engine, _SAMPLES), _count(engine, _LEDGER))
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert (_count(engine, _SAMPLES), _count(engine, _LEDGER)) == rows_before

        # 9. Downgrade: both tables, every constraint and index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        # 10. Re-apply: the downgrade left no residue.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
