"""coord.agent_questions — withdrawal record + the ask-time reference

Revision ID: coord_agent_questions_withdrawn
Revises: mrg_aqw_01
Create Date: 2026-09-20

Phase 0 of plan
``2026-09-20-a-pending-operator-question-outlives-the-condition-that-motivated-it``.

Adds five nullable trailing columns plus two partial indices to
``coord.agent_questions``, so a question whose premise has provably died can be
**withdrawn** instead of sitting pending forever.

Why this migration exists
=========================

An agent escalates with ``coord_ask_question`` when a closed-list item fires.
The row records the condition as it stood at ask time and nothing ties the
question's lifecycle to that condition afterwards — so when the PR lands on its
own merits, or the gate clears, or the blocker evaporates, the question stays
pending **forever** and is indistinguishable from one that still needs a human.
Measured against ``crates/coord/src/agent_questions.rs`` on ``origin/main``
2026-09-20, a ``git grep -iE 'expire|stale|withdraw|auto_close|superseded'``
over that file returns nothing: the only exits a question has today are "an
operator answers it" or "it sits pending indefinitely". At the depth the
sibling ``coord_agent_questions_audience`` measured against production
2026-08-28 — **23,700 pending rows, 43 ever answered, exactly one of those by a
human** — that is not a tidiness concern, it is the whole inbox.

Why FIVE NULLABLE TRAILING COLUMNS and not a ``status`` enum
============================================================

**There is no status column to add a value to.** Pendingness on this table is
the derived predicate ``responded_at IS NULL`` (``coord_agent_questions``, the
revision that created the table, and ``fetch_pending_page`` in
``agent_questions.rs``), not a state machine. ``withdrawn`` is therefore a
schema change.

The shape is forced by how coord reads the table. ``COLS``
(``agent_questions.rs``:133) is decoded **positionally** by ``row_to_struct``,
and ``COLS_PRE_AUDIENCE``:152 is a **strict prefix** of it — which is exactly
what lets ``degrade_sql``:260 narrow an already-built statement by substring
substitution so a pre-migration database degrades to the current behaviour
rather than erroring. Appending nullable columns preserves that property and
every existing ordinal. A ``status`` column would have to be inserted (or the
WHERE of both pending readers, the shipped partial indices, and the
``agent_questions_cols_match_row_to_struct`` /
``pre_audience_projection_is_a_strict_prefix_of_cols`` pins rewritten) — the
``agent_logs`` ``invalid column 8`` class those pins exist to catch, where a
9th column landed on the read paths but not the ``INSERT ... RETURNING`` and
panicked every ingest worker for a month while reads looked healthy.

The sibling ``coord_agent_questions_audience`` makes the mirror-image argument
for its own column and reaches the same place: ride nothing on the overloaded
``context`` TEXT field (``encode_gap_context``:345 already hides one marker
envelope in there), and append rather than insert.

What each column means
======================

The withdrawal record — all four written together, by the one guarded
``UPDATE ... WHERE question_id = $1 AND responded_at IS NULL AND withdrawn_at
IS NULL`` that Phase 1 adds:

* ``withdrawn_at TIMESTAMPTZ`` — when the question was retired. **NULL means
  not withdrawn**; together with ``responded_at`` it makes pendingness
  three-valued rather than two.
* ``withdrawn_by TEXT`` — who retired it, derived from the verified JWT and
  never from a body field (the ``cancelled_by`` rule). Phase 3's automatic
  retirement writes the reserved value ``auto:predicate`` so a machine
  withdrawal is distinguishable from an agent's.
* ``withdrawal_reason TEXT`` — required by the door; the sentence an operator
  reads in the console where an answered row shows its response.
* ``withdrawal_evidence JSONB`` — the structured reference the withdrawal was
  justified by, stored verbatim. JSONB, not TEXT, because it is a record of a
  machine-checkable premise and a reader must be able to ask which PR.

And the ask-time reference, which is a different fact and deliberately a
different column:

* ``asked_about JSONB`` — the structured reference recorded **when the question
  is asked**: ``{pr?: {repo, number}, gate_id?, work_unit_slug?}``, at least one
  present. Phase 1b makes ``create_agent_question`` accept it and makes coord's
  own ``Escalate`` arm populate it from the ``MergeVerdict`` it already holds
  (``pr_merge/merge_verdict.rs``:72) and today throws away; Phase 3's
  auto-retire reads it (``asked_about->'pr'``) and retires the question when
  that reference reaches a terminal landed/cleared state per coord's own land
  record, ``gates::pr_merged_verdict``:8382.

  It is typed and queryable for that reason. A marker-prefixed blob inside
  ``context`` would be reachable only by string matching, and ``context``
  already carries one such envelope, which would make the decoding order
  load-bearing.

  ⚠️ NULL on every row that exists today, which is the bound Phase 3 states
  plainly: auto-retire is **prospective only** and can never reach the ~23,700
  rows already pending. Draining those is Phase 5's bounded backfill, which
  recovers a reference from what legacy rows do carry and leaves a row pending
  when it cannot.

The indices
===========

``idx_agent_questions_withdrawn`` — ``(withdrawn_at DESC) WHERE withdrawn_at IS
NOT NULL``. The console's withdrawn view. Withdrawn rows are **never deleted**:
the row, its reason and its evidence are the audit trail for why an operator
was asked and then un-asked, the same point served policy ``plan-discipline``
makes about ``archived``. It stores no entries until the first withdrawal.

``idx_agent_questions_pending_live`` — ``(tenant_id, created_at DESC) WHERE
responded_at IS NULL AND withdrawn_at IS NULL``. **This becomes the hot read
path**, because Phase 2 amends the one predicate both pending readers share
(``fetch_pending_page``:1939) from ``responded_at IS NULL`` to ``responded_at
IS NULL AND withdrawn_at IS NULL``.

Its key leads with ``tenant_id``, and therefore deliberately does **not**
mirror the shipped ``idx_agent_questions_pending`` — ``(created_at DESC)`` —
that it succeeds. The sibling ``coord_agent_questions_audience`` made this exact
call for ``idx_agent_questions_agent_pending`` and wrote the reasoning down:
``tenant_id`` is ``NOT NULL`` on this table (``coord_tenant_scope_columns`` then
``coord_tenant_id_not_null``, whose ``_LOCKED_TABLES`` names
``agent_questions``) and coord's pending read filters it unconditionally —
``fetch_pending_page`` carries ``AND tenant_id = $4`` in **both** arms, under
the comment *"Tenant filter (`tenant_id = $4`) is unconditional."* — so the
leading equality column lets ONE index scan satisfy the tenant predicate and
the ``ORDER BY created_at DESC LIMIT`` together, rather than re-checking the
tenant on every fetched row. The key is chosen at creation because changing it
afterwards costs a second migration and an index rebuild under SHARE.

That argument is **stronger** here than it was there, in two ways. The audience
index stores no entries until D4's backfill; this one is populated with the
entire ~23,700-row pending pile at creation, so a mis-keyed index is a mis-keyed
index over the whole hot set from the first poll. And the query it serves
carries ``COUNT(*) OVER ()`` with no ``PARTITION BY`` (``agent_questions.rs``,
the cost note above ``fetch_pending_page``), so the ``WindowAgg`` sits BELOW the
``LIMIT`` and must consume every matching row — which without the tenant prefix
is every tenant's pending entries, on every operator-dashboard poll.

The shipped ``idx_agent_questions_pending`` is deliberately **kept**, not
replaced. Coord's pre-migration narrowing means a build running against a
database that has not applied this revision still reads ``responded_at IS
NULL`` alone, and the deploy window in which both statements are live is
exactly the window this migration's land-first ordering creates. Dropping it
here would make the old predicate a sequential scan over a 23,700-row hot
table for the duration.

``idx_agent_questions_agent_pending`` (the audience tier's index) and
``uq_agent_questions_open_alert_episode`` (one open question per alert episode)
are **not** amended here — both are coord-side read/write contracts whose
predicates belong to the phases that own them.

Note for the phase that owns the second one, because the consequence is not
obvious and this docstring is what its PR gets written against.
``uq_agent_questions_open_alert_episode`` is
``ON coord.agent_questions (tenant_id, alert_id) WHERE alert_id IS NOT NULL AND
responded_at IS NULL``
(``agent_questions_alert_episode_01_open_question_per_alert_episode``). A
**withdrawn** row keeps ``responded_at`` NULL, so it still satisfies that
predicate and stays in the unique index **forever**. Once Phase 1 ships the
withdrawal door, withdrawing an alert-sourced question therefore permanently
prevents that alert episode from ever raising another one — the episode is
wedged by the very act meant to retire a moot ask. The change the withdrawal
semantics call for is ``AND withdrawn_at IS NULL``, which **NARROWS** the
predicate: fewer rows indexed, so the enforced uniqueness is RELAXED. Relaxing
an enforced constraint is a behaviour change — some INSERT that is refused today
starts succeeding — so it belongs with the code that depends on it, not with a
schema convenience landed ahead of it.

Locking
=======

Seven statements against a table ~16 autonomous producers write continuously.
``ADD COLUMN`` with no default is catalog-only on PG 11+ (ACCESS EXCLUSIVE, no
rewrite); ``CREATE INDEX`` takes SHARE, which blocks INSERTs, and
``idx_agent_questions_pending_live`` is a real build — it stores an entry for
every pending row. ``CREATE INDEX CONCURRENTLY`` is unavailable because alembic
runs the whole upgrade inside a transaction.

So both directions bound the wait with ``SET LOCAL lock_timeout = '3s'``: a
QUEUED ACCESS EXCLUSIVE request itself blocks every reader and writer arriving
behind it, so failing fast is strictly better than stalling behind one
long-lived transaction. Same convention as the sibling
``coord_agent_questions_audience``. ``RESET lock_timeout`` at the end of each is
REQUIRED, not decorative: ``env.py`` calls ``context.begin_transaction()`` ONCE
around ``run_migrations()`` and does not set ``transaction_per_migration``, so
every revision in one run shares a single transaction and an unreset ``SET
LOCAL`` would leak this timeout into every migration landing after it.

Ordering — this lands BEFORE coord's PR, by policy
==================================================

Served policy ``production-and-cost`` ``alembic-sole-authorship`` makes alembic
in qontinui-web the sole author of ``coord.*`` schema and requires the migration
to land **before** any coord read of the new columns. This plan is consequently
a two-PR plan with a hard order: this revision lands and is verified applied
first; only then is qontinui-coord's PR (Phases 1, 1b, 2, 3) proposed. A coord
build reading ``withdrawn_at`` against a database that has not run this
migration fails every question read, not merely the new path — which is why
coord's reads keep the widest-first narrowing on top of this ordering rather
than instead of it.

Both directions are idempotent (``IF NOT EXISTS`` / ``IF EXISTS``) so a
canonical database that self-healed ahead of alembic converges, and a re-run is
a no-op. Raw ``op.execute`` rather than ``op.add_column`` for exactly that
reason — the convention of the ``coord_substrate_*`` revisions and of the
sibling above.

``down_revision`` chains off ``mrg_aqw_01``, the no-op merge revision added
beside this one. It did NOT originally: this revision was authored against the
single head ``plan_library_07_plan_difficulty``, and while it sat open, two
migrations that had been authored off that same head both landed on main
(``ci_job_mem_01`` and ``rsslocal_02_drop_coord_tables``), leaving main itself
forked at two heads and this branch a third. `alembic-graph-pr.yml` fails a PR
iff the resulting chain exceeds one head, so its own stated remedy applies --
"the author either rebases or adds an `alembic merge` revision" -- and rebasing
cannot resolve a fork between two revisions already on main. See
``mrg_aqw_01_merge_cijobmem_rsslocal_heads.py`` for the reasoning; that merge
imposes no ordering between its parents.

The head was computed from the chain rather than taken

Downgrade drops both indices and all five columns. Nothing is lost that was not
introduced here: every withdrawal record and every ``asked_about`` reference is
written by the phases this revision unblocks.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_questions_withdrawn"
down_revision: str | Sequence[str] | None = "mrg_aqw_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the withdrawal record, ``asked_about``, and the two indices."""
    # Bound the DDL's lock wait; see the docstring's Locking section.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD COLUMN IF NOT EXISTS withdrawn_at        TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS withdrawn_by        TEXT,
            ADD COLUMN IF NOT EXISTS withdrawal_reason   TEXT,
            ADD COLUMN IF NOT EXISTS withdrawal_evidence JSONB,
            ADD COLUMN IF NOT EXISTS asked_about         JSONB
        """
    )
    # The console's withdrawn view. Stores no entries until the first
    # withdrawal; withdrawn rows are kept as the audit trail, never deleted.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_questions_withdrawn
            ON coord.agent_questions(withdrawn_at DESC)
            WHERE withdrawn_at IS NOT NULL
        """
    )
    # The new hot read path: pendingness becomes
    # `responded_at IS NULL AND withdrawn_at IS NULL`. Keyed `(tenant_id,
    # created_at DESC)` — coord's pending read filters tenant unconditionally,
    # so the leading equality column serves the tenant predicate and the
    # `ORDER BY created_at DESC LIMIT` in one scan. The shipped
    # `idx_agent_questions_pending` stays for the pre-migration narrowing.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_agent_questions_pending_live
            ON coord.agent_questions(tenant_id, created_at DESC)
            WHERE responded_at IS NULL AND withdrawn_at IS NULL
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")


def downgrade() -> None:
    """Drop the two indices and the five columns."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_questions_pending_live")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_questions_withdrawn")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP COLUMN IF EXISTS asked_about,
            DROP COLUMN IF EXISTS withdrawal_evidence,
            DROP COLUMN IF EXISTS withdrawal_reason,
            DROP COLUMN IF EXISTS withdrawn_by,
            DROP COLUMN IF EXISTS withdrawn_at
        """
    )
    op.execute("RESET lock_timeout")
