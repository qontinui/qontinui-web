"""pr_merge phase 6 — operator escalation surface (alerts meta + resolution columns)

Revision ID: pr_merge_05_merge_escalations_meta
Revises: pr_merge_04_merge_heads
Create Date: 2026-05-21

Phase 6 D6.1 + D6.4 of the PR Merge Orchestrator
(``D:/qontinui-root/plans/2026-05-21-pr-merge-orchestrator-design.md``).

This single revision lands three coupled schema changes — coupling them
avoids a second sibling-head merge bookkeeping migration and keeps the
chain linear:

1. **``coord.merge_escalations_meta``** — sidecar table keyed by
   ``alert_id`` that carries the structured fields ``coord.alerts.detail``
   JSONB can't model with a queryable index. Phase 6 escalations are
   ``coord.alerts`` rows with ``kind='merge_escalation'`` (the alerting
   substrate is already built — see ``row_9_phase_4_01_coord_alerts``);
   the sidecar adds the PR-link / decision-link / structured-alternatives
   fields the dashboard needs to render an escalation card.

   Columns:
     * ``alert_id``          — PK FK to ``coord.alerts(id)`` ON DELETE CASCADE.
                               One row per active escalation; cascade is
                               what cleans the sidecar when an alert is
                               aged out or hard-deleted.
     * ``tenant_id``         — UUID FK to ``coord.tenants``. Redundant with
                               ``coord.alerts.tenant_id`` but kept here so
                               every read path can scope-filter without a
                               join. Cheaper at query time, costs ~16 bytes
                               per row.
     * ``repo``              — ``owner/name`` form.
     * ``pr_number``         — INTEGER. GitHub PR number.
     * ``decision_id``       — Nullable FK to ``coord.merge_decisions``.
                               Set when the specialist's decision drove
                               the escalation; NULL on system-injected
                               (uncited / low-confidence) auto-escalations
                               that didn't carry a specialist row first.
     * ``alternatives``      — JSONB array of alternative actions the
                               operator can pick. Shape:
                               ``[{"action":"approve_merge","label":"Approve squash merge",
                                  "modification":{"merge_strategy":"squash"}}, ...]``.
                               Empty array allowed; default ``'[]'::jsonb``.
     * ``suggested_action``  — TEXT, the specialist's recommended next
                               step ("rebase against main + retry"). Free-form;
                               feeds the card body.
     * ``operator_question`` — TEXT, the specialist's question to the
                               operator if any. Different from
                               ``suggested_action`` in that this is a yes/no
                               prompt, not an action label.
     * ``created_at``        — TIMESTAMPTZ NOT NULL DEFAULT now().

   Index ``idx_merge_escalations_meta_pr`` on
   ``(tenant_id, repo, pr_number)`` so the dashboard's "show me this
   PR's escalation history" lookup is index-fed.

2. **``coord.alerts.resolution_action``** + **``coord.alerts.resolution_by``**
   nullable columns. The existing schema already has ``resolved_at`` /
   ``paged_at``; Phase 6 D6.4 needs to record WHAT action the operator
   chose and WHO they were (operator_id UUID). Adding to ``coord.alerts``
   rather than the sidecar so the audit reads off a single row.

3. **``coord.merge_decisions.resolved_alert_id``** — nullable FK to
   ``coord.alerts(id)``. Set on the operator-decision row (the new
   ``decided_by='operator'`` provenance) so the audit trail joins
   alert → decision in both directions: ``merge_escalations_meta.decision_id``
   captures the original specialist-decision that drove the escalation,
   ``merge_decisions.resolved_alert_id`` captures the operator's
   response. Two pointers, two relationships, both indexed.

Idempotency: every statement is ``IF NOT EXISTS`` / ``ADD COLUMN IF NOT
EXISTS``. Re-running against an already-applied DB is a no-op.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_merge_05_merge_escalations_meta"
down_revision: str = "pr_merge_04_merge_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create merge_escalations_meta + add resolution columns to alerts/decisions."""

    # ------------------------------------------------------------------
    # 1. coord.merge_escalations_meta
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.merge_escalations_meta (
            alert_id          BIGINT      PRIMARY KEY
                              REFERENCES coord.alerts(id) ON DELETE CASCADE,
            tenant_id         UUID        NOT NULL
                              REFERENCES coord.tenants(tenant_id),
            repo              TEXT        NOT NULL,
            pr_number         INTEGER     NOT NULL,
            decision_id       UUID
                              REFERENCES coord.merge_decisions(decision_id)
                              ON DELETE SET NULL,
            alternatives      JSONB       NOT NULL DEFAULT '[]'::jsonb,
            suggested_action  TEXT,
            operator_question TEXT,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_merge_escalations_meta_pr
            ON coord.merge_escalations_meta (tenant_id, repo, pr_number)
        """
    )

    # ------------------------------------------------------------------
    # 2. coord.alerts.resolution_action + resolution_by
    # ------------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.alerts
            ADD COLUMN IF NOT EXISTS resolution_action TEXT,
            ADD COLUMN IF NOT EXISTS resolution_by     UUID
        """
    )

    # ------------------------------------------------------------------
    # 3. coord.merge_decisions.resolved_alert_id
    # ------------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.merge_decisions
            ADD COLUMN IF NOT EXISTS resolved_alert_id BIGINT
                REFERENCES coord.alerts(id) ON DELETE SET NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_merge_decisions_resolved_alert
            ON coord.merge_decisions (resolved_alert_id)
            WHERE resolved_alert_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop the meta table + the resolution columns.

    Cascade order:
    1. ``merge_decisions.resolved_alert_id`` index + column.
    2. ``alerts.resolution_*`` columns.
    3. ``merge_escalations_meta`` table (cascades via FK to alerts/decisions).
    """
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_merge_decisions_resolved_alert"
    )
    op.execute(
        "ALTER TABLE coord.merge_decisions DROP COLUMN IF EXISTS resolved_alert_id"
    )
    op.execute(
        "ALTER TABLE coord.alerts DROP COLUMN IF EXISTS resolution_by"
    )
    op.execute(
        "ALTER TABLE coord.alerts DROP COLUMN IF EXISTS resolution_action"
    )
    op.execute("DROP INDEX IF EXISTS coord.idx_merge_escalations_meta_pr")
    op.execute("DROP TABLE IF EXISTS coord.merge_escalations_meta")
