"""widen coord.auth_observations.coverage REAL -> double precision

Revision ID: twin_auth_02_coverage_float8
Revises: d6e7f8a9b0c1
Create Date: 2026-06-10

``twin_auth_01_coord_auth_observations`` created ``coverage`` as
``postgresql.REAL()`` (float4), but the coord writer binds a Rust
``Option<f64>`` — tokio-postgres maps ``f64`` to ``float8`` ONLY, so EVERY
``persist_observations`` call has failed since the table shipped
(``error serializing parameter 5: cannot convert between the Rust type
`core::option::Option<f64>` and the Postgres type `float4```, warned
best-effort each 300s tick) and the table has never held a row. The sibling
``coord.config_observations`` got this right (``sa.Float(precision=53)`` =
double precision); this aligns ``auth_observations.coverage`` with it.

The table is empty (every insert failed), so the ALTER is instant and the
downgrade is lossless.
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_auth_02_coverage_float8"
down_revision: Union[str, None] = "d6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "auth_observations",
        "coverage",
        type_=sa.Float(precision=53),
        existing_nullable=True,
        schema="coord",
    )


def downgrade() -> None:
    op.alter_column(
        "auth_observations",
        "coverage",
        type_=sa.REAL(),
        existing_nullable=True,
        schema="coord",
    )
