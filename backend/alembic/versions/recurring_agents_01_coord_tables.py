"""coord.recurring_agents (+ versions, device status, run requests) and project.scheduled_tasks managed_* columns

Revision ID: recurring_agents_01
Revises: journey_03_explorations_stop_unsettled
Create Date: 2026-10-29

Phase 2 of plan
``2026-10-29-recurring-agents-declared-in-coord-reconciled-by-runner``
(decisions D1 dedicated tables, D2 catalog in code / rows hold overrides,
D5 runner reconciler, D7 status keyed on output, D8 drift watcher, D9 what
coord may push, D10 run-now).

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
four ``coord.*`` tables land here and must be DEPLOYED before coord's
recurring-agent routes and drift watcher (plan Phase 3) touch them. The
``project.scheduled_tasks`` columns are the runner's half (plan Phase 4): that
table is alembic-authored here (``consolidation_phase1_13_mobile_tasks_misc``,
``sched_cond_01_scheduled_tasks_conditions``).

The re-point rule
=================

``down_revision`` is this repo's single alembic head at authoring time and is
deliberately NOT pinned to it: ``alembic-graph-pr.yml`` serialises alembic PRs,
so a revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it (and nothing else); do NOT author an
``alembic merge`` revision.

The join key is the agent NAME, so coord must forbid renames
=============================================================

``coord.recurring_agent_device_status``, ``coord.recurring_agent_run_requests``
and ``project.scheduled_tasks.managed_agent`` all join to an agent by its
``name`` (a catalog agent has no row id to join on). A rename would orphan every
device's status and managed task under the old name, so coord's write routes
must refuse a rename (plan Phase 3 contract); "rename" is delete + create.

What a device applied is a DIGEST, not the version
==================================================

``coord.recurring_agents.version`` only moves when a tenant row is written. A
catalog fix in coord's code moves no row version, and delete + recreate restarts
the version at 1 while status is keyed by name, so an integer cannot say
whether a device runs the CURRENT spec. coord therefore computes a digest —
sha256 (lowercase hex) of the RESOLVED spec (catalog entry merged with the
tenant's overrides) — serves it on the device read route, and the runner
echoes it back (``recurring_agent_device_status.applied_digest``) and stores it
on the managed task (``project.scheduled_tasks.managed_digest``). The reconciler
(D5) and the drift watcher's ``recurring_agent_unapplied`` arm (D8) compare
DIGESTS. ``version`` / ``applied_version`` are kept for history and display
only.

coord.recurring_agents — one row per tenant-customised or custom agent
=======================================================================

The built-in jobs are a static catalog in coord's code
(``RECURRING_AGENT_CATALOG``, D2). A catalog entry with no row here still
applies with its defaults (D3, on by default). A row exists only when a tenant
CHANGED something, so for a catalog row (``catalog_ref`` NOT NULL) every
override column is nullable and **NULL means "inherit the catalog default"**,
which is how a later catalog fix reaches every tenant that did not override
that field. Seeding defaults into rows would freeze them
(``ON CONFLICT DO NOTHING``), the trap D2 names.

A custom agent (``catalog_ref`` NULL) has no catalog to inherit from, so
``ck_recurring_agents_custom_is_complete`` requires ``enabled``, ``schedule``,
``target``, ``catch_up_policy`` and ``task_spec``. Its ``timezone`` stays
nullable: NULL = the device's scheduler zone. ``ck_recurring_agents_task_spec_only_custom``
makes ``task_spec`` present IF AND ONLY IF the row is custom: a catalog row can
never carry its own task body, so a ``Script`` (or ``requireProbe``) command can
only ever come from the runner's bundled pin for that catalog entry (D9). The
database cannot see inside ``task_spec`` to refuse a custom ``Script``; coord's
write route and the runner's reconciler both refuse it (D9), and the reconciler
is the enforcement point that counts.

* ``id UUID PRIMARY KEY DEFAULT gen_random_uuid()``
* ``tenant_id UUID NOT NULL REFERENCES coord.tenants ON DELETE CASCADE``
* ``name TEXT NOT NULL`` — for a catalog row, conventionally the catalog key.
  ``UNIQUE (tenant_id, name)``.
* ``catalog_ref TEXT`` — the catalog entry key; NULL = custom agent. No CHECK on
  its vocabulary: the catalog is code and grows without a migration; coord
  validates it at write time.
* ``enabled BOOLEAN`` — NULL = the catalog entry's ``default_enabled``.
* ``schedule JSONB`` — a serialized ``ScheduleExpression`` (adjacently tagged
  ``{"type": ..., "value": ...}``, an object). NULL = catalog default.
* ``timezone TEXT`` — IANA zone. NULL = catalog default for a catalog row, the
  device's scheduler zone for a custom row (D5).
* ``catch_up_policy TEXT`` — ``CatchUpPolicy`` as qontinui-schemas serializes it
  (``#[serde(rename_all = "snake_case")]``: ``run`` | ``skip`` | ``run_once``),
  the same TEXT vocabulary ``project.scheduled_tasks.catch_up_policy`` holds.
  NULL = catalog default.
* ``params JSONB NOT NULL DEFAULT '{}'`` — values for the catalog entry's
  parameter schema; validated by coord against that schema, not here.
* ``task_spec JSONB`` — the full ``ScheduledTaskType`` of a custom agent.
* ``target JSONB`` — a serialized ``RecurringAgentTarget`` (D4). NULL = catalog
  default target. ``ck_recurring_agents_target_object`` refuses a non-object,
  so Phase 1's ``RecurringAgentTarget`` MUST serialize every variant as a JSON
  object (e.g. ``#[serde(tag = "kind")]``, giving ``{"kind": "all"}``); a unit
  variant serialized as a bare ``"all"`` string would be refused.
* ``version INTEGER NOT NULL DEFAULT 1`` — bumped by coord on every write of
  the row; history and display only (see the digest section).
* ``updated_by TEXT NOT NULL`` — the actor of the last write; never empty.
* ``created_at`` / ``updated_at TIMESTAMPTZ NOT NULL DEFAULT now()``.

Every JSONB column is CHECKed to the JSON type it must hold, so a scalar written
by mistake is refused rather than read back as "no override".

coord.recurring_agent_versions — append-only history
====================================================

One row per write of a ``coord.recurring_agents`` row: the full row snapshot
as JSONB. ``recurring_agent_id`` is deliberately NOT a foreign key, so the
history of a deleted agent outlives it (a recreated agent gets a new id and so
a fresh version line; ``UNIQUE (recurring_agent_id, version)``).
``(tenant_id, name)`` is carried so history is findable by name after deletion.

coord.recurring_agent_device_status — what each runner reports (D7)
===================================================================

Keyed ``PRIMARY KEY (tenant_id, device_id, name)``. ``name`` is NOT a foreign
key to ``coord.recurring_agents``: a catalog agent applies with no tenant row
at all, and a device must be able to report on it. ``device_id`` is not a
foreign key either, so a report outlives a device-registry change. The PK's
``(tenant_id, device_id)`` prefix serves the device read path (no separate
index); ``ix_recurring_agent_device_status_tenant_name`` serves the drift
watcher (D8), which walks per (tenant, agent). Only the device writes a row: a
targeted device with no row is UNKNOWN, never "healthy" (D8), so nothing here
is defaulted into existence.

* ``applied_digest TEXT`` — sha256 (64 lowercase hex) of the resolved spec the
  device applied; NULL = it has applied none. What D5/D8 compare.
* ``applied_version INTEGER`` — display only.
* ``state TEXT NOT NULL`` — ``applied`` | ``paused`` (local pause, D6) |
  ``overridden`` (local override record, D6) | ``unapplied`` | ``refused``.
  ``unapplied_reason`` (non-empty) is required exactly when the state is
  ``unapplied`` or ``refused`` (``workspace_root_unset``, ``refused_command``,
  ``tenant_unproven``, ``managed_tasks_refused``, ... — coord's vocabulary, no
  CHECK on it). ``overridden`` requires an ``override`` record; a ``paused``
  task may ALSO carry one (``override IS NOT NULL``), since pause and override
  are independent local actions. Paused / overridden are status, never an alert
  (D8).
* ``override JSONB`` — the local override record.
* ``last_run JSONB`` — the newest ``TaskExecutionRecord`` summary;
  ``recent_runs JSONB`` — the last N run summaries (array).
* ``last_completed_at`` / ``last_success_at TIMESTAMPTZ`` — typed instants of
  the newest completed run and the newest successful one, for the D8
  ``recurring_agent_stale`` and ``recurring_agent_failing`` arms (no JSON
  extraction in the watcher). NULL = none known.
* ``next_run TIMESTAMPTZ``.
* ``reported_at TIMESTAMPTZ NOT NULL`` — supplied by the device's report; no
  DEFAULT, so a row can never claim a report nobody sent.

coord.recurring_agent_run_requests — "Run now on this device" (D10)
===================================================================

Its own table, so a run-now on a device that has never reported needs no fake
status row. ``PRIMARY KEY (tenant_id, device_id, name)``, tenant FK.

The acknowledgement is by an opaque id, not a timestamp: ``request_id UUID NOT
NULL DEFAULT gen_random_uuid()``, which coord REGENERATES (``request_id =
gen_random_uuid()``) on every request upsert, together with ``requested_at`` /
``requested_by``. The reconciler runs the task locally and echoes the id it ran
back as ``acknowledged_request_id``. A request is pending exactly while
``acknowledged_request_id IS DISTINCT FROM request_id``. Comparing timestamps
would be fragile: any precision loss on the round trip (PostgreSQL keeps
microseconds; a JSON or chrono hop may not) would leave a request pending
forever and re-run the task on every poll. Echo-the-id rather than
delete-on-ack, so a second press racing a report is never lost.
``acknowledged_at`` is informational only (when the device ran it).

project.scheduled_tasks — the runner's managed key (D5)
=======================================================

Six nullable, undefaulted columns: ``managed_source TEXT`` (``coord``),
``managed_tenant_id UUID``, ``managed_agent TEXT``, ``managed_version
INTEGER``, ``managed_digest TEXT`` (the applied resolved-spec digest), and
``timezone TEXT`` (per-task IANA zone, NULL = the scheduler's zone). NULL
``managed_source`` = an unmanaged, user-created task, which the reconciler
never touches.

``uq_scheduled_tasks_managed_key`` is a UNIQUE partial index on
``(managed_source, managed_tenant_id, managed_agent) WHERE managed_source IS
NOT NULL AND managed_tenant_id IS NOT NULL AND managed_agent IS NOT NULL``: the
server-side upsert key behind the runner's ``PUT /scheduler/tasks/by-key/...``,
which retires the client-side list/match/POST loop (and its duplicate-task
exit 3). The runner's ``ON CONFLICT (managed_source, managed_tenant_id,
managed_agent) WHERE ...`` must spell the IDENTICAL predicate, or PostgreSQL
will not infer this index as the arbiter.

The key does not carry a device id. It assumes plan Phase 0.1's answer that a
runner's Postgres is private to one machine; if two machines share one
database, this key would merge their managed tasks and must gain a device
column first.

No CHECK ties the managed_* columns together: the runner will self-heal these
columns on an embedded Postgres with no alembic (plan Phase 4), so a constraint
here would hold on some databases and not others; the runner's store enforces
all-or-nothing.

Locking and transactions
========================

``SET LOCAL lock_timeout = '3s'`` precedes the DDL (house convention) and is
reset to DEFAULT before the ``autocommit_block()``. The index is built
``CONCURRENTLY IF NOT EXISTS`` in that block, LAST — the ``pr_fix_ctx_head_sha_01``
shape the classifier's autocommit arm admits, and no runner write is blocked during the
build. Entering ``autocommit_block()`` COMMITS everything before it, so the
revision is NOT atomic: if the index build fails, the tables and columns are
already committed and ``alembic_version`` still names the parent. Every earlier
statement is ``IF NOT EXISTS``, so re-running ``upgrade`` is the recovery.

Verify after deploy (must read ``indisvalid = true``)::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'uq_scheduled_tasks_managed_key';

A killed build leaves an INVALID index that ``IF NOT EXISTS`` skips. Recovery is
a follow-up revision doing ``DROP INDEX CONCURRENTLY IF EXISTS`` then this CREATE
again, never a re-run.

Merge-train classifier disposition
==================================

UNKNOWN: the coord migration classifier
(``crates/coord/src/pr_merge/migration_classifier.rs``) was not run against
this file. Every ``upgrade()`` statement is additive (``CREATE TABLE IF NOT
EXISTS``, indexes on tables this file creates, ``ADD COLUMN IF NOT EXISTS``
nullable undefaulted, one ``CREATE INDEX CONCURRENTLY IF NOT EXISTS``,
``COMMENT ON`` with literals), and every SQL string is a static literal.

Downgrade
=========

``downgrade()`` runs in ONE transaction, with no autocommit block, so its
refusal and its drops cannot be separated: ``SET LOCAL lock_timeout = '3s'``,
``LOCK TABLE project.scheduled_tasks IN ACCESS EXCLUSIVE MODE`` (so no managed
task can be inserted between the check and the drop), the check, then a plain
``DROP INDEX IF EXISTS`` (non-concurrent; the table lock is held anyway), the
column drops and the table drops. It REFUSES (``RAISE EXCEPTION``) while
``project.scheduled_tasks`` holds a row with ``managed_source IS NOT NULL``:
dropping the managed key would orphan those tasks as indistinguishable from
user-created ones, and the reconciler could never find them again. An operator
who really means to roll back removes or unmanages those tasks first. Otherwise
it drops the index, the six columns and the four tables, all ``IF EXISTS``;
``project.scheduled_tasks`` and its other columns survive.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# Keep ``down_revision`` on ONE physical line — the CI gate parses it by line.
revision: str = "recurring_agents_01"
down_revision: str | Sequence[str] | None = "journey_03_explorations_stop_unsettled"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal: the coord merge-train migration
# classifier extracts string literals from each execute call and rejects a
# call with none as dynamic.

# The runner-side columns, in DDL spelling — the one list the test reads.
_SCHEDULED_TASK_COLUMNS: tuple[tuple[str, str], ...] = (
    ("managed_source", "TEXT"),
    ("managed_tenant_id", "UUID"),
    ("managed_agent", "TEXT"),
    ("managed_version", "INTEGER"),
    ("managed_digest", "TEXT"),
    ("timezone", "TEXT"),
)

# CatchUpPolicy as qontinui-schemas rust/src/scheduler.rs serializes it.
_CATCH_UP_POLICIES: tuple[str, ...] = ("run", "skip", "run_once")

# coord.recurring_agent_device_status.state vocabulary.
_DEVICE_STATES: tuple[str, ...] = (
    "applied",
    "paused",
    "overridden",
    "unapplied",
    "refused",
)


def upgrade() -> None:
    """Create the four coord tables, then the runner's managed_* columns + key."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # ---- coord.recurring_agents ------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.recurring_agents (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id        UUID NOT NULL
                REFERENCES coord.tenants (tenant_id) ON DELETE CASCADE,
            name             TEXT NOT NULL,
            catalog_ref      TEXT,
            enabled          BOOLEAN,
            schedule         JSONB,
            timezone         TEXT,
            catch_up_policy  TEXT,
            params           JSONB NOT NULL DEFAULT '{}'::jsonb,
            task_spec        JSONB,
            target           JSONB,
            version          INTEGER NOT NULL DEFAULT 1,
            updated_by       TEXT NOT NULL,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_recurring_agents_tenant_name UNIQUE (tenant_id, name),
            CONSTRAINT ck_recurring_agents_name_nonempty CHECK (name <> ''),
            CONSTRAINT ck_recurring_agents_updated_by_nonempty
                CHECK (updated_by <> ''),
            CONSTRAINT ck_recurring_agents_catalog_ref_nonempty
                CHECK (catalog_ref IS NULL OR catalog_ref <> ''),
            CONSTRAINT ck_recurring_agents_version_positive CHECK (version >= 1),
            CONSTRAINT ck_recurring_agents_catch_up_policy
                CHECK (catch_up_policy IS NULL
                       OR catch_up_policy IN ('run', 'skip', 'run_once')),
            CONSTRAINT ck_recurring_agents_schedule_object
                CHECK (schedule IS NULL OR jsonb_typeof(schedule) = 'object'),
            CONSTRAINT ck_recurring_agents_params_object
                CHECK (jsonb_typeof(params) = 'object'),
            CONSTRAINT ck_recurring_agents_task_spec_object
                CHECK (task_spec IS NULL OR jsonb_typeof(task_spec) = 'object'),
            CONSTRAINT ck_recurring_agents_target_object
                CHECK (target IS NULL OR jsonb_typeof(target) = 'object'),
            CONSTRAINT ck_recurring_agents_task_spec_only_custom
                CHECK ((catalog_ref IS NULL) = (task_spec IS NOT NULL)),
            CONSTRAINT ck_recurring_agents_custom_is_complete
                CHECK (catalog_ref IS NOT NULL
                       OR (enabled IS NOT NULL
                           AND schedule IS NOT NULL
                           AND target IS NOT NULL
                           AND catch_up_policy IS NOT NULL))
        )
        """
    )

    # ---- coord.recurring_agent_versions ----------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.recurring_agent_versions (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id           UUID NOT NULL
                REFERENCES coord.tenants (tenant_id) ON DELETE CASCADE,
            recurring_agent_id  UUID NOT NULL,
            name                TEXT NOT NULL,
            version             INTEGER NOT NULL,
            snapshot            JSONB NOT NULL,
            updated_by          TEXT NOT NULL,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_recurring_agent_versions_agent_version
                UNIQUE (recurring_agent_id, version),
            CONSTRAINT ck_recurring_agent_versions_version_positive
                CHECK (version >= 1),
            CONSTRAINT ck_recurring_agent_versions_updated_by_nonempty
                CHECK (updated_by <> ''),
            CONSTRAINT ck_recurring_agent_versions_snapshot_object
                CHECK (jsonb_typeof(snapshot) = 'object')
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_recurring_agent_versions_tenant_name
            ON coord.recurring_agent_versions (tenant_id, name, version DESC)
        """
    )

    # ---- coord.recurring_agent_device_status -----------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.recurring_agent_device_status (
            tenant_id          UUID NOT NULL
                REFERENCES coord.tenants (tenant_id) ON DELETE CASCADE,
            device_id          UUID NOT NULL,
            name               TEXT NOT NULL,
            applied_digest     TEXT,
            applied_version    INTEGER,
            state              TEXT NOT NULL,
            unapplied_reason   TEXT,
            override           JSONB,
            last_run           JSONB,
            recent_runs        JSONB,
            last_completed_at  TIMESTAMPTZ,
            last_success_at    TIMESTAMPTZ,
            next_run           TIMESTAMPTZ,
            reported_at        TIMESTAMPTZ NOT NULL,
            CONSTRAINT recurring_agent_device_status_pkey
                PRIMARY KEY (tenant_id, device_id, name),
            CONSTRAINT ck_recurring_agent_device_status_state
                CHECK (state IN ('applied', 'paused', 'overridden',
                                 'unapplied', 'refused')),
            CONSTRAINT ck_recurring_agent_device_status_reason_iff_unapplied
                CHECK ((state IN ('unapplied', 'refused'))
                       = (unapplied_reason IS NOT NULL)),
            CONSTRAINT ck_recurring_agent_device_status_reason_nonempty
                CHECK (unapplied_reason IS NULL OR unapplied_reason <> ''),
            CONSTRAINT ck_recurring_agent_device_status_overridden_has_override
                CHECK (state <> 'overridden' OR override IS NOT NULL),
            CONSTRAINT ck_recurring_agent_device_status_applied_digest_sha256
                CHECK (applied_digest IS NULL
                       OR applied_digest ~ '^[0-9a-f]{64}$'),
            CONSTRAINT ck_recurring_agent_device_status_applied_version_positive
                CHECK (applied_version IS NULL OR applied_version >= 1),
            CONSTRAINT ck_recurring_agent_device_status_override_object
                CHECK (override IS NULL OR jsonb_typeof(override) = 'object'),
            CONSTRAINT ck_recurring_agent_device_status_last_run_object
                CHECK (last_run IS NULL OR jsonb_typeof(last_run) = 'object'),
            CONSTRAINT ck_recurring_agent_device_status_recent_runs_array
                CHECK (recent_runs IS NULL
                       OR jsonb_typeof(recent_runs) = 'array')
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_recurring_agent_device_status_tenant_name
            ON coord.recurring_agent_device_status (tenant_id, name)
        """
    )

    # ---- coord.recurring_agent_run_requests ------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.recurring_agent_run_requests (
            tenant_id        UUID NOT NULL
                REFERENCES coord.tenants (tenant_id) ON DELETE CASCADE,
            device_id        UUID NOT NULL,
            name             TEXT NOT NULL,
            requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            requested_by     TEXT NOT NULL,
            request_id       UUID NOT NULL DEFAULT gen_random_uuid(),
            acknowledged_request_id  UUID,
            acknowledged_at  TIMESTAMPTZ,
            CONSTRAINT recurring_agent_run_requests_pkey
                PRIMARY KEY (tenant_id, device_id, name),
            CONSTRAINT ck_recurring_agent_run_requests_requested_by_nonempty
                CHECK (requested_by <> '')
        )
        """
    )

    # ---- comments --------------------------------------------------------
    op.execute(
        """
        COMMENT ON TABLE coord.recurring_agents IS
            'Tenant-declared recurring agents: one row per catalog agent a tenant customised (catalog_ref set; NULL override columns inherit the code catalog RECURRING_AGENT_CATALOG) or per custom agent (catalog_ref NULL; full spec required). A catalog agent with no row applies with its catalog defaults. name is the join key for device status, run requests and managed tasks, so coord forbids renames. Plan 2026-10-29-recurring-agents-declared-in-coord-reconciled-by-runner (D1, D2).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.recurring_agents.catalog_ref IS
            'Key of the code-catalog entry this row overrides. NULL = a custom agent, which must carry task_spec, schedule, target, catch_up_policy and enabled. A catalog row never carries task_spec, so a Script or requireProbe command can only come from the runner''s own bundled pin for the entry (D9).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.recurring_agents.catch_up_policy IS
            'CatchUpPolicy as qontinui-schemas serializes it (snake_case): run | skip | run_once. NULL = the catalog default (custom rows must state it).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.recurring_agents.timezone IS
            'IANA time zone. NULL = the catalog default for a catalog row, the device''s scheduler zone for a custom row.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.recurring_agents.task_spec IS
            'Full serialized ScheduledTaskType of a custom agent; present if and only if catalog_ref IS NULL. A custom agent may only be RemoteAgent (enforced by coord''s write route and the runner reconciler, D9).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.recurring_agents.version IS
            'Bumped by coord on every write of this row. History and display only: what a device applied is compared by the resolved-spec digest (recurring_agent_device_status.applied_digest), since a catalog fix moves no row version.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.recurring_agent_versions IS
            'Append-only history of coord.recurring_agents writes: one full-row snapshot per version. recurring_agent_id is not a foreign key so history outlives a deleted agent. Plan 2026-10-29-recurring-agents-declared-in-coord-reconciled-by-runner (D1).'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.recurring_agent_device_status IS
            'Per (tenant, device, agent) status reported by each runner after every reconcile and run; written only by the device. name is not a foreign key: a catalog agent applies with no coord.recurring_agents row. A targeted device with no row is UNKNOWN, never healthy. Plan 2026-10-29-recurring-agents-declared-in-coord-reconciled-by-runner (D7, D8).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.recurring_agent_device_status.applied_digest IS
            'sha256 (lowercase hex) of the resolved spec (catalog entry + tenant overrides) the device applied, as coord computed and served it. The reconciler (D5) and the unapplied drift arm (D8) compare this, not applied_version. NULL = nothing applied.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.recurring_agent_device_status.state IS
            'applied | paused (local pause) | overridden (local override record, required) | unapplied | refused. unapplied_reason is required exactly for unapplied and refused. A paused task may also carry an override. paused/overridden are status, never an alert (D8).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.recurring_agent_device_status.last_completed_at IS
            'When the newest completed run ended, for the D8 stale arm. NULL = no completed run known.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.recurring_agent_device_status.last_success_at IS
            'When the newest successful run ended, for the D8 failing arm. NULL = no successful run known.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.recurring_agent_device_status.reported_at IS
            'When the device sent this report. Supplied by the report; no default.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.recurring_agent_run_requests IS
            'Run now on this device (D10), one row per (tenant, device, agent), upserted by coord, which regenerates request_id on every upsert. The runner runs the task and echoes request_id back as acknowledged_request_id; a request is pending exactly while acknowledged_request_id IS DISTINCT FROM request_id. acknowledged_at is informational. Separate from device status so a device that never reported can be asked. Plan 2026-10-29-recurring-agents-declared-in-coord-reconciled-by-runner.'
        """
    )

    # ---- project.scheduled_tasks managed key -----------------------------
    op.execute(
        """
        ALTER TABLE project.scheduled_tasks
            ADD COLUMN IF NOT EXISTS managed_source TEXT,
            ADD COLUMN IF NOT EXISTS managed_tenant_id UUID,
            ADD COLUMN IF NOT EXISTS managed_agent TEXT,
            ADD COLUMN IF NOT EXISTS managed_version INTEGER,
            ADD COLUMN IF NOT EXISTS managed_digest TEXT,
            ADD COLUMN IF NOT EXISTS timezone TEXT
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN project.scheduled_tasks.managed_source IS
            'Who manages this task: coord for a task reconciled from coord.recurring_agents. NULL = an unmanaged, user-created task the reconciler never touches. Set together with managed_tenant_id, managed_agent, managed_version and managed_digest.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN project.scheduled_tasks.managed_digest IS
            'sha256 (lowercase hex) of the resolved coord spec this managed task was applied from; the reconciler re-applies when coord serves a different digest.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN project.scheduled_tasks.timezone IS
            'Per-task IANA time zone for next_run. NULL = the scheduler''s configured zone.'
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_scheduled_tasks_managed_key
            ON project.scheduled_tasks (managed_source, managed_tenant_id, managed_agent)
            WHERE managed_source IS NOT NULL
              AND managed_tenant_id IS NOT NULL
              AND managed_agent IS NOT NULL
            """
        )


def downgrade() -> None:
    """Refuse while managed tasks exist; else drop the key, columns and tables.

    One transaction: the lock is taken before the check, and nothing commits
    between the check and the drops.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("LOCK TABLE project.scheduled_tasks IN ACCESS EXCLUSIVE MODE")
    op.execute(
        """
        DO $$
        DECLARE
            managed bigint;
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'project'
                   AND table_name = 'scheduled_tasks'
                   AND column_name = 'managed_source'
            ) THEN
                EXECUTE 'SELECT count(*) FROM project.scheduled_tasks '
                        'WHERE managed_source IS NOT NULL' INTO managed;
                IF managed > 0 THEN
                    RAISE EXCEPTION
                        'project.scheduled_tasks holds % coord-managed task(s) '
                        '(managed_source IS NOT NULL). Downgrading '
                        'recurring_agents_01 would orphan them as user-created '
                        'tasks; delete or unmanage them first.', managed;
                END IF;
            END IF;
        END $$;
        """
    )
    op.execute("DROP INDEX IF EXISTS project.uq_scheduled_tasks_managed_key")
    op.execute(
        """
        ALTER TABLE project.scheduled_tasks
            DROP COLUMN IF EXISTS timezone,
            DROP COLUMN IF EXISTS managed_digest,
            DROP COLUMN IF EXISTS managed_version,
            DROP COLUMN IF EXISTS managed_agent,
            DROP COLUMN IF EXISTS managed_tenant_id,
            DROP COLUMN IF EXISTS managed_source
        """
    )
    op.execute("DROP TABLE IF EXISTS coord.recurring_agent_run_requests")
    op.execute(
        "DROP INDEX IF EXISTS coord.ix_recurring_agent_device_status_tenant_name"
    )
    op.execute("DROP TABLE IF EXISTS coord.recurring_agent_device_status")
    op.execute("DROP INDEX IF EXISTS coord.ix_recurring_agent_versions_tenant_name")
    op.execute("DROP TABLE IF EXISTS coord.recurring_agent_versions")
    # DROP TABLE takes every constraint and the comments with it.
    op.execute("DROP TABLE IF EXISTS coord.recurring_agents")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
