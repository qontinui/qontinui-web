"""coord.agent_questions: index every episode-linked question by (tenant_id, alert_id).

Follow-up to ``agent_questions_alert_episode_01`` for plan
``qontinui-dev-notes/plans/2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work.md``
(Phase 5 / Phase 2's alert queue).

Why a second index
==================

``agent_questions_alert_episode_01`` created one index on ``alert_id``: the
partial UNIQUE ``uq_agent_questions_open_alert_episode`` over
``(tenant_id, alert_id) WHERE alert_id IS NOT NULL AND responded_at IS NULL``.
It is the dedupe arbiter for OPEN questions, and by construction it covers
only them.

coord's reads also probe ANSWERED rows, and those go unindexed:

* the per-episode question dedupe and the reconcile pre-filter
  (``alert_operator_questions.rs``) ask whether ANY question, open or
  answered, exists for ``(q.tenant_id = a.tenant_id AND q.alert_id = a.id)``;
* the two gap counts in ``alert_queue.rs`` run ``EXISTS`` / ``NOT EXISTS``
  over ``q.tenant_id = $1 AND q.alert_id = a.id``, one arm restricted to
  ``q.responded_at IS NOT NULL``.

A probe that can match an answered row cannot be served by an index whose
predicate requires ``responded_at IS NULL``, so each of those correlated
subqueries falls back to scanning ``coord.agent_questions`` once per open
alert. Answered questions only accumulate, so that cost only grows.

This revision adds a plain (non-unique) partial index over the same key,
restricted only to ``alert_id IS NOT NULL``. Questions not linked to an alert
(the large majority, asked by agents) are left out, so the index stays the
size of the alert-question population. It does not replace the unique one:
that index is a constraint, and this one is only an access path.

Build posture
=============

Same as ``agent_questions_alert_episode_01``: ``CREATE INDEX CONCURRENTLY
IF NOT EXISTS`` inside ``autocommit_block()``, so the build takes no lock
that blocks coord's writes. A failed CONCURRENTLY build leaves an INVALID
index of this name, which ``IF NOT EXISTS`` would silently keep. So the
upgrade first checks ``pg_index.indisvalid`` and drops an invalid index
concurrently, and the CREATE then rebuilds it. A re-run over a VALID index
leaves it untouched.

``downgrade()`` drops the index concurrently. No data changes either way.

Revision ID: agent_questions_alert_id_idx_01
Revises: coordnotif_03_rename_irreversible_kind
Create Date: 2026-09-19

"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "agent_questions_alert_id_idx_01"
down_revision: str | Sequence[str] | None = "coordnotif_03_rename_irreversible_kind"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _index_is_invalid(index_name: str) -> bool:
    """True when ``coord.<index_name>`` exists and is INVALID (a failed build)."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT NOT i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        )
        .scalar()
    )


def upgrade() -> None:
    """Build the (tenant_id, alert_id) partial index. Idempotent, and repairs a failed build."""
    with op.get_context().autocommit_block():
        # A failed earlier CONCURRENTLY build leaves an INVALID index that
        # IF NOT EXISTS would keep. Drop it so the CREATE below rebuilds it.
        if _index_is_invalid("idx_agent_questions_tenant_alert"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.idx_agent_questions_tenant_alert"
            )
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook statically checks that every CREATE/DROP names its
        # schema.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_questions_tenant_alert
            ON coord.agent_questions (tenant_id, alert_id)
            WHERE alert_id IS NOT NULL
            """
        )


def downgrade() -> None:
    """Drop the index concurrently. The questions are untouched."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_agent_questions_tenant_alert"
        )
