"""coord.agent_questions — audience column

Revision ID: coord_agent_questions_audience
Revises: session_repo_01_session_artifacts
Create Date: 2026-08-28

Phase D2 (schema half) of plan
``2026-08-27-escalation-audience-agent-vs-operator``.

Adds one column plus one audience-selective partial index to
``coord.agent_questions``:

- ``audience TEXT NOT NULL DEFAULT 'operator'
  CHECK (audience IN ('operator','agent'))`` — splits the escalation queue by
  **who decides**, exactly as ``coord.gates.clearance_audience`` splits gates
  by who clears them.
- ``idx_agent_questions_agent_pending`` — the agent tier's hot read path.

Why the column exists
=====================

``coord.agent_questions`` is the operator's inbox, and coord's ``Escalate``
arm has exactly one exit into it: ``route_resolution``'s ``Escalate`` branch
logs *"escalated to operator inbox"* and returns without ever calling
``maybe_autodispatch``. Measured against production 2026-08-28 by direct SQL:
**23,700 pending rows**, of which 23,258 are ``pr_fix``; 43 rows have ever
been answered in the table's entire history and — derived by reading the
``responded_by_operator`` prefixes, never as "only one question was ever
answered" — exactly one of those carries a human responder
(``josh@qontinui.io``), the other 42 the machine responder ``auto:policy_gap``.
With ~16 autonomous producers and zero autonomous drains, the pile-up is a
monotonic growth property of the design rather than a backlog that fell
behind.

The distinction this column encodes: **a policy says WHAT to decide; an
audience says WHO decides.** A decision being UNCOVERED by policy is not the
same fact as a decision needing a HUMAN, and ``Escalate`` currently conflates
them. A router-only classification would be unauditable — you could not ask
"how many escalations went to an agent last week" — so the audience has to be
on the row.

Why a CHECK constraint
======================

``audience`` is a **closed two-value authorization boundary**, not an open
vocabulary: an agent answering an ``audience='operator'`` row is privilege
escalation. That is the same shape as ``coord.gates.clearance_audience``,
which this revision follows verbatim
(``coord_gates_clearance_audience.py``:56, :68-69).

The ``coord.work_units.status`` precedent — a TEXT column with no CHECK — is
deliberately NOT followed. It is opaque because its vocabulary is genuinely
open (legacy strings must round-trip); this one is not.

Rejected on the record: riding the existing ``context`` TEXT field the way
``POLICY_GAP_CONTEXT_MARKER`` does. An authorization boundary must not be a
``LIKE`` on a TEXT column.

Why a second partial index, and why its key is not the sibling's
===============================================================

The shipped ``idx_agent_questions_pending`` is
``ON (created_at DESC) WHERE responded_at IS NULL`` and is **not**
audience-aware, so the plan's D3 agent-tier read door would scan the whole
operator pile to find agent rows. ``idx_agent_questions_agent_pending`` adds
``audience = 'agent'`` to that predicate.

Its KEY deliberately diverges from the sibling's: ``(tenant_id, created_at
DESC)``, not ``(created_at DESC)``. ``tenant_id`` is ``NOT NULL`` on this
table (``coord_tenant_scope_columns`` then ``coord_tenant_id_not_null``,
whose ``_LOCKED_TABLES`` names ``agent_questions``), and coord's pending read
filters it unconditionally — ``agent_questions.rs``:1487-1488 carries the
comment *"Tenant filter (`tenant_id = $4`) is unconditional."* — so the
leading equality column lets one
index scan satisfy both the tenant predicate and the ``ORDER BY created_at
DESC LIMIT``, instead of re-checking the tenant per fetched row. The key is
chosen now because it is free now: the index stores no entries until D4's
backfill, after which changing it costs a second migration and a rebuild
under a SHARE lock.

The predicate is IMMUTABLE (a constant text comparison; no ``now()`` or other
non-IMMUTABLE function), so there is no IMMUTABLE-predicate hazard — the same
property that makes ``DEFAULT 'operator'`` safe here. The index **stores no
entries** while the agent share of the table is still empty; the build itself
still scans the table once, which is part of why the lock wait is bounded
below.

Locking
=======

Three statements take a lock on a 23,700-row table that ~16 autonomous
producers write continuously (244-1,461 new rows/day over the trailing week):
``ADD COLUMN`` (ACCESS EXCLUSIVE, but catalog-only — PG 11+ stores a
non-volatile default without a rewrite), ``ADD CONSTRAINT … CHECK`` (ACCESS
EXCLUSIVE plus a validation scan), and ``CREATE INDEX`` (SHARE, which blocks
INSERTs). ``CREATE INDEX CONCURRENTLY`` is not available: alembic runs the
whole upgrade inside a transaction.

So both ``upgrade()`` and ``downgrade()`` bound the wait with ``SET LOCAL
lock_timeout = '3s'`` — a QUEUED ACCESS EXCLUSIVE request itself blocks every
reader and writer arriving behind it, so failing fast is strictly better than
stalling behind one long-lived transaction. Same convention as
``coord_plan_pr_citations_3c_drop`` (:213, :221) and
``scheduler_ticks_proposal_id_01_add_proposal_id`` (:139).

``RESET lock_timeout`` at the end of each is REQUIRED, not decorative:
``env.py`` calls ``context.begin_transaction()`` ONCE around
``run_migrations()`` and does not set ``transaction_per_migration``, so every
revision in one ``alembic upgrade`` run shares a single transaction and an
unreset ``SET LOCAL`` would leak this timeout into every migration that lands
after it.

No backfill here — deliberately
===============================

Every existing row takes the ``'operator'`` DDL default and nothing is
reclassified by this revision. The backfill is phase D4 and ships as a
SEPARATE, later revision, *after* D3's agent-tier read door exists. The
plan's top risk is that "a queue with no poller is worse than a full inbox":
moving 23,258 rows into an agent queue no agent can read yet would convert a
visible problem into an invisible one. ``'operator'`` is also the fail-safe
direction — an unclassified domain keeps reaching the human, exactly as
``clearance_audience`` defaults on gates.

House conventions followed
==========================

Raw ``op.execute`` (not ``op.add_column``) with ``ADD COLUMN IF NOT EXISTS``
so the migration is collision-safe against any canonical PG that might
already carry the column (e.g. from a runtime self-heal mirror) — the
convention of the sibling ``coord_gates_clearance_audience`` and the
``coord_substrate_*`` revisions. Note that no self-heal for this table
actually exists today: ``coord_agent_questions`` wrote it in the future tense
(*"Runtime self-heal will live alongside the question API handler"*) and coord
carries no DDL for ``coord.agent_questions``. The guard is cheap insurance,
not a mechanism being relied on.

The CHECK constraint is added idempotently (``DROP CONSTRAINT IF EXISTS``
then ``ADD CONSTRAINT``) so a re-run does not collide on the constraint name
— the pattern ``gateverdict_01_misconfigured``:23-29 records, citing this
same ``coord_gates_clearance_audience`` sibling for it.

Touches **only** ``coord.agent_questions`` (created earlier in this same
linear chain by ``coord_agent_questions``), so it applies cleanly anywhere
the chain is run.

``down_revision`` chains off the single current head
``session_repo_01_session_artifacts``, computed from the chain rather than
taken from a coord migration reservation — which departs from
``gateverdict_01_misconfigured``:36-39, so here is why.

Reserving is not what coord asks for on this resource. ``POST
/coord/migrations/reserve`` is live, but for alembic it is advisory only:
coord's own ``HEAD_KEYED_ALEMBIC_REDIRECT`` (``semantic_reserve.rs``:192-199)
says *"You do NOT need to reserve to author a migration — author against your
local head and push … is OPTIONAL and returns only an advisory suggested
down_revision + queue position."* The semantic ``reserve()`` door goes
further and REFUSES the head outright — the registered ``migration-head``
grammar (``semantic_reserve.rs``:130-138, ``land_time_repointable: true``)
reads *"Reserve is not merely optional here, it is refused."* And the older
exclusive-mutex form, the ``alembic_revision`` CLAIM kind on
``/coord/claims/acquire``, is separately **retired**: ``routes.rs``:4415-4424
answers 410 Gone and redirects to that same optional reserve.

What replaces it is land-time re-pointing, with the CI check as the backstop
— and in all three forks on record the declared parent WAS the single head at
authoring time, so an author-time mutex would not have prevented them
(``.github/workflows/alembic-graph-check.yml``, closing note). Where a
land-time collision is grammar-rewritable coord's auto-rewrite re-points
``down_revision`` itself (``conflict_engine.rs``:872-879, :989-993);
otherwise the required ``alembic-graph-pr.yml`` check fails and the token is
re-pointed by hand. Either way no ``coord:stacked-on`` /
``coord:upstream-of`` label belongs on this PR — ``alembic-heads-pr`` owns
the chain.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_questions_audience"
down_revision: str | Sequence[str] | None = "session_repo_01_session_artifacts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``audience`` + its CHECK + the agent-selective partial index."""
    # Bound the DDL's lock wait: a queued ACCESS EXCLUSIVE request blocks every
    # reader and writer arriving behind it, and ~16 autonomous producers write
    # this table continuously. Failing fast is a retry, not a data problem.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'operator'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP CONSTRAINT IF EXISTS coord_agent_questions_audience_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD CONSTRAINT coord_agent_questions_audience_check
            CHECK (audience IN ('operator', 'agent'))
        """
    )
    # The agent tier's hot read path: pending agent-audience questions for one
    # tenant, newest first. Leading ``tenant_id`` because coord's pending read
    # filters it unconditionally; see the docstring for why the key diverges
    # from the sibling ``idx_agent_questions_pending``.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_questions_agent_pending
            ON coord.agent_questions(tenant_id, created_at DESC)
            WHERE responded_at IS NULL AND audience = 'agent'
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")


def downgrade() -> None:
    """Drop the index, the CHECK and the column."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_questions_agent_pending")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP CONSTRAINT IF EXISTS coord_agent_questions_audience_check
        """
    )
    op.execute("ALTER TABLE coord.agent_questions DROP COLUMN IF EXISTS audience")
    op.execute("RESET lock_timeout")
