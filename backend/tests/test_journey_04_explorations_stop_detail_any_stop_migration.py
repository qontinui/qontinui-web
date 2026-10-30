"""Behaviour test for ``journey_04_explorations_stop_detail_any_stop``.

The runner's explorer (``src-tauri/src/journey/explorer.rs``) measures its
``unsettled`` block whatever stopped a run, and stores it as ``stop_detail``
whenever it records an unknown — on a budget stop too. ``journey_03`` allowed
``stop_detail`` only on a ``frontier_unsettled`` row, so a budget-stopped run's
unknowns (dropped action events, failed journey writes, a closing look it could
not tie to a node) were lost from the durable row. So:

1. **Any stop may carry it** — after upgrade every one of the seven stop words
   takes a ``stop_detail`` object, under the SAME constraint name, and NULL is
   still accepted on every row (a ``frontier_unsettled`` row included: the
   database never required it — ``journey_03`` did not either).
2. **It is still only an object** — a JSON array or scalar is refused.
3. **Nothing else moved** — the other CHECKs still refuse what they refused.
4. **The downgrade refuses to drop a recorded unknown** — while a row that is
   not ``frontier_unsettled`` carries a ``stop_detail`` it fails, refused by
   PostgreSQL's own violation of the TEMPORARY tighter CHECK, and changes
   nothing; once those values are cleared it restores ``journey_03``'s CHECK
   exactly (a ``frontier_unsettled`` row's detail does not block it).
5. **The classifier's shape** (static, no database), as for journey_01..03,
   for ``upgrade()`` and ``downgrade()`` both.

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

_REVISION_ID = "journey_04_explorations_stop_detail_any_stop"
_REVISION_FILENAME = "journey_04_explorations_stop_detail_any_stop.py"
_DETAIL_CONSTRAINT = "ck_journey_explorations_stop_detail"
_TEMP_CONSTRAINT = f"{_DETAIL_CONSTRAINT}_unsettled_only"
_STOPPED_CONSTRAINT = "ck_journey_explorations_stopped_because"
_UNSETTLED = "frontier_unsettled"

_SEVEN = (
    "budget_actions",
    "budget_depth",
    "budget_time",
    "frontier_exhausted",
    _UNSETTLED,
    "app_unreachable",
    "auth_wall",
)


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
         stop_node, edges_added, frontier_remaining_by_reason, stop_detail)
    VALUES (:run_id, 'qontinui-web', 'build-1', 'primary', now(),
            '{"url": "http://localhost:3001/admin/coord"}'::jsonb, 60, 4, 300,
            10, 2, 12345, :stopped_because,
            CAST(:stop_node AS jsonb), 10, '{}'::jsonb,
            CAST(:stop_detail AS jsonb))
    """
)

# A BUDGET stop's block as the runner writes it: the stop is the budget, and
# the block records the unknowns the run carried — events the producer's queue
# dropped, and a closing look it could not complete.
_BUDGET_DETAIL = json.dumps(
    {
        "unroutable": 0,
        "componentActions": 0,
        "attemptsFailed": 0,
        "undrivable": 0,
        "activationFailedOpen": 0,
        "ledgerReadTruncated": False,
        "rowsUnreadable": 0,
        "exhaustionUnconfirmed": None,
        "openAtConfirmation": None,
        "closingLookFailed": True,
        "ledgerNotWriting": False,
        "ledgerWriteFailures": 0,
        "actionOutcomeUnknown": False,
        "snapshotOutcomeUnknown": False,
        "edgeEventsDropped": 2,
        "snapshotRefusedByApp": False,
    }
)

_counter = iter(range(1_000_000))


def _insert(engine: Engine, **overrides: Any) -> str:
    params: dict[str, Any] = {
        "run_id": f"run-{next(_counter)}",
        "stopped_because": "budget_actions",
        "stop_node": None,
        "stop_detail": _BUDGET_DETAIL,
    }
    params.update(overrides)
    if params["stopped_because"] == "auth_wall" and params["stop_node"] is None:
        params["stop_node"] = _NODE
    with engine.begin() as conn:
        conn.execute(_INSERT, params)
    return str(params["run_id"])


def _definition(engine: Engine, name: str) -> str | None:
    """A CHECK's definition as Postgres holds it, or ``None`` when absent."""
    with engine.connect() as conn:
        value = conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                 WHERE c.conrelid = 'project.journey_explorations'::regclass
                   AND c.conname = :name
                """
            ),
            {"name": name},
        ).scalar_one_or_none()
    return None if value is None else str(value)


def _detail_of(engine: Engine, run_id: str) -> object:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT stop_detail FROM project.journey_explorations WHERE run_id = :r"
            ),
            {"r": run_id},
        ).scalar_one()


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


def test_journey_04_upgrade_is_shaped_for_the_migration_classifier() -> None:
    """Static: drop-then-re-add of the one CHECK, with no stop word in it."""
    statements = _statements("upgrade")
    assert len(statements) == 4, statements
    drop, check = statements[1:3]
    assert drop == f"{_TABLE} DROP CONSTRAINT IF EXISTS {_DETAIL_CONSTRAINT.upper()}", (
        drop
    )
    assert check == (
        f"{_TABLE} ADD CONSTRAINT {_DETAIL_CONSTRAINT.upper()} CHECK "
        "(STOP_DETAIL IS NULL OR JSONB_TYPEOF(STOP_DETAIL) = 'OBJECT')"
    ), check


def test_journey_04_downgrade_is_shaped_for_the_migration_classifier() -> None:
    """Static: the refusing ADD comes FIRST, so a refusal changes nothing."""
    statements = _statements("downgrade")
    assert len(statements) == 5, statements
    add, drop, rename = statements[1:4]
    assert add.startswith(
        f"{_TABLE} ADD CONSTRAINT {_TEMP_CONSTRAINT.upper()} CHECK"
    ), add
    assert f"STOPPED_BECAUSE = '{_UNSETTLED.upper()}'" in add, add
    assert "JSONB_TYPEOF(STOP_DETAIL) = 'OBJECT'" in add, add
    assert drop == f"{_TABLE} DROP CONSTRAINT IF EXISTS {_DETAIL_CONSTRAINT.upper()}", (
        drop
    )
    assert rename == (
        f"{_TABLE} RENAME CONSTRAINT {_TEMP_CONSTRAINT.upper()} "
        f"TO {_DETAIL_CONSTRAINT.upper()}"
    ), rename


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_journey_04_stores_a_detail_on_any_stop_and_downgrades_honestly() -> None:
    """Any stop keeps its unknowns; the downgrade refuses to drop them."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "journey04_test") as (engine, url):
        # 1. Parent (journey_03) — a budget stop's detail is refused.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        with pytest.raises(IntegrityError, match=_DETAIL_CONSTRAINT):
            _insert(engine)
        parent_definition = _definition(engine, _DETAIL_CONSTRAINT)
        assert parent_definition is not None
        assert _UNSETTLED in parent_definition

        # 2. Apply — every stop word takes the block, under the same name.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        relaxed = _definition(engine, _DETAIL_CONSTRAINT)
        assert relaxed is not None
        assert _UNSETTLED not in relaxed, relaxed
        assert "jsonb_typeof(stop_detail)" in relaxed, relaxed
        stored = {word: _insert(engine, stopped_because=word) for word in _SEVEN}
        for word, run_id in stored.items():
            assert _detail_of(engine, run_id) == json.loads(_BUDGET_DETAIL), word
        # NULL on any row, frontier_unsettled included (never required here).
        for word in _SEVEN:
            _insert(engine, stopped_because=word, stop_detail=None)

        # 2b. Still only an object.
        for not_an_object in ("[1]", '"x"', "3", "null"):
            with pytest.raises(IntegrityError, match=_DETAIL_CONSTRAINT):
                _insert(engine, stop_detail=not_an_object)

        # 3. Nothing else moved.
        with pytest.raises(IntegrityError, match=_STOPPED_CONSTRAINT):
            _insert(engine, stopped_because="timeout")
        with pytest.raises(
            IntegrityError, match="ck_journey_explorations_auth_wall_names_node"
        ):
            with engine.begin() as conn:
                conn.execute(
                    _INSERT,
                    {
                        "run_id": "auth-no-node",
                        "stopped_because": "auth_wall",
                        "stop_node": None,
                        "stop_detail": None,
                    },
                )

        # 4. The downgrade refuses while another stop carries a detail ...
        failed = run_alembic(
            root, url, "downgrade", _PARENT_REVISION_ID, expect_success=False
        )
        assert failed.returncode != 0
        # Refused BY the temporary tighter CHECK — not a lock timeout or a typo.
        # The quoted name and the violation text come only from PostgreSQL's own
        # error; the echoed SQL names the constraint unquoted.
        assert f'check constraint "{_TEMP_CONSTRAINT}"' in failed.stderr, failed.stderr
        assert "is violated by some row" in failed.stderr, failed.stderr
        assert _definition(engine, _DETAIL_CONSTRAINT) == relaxed, (
            "a refused downgrade changed nothing"
        )
        assert _definition(engine, _TEMP_CONSTRAINT) is None
        with engine.connect() as conn:
            version = conn.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar()
        assert version == _REVISION_ID, "a refused downgrade left alembic_version alone"
        for word, run_id in stored.items():
            assert _detail_of(engine, run_id) == json.loads(_BUDGET_DETAIL), word

        # ... and restores journey_03's CHECK once only frontier_unsettled rows
        # carry one (their detail does not block it).
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE project.journey_explorations SET stop_detail = NULL"
                    " WHERE stopped_because <> :u"
                ),
                {"u": _UNSETTLED},
            )
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _definition(engine, _DETAIL_CONSTRAINT) == parent_definition
        assert _definition(engine, _TEMP_CONSTRAINT) is None, "renamed into place"
        assert _detail_of(engine, stored[_UNSETTLED]) == json.loads(_BUDGET_DETAIL)
        with pytest.raises(IntegrityError, match=_DETAIL_CONSTRAINT):
            _insert(engine)

        # 5. Re-apply cleanly.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _insert(engine)
        assert _definition(engine, _DETAIL_CONSTRAINT) == relaxed
