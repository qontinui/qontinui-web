"""coord.pr_check_runs_latest — latest check-run attempt per check name

Revision ID: coord_pr_check_runs_latest_view
Revises: coord_agent_debug_01_outbound_worker_scheduler_webhook
Create Date: 2026-07-14

Adds the ``coord.pr_check_runs_latest`` view: the single definition of
"the latest attempt per check name" for a given ``(repo, head_sha)``.

The bug this closes
-------------------
``coord.pr_check_runs`` keys on ``(repo, check_id)`` and legitimately
stores EVERY GitHub check-run attempt — that history is correct and is
deliberately preserved. But when a CI run is cancelled and re-run on the
SAME head SHA, GitHub mints a NEW ``check_id``, so two rows end up
sharing ``(repo, head_sha, name)``: a ``cancelled`` corpse and the
``success`` re-run.

Eleven coord readers compute a pass/fail verdict off this table without
deduping per check name. The ``cancelled`` corpse therefore outvotes the
green re-run and a genuinely green PR reads as CI-failed — poisoning the
CI verdict for that head SHA permanently, since no reader ever discards
the superseded attempt. Readers migrate onto this view so the corpse is
never counted.

Shape
-----
``SELECT DISTINCT ON (repo, head_sha, name) *`` ordered by
``(repo, head_sha, name, started_at DESC NULLS LAST, check_id DESC)``.
Mirrors the ``coord.memories_latest`` idiom (``SELECT DISTINCT ON (name)
* ... ORDER BY name, version DESC``).

* ``SELECT *`` — NOT a column list — is REQUIRED. Readers need the full
  projection (``status``, ``conclusion``, ``completed_at``,
  ``updated_at``, ``check_id``, ``name``, ``details_url``,
  ``started_at``); a narrow list would break them.
* ``started_at`` is ``TIMESTAMPTZ NULL``, so ``NULLS LAST`` is
  load-bearing: without it a queued attempt with a NULL ``started_at``
  would sort FIRST under Postgres' ``DESC`` default of ``NULLS FIRST``
  and win the ``DISTINCT ON`` — reintroducing the very bug this view
  exists to close.
* ``check_id`` is ``BIGINT NOT NULL`` (a PK component) and monotonic from
  GitHub, so it is a sound deterministic tie-break when two attempts
  share a ``started_at``.

No index is added: the sole existing index
``idx_pr_check_runs_head_sha (repo, head_sha)`` already covers the
per-SHA lookup readers issue, and the residual sort is over a handful of
rows per SHA.

Idempotency: ``CREATE OR REPLACE VIEW`` — no ``IF NOT EXISTS`` clause is
needed or available; re-applying the migration just rebuilds the view.

Chains off ``coord_agent_debug_01_outbound_worker_scheduler_webhook``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pr_check_runs_latest_view"
down_revision: str = "coord_agent_debug_01_outbound_worker_scheduler_webhook"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.pr_check_runs_latest``. Idempotent."""
    # CREATE OR REPLACE VIEW is idempotent without an IF NOT EXISTS
    # clause; re-applying the migration just rebuilds it.
    op.execute(
        """
        CREATE OR REPLACE VIEW coord.pr_check_runs_latest AS
            SELECT DISTINCT ON (repo, head_sha, name) *
            FROM coord.pr_check_runs
            ORDER BY repo, head_sha, name, started_at DESC NULLS LAST, check_id DESC
        """
    )


def downgrade() -> None:
    """Drop the view. The underlying table is untouched."""
    op.execute("DROP VIEW IF EXISTS coord.pr_check_runs_latest")
