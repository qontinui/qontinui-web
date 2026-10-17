"""coord.agent_questions: one OPEN escalation per (tenant, subject).

Phase 2a of plan
``qontinui-dev-notes/plans/2026-10-15-agent-questions-operator-questions-and-open-gates-have-no-bound.md``
(design decision D6). Additive, no backfill.

What this adds
==========================================================================

* ``coord.agent_questions.subject_key TEXT NULL`` — ``<domain>:<subject>``,
  the decision subject a machine escalation is about (e.g.
  ``repo_pull:<device>/<repo>``, ``pr_fix:<repo>#<n>``). coord derives it in
  ``create_escalation_question`` through the same ``escalation_premise``
  ``subject`` function the question sweep folds on, so the writer and the fold
  can never disagree about a subject. The domain prefix means two domains can
  never collide on one key. NULL for every row that has no derivable subject
  (agent-door asks, domains with no subject rule, every existing row).
* ``coord.agent_questions.ask_count INTEGER NOT NULL DEFAULT 1`` — how many
  consults this open row has absorbed. A constant default is a catalog-only
  change (no table rewrite) on Postgres 11+.
* ``coord.agent_questions.last_asked_at TIMESTAMPTZ NULL`` — when the newest
  consult refreshed the row. NULL until the first repeat; ``created_at`` keeps
  the FIRST ask, so the question's age still counts from it.
* A partial UNIQUE index::

      CREATE UNIQUE INDEX uq_agent_questions_open_subject
      ON coord.agent_questions (tenant_id, subject_key)
      WHERE subject_key IS NOT NULL
        AND responded_at IS NULL
        AND withdrawn_at IS NULL

  the shape ``uq_agent_questions_open_alert_episode`` already uses. "Open" is
  ``responded_at IS NULL AND withdrawn_at IS NULL`` — the pending predicate
  every coord reader uses since ``coord_agent_questions_withdrawn``.

How coord writes against it
==========================================================================

The arbiter form, which infers this partial index — never insert-and-catch
the 23505, which aborts the enclosing transaction::

    INSERT INTO coord.agent_questions (..., subject_key)
    VALUES (...)
    ON CONFLICT (tenant_id, subject_key)
        WHERE subject_key IS NOT NULL
          AND responded_at IS NULL
          AND withdrawn_at IS NULL
    DO UPDATE SET ask_count     = coord.agent_questions.ask_count + 1,
                  last_asked_at = now(),
                  context       = EXCLUDED.context,
                  question      = EXCLUDED.question,
                  options       = EXCLUDED.options
    RETURNING question_id

The conflict arm refreshes the open row to the LATEST consult (D6): keeping
the first consult's context would show the operator a stale reading and would
let the ``pr_fix`` premise retire a row just re-asked at a new head.

Why no backfill
==========================================================================

Phase 1 (the escalation arm of coord's question sweep) already drained the
duplicate pile by premise, fold and expiry. Every existing row keeps
``subject_key IS NULL`` and sits outside the predicate, so the index build
cannot hit a duplicate on first apply.

Locking — a plain CREATE INDEX, deliberately not CONCURRENTLY
==========================================================================

The table is ~58 MB. coord's migration classifier has refused the
``CONCURRENTLY`` idiom before (finding ``b193633f``), and ``env.py`` runs every
revision of one upgrade in a single transaction, where ``CONCURRENTLY`` cannot
run without an ``autocommit_block``. A plain build takes a ``SHARE`` lock that
blocks writers to this table for the seconds the build takes; readers are not
blocked. The lock ACQUISITION is bounded by ``SET LOCAL lock_timeout = '3s'``
(the ``coord_agent_questions_audience`` convention) so a long-running holder
fails the deploy loudly instead of queueing every writer behind it, followed by
the REQUIRED ``RESET lock_timeout`` — an unreset ``SET LOCAL`` leaks into every
later revision of the same run.

Downgrade drops the index, then the three columns. Questions survive.

Revision ID: coord_agent_questions_subject_01
Revises: fleet_policy_egress_01_transcript_sync
Create Date: 2026-10-17

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_questions_subject_01"
down_revision: str | Sequence[str] | None = "fleet_policy_egress_01_transcript_sync"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the three columns, then the partial unique index. Idempotent."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD COLUMN IF NOT EXISTS subject_key   TEXT,
            ADD COLUMN IF NOT EXISTS ask_count     INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS last_asked_at TIMESTAMPTZ
        """
    )
    # Plain literal, never an f-string: the `alembic-schema-arg-gate`
    # pre-commit hook statically checks that every CREATE/DROP names its
    # schema.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_questions_open_subject
        ON coord.agent_questions (tenant_id, subject_key)
        WHERE subject_key IS NOT NULL
          AND responded_at IS NULL
          AND withdrawn_at IS NULL
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")


def downgrade() -> None:
    """Drop the index, then the three columns. The questions survive."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP INDEX IF EXISTS coord.uq_agent_questions_open_subject")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP COLUMN IF EXISTS last_asked_at,
            DROP COLUMN IF EXISTS ask_count,
            DROP COLUMN IF EXISTS subject_key
        """
    )
    op.execute("RESET lock_timeout")
