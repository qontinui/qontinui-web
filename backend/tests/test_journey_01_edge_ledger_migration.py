"""Behaviour test for ``journey_01_edge_ledger`` — the observed journey ledger.

``migration-reversal.yml`` only confirms the statements execute against an
empty database. What this pins is the plan's frozen "Edge-observation
contract", which the runner producer and ``qontinui-schemas`` ``journey.rs``
implement independently — so a drift here breaks writes on another repo's hot
path, where it surfaces only as ``LedgerState::write_failing``:

1. **Shape** — both tables with EXACTLY the contract's columns, types and
   nullability; the two indexes over the contract's key columns; the frontier
   primary key; nothing after downgrade.
2. **Closed vocabularies** — every enumerated column refuses an unknown word
   and accepts every contract word.
3. **The pending-edge rule** — ``to_node IS NULL`` iff ``outcome =
   'to_node_unobserved'``, enforced in both directions.
4. **Shape of the JSONB columns** — a JSON ``null`` cannot pose as a node or
   a trigger: ``from_node`` / ``trigger`` / frontier ``node`` must be objects,
   ``to_node`` SQL NULL or an object.
5. **Defaults** — ``id`` and ``observed_at`` are server-stamped, so the
   producer's INSERT may omit them.
6. **No ``journey_explorations``** — Phase 3 owns it.
7. **The shape coord's migration classifier admits** (a static test, no
   database): every ``op.execute`` in ``upgrade()`` takes one inline static
   literal, every ``CREATE TABLE`` is ``IF NOT EXISTS``, every ``CREATE INDEX``
   is ``CONCURRENTLY IF NOT EXISTS`` inside ``autocommit_block()``. This mirrors
   the classifier's rules; it does not replace it.

How the revision is applied: by ALEMBIC itself (``run_alembic``), never by
replaying its statements — so the ``autocommit_block`` commits alembic's
transaction and the CONCURRENTLY builds run in autocommit exactly as they do in
production. The indexes asserted below are the ones that path built.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import json
import re

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REVISION_ID = "journey_01_edge_ledger"
_REVISION_FILENAME = "journey_01_edge_ledger.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime — never pin it.

    ``alembic-graph-pr.yml`` serialises alembic PRs, so the parent is re-pointed
    whenever a revision lands ahead of this one; a constant here would upgrade
    to a revision that is no longer this one's parent.
    """
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(r'^down_revision:.*=\s*"([^"]+)"', source, re.MULTILINE)
    assert match, f"{_REVISION_FILENAME} must declare a down_revision"
    return match.group(1)


_PARENT_REVISION_ID = _parent_revision_id()

_EDGES = "journey_edge_observations"
_FRONTIER = "journey_frontier"

_TS = "timestamp with time zone"

# The contract, EXACTLY: name -> (data_type, is_nullable). The four
# invalidation columns match project.co_occurrence_observations' types.
_EXPECTED_EDGE_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "observed_at": (_TS, "NO"),
    "app_id": ("text", "NO"),
    "app_version": ("text", "YES"),
    "runner_build_id": ("text", "NO"),
    "runner_instance": ("text", "NO"),
    "run_id": ("text", "YES"),
    "run_kind": ("text", "NO"),
    "from_node": ("jsonb", "NO"),
    "to_node": ("jsonb", "YES"),
    "trigger": ("jsonb", "NO"),
    "outcome": ("text", "NO"),
    "timeline": ("jsonb", "YES"),
    "invalidated_at": (_TS, "YES"),
    "invalidated_reason": ("text", "YES"),
    "invalidated_by": ("text", "YES"),
    "invalidation_token": ("text", "YES"),
}

_EXPECTED_FRONTIER_COLUMNS: dict[str, tuple[str, str]] = {
    "app_id": ("text", "NO"),
    "node_key": ("text", "NO"),
    "node": ("jsonb", "NO"),
    "affordance_fingerprint": ("text", "NO"),
    "affordance_role": ("text", "YES"),
    "declared_effect": ("text", "YES"),
    "reason": ("text", "NO"),
    "first_seen_at": (_TS, "NO"),
    "last_seen_at": (_TS, "NO"),
    "last_seen_run_id": ("text", "YES"),
}

# indexdef fragment after "USING btree", per index.
_EXPECTED_EDGE_INDEXES: dict[str, str] = {
    "ix_journey_edge_observations_app_observed_at": (
        "(app_id, observed_at DESC) WHERE (invalidated_at IS NULL)"
    ),
    "ix_journey_edge_observations_app_run": "(app_id, run_id)",
}

_RUN_KINDS = ("agent_action", "explorer", "passive_session")
_OUTCOMES = ("changed", "no_change", "error", "settle_timeout")  # + to_node_unobserved
_EFFECTS = ("read", "write", "destructive")
_REASONS = (
    "not_yet_activated",
    "effect_undeclared",
    "effect_write",
    "effect_destructive",
    "budget_exhausted",
    "activation_failed",
)

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
    VALUES ('qontinui-web', 'build-1', 'primary', :run_kind,
            CAST(:from_node AS jsonb), CAST(:to_node AS jsonb),
            CAST(:trigger AS jsonb), :outcome)
    RETURNING id, observed_at
    """
)

_INSERT_FRONTIER = text(
    """
    INSERT INTO project.journey_frontier
        (app_id, node_key, node, affordance_fingerprint, declared_effect, reason)
    VALUES ('qontinui-web', :node_key, CAST(:node AS jsonb), :fp, :effect, :reason)
    RETURNING first_seen_at, last_seen_at
    """
)


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'project' AND table_name = :table
                """
            ),
            {"table": table},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _index_defs(engine: Engine, table: str, *, exclude: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = 'project' AND tablename = :table
                   AND indexname <> :exclude
                """
            ),
            {"table": table, "exclude": exclude},
        ).all()
    parsed: dict[str, str] = {}
    for name, indexdef in rows:
        _, sep, tail = indexdef.partition("USING btree ")
        assert sep, f"unexpected index definition for {name}: {indexdef}"
        parsed[name] = tail
    return parsed


def _primary_key(engine: Engine, qualified: str) -> list[str]:
    with engine.connect() as conn:
        return [
            row[0]
            for row in conn.execute(
                text(
                    """
                    SELECT a.attname
                      FROM pg_constraint c
                      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                        ON TRUE
                      JOIN pg_attribute a
                        ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                     WHERE c.conrelid = CAST(:rel AS regclass) AND c.contype = 'p'
                     ORDER BY k.ord
                    """
                ),
                {"rel": qualified},
            ).all()
        ]


# A JSON null — ``CAST('null' AS jsonb)`` — which is NOT SQL NULL.
_JSON_NULL = "null"


def _insert_edge(
    engine: Engine,
    *,
    run_kind: str = "agent_action",
    from_node: str = _NODE,
    to_node: str | None = _NODE,
    trigger: str = _TRIGGER,
    outcome: str = "changed",
) -> None:
    with engine.begin() as conn:
        conn.execute(
            _INSERT_EDGE,
            {
                "run_kind": run_kind,
                "from_node": from_node,
                "to_node": to_node,
                "trigger": trigger,
                "outcome": outcome,
            },
        )


def _insert_frontier(
    engine: Engine,
    *,
    fp: str,
    effect: str | None,
    reason: str,
    node: str = _NODE,
) -> None:
    with engine.begin() as conn:
        first_seen_at, last_seen_at = conn.execute(
            _INSERT_FRONTIER,
            {
                "node_key": "coord-runners#runners-list",
                "node": node,
                "fp": fp,
                "effect": effect,
                "reason": reason,
            },
        ).one()
    # Both server-stamped, and in order.
    assert first_seen_at is not None and last_seen_at is not None
    assert first_seen_at <= last_seen_at


def test_journey_01_upgrade_is_shaped_for_the_migration_classifier() -> None:
    """Static: the call shapes qontinui-coord's migration_classifier admits."""
    calls = upgrade_execute_calls(
        backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    )
    assert calls, "upgrade() runs no op.execute"
    dynamic = [i for i, call in enumerate(calls) if call.sql is None]
    assert not dynamic, (
        f"op.execute call(s) {dynamic} in upgrade() do not take ONE inline static "
        "string literal — coord's classifier holds that as dynamic SQL"
    )
    statements = [(" ".join(c.sql.split()).upper(), c) for c in calls if c.sql]
    tables = [s for s, _ in statements if s.startswith("CREATE TABLE")]
    indexes = [(s, c) for s, c in statements if s.startswith("CREATE INDEX")]
    assert len(tables) == 2 and len(indexes) == 2, statements
    for statement in tables:
        assert statement.startswith("CREATE TABLE IF NOT EXISTS PROJECT."), statement
    for statement, call in indexes:
        assert statement.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), (
            statement
        )
        assert call.in_autocommit_block, (
            f"{statement[:60]}… must sit inside op.get_context().autocommit_block()"
        )
    # Every statement is a CREATE; no DML or DROP on the upgrade path.
    assert all(s.startswith("CREATE ") for s, _ in statements), statements


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_journey_01_creates_the_contract_tables_and_enforces_their_vocabularies() -> (
    None
):
    """Shape, closed vocabularies, the pending-edge rule, defaults, reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "journey01_test") as (engine, url):
        # 1. Parent — neither table exists yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "project", _EDGES)
        assert not table_exists(engine, "project", _FRONTIER)

        # 2. Apply — exact shape.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _columns(engine, _EDGES) == _EXPECTED_EDGE_COLUMNS
        assert _columns(engine, _FRONTIER) == _EXPECTED_FRONTIER_COLUMNS
        assert (
            _index_defs(engine, _EDGES, exclude="journey_edge_observations_pkey")
            == _EXPECTED_EDGE_INDEXES
        )
        # The frontier carries no index but its primary key.
        assert _index_defs(engine, _FRONTIER, exclude="journey_frontier_pkey") == {}
        assert _primary_key(engine, f"project.{_EDGES}") == ["id"]
        assert _primary_key(engine, f"project.{_FRONTIER}") == [
            "app_id",
            "node_key",
            "affordance_fingerprint",
        ]
        assert not table_exists(engine, "project", "journey_explorations"), (
            "journey_explorations belongs to Phase 3, with the explorer that writes it"
        )

        # 3. Server defaults, read from the catalog — the producer's INSERT
        # omits these columns, so each must carry its default.
        for table, column, default in (
            (_EDGES, "id", "gen_random_uuid()"),
            (_EDGES, "observed_at", "now()"),
            (_FRONTIER, "first_seen_at", "now()"),
            (_FRONTIER, "last_seen_at", "now()"),
        ):
            info = column_info(engine, table, column, schema="project")
            assert info is not None and info[2] == default, (table, column, info)

        # Every contract word is accepted.
        for run_kind in _RUN_KINDS:
            _insert_edge(engine, run_kind=run_kind)
        for outcome in _OUTCOMES:
            _insert_edge(engine, outcome=outcome)
        _insert_edge(engine, to_node=None, outcome="to_node_unobserved")

        # 4. Unknown words are refused.
        with pytest.raises(
            IntegrityError, match="ck_journey_edge_observations_run_kind"
        ):
            _insert_edge(engine, run_kind="human")
        with pytest.raises(
            IntegrityError, match="ck_journey_edge_observations_outcome"
        ):
            _insert_edge(engine, outcome="timeout")

        # 5. The pending-edge rule, both directions.
        with pytest.raises(
            IntegrityError, match="ck_journey_edge_observations_to_node_iff_observed"
        ):
            _insert_edge(engine, to_node=None, outcome="changed")
        with pytest.raises(
            IntegrityError, match="ck_journey_edge_observations_to_node_iff_observed"
        ):
            _insert_edge(engine, to_node=_NODE, outcome="to_node_unobserved")

        # 5b. A JSON null is not a node or a trigger.
        with pytest.raises(
            IntegrityError, match="ck_journey_edge_observations_to_node_object"
        ):
            _insert_edge(engine, to_node=_JSON_NULL, outcome="changed")
        with pytest.raises(
            IntegrityError, match="ck_journey_edge_observations_from_node_object"
        ):
            _insert_edge(engine, from_node=_JSON_NULL)
        with pytest.raises(
            IntegrityError, match="ck_journey_edge_observations_trigger_object"
        ):
            _insert_edge(engine, trigger=_JSON_NULL)
        # Nor is any other non-object JSON value.
        with pytest.raises(
            IntegrityError, match="ck_journey_edge_observations_from_node_object"
        ):
            _insert_edge(engine, from_node='["coord-runners"]')

        # 6. Frontier vocabularies; NULL declared_effect is "undeclared", allowed.
        for i, reason in enumerate(_REASONS):
            _insert_frontier(engine, fp=f"fp-reason-{i}", effect=None, reason=reason)
        for effect in _EFFECTS:
            _insert_frontier(
                engine, fp=f"fp-effect-{effect}", effect=effect, reason="effect_write"
            )
        with pytest.raises(IntegrityError, match="ck_journey_frontier_declared_effect"):
            _insert_frontier(
                engine, fp="fp-bad-effect", effect="safe", reason="effect_write"
            )
        with pytest.raises(IntegrityError, match="ck_journey_frontier_reason"):
            _insert_frontier(engine, fp="fp-bad-reason", effect=None, reason="skipped")
        with pytest.raises(IntegrityError, match="ck_journey_frontier_node_object"):
            _insert_frontier(
                engine,
                fp="fp-null-node",
                effect=None,
                reason="not_yet_activated",
                node=_JSON_NULL,
            )
        # The key bounds the frontier: one row per (app, node, affordance).
        with pytest.raises(IntegrityError, match="journey_frontier_pkey"):
            _insert_frontier(
                engine, fp="fp-reason-0", effect=None, reason="not_yet_activated"
            )

        # 7. Downgrade — both tables and every index gone.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "project", _EDGES)
        assert not table_exists(engine, "project", _FRONTIER)
        for name in _EXPECTED_EDGE_INDEXES:
            assert not index_exists(engine, name, schema="project")

        # 8. Re-apply — the downgrade left no residue that blocks a clean upgrade.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "project", _EDGES)
        assert table_exists(engine, "project", _FRONTIER)
