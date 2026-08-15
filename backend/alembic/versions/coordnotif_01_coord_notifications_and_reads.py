"""coord.notifications + coord.notification_reads — append-only event log with per-principal read state

Revision ID: coordnotif_01
Revises: probe_base_01
Create Date: 2026-08-15

Change 1 (storage) of plan
``D:/qontinui-root/plans/2026-08-05-coord-notifications-type-and-tab.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
storage for coord's notifications surface lands here, in qontinui-web, and must
merge and be **applied in prod** BEFORE the coord PR that reads or writes it
(plan Acceptance 8). Confirm with ``coord_query_migration_state`` between the
two lands; do not compress them into one deploy window.

Why a second type at all
========================

``coord.alerts`` models a condition that is true **now**: fire → persist →
resolve, one row per condition, deduped. It answers *what is wrong right now?*
An awful lot of what the fleet pushes through it is not that. On 2026-08-05 the
alerts surface was measured at its hard 500-row cap with ``stale_primary_tree``
(349) and ``stale_wip`` (151) — *facts being re-asserted* ("this worktree has
been dirty for 805 hours") modelled as conditions. Nothing ever resolves them,
so they accumulate and crowd out every other kind.

These two tables are the other type: an **occurrence log**. Append-only, one
row per occurrence, never resolved, read/unread per reader, retention-bounded.
It answers *what happened while I was away?* Separate storage rather than a
``type`` column on ``coord.alerts`` is the point — sharing storage means the
first chatty event class re-creates the drowning problem, and every consumer
must then re-derive "condition or event?" from the kind string.

--------------------------------------------------------------------------------
1. ``coord.notifications`` — the occurrence log
--------------------------------------------------------------------------------

* ``notification_id`` — UUID PK, ``gen_random_uuid()`` server default, so a
  producer never has to mint one.
* ``tenant_id``       — UUID NOT NULL. Every list read is tenant-scoped; unlike
                        ``coord.device_resource_samples`` there is no
                        pre-tenant-resolution push path here (producers are
                        coord subsystems that already hold a tenant), so this
                        is NOT NULL rather than nullable. No FK to
                        ``coord.tenants``, matching the rest of the coord
                        observation surface.
* ``kind``            — TEXT NOT NULL. The producer's event class. Deliberately
                        **not** CHECK-constrained: the closed set lives in
                        Rust, as ``NotificationKind``, whose exhaustive
                        ``render()`` match is what makes a kind without a
                        human-readable rendering fail to COMPILE (plan Change 2
                        / Acceptance 6). A CHECK here would force a migration
                        per new kind and would duplicate — badly, and one deploy
                        behind — an invariant the type system already enforces.
* ``occurred_at``     — TIMESTAMPTZ NOT NULL DEFAULT now(). The ingest clock,
                        stamped server-side. Also the retention age column and
                        the leading sort key of the keyset cursor.
* ``summary``         — TEXT NOT NULL. The **pre-rendered** human-readable line,
                        written at emit time. Storing the rendered line rather
                        than re-deriving it in every consumer is what lets the
                        tab satisfy "a reviewer can scan it and say what
                        happened" (Acceptance 3) without the frontend owning a
                        copy of the kind vocabulary — and it keeps historical
                        rows readable after a renderer changes.
* ``detail``          — JSONB NOT NULL DEFAULT ``'{}'``. The structured payload
                        behind the expandable row. NOT NULL with a default, so
                        consumers never branch on NULL-vs-empty.
* ``repo``            — TEXT NULL, human-readable.
* ``pr_number``       — INTEGER NULL.
* ``actor``           — TEXT NULL, human-readable.
* ``device_id``       — UUID NULL. No FK: a notification is a historical fact
                        and must outlive the device it mentions. ``ON DELETE
                        CASCADE`` would silently delete history when a device is
                        reaped, and ``RESTRICT`` would block the reap.

``repo`` / ``pr_number`` / ``actor`` are first-class columns rather than
``detail`` keys because they are the identity fields the UI renders **and** the
ones a human filters on. ``device_id`` is the one identifier that is a UUID, and
it is exactly why it is a column and not part of ``summary``: the default view
must render no UUID (Acceptance 3).

Indexes (three, one per access pattern, and nothing else):

1. ``ix_notifications_tenant_keyset`` — ``(tenant_id, occurred_at DESC,
   notification_id DESC)``. Backs the **keyset** pagination the list route
   requires. The DESC ordering is load-bearing and must not be dropped to
   "simplify": the cursor predicate is

       WHERE tenant_id = $1
         AND (occurred_at, notification_id) < ($2, $3)
       ORDER BY occurred_at DESC, notification_id DESC
       LIMIT $4

   and only a matching DESC index turns that into one descent plus a forward
   read. ``notification_id`` is the tiebreaker that makes the row order a total
   order — without it, two rows sharing an ``occurred_at`` can be returned on
   both sides of a page boundary or on neither.

   Keyset, not ``OFFSET``: this table is appended to continuously, and
   ``OFFSET`` on a table gaining rows at the head skips and duplicates rows
   between pages under concurrent inserts. That fails "paging returns disjoint
   pages covering the set" (Acceptance 2) *non-deterministically*, which is
   worse than failing it outright.

2. ``ix_notifications_occurred_at`` — ``(occurred_at)``. **Required by the
   retention sweep**, and not optional. ``crates/coord/src/table_retention.rs``
   deletes in batches shaped ``DELETE ... WHERE pk IN (SELECT pk FROM t WHERE
   <age_col> < $cutoff LIMIT 5000)``; that inner subquery seq-scans without an
   index on the age column, and the batching exists precisely to stay under
   coord's 60s ``statement_timeout``. Index 1 cannot serve it — ``occurred_at``
   is its *second* column behind an equality on ``tenant_id``, and the sweep is
   fleet-wide, not per-tenant.

3. ``ix_notifications_tenant_kind`` — ``(tenant_id, kind, occurred_at DESC,
   notification_id DESC)``. Backs the kind filter on the list route, and it
   carries the ordering columns for the same reason index 1 does. A
   kind-filtered page is still a keyset page:

       WHERE tenant_id = $1 AND kind = $2
         AND (occurred_at, notification_id) < ($3, $4)
       ORDER BY occurred_at DESC, notification_id DESC
       LIMIT $5

   A bare ``(tenant_id, kind)`` serves the two equalities and then leaves the
   planner to either sort every matching row or fall back to index 1 and filter
   ``kind`` on the fly — precisely the cost the index was added to avoid. With
   the sort columns appended, the two equalities pick the sub-tree and the DESC
   ordering is read straight off it: one descent, one forward read, no sort
   node. The four-column form **fully subsumes** the two-column one (same
   leading pair), so this is not an extra index — it is the same index carrying
   the columns the query actually needs, and it costs nothing to get right
   before the table has rows.

--------------------------------------------------------------------------------
2. ``coord.notification_reads`` — per-principal read state
--------------------------------------------------------------------------------

A **join table**, not a ``read_at`` column on ``coord.notifications``. A tenant
is multi-operator by construction (the manifest carries
``operator_membership_sync`` and ``group_tenant_roles``), so a single column
would let the first operator to open the tab mark every event read for everyone
else in the tenant. That does not merely lose precision — it answers a
different, weaker question: "what happened since *anyone* last looked", where
the surface exists to answer "what happened while **I** was away".

* ``notification_id`` — UUID NOT NULL, FK → ``coord.notifications`` **ON DELETE
                        CASCADE**. This is load-bearing: it is how read-state is
                        pruned along with its parent rows by the single
                        retention sweep registered on ``coord.notifications``.
                        Without it the sweep would either fail on the FK or
                        leave orphaned read rows accumulating forever — the
                        accumulation bug this plan exists to fix, one table down.
* ``actor_key``       — TEXT NOT NULL. ``FleetPrincipal::principal_label()``,
                        i.e. ``operator:<uuid>`` or ``device:<uuid>``. TEXT
                        rather than a UUID column plus a discriminator because
                        the principal namespace is the union of two id spaces
                        and the label is the form the extractor already hands
                        out; splitting it here would mean re-parsing it on
                        every read.
* ``read_at``         — TIMESTAMPTZ NOT NULL DEFAULT now().

PK ``(notification_id, actor_key)`` — one read-mark per (event, reader), and the
uniqueness that makes mark-read idempotent. Mark-read is
``INSERT ... ON CONFLICT (notification_id, actor_key) DO NOTHING``: first read
wins and re-marking never moves the timestamp.

⚠️ Do **not** carry over ``session_messages.rs:859``'s
``DO UPDATE SET read_at = COALESCE(<table>.read_at, now())``. That idiom is
correct *there* because ``session_messages.read_at`` is NULLABLE, so the
COALESCE is what implements first-read-wins over a row that already exists with
a NULL. Here ``read_at`` is ``NOT NULL DEFAULT now()``, so the existing value is
never NULL, the ``now()`` arm is unreachable, and the whole ``DO UPDATE``
degrades to writing the value back to itself — the right behaviour reached by
accident, at the cost of a dead row version per re-mark and a reader who has to
work out that the COALESCE is decorative. ``DO NOTHING`` says the same thing and
means it.

Index ``ix_notification_reads_actor`` on ``(actor_key)``: the PK's leading
column is ``notification_id``, so the "everything this principal has read" and
per-principal unread-count paths cannot use it.

--------------------------------------------------------------------------------
Retention
--------------------------------------------------------------------------------

Bounded from day one — an append-only table with no retention is the same
accumulation bug one layer down. Time-based, registered in
``crates/coord/src/table_retention.rs`` (leader-gated, 6-hour cadence, batched
deletes, ``COORD_NOTIFICATIONS_RETENTION_DAYS`` with ``0`` = disabled). That
registration is coord-side work; what binds *this* revision is its documented
precondition, satisfied by index 2 above. Do **not** write a new prune worker,
and do not prune ``notification_reads`` separately — the FK cascade does it.

--------------------------------------------------------------------------------
Ordering and the boot gate
--------------------------------------------------------------------------------

Both tables must be added to ``schema_manifest::ALEMBIC_OWNED_TABLES`` and must
**NOT** be added to ``CRITICAL_BOOT_TABLES``: a new table in the latter before
its migration deploys makes coord un-bootable — a full outage rather than a
degraded route (the 2026-07-06 ``DROP TABLE coord.plans`` wedge). Best-effort
manifest entries degrade to ``503 schema_migration_pending`` automatically via
``crates/coord/src/schema_readiness.rs``. The coord read must degrade through
``pg_error::is_missing_schema_object`` (42P01 ∪ 42703), not a table-only
predicate.

No ``coord:stacked-on`` / ``coord:upstream-of`` label is needed for that
ordering: coord derives migration ordering from the ``down_revision`` chain, not
from PR labels.

Downgrade drops the child table first, then the parent, so the drop order is
independent of whether the FK is deferred, and every drop is ``IF EXISTS`` so a
partially-applied upgrade can still be unwound.

Idempotency: raw ``op.execute`` with ``CREATE TABLE / INDEX IF NOT EXISTS`` —
the house convention for coord tables (``fleet_res_tel_01``,
``twin_git_02_coord_git_write_ledger``, ``coord_sesscompl_01``,
``coord_prompt_docs_01``, ``coord_policy_clauses_01``). A re-apply against a
partially-migrated database is then a no-op rather than an abort, which this
fleet has actually needed. The typed ``op.create_table`` form would give
autogenerate round-tripping instead, and that is worth nothing here: this repo
bans ``alembic revision --autogenerate`` outright, which is exactly why every
revision is hand-authored.

Every identifier below is schema-qualified (``coord.notifications``,
``coord.notification_reads``) — the pre-commit gate
``.pre-commit-hooks/check_alembic_schema_args.py`` audits raw SQL inside
``op.execute`` for CREATE / ALTER / DROP TABLE, ``CREATE INDEX ... ON`` and
``REFERENCES`` and fails on an unqualified one.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coordnotif_01"
down_revision: str | Sequence[str] | None = "probe_base_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.notifications, coord.notification_reads and their indexes."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.notifications (
            notification_id UUID        NOT NULL DEFAULT gen_random_uuid(),
            tenant_id       UUID        NOT NULL,
            -- Closed set owned by Rust's NotificationKind, NOT by a CHECK here.
            kind            TEXT        NOT NULL,
            -- Ingest clock, retention age column, leading keyset sort key.
            occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- Pre-rendered at emit time. Never a UUID: the tab renders it verbatim.
            summary         TEXT        NOT NULL,
            -- NOT NULL + default so consumers never branch on NULL-vs-empty.
            detail          JSONB       NOT NULL DEFAULT '{}'::jsonb,
            repo            TEXT,
            pr_number       INTEGER,
            actor           TEXT,
            -- No FK on purpose: a notification is a historical fact and must
            -- outlive the device it mentions.
            device_id       UUID,
            PRIMARY KEY (notification_id)
        )
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.notifications.kind IS
            'Producer event class. Deliberately not CHECK-constrained — the '
            'closed set lives in Rust as NotificationKind, whose exhaustive '
            'render() match makes a kind without a human-readable rendering '
            'fail to compile. A CHECK here would force a migration per new '
            'kind and would sit one deploy behind the enum.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.notifications.occurred_at IS
            'Ingest clock, stamped server-side. Retention age column and the '
            'leading sort key of the keyset cursor.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.notifications.summary IS
            'Pre-rendered human-readable line, written at emit time. Must '
            'never contain a UUID — the default view renders this verbatim.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.notifications.device_id IS
            'No FK on purpose: a notification is a historical fact and must '
            'outlive the device it mentions. ON DELETE CASCADE would silently '
            'delete history when a device is reaped; RESTRICT would block the '
            'reap.'
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.notifications IS
            'Append-only occurrence log — one row per event that HAPPENED, '
            'never resolved and never updated in place. This is the type '
            'coord.alerts is not: alerts model a condition true NOW and are '
            'deduped and resolved; these are events, retained on a time bound '
            'and marked read per principal via coord.notification_reads. Do '
            'not add a resolved_at column, and do not merge this into '
            'coord.alerts — sharing storage is what lets one chatty event '
            'class drown every other kind (measured 2026-08-05: 500/500 '
            'alerts, 349 stale_primary_tree + 151 stale_wip). The only DELETE '
            'is the time-based retention sweep in table_retention.rs.'
        """
    )

    # 1. Keyset pagination. DESC on BOTH trailing columns is load-bearing —
    #    the list route orders by (occurred_at DESC, notification_id DESC) and
    #    seeks with a row-value comparison; notification_id is the tiebreaker
    #    that makes the order total, so rows sharing an occurred_at cannot land
    #    on both sides of a page boundary or on neither.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_notifications_tenant_keyset
            ON coord.notifications (tenant_id, occurred_at DESC, notification_id DESC)
        """
    )
    # 2. Retention sweep (crates/coord/src/table_retention.rs). REQUIRED: its
    #    batched `WHERE occurred_at < $cutoff LIMIT n` subquery seq-scans
    #    without this. Index 1 cannot serve it — occurred_at sits behind an
    #    equality on tenant_id there, and the sweep is fleet-wide.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_notifications_occurred_at
            ON coord.notifications (occurred_at)
        """
    )
    # 3. The kind filter on the list route — WITH the ordering columns. A
    #    kind-filtered page is still a keyset page, so `(tenant_id, kind)`
    #    alone serves the equalities and then forces a sort (or a fallback to
    #    index 1 with an on-the-fly kind filter), which is the cost this index
    #    exists to avoid. The four-column form subsumes the two-column one.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_notifications_tenant_kind
            ON coord.notifications
               (tenant_id, kind, occurred_at DESC, notification_id DESC)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.notification_reads (
            notification_id UUID        NOT NULL,
            -- FleetPrincipal::principal_label(): operator:<uuid> | device:<uuid>.
            actor_key       TEXT        NOT NULL,
            read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- One read-mark per (event, reader); the uniqueness that makes
            -- mark-read idempotent.
            PRIMARY KEY (notification_id, actor_key),
            -- ON DELETE CASCADE is LOAD-BEARING: it is how the retention sweep
            -- on the parent prunes read-state. Named so a later change can
            -- DROP CONSTRAINT <name> rather than hunt a generated one.
            CONSTRAINT fk_notification_reads_notification_id
                FOREIGN KEY (notification_id)
                REFERENCES coord.notifications (notification_id)
                ON DELETE CASCADE
        )
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.notification_reads.actor_key IS
            'FleetPrincipal::principal_label() — ''operator:<uuid>'' or '
            '''device:<uuid>''. TEXT rather than a UUID column plus a '
            'discriminator because the principal namespace is the union of two '
            'id spaces and the label is the form the extractor already hands '
            'out.'
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.notification_reads IS
            'Per-principal read state for coord.notifications. A join table '
            'rather than a read_at column on the parent because a tenant is '
            'multi-operator: one shared column would let the first operator to '
            'open the tab mark every event read for everyone else, answering '
            '"what happened since anyone last looked" instead of "what '
            'happened while I was away". actor_key is '
            'FleetPrincipal::principal_label(). The FK is ON DELETE CASCADE '
            'and that is load-bearing — it is how the retention sweep on the '
            'parent prunes read-state; never prune this table separately. '
            'Mark-read is idempotent: INSERT ... ON CONFLICT '
            '(notification_id, actor_key) DO NOTHING, so first read wins and '
            're-marking never moves the timestamp. Do NOT copy the '
            'session_messages.rs idiom (DO UPDATE SET read_at = '
            'COALESCE(read_at, now())) here: that COALESCE implements '
            'first-read-wins only because the '
            'column is NULLABLE there. read_at is NOT NULL here, so the '
            'now() arm is unreachable and the UPDATE only rewrites the value '
            'to itself.'
        """
    )

    # The PK leads with notification_id, so "everything this principal has
    # read" / the per-principal unread count cannot use it.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_notification_reads_actor
            ON coord.notification_reads (actor_key)
        """
    )


def downgrade() -> None:
    """Drop both tables. Child first, then parent; reverse order of upgrade().

    Every statement is ``IF EXISTS`` so a downgrade over a partially-applied
    upgrade unwinds rather than aborting — the mirror of the upgrade's
    ``IF NOT EXISTS`` posture.

    Dropping ``coord.notification_reads`` first makes the order independent of
    the FK: the parent's ``DROP TABLE`` would otherwise need ``CASCADE`` (which
    would silently drop anything else referencing it) or would fail outright.
    """
    op.execute("DROP INDEX IF EXISTS coord.ix_notification_reads_actor")
    op.execute("DROP TABLE IF EXISTS coord.notification_reads")

    op.execute("DROP INDEX IF EXISTS coord.ix_notifications_tenant_kind")
    op.execute("DROP INDEX IF EXISTS coord.ix_notifications_occurred_at")
    op.execute("DROP INDEX IF EXISTS coord.ix_notifications_tenant_keyset")
    op.execute("DROP TABLE IF EXISTS coord.notifications")
