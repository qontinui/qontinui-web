"""Behaviour test for the ``overlord_03_passes`` session-flow pass ledger.

``migration-reversal.yml`` would only confirm the statements execute against an
empty database. The contracts pinned here are the ones coord's Rust write path
and flow route rely on and a reviewer cannot read off the DDL at a glance:

1. **Shape** — both tables, their exact column contracts, the primary keys, and
   every index (including the one added to ``coord.overlord_interventions``)
   exist after upgrade, and all of it is gone after downgrade while
   ``coord.overlord_interventions`` itself survives.
2. **The closed vocabularies are enforced** — ``scope``, ``mode``, ``action``,
   ``action_outcome`` and the port range are refused by the schema.
3. **The open vocabularies are format-checked, exactly per item** — a new
   upper-case verdict and a new ``<family>.<snake>`` reason code are accepted
   (they grow with every triage-script PR), while a lower-cased verdict, a NULL
   item, an empty item and an item smuggling the ``,`` delimiter are refused.
4. **The row invariants hold** — an action carries an outcome iff it is not
   ``none``; ``ended_at`` never precedes ``started_at``; ``row_count`` is
   non-negative; a second pass with the same ``pass_id`` is refused (the
   idempotency key coord's replay read relies on); deleting a pass cascades to
   its rows.
5. **NULL identities are accepted** — NULL means "not proven".

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql.elements import TextClause

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

_REVISION_ID = "overlord_03_passes"
_REVISION_FILENAME = "overlord_03_passes.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_PASSES = "overlord_passes"
_ROWS = "overlord_pass_rows"
_INTERVENTIONS = "overlord_interventions"

_INDEXES = (
    "ix_overlord_passes_tenant_started",
    "ix_overlord_passes_tenant_runner",
    "ix_overlord_pass_rows_tenant_session",
    "ix_overlord_interventions_tenant_ccsession",
)

# The column contracts shared with coord's Rust code: name -> (data_type, nullable).
_EXPECTED_PASS_COLUMNS: dict[str, tuple[str, str]] = {
    "pass_id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "device_id": ("uuid", "YES"),
    "runner_port": ("integer", "NO"),
    "runner_build": ("text", "YES"),
    "scope": ("text", "NO"),
    "filter": ("jsonb", "NO"),
    "mode": ("text", "NO"),
    "skipped_steps": ("ARRAY", "NO"),
    "started_at": ("timestamp with time zone", "NO"),
    "ended_at": ("timestamp with time zone", "YES"),
    "recorded_at": ("timestamp with time zone", "NO"),
    "exit_code": ("smallint", "YES"),
    "step_counts": ("jsonb", "NO"),
    "verdict_histogram": ("jsonb", "NO"),
    "overlord_versions": ("jsonb", "NO"),
    "row_count": ("integer", "NO"),
}

_EXPECTED_ROW_COLUMNS: dict[str, tuple[str, str]] = {
    "pass_id": ("uuid", "NO"),
    "terminal_id": ("text", "NO"),
    "tenant_id": ("uuid", "NO"),
    "observed_at": ("timestamp with time zone", "NO"),
    "claude_session_id": ("uuid", "YES"),
    "session_name": ("text", "YES"),
    "tab": ("text", "YES"),
    "account": ("text", "YES"),
    "screen_verdict": ("text", "YES"),
    "verdict": ("text", "NO"),
    "reason_codes": ("ARRAY", "NO"),
    "state_since_ms": ("bigint", "YES"),
    "progress_since_nudge": ("boolean", "YES"),
    "action": ("text", "NO"),
    "action_outcome": ("text", "YES"),
    "detail": ("jsonb", "NO"),
}

_TENANT = uuid.UUID("3b8e1f62-9a47-4c0d-8e15-7f2a6c9d4b31")
_DEVICE = uuid.UUID("c5d29a73-1e84-4f6b-9a02-8d3e7b1f6c40")
_SESSION = uuid.UUID("e1a74c58-6b39-4d2f-8c71-0f9b3a5e2d86")
_STARTED = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)

_INSERT_PASS = text(
    """
    INSERT INTO coord.overlord_passes
        (pass_id, tenant_id, device_id, runner_port, scope, mode,
         skipped_steps, started_at, ended_at, row_count)
    VALUES (:pass_id, :tid, :did, :port, :scope, :mode,
            :skipped, :started, :ended, :row_count)
    """
)

_INSERT_ROW = text(
    """
    INSERT INTO coord.overlord_pass_rows
        (pass_id, terminal_id, tenant_id, observed_at, claude_session_id,
         screen_verdict, verdict, reason_codes, progress_since_nudge,
         action, action_outcome)
    VALUES (:pass_id, :terminal_id, :tid, :observed, :csid,
            :screen_verdict, :verdict, :reasons, :progress,
            :action, :outcome)
    """
)


def _pass(**overrides: object) -> dict[str, object]:
    """A valid pass's parameters, with ``overrides`` applied."""
    params: dict[str, object] = {
        "pass_id": uuid.uuid4(),
        "tid": _TENANT,
        "did": _DEVICE,
        "port": 9876,
        "scope": "full",
        "mode": "report",
        "skipped": [],
        "started": _STARTED,
        "ended": _STARTED + timedelta(seconds=40),
        "row_count": 0,
    }
    params.update(overrides)
    return params


def _row(pass_id: uuid.UUID, **overrides: object) -> dict[str, object]:
    """A valid pass row's parameters for ``pass_id``, with ``overrides`` applied."""
    params: dict[str, object] = {
        "pass_id": pass_id,
        "terminal_id": f"term-{uuid.uuid4().hex[:8]}",
        "tid": _TENANT,
        "observed": _STARTED,
        "csid": _SESSION,
        "screen_verdict": "STOPPED",
        "verdict": "STOPPED",
        "reasons": ["stopped.progress_since_nudge"],
        "progress": None,
        "action": "none",
        "outcome": None,
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


def _primary_key(engine: Engine, table: str) -> list[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT a.attname
                  FROM pg_index i
                  JOIN pg_attribute a
                    ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                 WHERE i.indrelid = ('coord.' || :table)::regclass
                   AND i.indisprimary
                 ORDER BY array_position(i.indkey::int2[], a.attnum)
                """
            ),
            {"table": table},
        ).all()
    return [name for (name,) in rows]


def _insert(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(statement, params)


def _refused(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with pytest.raises(IntegrityError):
        _insert(engine, statement, params)


def _rows_of(engine: Engine, pass_id: uuid.UUID) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    "SELECT COUNT(*) FROM coord.overlord_pass_rows WHERE pass_id = :p"
                ),
                {"p": pass_id},
            ).scalar_one()
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_overlord_03_creates_the_pass_ledger_and_enforces_its_contract() -> None:
    """Shape, closed vocabularies, per-item formats, row invariants, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "overlord03_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — neither table exists yet; the interventions
        #    ledger does, without the join index.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _PASSES)
        assert not table_exists(engine, "coord", _ROWS)
        assert table_exists(engine, "coord", _INTERVENTIONS)
        assert not index_exists(engine, "ix_overlord_interventions_tenant_ccsession")

        # 2. Apply — tables, exact columns, primary keys, indexes.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _columns(engine, _PASSES) == _EXPECTED_PASS_COLUMNS
        assert _columns(engine, _ROWS) == _EXPECTED_ROW_COLUMNS
        assert _primary_key(engine, _PASSES) == ["pass_id"]
        assert _primary_key(engine, _ROWS) == ["pass_id", "terminal_id"]
        for name in _INDEXES:
            assert index_exists(engine, name), f"missing index {name}"

        # 3. A valid pass with NULL identities is accepted; defaults are honest.
        base = _pass(did=None, ended=None, row_count=2)
        _insert(engine, _INSERT_PASS, base)
        with engine.connect() as conn:
            defaults = conn.execute(
                text(
                    """
                    SELECT filter, step_counts, verdict_histogram,
                           overlord_versions, runner_build, exit_code,
                           recorded_at IS NOT NULL
                      FROM coord.overlord_passes WHERE pass_id = :p
                    """
                ),
                {"p": base["pass_id"]},
            ).one()
        assert tuple(defaults) == ({}, {}, {}, {}, None, None, True)

        pid = base["pass_id"]
        assert isinstance(pid, uuid.UUID)

        # A screened-only row with an unproven session, and an acted row whose
        # verdict and reason code are words the schema has never seen.
        _insert(engine, _INSERT_ROW, _row(pid, csid=None, reasons=[]))
        _insert(
            engine,
            _INSERT_ROW,
            _row(
                pid,
                screen_verdict=None,
                verdict="EXITED-FINISHED",
                reasons=["held.no_progress", "closeout.revived_then_closed"],
                progress=True,
                action="nudge",
                outcome="sent_unconfirmed",
            ),
        )
        with engine.connect() as conn:
            row_defaults = conn.execute(
                text(
                    """
                    SELECT detail, reason_codes, action, action_outcome
                      FROM coord.overlord_pass_rows
                     WHERE pass_id = :p AND claude_session_id IS NULL
                    """
                ),
                {"p": pid},
            ).one()
        assert tuple(row_defaults) == ({}, [], "none", None)

        # 4. The pass id is the idempotency key — a second pass with it is refused.
        _refused(engine, _INSERT_PASS, _pass(pass_id=pid))

        # 5. Closed vocabularies and ranges on the pass.
        _refused(engine, _INSERT_PASS, _pass(scope="partial"))
        _refused(engine, _INSERT_PASS, _pass(mode="dry"))
        _refused(engine, _INSERT_PASS, _pass(port=0))
        _refused(engine, _INSERT_PASS, _pass(port=65536))
        _refused(engine, _INSERT_PASS, _pass(row_count=-1))
        _refused(
            engine,
            _INSERT_PASS,
            _pass(ended=_STARTED - timedelta(seconds=1)),
        )

        # 6. skipped_steps is format-checked exactly per item.
        _insert(engine, _INSERT_PASS, _pass(skipped=["layout", "limit_handoff"]))
        _insert(engine, _INSERT_PASS, _pass(scope="filtered", mode="act", port=65535))
        for bad in (
            ["Layout"],
            ["layout", "na-me"],
            [None],
            [""],
            ["a,b"],
            ["layout", ""],
        ):
            _refused(engine, _INSERT_PASS, _pass(skipped=bad))

        # 7. Row formats: open vocabularies, checked per item.
        _refused(engine, _INSERT_ROW, _row(pid, verdict="stopped"))
        _refused(engine, _INSERT_ROW, _row(pid, verdict="STOPPED NOW"))
        _refused(engine, _INSERT_ROW, _row(pid, screen_verdict="Busy"))
        for bad_reasons in (
            ["Stopped.x"],
            ["stopped.ok", "9lives"],
            [None],
            [""],
            ["stopped.a,stopped.b"],
        ):
            _refused(engine, _INSERT_ROW, _row(pid, reasons=bad_reasons))

        # 8. Closed row vocabularies, and outcome iff action.
        _refused(engine, _INSERT_ROW, _row(pid, action="shout", outcome="done"))
        _refused(engine, _INSERT_ROW, _row(pid, action="close", outcome="maybe"))
        _refused(engine, _INSERT_ROW, _row(pid, action="close", outcome=None))
        _refused(engine, _INSERT_ROW, _row(pid, action="none", outcome="done"))
        for action, outcome in (
            ("close", "done"),
            ("limit_handoff", "skipped"),
            ("name", "failed"),
            ("layout", "unknown"),
        ):
            _insert(engine, _INSERT_ROW, _row(pid, action=action, outcome=outcome))

        # 9. One row per terminal per pass, and only for a pass that exists.
        _insert(engine, _INSERT_ROW, _row(pid, terminal_id="dup-ok"))
        _refused(engine, _INSERT_ROW, _row(pid, terminal_id="dup-ok"))
        _refused(engine, _INSERT_ROW, _row(uuid.uuid4()))

        # 10. Deleting a pass cascades to its rows.
        assert _rows_of(engine, pid) == 7
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.overlord_passes WHERE pass_id = :p"),
                {"p": pid},
            )
        assert _rows_of(engine, pid) == 0

        # 11. Downgrade — both tables and every index gone; the interventions
        #     ledger survives without the join index.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _PASSES)
        assert not table_exists(engine, "coord", _ROWS)
        assert table_exists(engine, "coord", _INTERVENTIONS)
        for name in _INDEXES:
            assert not index_exists(engine, name), f"index {name} survived downgrade"

        # 12. Re-upgrade — the downgrade left no residue in the way.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _PASSES)
        assert table_exists(engine, "coord", _ROWS)
