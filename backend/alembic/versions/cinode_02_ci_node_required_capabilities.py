"""runner-as-CI-node — coord.canonical_repos.ci_node_required_capabilities

Revision ID: cinode_02_required_capabilities
Revises: policy_rules_agent_name_uq_01
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

* ``ci_node_required_capabilities JSONB DEFAULT '[]'`` — a JSON array of
  capability tokens a device MUST advertise in ``coord.devices.capabilities``
  to be electable for this repo's ``ci_node`` lane. Phase 4c filters with
  ``d.capabilities @> <this column>``, so ``[]`` (every row after this
  revision) matches every device and changes nothing. The tokens are the
  runner's authoritative ``capabilities`` vocabulary (``os:<os>``,
  ``ci_node``, …; qontinui-runner ``fleet.rs`` ``build_device_capabilities``),
  NOT the monotonic ``ci_runner_labels`` warmth labels.

The repo-allowlist half of Phase 4 is deliberately NOT stored here. Phase 4c
matches the ``ci_repo:<slug>`` / ``ci_repo:<basename>`` token a device
advertises (Phase 4a) against the repo being dispatched, which coord derives
from the repo itself; writing ``ci_repo:<this repo>`` into this column would be
a second copy of a value the row's own ``repo`` already carries.

Shape: ONE ``ALTER TABLE … ADD COLUMN IF NOT EXISTS`` statement, because that
is the shape coord's merge-train migration classifier
(qontinui-coord ``pr_merge/migration_classifier.rs``) admits without an
operator override: ``ADD COLUMN IF NOT EXISTS <name> <type> [DEFAULT <one
constant literal>] [CONSTRAINT <n> CHECK (…)]``. Three things the classifier
refuses are therefore absent on purpose:

* ``NOT NULL`` on the column ("rewrites/locks the table"). Non-nullness is
  enforced by the CHECK instead: its first conjunct is ``IS NOT NULL``, which
  matters because a CHECK otherwise passes on NULL. A NULL would make coord's
  ``@>`` yield NULL — a device that silently never matches — so it is refused
  at write time. The column's catalog nullability therefore reads ``YES``;
  the CHECK is the authority.
* A ``DO $$ … $$`` catalog guard for the constraint (dollar-quoted strings are
  fail-closed in the classifier's lexer). None is needed: the constraint is a
  column constraint of the ADD COLUMN, so ``IF NOT EXISTS`` skips column and
  constraint together on a re-run.
* The ``qontinui/qontinui-runner`` → ``["os:windows"]`` seed (data DML is
  rejected). It moved to its own stacked revision,
  ``cinode_04_runner_requires_windows``, which carries the audited operator
  override on its own PR. Until it lands, Phase 4c's OS filter is inert for
  every repo (``[]`` matches every device) — today's selection, not a
  regression.

The CHECK pins the shape coord's ``@>`` relies on: a non-null JSON array whose
every element is a string. ``@>`` against an object, or an array holding a
number, is not an error — it silently matches nothing or everything — so the
malformed value is refused at write time instead. ``strict`` mode matters: a
lax filter unwraps a nested array before testing it, so ``[["os:windows"]]``
would pass. The default is a constant, so on PostgreSQL 11+ the ADD COLUMN is
metadata-only; the CHECK is validated by one scan under the ADD COLUMN's lock
(every existing row reads the default ``[]``, which passes).

Additive only: a coord build that does not read the column is unaffected, and
Phase 4c gates its read through ``schema_readiness``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cinode_02_required_capabilities"
down_revision: str | None = "policy_rules_agent_name_uq_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the constrained column and comment it. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.canonical_repos
            ADD COLUMN IF NOT EXISTS ci_node_required_capabilities
                JSONB DEFAULT '[]'::jsonb
                CONSTRAINT ck_canonical_repos_ci_node_required_capabilities
                CHECK (
                    ci_node_required_capabilities IS NOT NULL
                    AND jsonb_typeof(ci_node_required_capabilities) = 'array'
                    AND NOT jsonb_path_exists(
                        ci_node_required_capabilities,
                        'strict $[*] ? (@.type() != "string")',
                        silent => true
                    )
                )
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.canonical_repos.ci_node_required_capabilities IS
            'JSON array of capability tokens (e.g. os:windows) a device must advertise in coord.devices.capabilities '
            'to be electable for this repo''s ci_node lane; coord select_ci_node_device filters with capabilities @> this. '
            '[] = no requirement; NULL is refused by the CHECK. The repo allowlist is matched separately via the device''s ci_repo:<repo> token, not stored here.'
        """
    )


def downgrade() -> None:
    """Drop the constraint and the column. Idempotent."""
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
