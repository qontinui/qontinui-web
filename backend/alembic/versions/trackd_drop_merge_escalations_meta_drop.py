"""Track D — drop the now-unreferenced ``coord.merge_escalations_meta`` table

coord retired the merge-specialist / escalation tier (Step 3 + Step 5 of the
merge-tier retirement). The legacy ``coord.alerts kind='merge_escalation'`` rows
were drained in ``step5drain_01_merge_escalations`` (merged), which cascade-emptied
the matching ``coord.merge_escalations_meta`` rows via the ``alert_id`` FK's
``ON DELETE CASCADE``. The last coord code that read ``coord.merge_escalations_meta``
(``sweep_resolve_stale_merge_escalations``) is deleted in qontinui-coord#746
(Track D-1). With no remaining reader, the specialist-only table is droppable.

Scope — SCHEMA DROP of one specialist-only table:

* ``upgrade()`` drops ``coord.merge_escalations_meta``. The table was created by
  ``pr_merge_05_merge_escalations_meta``; its rows already cascade-emptied when
  the alerts were drained.

* ``coord.alerts`` (shared fleet-health sink), ``coord.merge_decisions`` (LIVE —
  the engine writes ``decided_by='system'`` rows) and everything else are NOT
  touched.

Reversible: this is a schema (not data) change, so ``downgrade`` faithfully
recreates the table to match the original ``pr_merge_05_merge_escalations_meta``
``upgrade()`` definition — columns, PK, the ``alert_id`` FK to ``coord.alerts(id)``
ON DELETE CASCADE, the ``decision_id`` FK, and the
``idx_merge_escalations_meta_pr`` index.

Ordering: this migration must land AFTER qontinui-coord#746 deploys (the PR that
deletes the last reader). Declared via the ``coord:downstream-of`` PR label.

Revision ID: trackd_drop_merge_escalations_meta
Revises: coord_workunit_deps_01
Create Date: 2026-06-24 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "trackd_drop_merge_escalations_meta"
down_revision: str | None = "coord_gates_progress_cols_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the now-unreferenced specialist-only meta table."""
    op.execute("DROP TABLE IF EXISTS coord.merge_escalations_meta")


def downgrade() -> None:
    """Recreate ``coord.merge_escalations_meta`` per its original definition.

    Mirrors ``pr_merge_05_merge_escalations_meta.upgrade()`` exactly: the table
    (PK ``alert_id`` FK to ``coord.alerts(id)`` ON DELETE CASCADE, the
    ``decision_id`` FK to ``coord.merge_decisions`` ON DELETE SET NULL, and all
    other columns/defaults) plus the ``idx_merge_escalations_meta_pr`` index.
    """
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
