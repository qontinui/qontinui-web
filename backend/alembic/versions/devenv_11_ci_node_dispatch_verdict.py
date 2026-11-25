"""devenv_11: persist the last CI-node dispatch verdict on devenv.machines

Revision ID: devenv_11_ci_node_dispatch_verdict
Revises: coord_subprojects_05_note_events
Create Date: 2026-11-25

Phase 1 of plan ``2026-11-25-ci-node-dispatch-verdict-survives-reload``.
``PUT /machines/{id}/ci-node`` returns coord's verdict on the dispatch
(``dispatch_status`` / ``dispatch_error`` / ``dispatch_detail``) but nothing
stores it, so a page reload loses it. These three nullable columns hold the
outcome of the last dispatch, scoped to the config saved at
``ci_node_requested_at``.

* ``ci_node_dispatch_status INTEGER`` — HTTP status coord answered with.
* ``ci_node_dispatch_error TEXT`` — the machine-readable refusal / outcome code.
* ``ci_node_dispatch_detail TEXT`` — the human-readable detail.

All three are NULL for every pre-existing row. NULL means "no verdict
recorded", never "delivered".

This revision lands ALONE, before the model and endpoint changes that read the
columns: a model selecting a column the database lacks would 500 every machine
read on a mixed deploy.

Shape: additive ONLY, for coord's merge-time classifier — shaped like
``cinode_05_dispatch_model_access_and_ledger``: ``ADD COLUMN IF NOT EXISTS`` of
nullable columns with no default (catalog-only, no rewrite), static
``op.execute`` literals naming ``devenv.machines``, and a ``lock_timeout`` put
back with ``SET LOCAL lock_timeout = DEFAULT``.

``down_revision`` is main's single head when authored
(``coord_subprojects_05_note_events``; ``scripts/ci/count_alembic_heads.py``
read HEAD_COUNT=1). Coord re-points it at land time if main moves again.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "devenv_11_ci_node_dispatch_verdict"
down_revision: str | Sequence[str] | None = "coord_subprojects_05_note_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the three nullable verdict columns and comment them. Idempotent."""
    # Bound the ALTER's ACCESS EXCLUSIVE wait: machines are read on every
    # environments page load and a queued exclusive lock blocks all of them.
    op.execute("SET LOCAL lock_timeout = '3s'")
    # Plain literals, never f-strings: coord's classifier admits only a STATIC
    # op.execute argument, and the `alembic-schema-arg-gate` pre-commit hook
    # parses the raw SQL to prove every statement names its schema.
    op.execute(
        """
        ALTER TABLE devenv.machines
            ADD COLUMN IF NOT EXISTS ci_node_dispatch_status INTEGER NULL,
            ADD COLUMN IF NOT EXISTS ci_node_dispatch_error TEXT NULL,
            ADD COLUMN IF NOT EXISTS ci_node_dispatch_detail TEXT NULL
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
    op.execute(
        """
        COMMENT ON COLUMN devenv.machines.ci_node_dispatch_status IS
            'HTTP status coord answered the last CI-node dispatch with, for the config '
            'saved at ci_node_requested_at. NULL = no verdict recorded, never delivered.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN devenv.machines.ci_node_dispatch_error IS
            'Outcome code of the last non-delivered CI-node dispatch, for the config '
            'saved at ci_node_requested_at. NULL = no verdict recorded, never delivered.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN devenv.machines.ci_node_dispatch_detail IS
            'Human-readable detail for ci_node_dispatch_error. '
            'NULL = no verdict recorded, never delivered.'
        """
    )


def downgrade() -> None:
    """Drop the three columns. Idempotent."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE devenv.machines
            DROP COLUMN IF EXISTS ci_node_dispatch_detail,
            DROP COLUMN IF EXISTS ci_node_dispatch_error,
            DROP COLUMN IF EXISTS ci_node_dispatch_status
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
