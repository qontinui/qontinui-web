"""runner-as-CI-node — coord.canonical_repos.ci_node_required_capabilities

Revision ID: cinode_02_required_capabilities
Revises: coord_agent_questions_effect
Create Date: 2026-09-27

Phase 4b of plan
``2026-09-27-ci-node-shadow-dispatch-never-passes-checkout-race-lost-leases-unfiltered-selection``
(the web DDL half of "coord selection filters on OS and repo allowlist").

coord's ``select_ci_node_device`` (qontinui-coord ``ci_dispatch.rs``) elects a
``ci_node`` device for a candidate build without looking at the device's OS.
coord has no other place to learn which OS a repo's lane needs: the lane's
manifest (``.qontinui/ci.toml``) is read runner-side, from the checked-out
tree, after the device has already been chosen. This revision gives coord that
fact as a per-repo column:

* ``ci_node_required_capabilities JSONB NOT NULL DEFAULT '[]'`` — a JSON array
  of capability tokens a device MUST advertise in ``coord.devices.capabilities``
  to be electable for this repo's ``ci_node`` lane. Phase 4c filters with
  ``d.capabilities @> <this column>``, so ``[]`` (every repo but the one seeded
  below) matches every device and changes nothing. The tokens are the runner's
  authoritative ``capabilities`` vocabulary (``os:<os>``, ``ci_node``, …;
  qontinui-runner ``fleet.rs`` ``build_device_capabilities``), NOT the
  monotonic ``ci_runner_labels`` warmth labels.

The repo-allowlist half of Phase 4 is deliberately NOT stored here. Phase 4c
matches the ``ci_repo:<slug>`` / ``ci_repo:<basename>`` token a device
advertises (Phase 4a) against the repo being dispatched, which coord derives
from the repo itself; writing ``ci_repo:<this repo>`` into this column would be
a second copy of a value the row's own ``repo`` already carries.

A CHECK pins the shape coord's ``@>`` relies on: a JSON array whose every
element is a string. ``@>`` against an object, or an array holding a number,
is not an error — it silently matches nothing or everything — so the malformed
value is refused at write time instead.

Seed: ``qontinui/qontinui-runner`` gets ``["os:windows"]``. Its ``ci_node``
lane is the Windows leg (plan ``2026-09-27-arm-ci-node-dispatch-for-runner-windows-leg``;
every one of the 1984 historic dispatches ran on the Windows device
``spaceship``), so an unseeded column would ship the OS filter inert for the
only repo that has a ``ci_node`` lane. The seed is guarded on the column still
holding the default, so a re-run never overwrites a value set since. On a
database with no such row (fresh or test DBs) the UPDATE touches nothing.

Additive only: a coord build that does not read the column is unaffected, and
Phase 4c gates its read through ``schema_readiness``. All DDL is idempotent
(IF NOT EXISTS / catalog-guarded), matching ``cinode_01_dispatch_ledger``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cinode_02_required_capabilities"
down_revision: str | None = "coord_agent_questions_effect"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add + constrain + comment + seed the column. Idempotent."""
    # NOT NULL DEFAULT '[]' backfills every existing row to "no requirement"
    # (today's selection) in the same statement.
    op.execute(
        """
        ALTER TABLE coord.canonical_repos
            ADD COLUMN IF NOT EXISTS ci_node_required_capabilities
                JSONB NOT NULL DEFAULT '[]'::jsonb
        """
    )
    # ADD COLUMN IF NOT EXISTS cannot attach the CHECK on the re-run path, so
    # the constraint is added separately and idempotently.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ck_canonical_repos_ci_node_required_capabilities'
                  AND conrelid = 'coord.canonical_repos'::regclass
            ) THEN
                ALTER TABLE coord.canonical_repos
                    ADD CONSTRAINT ck_canonical_repos_ci_node_required_capabilities
                    CHECK (
                        jsonb_typeof(ci_node_required_capabilities) = 'array'
                        AND NOT jsonb_path_exists(
                            ci_node_required_capabilities,
                            'strict $[*] ? (@.type() != "string")',
                            silent => true
                        )
                    );
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.canonical_repos.ci_node_required_capabilities IS
            'JSON array of capability tokens (e.g. os:windows) a device must advertise in coord.devices.capabilities '
            'to be electable for this repo''s ci_node lane; coord select_ci_node_device filters with capabilities @> this. '
            '[] = no requirement. The repo allowlist is matched separately via the device''s ci_repo:<repo> token, not stored here.'
        """
    )
    op.execute(
        """
        UPDATE coord.canonical_repos
           SET ci_node_required_capabilities = '["os:windows"]'::jsonb
         WHERE repo = 'qontinui/qontinui-runner'
           AND ci_node_required_capabilities = '[]'::jsonb
        """
    )


def downgrade() -> None:
    """Drop the constraint and the column (the seed goes with it). Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.canonical_repos
            DROP CONSTRAINT IF EXISTS ck_canonical_repos_ci_node_required_capabilities
        """
    )
    op.execute(
        """
        ALTER TABLE coord.canonical_repos
            DROP COLUMN IF EXISTS ci_node_required_capabilities
        """
    )
