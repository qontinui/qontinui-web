"""section 5b 01 ui_bridge causal columns

Revision ID: section_5b_01_ui_bridge_causal_columns
Revises: consolidation_phase8_01_unify_runner_concepts_redo
Create Date: 2026-05-02

Section 5b of the UI Bridge redesign: causal tracing & replay support.

Adds two columns and one partial index to ``project.ui_bridge_events``:

- ``recording_session_id`` (text, nullable) — groups events that belong to
  the same recording session for later replay/inspection.
- ``caused_by_event_id`` (bigint, nullable) — self-referential FK to
  ``project.ui_bridge_events(id)`` capturing the upstream event that
  triggered this one (causal lineage).
- Partial index ``ui_bridge_events_recording_session_idx`` on
  ``recording_session_id`` ``WHERE recording_session_id IS NOT NULL`` so
  the index only stores rows that participate in a recording session.

Backs ADR-005 (causal tracing & replay) — see
``qontinui-dev-notes/ui-bridge-redesign/section-5-causal/ADR-005-causal-tracing-replay.md``,
decision #3.

DRIFT FLAGS (preserved per fidelity policy):
- The Alembic branch currently has a second, orthogonal head
  ``add_arq_job_id_to_training_jobs`` (training-jobs lineage). This
  migration intentionally does NOT merge the two heads; a future merge
  migration will reconcile them. ``down_revision`` points only at the
  consolidation chain (``consolidation_phase8_01_unify_runner_concepts_redo``)
  on which the UI Bridge tables live.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "section_5b_01_ui_bridge_causal_columns"
down_revision: str = "consolidation_phase8_01_unify_runner_concepts_redo"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ui_bridge_events",
        sa.Column("recording_session_id", sa.Text(), nullable=True),
        schema="project",
    )
    op.add_column(
        "ui_bridge_events",
        sa.Column("caused_by_event_id", sa.BigInteger(), nullable=True),
        schema="project",
    )
    op.create_foreign_key(
        "ui_bridge_events_caused_by_fk",
        "ui_bridge_events",
        "ui_bridge_events",
        ["caused_by_event_id"],
        ["id"],
        source_schema="project",
        referent_schema="project",
    )
    op.create_index(
        "ui_bridge_events_recording_session_idx",
        "ui_bridge_events",
        ["recording_session_id"],
        schema="project",
        postgresql_where=sa.text("recording_session_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ui_bridge_events_recording_session_idx",
        table_name="ui_bridge_events",
        schema="project",
    )
    op.drop_constraint(
        "ui_bridge_events_caused_by_fk",
        "ui_bridge_events",
        schema="project",
        type_="foreignkey",
    )
    op.drop_column("ui_bridge_events", "caused_by_event_id", schema="project")
    op.drop_column("ui_bridge_events", "recording_session_id", schema="project")
