"""coord device_status re-key — PK (device_id) → (device_id, tenant_id)

Revision ID: coord_device_status_mt_pk
Revises: coord_tenant_devices_mn
Create Date: 2026-07-03

Phase 7 (web half) of the session-scoped multi-tenant device-binding
rollout (``D:/qontinui-root/plans/2026-07-02-session-scoped-multi-tenant-device-binding.md``,
design D5, Option A — full concurrent).

``coord.device_status`` is the per-machine "what is each agent doing
right now" surface. Under 1:1 tenancy its single-column PK
(``device_id``) was correct; under Option A one device runs sessions
for N tenants CONCURRENTLY, and coord's UPSERT ``ON CONFLICT
(device_id) ... tenant_id = EXCLUDED.tenant_id`` is last-writer-wins
across tenants — each tenant's dashboard flickers with the other's
activity. Fix: one status row per (device, tenant).

What this revision does (raw SQL only — coord.* tables deliberately
have NO ORM model; a mapped model would re-enter the
``sorted_tables`` FK-cycle trap):

1. ``DELETE`` rows where ``tenant_id IS NULL``. Rows are short-lived
   (1h ``prune_stale``) so there is no backfill value — plan D5 calls
   for delete-over-backfill.
2. ``ALTER COLUMN tenant_id SET NOT NULL`` (it becomes a PK member).
3. Re-point the tenant FK ``ON DELETE SET NULL`` → ``ON DELETE
   CASCADE`` — SET NULL (the posture ``coord_device_status_tenant_id``
   chose while the column was nullable) would violate the new NOT
   NULL + PK on tenant deletion; cascade-wiping ≤1h-lived activity
   rows is the correct posture.
4. Swap the PK: drop the existing single-column PK, add
   ``device_status_pkey PRIMARY KEY (device_id, tenant_id)``.

   NAMING TRAP (discovered, not assumed): the table was created as
   ``coord.machine_status`` (``coordinator_phase_6_agent_coordination_hardening``)
   and renamed to ``device_status`` by ``ud01_unify_devices_registry``
   — but PostgreSQL does NOT rename constraints on table rename, so
   the live PK constraint is still named ``machine_status_pkey``.
   The swap therefore looks the PK up by ``contype = 'p'`` in
   ``pg_constraint`` rather than hard-coding a name, and verifies the
   column set so a re-run (or an already-migrated DB) is a no-op.
5. Re-create ``idx_device_status_tenant`` WITHOUT its
   ``WHERE tenant_id IS NOT NULL`` predicate — vacuous once the
   column is NOT NULL. Shape (``tenant_id, updated_at DESC``) is
   unchanged and still serves ``GET /coord/status?tenant_id=`` (the
   new PK's index leads on ``device_id`` and cannot). The other
   index, ``idx_machine_status_updated`` (``updated_at DESC``, also
   never renamed), is untouched — it serves ``prune_stale`` and the
   unfiltered ORDER BY.

Deploy order (plan Phase 7 note): this migration ships FIRST; coord's
``status.rs`` conflict-target change to ``(device_id, tenant_id)``
deploys after (the new conflict target requires this PK — against the
old schema it errors with "no unique or exclusion constraint matching
the ON CONFLICT specification"). The window CUTS BOTH WAYS: once the
old PK is dropped, the composite PK does not back the still-deployed
coord's bare ``ON CONFLICT (device_id)`` either, so status upserts
from the old binary error until the coord half deploys. That is why
the plan requires same-day sequencing or gating coord's SQL behind
the dark-table/readiness-probe pattern (probe the PK shape, emit the
matching conflict target). The blast radius is confined to the
device-status presence surface — rows are 1h-pruned exhaust and
self-heal as soon as the new writer lands.

Reservation: coord migration-reserve assigned this slot —
reservation ``7de96034-b1d5-4b97-a121-7ca4b7eaa1c7``, position 3,
assigned ``down_revision = coord_agent_sessions_derived_name``. That
parent is an in-flight sibling reservation NOT yet on ``main`` (nor
on this branch) — a STACKED reservation, the normal shape per the
reserve protocol: keep the assigned parent verbatim, never re-point
at a locally-observed head. ``alembic-heads-pr`` stays red until the
sibling chain lands; coord re-points this revision (gate + PR
comment) if a predecessor withdraws/expires. Position 1 of the same
queue is this branch's own Phase 2 revision
(``coord_tenant_devices_mn``).

Idempotent on re-run (IF EXISTS / column-set-verified DO blocks).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_device_status_mt_pk"
down_revision: str = "coord_tenant_devices_mn"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Re-key ``coord.device_status`` to PK ``(device_id, tenant_id)``."""
    # ----------------------------------------------------------------
    # 1. Tenant-less rows: short-lived (1h prune) heartbeat exhaust
    #    from pre-tenant writers — delete, don't backfill (plan D5).
    # ----------------------------------------------------------------
    op.execute("DELETE FROM coord.device_status WHERE tenant_id IS NULL")

    # ----------------------------------------------------------------
    # 2. PK members must be NOT NULL.
    # ----------------------------------------------------------------
    op.execute("ALTER TABLE coord.device_status ALTER COLUMN tenant_id SET NOT NULL")

    # ----------------------------------------------------------------
    # 3. Tenant FK: SET NULL → CASCADE. SET NULL is unsatisfiable now
    #    that tenant_id is NOT NULL; a deleted tenant's activity rows
    #    (≤1h lifetime) should just go.
    # ----------------------------------------------------------------
    op.execute("""
        ALTER TABLE coord.device_status
            DROP CONSTRAINT IF EXISTS device_status_tenant_id_fkey
        """)
    op.execute("""
        ALTER TABLE coord.device_status
            ADD CONSTRAINT device_status_tenant_id_fkey
                FOREIGN KEY (tenant_id)
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE
        """)

    # ----------------------------------------------------------------
    # 4. PK swap. Look the current PK up by contype (the live name is
    #    machine_status_pkey — table renames don't rename constraints);
    #    no-op when the composite PK is already in place.
    # ----------------------------------------------------------------
    op.execute("""
        DO $$
        DECLARE
            pk_name text;
            pk_cols text[];
        BEGIN
            SELECT c.conname,
                   (SELECT array_agg(a.attname::text ORDER BY k.ord)
                      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a
                        ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
              INTO pk_name, pk_cols
              FROM pg_constraint c
             WHERE c.conrelid = 'coord.device_status'::regclass
               AND c.contype = 'p';

            IF pk_name IS NOT NULL
               AND pk_cols <> ARRAY['device_id', 'tenant_id'] THEN
                EXECUTE format(
                    'ALTER TABLE coord.device_status DROP CONSTRAINT %I',
                    pk_name
                );
                pk_name := NULL;
            END IF;

            IF pk_name IS NULL THEN
                ALTER TABLE coord.device_status
                    ADD CONSTRAINT device_status_pkey
                        PRIMARY KEY (device_id, tenant_id);
            END IF;
        END
        $$
        """)

    # ----------------------------------------------------------------
    # 5. The tenant-filter index: same shape, minus the now-vacuous
    #    partial predicate.
    # ----------------------------------------------------------------
    op.execute("DROP INDEX IF EXISTS coord.idx_device_status_tenant")
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_device_status_tenant
            ON coord.device_status (tenant_id, updated_at DESC)
        """)


def downgrade() -> None:
    """Restore the single-column PK (original live name
    ``machine_status_pkey``), nullable ``tenant_id``, SET NULL FK, and
    the partial form of ``idx_device_status_tenant``."""
    # A device may now hold N per-tenant rows; the old PK admits one.
    # Keep the freshest row per device (tenant_id tie-break makes the
    # order total — (device_id, tenant_id) was unique).
    op.execute("""
        DELETE FROM coord.device_status ds
         USING coord.device_status newer
         WHERE newer.device_id = ds.device_id
           AND (newer.updated_at, newer.tenant_id)
             > (ds.updated_at, ds.tenant_id)
        """)

    op.execute("""
        DO $$
        DECLARE
            pk_name text;
            pk_cols text[];
        BEGIN
            SELECT c.conname,
                   (SELECT array_agg(a.attname::text ORDER BY k.ord)
                      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a
                        ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
              INTO pk_name, pk_cols
              FROM pg_constraint c
             WHERE c.conrelid = 'coord.device_status'::regclass
               AND c.contype = 'p';

            IF pk_name IS NOT NULL AND pk_cols <> ARRAY['device_id'] THEN
                EXECUTE format(
                    'ALTER TABLE coord.device_status DROP CONSTRAINT %I',
                    pk_name
                );
                pk_name := NULL;
            END IF;

            IF pk_name IS NULL THEN
                ALTER TABLE coord.device_status
                    ADD CONSTRAINT machine_status_pkey
                        PRIMARY KEY (device_id);
            END IF;
        END
        $$
        """)

    op.execute("ALTER TABLE coord.device_status ALTER COLUMN tenant_id DROP NOT NULL")

    op.execute("""
        ALTER TABLE coord.device_status
            DROP CONSTRAINT IF EXISTS device_status_tenant_id_fkey
        """)
    op.execute("""
        ALTER TABLE coord.device_status
            ADD CONSTRAINT device_status_tenant_id_fkey
                FOREIGN KEY (tenant_id)
                REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL
        """)

    op.execute("DROP INDEX IF EXISTS coord.idx_device_status_tenant")
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_device_status_tenant
            ON coord.device_status (tenant_id, updated_at DESC)
            WHERE tenant_id IS NOT NULL
        """)
