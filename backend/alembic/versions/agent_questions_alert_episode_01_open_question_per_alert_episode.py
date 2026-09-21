"""coord.agent_questions: one OPEN question per alert EPISODE.

Phase 5 item 1 of plan
``qontinui-dev-notes/plans/2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work.md``.
Additive, nullable, no backfill.

What this adds
==========================================================================

* ``coord.agent_questions.alert_id BIGINT NULL`` — the ``coord.alerts.id`` of
  the alert EPISODE an operator question was raised for. This is the dedupe
  key.
* ``coord.agent_questions.alert_key TEXT NULL`` — that episode's
  ``coord.alerts.alert_key``. **Informational only**: it lets a reader group
  questions across episodes of one condition, and it takes part in no
  constraint.
* A partial UNIQUE index::

      CREATE UNIQUE INDEX CONCURRENTLY uq_agent_questions_open_alert_episode
      ON coord.agent_questions (tenant_id, alert_id)
      WHERE alert_id IS NOT NULL AND responded_at IS NULL

Both columns are NULL for every question that did not come from an alert,
which is every existing row.

Why the dedupe key is the episode (``alert_id``), not ``alert_key``
==========================================================================

An ``alert_key`` is unique only while its alert row is OPEN — coord's upsert
is ``ON CONFLICT (alert_key) WHERE resolved_at IS NULL``
(``fleet_health.rs:1767``). A recurrence after resolution is a NEW
``coord.alerts`` row under the SAME key, and nothing closes a question when its
alert resolves. Keyed on ``alert_key``, an unanswered question from episode 1
would therefore block episode 2's question for as long as nobody answered it.
Keyed on ``alert_id``, each episode gets exactly one open question.

``alert_id`` deliberately carries **no foreign key** to ``coord.alerts``:
alert rows are pruned by retention (``coord_alerts_retention_01``), and a
question — answered or not — must outlive the alert row that raised it rather
than block the prune or be cascaded away with it.

Phase 5 has coord's ``fleet_health::on_alert_opened`` raise an operator
question for every ``Responder::Operator`` alert kind, from the upsert insert
arm AND from the raw ``DO NOTHING`` writers, so several paths can fire for one
episode. The dedupe must therefore live in the database. The plan's vet fix
records why a column is needed at all: ``context`` is TEXT, so
``context->>'alert_key'`` cannot dedupe.

How coord should write against it
==========================================================================

Do NOT insert and catch the 23505: a unique-violation aborts the enclosing
transaction. Use the arbiter form, which infers this partial index::

    INSERT INTO coord.agent_questions (..., alert_id, alert_key)
    VALUES (...)
    ON CONFLICT (tenant_id, alert_id)
        WHERE alert_id IS NOT NULL AND responded_at IS NULL
    DO NOTHING
    RETURNING question_id

No row returned means the episode already has an open question.

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

Why ``tenant_id`` leads the index
==========================================================================

Alert keys and alert ids are fleet-wide, not tenant-local, and
``coord.alerts.tenant_id`` is nullable. ``tenant_id`` leads because every
coord read of this table is tenant-filtered, and because one fleet-wide alert
may legitimately raise one question per tenant it concerns — the index must
permit that and dedupe only within a tenant. ``agent_questions.tenant_id`` is
NOT NULL, so for an alert whose ``tenant_id`` is NULL, coord must choose the
tenant the question is raised in; this revision does not.

Locking and CONCURRENTLY
==========================================================================

The ALTER is a catalog-only ``ADD COLUMN ... NULL`` (no rewrite), bounded by
``SET LOCAL lock_timeout = '3s'`` and followed by the REQUIRED
``RESET lock_timeout`` — the ``coord_agent_questions_audience`` convention;
``env.py`` runs every revision of one upgrade in a single transaction, so an
unreset ``SET LOCAL`` leaks into later revisions.

The index is built ``CONCURRENTLY`` inside ``op.get_context().autocommit_block()``
(the ``coord_alerts_pagedidx_01`` precedent) so writers are never blocked by a
``SHARE`` lock. The build cannot hit a duplicate on first apply: every existing
row has ``alert_id IS NULL`` and is outside the predicate.

A killed or failed CONCURRENTLY build leaves an **INVALID** index of the same
name. The planner never uses it, and it may be incomplete — rows the failed
build never reached are not in it, so conflicts against them are not
detected — so it cannot be trusted as the dedupe. Yet
``IF NOT EXISTS`` would see the name and skip the rebuild. So before the
CREATE, the upgrade looks the index up in ``pg_index``, and if it exists with
``indisvalid = false`` it is dropped (CONCURRENTLY) and rebuilt. A re-run
therefore always ends with a valid index or a loud failure, never a silent
invalid one.

Downgrade drops the index (CONCURRENTLY), then both columns. Questions survive.

Revision ID: agent_questions_alert_episode_01
Revises: coord_alerts_claim_01
Create Date: 2026-09-18

"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "agent_questions_alert_episode_01"
down_revision: str | Sequence[str] | None = "coord_alerts_claim_01"
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
    """Add ``alert_id`` + ``alert_key``, then the partial unique index. Idempotent."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            ADD COLUMN IF NOT EXISTS alert_id  BIGINT,
            ADD COLUMN IF NOT EXISTS alert_key TEXT
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")

    with op.get_context().autocommit_block():
        # A failed earlier CONCURRENTLY build leaves an INVALID index that
        # IF NOT EXISTS would keep. Drop it so the CREATE below rebuilds it.
        if _index_is_invalid("uq_agent_questions_open_alert_episode"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.uq_agent_questions_open_alert_episode"
            )
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook statically checks that every CREATE/DROP names its
        # schema.
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_agent_questions_open_alert_episode
            ON coord.agent_questions (tenant_id, alert_id)
            WHERE alert_id IS NOT NULL AND responded_at IS NULL
            """
        )


def downgrade() -> None:
    """Drop the index, then both columns. The questions survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.uq_agent_questions_open_alert_episode"
        )

    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_questions
            DROP COLUMN IF EXISTS alert_key,
            DROP COLUMN IF EXISTS alert_id
        """
    )
    op.execute("RESET lock_timeout")
