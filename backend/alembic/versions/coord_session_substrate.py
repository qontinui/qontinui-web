"""coord session substrate — sessions, session_events, session_output, tenant_policies

Revision ID: coord_session_substrate
Revises: pr_merge_10_rollout_state
Create Date: 2026-05-22

Phase 0 of the 2026-05-22 coord-native-session-coordination rollout
(``D:/qontinui-root/qontinui-dev-notes/plans/2026-05-22-coord-native-session-coordination.md``).

Adds the schema substrate that Phase 1 (coord REST + JetStream publish)
targets. Four new ``coord.*`` tables land:

* ``coord.sessions``           — single primitive for every operator session
                                  (TerminalShell / TerminalClaude / Agentic /
                                  Workflow / Automation / Debug). Per plan
                                  D1 + D2 every session is a first-class
                                  coord-native row, not a derived view.
* ``coord.session_events``     — append-only event log (1:N from sessions).
                                  Idempotency tuple is ``(session_id, seq)``;
                                  per plan D7 the runner writes locally
                                  first then drains to coord, replaying by
                                  ``seq`` on reconnect.
* ``coord.session_output``     — warm-tier PTY output capture per plan D11
                                  (10 MB cap / 7d post-close TTL). Hot tier
                                  is JetStream's replay buffer; cold tier
                                  is S3 (out of scope for this revision).
* ``coord.tenant_policies``    — per-tenant policy knobs per plan D14 + D11.
                                  ``claim_steal_visibility`` controls how
                                  steal-with-reason audit events surface;
                                  ``session_coordination_enabled`` is the
                                  Phase 10 feature flag; warm/cold quotas
                                  back D11's tenant-aggregate cap.

Phase 0 hygiene
================

Per plan D4 ("tenant is mandatory and load-bearing"):

* ``coord.devices.tenant_id`` was already locked to NOT NULL by
  ``coord_tenant_id_not_null`` (2026-05-20). This revision re-asserts
  the lock as a defensive no-op (``IS NOT NULL`` check + idempotent
  ``SET NOT NULL`` — Postgres no-ops if already NOT NULL).
* ``coord.claims`` does NOT exist as a Postgres table: claim state
  lives in Redis, with ``coord.claims_audit`` as the durable forensic
  log. ``coord.claims_audit`` has no ``tenant_id`` column today —
  adding one is properly Phase 1's concern (the new ``ClaimKind::Session``
  / ``ClaimKind::RepoBranch`` variants need it as a first-class write
  field, not a post-hoc backfill). Deferred here; flagged for Phase 1.
* ``coord.device_status.tenant_id`` was deliberately left NULL-able by
  ``coord_device_status_tenant_id`` (2026-05-21) because rows age out
  via ``prune_stale()`` within an hour. Phase 9 of the parent plan
  deletes that table outright (replaced by a SELECT over
  ``coord.sessions WHERE state='active'``), so tightening it now would
  be wasted churn.

Default-tenant seeding
======================

``coord.tenant_policies`` is seeded for the bootstrap tenant
(``slug = 'personal-jspinak'``, minted by ``coord_tenant_scope_columns``).
The INSERT is idempotent (``ON CONFLICT DO NOTHING``) and uses a
subselect against ``coord.tenants`` so the same UUID resolved by the
prior backfill chain is reused — no hard-coded tenant UUID anywhere.

Idempotency posture
===================

Every DDL uses ``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT
EXISTS`` so a re-run against an already-applied DB is a no-op. The
``DO $$ ... $$`` block on ``coord.devices.tenant_id`` short-circuits if
the column is already NOT NULL.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_session_substrate"
down_revision: str = "pr_merge_10_rollout_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Stable identifier for the bootstrap personal tenant — matches the
# slug minted by ``coord_tenant_scope_columns`` and reused by every
# subsequent default-tenant-propagation revision.
_PERSONAL_SLUG = "personal-jspinak"


# Default warm-tier per-tenant aggregate cap: 1 GiB. Per plan D11 row 1.
_DEFAULT_WARM_QUOTA_BYTES = 1 * 1024 * 1024 * 1024
# Default cold-tier per-tenant aggregate cap: 10 GiB. Per plan D11 row 1.
_DEFAULT_COLD_QUOTA_BYTES = 10 * 1024 * 1024 * 1024


def upgrade() -> None:
    """Create the four session-substrate tables + Phase 0 hygiene.

    Order matters: ``coord.tenant_policies`` first (no inbound FKs);
    ``coord.sessions`` next (depends on ``coord.devices``); then the
    two child tables (depend on ``coord.sessions``). All DDL is
    idempotent so re-running is a no-op.
    """
    # ----------------------------------------------------------------
    # 1. coord.tenant_policies — per-tenant policy knobs.
    #
    # No inbound FKs at create time; both the steal-visibility setting
    # (Phase 6) and the rollout flag (Phase 10) read this table.
    # Standalone PK on tenant_id — one row per tenant.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.tenant_policies (
            tenant_id                       UUID PRIMARY KEY
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            claim_steal_visibility          TEXT NOT NULL
                DEFAULT 'public_to_tenant',
            session_coordination_enabled    BOOLEAN NOT NULL DEFAULT false,
            output_warm_quota_bytes         BIGINT NOT NULL
                DEFAULT 1073741824,
            output_cold_quota_bytes         BIGINT NOT NULL
                DEFAULT 10737418240,
            created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT tenant_policies_claim_steal_visibility_check
                CHECK (claim_steal_visibility IN (
                    'public_to_tenant',
                    'involved_only',
                    'audit_only'
                ))
        )
        """
    )

    # ----------------------------------------------------------------
    # 2. coord.sessions — single primitive for every operator session.
    #
    # FK posture:
    #
    # * tenant_id          → coord.tenants(tenant_id)          ON DELETE RESTRICT
    #   Same posture as coord.devices — sessions can't be orphaned by a
    #   tenant delete; operator must close sessions first.
    # * device_id          → coord.devices(device_id)          ON DELETE CASCADE
    #   Sessions are inherently bound to the device they run on; if the
    #   device row is deleted, the session has nowhere to live.
    # * parent_session_id  → coord.sessions(id)                ON DELETE SET NULL
    #   Cross-machine handoff (Phase 7) creates child sessions; deleting
    #   the parent shouldn't cascade into the child.
    #
    # session_kind constrained per plan D1.
    # state constrained per plan D13 lifecycle (active → pending_resolution
    # on conflict, → stale at 45s, → closed at 180s).
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.sessions (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id           UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE RESTRICT,
            device_id           UUID NOT NULL
                REFERENCES coord.devices(device_id) ON DELETE CASCADE,
            session_kind        TEXT NOT NULL,
            intent              JSONB NOT NULL,
            state               TEXT NOT NULL DEFAULT 'active',
            started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_heartbeat_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            closed_at           TIMESTAMPTZ,
            parent_session_id   UUID
                REFERENCES coord.sessions(id) ON DELETE SET NULL,
            repo                TEXT,
            branch              TEXT,
            CONSTRAINT sessions_session_kind_check
                CHECK (session_kind IN (
                    'terminal_shell',
                    'terminal_claude',
                    'agentic',
                    'workflow',
                    'automation',
                    'debug'
                )),
            CONSTRAINT sessions_state_check
                CHECK (state IN (
                    'active',
                    'pending_resolution',
                    'stale',
                    'closed'
                ))
        )
        """
    )

    # Tenant-scoped active-session lookup (dashboard Live Sessions panel,
    # Phase 5). Sort by started_at DESC matches the panel's ordering.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS coord_sessions_tenant_state_idx
            ON coord.sessions (tenant_id, state, started_at DESC)
        """
    )
    # Per-device session history (machine card detail, Phase 4 web FE).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS coord_sessions_device_idx
            ON coord.sessions (device_id, started_at DESC)
        """
    )
    # Parent → child lookup for cross-machine handoff (Phase 7).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS coord_sessions_parent_idx
            ON coord.sessions (parent_session_id)
            WHERE parent_session_id IS NOT NULL
        """
    )

    # ----------------------------------------------------------------
    # 3. coord.session_events — append-only event log.
    #
    # Idempotency tuple is (session_id, seq) per plan D7. The runner
    # writes locally first with monotonic seq per session, then drains
    # to coord. On reconnect, replay with ON CONFLICT (session_id, seq)
    # DO NOTHING gives at-least-once → exactly-once for free.
    #
    # bigserial PK is for ordering / external citation only — the
    # idempotency key is the natural (session_id, seq) tuple.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_events (
            id              BIGSERIAL PRIMARY KEY,
            session_id      UUID NOT NULL
                REFERENCES coord.sessions(id) ON DELETE CASCADE,
            seq             BIGINT NOT NULL,
            event_kind      TEXT NOT NULL,
            payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
            occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT session_events_session_id_seq_uniq
                UNIQUE (session_id, seq)
        )
        """
    )
    # Time-ordered scan by event kind — feeds the dashboard activity
    # feed (Phase 5) and the steal-event audit query (Phase 6).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS coord_session_events_kind_idx
            ON coord.session_events (event_kind, occurred_at DESC)
        """
    )

    # ----------------------------------------------------------------
    # 4. coord.session_output — warm-tier PTY capture per plan D11.
    #
    # Per-session FIFO with chunk_offset ordering. The compressed_size
    # column is the on-the-wire size of the payload bytea (the bytea
    # itself holds whatever compression scheme Phase 8 settles on).
    # Tracked separately so the warm-tier quota sweep can sum without
    # scanning bytea bodies.
    #
    # PRIMARY KEY (session_id, chunk_offset) doubles as the FIFO
    # ordering index — no separate index needed.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_output (
            session_id      UUID NOT NULL
                REFERENCES coord.sessions(id) ON DELETE CASCADE,
            chunk_offset    BIGINT NOT NULL,
            payload         BYTEA NOT NULL,
            compressed_size INTEGER NOT NULL,
            recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (session_id, chunk_offset)
        )
        """
    )

    # ----------------------------------------------------------------
    # 5. Phase 0 hygiene — re-assert NOT NULL on coord.devices.tenant_id.
    #
    # ``coord_tenant_id_not_null`` (2026-05-20) already locked this.
    # Postgres no-ops a SET NOT NULL on an already-NOT-NULL column, so
    # this is a defensive idempotent re-assertion — surfaces a hard
    # failure if any pre-tenant device row somehow survived the prior
    # backfill chain (operationally a bug worth screaming about).
    #
    # We DO NOT touch:
    #   * coord.device_status.tenant_id — deliberately NULL-able per
    #     coord_device_status_tenant_id; Phase 9 of the parent plan
    #     deletes that table outright.
    #   * coord.claims — no such table; claim state lives in Redis
    #     and coord.claims_audit has no tenant_id column (deferred to
    #     Phase 1 where ClaimKind::Session lands).
    # ----------------------------------------------------------------
    op.execute(
        """
        DO $$
        DECLARE null_count INTEGER;
        BEGIN
            SELECT COUNT(*) INTO null_count
              FROM coord.devices
             WHERE tenant_id IS NULL;
            IF null_count > 0 THEN
                RAISE EXCEPTION 'Phase 0: % rows in coord.devices still have NULL tenant_id; '
                                'expected zero post-coord_tenant_id_not_null', null_count;
            END IF;
        END
        $$;
        """
    )
    op.execute("ALTER TABLE coord.devices ALTER COLUMN tenant_id SET NOT NULL")

    # ----------------------------------------------------------------
    # 6. Seed coord.tenant_policies for the bootstrap personal tenant.
    #
    # Lookup-by-slug + ON CONFLICT DO NOTHING means:
    #   * Default tenant row is guaranteed minted (post coord_tenant_scope_columns).
    #   * Re-running this migration is a no-op.
    #   * No hard-coded UUID — the same tenant_id the device backfill
    #     and claims-audit chain reuse.
    # ----------------------------------------------------------------
    op.execute(
        f"""
        INSERT INTO coord.tenant_policies (tenant_id)
        SELECT tenant_id FROM coord.tenants WHERE slug = '{_PERSONAL_SLUG}'
        ON CONFLICT (tenant_id) DO NOTHING
        """
    )


def downgrade() -> None:
    """Drop the four new tables; relax ``coord.devices.tenant_id`` to NULL-able.

    Per the plan brief: the device-row backfill from the
    ``coord_devices_tenant_id`` → ``coord_tenant_id_not_null`` chain is
    NOT reverted — no way to know which rows were NULL pre-backfill, and
    re-NULL'ing the column would corrupt the data we just stamped.
    Only the DB-level constraint is dropped; the data stays correctly
    tenant-stamped.

    Drop order matches FK dependency: session_output + session_events
    (children of sessions) → sessions (child of devices+tenants) →
    tenant_policies (no inbound FKs from our additions).
    """
    op.execute("DROP TABLE IF EXISTS coord.session_output")
    op.execute("DROP TABLE IF EXISTS coord.session_events")
    op.execute("DROP TABLE IF EXISTS coord.sessions")
    op.execute("DROP TABLE IF EXISTS coord.tenant_policies")

    # Relax the NOT NULL re-assertion. ``coord_tenant_id_not_null``'s
    # downgrade is what actually fully un-locks coord.devices.tenant_id
    # — this just drops the constraint we set above so the column state
    # matches what existed before this revision applied.
    op.execute("ALTER TABLE coord.devices ALTER COLUMN tenant_id DROP NOT NULL")
