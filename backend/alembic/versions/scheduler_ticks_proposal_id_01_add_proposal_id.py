"""coord.scheduler_ticks — add nullable ``proposal_id``

Revision ID: scheduler_ticks_proposal_id_01
Revises: agent_action_reports_01
Create Date: 2026-07-31

Adds a single nullable ``proposal_id UUID`` column to ``coord.scheduler_ticks``
(created in ``coord_agent_debug_01_outbound_worker_scheduler_webhook``).

Who reads it
============
coord's ``train_health`` twin, specifically the ``deferral_streak`` aggregate
shipped in coord #1299. ``deferral_streak`` walks ``coord.scheduler_ticks``
newest-first for a repo and counts the run of consecutive identical
``deferred:*`` ``decision_code`` values, so a wedged merge train shows up as a
long streak instead of as a wall of individually-unremarkable ticks.

Today that aggregate is **repo-scoped**, because the tick row records only
``(repo, main_sha, queue_depth, lease_state, no_reap_verdict, budget_state,
decision_code, duration_ms)`` — there is nothing on the row that says *which
proposal* the scheduler refused. That was sufficient for the incident that
motivated the aggregate (one repo, one stuck candidate), but on a repo carrying
several independently-livelocked proposals the streak names the repo's refusal
run rather than the culprit. This column is the enabling step: with it, the same
streak walk can be narrowed to one proposal.

Why nullable, with no default
=============================
``coord.scheduler_ticks`` is **append-per-tick on a ~48h retention ring** — a
high-write table whose rows are continuously inserted by the merge scheduler and
continuously pruned by retention. A nullable column with **no default** is a
catalog-only ``ADD COLUMN``: PostgreSQL records the attribute and returns, with
no table rewrite and no per-row work. Attaching a default (even a constant) or a
``NOT NULL`` would turn this into an operation that touches the table, which is
exactly what must not happen here.

Nullability is also semantically correct, not just a performance dodge. Every
row written before this migration legitimately has no ``proposal_id``, and so
will every row afterwards whose decision is not about a specific proposal —
``no_ready_prs`` (the queue was empty), ``budget_backoff``, ``lease_held``, and
``tick_error:*`` are all repo-level outcomes with no candidate attached. NULL
here means "this tick was not about one proposal", which is a real state, not
missing data. Readers must treat NULL as an ordinary value; the repo-scoped
``deferral_streak`` keeps working unchanged.

Deploy ordering — the coord side lands SEPARATELY, and AFTER this
================================================================
alembic in ``qontinui-web`` is the sole author of ``coord.*`` schema; coord's
Rust authors zero production ``coord.*`` DDL. So this migration must merge,
deploy, and be **verified present in prod** before any coord code reads or
writes ``proposal_id``. A coord read of a ``coord.*`` column that does not yet
exist in prod is a known incident class (2026-07-13) — coord's query fails at
runtime against the live database while passing every local test, because the
local database was migrated and prod was not. The coord half of this change is
deliberately not in this PR.

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

No foreign key to ``coord.merge_proposals``
===========================================
The type matches ``coord.merge_proposals.proposal_id`` (UUID v7 PK), but no FK
constraint is declared, matching the established posture for coord's
observability ledgers that reference a proposal — ``coord.merge_bypass_audit``
and ``coord.coord_git_write_ledger`` both carry a bare nullable
``proposal_id UUID``. Two reasons hold here specifically: an FK would add a
referential lookup to every scheduler tick INSERT on the hot path, and it would
couple this table's 48h retention ring to ``merge_proposals`` lifetime — a
proposal pruned or deleted while its ticks are still inside the ring would
either fail or cascade. Ticks are observations of a decision that was made; they
should survive the disappearance of what they observed.

No new index — reasoning
========================
Deliberately none. The read this column serves is "consecutive ticks for a given
repo, newest first, now filterable by proposal":

    SELECT decision_code, proposal_id
      FROM coord.scheduler_ticks
     WHERE repo = $1 [AND proposal_id = $2]
     ORDER BY tick_at DESC
     LIMIT $n

The existing ``idx_scheduler_ticks_repo_tick_at`` on ``(repo, tick_at DESC)``
already drives exactly that plan; ``proposal_id`` rides along as a cheap filter
on rows the index has already narrowed. It is worth being precise about how
small that candidate set is: the ring holds ~48h, the fleet is ~14 repos, and
the scheduler ticks on a fixed interval — so the rows an index scan can even
consider for one repo are bounded in the low thousands. On top of that,
``deferral_streak`` is a *prefix* walk by construction: it reads newest-first
and stops at the first tick that breaks the run, so it touches a short head of
that already-small set rather than scanning it.

Against that, a ``(repo, proposal_id, tick_at DESC)`` index would be a third
index to maintain on a table that is written on every scheduler tick *and*
bulk-deleted by retention pruning — real, continuous write amplification bought
for a filter that is already nearly free. An unused index on a high-write table
is a permanent cost for nothing.

The condition that would change this answer, recorded so it can be checked
rather than guessed: if the per-proposal read is ever pointed at an *old*
proposal — one whose ticks sit deep in the ring rather than at its head — the
prefix-walk argument no longer applies and the scan could traverse most of a
repo's window. If coord's read evolves that way, or if tick volume per repo
grows by an order of magnitude, add ``(repo, proposal_id, tick_at DESC)`` then,
on measured evidence. Not speculatively now.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "scheduler_ticks_proposal_id_01"
down_revision: str | Sequence[str] | None = "agent_action_reports_01"
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

    # Nullable, no server_default -> metadata-only; the table is never rewritten.
    op.add_column(
        "scheduler_ticks",
        sa.Column("proposal_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="coord",
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.drop_column("scheduler_ticks", "proposal_id", schema="coord")
