"""coord.ci_* — the coord-managed ephemeral self-hosted CI runner fleet

Revision ID: cihost_01_ci_host_agent_fleet
Revises: overview_04_timeline
Create Date: 2026-10-04

Phase 1 of plan
``plans/2026-10-04-coord-managed-ephemeral-self-hosted-ci-runner-fleet.md``.
Authored by alembic in ``qontinui-web`` — coord authors zero ``coord.*`` DDL
(served policy ``production-and-cost`` ``alembic-sole-authorship``).

What the five tables are for
============================

One host agent per machine (plan D1) asks coord for one-job JIT runner
registrations (D3). Coord owns the policy — which pools exist, how many slots
each host should run, which trust class may run which pool — and these tables
are where it keeps it:

``coord.ci_host_agents``
    One row per ENROLLED host agent. The agent authenticates with an opaque
    256-bit secret issued once at enrolment; ``credential_hash`` is the
    lowercase sha256 hex of that secret and is the ONLY copy coord keeps (D3).
    ``revoked_at`` set means every heartbeat and JIT call is refused.
    ``declared_trust_class`` is operator-set: NULL means the agent may run
    ``pr`` pools only, never ``public`` or ``trusted`` (fail-closed until the
    machine trust-tier plan lands and the JIT door reads that instead).
    ``budget`` / ``availability_window`` / ``slots`` / versions are written by
    the agent's heartbeat.

    The availability window column is ``availability_window`` rather than
    ``window``: ``WINDOW`` is a reserved word in PostgreSQL, so the bare name
    would have to be double-quoted in every statement that names it.

``coord.ci_enrol_codes``
    Operator-issued, single-use, short-lived enrolment codes. Only the code's
    sha256 hex is stored (``code_hash``); the plaintext exists only in the one
    response that issued it. ``redeemed_at`` set means the code is spent.

``coord.ci_pool_specs``
    One row per ``(tenant, repo, label set)`` pool: the isolation class its
    slots run in (``uid_class``, plan D8), the per-slot sizing, and the
    ``min_idle`` / ``max_slots`` bounds the scaler places within (D5). Label
    sets are stored SORTED by the coord writer, so the unique key is the set.

``coord.ci_slot_leases``
    One row per JIT registration coord minted: which agent, which pool, which
    slot, and the coord-chosen ``runner_name``
    (``<host>-<pool>-<slot>-<lease8>``). It is the mapping coord's existing
    detectors use to collapse a fresh per-job runner name back onto
    ``(host, pool, slot)`` (D10). The JIT config itself is NEVER stored.

``coord.ci_slot_desired``
    The scaler's output (Phase 3): how many slots of each pool each agent
    should run. Until the scaler writes rows here, the heartbeat answers each
    eligible pool's ``min_idle``.

Seeds no rows: pool sizing is written through coord's spec door (Phase 4),
never by hand DML.

Tenant binding
==============

``ci_host_agents``, ``ci_enrol_codes`` and ``ci_pool_specs`` carry a
``tenant_id`` with an FK to ``coord.tenants`` ``ON DELETE CASCADE`` (the
``ghut01`` / ``coord_memory_synthesis_jobs`` style): these are configuration,
not a best-effort observation log, so a dangling tenant is a real defect.
``ci_slot_leases`` and ``ci_slot_desired`` are tenant-scoped through their
agent and pool FKs.

Idempotency / authorship posture
================================

* Every statement is ``coord.``-qualified (``alembic-schema-arg-gate``).
* ``CREATE TABLE IF NOT EXISTS`` with constraints inline (a new table holds no
  rows, so coord's migration classifier reads it as additive), and every
  secondary index ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` inside
  ``autocommit_block``.
* This revision was **HAND-AUTHORED**; ``alembic revision --autogenerate`` is
  never run here. Pure DDL, no app imports — the prod migrator lacks app deps.

Ordering
========

This revision must be APPLIED to the serving database before the coord build
whose ``ci_host_agent`` module reads these tables leaves draft (that coord PR
carries a ``coord:downstream-of`` label naming this PR). Coord's reads degrade
to a typed refusal on a missing table, so the order is a correctness
preference, not a crash risk. Done-when is
``coord_query_schema_object(table, "ci_host_agents")`` reading
``existence: present`` — not the merge.

``down_revision``
=================

The single head on qontinui-web ``origin/main`` ``e53886894``
(``overview_04_timeline``). qontinui-web#1552 (``machine_ci_hosts``) was open
when this was authored; whichever lands second re-points the token below AND
the ``Revises:`` line above at the merged head. Do not author an
``alembic merge`` revision.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cihost_01_ci_host_agent_fleet"
down_revision: str | Sequence[str] | None = "overview_04_timeline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the five coord.ci_* fleet tables and their indexes."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_host_agents (
            agent_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id            UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            credential_hash      TEXT NOT NULL,
            revoked_at           TIMESTAMPTZ,
            host                 TEXT NOT NULL,
            os                   TEXT NOT NULL,
            declared_trust_class TEXT,
            budget               JSONB,
            availability_window  JSONB,
            slots                JSONB,
            agent_version        TEXT,
            runner_version       TEXT,
            last_seen_at         TIMESTAMPTZ,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_ci_host_agents_credential_hash_sha256_hex
                CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT ck_ci_host_agents_declared_trust_class
                CHECK (declared_trust_class IS NULL
                       OR declared_trust_class IN ('pr', 'public', 'trusted')),
            CONSTRAINT ck_ci_host_agents_host_nonempty
                CHECK (length(host) > 0),
            CONSTRAINT ck_ci_host_agents_os
                CHECK (os IN ('linux', 'windows', 'macos'))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_enrol_codes (
            code_hash    TEXT PRIMARY KEY,
            tenant_id    UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            issued_by    TEXT NOT NULL,
            expires_at   TIMESTAMPTZ NOT NULL,
            redeemed_at  TIMESTAMPTZ,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_ci_enrol_codes_code_hash_sha256_hex
                CHECK (code_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT ck_ci_enrol_codes_expires_after_created
                CHECK (expires_at > created_at)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_pool_specs (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            repo         TEXT NOT NULL,
            labels       TEXT[] NOT NULL,
            uid_class    TEXT NOT NULL,
            docker       BOOLEAN NOT NULL DEFAULT false,
            mem_gib      INTEGER NOT NULL,
            cores        INTEGER NOT NULL,
            min_idle     INTEGER NOT NULL DEFAULT 0,
            max_slots    INTEGER NOT NULL,
            cache_class  TEXT,
            required     BOOLEAN NOT NULL DEFAULT false,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_ci_pool_specs_tenant_repo_labels
                UNIQUE (tenant_id, repo, labels),
            CONSTRAINT ck_ci_pool_specs_uid_class
                CHECK (uid_class IN ('pr', 'public', 'trusted')),
            CONSTRAINT ck_ci_pool_specs_repo_owner_name
                CHECK (repo ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
            CONSTRAINT ck_ci_pool_specs_labels_nonempty
                CHECK (cardinality(labels) > 0),
            CONSTRAINT ck_ci_pool_specs_mem_gib_positive
                CHECK (mem_gib > 0),
            CONSTRAINT ck_ci_pool_specs_cores_positive
                CHECK (cores > 0),
            CONSTRAINT ck_ci_pool_specs_min_idle_nonnegative
                CHECK (min_idle >= 0),
            CONSTRAINT ck_ci_pool_specs_max_slots_bounds_min_idle
                CHECK (max_slots >= min_idle)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_slot_leases (
            lease_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_id      UUID NOT NULL
                REFERENCES coord.ci_host_agents(agent_id) ON DELETE CASCADE,
            pool_spec_id  UUID NOT NULL
                REFERENCES coord.ci_pool_specs(id) ON DELETE CASCADE,
            slot          INTEGER NOT NULL,
            runner_name   TEXT NOT NULL,
            minted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            job_id        BIGINT,
            state         TEXT NOT NULL DEFAULT 'minted',
            CONSTRAINT uq_ci_slot_leases_runner_name UNIQUE (runner_name),
            CONSTRAINT ck_ci_slot_leases_slot_nonnegative CHECK (slot >= 0),
            CONSTRAINT ck_ci_slot_leases_state
                CHECK (state IN ('minted', 'busy', 'done', 'expired'))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_slot_desired (
            agent_id      UUID NOT NULL
                REFERENCES coord.ci_host_agents(agent_id) ON DELETE CASCADE,
            pool_spec_id  UUID NOT NULL
                REFERENCES coord.ci_pool_specs(id) ON DELETE CASCADE,
            desired       INTEGER NOT NULL,
            computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (agent_id, pool_spec_id),
            CONSTRAINT ck_ci_slot_desired_nonnegative CHECK (desired >= 0)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_host_agents IS
        'Enrolled CI host agents (plan 2026-10-04 D1/D3). credential_hash is the '
        'sha256 hex of the agent secret and the ONLY copy coord keeps; the secret '
        'is returned once at enrolment. declared_trust_class NULL means pr pools only.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_enrol_codes IS
        'Operator-issued single-use CI-agent enrolment codes. Only the sha256 hex '
        'of the code is stored; redeemed_at set means spent.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_pool_specs IS
        'Self-hosted CI pool specs: (tenant, repo, sorted label set) with uid_class, '
        'per-slot sizing and min_idle/max_slots bounds. Written through the coord '
        'spec door, never by hand DML.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_slot_leases IS
        'One row per coord-minted JIT runner registration: agent, pool, slot and the '
        'coord-chosen runner_name. The JIT config itself is never stored.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_slot_desired IS
        'Scaler output: desired slots per (agent, pool). Absent rows mean the '
        'heartbeat answers the pool min_idle.'
        """
    )
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_host_agents_tenant "
            "ON coord.ci_host_agents (tenant_id)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_enrol_codes_tenant "
            "ON coord.ci_enrol_codes (tenant_id)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_slot_leases_agent_pool_slot "
            "ON coord.ci_slot_leases (agent_id, pool_spec_id, slot)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_slot_leases_pool_spec "
            "ON coord.ci_slot_leases (pool_spec_id)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_slot_desired_pool_spec "
            "ON coord.ci_slot_desired (pool_spec_id)"
        )


def downgrade() -> None:
    """Reverse: drop the five tables, dependents first."""
    op.execute("DROP TABLE IF EXISTS coord.ci_slot_desired")
    op.execute("DROP TABLE IF EXISTS coord.ci_slot_leases")
    op.execute("DROP TABLE IF EXISTS coord.ci_pool_specs")
    op.execute("DROP TABLE IF EXISTS coord.ci_enrol_codes")
    op.execute("DROP TABLE IF EXISTS coord.ci_host_agents")
