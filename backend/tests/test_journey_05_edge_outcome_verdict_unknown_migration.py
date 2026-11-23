"""Behaviour test for ``journey_05_edge_outcome_verdict_unknown``.

Plan ``2026-11-18-the-journey-ledger-never-records-an-unknown-action-verdict-as-a-success-or-a-failure``
D1 adds one ``EdgeOutcome`` word, ``verdict_unknown``: the action was attempted
and its own verdict is unknown — neither ``error`` nor a success. The runner
can only record it once the ledger's CHECK admits it. So:

1. **Refused before, accepted after** — at the parent revision a
   ``verdict_unknown`` edge is refused by ``ck_journey_edge_observations_outcome``;
   after upgrade it inserts WITH a ``to_node``, under the SAME constraint name,
   and every ``journey_01`` word is still accepted.
2. **The pending-edge rule is unchanged** — a ``verdict_unknown`` edge with a
   NULL ``to_node`` is refused by
   ``ck_journey_edge_observations_to_node_iff_observed``; only
   ``to_node_unobserved`` may omit it.
3. **Still a closed vocabulary** — an unknown word is still refused.
4. **The downgrade refuses to rewrite or drop a recorded unknown** — while a
   ``verdict_unknown`` row exists it fails, refused by PostgreSQL's own
   violation of the TEMPORARY five-word CHECK, and changes nothing; once those
   rows are gone it restores ``journey_01``'s CHECK exactly.
5. **The classifier's shape** (static, no database), as for journey_01..04,
   for ``upgrade()`` and ``downgrade()`` both.

Applied by ALEMBIC (``run_alembic``), never by replaying statements. Substrate
comes from ``_alembic_harness``: an ephemeral database inside the test Postgres,
skipped when none is reachable.
"""

from __future__ import annotations

import json

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

_REVISION_ID = "journey_05_edge_outcome_verdict_unknown"
_REVISION_FILENAME = "journey_05_edge_outcome_verdict_unknown.py"
_OUTCOME_CONSTRAINT = "ck_journey_edge_observations_outcome"
_TEMP_CONSTRAINT = f"{_OUTCOME_CONSTRAINT}_five"
_IFF_CONSTRAINT = "ck_journey_edge_observations_to_node_iff_observed"
_VERDICT_UNKNOWN = "verdict_unknown"

# journey_01's words that carry a to_node; to_node_unobserved is the one that
# does not.
_OBSERVED_OUTCOMES = ("changed", "no_change", "error", "settle_timeout")


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime — never pin it."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_NODE = json.dumps(
    {
        "specId": "coord-runners",
        "stateIds": ["runners-list"],
        "modelled": True,
        "pathnameTemplate": "/admin/coord/runners",
        "pageLabel": "coord-runners",
    }
)
_TRIGGER = json.dumps(
    {
        "actionType": "click",
        "targetFingerprint": "fp-1",
        "targetRole": "link",
        "declaredEffect": None,
        "navigationTrigger": "affordance",
        "chokePoint": "element_action",
    }
)

_INSERT_EDGE = text(
    """
    INSERT INTO project.journey_edge_observations
        (app_id, runner_build_id, runner_instance, run_kind,
         from_node, to_node, trigger, outcome)
    VALUES ('qontinui-web', 'build-1', 'primary', 'agent_action',
            CAST(:from_node AS jsonb), CAST(:to_node AS jsonb),
            CAST(:trigger AS jsonb), :outcome)
    RETURNING id
    """
)


def _insert_edge(engine: Engine, *, outcome: str, to_node: str | None = _NODE) -> str:
    with engine.begin() as conn:
        edge_id = conn.execute(
            _INSERT_EDGE,
            {
                "from_node": _NODE,
                "to_node": to_node,
                "trigger": _TRIGGER,
                "outcome": outcome,
            },
        ).scalar_one()
    return str(edge_id)


def _definition(engine: Engine, name: str) -> str | None:
    """A CHECK's definition as Postgres holds it, or ``None`` when absent."""
    with engine.connect() as conn:
        value = conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                 WHERE c.conrelid = 'project.journey_edge_observations'::regclass
                   AND c.conname = :name
                """
            ),
            {"name": name},
        ).scalar_one_or_none()
    return None if value is None else str(value)


def _outcome_of(engine: Engine, edge_id: str) -> object:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT outcome FROM project.journey_edge_observations"
                " WHERE id = CAST(:i AS uuid)"
            ),
            {"i": edge_id},
        ).scalar_one()


def _statements(function: str) -> list[str]:
    """``function``'s statements, normalised, after the classifier's shape."""
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


_TABLE = "ALTER TABLE PROJECT.JOURNEY_EDGE_OBSERVATIONS"
_SIX = (
    "CHECK (OUTCOME IN ( 'CHANGED', 'NO_CHANGE', 'ERROR', 'SETTLE_TIMEOUT', "
    "'TO_NODE_UNOBSERVED', 'VERDICT_UNKNOWN' ))"
)
_FIVE = (
    "CHECK (OUTCOME IN ( 'CHANGED', 'NO_CHANGE', 'ERROR', 'SETTLE_TIMEOUT', "
    "'TO_NODE_UNOBSERVED' ))"
)


def test_journey_05_upgrade_is_shaped_for_the_migration_classifier() -> None:
    """Static: drop-then-re-add of the one CHECK, with the sixth word."""
    statements = _statements("upgrade")
    assert len(statements) == 4, statements
    drop, check = statements[1:3]
    assert (
        drop == f"{_TABLE} DROP CONSTRAINT IF EXISTS {_OUTCOME_CONSTRAINT.upper()}"
    ), drop
    assert check == f"{_TABLE} ADD CONSTRAINT {_OUTCOME_CONSTRAINT.upper()} {_SIX}", (
        check
    )


def test_journey_05_downgrade_is_shaped_for_the_migration_classifier() -> None:
    """Static: the refusing ADD comes FIRST, so a refusal changes nothing."""
    statements = _statements("downgrade")
    assert len(statements) == 5, statements
    add, drop, rename = statements[1:4]
    assert add == f"{_TABLE} ADD CONSTRAINT {_TEMP_CONSTRAINT.upper()} {_FIVE}", add
    assert (
        drop == f"{_TABLE} DROP CONSTRAINT IF EXISTS {_OUTCOME_CONSTRAINT.upper()}"
    ), drop
    assert rename == (
        f"{_TABLE} RENAME CONSTRAINT {_TEMP_CONSTRAINT.upper()} "
        f"TO {_OUTCOME_CONSTRAINT.upper()}"
    ), rename


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_journey_05_accepts_verdict_unknown_and_downgrades_honestly() -> None:
    """A verdict_unknown edge stores with its to_node; the downgrade keeps it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "journey05_test") as (engine, url):
        # 1. Parent — the five-word CHECK refuses verdict_unknown.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        with pytest.raises(IntegrityError, match=_OUTCOME_CONSTRAINT):
            _insert_edge(engine, outcome=_VERDICT_UNKNOWN)
        parent_definition = _definition(engine, _OUTCOME_CONSTRAINT)
        assert parent_definition is not None
        assert _VERDICT_UNKNOWN not in parent_definition

        # 2. Apply — verdict_unknown inserts WITH a to_node, same name.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        widened = _definition(engine, _OUTCOME_CONSTRAINT)
        assert widened is not None
        assert _VERDICT_UNKNOWN in widened, widened
        unknown_id = _insert_edge(engine, outcome=_VERDICT_UNKNOWN)
        assert _outcome_of(engine, unknown_id) == _VERDICT_UNKNOWN
        # Every journey_01 word is still accepted.
        for outcome in _OBSERVED_OUTCOMES:
            _insert_edge(engine, outcome=outcome)
        _insert_edge(engine, outcome="to_node_unobserved", to_node=None)

        # 2b. The pending-edge rule is unchanged: a verdict_unknown edge with
        # no to_node is refused; it is not a pending edge.
        with pytest.raises(IntegrityError, match=_IFF_CONSTRAINT):
            _insert_edge(engine, outcome=_VERDICT_UNKNOWN, to_node=None)

        # 3. Still a closed vocabulary.
        with pytest.raises(IntegrityError, match=_OUTCOME_CONSTRAINT):
            _insert_edge(engine, outcome="unknown")

        # 4. The downgrade refuses while a verdict_unknown row exists ...
        failed = run_alembic(
            root, url, "downgrade", _PARENT_REVISION_ID, expect_success=False
        )
        assert failed.returncode != 0
        # Refused BY the temporary five-word CHECK — not a lock timeout or a
        # typo. The quoted name and the violation text come only from
        # PostgreSQL's own error; the echoed SQL names the constraint unquoted.
        assert f'check constraint "{_TEMP_CONSTRAINT}"' in failed.stderr, failed.stderr
        assert "is violated by some row" in failed.stderr, failed.stderr
        assert _definition(engine, _OUTCOME_CONSTRAINT) == widened, (
            "a refused downgrade changed nothing"
        )
        assert _definition(engine, _TEMP_CONSTRAINT) is None
        with engine.connect() as conn:
            version = conn.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar()
        assert version == _REVISION_ID, "a refused downgrade left alembic_version alone"
        assert _outcome_of(engine, unknown_id) == _VERDICT_UNKNOWN, (
            "a refused downgrade did not rewrite the recorded unknown"
        )

        # ... and restores journey_01's CHECK once those rows are gone.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "DELETE FROM project.journey_edge_observations WHERE outcome = :o"
                ),
                {"o": _VERDICT_UNKNOWN},
            )
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _definition(engine, _OUTCOME_CONSTRAINT) == parent_definition
        assert _definition(engine, _TEMP_CONSTRAINT) is None, "renamed into place"
        with pytest.raises(IntegrityError, match=_OUTCOME_CONSTRAINT):
            _insert_edge(engine, outcome=_VERDICT_UNKNOWN)

        # 5. Re-apply cleanly.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _insert_edge(engine, outcome=_VERDICT_UNKNOWN)
        assert _definition(engine, _OUTCOME_CONSTRAINT) == widened
