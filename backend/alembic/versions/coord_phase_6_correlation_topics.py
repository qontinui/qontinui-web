"""coord phase 6 correlation topics

Revision ID: coord_phase_6_correlation_topics
Revises: consolidation_phase7_10_final_cleanup
Create Date: 2026-05-01

Follow-up to ``coordinator_phase_6_agent_coordination_hardening`` adding
the ``coord.correlation_topics`` table that the original Phase 6 schema
migration shipped without — the topic-alias protocol resolution
(open question 4) was nailed down *after* the schema migration shipped.

The table maps a freeform agent-supplied ``topic`` string to the
correlation_id that owns it. Sibling agents discovering each other
across machines/sessions pass the topic instead of the UUID; coord
returns the correlation_id at acquire time. See plan Item 5
"Correlation-ID protocol" for the full resolution rules table.

Schema choices:

* ``topic`` is the primary key. One topic name → exactly one
  correlation_id. The acquire-time conflict case "topic already maps
  to a different correlation_id" returns 409 to the caller.
* ``CHECK`` constraint enforces the topic regex
  ``^[a-z0-9][a-z0-9-]{0,63}$`` at the DB layer too — defence in depth
  against a coord deploy regression that skips the validation.
* ``created_by_machine_id`` is a nullable FK to ``coord.machines``
  matching the convention from ``coord.claims_audit.machine_id``: a
  registered machine_id is stored, an unregistered one yields NULL on
  the audit row rather than failing the insert. Phase 6 plan §"Identity
  model".
* Index on ``correlation_id`` supports the reverse lookup "what topics
  belong to this correlation_id?" used by the future bundle-rendering
  layer.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_phase_6_correlation_topics"
down_revision: str = "consolidation_phase7_10_final_cleanup"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "correlation_topics",
        sa.Column("topic", sa.Text(), nullable=False),
        sa.Column(
            "correlation_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_by_machine_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("coord.machines.machine_id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("topic"),
        sa.CheckConstraint(
            "topic ~ '^[a-z0-9][a-z0-9-]{0,63}$'",
            name="ck_correlation_topics_topic_regex",
        ),
        schema="coord",
    )
    op.create_index(
        "idx_correlation_topics_id",
        "correlation_topics",
        ["correlation_id"],
        schema="coord",
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_correlation_topics_id")
    op.drop_table("correlation_topics", schema="coord")
