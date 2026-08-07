"""devenv_08: per-machine CI-node configuration authored on qontinui.io

Revision ID: devenv_08_ci_node_config
Revises: coord_alerts_pagedidx_01
Create Date: 2026-08-07

Phase 4 of plan ``2026-08-07-runner-local-ci-parity-and-web-configuration``.
The runner's ``CiNodeSettings`` (``qontinui-runner/src-tauri/src/settings.rs``)
had exactly one editor: a text editor on the runner's own settings.json. This
adds the three columns that let ``/environments/machines`` author it instead.

* ``ci_node_config JSONB`` — the DESIRED settings envelope
  (``enabled`` / ``max_concurrent_builds`` / ``repo_allowlist`` /
  ``min_free_disk_gb``). NULL means "this surface has never spoken about the
  machine", which is deliberately distinct from ``{"enabled": false, ...}``:
  the former leaves the runner's file untouched, the latter is an explicit
  instruction to turn CI off.
* ``ci_node_requested_at`` — when the owner last saved.
* ``ci_node_dispatched_at`` — when coord last ACCEPTED the directive for
  delivery. Accepted is not applied; coord's ``events.ci.*`` fanout is
  fire-and-forget and the runner sends no ack, so this timestamp can never be
  rendered as "in effect".

Why a JSONB envelope rather than four typed columns: the shape's authority is
the Rust ``CiNodeSettings`` struct, not this table. Mirroring it as columns
would mean a migration every time that struct gains a field, and web would
still have to validate against the runner's rules. One envelope, validated by
the pydantic schema that mirrors the struct, keeps the coupling in ONE place.

Additive and nullable throughout — safe for a running app on the prior schema,
and reversible (``downgrade`` drops exactly the three columns it added).

``down_revision`` chains behind the single live head at authoring time,
``coord_alerts_pagedidx_01``.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers
revision = "devenv_08_ci_node_config"
down_revision = "coord_alerts_pagedidx_01"
branch_labels = None
depends_on = None

_SCHEMA = "devenv"


def upgrade() -> None:
    op.add_column(
        "machines",
        sa.Column("ci_node_config", JSONB, nullable=True),
        schema=_SCHEMA,
    )
    op.add_column(
        "machines",
        sa.Column("ci_node_requested_at", sa.DateTime(timezone=True), nullable=True),
        schema=_SCHEMA,
    )
    op.add_column(
        "machines",
        sa.Column("ci_node_dispatched_at", sa.DateTime(timezone=True), nullable=True),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("machines", "ci_node_dispatched_at", schema=_SCHEMA)
    op.drop_column("machines", "ci_node_requested_at", schema=_SCHEMA)
    op.drop_column("machines", "ci_node_config", schema=_SCHEMA)
