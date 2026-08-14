"""coord.scheduler_ticks — add nullable ``probed_sha`` and ``probe_result``

Revision ID: scheduler_ticks_probe_01
Revises: sess_guard_01
Create Date: 2026-08-14

Adds two nullable ``TEXT`` columns to ``coord.scheduler_ticks`` (created in
``coord_agent_debug_01_outbound_worker_scheduler_webhook``, widened once
already by ``scheduler_ticks_proposal_id_01``):

* ``probed_sha``    — the sha the CI probe actually asked GitHub about.
* ``probe_result``  — a closed vocabulary classifying that probe's outcome.

Read ``scheduler_ticks_proposal_id_01``'s docstring first. It is the same table,
the same shape and the same constraints, and everything it argues about
nullability, catalog-only ``ADD COLUMN``, ``lock_timeout``, the absence of a
``tenant_id`` and the deploy-ordering rule applies here verbatim. The sections
below restate those points deliberately, because each of them is load-bearing
for THESE columns specifically — in particular the deploy-ordering failure mode,
which for this pair is materially worse than it was for ``proposal_id``.

Why these two columns exist
===========================
``coord.scheduler_ticks`` is coord's merge-decision trace: one row per scheduler
tick, recording what the scheduler saw and what it decided. A row carrying
``decision_code = 'waiting_ci'`` today says *that* the scheduler waited and
nothing whatsoever about *what it waited on*.

That gap has a dated cost. On 2026-07-31 the trace produced 62 consecutive
identical ``waiting_ci`` rows with every discriminating field NULL, and an
operator reading them could not separate the two states those rows conflate:

* CI is legitimately running on a real sha — the scheduler is correct to wait,
  and the right action is to keep waiting. This is normal operation.
* coord is asking GitHub about a sha that does not exist — nothing will ever
  report against it, so the wait never terminates. On 2026-07-31 that was an
  11-hour livelock.

Those two states are indistinguishable in the trace and opposite in what they
require of the operator. ``probed_sha`` and ``probe_result`` make the
discrimination readable directly off the row: the first names the sha the probe
was pointed at, the second says how that probe read.

Who reads them
==============
* **Write path** — coord's ``scheduler_trace`` recorder, which composes the tick
  row at the end of each scheduler iteration and INSERTs it.
* **Read path** — coord's ``coord_query_scheduler_trace`` twin, which serves the
  trace to operators and agents newest-first for a repo.

Both halves live in the coord repo and land in a **separate PR**. This revision
is the schema half only; see "Deploy ordering" below, which is not a stylistic
preference but the thing that keeps the trace alive.

``probe_result`` vocabulary
===========================
The coord half writes exactly the following strings. They are recorded here so a
reader of the schema — or of a trace dump — knows what the values mean without
having to go read Rust:

``in_flight``
    A check run for ``probed_sha`` exists and is still running. Waiting is
    correct; the probe found live work.
``pending``
    A check run for ``probed_sha`` exists and is queued but not yet started.
    Also a legitimate wait.
``absent``
    GitHub reports **no** check runs for ``probed_sha`` at all. This is the
    livelock signature: coord is waiting on a sha nothing will ever report
    against. Distinguishing this value from ``in_flight``/``pending`` is the
    entire reason these columns exist.
``saturated``
    The CI concurrency budget is exhausted, so the probe could not be issued or
    its result is not actionable this tick. The wait is real but the cause is
    coord-side capacity, not GitHub.
``push_needed``
    The candidate ref has not been pushed yet, so there is nothing for CI to
    have started on. A wait that resolves by coord acting, not by CI finishing.
``read_error``
    The probe itself failed — transport error, rate limit, unexpected response.
    The tick learned nothing about CI state; the value records the ignorance
    rather than hiding it behind a state that looks decided.
``no_tip``
    No tip sha could be resolved for the candidate, so there was nothing to
    probe. ``probed_sha`` is NULL on such rows.

``NULL``
    Means **"this tick predates the column, or the outcome could not be
    classified."** It is an explicit statement of *unknown*, and readers must
    render it as such. In particular a NULL ``probe_result`` must **never** be
    displayed or aggregated as ``pending``: ``pending`` asserts that a queued
    check run was observed, which is precisely what a NULL row did not observe.
    Collapsing unknown into a decided state re-creates the 2026-07-31 ambiguity
    inside the very columns added to remove it.

No ``CHECK`` constraint is declared on ``probe_result``. This matches
``decision_code`` on the same table, which carries an open-ended
``tick_error:<class>`` member and is deliberately unconstrained for that reason.
The vocabulary above is expected to grow as the probe learns to distinguish more
outcomes, and a ``CHECK`` would make each such addition a migration on a
high-write table — coupling coord's classification vocabulary to qontinui-web's
deploy cadence for no integrity benefit on a trace table nothing joins against.

Why nullable, with no default
=============================
``coord.scheduler_ticks`` is **append-per-tick on a ~48h retention ring** — a
high-write table whose rows are continuously inserted by the merge scheduler and
continuously pruned by retention. Nullable columns with **no default** make this
a catalog-only ``ADD COLUMN``: PostgreSQL records the attributes and returns,
with no table rewrite and no per-row work. Attaching a default (even a constant)
or ``NOT NULL`` would turn this into an operation that touches every row, which
is exactly what must not happen here.

Nullability is also semantically correct, not merely a performance dodge. Every
row written before this migration legitimately has no probe fields, and so will
every row afterwards whose decision was not reached by probing CI:
``no_ready_prs`` (the queue was empty), ``landed``, ``lease_held``,
``budget_backoff`` and ``tick_error:*`` are all outcomes with no probe attached.
NULL here means "this tick did not probe", which is a real state and not missing
data. ``probed_sha`` is additionally NULL on ``probe_result = 'no_tip'`` rows,
where a probe was wanted but had no sha to aim at.

Deploy ordering — the coord side lands SEPARATELY, and AFTER this
=================================================================
alembic in ``qontinui-web`` is the sole author of ``coord.*`` schema; coord's
Rust authors zero production ``coord.*`` DDL. So this migration must merge,
deploy, and be **verified present in prod** before any coord code reads or
writes ``probed_sha`` / ``probe_result``. The coord half is deliberately not in
this PR.

State the failure mode precisely, because for these columns it is worse than the
usual "the new columns come back NULL". ``scheduler_trace::record``'s INSERT is
**best-effort**: on error it logs a warning and drops the row. So a coord half
deployed ahead of this migration does not degrade to null-valued probe fields —
the INSERT names columns that do not exist in prod, and therefore fails on
**every** tick. ``coord.scheduler_ticks`` stops receiving rows **entirely**.

The blast radius is total loss of the merge-decision trace, degrading **silently
at ``warn!`` level** — no alert, no failed deploy, no red check. The scheduler
keeps making merge decisions correctly; it simply stops recording any of them,
and the first symptom is an operator finding an empty trace during the next
incident, i.e. exactly when the trace is needed. Note the irony to be avoided:
shipping the coord half early would destroy the observability these columns were
added to provide.

This is the 2026-07-13 missing-column incident class (coord reading a
``coord.*`` column that exists locally but not in prod: green in every local
test, broken against the live database), with the amplification that the failing
statement here is a fire-and-forget INSERT rather than a surfaced query error.

Coord-side test containers need matching ``ADD COLUMN IF NOT EXISTS`` ALTERs
===========================================================================
Recorded here so the coupling sits where the next person will look, but **not
this PR's work** — do not edit the coord repo from a qontinui-web migration PR.

coord's DB-gated tests provision their schema with a
``CREATE TABLE IF NOT EXISTS coord.scheduler_ticks`` block. ``IF NOT EXISTS`` is
a no-op against an already-existing container table, so a **pre-existing** test
container never gains a newly-added column, and the tests fail — or worse,
self-skip and report green — for a reason that has nothing to do with the change
under test. The established fix is an explicit follow-on ALTER beside the
``CREATE TABLE``; ``scheduler_ticks_proposal_id_01`` is mirrored there today by
``ALTER TABLE coord.scheduler_ticks ADD COLUMN IF NOT EXISTS proposal_id UUID;``
for exactly this reason. The coord PR that adds the write/read paths owes the
same treatment for both of these columns::

    ALTER TABLE coord.scheduler_ticks ADD COLUMN IF NOT EXISTS probed_sha TEXT;
    ALTER TABLE coord.scheduler_ticks ADD COLUMN IF NOT EXISTS probe_result TEXT;

No ``tenant_id``
================
``coord.scheduler_ticks`` is one of the four **fleet-global** agent-debug tables
(alongside ``outbound_budget_observations``, ``worker_heartbeats`` and
``webhook_pulse``): they observe coord's own infrastructure, not per-tenant
state, and carry no ``tenant_id`` by design. It is correspondingly **not** in
the seven-table scoped set that ``coord_tenant_id_not_null`` locks to
``NOT NULL`` (``devices``, ``plans``, ``agent_worktrees``, ``agent_questions``,
``agent_logs``, ``memories``, ``primary_trees``). This migration keeps that
posture and introduces no tenant column.

No new index — reasoning
========================
Deliberately none. The read these columns serve is "recent ticks for a given
repo, newest first, now showing what each one probed and how it read"::

    SELECT tick_at, decision_code, probed_sha, probe_result
      FROM coord.scheduler_ticks
     WHERE repo = $1
     ORDER BY tick_at DESC
     LIMIT $n

The existing ``idx_scheduler_ticks_repo_tick_at`` on ``(repo, tick_at DESC)``
already drives exactly that newest-first prefix walk; ``probed_sha`` and
``probe_result`` are **projected**, and where they are filtered at all (e.g.
"show me the recent ``absent`` ticks for this repo") they ride along as a cheap
filter on rows the index has already narrowed. The candidate set is small by
construction: the ring holds ~48h, the fleet is ~14 repos, and the scheduler
ticks on a fixed interval, so the rows an index scan can even consider for one
repo are bounded in the low thousands — and the operator-facing read is a
bounded ``LIMIT`` off the head of that set, not a scan of it.

Against that, a ``(repo, probe_result, tick_at DESC)`` index would be a third
index to maintain on a table that is written on every scheduler tick *and*
bulk-deleted by retention pruning — real, continuous write amplification bought
for a filter that is already nearly free. An unused index on a high-write table
is a permanent cost for nothing.

The condition that would change this answer, recorded so it can be checked
rather than guessed: if a reader ever needs to aggregate ``probe_result`` across
the **whole** retention window rather than off the head of one repo's ordering —
for example a fleet-wide "how many ticks probed an ``absent`` sha in the last
48h" panel, which cannot be answered from a bounded newest-first prefix — the
prefix-walk argument no longer holds and the query degenerates to a full ring
scan. If coord's read evolves that way, or if per-repo tick volume grows by an
order of magnitude, add the index then, on measured evidence. Not speculatively
now.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "scheduler_ticks_probe_01"
down_revision: str | Sequence[str] | None = "sess_guard_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Bound the DDL's lock wait. ADD COLUMN takes ACCESS EXCLUSIVE, and while
    # the add itself is catalog-only (nullable, no default) and therefore
    # instantaneous, a *queued* ACCESS EXCLUSIVE request blocks every reader and
    # writer that arrives behind it. On a table the merge scheduler writes on
    # every tick that is the difference between a no-op and a stall. Fail fast
    # instead of queueing behind one slow in-flight statement; a timeout here is
    # a retry, not a data problem.
    op.execute("SET LOCAL lock_timeout = '3s'")

    # Both nullable with no server_default -> metadata-only; never rewritten.
    # The sha the CI probe actually asked GitHub about. NULL on ticks that did
    # not probe, and on 'no_tip' ticks where no sha could be resolved.
    op.add_column(
        "scheduler_ticks",
        sa.Column("probed_sha", sa.Text(), nullable=True),
        schema="coord",
    )
    # How that probe read: 'in_flight'|'pending'|'absent'|'saturated'|
    # 'push_needed'|'read_error'|'no_tip'. Open vocabulary (it is expected to
    # grow) -> no CHECK, same posture as decision_code on this table. NULL means
    # "predates the column / could not classify" and must never be rendered as
    # 'pending'.
    op.add_column(
        "scheduler_ticks",
        sa.Column("probe_result", sa.Text(), nullable=True),
        schema="coord",
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.drop_column("scheduler_ticks", "probe_result", schema="coord")
    op.drop_column("scheduler_ticks", "probed_sha", schema="coord")
