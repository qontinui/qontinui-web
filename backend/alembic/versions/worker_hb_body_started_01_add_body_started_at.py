"""coord.worker_heartbeats — add nullable ``body_started_at``

Revision ID: worker_hb_body_started_01
Revises: notif_gate_action_03_drop_enum_value
Create Date: 2026-09-20

Adds one nullable ``TIMESTAMPTZ`` column to ``coord.worker_heartbeats`` (created
in ``coord_agent_debug_01_outbound_worker_scheduler_webhook`` and, until this
revision, never altered since):

* ``body_started_at`` — when the replica that owns this row last ENTERED its
  loop body, cleared to NULL by the write that records the finished tick. Both
  sides carry an UNKNOWN and neither collapses: NULL is "no body in flight OR
  this row predates the column", and non-NULL is "a body started and no
  completion has been recorded since", which is a LIVE body only if the replica
  is still live. See "The rule for a reader" below — it is the normative form.

This is Phase 1 of plan
``qontinui-dev-notes/plans/2026-09-19-leader-gated-worker-liveness-reads-a-follower-skip-as-the-work-running.md``,
schema half only. The coord read/write paths land in a **separate PR** in the
coord repo; see "Deploy ordering" below, which is the load-bearing section.

Why this column exists
======================
``coord.worker_heartbeats`` is coord's worker-loop liveness ledger: one row per
``(name, replica_id)``, upserted by ``worker_ledger``'s tick wrapper. Every
column that reports an OUTCOME reports a tick that **finished** —
``last_tick_at``, ``last_outcome``, ``last_decision_code``, ``last_detail_code``,
``consecutive_errors``. (The other four — ``name``, ``replica_id``,
``leader_gated``, ``interval_secs`` — are identity and configuration and describe
no tick at all.) The ledger writes when a loop body RETURNS, and only then.

That makes two opposite states byte-identical in the ledger:

* A loop whose body is **still running**. The row is frozen at whatever the
  replica wrote before it entered the body, and grows stale at exactly the rate
  a dead loop's row does.
* A loop that is **gone** — wedged, panicked, or never scheduled again. The row
  is frozen for the same reason and looks the same.

The discrimination matters most on the leader arm, because a leader-gated worker
only runs its body on one replica. A follower keeps the row fresh by writing
``last_outcome = 'follower_skip'`` — a healthy state, classified
``NotLeaderHere`` — so the fleet-wide rollup can read "somebody answered
recently" while the work itself has not run at all.

This has a dated cost. On 2026-09-19 a lease handoff put replica ``d918893e`` in
the leader role at 21:24:57Z and its FIRST body as leader did not return for
~13 minutes. Per-replica ``/health`` at ~21:38Z read
``work_unit_derive.sweep`` at 784 s on the leader and 42 s on a follower, while
``coord_query_workers`` in the same minute rendered ``last_tick_secs_ago`` of
15–20 s — the follower's ``follower_skip``. The merge train made no leader
decision for 30+ minutes across that handoff. An investigating session read the
fresh follower row, called the alert a false alarm, and posted that; it was not
a false alarm. Neither the ledger nor ``/health`` could say "a body has been
running since T", so "in flight" and "dead" were unaskable.

``body_started_at`` makes that question answerable: a non-NULL value older than
2x the worker's ``interval_secs`` is a positive observation — *"a body started at
T and no completion has been recorded since"* — distinct from both "dead" and
"not leader here". Read beside ``coord.replica_presence`` it separates further,
into a live body still in flight and an ORPHANED start left by a replica that
died mid-body; the four-way reader rule below is the normative form, and this
sentence is only its motivation. The row alone does not settle which, because
the clearing write never runs for a replica that was killed.

Write protocol — set before the body, cleared when the tick is written
=====================================================================
Recorded here because the column's meaning is entirely a property of this
protocol, and the protocol lives in the other repo:

* On the **leader arm** of ``run_ticking_with_decision`` — the single tick loop
  in ``worker_ledger`` (``run_ticking`` is a thin adapter over it, so there is
  exactly ONE site to instrument, not two) — ``body_started_at`` is set to
  ``now()`` immediately **before** the body is awaited.
* When that body returns and the completed tick is upserted, the same write
  **clears the column to NULL**. A settled row therefore carries NULL, which is
  what makes non-NULL the positive half of the reading.

  Read that half precisely, because it has an UNKNOWN of its own and the
  symmetry matters: non-NULL says a body **STARTED at T and no completion has
  been recorded since**. That is "in flight" only while the replica is still
  alive. A replica killed mid-body — a deploy roll, an OOM, the wedge this
  column exists to observe — never runs the clearing write, and **nothing prunes
  this table**, so its row carries a non-NULL ``body_started_at`` permanently.
  With ~1000 departed replicas fleet-wide that is not an edge case; it is the
  expected residue of every deploy that kills a leader mid-body. Replica
  liveness is a SEPARATE fact, already carried by ``coord.replica_presence``
  (``replpres_01``, joined on the shared ``replica_id`` — which is ``uuid``
  there and ``text`` here, so the join needs an explicit
  ``h.replica_id::uuid`` and a bare ``ON p.replica_id = h.replica_id`` fails
  with ``operator does not exist: uuid = text``). This column does not
  supply it and must not be read as if it did — rendering a four-day-old orphan
  as "in flight for 4 days" is the same collapse this docstring forbids on the
  NULL side.
* The start write bypasses the ledger's ``THROTTLE_FLOOR`` (it is a transition,
  not steady state) but happens only on the leader arm, so the added volume is
  one extra write per leader body — not per iteration, and nothing at all on a
  follower.

``NULL`` means **"no body in flight, OR this row predates the column"**
======================================================================
Both readings live in the same absence, and no reader can separate them from the
value alone. That is a statement of *unknown*, and it must be rendered as such.

In particular a NULL ``body_started_at`` must **never** be displayed,
aggregated, or reasoned about as "not in flight". "Not in flight" is a positive
claim — it asserts that the replica wrote a settled tick — and every row written
before this migration asserts nothing of the kind. Collapsing unknown into a
decided state here re-creates, inside the very column added to remove it, the
2026-09-19 ambiguity: a stale row with NULL would read as "the loop is gone"
when the honest answer is "this build does not report body starts".

The rule for a reader is therefore FOUR-way, not two — and the non-NULL side
carries an UNKNOWN of its own, exactly as the NULL side does:

``NULL`` + fresh ``last_tick_at``
    Nothing to say; the worker is ticking and the column adds no information.
``NULL`` + stale ``last_tick_at``
    UNKNOWN on the new axis. It is either the pre-existing ``dead`` reading or a
    replica whose build does not write the column. Report the age, and say which
    of the two the evidence supports rather than picking one silently.
non-NULL, older than 2x ``interval_secs``, replica LIVE in ``coord.replica_presence``
    In flight for N s. Status stays ``stale``/``dead`` by age — a bounded long
    body is still a long body, and past a per-worker ceiling it is still a fault
    — but the *reason* is now ``body_in_flight`` rather than an unexplained
    silence.
non-NULL, replica ABSENT or stale in ``coord.replica_presence``
    An **orphaned start**, not a long body: the replica died mid-body and never
    ran the clearing write. Report it as a departed replica, never as "in flight
    for N". Nothing prunes this table, so these rows persist indefinitely and are
    the expected residue of every deploy that kills a leader mid-body — they are
    the common case, not a corner. Reading one as a live long body would
    manufacture a wedge that ended days ago, which is the same collapse the NULL
    arms above refuse.

Why nullable, with no default
=============================
``coord.worker_heartbeats`` is upserted continuously: coord runs ~110 background
loops, each writing per ``(name, replica_id)`` on an outcome transition or once
per throttle floor, against a PG pool with a documented exhaustion incident. A
nullable column with **no server_default** makes this a catalog-only
``ADD COLUMN``: PostgreSQL records the attribute and returns, with no table
rewrite and no per-row work. A default (even a constant) or ``NOT NULL`` would
turn this into an operation that touches every row and holds ACCESS EXCLUSIVE
while it does — exactly what must not happen on a table the merge scheduler
writes on every tick.

Nullability is also semantically correct rather than a performance dodge. NULL
is the column's **steady state**, not a gap in the data: a settled row genuinely
has no body in flight, and the write protocol above stores NULL to say so. A
follower's row is NULL for the whole time it is a follower. The migration adds a
column whose correct value, for the overwhelming majority of rows at any instant,
is precisely NULL.

No ``CHECK`` constraint is declared. There is no closed vocabulary to constrain —
the value is a timestamp — and the one invariant worth stating ("not in the
future") cannot be expressed as a ``CHECK`` **at all**: PostgreSQL refuses a
non-``IMMUTABLE`` function there, so ``CHECK (body_started_at <= now())`` is
rejected outright rather than being a cost trade-off. The protocol, not the
catalog, is what keeps the column honest — and the protocol writes the SERVER's
``now()``, exactly as ``last_tick_at`` already does (``worker_ledger.rs:469``
passes ``now()`` in the SQL, never as a bound parameter), so **no replica's clock
enters this column**. That is deliberate: the sibling table states the rule
outright — ``replpres_01`` documents ``heartbeat_at`` as *"Written with the
SERVER's now() so a replica with a skewed clock cannot forge freshness."*

Deploy ordering — the coord side lands SEPARATELY, and AFTER this
=================================================================
alembic in ``qontinui-web`` is the sole author of ``coord.*`` schema; coord's
Rust authors zero production ``coord.*`` DDL (served policy
``production-and-cost`` ``alembic-sole-authorship``). So this migration must
merge, deploy, and be **verified present in prod** before any coord code reads
or writes ``body_started_at``. The coord half is deliberately not in this PR, and
is labelled ``coord:downstream-of`` it.

State the failure mode precisely, because the ledger's existing pre-migration
tolerance does **not** cover it. ``worker_ledger`` already degrades quietly on a
missing TABLE — ``pg_error::is_missing_table_error``, PG ``42P01
undefined_table`` — because a coord build can go live before the migration that
provisions the table. A missing COLUMN is a different SQLSTATE (``42703
undefined_column``) and that helper does not match it. Every ledger error is
additionally swallowed at ``debug``/``warn`` by design ("observability must
never be a gate"), so a coord half deployed ahead of this migration would not
fail loudly: the upsert would name a column that does not exist and fail on
**every** tick, for **every** worker, and ``coord.worker_heartbeats`` would
simply stop being updated.

The blast radius is total loss of worker-loop liveness, degrading silently. The
loops keep running correctly; coord merely stops recording that they did, and
the first symptom is an operator finding a frozen ledger during the next
incident — i.e. exactly when it is needed. Note the irony to be avoided:
shipping the coord half early would destroy the observability this column was
added to provide, and would do it in the same shape as the incident above.

This is the 2026-07-13 missing-column incident class (coord reading a ``coord.*``
column that exists locally but not in prod: green in every local test, broken
against the live database).

The coord half's own obligations, recorded here so they sit where the next person
will look, but **not this PR's work** — do not edit the coord repo from a
qontinui-web migration PR:

* Tolerate the column being absent on the read path (the
  ``schema_read_contract::KNOWN_MISSING`` pattern, with
  ``pg_error::is_missing_column_error`` for the 42703 above), then drop the
  waiver once the migrator digest moves.
* Mirror the column in coord's DB-gated test bootstrap. That provisions its
  schema with a ``CREATE TABLE IF NOT EXISTS coord.worker_heartbeats`` block,
  which is a no-op against an already-existing container table — so a
  **pre-existing** test container never gains a newly-added column and the tests
  fail, or worse self-skip and report green, for a reason unrelated to the change
  under test. The established fix is an explicit follow-on
  ``ADD COLUMN IF NOT EXISTS`` ALTER beside the ``CREATE TABLE``; the
  ``scheduler_ticks`` columns are mirrored that way today for exactly this
  reason. Verified against coord ``origin/main`` on 2026-09-20 there is exactly
  **one** such block for this table (``crates/coord/src/mcp/tools.rs``), unlike
  ``coord.scheduler_ticks``, which has two that have already drifted — so this
  column has one site to keep in step, and that count is worth re-checking rather
  than trusting, because a second block appearing is precisely how the
  ``scheduler_ticks`` drift happened.

No ``tenant_id``
================
``coord.worker_heartbeats`` is one of the four **fleet-global** agent-debug
tables (alongside ``outbound_budget_observations``, ``scheduler_ticks`` and
``webhook_pulse``): they observe coord's own infrastructure, not per-tenant
state, and carry no ``tenant_id`` by design. It is correspondingly **not** in
the seven-table scoped set that ``coord_tenant_id_not_null`` locks to
``NOT NULL`` (``devices``, ``plans``, ``agent_worktrees``, ``agent_questions``,
``agent_logs``, ``memories``, ``primary_trees``). This migration keeps that
posture and introduces no tenant column.

No new index — reasoning
========================
Deliberately none. The table's whole working set is small by construction: one
row per ``(name, replica_id)``, read by ``load_rows``' unfiltered SELECT and
written by an upsert keyed on the existing
``worker_heartbeats_name_replica_id_uq`` constraint. ``body_started_at`` is
**projected**, never a filter that narrows anything the reader was not already
going to load. An index on it would be pure write amplification on a
continuously-upserted table, bought for a query nobody issues.

The condition that would change this answer, recorded so it can be checked rather
than guessed: the row population here is unbounded in one direction — departed
replicas are never pruned, and the busiest worker already carries ~700 rows
against ~1000 departed replicas fleet-wide. If ledger hygiene stays unfixed long
enough that ``load_rows`` stops being a cheap full read, the fix is pruning
departed rows, not indexing this column. Revisit on measured evidence, not now.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "worker_hb_body_started_01"
down_revision: str | Sequence[str] | None = "notif_gate_action_03_drop_enum_value"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Bound the DDL's lock wait. ADD COLUMN takes ACCESS EXCLUSIVE, and while
    # the add itself is catalog-only (nullable, no default) and therefore
    # instantaneous, a *queued* ACCESS EXCLUSIVE request blocks every reader and
    # writer that arrives behind it. On a ledger that ~110 worker loops upsert
    # into that is the difference between a no-op and a stall. Fail fast instead
    # of queueing behind one slow in-flight statement; a timeout here is a
    # retry, not a data problem.
    op.execute("SET LOCAL lock_timeout = '3s'")

    # Nullable with no server_default -> metadata-only; never rewritten.
    # When the replica owning this row entered its loop body. Set on the leader
    # arm before the body is awaited, cleared to NULL when the finished tick is
    # written. NEITHER side may be collapsed, and the module docstring's
    # four-way reader rule is the normative form: non-NULL means "a body started
    # and no completion has been recorded since" — "in flight" only while the
    # replica is live in coord.replica_presence, otherwise an orphaned start
    # from a replica killed mid-body — and NULL means "no body in flight OR this
    # row predates the column", never "not in flight".
    # ``IF NOT EXISTS`` rather than ``op.add_column``: 16 of the last 40
    # revisions here use the raw idempotent form and 4 use the ORM helper, and
    # four of those sixteen pair it with this same lock guard, so the two
    # properties do not trade off. What it buys is recovery — a partially
    # applied pipeline (``alembic stamp`` back, re-upgrade) re-runs cleanly
    # instead of failing on an already-present column. Schema-qualified, so
    # ``check_alembic_schema_args.py`` is satisfied by the SQL itself.
    op.execute(
        "ALTER TABLE coord.worker_heartbeats "
        "ADD COLUMN IF NOT EXISTS body_started_at TIMESTAMPTZ NULL"
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.worker_heartbeats DROP COLUMN IF EXISTS body_started_at"
    )
