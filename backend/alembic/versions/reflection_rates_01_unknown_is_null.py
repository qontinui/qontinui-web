"""let two reflection measurements hold an UNKNOWN (NULL)

Revision ID: reflection_rates_01_unknown_is_null
Revises: coord_iops_idx_02
Create Date: 2026-11-09

Plan ``2026-11-09-reflection-reports-only-what-it-judged-and-the-dead-verifier-leaves-no-residue``,
Phase 1 (decision D4).

Two ``project`` columns were created unable to say "not measured":

- ``project.convergence_snapshots.effective_fix_rate`` -- created NOT NULL by
  ``consolidation_phase1_15_state_machine``. When no fix in a scope has been
  judged the rate is unknown, and the runner's only way to write a row was a
  fabricated ``1.0``.
- ``project.architecture_components.health_score`` -- created NOT NULL with a
  ``server_default`` of ``1.0`` by
  ``consolidation_phase1_18_architecture_components``. The default asserts a
  health nobody measured, so it is dropped as well. The index
  ``idx_arch_comp_health`` stays; a btree index over a nullable column is valid.

``project.component_health_snapshots.health_score`` is deliberately untouched:
no runner writer exists yet; the writer the plan adds (decision D5) will write only for a component whose health is known.

The runner carries a matching idempotent boot self-heal in ``PgDb::new``
(``qontinui-runner`` ``src-tauri/src/database/pg/mod.rs``) for runner
databases that never ran this revision; alembic remains the author.

Upgrade
------------------------------------------------------------------------------
Both columns become nullable; ``health_score`` loses its server default.
Existing values are kept as they are.

Downgrade
------------------------------------------------------------------------------
LOSSY by construction: the old schema has no way to represent an unknown, so
every NULL in either column is first rewritten to ``1.0`` -- the old
representation of "not measured" -- and then NOT NULL is restored on both
columns and ``health_score``'s server default of ``1.0`` is put back. After a
downgrade an unknown is indistinguishable from a measured ``1.0`` again.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "reflection_rates_01_unknown_is_null"
down_revision: str = "coord_iops_idx_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "convergence_snapshots",
        "effective_fix_rate",
        existing_type=sa.Float(),
        nullable=True,
        existing_nullable=False,
        schema="project",
    )
    op.alter_column(
        "architecture_components",
        "health_score",
        existing_type=sa.Float(),
        nullable=True,
        existing_nullable=False,
        server_default=None,
        existing_server_default=sa.text("1.0"),
        schema="project",
    )


def downgrade() -> None:
    # Lossy: an unknown becomes the old fabricated 1.0 (see the docstring).
    op.execute(
        "UPDATE project.convergence_snapshots SET effective_fix_rate = 1.0 WHERE effective_fix_rate IS NULL"
    )
    op.execute(
        "UPDATE project.architecture_components SET health_score = 1.0 WHERE health_score IS NULL"
    )
    op.alter_column(
        "convergence_snapshots",
        "effective_fix_rate",
        existing_type=sa.Float(),
        nullable=False,
        existing_nullable=True,
        schema="project",
    )
    op.alter_column(
        "architecture_components",
        "health_score",
        existing_type=sa.Float(),
        nullable=False,
        existing_nullable=True,
        server_default=sa.text("1.0"),
        schema="project",
    )
