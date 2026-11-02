"""Behaviour test for ``journey_03_explorations_stop_unsettled``.

The runner's explorer (``src-tauri/src/journey/explorer.rs``, the paired
qontinui-runner change of the same plan phase) will record a run that ended
with activatable frontier it could not read, route or activate as
``stopped_because = 'frontier_unsettled'``. A drift here refuses that INSERT on
another repo's code path, where it surfaces only as the explore answer's
persistence state. So:

1. **The seventh word** — after upgrade ``frontier_unsettled`` is accepted, every
   one of the original six still is, and an unknown word is still refused,
   under the SAME constraint name.
2. **The row says why** — ``stop_detail`` takes the runner's ``unsettled``
   breakdown as a JSON object on a ``frontier_unsettled`` row, NULL on any row,
   and nothing else: not a non-object, not a detail on another stop.
3. **Nothing else moved** — the other CHECKs still refuse what they refused.
4. **The downgrade refuses to rewrite a recorded reason** — while a
   ``frontier_unsettled`` row exists it fails and drops nothing (the column
   stays); once those rows are gone it restores the six words exactly and
   drops ``stop_detail``.
5. **The classifier's shape** (static, no database), as for journey_01/02, for
   ``upgrade()`` and ``downgrade()`` both.

Applied by ALEMBIC (``run_alembic``), never by replaying statements. Substrate
comes from ``_alembic_harness``: an ephemeral database inside the test Postgres,
skipped when none is reachable.
"""

from __future__ import annotations

import json
from typing import Any

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
    run_alembic,
    upgrade_execute_calls,
)

_REVISION_ID = "journey_03_explorations_stop_unsettled"
_REVISION_FILENAME = "journey_03_explorations_stop_unsettled.py"
_CONSTRAINT = "ck_journey_explorations_stopped_because"
_DETAIL_CONSTRAINT = "ck_journey_explorations_stop_detail"

_SIX = (
    "budget_actions",
    "budget_depth",
    "budget_time",
    "frontier_exhausted",
    "app_unreachable",
    "auth_wall",
)
_NEW = "frontier_unsettled"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime — never pin it."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_NODE = json.dumps(
    {
        "specId": None,
        "stateIds": [],
        "modelled": False,
        "pathnameTemplate": "/login",
        "pageLabel": None,
    }
)

_INSERT = text(
    """
    INSERT INTO project.journey_explorations
        (run_id, app_id, runner_build_id, runner_instance, started_at,
         start, budget_max_actions, budget_max_depth, budget_max_wall_clock_s,
         spent_actions, spent_depth, spent_wall_clock_ms, stopped_because,
         stop_node, edges_added, frontier_remaining_by_reason)
    VALUES (:run_id, 'qontinui-web', 'build-1', 'primary', now(),
            '{"url": "http://localhost:3001/admin/coord"}'::jsonb, 60, 4, 300,
            :spent_actions, 2, 12345, :stopped_because,
            CAST(:stop_node AS jsonb), :edges_added, '{}'::jsonb)
    """
)

# The same row with ``stop_detail`` — a column only this revision adds, so the
# parent-revision insert above must not name it.
_INSERT_WITH_DETAIL = text(
    """
    INSERT INTO project.journey_explorations
        (run_id, app_id, runner_build_id, runner_instance, started_at,
         start, budget_max_actions, budget_max_depth, budget_max_wall_clock_s,
         spent_actions, spent_depth, spent_wall_clock_ms, stopped_because,
         stop_node, edges_added, frontier_remaining_by_reason, stop_detail)
    VALUES (:run_id, 'qontinui-web', 'build-1', 'primary', now(),
            '{"url": "http://localhost:3001/admin/coord"}'::jsonb, 60, 4, 300,
            :spent_actions, 2, 12345, :stopped_because,
            CAST(:stop_node AS jsonb), :edges_added, '{}'::jsonb,
            CAST(:stop_detail AS jsonb))
    """
)

# The shape the runner writes: its ``Unsettled`` block, camelCase. The two
# confirmation measures are null when no confirmation ran (not measured).
_DETAIL = json.dumps(
    {
        "unroutable": 0,
        "componentActions": 0,
        "attemptsFailed": 1,
        "undrivable": 1,
        "activationFailedOpen": 1,
        "ledgerReadTruncated": False,
        "rowsUnreadable": 0,
        "exhaustionUnconfirmed": None,
        "openAtConfirmation": None,
        "edgeEventsDropped": 0,
        "snapshotRefusedByApp": False,
        "ledgerNotWriting": False,
        "ledgerWriteFailures": 0,
        "actionOutcomeUnknown": True,
        "snapshotOutcomeUnknown": False,
    }
)

_counter = iter(range(1_000_000))


def _insert(engine: Engine, **overrides: Any) -> str:
    params: dict[str, Any] = {
        "run_id": f"run-{next(_counter)}",
        "spent_actions": 10,
        "stopped_because": _NEW,
        "stop_node": None,
        "edges_added": 10,
    }
    params.update(overrides)
    statement = _INSERT_WITH_DETAIL if "stop_detail" in params else _INSERT
    with engine.begin() as conn:
        conn.execute(statement, params)
    return str(params["run_id"])


def _has_constraint(engine: Engine, name: str) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM pg_constraint c
                         WHERE c.conrelid = 'project.journey_explorations'::regclass
                           AND c.conname = :name
                    )
                    """
                ),
                {"name": name},
            ).scalar_one()
        )


def _has_stop_detail(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'project'
                           AND table_name = 'journey_explorations'
                           AND column_name = 'stop_detail'
                           AND data_type = 'jsonb'
                           AND is_nullable = 'YES'
                    )
                    """
                )
            ).scalar_one()
        )


def _stop_words(engine: Engine) -> str:
    """The constraint's definition as Postgres holds it."""
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(
                    """
                    SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                     WHERE c.conrelid = 'project.journey_explorations'::regclass
                       AND c.conname = :name
                    """
                ),
                {"name": _CONSTRAINT},
            ).scalar_one()
        )


def _statements(function: str) -> list[str]:
    """``function``'s statements, normalised, after the classifier's shape.

    Both ``upgrade()`` and ``downgrade()`` run on coord's migration path, so
    both are held to ONE inline static literal per call and a bounded lock wait
    set first and reset last.
    """
    calls = upgrade_execute_calls(
        backend_root() / "alembic" / "versions" / _REVISION_FILENAME,
        function=function,
    )
    assert calls, f"{function}() runs no op.execute"
    dynamic = [i for i, call in enumerate(calls) if call.sql is None]
    assert not dynamic, (
        f"op.execute call(s) {dynamic} in {function}() do not take ONE inline "
        "static string literal — coord's classifier holds that as dynamic SQL"
    )
    statements = [" ".join(c.sql.split()).upper() for c in calls if c.sql]
    assert statements[0] == "SET LOCAL LOCK_TIMEOUT = '3S'", statements
    assert statements[-1] == "SET LOCAL LOCK_TIMEOUT = DEFAULT", statements
    return statements


_TABLE = "ALTER TABLE PROJECT.JOURNEY_EXPLORATIONS"


def test_journey_03_upgrade_is_shaped_for_the_migration_classifier() -> None:
    """Static: drop-then-re-add of the one CHECK, then stop_detail."""
    statements = _statements("upgrade")
    assert len(statements) == 5, statements
    drop, check, detail = statements[1:4]
    assert drop == f"{_TABLE} DROP CONSTRAINT IF EXISTS {_CONSTRAINT.upper()}", drop
    assert check.startswith(f"{_TABLE} ADD CONSTRAINT {_CONSTRAINT.upper()} CHECK"), (
        check
    )
    for word in (*_SIX, _NEW):
        assert f"'{word.upper()}'" in check, word
    assert detail.startswith(
        f"{_TABLE} ADD COLUMN STOP_DETAIL JSONB, "
        f"ADD CONSTRAINT {_DETAIL_CONSTRAINT.upper()} CHECK"
    ), detail
    assert f"STOPPED_BECAUSE = '{_NEW.upper()}'" in detail, detail
    assert "JSONB_TYPEOF(STOP_DETAIL) = 'OBJECT'" in detail, detail


def test_journey_03_downgrade_is_shaped_for_the_migration_classifier() -> None:
    """Static: the refusing ADD comes FIRST, so a refusal changes nothing.

    The six-word CHECK is added under a temporary name while the seven-word
    one still stands; only then is the old one dropped, the new one renamed
    into its place, and stop_detail dropped.
    """
    statements = _statements("downgrade")
    assert len(statements) == 6, statements
    add, drop, rename, detail = statements[1:5]
    temp = f"{_CONSTRAINT.upper()}_SIX"
    assert add.startswith(f"{_TABLE} ADD CONSTRAINT {temp} CHECK"), add
    for word in _SIX:
        assert f"'{word.upper()}'" in add, word
    assert f"'{_NEW.upper()}'" not in add, add
    assert drop == f"{_TABLE} DROP CONSTRAINT IF EXISTS {_CONSTRAINT.upper()}", drop
    assert rename == f"{_TABLE} RENAME CONSTRAINT {temp} TO {_CONSTRAINT.upper()}", (
        rename
    )
    assert detail == f"{_TABLE} DROP COLUMN IF EXISTS STOP_DETAIL", detail


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_journey_03_accepts_frontier_unsettled_and_downgrades_honestly() -> None:
    """Seventh word in; nothing else moved; the downgrade refuses to rewrite."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "journey03_test") as (engine, url):
        # 1. Parent — the six words; the seventh is refused; no stop_detail.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        with pytest.raises(IntegrityError, match=_CONSTRAINT):
            _insert(engine)
        assert not _has_stop_detail(engine)

        # 2. Apply — the seventh is accepted, the six still are, junk is not.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        unsettled = _insert(engine)
        for word in _SIX:
            _insert(
                engine,
                stopped_because=word,
                stop_node=_NODE if word == "auth_wall" else None,
            )
        with pytest.raises(IntegrityError, match=_CONSTRAINT):
            _insert(engine, stopped_because="timeout")
        assert _NEW in _stop_words(engine)

        # 2b. The row says why: the breakdown on a frontier_unsettled row only.
        assert _has_stop_detail(engine)
        detailed = _insert(engine, stop_detail=_DETAIL)
        with engine.connect() as conn:
            stored = conn.execute(
                text(
                    "SELECT stop_detail FROM project.journey_explorations"
                    " WHERE run_id = :r"
                ),
                {"r": detailed},
            ).scalar_one()
        assert stored == json.loads(_DETAIL)
        _insert(engine, stopped_because="budget_time", stop_detail=None)
        with pytest.raises(IntegrityError, match=_DETAIL_CONSTRAINT):
            _insert(engine, stop_detail=json.dumps([1]))
        with pytest.raises(IntegrityError, match=_DETAIL_CONSTRAINT):
            _insert(engine, stopped_because="budget_actions", stop_detail=_DETAIL)

        # 3. Nothing else moved.
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_auth_wall_names_node"
        ):
            _insert(engine, stopped_because="auth_wall", stop_node=None)
        with pytest.raises(IntegrityError, match="ck_journey_explorations_edges_added"):
            _insert(engine, edges_added=11)

        # 4. The downgrade refuses while a frontier_unsettled row exists ...
        failed = run_alembic(
            root, url, "downgrade", _PARENT_REVISION_ID, expect_success=False
        )
        assert failed.returncode != 0
        # Refused BY the temporary six-word CHECK — not a lock timeout or a typo.
        # The quoted name and the violation text come only from PostgreSQL's own
        # error; the echoed SQL names the constraint unquoted.
        assert f'check constraint "{_CONSTRAINT}_six"' in failed.stderr, failed.stderr
        assert "is violated by some row" in failed.stderr, failed.stderr
        assert _NEW in _stop_words(engine), "a refused downgrade changed nothing"
        assert _has_stop_detail(engine), "a refused downgrade dropped nothing"
        assert not _has_constraint(engine, f"{_CONSTRAINT}_six")

        # ... and restores exactly the six once those rows are gone.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "DELETE FROM project.journey_explorations WHERE run_id IN (:a, :b)"
                ),
                {"a": unsettled, "b": detailed},
            )
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        restored = _stop_words(engine)
        assert _NEW not in restored
        for word in _SIX:
            assert word in restored, word
        assert not _has_stop_detail(engine)
        assert not _has_constraint(engine, f"{_CONSTRAINT}_six"), "renamed into place"

        # 5. Re-apply cleanly.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _insert(engine)
        _insert(engine, stop_detail=_DETAIL)
