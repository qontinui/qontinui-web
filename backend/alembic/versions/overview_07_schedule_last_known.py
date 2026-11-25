"""overview.schedule_last_known: when a schedule figure was last known from coord

Revision ID: overview_07_schedule_last_known
Revises: cfgyaml02_config_yaml_read_sha
Create Date: 2026-11-25

Plan ``2026-11-25-overview-timeline-and-milestones-derive-from-coord`` D4/D8.
The overview's ``GET /overview/schedule`` derives phases, milestones and gates
from coord on read. When coord cannot answer, the page says "Not available
since <date>"; that date is the last time the SAME figure WAS known, which is
what this table keeps: one row per ``(tenant_id, figure)``.

Hand-authored (never ``alembic revision --autogenerate``: alembic is the sole
author of ``coord.*`` and this repo's discipline is the same for ``overview.*``).

The table holds a figure NAME and an instant, no coord data and no entered
value, and is written only by the schedule read path. Every query on it
filters on ``tenant_id`` (the primary key's leading column), as every other
overview table does; there is no foreign key because tenants live in coord.

Written to be provably additive for coord's migration classifier: one guarded
``CREATE TABLE IF NOT EXISTS`` with constraints inline (a new table holds no
rows) and no index beyond the primary key.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_07_schedule_last_known"
down_revision: str | Sequence[str] | None = "cfgyaml02_config_yaml_read_sha"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS overview.schedule_last_known (
            tenant_id uuid NOT NULL,
            figure text NOT NULL,
            last_known_at timestamptz NOT NULL,
            CONSTRAINT pk_overview_schedule_last_known
                PRIMARY KEY (tenant_id, figure)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS overview.schedule_last_known")
