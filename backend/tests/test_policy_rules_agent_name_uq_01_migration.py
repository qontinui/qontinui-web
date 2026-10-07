"""Behaviour test for the ``policy_rules_agent_name_uq_01`` revision.

The revision adds one partial unique index to ``coord.policy_rules``::

    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_policy_rules_agent_domain_name
        ON coord.policy_rules (tenant_id, decision_domain, name)
        WHERE kind IS NULL AND decision_domain IN ('pr_fix', 'red_main_fix')
          AND created_by is an agent spelling (session: / agent: / device:)

Follow-up 1 of plan ``2026-09-06-decision-policy-rows-are-operator-only-to-create``.
The contract is that **two agent-authored rows with the same (tenant, domain,
name) cannot both exist**, while operator authoring is untouched — so that is
what is pinned here, not merely that the DDL executes.

What is asserted
================

1. The index does not exist at the parent revision.
2. After upgrade it exists and is **``indisvalid``** — a killed ``CONCURRENTLY``
   build leaves an INVALID index that ``IF NOT EXISTS`` would skip on re-run,
   so existence alone would green a dead constraint.
3. A second AGENT row with the same (tenant, decision_domain, name) is refused
   with SQLSTATE 23505 naming this index — for each of the three agent actor
   spellings.
   The same holds in ``red_main_fix``.
4. The predicate's edges are NOT constrained: two OPERATOR rows with one name,
   two agent rows in an unlisted domain, two agent rows in different tenants,
   an agent row sharing an operator row's name, and two agent rows with a
   non-NULL (v1) ``kind`` all insert.
5. Downgrade removes the index; rows survive.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "policy_rules_agent_name_uq_01"
_PARENT_REVISION_ID = "coord_smckpt_01_success_metric_checkpoint_results"
_INDEX_NAME = "uq_policy_rules_agent_domain_name"

_TENANT = uuid.UUID("00000000-0000-4000-8000-0000000a9e01")
_OTHER_TENANT = uuid.UUID("00000000-0000-4000-8000-0000000a9e02")


def _seed_tenants(engine: Engine) -> None:
    with engine.begin() as conn:
        for tid in (_TENANT, _OTHER_TENANT):
            conn.execute(
                text(
                    "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                    "VALUES (:t, :s, :s)"
                ),
                {"t": tid, "s": f"uq-test-{tid.hex[-4:]}"},
            )


def _insert(
    engine: Engine,
    *,
    name: str,
    created_by: str,
    domain: str = "pr_fix",
    tenant: uuid.UUID = _TENANT,
    kind: str | None = None,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.policy_rules
                    (policy_id, tenant_id, name, kind, decision_domain, mode,
                     payload, condition, action, priority, created_by, updated_by)
                VALUES (:pid, :t, :name, :kind, :domain, 'guidance',
                        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 100, :by, :by)
                """
            ),
            {
                "pid": uuid.uuid4(),
                "t": tenant,
                "name": name,
                "domain": domain,
                "by": created_by,
                "kind": kind,
            },
        )


def _index_is_valid(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT i.indisvalid
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'coord' AND c.relname = :name
                    """
                ),
                {"name": _INDEX_NAME},
            ).scalar()
        )


def _count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(text("SELECT count(*) FROM coord.policy_rules")).scalar() or 0
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_policy_rules_agent_name_uq_01_refuses_agent_duplicates_only() -> None:
    """One agent-authored row per (tenant, domain, name); operators untouched."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "policy_agent_uq_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — no index.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME), (
            "the index must be created by this revision, not an earlier one"
        )
        _seed_tenants(engine)

        # 2. Upgrade — the index exists and is VALID.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_is_valid(engine), (
            "a CONCURRENTLY build must leave a VALID index; an invalid one would "
            "be skipped by IF NOT EXISTS on every re-run"
        )

        # 3. Agent duplicates are refused, for every agent actor spelling.
        for i, actor in enumerate(
            (
                f"session:{uuid.uuid4()}",
                f"agent:{uuid.uuid4()}",
                f"device:{uuid.uuid4()}",
            )
        ):
            name = f"agent-row-{i}"
            _insert(engine, name=name, created_by=actor)
            with pytest.raises(IntegrityError) as exc:
                _insert(engine, name=name, created_by=f"device:{uuid.uuid4()}")
            assert getattr(exc.value.orig, "pgcode", None) == "23505"
            assert _INDEX_NAME in str(exc.value.orig)

        # 3b. ...and in the second allowlisted domain, so dropping
        # 'red_main_fix' from the predicate fails here too.
        _insert(engine, name="red-main", created_by="device:x", domain="red_main_fix")
        with pytest.raises(IntegrityError) as exc:
            _insert(
                engine, name="red-main", created_by="device:y", domain="red_main_fix"
            )
        assert getattr(exc.value.orig, "pgcode", None) == "23505"

        # 4. The predicate's edges stay unconstrained.
        before = _count(engine)
        _insert(engine, name="op-row", created_by="operator:a:b")
        _insert(engine, name="op-row", created_by="operator:a:b")
        _insert(engine, name="unlisted", created_by="device:x", domain="next_step")
        _insert(engine, name="unlisted", created_by="device:x", domain="next_step")
        _insert(engine, name="cross-tenant", created_by="device:x")
        _insert(
            engine, name="cross-tenant", created_by="device:x", tenant=_OTHER_TENANT
        )
        _insert(engine, name="op-row", created_by="device:x")
        # A v1 (non-NULL kind) row is outside the predicate: dropping
        # `kind IS NULL` would refuse the second of these.
        _insert(engine, name="v1-row", created_by="device:x", kind="escalation_rule")
        _insert(engine, name="v1-row", created_by="device:x", kind="escalation_rule")
        assert _count(engine) == before + 9

        # 5. Downgrade drops the index; rows survive.
        rows = _count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _count(engine) == rows
