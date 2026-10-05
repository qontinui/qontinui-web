"""coord.ci_* — the coord-managed ephemeral self-hosted CI runner fleet

Revision ID: cihost_01_ci_host_agent_fleet
Revises: coord_ci_pool_observations_01
Create Date: 2026-10-04

Phase 1 of plan
``plans/2026-10-04-coord-managed-ephemeral-self-hosted-ci-runner-fleet.md``.
Authored by alembic in ``qontinui-web`` — coord authors zero ``coord.*`` DDL
(served policy ``production-and-cost`` ``alembic-sole-authorship``).

What the five tables are for
============================

One host agent per machine (plan D1) asks coord for one-job JIT runner
registrations (D3). Coord owns the policy — which pools exist, how many slots
each host should run, which hosts may hold secrets — and these tables are where
it keeps it.

Plan AMENDMENT 2026-10-04 (A2 / A2a) collapsed the trust split: there is ONE
pool vocabulary of capability labels, and pool labels never describe trust. What remains is a SECRETS-PLACEMENT choice (plan D7's trusted
pool, decided per secret) and an ``isolation`` attribute that is the seam for a
future isolation tier:

* ``ci_pool_specs.secrets_class`` — ``none`` | ``trusted`` (the D7
  secrets-holding pool);
* ``ci_host_agents.may_hold_secrets`` — operator-set, default false; a
  ``trusted`` pool runs only on an agent that may hold secrets;
* ``isolation`` on BOTH ``ci_pool_specs`` and ``ci_host_agents`` — text,
  default ``'shared'``, CHECK in (``shared``). A future tier ADDS a value to
  these CHECKs; it needs no new schema shape. Coord's eligibility predicate
  (``ci_host_agent::agent_may_run_pool``) is the one place it is enforced.

The tables:

``coord.ci_host_agents``
    One row per ENROLLED host agent. The agent authenticates with an opaque
    256-bit secret issued once at enrolment; ``credential_hash`` is the
    lowercase sha256 hex of that secret and is the ONLY copy coord keeps (D3).
    ``revoked_at`` set means every heartbeat and JIT call is refused.
    ``may_hold_secrets`` (default false) and ``isolation`` are operator-set.
    ``host`` is bound by the
    operator when the enrolment code is issued, never chosen by the agent,
    and is stored lower-case. ``budget`` / ``availability_window`` / ``slots``
    / versions are written by the agent's heartbeat.

    The availability window column is ``availability_window`` rather than
    ``window``: ``WINDOW`` is a reserved word in PostgreSQL, so the bare name
    would have to be double-quoted in every statement that names it.

``coord.ci_enrol_codes``
    Operator-issued, single-use, short-lived enrolment codes. Only the code's
    sha256 hex is stored (``code_hash``); the plaintext exists only in the one
    response that issued it. The operator binds ``host`` and
    ``may_hold_secrets`` at issue time, and the redeem copies both onto the new
    agent row. ``redeemed_at`` set means the code is spent.

``coord.ci_pool_specs``
    One row per ``(tenant, repo, label set)`` pool: its ``secrets_class`` and
    ``isolation`` (above), the per-slot sizing, and the
    ``min_idle`` / ``max_slots`` bounds the scaler places within (D5). Label
    sets are stored LOWER-CASE, SORTED (byte order) and DE-DUPLICATED, with no
    NULL or empty label — enforced by CHECKs against
    ``coord.ci_labels_normalized`` — so the unique key is the set, never one
    spelling of it. (GitHub matches ``runs-on`` labels case-insensitively, so
    lower-casing loses nothing.)

``coord.ci_slot_leases``
    One row per JIT registration coord minted: which agent, which pool, which
    slot, the coord-chosen ``runner_name`` (``<host>-<pool>-<slot>-<lease8>``,
    at most 63 characters) and GitHub's ``runner_id`` (what coord deletes the
    registration by when the slot is released). At most ONE live
    (``minted``/``busy``) lease per ``(agent, pool, slot)`` — a partial unique
    index, so two concurrent mints for one slot cannot both succeed. It is the
    mapping coord's detectors use to collapse a per-job runner name back onto
    ``(host, pool, slot)`` (D10). The JIT config itself is NEVER stored. A pool
    spec with ANY lease — live or historical — cannot be hard-deleted
    (``ON DELETE RESTRICT``): the leases are the audit trail of registrations
    coord minted. Retiring a pool is therefore a SOFT delete, which is the
    Phase 4 spec door's job (e.g. ``max_slots = 0`` / a retired flag), never a
    ``DELETE``.

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
``ghut01`` / ``coord_memory_synthesis_jobs`` style). ``ci_slot_leases`` and
``ci_slot_desired`` carry ``tenant_id`` too, with COMPOSITE foreign keys
``(agent_id, tenant_id)`` and ``(pool_spec_id, tenant_id)``, so a lease or a
desired row can never pair one tenant's agent with another tenant's pool. The
two parents carry the ``UNIQUE (…, tenant_id)`` keys those FKs need.

``coord.ci_labels_normalized(text[])``
======================================

An ``IMMUTABLE`` SQL function (``lower`` + ``DISTINCT`` + ``ORDER BY … COLLATE
"C"``) used by the pool-spec CHECK, because PostgreSQL forbids sub-queries
inside a CHECK.
Byte-order collation matches Rust's ``sort`` / ``dedup`` on ``String``, so the
coord writer and the constraint agree on what "sorted" means.

Idempotency / authorship posture
================================

* Every statement is ``coord.``-qualified (``alembic-schema-arg-gate``).
* ``CREATE TABLE IF NOT EXISTS`` with constraints inline (a new table holds no
  rows, so coord's migration classifier reads it as additive), and every
  secondary index ``CREATE … INDEX CONCURRENTLY IF NOT EXISTS`` inside
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

The single head on qontinui-web ``origin/main`` when this branch was last
rebased (``coord_ci_pool_observations_01``). If another revision lands first, re-point the token
below AND the ``Revises:`` line above at the merged head. Do not author an
``alembic merge`` revision.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cihost_01_ci_host_agent_fleet"
down_revision: str | Sequence[str] | None = "coord_ci_pool_observations_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the five coord.ci_* fleet tables, their helper and indexes."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION coord.ci_labels_normalized(labels text[])
        RETURNS text[]
        LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
        AS $fn$
            SELECT COALESCE(
                ARRAY(
                    SELECT DISTINCT lower(u.l COLLATE "C") COLLATE "C"
                      FROM unnest(labels) AS u(l)
                     ORDER BY 1
                ),
                '{}'::text[]
            )
        $fn$
        """
    )
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
            may_hold_secrets     BOOLEAN NOT NULL DEFAULT false,
            isolation            TEXT NOT NULL DEFAULT 'shared',
            budget               JSONB,
            availability_window  JSONB,
            slots                JSONB,
            agent_version        TEXT,
            runner_version       TEXT,
            last_seen_at         TIMESTAMPTZ,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_ci_host_agents_agent_tenant UNIQUE (agent_id, tenant_id),
            CONSTRAINT ck_ci_host_agents_credential_hash_sha256_hex
                CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT ck_ci_host_agents_isolation
                CHECK (isolation IN ('shared')),
            CONSTRAINT ck_ci_host_agents_host_lower
                CHECK (host ~ '^[a-z0-9][a-z0-9._-]{0,62}$'),
            CONSTRAINT ck_ci_host_agents_os
                CHECK (os IN ('linux', 'windows', 'macos'))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_enrol_codes (
            code_hash            TEXT PRIMARY KEY,
            tenant_id            UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            issued_by            TEXT NOT NULL,
            host                 TEXT NOT NULL,
            may_hold_secrets     BOOLEAN NOT NULL DEFAULT false,
            expires_at           TIMESTAMPTZ NOT NULL,
            redeemed_at          TIMESTAMPTZ,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_ci_enrol_codes_code_hash_sha256_hex
                CHECK (code_hash ~ '^[0-9a-f]{64}$'),
            CONSTRAINT ck_ci_enrol_codes_expires_after_created
                CHECK (expires_at > created_at),
            CONSTRAINT ck_ci_enrol_codes_host_lower
                CHECK (host ~ '^[a-z0-9][a-z0-9._-]{0,62}$')
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
            secrets_class TEXT NOT NULL DEFAULT 'none',
            isolation    TEXT NOT NULL DEFAULT 'shared',
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
            CONSTRAINT uq_ci_pool_specs_id_tenant UNIQUE (id, tenant_id),
            CONSTRAINT ck_ci_pool_specs_secrets_class
                CHECK (secrets_class IN ('none', 'trusted')),
            CONSTRAINT ck_ci_pool_specs_isolation
                CHECK (isolation IN ('shared')),
            CONSTRAINT ck_ci_pool_specs_repo_owner_name
                CHECK (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
                       AND split_part(repo, '/', 1) NOT IN ('.', '..')
                       AND split_part(repo, '/', 2) NOT IN ('.', '..')),
            CONSTRAINT ck_ci_pool_specs_labels_nonempty
                CHECK (cardinality(labels) > 0),
            CONSTRAINT ck_ci_pool_specs_labels_no_null_or_empty
                CHECK (array_position(labels, NULL) IS NULL
                       AND array_position(labels, '') IS NULL),
            CONSTRAINT ck_ci_pool_specs_labels_normalized
                CHECK (labels = coord.ci_labels_normalized(labels)),
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
            tenant_id     UUID NOT NULL,
            agent_id      UUID NOT NULL,
            pool_spec_id  UUID NOT NULL,
            slot          INTEGER NOT NULL,
            runner_name   TEXT NOT NULL,
            runner_id     BIGINT,
            minted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            job_id        BIGINT,
            state         TEXT NOT NULL DEFAULT 'minted',
            CONSTRAINT fk_ci_slot_leases_agent_tenant
                FOREIGN KEY (agent_id, tenant_id)
                REFERENCES coord.ci_host_agents (agent_id, tenant_id) ON DELETE CASCADE,
            CONSTRAINT fk_ci_slot_leases_pool_tenant
                FOREIGN KEY (pool_spec_id, tenant_id)
                REFERENCES coord.ci_pool_specs (id, tenant_id) ON DELETE RESTRICT,
            CONSTRAINT uq_ci_slot_leases_runner_name UNIQUE (runner_name),
            CONSTRAINT ck_ci_slot_leases_runner_name_length
                CHECK (char_length(runner_name) BETWEEN 1 AND 63),
            CONSTRAINT ck_ci_slot_leases_slot_range CHECK (slot BETWEEN 0 AND 1023),
            CONSTRAINT ck_ci_slot_leases_state
                CHECK (state IN ('minted', 'busy', 'done', 'expired'))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_slot_desired (
            agent_id      UUID NOT NULL,
            pool_spec_id  UUID NOT NULL,
            tenant_id     UUID NOT NULL,
            desired       INTEGER NOT NULL,
            computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (agent_id, pool_spec_id),
            CONSTRAINT fk_ci_slot_desired_agent_tenant
                FOREIGN KEY (agent_id, tenant_id)
                REFERENCES coord.ci_host_agents (agent_id, tenant_id) ON DELETE CASCADE,
            CONSTRAINT fk_ci_slot_desired_pool_tenant
                FOREIGN KEY (pool_spec_id, tenant_id)
                REFERENCES coord.ci_pool_specs (id, tenant_id) ON DELETE CASCADE,
            CONSTRAINT ck_ci_slot_desired_nonnegative CHECK (desired >= 0)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_host_agents IS
        'Enrolled CI host agents (plan 2026-10-04 D1/D3). credential_hash is the '
        'sha256 hex of the agent secret and the ONLY copy coord keeps; the secret '
        'is returned once at enrolment. may_hold_secrets gates trusted '
        '(secrets-holding) pools; isolation is the future isolation-tier seam.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_enrol_codes IS
        'Operator-issued single-use CI-agent enrolment codes binding host and '
        'may_hold_secrets. Only the sha256 hex of the code is stored; '
        'redeemed_at set means spent.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_pool_specs IS
        'Self-hosted CI pool specs: (tenant, repo, sorted distinct label set) with '
        'secrets_class, isolation, per-slot sizing and min_idle/max_slots bounds. Written through '
        'the coord spec door, never by hand DML.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_slot_leases IS
        'One row per coord-minted JIT runner registration: agent, pool, slot, the '
        'coord-chosen runner_name and GitHub runner_id. At most one live lease per '
        'slot. The JIT config itself is never stored.'
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
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_ci_slot_leases_live_slot "
            "ON coord.ci_slot_leases (agent_id, pool_spec_id, slot) "
            "WHERE state IN ('minted', 'busy')"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_slot_leases_pool_tenant "
            "ON coord.ci_slot_leases (pool_spec_id, tenant_id)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_slot_desired_pool_tenant "
            "ON coord.ci_slot_desired (pool_spec_id, tenant_id)"
        )


def downgrade() -> None:
    """Reverse: drop the five tables (dependents first), then the helper."""
    op.execute("DROP TABLE IF EXISTS coord.ci_slot_desired")
    op.execute("DROP TABLE IF EXISTS coord.ci_slot_leases")
    op.execute("DROP TABLE IF EXISTS coord.ci_pool_specs")
    op.execute("DROP TABLE IF EXISTS coord.ci_enrol_codes")
    op.execute("DROP TABLE IF EXISTS coord.ci_host_agents")
    op.execute("DROP FUNCTION IF EXISTS coord.ci_labels_normalized(text[])")
