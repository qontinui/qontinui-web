"""coord.agent_questions: ``alert_key`` and one OPEN question per alert episode.

Phase 5 item 1 of plan
``qontinui-dev-notes/plans/2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work.md``.
Additive, nullable, no backfill.

What this adds
==========================================================================

* ``coord.agent_questions.alert_key TEXT NULL`` — the ``coord.alerts.alert_key``
  of the alert episode an operator question was raised for. NULL for every
  question that did not come from an alert, which is every existing row.
* A partial UNIQUE index::

      CREATE UNIQUE INDEX CONCURRENTLY uq_agent_questions_open_alert_key
      ON coord.agent_questions (tenant_id, alert_key)
      WHERE alert_key IS NOT NULL AND responded_at IS NULL

Phase 5 has coord's ``fleet_health::on_alert_opened`` raise an operator
question (with a recommendation) for every ``Responder::Operator`` alert kind,
from the upsert insert arm AND from the raw ``DO NOTHING`` writers. Several of
those paths can fire for the same alert episode, so the dedupe must live in
the database: the second ``INSERT`` hits this index, and coord treats the
unique-violation (23505) as "already asked". The plan's vet fix records why a
column is needed at all: ``context`` is TEXT, so ``context->>'alert_key'``
cannot dedupe.

The "open" predicate — ``responded_at IS NULL``, and why
==========================================================================

``coord.agent_questions`` has **no status column**. Read from every revision
that touches the table — ``coord_agent_questions`` (the create),
``coord_tenant_scope_columns`` / ``coord_tenant_id_not_null`` (``tenant_id``,
now NOT NULL), ``coord_agent_questions_audience`` (+ ``_backfill``) — and from
coord's ``agent_questions.rs`` on ``origin/main``: a question is pending
exactly while ``responded_at IS NULL``. Every answer path in coord is
``UPDATE ... SET responded_at = now() ... WHERE question_id = $3 AND
responded_at IS NULL``, and both existing pending partials
(``idx_agent_questions_pending``, ``idx_agent_questions_agent_pending``) use
the same predicate. There is no expired/cancelled/withdrawn state to exclude.

So the uniqueness is scoped to the OPEN question only. Once the operator
answers, the row leaves the index, and a later episode of the same alert (the
alert resolved and re-opened under the same key) can raise a fresh question —
"one open question per alert episode", as the plan states it, rather than one
question per key for all time.

Leading ``tenant_id``: coord's reads of this table are unconditionally
tenant-scoped, and alert keys are tenant-local, so two tenants' alerts sharing
a key must not collide.

Locking and CONCURRENTLY
==========================================================================

The ALTER is a catalog-only ``ADD COLUMN ... NULL`` (no rewrite), bounded by
``SET LOCAL lock_timeout = '3s'`` and followed by the REQUIRED
``RESET lock_timeout`` — the ``coord_agent_questions_audience`` convention;
``env.py`` runs every revision of one upgrade in a single transaction, so an
unreset ``SET LOCAL`` leaks into later revisions.

The index is built ``CONCURRENTLY`` inside ``op.get_context().autocommit_block()``
(the ``coord_alerts_pagedidx_01`` precedent) so the ~16 autonomous producers
writing this table are never blocked by a ``SHARE`` lock. The build cannot hit
a duplicate: every existing row has ``alert_key IS NULL`` and is outside the
predicate. A killed CONCURRENTLY build leaves an INVALID index that
``IF NOT EXISTS`` would skip on re-run — and an INVALID unique index is still
ENFORCED on writes while serving no reads — so verify ``pg_index.indisvalid``,
not mere existence; if invalid, ``DROP INDEX`` it and re-run.

Downgrade drops the index (CONCURRENTLY), then the column. Questions survive.

Revision ID: agent_questions_alert_key_01
Revises: coord_alerts_claim_01
Create Date: 2026-09-18

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "agent_questions_alert_key_01"
down_revision: str | Sequence[str] | None = "coord_alerts_claim_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``alert_key``, then the CONCURRENT partial unique index. Idempotent."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD COLUMN IF NOT EXISTS alert_key TEXT
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")

    with op.get_context().autocommit_block():
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook statically checks that every CREATE/DROP names its
        # schema.
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_agent_questions_open_alert_key
            ON coord.agent_questions (tenant_id, alert_key)
            WHERE alert_key IS NOT NULL AND responded_at IS NULL
            """
        )


def downgrade() -> None:
    """Drop the index, then the column. The questions survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.uq_agent_questions_open_alert_key"
        )

    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("ALTER TABLE coord.agent_questions DROP COLUMN IF EXISTS alert_key")
    op.execute("RESET lock_timeout")
