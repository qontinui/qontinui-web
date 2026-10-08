"""runner-as-CI-node — seed qontinui-runner's ci_node lane to require os:windows

Revision ID: cinode_04_runner_requires_windows
Revises: cinode_02_required_capabilities
Create Date: 2026-10-08

Phase 4b of plan
``2026-09-27-ci-node-shadow-dispatch-never-passes-checkout-race-lost-leases-unfiltered-selection``
(the data half; the DDL half is ``cinode_02_required_capabilities``).

``cinode_02`` added ``coord.canonical_repos.ci_node_required_capabilities``
defaulting every row to ``[]`` — "no requirement", which Phase 4c's
``d.capabilities @> <column>`` filter matches against every device. This
revision sets ``qontinui/qontinui-runner`` to ``["os:windows"]``. Its
``ci_node`` lane is the Windows leg (plan
``2026-09-27-arm-ci-node-dispatch-for-runner-windows-leg``; every one of the
1984 historic dispatches ran on the Windows device ``spaceship``), so without
this row the OS filter ships inert for the only repo that has a ``ci_node``
lane. The token is the runner's ``capabilities`` vocabulary (qontinui-runner
``fleet.rs`` ``build_device_capabilities``).

Why a revision of its own: it is a single-row data seed, and coord's merge-train
migration classifier (qontinui-coord ``pr_merge/migration_classifier.rs``)
rejects every ``UPDATE`` as data DML. Kept out of ``cinode_02`` so the DDL
lands through the train unaided; this one needs an audited operator override.

Guarded both ways: the upgrade writes only while the row still holds the
default ``[]``, so a value set since (by an operator, or a re-run) is never
overwritten; the downgrade resets to ``[]`` only while the row still holds
exactly the seeded value. On a database with no runner row (fresh or test
DBs) both directions touch nothing.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cinode_04_runner_requires_windows"
down_revision: str | None = "cinode_02_required_capabilities"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Seed the runner row while it still holds the default. Idempotent."""
    op.execute(
        """
        UPDATE coord.canonical_repos
           SET ci_node_required_capabilities = '["os:windows"]'::jsonb
         WHERE repo = 'qontinui/qontinui-runner'
           AND ci_node_required_capabilities = '[]'::jsonb
        """
    )


def downgrade() -> None:
    """Reset the runner row only while it still holds the seeded value."""
    op.execute(
        """
        UPDATE coord.canonical_repos
           SET ci_node_required_capabilities = '[]'::jsonb
         WHERE repo = 'qontinui/qontinui-runner'
           AND ci_node_required_capabilities = '["os:windows"]'::jsonb
        """
    )
