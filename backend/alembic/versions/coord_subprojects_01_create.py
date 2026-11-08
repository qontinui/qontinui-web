"""coord.subprojects + coord.subproject_members — subprojects and their membership ledger

Phase 1 (the qontinui-web half, which lands FIRST) of plan
``2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled``.
Creates two new, empty tables, eight indexes beside their primary keys (one of
them the slug UNIQUE constraint's own) and two table comments, all in ONE
transaction::

    coord.subprojects (id, tenant_id, slug, title, title_source, goal, origin,
                       status, root_agent_session_id, next_steps_note,
                       next_steps_note_by, next_steps_note_at, merged_into,
                       last_verdict, last_verdict_as_of, created_at,
                       updated_at, closed_at)
        uq_subprojects_tenant_slug             UNIQUE (tenant_id, slug)
        idx_subprojects_tenant_status_updated  (tenant_id, status, updated_at DESC)

    coord.subproject_members (id, tenant_id, subproject_id, member_kind,
                              agent_session_id, coord_session_id,
                              allocation_agent_id, work_unit_id, joined_via,
                              via_ref, via_session, snapshot, snapshot_at,
                              added_at, added_by, removed_at)
        idx_subproject_members_live_subproject            (tenant_id, subproject_id)
            WHERE removed_at IS NULL
        idx_subproject_members_subproject_history         (tenant_id, subproject_id, removed_at)
        uq_subproject_members_live_agent_session          UNIQUE (tenant_id, agent_session_id)
            WHERE removed_at IS NULL AND agent_session_id IS NOT NULL
        uq_subproject_members_live_work_unit              UNIQUE (tenant_id, work_unit_id)
            WHERE removed_at IS NULL AND work_unit_id IS NOT NULL
        uq_subproject_members_live_allocation             UNIQUE (tenant_id, allocation_agent_id)
            WHERE removed_at IS NULL AND allocation_agent_id IS NOT NULL
        uq_subproject_members_live_pending_coord_session  UNIQUE (tenant_id, coord_session_id)
            WHERE removed_at IS NULL AND agent_session_id IS NULL
              AND coord_session_id IS NOT NULL

Every name, type, default, key and index is the one the plan's wire contract
fixes ("Schema (Phase 1, qontinui-web alembic revision ``coord_subprojects_01``,
schema="coord")"), which the coord and web phases of the same plan are built
against in parallel. A shape change here is a contract change there.

Why these tables exist
======================

A topic of work spreads over many agent sessions — a root session, its gate
continuations, respawns, handoffs and spawned followups — and over the work
units, gates and PRs those sessions touch. Nothing in coord groups them, so
"what is happening with X, and why did it stop" is answered by hand. A
subproject is that grouping (plan D1), and its health is COMPUTED by coord from
live state, never hand-written.

Column authority — ``coord.subprojects``
=======================================

* ``id uuid PRIMARY KEY DEFAULT gen_random_uuid()``.
* ``tenant_id uuid NOT NULL`` — every door the plan defines is tenant-scoped.
  It carries NO foreign key, as the contract fixes it; that also keeps this
  revision off every existing table (see "Lock posture").
* ``slug text NOT NULL`` — the tenant-unique handle, ``UNIQUE (tenant_id,
  slug)``; a standing subproject (``scheduled:<task>``, D4 rule 5) can be
  upserted on it.
* ``title text NOT NULL`` and ``title_source text NOT NULL DEFAULT
  'root_session'`` (``root_session`` | ``explicit``) — a title follows the root
  session's name until someone sets one explicitly (D4 rule 6).
* ``goal text`` — operator- or agent-authored; NULL until written.
* ``origin text NOT NULL`` — ``operator_prompt`` | ``autonomous`` |
  ``scheduled`` | ``orphan_continuation`` | ``operator_created`` | ``backfill``.
* ``status text NOT NULL DEFAULT 'open'`` — the DECLARED lifecycle,
  ``open`` | ``done`` | ``archived``. It is not the health headline.
* ``root_agent_session_id uuid`` — the harness session id that founded it.
* ``next_steps_note`` / ``next_steps_note_by`` (text) / ``next_steps_note_at``
  (timestamptz) — the latest authored next-steps note (D7 a) and who wrote it.
* ``merged_into uuid`` -> ``coord.subprojects (id)`` — set when the operator
  merges this subproject into another (D11); a merged id resolves to its
  target and the row stays.
* ``last_verdict jsonb`` / ``last_verdict_as_of timestamptz`` — the verdict
  cache the list door serves (D1). Written ONLY by coord's leader-only
  reconciler tick (D9). NULL means the tick has not reached the row, which the
  list door serves as headline ``unknown`` — never a default.
* ``created_at`` / ``updated_at timestamptz NOT NULL DEFAULT now()`` and
  ``closed_at timestamptz`` (NULL while ``open``).

Column authority — ``coord.subproject_members``
==============================================

A durable LEDGER, one row per member, because ``coord.sessions`` rows are
pruned (D2). Member kinds are ``session`` and ``work_unit``.

* ``subproject_id uuid NOT NULL`` -> ``coord.subprojects (id)``.
* ``agent_session_id uuid`` — the harness (Claude Code) session id, the key
  ``coord.gates.agent_session_id``, ``coord.agent_worktrees.agent_session_id``,
  ``coord.work_units.owner_agent_session_id`` and the ``Session-Id:`` commit
  trailer all carry (D3). Every lookup goes harness id first.
* ``coord_session_id uuid`` — ``coord.sessions.id``, recorded beside it only
  for a placeholder-keyed PENDING row (``agent_session_id`` NULL).
* ``allocation_agent_id uuid`` — keys the PENDING row a Continue spawn writes
  before it publishes the launch (D8); bound to the harness id when the runner
  reports the session.
* ``work_unit_id uuid`` — a ``work_unit`` member's unit.
* ``joined_via text NOT NULL`` — ``root`` | ``parent`` | ``gate_continuation`` |
  ``work_unit_dispatch`` | ``spawn`` | ``declared`` | ``operator_move`` |
  ``auto_attach`` | ``followup_edge`` | ``split`` | ``backfill`` | ``merge``;
  ``via_ref text`` and ``via_session uuid`` name what it joined through (a gate
  continuation records ``via_ref = <gate_id>`` and ``via_session = <registering
  harness id>``, D5 — continuation lineage lives here, never in
  ``coord.sessions.parent_session_id``).
* ``snapshot jsonb`` / ``snapshot_at timestamptz`` — only what dies with the
  ``coord.sessions`` row (``session_status``, ``finish_reason``,
  ``closed_at``, ``last_progress_at``), refreshed by the D9 tick. Gates and PRs
  are DERIVED at read time and never stored here (D2).
* ``added_at timestamptz NOT NULL DEFAULT now()``, ``added_by text``,
  ``removed_at timestamptz`` — NULL ``removed_at`` is a LIVE membership. A move
  or removal stamps ``removed_at`` (a move then adds the new row), so the
  history stays in the ledger.

None of ``agent_session_id``, ``coord_session_id``, ``allocation_agent_id``,
``work_unit_id`` or ``via_session`` carries a foreign key: the rows they name
are pruned, rewritten or reclaimed on their own schedules, and a ledger key
that outlives its referent is the design.

Constraints
===========

* Vocabularies: ``ck_subprojects_title_source``, ``ck_subprojects_origin``,
  ``ck_subprojects_status``, ``ck_subproject_members_member_kind`` and
  ``ck_subproject_members_joined_via`` pin each contract vocabulary, so a value
  outside it is refused by name rather than stored.
* Each member kind names its own key: ``ck_subproject_members_work_unit_key``
  (a ``work_unit`` member names its ``work_unit_id``) and
  ``ck_subproject_members_session_key`` (a ``session`` member names at least
  one of ``agent_session_id``, ``coord_session_id``, ``allocation_agent_id``).
* ... and only its own keys: ``ck_subproject_members_no_work_unit_on_session``
  (a ``session`` member carries no ``work_unit_id``) and
  ``ck_subproject_members_no_session_key_on_work_unit`` (a ``work_unit`` member
  carries none of the three session keys). Without them a session row carrying
  a ``work_unit_id`` would hold that unit's tenant-wide live slot in
  ``uq_subproject_members_live_work_unit``, and a work-unit row carrying a
  session key would hold that session's.
* Foreign keys: ``fk_subprojects_merged_into`` and
  ``fk_subproject_members_subproject``. Neither cascades — NO ACTION, the
  PostgreSQL default. A subproject is never deleted (it is archived, or merged
  by writing ``merged_into`` and moving its members), so a DELETE that would
  orphan a member or a merge pointer is refused rather than taking the ledger
  with it.
* Live-membership uniques (partial, ``WHERE removed_at IS NULL``): an agent
  session, a work unit and an allocation are each a live member of at most one
  subproject per tenant. The ``coord_session_id`` rule covers only
  placeholder-keyed pending rows (``agent_session_id IS NULL``), so binding the
  harness id onto a pending row releases it. A coord upsert that names one of
  these indexes as its ``ON CONFLICT`` arbiter must restate the index predicate
  in full: PostgreSQL infers a partial arbiter only when the statement's
  ``WHERE`` implies the index's.

Indexes
=======

* ``(tenant_id, status, updated_at DESC)`` — the list door's default read, the
  open subprojects of a tenant, most recently changed first.
* ``(tenant_id, subproject_id) WHERE removed_at IS NULL`` — a subproject's live
  members, which every detail read and every verdict walks.
* ``(tenant_id, subproject_id, removed_at)`` — NOT partial: the detail page's
  history read of a subproject's removed members, which the live index cannot
  serve.
* The four live-membership uniques above.

Every index is built in the SAME transaction as the tables — a plain
``CREATE [UNIQUE] INDEX IF NOT EXISTS``, never ``CONCURRENTLY`` — so the tables
and every unique that guards them become visible in one commit. A
``CONCURRENTLY`` build runs outside the transaction: a cancelled or timed-out
one leaves an INVALID index (``indisvalid = false``) that an ``IF NOT EXISTS``
retry silently keeps, after which every coord upsert naming that unique as its
``ON CONFLICT`` arbiter fails 42P10; and coord's schema readiness and the
plan's ``schema_object_exists`` gate would both read the tables as applied
before their indexes existed. coord's migration classifier admits a
non-concurrent ``CREATE INDEX`` on a table the same file creates earlier as a
new-table CLAIM, which the merge engine discharges by proving trunk has never
named the table (``pr_merge::migration_new_table_proof``: a case-insensitive
search of the tree and of the migration directory's history). Trunk named
neither table when this was authored, so the revision must land before any
other trunk file names either; the plan orders it first. The ``UNIQUE
(tenant_id, slug)`` constraint is built inside ``CREATE TABLE`` itself.

Lock posture
============

Nothing here touches an existing table. Both foreign keys point at
``coord.subprojects``, which this revision creates in the same transaction,
``tenant_id`` carries no key, and every index is built on a table this
transaction created, which no other session can see until it commits. So the
upgrade requests no lock on any table a live reader or writer holds and needs
no ``lock_timeout``. The downgrade drops only these two tables.

Idempotency / authorship posture
================================

* ``CREATE TABLE IF NOT EXISTS`` / ``CREATE [UNIQUE] INDEX IF NOT EXISTS`` /
  ``COMMENT ON``, all in one transaction, so a failed apply rolls back whole;
  and a symmetric ``downgrade()`` that drops the indexes and then the tables
  (members first, since it references ``coord.subprojects``). ``IF NOT EXISTS``
  matches on NAME only; acceptable because no earlier revision spells either
  table (trunk named neither at authoring time).
* **alembic is the SOLE author of the ``coord.*`` schema** (served policy
  ``production-and-cost`` ``alembic-sole-authorship``). coord only INSERTs,
  UPDATEs and SELECTs these tables, and this revision must be APPLIED in
  production before the coord PRs that read or write them deploy (the plan's
  Phase 1 -> 2 gate is ``schema_object_exists coord.subproject_members``). The
  plan's Phase 2 registers both tables in coord's
  ``schema_manifest::ALEMBIC_OWNED_TABLES`` as non-critical, so coord's
  subproject routes answer ``503 schema_migration_pending`` until this applies.
* The ``coord_tenant`` / ``coord_tenant_preflight`` roles get their table
  privileges from ``coordrls_01``'s ``ALTER DEFAULT PRIVILEGES``, and the
  single-column primary keys give both tables the replica identity the
  logical-replication publication requires; neither needs a statement here.
* No backfill: this revision writes no rows. The historical backfill is the
  first run of coord's D9 reconciler tick — pipeline-deployed code writing only
  these two tables (served policy ``production-and-cost``
  ``pipeline-deploys-are-not-adhoc-mutation``). The downgrade drops the tables
  and their rows; the data does not return.
* Every SQL string is a static literal (so the revision renders unchanged in
  offline ``--sql`` mode), and none carries a ``:word`` sequence, which
  SQLAlchemy ``text()`` would read as a bind parameter, or a ``%``.

Chaining
========

``down_revision = "coord_test_result_runs_01"`` -- ``main``'s single alembic
head, measured 2026-11-08 with ``scripts/ci/count_alembic_heads.py``
(``HEAD_COUNT=1``) at ``origin/main`` ``f438238a9``. A re-point is three
coupled edits: ``down_revision``, the ``Revises:`` line below, and
``_PARENT_REVISION_ID`` in ``tests/test_coord_subprojects_01_migration.py``.

Revision ID: coord_subprojects_01
Revises: coord_test_result_runs_01
Create Date: 2026-11-08

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_subprojects_01"
down_revision: str | None = "coord_test_result_runs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create both tables, their comments and their seven indexes in ONE transaction."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.subprojects (
            id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id              uuid         NOT NULL,
            slug                   text         NOT NULL,
            title                  text         NOT NULL,
            title_source           text         NOT NULL DEFAULT 'root_session',
            goal                   text,
            origin                 text         NOT NULL,
            status                 text         NOT NULL DEFAULT 'open',
            root_agent_session_id  uuid,
            next_steps_note        text,
            next_steps_note_by     text,
            next_steps_note_at     timestamptz,
            merged_into            uuid,
            -- written only by the coord leader reconciler tick (plan D9)
            last_verdict           jsonb,
            last_verdict_as_of     timestamptz,
            created_at             timestamptz  NOT NULL DEFAULT now(),
            updated_at             timestamptz  NOT NULL DEFAULT now(),
            closed_at              timestamptz,
            CONSTRAINT uq_subprojects_tenant_slug UNIQUE (tenant_id, slug),
            CONSTRAINT fk_subprojects_merged_into
                FOREIGN KEY (merged_into) REFERENCES coord.subprojects (id),
            CONSTRAINT ck_subprojects_title_source CHECK (title_source IN
                ('root_session', 'explicit')),
            CONSTRAINT ck_subprojects_origin CHECK (origin IN
                ('operator_prompt', 'autonomous', 'scheduled',
                 'orphan_continuation', 'operator_created', 'backfill')),
            CONSTRAINT ck_subprojects_status CHECK (status IN
                ('open', 'done', 'archived'))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.subproject_members (
            id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id            uuid         NOT NULL,
            subproject_id        uuid         NOT NULL,
            member_kind          text         NOT NULL,
            -- the harness session id first (plan D3), coord_session_id only
            -- for a placeholder-keyed pending row, allocation_agent_id for a
            -- spawn-pending one
            agent_session_id     uuid,
            coord_session_id     uuid,
            allocation_agent_id  uuid,
            work_unit_id         uuid,
            joined_via           text         NOT NULL,
            via_ref              text,
            via_session          uuid,
            snapshot             jsonb,
            snapshot_at          timestamptz,
            added_at             timestamptz  NOT NULL DEFAULT now(),
            added_by             text,
            -- NULL = a live membership
            removed_at           timestamptz,
            CONSTRAINT fk_subproject_members_subproject
                FOREIGN KEY (subproject_id) REFERENCES coord.subprojects (id),
            CONSTRAINT ck_subproject_members_member_kind CHECK (member_kind IN
                ('session', 'work_unit')),
            CONSTRAINT ck_subproject_members_joined_via CHECK (joined_via IN
                ('root', 'parent', 'gate_continuation', 'work_unit_dispatch',
                 'spawn', 'declared', 'operator_move', 'auto_attach',
                 'followup_edge', 'split', 'backfill', 'merge')),
            -- each member kind names its own key ...
            CONSTRAINT ck_subproject_members_work_unit_key CHECK (
                member_kind <> 'work_unit' OR work_unit_id IS NOT NULL),
            CONSTRAINT ck_subproject_members_session_key CHECK (
                member_kind <> 'session'
                OR agent_session_id IS NOT NULL
                OR coord_session_id IS NOT NULL
                OR allocation_agent_id IS NOT NULL),
            -- ... and only its own keys, so a session row cannot hold the
            -- live slot of a work unit, nor a work-unit row that of a session
            CONSTRAINT ck_subproject_members_no_work_unit_on_session CHECK (
                member_kind = 'work_unit' OR work_unit_id IS NULL),
            CONSTRAINT ck_subproject_members_no_session_key_on_work_unit CHECK (
                member_kind = 'session'
                OR (agent_session_id IS NULL
                    AND coord_session_id IS NULL
                    AND allocation_agent_id IS NULL))
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.subprojects IS
            'One row per subproject, a group of agent sessions, gates, work units '
            'and PRs pursuing one topic (plan '
            '2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled). '
            'Rows are written by coord only, and alembic authors the DDL. Health is '
            'computed by coord, never hand-written. last_verdict and '
            'last_verdict_as_of are written only by the leader reconciler tick, and '
            'NULL there reads as headline unknown. A merged subproject keeps its row, '
            'with merged_into naming the target.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.subproject_members IS
            'Durable membership ledger of coord.subprojects, one row per session or '
            'work unit member (plan '
            '2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled). '
            'A session member is keyed by its harness session id (agent_session_id). '
            'coord_session_id keys only a placeholder-keyed pending row and '
            'allocation_agent_id a spawn-pending row. removed_at NULL is a live '
            'membership, and each key is a live member of at most one subproject per '
            'tenant. snapshot keeps what dies with the pruned coord.sessions row. '
            'Gates and PRs are derived at read time, never stored here.'
        """
    )
    # Every index is built here, in the transaction that created its table, so
    # the tables and every unique that guards them commit together. Never
    # CONCURRENTLY: a cancelled concurrent build leaves an INVALID unique that
    # an IF NOT EXISTS retry keeps, and coord upserts then fail 42P10. coord's
    # migration classifier admits these builds as new-table claims.
    #
    # The list door's default read: a tenant's subprojects by status, most
    # recently changed first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_subprojects_tenant_status_updated
            ON coord.subprojects (tenant_id, status, updated_at DESC)
        """
    )
    # A subproject's live members, walked by every detail read and verdict.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_subproject_members_live_subproject
            ON coord.subproject_members (tenant_id, subproject_id)
            WHERE removed_at IS NULL
        """
    )
    # A subproject's whole ledger, removed members included: the detail page's
    # history read, which the live index above cannot serve.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_subproject_members_subproject_history
            ON coord.subproject_members (tenant_id, subproject_id, removed_at)
        """
    )
    # An agent session is a live member of at most one subproject.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_subproject_members_live_agent_session
            ON coord.subproject_members (tenant_id, agent_session_id)
            WHERE removed_at IS NULL AND agent_session_id IS NOT NULL
        """
    )
    # A work unit is a live member of at most one subproject.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_subproject_members_live_work_unit
            ON coord.subproject_members (tenant_id, work_unit_id)
            WHERE removed_at IS NULL AND work_unit_id IS NOT NULL
        """
    )
    # A spawn allocation keys at most one live (pending, then bound) row.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_subproject_members_live_allocation
            ON coord.subproject_members (tenant_id, allocation_agent_id)
            WHERE removed_at IS NULL AND allocation_agent_id IS NOT NULL
        """
    )
    # A placeholder coord.sessions id keys at most one live PENDING row;
    # binding the harness id onto the row releases it.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_subproject_members_live_pending_coord_session
            ON coord.subproject_members (tenant_id, coord_session_id)
            WHERE removed_at IS NULL AND agent_session_id IS NULL
              AND coord_session_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop the indexes, then ``coord.subproject_members``, then ``coord.subprojects``."""
    op.execute(
        "DROP INDEX IF EXISTS coord.uq_subproject_members_live_pending_coord_session"
    )
    op.execute("DROP INDEX IF EXISTS coord.uq_subproject_members_live_allocation")
    op.execute("DROP INDEX IF EXISTS coord.uq_subproject_members_live_work_unit")
    op.execute("DROP INDEX IF EXISTS coord.uq_subproject_members_live_agent_session")
    op.execute("DROP INDEX IF EXISTS coord.idx_subproject_members_subproject_history")
    op.execute("DROP INDEX IF EXISTS coord.idx_subproject_members_live_subproject")
    op.execute("DROP INDEX IF EXISTS coord.idx_subprojects_tenant_status_updated")
    op.execute("DROP TABLE IF EXISTS coord.subproject_members")
    op.execute("DROP TABLE IF EXISTS coord.subprojects")
