"""coord host pause — the pause store, interrupted jobs, owner history, host settings

Revision ID: hostpause_01_host_pause_schema
Revises: coord_devices_ui_thread_01
Create Date: 2026-10-08

Phase 1 of plan
``plans/2026-10-06-host-pause-is-one-coord-held-switch-the-ci-host-agent-enforces.md``
(qontinui-dev-notes). Authored by alembic in ``qontinui-web``: coord authors
zero ``coord.*`` DDL (served policy ``production-and-cost``
``alembic-sole-authorship``). This revision adds schema only. No coord reader
or writer exists yet; plan Phase 2 (qontinui-coord) reads these objects, and it
waits until they are present on prod.

What a host pause is (plan D1, D2)
==================================

One typed, versioned row per pause, ``coord.host_pauses``, with a scope set
``{ci, builds}``. Several rows may be active on one host at once (owner,
operator, agent). A host is paused for a lane while ANY active row covers it,
and each row ends on its own. The owner pause of the hand-built app is a row
with scope ``ci``; the build-admission plan's per-host build pause is a row
with scope ``builds``. A pause is NOT a drain: it writes no
``coord.fleet_drain`` row, and a drain writes no pause row.

New tables
==========

``coord.host_pauses`` + ``coord.host_pauses_versions`` (D2)
    Target ``agent_id`` (a CI host agent) and/or ``device_id`` (a runner
    device, for ``builds``). The CHECKs carry D2's table:

    * ``scopes`` is a non-empty subset of ``{ci, builds}``; a ``ci`` scope
      needs an ``agent_id``;
    * ``actor_kind`` is ``owner | operator | agent``; an owner row has scope
      exactly ``{ci}`` and is always ``origin = local``;
    * a non-owner row has a mandatory ``until`` at most 30 days after
      ``started_at`` (``MAX_DRAIN_DAYS``); an owner row's ``until`` is
      optional ("until I turn it back on");
    * ``grace_secs`` is 0..3600, and a row asks for a grace OR ``until_idle``,
      never both;
    * ``reason_text`` is at most 200 characters, and operator and agent rows
      only;
    * ``local_id`` is minted by the host for an ``origin = local`` row, and
      ``UNIQUE (agent_id, local_id)`` makes the agent's sync idempotent;
    * an ended row names its ``end_reason`` and its ``ended_by_kind``;
    * ``imported`` / ``source_since_utc`` mark a pause the cutover carried over
      from the hand-built app (D11): ``source_since_utc`` is allowed only on an
      imported row and never after ``started_at``;
    * ``imported_from`` is unique per tenant (the build-admission copy key,
      D1), with the source version in ``imported_version``.

    Part 10a of the plan later WIDENS ``actor_kind``, ``reason_code`` and
    ``end_reason`` (``bench_lease``, ``ui_test``, ``lease_queue_empty``), so
    those three CHECKs carry stable names. The versions table mirrors every
    column of the live row, append-only, one row per ``version``.

``coord.ci_interrupted_jobs`` (D7)
    A CI job a pause, a window's hard end or the hand-built apps' migration
    interrupted, and the state of its automatic re-run. ``run_id``,
    ``job_id`` and ``run_attempt`` are nullable because coord resolves the job
    from the lease after the agent reports the stop; a row is identified by a
    run id OR a lease. ``UNIQUE (lease_id)`` and
    ``UNIQUE (tenant_id, repo, job_id, run_attempt)`` (NULLs distinct, so an
    unresolved row is never a duplicate) keep the agent's report and coord's
    busy-lease backstop from making two rows for one job. ``client_key`` is
    the legacy-import route's idempotency key, unique per tenant.

``coord.host_pause_resume_requests`` (D2, D8)
    "Ask to turn back on". At most one outstanding (unanswered) request per
    pause is a partial unique index, so the bound holds in the database.

``coord.host_owner_events``, ``coord.ci_host_agent_hours``,
``coord.host_pause_legacy_events`` (D8)
    Nudge counts, the hourly online/paused rollup (``ci_host_agents`` keeps
    only ``last_seen_at``), and the hand-built apps' imported ``events.jsonl``
    (history only, with a per-tenant ``client_key``).

``coord.ci_host_agents_settings_versions`` (D6)
    Every write of a host's settings, with its actor. ``fleet_policy.rs`` §D1
    requires a behaviour-changing control to be versioned and auditable.

Columns added to existing ``coord.ci_*`` tables
===============================================

``ci_host_agents``: ``parent_agent_id`` (an inner agent's outer agent; at most
one live child per parent), the host settings of D6 (``device_id``,
``owner_app``, ``capacity_schedule``, ``keep_awake``, ``enforcement``,
``settings_version``, ``settings_updated_at``, ``guest_name``,
``rollback_deferred_until``, ``windows_slot_window``,
``windows_pools_allowed`` + ``windows_pools_finding``), and the agent-reported
``reported_window``, ``notices``, ``clock_skew_ms``, ``envelope_state`` and
``owner_door``. ``ci_enrol_codes``: ``enforcement`` (D10) and
``parent_agent_id`` (child enrolment, D6). ``ci_pool_specs``:
``non_preemptible`` (D2). ``ci_slot_leases``: ``busy_started_at`` and
``busy_ended_at`` (D8's hours contributed).

Deviations from the plan's literal text, each forced by a gate
==============================================================

1. **NOT NULL on an added column is spelled as a CHECK.** The plan writes
   ``boolean NOT NULL DEFAULT false`` (and the same for ``keep_awake``,
   ``enforcement``, ``owner_door``, ``windows_pools_allowed``,
   ``non_preemptible`` and ``ci_enrol_codes.enforcement``). coord's merge-gate
   migration classifier (qontinui-coord
   ``crates/coord/src/pr_merge/migration_classifier.rs``,
   ``classify_add_column_action``) rejects ``ADD COLUMN ... NOT NULL`` on an
   existing table, which would hold this PR for escalation. So each such
   column is added with its constant ``DEFAULT`` (PostgreSQL 11+ fills every
   existing row with it, catalog-only), and a separate
   ``CHECK (<col> IS NOT NULL) NOT VALID`` constraint refuses a NULL on every
   later write. No existing row can hold NULL, so the unvalidated constraint
   leaves nothing unchecked. Readers decode these columns as non-null; coord
   uses runtime ``sqlx::query``, not the compile-time macros, so catalog
   nullability does not change a decoded type. New tables use plain
   ``NOT NULL``.
2. **``settings_version`` defaults to 0 and is never NULL.** The plan writes
   ``settings_version int``. D10 compares it with the version an enrolment
   response carried, so NULL would be a third, ambiguous state.
3. **``run_id`` on ``ci_interrupted_jobs`` is nullable** (the plan lists only
   ``lease_id``, ``pause_id`` and ``job_id``). D7 records an agent's stop
   report before coord has resolved the job, and keeps a row that never
   resolves as ``unresolved``; neither has a run id yet. A CHECK requires a
   run id or a lease on every row, and a run id on every
   ``legacy_migration`` row.
4. **``host_pauses.device_id`` carries no foreign key.** A pause row must
   never disappear or lift because a device was unbound from a tenant (D11,
   "no pause is ever lost"), and a ``SET NULL`` would break the
   "agent or device" CHECK of a device-only ``builds`` row. The tenant floor is
   checked by coord's doors at write time (D6, "Ownership floor").
5. **``ended_by_kind``** is not enumerated by the plan. It is ``owner |
   operator | agent | coord``, where ``coord`` ends a row by expiry or by
   revoking its host.

Foreign keys and delete rules
=============================

* New tables reference ``coord.ci_host_agents (agent_id, tenant_id)`` (the
  ``cihost_01`` composite convention) ``ON DELETE CASCADE``; the
  versions tables, resume requests and interrupted jobs reference their
  parent with the same composite shape.
* ``ci_host_agents (parent_agent_id, tenant_id)`` references
  ``ci_host_agents (agent_id, tenant_id)`` ``ON DELETE CASCADE``: a guest's
  inner agent never outlives its host's row (an orphan would lose the
  inherited settings and the inherited owner door, D2/D6).
* ``ci_host_agents (tenant_id, device_id)`` references
  ``coord.tenant_devices (tenant_id, device_id)``
  ``ON DELETE SET NULL (device_id)``. The link holds only while the device is
  bound to the agent's tenant; unbinding clears the link, not the agent. This
  answers the rev-30 review's open minor 9. The column-list form needs
  PostgreSQL 15+; prod RDS reads ``16.13`` (``aws rds
  describe-db-instances``, 2026-10-08) and CI runs pg16.
* ``ci_enrol_codes (parent_agent_id, tenant_id)`` references the parent agent
  ``ON DELETE CASCADE``.
* ``ci_interrupted_jobs.pause_id`` is ``ON DELETE SET NULL (pause_id)`` so the
  400-day pause retention never deletes re-run history; ``lease_id`` cascades
  with the lease (which cascades with its agent).

Constraints on EXISTING tables are added ``NOT VALID``, as their own
``ADD CONSTRAINT`` statements, because coord's classifier rejects a validated
one (it scans every row under the ALTER's lock). Every column involved is new,
so no existing row could violate them.

The build-admission copy (D1)
=============================

D1 says this revision copies ``coord.build_admission_host_controls`` rows into
``host_pauses`` **if** that plan's Phase 5 migration has landed. It has not:
the table is absent from this repo's revision graph and absent on prod
(``coord_query_schema_object``, ``live_rds_catalog``, 2026-10-08). So this
revision copies nothing (and copying is data DML, which coord's classifier
would refuse in a schema revision anyway).

Idempotency / authorship posture
================================

* Every statement is ``coord.``-qualified (``alembic-schema-arg-gate``) and a
  static string literal inside ``op.execute``.
* ``CREATE TABLE IF NOT EXISTS`` with constraints inline, ``ADD COLUMN IF NOT
  EXISTS``, and every secondary index ``CREATE … INDEX CONCURRENTLY IF NOT
  EXISTS`` inside ``autocommit_block``.
* Locking: ``SET LOCAL lock_timeout = '3s'`` before each transactional group,
  restored with ``SET LOCAL lock_timeout = DEFAULT`` (``env.py`` runs every
  pending revision in one transaction). Every ``ALTER`` is catalog-only.
* Order: tables and columns commit first, then the indexes build outside any
  transaction, then the ``NOT VALID`` constraints are added in the
  transaction that stamps the version. PostgreSQL cannot guard ``ADD
  CONSTRAINT`` with ``IF NOT EXISTS``, so they are only ever committed together
  with the stamp, and a run that died partway re-runs cleanly (the
  ``twin_10_served_bundle_target_columns`` posture).
* INVALID-index limit (as ``twin_10``): a ``CONCURRENTLY`` build that fails
  partway can leave an INVALID index that a re-run's ``IF NOT EXISTS`` skips.
  Recovery is ``DROP INDEX CONCURRENTLY coord.<name>`` and a re-run. The three
  partial UNIQUE indexes enforce bounds (one live child per parent, one
  unredeemed code per parent, one open ask-resume per pause); an invalid one
  enforces nothing, so check ``pg_index.indisvalid`` after a failed run.
* HAND-AUTHORED; ``alembic revision --autogenerate`` is never run here. Pure
  DDL, no app imports.

``down_revision``
=================

The single head on qontinui-web ``origin/main`` when this branch was cut
(``coord_devices_ui_thread_01``). If another revision lands first, re-point the
token below AND the ``Revises:`` line above at the merged head. Do not author
an ``alembic merge`` revision.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "hostpause_01_host_pause_schema"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "coord_devices_ui_thread_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the host-pause tables, extend coord.ci_*, then index and constrain."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute("SET LOCAL lock_timeout = '3s'")

    # ------------------------------------------------------------------ D2
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.host_pauses (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id            UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            agent_id             UUID,
            device_id            UUID,
            scopes               TEXT[] NOT NULL,
            actor_kind           TEXT NOT NULL,
            actor_ref            TEXT,
            reason_code          TEXT NOT NULL DEFAULT 'unspecified',
            reason_text          TEXT,
            started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            until                TIMESTAMPTZ,
            grace_secs           INTEGER,
            until_idle           BOOLEAN NOT NULL DEFAULT false,
            origin               TEXT NOT NULL,
            local_id             UUID,
            applied_at           TIMESTAMPTZ,
            memory_returned_mib  BIGINT,
            ended_at             TIMESTAMPTZ,
            ended_by_kind        TEXT,
            end_reason           TEXT,
            synced_at            TIMESTAMPTZ,
            version              INTEGER NOT NULL DEFAULT 1,
            imported             BOOLEAN NOT NULL DEFAULT false,
            source_since_utc     TIMESTAMPTZ,
            imported_from        TEXT,
            imported_version     INTEGER,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_host_pauses_id_tenant UNIQUE (id, tenant_id),
            CONSTRAINT uq_host_pauses_agent_local_id UNIQUE (agent_id, local_id),
            CONSTRAINT uq_host_pauses_tenant_imported_from
                UNIQUE (tenant_id, imported_from),
            CONSTRAINT fk_host_pauses_agent_tenant
                FOREIGN KEY (agent_id, tenant_id)
                REFERENCES coord.ci_host_agents (agent_id, tenant_id) ON DELETE CASCADE,
            CONSTRAINT ck_host_pauses_target
                CHECK (agent_id IS NOT NULL OR device_id IS NOT NULL),
            CONSTRAINT ck_host_pauses_scopes
                CHECK (scopes <@ ARRAY['ci', 'builds']::TEXT[]
                       AND cardinality(scopes) > 0
                       AND array_position(scopes, NULL) IS NULL),
            CONSTRAINT ck_host_pauses_ci_needs_agent
                CHECK (NOT ('ci' = ANY(scopes)) OR agent_id IS NOT NULL),
            CONSTRAINT ck_host_pauses_actor_kind
                CHECK (actor_kind IN ('owner', 'operator', 'agent')),
            CONSTRAINT ck_host_pauses_owner_scope
                CHECK (actor_kind <> 'owner' OR scopes = ARRAY['ci']::TEXT[]),
            CONSTRAINT ck_host_pauses_owner_is_local
                CHECK (actor_kind <> 'owner' OR origin = 'local'),
            CONSTRAINT ck_host_pauses_reason_code
                CHECK (reason_code IN ('big_program', 'feels_slow', 'busy_prompt',
                                       'other', 'maintenance', 'capacity',
                                       'ledger_unreadable', 'unspecified')),
            CONSTRAINT ck_host_pauses_reason_text
                CHECK (reason_text IS NULL
                       OR (char_length(reason_text) <= 200
                           AND actor_kind IN ('operator', 'agent'))),
            CONSTRAINT ck_host_pauses_fleet_until
                CHECK (actor_kind = 'owner'
                       OR (until IS NOT NULL
                           AND until <= started_at + interval '30 days')),
            CONSTRAINT ck_host_pauses_grace_secs
                CHECK (grace_secs IS NULL OR grace_secs BETWEEN 0 AND 3600),
            CONSTRAINT ck_host_pauses_grace_or_idle
                CHECK (NOT (until_idle AND grace_secs IS NOT NULL)),
            CONSTRAINT ck_host_pauses_origin
                CHECK (origin IN ('local', 'coord')),
            CONSTRAINT ck_host_pauses_local_id
                CHECK (origin <> 'local'
                       OR (local_id IS NOT NULL AND agent_id IS NOT NULL)),
            CONSTRAINT ck_host_pauses_memory_returned
                CHECK (memory_returned_mib IS NULL OR memory_returned_mib >= 0),
            CONSTRAINT ck_host_pauses_ended_by_kind
                CHECK (ended_by_kind IS NULL
                       OR ended_by_kind IN ('owner', 'operator', 'agent', 'coord')),
            CONSTRAINT ck_host_pauses_end_reason
                CHECK (end_reason IS NULL
                       OR end_reason IN ('expired', 'resumed', 'superseded',
                                         'host_revoked')),
            CONSTRAINT ck_host_pauses_ended_consistent
                CHECK ((ended_at IS NULL) = (end_reason IS NULL)
                       AND (ended_at IS NULL) = (ended_by_kind IS NULL)),
            CONSTRAINT ck_host_pauses_version CHECK (version >= 1),
            CONSTRAINT ck_host_pauses_source_since
                CHECK (source_since_utc IS NULL
                       OR (imported AND source_since_utc <= started_at))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.host_pauses_versions (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            pause_id             UUID NOT NULL,
            tenant_id            UUID NOT NULL,
            version              INTEGER NOT NULL,
            agent_id             UUID,
            device_id            UUID,
            scopes               TEXT[] NOT NULL,
            actor_kind           TEXT NOT NULL,
            actor_ref            TEXT,
            reason_code          TEXT NOT NULL,
            reason_text          TEXT,
            started_at           TIMESTAMPTZ NOT NULL,
            until                TIMESTAMPTZ,
            grace_secs           INTEGER,
            until_idle           BOOLEAN NOT NULL,
            origin               TEXT NOT NULL,
            local_id             UUID,
            applied_at           TIMESTAMPTZ,
            memory_returned_mib  BIGINT,
            ended_at             TIMESTAMPTZ,
            ended_by_kind        TEXT,
            end_reason           TEXT,
            synced_at            TIMESTAMPTZ,
            imported             BOOLEAN NOT NULL,
            source_since_utc     TIMESTAMPTZ,
            imported_from        TEXT,
            imported_version     INTEGER,
            changed_by           TEXT,
            recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_host_pauses_versions_pause_version UNIQUE (pause_id, version),
            CONSTRAINT fk_host_pauses_versions_pause_tenant
                FOREIGN KEY (pause_id, tenant_id)
                REFERENCES coord.host_pauses (id, tenant_id) ON DELETE CASCADE
        )
        """
    )

    # ------------------------------------------------------------------ D7
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_interrupted_jobs (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id        UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            repo             TEXT NOT NULL,
            run_id           BIGINT,
            job_id           BIGINT,
            run_attempt      INTEGER,
            agent_id         UUID NOT NULL,
            lease_id         UUID
                REFERENCES coord.ci_slot_leases(lease_id) ON DELETE CASCADE,
            pause_id         UUID,
            cause            TEXT NOT NULL,
            interrupted_at   TIMESTAMPTZ NOT NULL,
            rerun_state      TEXT NOT NULL DEFAULT 'pending',
            rerun_detail     TEXT,
            rerun_job_id     BIGINT,
            client_key       TEXT,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_ci_interrupted_jobs_lease UNIQUE (lease_id),
            CONSTRAINT uq_ci_interrupted_jobs_job
                UNIQUE (tenant_id, repo, job_id, run_attempt),
            CONSTRAINT uq_ci_interrupted_jobs_tenant_client_key
                UNIQUE (tenant_id, client_key),
            CONSTRAINT fk_ci_interrupted_jobs_agent_tenant
                FOREIGN KEY (agent_id, tenant_id)
                REFERENCES coord.ci_host_agents (agent_id, tenant_id) ON DELETE CASCADE,
            CONSTRAINT fk_ci_interrupted_jobs_pause_tenant
                FOREIGN KEY (pause_id, tenant_id)
                REFERENCES coord.host_pauses (id, tenant_id) ON DELETE SET NULL (pause_id),
            CONSTRAINT ck_ci_interrupted_jobs_repo_owner_name
                CHECK (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
                       AND split_part(repo, '/', 1) NOT IN ('.', '..')
                       AND split_part(repo, '/', 2) NOT IN ('.', '..')),
            CONSTRAINT ck_ci_interrupted_jobs_cause
                CHECK (cause IN ('pause', 'window_close', 'legacy_migration')),
            CONSTRAINT ck_ci_interrupted_jobs_pause_only_for_pause
                CHECK (cause = 'pause' OR pause_id IS NULL),
            CONSTRAINT ck_ci_interrupted_jobs_identified
                CHECK (run_id IS NOT NULL OR lease_id IS NOT NULL),
            CONSTRAINT ck_ci_interrupted_jobs_legacy_has_run
                CHECK (cause <> 'legacy_migration' OR run_id IS NOT NULL),
            CONSTRAINT ck_ci_interrupted_jobs_rerun_state
                CHECK (rerun_state IN ('pending', 'dispatched', 'succeeded', 'failed',
                                       'skipped_superseded', 'skipped_limit',
                                       'expired_rerun_window',
                                       'skipped_non_preemptible', 'refused',
                                       'unresolved')),
            CONSTRAINT ck_ci_interrupted_jobs_run_attempt
                CHECK (run_attempt IS NULL OR run_attempt >= 1)
        )
        """
    )

    # ------------------------------------------------------------------ D8
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.host_pause_resume_requests (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id          UUID NOT NULL,
            pause_id           UUID NOT NULL,
            requested_by_kind  TEXT NOT NULL,
            requested_by_ref   TEXT,
            requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            delivered_at       TIMESTAMPTZ,
            answer             TEXT,
            answered_at        TIMESTAMPTZ,
            CONSTRAINT fk_host_pause_resume_requests_pause_tenant
                FOREIGN KEY (pause_id, tenant_id)
                REFERENCES coord.host_pauses (id, tenant_id) ON DELETE CASCADE,
            CONSTRAINT ck_host_pause_resume_requests_by_kind
                CHECK (requested_by_kind IN ('operator', 'agent')),
            CONSTRAINT ck_host_pause_resume_requests_answer
                CHECK (answer IS NULL OR answer IN ('yes', 'not_now', 'expired')),
            CONSTRAINT ck_host_pause_resume_requests_answered
                CHECK ((answer IS NULL) = (answered_at IS NULL))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.host_owner_events (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id  UUID NOT NULL,
            agent_id   UUID NOT NULL,
            kind       TEXT NOT NULL,
            at         TIMESTAMPTZ NOT NULL,
            CONSTRAINT fk_host_owner_events_agent_tenant
                FOREIGN KEY (agent_id, tenant_id)
                REFERENCES coord.ci_host_agents (agent_id, tenant_id) ON DELETE CASCADE,
            CONSTRAINT ck_host_owner_events_kind
                CHECK (kind IN ('nudge_shown', 'nudge_taken', 'nudge_suppressed'))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_host_agent_hours (
            agent_id     UUID NOT NULL,
            hour         TIMESTAMPTZ NOT NULL,
            tenant_id    UUID NOT NULL,
            online_secs  INTEGER NOT NULL DEFAULT 0,
            paused_secs  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (agent_id, hour),
            CONSTRAINT fk_ci_host_agent_hours_agent_tenant
                FOREIGN KEY (agent_id, tenant_id)
                REFERENCES coord.ci_host_agents (agent_id, tenant_id) ON DELETE CASCADE,
            CONSTRAINT ck_ci_host_agent_hours_hour_aligned
                CHECK (date_trunc('hour', hour, 'UTC') = hour),
            CONSTRAINT ck_ci_host_agent_hours_online_secs
                CHECK (online_secs BETWEEN 0 AND 3600),
            CONSTRAINT ck_ci_host_agent_hours_paused_secs
                CHECK (paused_secs BETWEEN 0 AND 3600)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.host_pause_legacy_events (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL,
            agent_id    UUID NOT NULL,
            at          TIMESTAMPTZ NOT NULL,
            kind        TEXT NOT NULL,
            by          TEXT,
            raw         JSONB NOT NULL,
            client_key  TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_host_pause_legacy_events_tenant_client_key
                UNIQUE (tenant_id, client_key),
            CONSTRAINT fk_host_pause_legacy_events_agent_tenant
                FOREIGN KEY (agent_id, tenant_id)
                REFERENCES coord.ci_host_agents (agent_id, tenant_id) ON DELETE CASCADE
        )
        """
    )

    # ------------------------------------------------------------------ D6
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_host_agents_settings_versions (
            id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_id                 UUID NOT NULL,
            tenant_id                UUID NOT NULL,
            settings_version         INTEGER NOT NULL,
            device_id                UUID,
            owner_app                JSONB,
            capacity_schedule        JSONB,
            availability_window      JSONB,
            keep_awake               TEXT NOT NULL,
            enforcement              TEXT NOT NULL,
            guest_name               TEXT,
            rollback_deferred_until  TIMESTAMPTZ,
            windows_slot_window      JSONB,
            windows_pools_allowed    BOOLEAN NOT NULL,
            windows_pools_finding    TEXT,
            updated_by               TEXT NOT NULL,
            updated_at               TIMESTAMPTZ NOT NULL,
            created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_ci_host_agents_settings_versions_agent_version
                UNIQUE (agent_id, settings_version),
            CONSTRAINT fk_ci_host_agents_settings_versions_agent_tenant
                FOREIGN KEY (agent_id, tenant_id)
                REFERENCES coord.ci_host_agents (agent_id, tenant_id) ON DELETE CASCADE
        )
        """
    )

    # ----------------------------------------- columns on existing coord.ci_*
    op.execute(
        """
        ALTER TABLE coord.ci_host_agents
            ADD COLUMN IF NOT EXISTS parent_agent_id UUID,
            ADD COLUMN IF NOT EXISTS device_id UUID,
            ADD COLUMN IF NOT EXISTS owner_app JSONB
                CONSTRAINT ck_ci_host_agents_owner_app
                CHECK (owner_app IS NULL
                       OR (jsonb_typeof(owner_app) = 'object'
                           AND CASE
                               WHEN owner_app -> 'owner_grace_secs' IS NULL THEN true
                               WHEN jsonb_typeof(owner_app -> 'owner_grace_secs') = 'number'
                                   THEN (owner_app ->> 'owner_grace_secs')::numeric
                                            BETWEEN 0 AND 1800
                                        AND (owner_app ->> 'owner_grace_secs')::numeric
                                            = trunc((owner_app ->> 'owner_grace_secs')::numeric)
                               ELSE false
                               END)),
            ADD COLUMN IF NOT EXISTS capacity_schedule JSONB,
            ADD COLUMN IF NOT EXISTS keep_awake TEXT DEFAULT 'off'
                CONSTRAINT ck_ci_host_agents_keep_awake
                CHECK (keep_awake IN ('off', 'always', 'window')),
            ADD COLUMN IF NOT EXISTS enforcement TEXT DEFAULT 'enforce'
                CONSTRAINT ck_ci_host_agents_enforcement
                CHECK (enforcement IN ('observe', 'enforce')),
            ADD COLUMN IF NOT EXISTS settings_version INTEGER DEFAULT 0
                CONSTRAINT ck_ci_host_agents_settings_version
                CHECK (settings_version >= 0),
            ADD COLUMN IF NOT EXISTS settings_updated_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS reported_window JSONB,
            ADD COLUMN IF NOT EXISTS notices JSONB,
            ADD COLUMN IF NOT EXISTS clock_skew_ms INTEGER,
            ADD COLUMN IF NOT EXISTS envelope_state JSONB,
            ADD COLUMN IF NOT EXISTS windows_slot_window JSONB,
            ADD COLUMN IF NOT EXISTS rollback_deferred_until TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS windows_pools_allowed BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS windows_pools_finding TEXT,
            ADD COLUMN IF NOT EXISTS guest_name TEXT
                CONSTRAINT ck_ci_host_agents_guest_name
                CHECK (guest_name IS NULL OR char_length(guest_name) BETWEEN 1 AND 64),
            ADD COLUMN IF NOT EXISTS owner_door BOOLEAN DEFAULT false
        """
    )
    op.execute(
        """
        ALTER TABLE coord.ci_enrol_codes
            ADD COLUMN IF NOT EXISTS enforcement TEXT DEFAULT 'enforce'
                CONSTRAINT ck_ci_enrol_codes_enforcement
                CHECK (enforcement IN ('observe', 'enforce')),
            ADD COLUMN IF NOT EXISTS parent_agent_id UUID
        """
    )
    op.execute(
        """
        ALTER TABLE coord.ci_pool_specs
            ADD COLUMN IF NOT EXISTS non_preemptible BOOLEAN DEFAULT false
        """
    )
    op.execute(
        """
        ALTER TABLE coord.ci_slot_leases
            ADD COLUMN IF NOT EXISTS busy_started_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS busy_ended_at TIMESTAMPTZ
        """
    )

    # ------------------------------------------------------------- comments
    op.execute(
        """
        COMMENT ON TABLE coord.host_pauses IS
        'Host pauses (plan 2026-10-06 host-pause D1/D2): one typed row per pause, '
        'scopes ci and/or builds. A host is paused for a lane while ANY active '
        '(ended_at IS NULL) row covers it; each row ends independently, only by an '
        'allowed actor or by expiry. Not a drain: writes no fleet_drain row. Every '
        'write must INSERT the matching host_pauses_versions row in the SAME '
        'transaction. Retention 400 days.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.host_pauses_versions IS
        'Append-only snapshots of coord.host_pauses, mirroring every column, one '
        'row per version. Never UPDATE or DELETE a row here. Any migration that '
        'adds a column to host_pauses must add it here too.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_interrupted_jobs IS
        'CI jobs a host pause, a window hard end or the hand-built apps migration '
        'interrupted, and their automatic re-run (plan 2026-10-06 host-pause D7). '
        'run_id/job_id/run_attempt are NULL until coord resolves the job from the '
        'lease; a row that never resolves is rerun_state unresolved, never dropped.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.host_pause_resume_requests IS
        'Ask to turn back on (host-pause D2): a request to the owner app to end an '
        'owner pause. At most one unanswered request per pause.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.host_owner_events IS
        'Owner-app nudge events per CI host (host-pause D8), history only.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_host_agent_hours IS
        'Hourly per-agent rollup written by heartbeat ingest (host-pause D8): '
        'seconds online and seconds paused within the UTC hour starting at hour.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.host_pause_legacy_events IS
        'The hand-built pause apps imported events.jsonl rows (host-pause D11), '
        'history only, idempotent on (tenant_id, client_key).'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_host_agents_settings_versions IS
        'Every write of a CI host agent settings (host-pause D6), with its actor in '
        'updated_by. Append-only; one row per settings_version.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_host_agents.device_id IS
        'The declared host-to-device link (host-pause D6), never inferred from a '
        'name. Cleared when the device is unbound from the agent tenant.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_host_agents.owner_door IS
        'Agent-reported: an owner SID is declared on this host (host-pause D6). '
        'Never NULL (CHECK ck_ci_host_agents_owner_door_present).'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")

    # ---------------------------------------------- indexes (no transaction)
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_host_pauses_active_agent "
            "ON coord.host_pauses (tenant_id, agent_id) WHERE ended_at IS NULL"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_host_pauses_active_device "
            "ON coord.host_pauses (tenant_id, device_id) WHERE ended_at IS NULL"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_interrupted_jobs_open "
            "ON coord.ci_interrupted_jobs (tenant_id, rerun_state) "
            "WHERE rerun_state IN ('pending', 'dispatched')"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_ci_interrupted_jobs_agent "
            "ON coord.ci_interrupted_jobs (tenant_id, agent_id, interrupted_at)"
        )
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
            "uq_host_pause_resume_requests_one_open "
            "ON coord.host_pause_resume_requests (pause_id) WHERE answer IS NULL"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_host_owner_events_agent_at "
            "ON coord.host_owner_events (tenant_id, agent_id, at)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_host_pause_legacy_events_agent_at "
            "ON coord.host_pause_legacy_events (tenant_id, agent_id, at)"
        )
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
            "uq_ci_host_agents_one_live_child "
            "ON coord.ci_host_agents (parent_agent_id) "
            "WHERE revoked_at IS NULL AND parent_agent_id IS NOT NULL"
        )
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
            "uq_ci_enrol_codes_one_unredeemed_child "
            "ON coord.ci_enrol_codes (parent_agent_id) "
            "WHERE redeemed_at IS NULL AND parent_agent_id IS NOT NULL"
        )

    # --------------------- NOT VALID constraints, committed with the stamp
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.ci_host_agents
            ADD CONSTRAINT fk_ci_host_agents_parent_tenant
                FOREIGN KEY (parent_agent_id, tenant_id)
                REFERENCES coord.ci_host_agents (agent_id, tenant_id)
                ON DELETE CASCADE NOT VALID,
            ADD CONSTRAINT fk_ci_host_agents_tenant_device
                FOREIGN KEY (tenant_id, device_id)
                REFERENCES coord.tenant_devices (tenant_id, device_id)
                ON DELETE SET NULL (device_id) NOT VALID,
            ADD CONSTRAINT ck_ci_host_agents_not_own_parent
                CHECK (parent_agent_id IS NULL OR parent_agent_id <> agent_id) NOT VALID,
            ADD CONSTRAINT ck_ci_host_agents_windows_pools_finding
                CHECK (NOT windows_pools_allowed OR windows_pools_finding IS NOT NULL)
                NOT VALID,
            ADD CONSTRAINT ck_ci_host_agents_keep_awake_present
                CHECK (keep_awake IS NOT NULL) NOT VALID,
            ADD CONSTRAINT ck_ci_host_agents_enforcement_present
                CHECK (enforcement IS NOT NULL) NOT VALID,
            ADD CONSTRAINT ck_ci_host_agents_settings_version_present
                CHECK (settings_version IS NOT NULL) NOT VALID,
            ADD CONSTRAINT ck_ci_host_agents_windows_pools_allowed_present
                CHECK (windows_pools_allowed IS NOT NULL) NOT VALID,
            ADD CONSTRAINT ck_ci_host_agents_owner_door_present
                CHECK (owner_door IS NOT NULL) NOT VALID
        """
    )
    op.execute(
        """
        ALTER TABLE coord.ci_enrol_codes
            ADD CONSTRAINT fk_ci_enrol_codes_parent_tenant
                FOREIGN KEY (parent_agent_id, tenant_id)
                REFERENCES coord.ci_host_agents (agent_id, tenant_id)
                ON DELETE CASCADE NOT VALID,
            ADD CONSTRAINT ck_ci_enrol_codes_enforcement_present
                CHECK (enforcement IS NOT NULL) NOT VALID
        """
    )
    op.execute(
        """
        ALTER TABLE coord.ci_pool_specs
            ADD CONSTRAINT ck_ci_pool_specs_non_preemptible_present
                CHECK (non_preemptible IS NOT NULL) NOT VALID
        """
    )
    op.execute(
        """
        ALTER TABLE coord.ci_slot_leases
            ADD CONSTRAINT ck_ci_slot_leases_busy_window
                CHECK (busy_ended_at IS NULL OR busy_started_at IS NULL
                       OR busy_ended_at >= busy_started_at) NOT VALID
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Reverse: drop the constraints and columns added to coord.ci_*, then the tables."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.ci_slot_leases
            DROP CONSTRAINT IF EXISTS ck_ci_slot_leases_busy_window,
            DROP COLUMN IF EXISTS busy_ended_at,
            DROP COLUMN IF EXISTS busy_started_at
        """
    )
    op.execute(
        """
        ALTER TABLE coord.ci_pool_specs
            DROP CONSTRAINT IF EXISTS ck_ci_pool_specs_non_preemptible_present,
            DROP COLUMN IF EXISTS non_preemptible
        """
    )
    op.execute("DROP INDEX IF EXISTS coord.uq_ci_enrol_codes_one_unredeemed_child")
    op.execute(
        """
        ALTER TABLE coord.ci_enrol_codes
            DROP CONSTRAINT IF EXISTS ck_ci_enrol_codes_enforcement_present,
            DROP CONSTRAINT IF EXISTS fk_ci_enrol_codes_parent_tenant,
            DROP COLUMN IF EXISTS parent_agent_id,
            DROP COLUMN IF EXISTS enforcement
        """
    )
    op.execute("DROP INDEX IF EXISTS coord.uq_ci_host_agents_one_live_child")
    op.execute(
        """
        ALTER TABLE coord.ci_host_agents
            DROP CONSTRAINT IF EXISTS ck_ci_host_agents_owner_door_present,
            DROP CONSTRAINT IF EXISTS ck_ci_host_agents_windows_pools_allowed_present,
            DROP CONSTRAINT IF EXISTS ck_ci_host_agents_settings_version_present,
            DROP CONSTRAINT IF EXISTS ck_ci_host_agents_enforcement_present,
            DROP CONSTRAINT IF EXISTS ck_ci_host_agents_keep_awake_present,
            DROP CONSTRAINT IF EXISTS ck_ci_host_agents_windows_pools_finding,
            DROP CONSTRAINT IF EXISTS ck_ci_host_agents_not_own_parent,
            DROP CONSTRAINT IF EXISTS fk_ci_host_agents_tenant_device,
            DROP CONSTRAINT IF EXISTS fk_ci_host_agents_parent_tenant,
            DROP COLUMN IF EXISTS owner_door,
            DROP COLUMN IF EXISTS guest_name,
            DROP COLUMN IF EXISTS windows_pools_finding,
            DROP COLUMN IF EXISTS windows_pools_allowed,
            DROP COLUMN IF EXISTS rollback_deferred_until,
            DROP COLUMN IF EXISTS windows_slot_window,
            DROP COLUMN IF EXISTS envelope_state,
            DROP COLUMN IF EXISTS clock_skew_ms,
            DROP COLUMN IF EXISTS notices,
            DROP COLUMN IF EXISTS reported_window,
            DROP COLUMN IF EXISTS settings_updated_at,
            DROP COLUMN IF EXISTS settings_version,
            DROP COLUMN IF EXISTS enforcement,
            DROP COLUMN IF EXISTS keep_awake,
            DROP COLUMN IF EXISTS capacity_schedule,
            DROP COLUMN IF EXISTS owner_app,
            DROP COLUMN IF EXISTS device_id,
            DROP COLUMN IF EXISTS parent_agent_id
        """
    )
    op.execute("DROP TABLE IF EXISTS coord.ci_host_agents_settings_versions")
    op.execute("DROP TABLE IF EXISTS coord.host_pause_legacy_events")
    op.execute("DROP TABLE IF EXISTS coord.ci_host_agent_hours")
    op.execute("DROP TABLE IF EXISTS coord.host_owner_events")
    op.execute("DROP TABLE IF EXISTS coord.host_pause_resume_requests")
    op.execute("DROP TABLE IF EXISTS coord.ci_interrupted_jobs")
    op.execute("DROP TABLE IF EXISTS coord.host_pauses_versions")
    op.execute("DROP TABLE IF EXISTS coord.host_pauses")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
