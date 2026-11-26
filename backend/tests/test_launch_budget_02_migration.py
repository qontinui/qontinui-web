"""Behaviour test for the ``launch_budget_02_session_window`` revision.

Pins the contract coord's launch-budget ingest and decision (plan
``2026-11-26-runner-usage-source-is-dark-so-the-launch-budget-never-reads-a-session-figure``
Phase 4) rely on:

1. **Shape**: ``coord.account_usage_samples`` gains exactly ONE column,
   ``session_window TEXT NULL`` with no default, and exactly ONE constraint,
   ``ck_account_usage_samples_session_window``, validated. Every other column,
   constraint and index is ``launch_budget_01``'s, unchanged. In particular no
   caps column is added: caps-read is derived from ``source`` (plan D3).
2. **NULL is "the runner did not say"**: a row written before the revision
   keeps NULL (nothing is backfilled), and a row that names no window stores
   NULL, never a defaulted word.
3. **The vocabulary is closed**: ``reported`` / ``absent`` / ``unread`` are
   stored; any other spelling is refused by the named CHECK.
4. **Re-running is harmless**: with rows present, ``stamp <parent>`` then
   ``upgrade`` again changes nothing (``ADD COLUMN IF NOT EXISTS`` skips the
   column and its constraint together).
5. **Reversal**: downgrade removes the column, its CHECK and its comment, and
   deletes no sample row; re-applying leaves no residue.

A static test also holds ``upgrade()`` to the shape coord's merge-train
migration classifier admits: static ``op.execute`` literals only, no backfill,
no DROP, no DEFAULT or NOT NULL on the ADD. It needs no database, so it runs
where the walk skips.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point
it at a live instance with ``QONTINUI_TEST_PG_DSN`` (``ephemeral-db.sh start
pgvector``).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import TextClause, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    backfill_statements,
    can_connect,
    collapsed_upper,
    column_comment,
    declared_parent_revision_id,
    drop_statements,
    ephemeral_database,
    run_alembic,
    upgrade_execute_calls,
)

# launch_budget_01's test is the one author of that revision's shape; this
# revision changes it by exactly one column and one constraint.
from tests.test_launch_budget_01_migration import (
    _EXPECTED_SAMPLE_COLUMNS as _LB01_SAMPLE_COLUMNS,
)
from tests.test_launch_budget_01_migration import (
    _EXPECTED_SAMPLE_CONSTRAINTS as _LB01_SAMPLE_CONSTRAINTS,
)
from tests.test_launch_budget_01_migration import (
    _EXPECTED_SAMPLE_INDEXES as _LB01_SAMPLE_INDEXES,
)

_REVISION_ID = "launch_budget_02_session_window"
_REVISION_FILENAME = "launch_budget_02_session_window.py"
_REVISION_PATH = backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = _REVISION_PATH.read_text(encoding="utf-8")
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_SAMPLES = "account_usage_samples"
_CHECK_NAME = "ck_account_usage_samples_session_window"

#: launch_budget_01's table plus the ONE new column. No caps column (plan D3).
_EXPECTED_COLUMNS: dict[str, tuple[str, str]] = {
    **_LB01_SAMPLE_COLUMNS,
    "session_window": ("text", "YES"),
}

#: launch_budget_01's constraints plus the ONE new CHECK, as Postgres renders it.
_EXPECTED_CONSTRAINTS: dict[str, tuple[str, str]] = {
    **_LB01_SAMPLE_CONSTRAINTS,
    _CHECK_NAME: (
        "c",
        "CHECK ((session_window = ANY (ARRAY['reported'::text, "
        "'absent'::text, 'unread'::text])))",
    ),
}

_TENANT = uuid.UUID("7c41e2b9-0d5a-4f83-a6e1-3b92d8c04f17")
_DEVICE = uuid.UUID("e2b8d4a1-97c3-4f06-8d5e-1a6f3c9b2e40")

#: A row as a runner that predates the field writes it: no session_window.
_INSERT_LEGACY = text(
    """
    INSERT INTO coord.account_usage_samples
        (tenant_id, device_id, account_label, source)
    VALUES (:tid, :device, :label, :source)
    """
)

_INSERT_CLASSIFIED = text(
    """
    INSERT INTO coord.account_usage_samples
        (tenant_id, device_id, account_label, source, session_window)
    VALUES (:tid, :device, :label, :source, :window)
    """
)


def _legacy(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "device": _DEVICE,
        "label": ".claude-legacy",
        "source": "probe",
    }
    params.update(overrides)
    return params


def _classified(window: object, **overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "device": _DEVICE,
        "label": ".claude-max",
        "source": "probe",
        "window": window,
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
            {"table": _SAMPLES},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _column_default(engine: Engine, column: str) -> object:
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT column_default
                  FROM information_schema.columns
                 WHERE table_schema = 'coord'
                   AND table_name = :table
                   AND column_name = :column
                """
            ),
            {"table": _SAMPLES, "column": column},
        ).scalar_one()


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
            {"table": _SAMPLES},
        ).all()
    return {name: (contype, definition) for name, contype, definition in rows}


def _check_validated(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT convalidated
                      FROM pg_constraint
                     WHERE conrelid = to_regclass('coord.account_usage_samples')
                       AND conname = :name
                    """
                ),
                {"name": _CHECK_NAME},
            ).scalar_one()
        )


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
            {"table": _SAMPLES},
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _windows(engine: Engine) -> dict[str, str | None]:
    """``account_label -> session_window`` for every row."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT account_label, session_window FROM coord.account_usage_samples"
            )
        ).all()
    return {str(label): window for label, window in rows}


def _count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT count(*) FROM coord.account_usage_samples")
            ).scalar_one()
        )


def _insert(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(statement, params)


def _refused(engine: Engine, params: dict[str, object]) -> None:
    """The insert is refused, and by the session_window CHECK, not another one."""
    with pytest.raises(IntegrityError) as refusal, engine.begin() as conn:
        conn.execute(_INSERT_CLASSIFIED, params)
    refused_by = getattr(
        getattr(refusal.value.orig, "diag", None), "constraint_name", None
    )
    assert refused_by == _CHECK_NAME, (
        f"refused by {refused_by!r}, expected {_CHECK_NAME!r}"
    )


def _assert_shape(engine: Engine) -> None:
    assert _columns(engine) == _EXPECTED_COLUMNS
    assert _column_default(engine, "session_window") is None
    assert _constraints(engine) == _EXPECTED_CONSTRAINTS
    # Declared with its column, so Postgres validated it (every existing row
    # held NULL, which passes); a NOT VALID twin would read false here.
    assert _check_validated(engine) is True
    assert _indexes(engine) == _LB01_SAMPLE_INDEXES
    comment = column_comment(engine, _SAMPLES, "session_window")
    assert comment is not None
    # The three words, what NULL means, and where caps-read lives instead.
    for phrase in (
        "reported = session_pct carries the figure",
        "absent = the provider sends no five-hour window",
        "unread = the window may exist",
        "NULL = the runner did not say",
        "never as absent",
        "source = oauth_usage",
    ):
        assert phrase in comment, phrase


def _assert_absent(engine: Engine) -> None:
    assert _columns(engine) == _LB01_SAMPLE_COLUMNS
    assert _constraints(engine) == _LB01_SAMPLE_CONSTRAINTS
    assert _indexes(engine) == _LB01_SAMPLE_INDEXES
    assert column_comment(engine, _SAMPLES, "session_window") is None


def test_launch_budget_02_upgrade_is_one_nullable_add_with_its_check() -> None:
    """Static: the upgrade path is the shape coord's classifier admits.

    Runs with no database. Every ``op.execute`` is one static literal outside
    any autocommit block; the statements are the lock bound, ONE ADD on
    ``coord.account_usage_samples`` and its COMMENT; nothing writes rows and
    nothing is dropped; the ADD carries no DEFAULT and no NOT NULL.
    """
    calls = upgrade_execute_calls(_REVISION_PATH)
    assert [call.in_autocommit_block for call in calls] == [False, False, False]
    statements = [call.sql for call in calls]
    assert None not in statements, "an op.execute argument is not a static literal"
    sql = [str(s) for s in statements]

    assert collapsed_upper(sql[0]) == "SET LOCAL LOCK_TIMEOUT = '3S'"
    assert collapsed_upper(sql[1]) == (
        "ALTER TABLE COORD.ACCOUNT_USAGE_SAMPLES "
        "ADD COLUMN IF NOT EXISTS SESSION_WINDOW TEXT "
        "CONSTRAINT CK_ACCOUNT_USAGE_SAMPLES_SESSION_WINDOW "
        "CHECK (SESSION_WINDOW IN ('REPORTED', 'ABSENT', 'UNREAD'))"
    )
    assert collapsed_upper(sql[2]).startswith(
        "COMMENT ON COLUMN COORD.ACCOUNT_USAGE_SAMPLES.SESSION_WINDOW IS '"
    )
    assert backfill_statements(sql) == []
    assert drop_statements(sql) == []

    downgrade = [
        str(call.sql)
        for call in upgrade_execute_calls(_REVISION_PATH, function="downgrade")
    ]
    assert [collapsed_upper(s) for s in downgrade] == [
        "SET LOCAL LOCK_TIMEOUT = '3S'",
        "ALTER TABLE COORD.ACCOUNT_USAGE_SAMPLES DROP COLUMN IF EXISTS SESSION_WINDOW",
    ]


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point QONTINUI_TEST_PG_DSN at a throwaway "
        "Postgres (ephemeral-db.sh start pgvector) before running this test."
    ),
)
def test_launch_budget_02_adds_session_window_and_enforces_its_contract() -> None:
    """Shape, no backfill, closed vocabulary, re-run, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "launchbudget02_test") as (
        engine,
        url,
    ):
        # 1. Parent revision: launch_budget_01's table, no session_window. A row
        #    a pre-Phase-2 runner wrote is already there.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)
        _insert(engine, _INSERT_LEGACY, _legacy())

        # 2. Apply: one column, one validated CHECK, its comment; nothing else.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)

        # 3. Nothing is backfilled: the pre-existing row says nothing.
        assert _windows(engine) == {".claude-legacy": None}
        # A new row that names no window stores NULL, never a defaulted word.
        _insert(engine, _INSERT_LEGACY, _legacy(label=".claude-old-runner"))
        assert _windows(engine)[".claude-old-runner"] is None

        # 4. The three words are stored as sent, with either source.
        _insert(engine, _INSERT_CLASSIFIED, _classified("absent", label=".claude-a"))
        _insert(
            engine,
            _INSERT_CLASSIFIED,
            _classified("reported", label=".claude-r", source="oauth_usage"),
        )
        _insert(engine, _INSERT_CLASSIFIED, _classified("unread", label=".claude-u"))
        _insert(engine, _INSERT_CLASSIFIED, _classified(None, label=".claude-n"))
        assert _windows(engine) == {
            ".claude-legacy": None,
            ".claude-old-runner": None,
            ".claude-a": "absent",
            ".claude-r": "reported",
            ".claude-u": "unread",
            ".claude-n": None,
        }

        # 5. Any other spelling is refused by the named CHECK: a case variant,
        #    a near-synonym, a blank, and the wire's "unknown".
        for word in ("Absent", "none", "", "unknown"):
            _refused(engine, _classified(word))

        # 6. Re-running is harmless: rewind the stamp and apply again.
        before = _windows(engine)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert _windows(engine) == before

        # 7. Downgrade: the column, its CHECK and its comment are gone; every
        #    sample row survives.
        rows_before = _count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)
        assert _count(engine) == rows_before == 6

        # 8. Re-apply: the downgrade left no residue, and the rows read NULL.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert set(_windows(engine).values()) == {None}
