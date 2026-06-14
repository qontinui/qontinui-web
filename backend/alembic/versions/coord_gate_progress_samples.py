"""coord.gate_progress_samples — per-gate progress history for trend-ETA

Revision ID: coord_gate_progress_samples
Revises: coord_plan_pr_citations
Create Date: 2026-06-14

Authors the table that backs Phase 3 of the dev-overview gate-progress
trend-ETA, already shipped (dark) in
``qontinui-coord/src/api/dev_overview.rs``.

SqlCount / MetricThreshold gates have no intrinsic clock, so they used to
emit ``eta:null, eta_confidence:"none"``. coord now keeps a short per-gate
sample history here and fits a linear rate over it to PROJECT a clear time.
The coord side is fully FAIL-OPEN: it deploys before this migration lands
and degrades to "no estimate" while the table is absent — INSERT / DELETE /
SELECT against a missing table are swallowed (see ``sample_io``). Landing
this migration simply ACTIVATES the sampling; no coord change is required.

Column contract (must match ``dev_overview.rs::sample_io`` exactly):

* ``gate_id``        — UUID, FK ``coord.gates(gate_id)`` ON DELETE CASCADE
                       so a gate's samples vacate with it.
* ``current_value``  — DOUBLE PRECISION; the gate's observed value (f64),
                       written by the bare ``INSERT (gate_id, current_value)``.
* ``observed_at``    — TIMESTAMPTZ DEFAULT now(); the sample clock the read
                       orders by and the retention prune (~2h) bounds.

Hot path is ``WHERE gate_id = $1 AND observed_at <op> now()-interval ORDER BY
observed_at`` (read + prune both), covered by the ``(gate_id, observed_at)``
index.

Raw ``op.execute`` with ``IF NOT EXISTS`` — same collision-safe convention as
the other coord.* schema migrations (``coord_singleauthored_01_gates``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_gate_progress_samples"
down_revision: str | Sequence[str] | None = "coord_plan_pr_citations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.gate_progress_samples (
            sample_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            gate_id       UUID NOT NULL
                REFERENCES coord.gates (gate_id) ON DELETE CASCADE,
            current_value DOUBLE PRECISION NOT NULL,
            observed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_gate_progress_samples_gate_observed
            ON coord.gate_progress_samples (gate_id, observed_at)
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_gate_progress_samples_gate_observed"
    )
    op.execute("DROP TABLE IF EXISTS coord.gate_progress_samples")
