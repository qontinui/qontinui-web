"""coord.canonical_repos registry (VCS-substrate Phase 0)

Revision ID: coord_canonical_repos
Revises: workflow_mirror_2026_05_23
Create Date: 2026-05-23

Phase 0 of the coord-as-VCS-substrate plan.

Stands up ``coord.canonical_repos``: one row per repo that coord
reconciles against its GitHub upstream. The mirror reconciler
(``qontinui-coord/src/canonical_repos.rs``) fetches each registered
repo's upstream on an interval, records the observed
``{coord_main_sha, github_main_sha, drift, error}`` snapshot into
``mirror_state`` (JSONB), and bumps ``last_reconciled_at``.

This is the **foundation** for coord owning canonical git per repo. The
production cutover (flipping agents' working origin from GitHub to coord)
is DEFERRED and out of scope for Phase 0; pre-cutover ``coord_main_sha``
and ``github_main_sha`` are equal by construction (both read from the
same mirror), so the reconciler's value today is proving the fetch ran
and surfacing the drift gauge.

Schema:

* ``id UUID``                  — surrogate PK (uuid v4, app-generated).
* ``repo TEXT``                — full owner/name slug, e.g.
  ``qontinui/qontinui-coord``. ``UNIQUE`` (one row per repo).
* ``github_remote TEXT``       — clone/fetch URL the reconciler uses
  for upstream (e.g. ``https://github.com/qontinui/qontinui-coord.git``).
* ``mirror_state JSONB``       — last-known reconcile snapshot, default
  ``'{}'::jsonb``. Shape: ``{coord_main_sha, github_main_sha, drift,
  error}``.
* ``last_reconciled_at TIMESTAMPTZ`` — when the reconciler last
  completed a cycle for this repo (NULL until first cycle).
* ``tenant_id UUID``           — NULLABLE per the house multi-tenant
  pattern (lands nullable first; NOT-NULL tightening is a deliberate
  later migration). Partial index ``WHERE tenant_id IS NOT NULL``.
* ``created_at TIMESTAMPTZ``   — row insert time.

Collision-safety: this migration uses raw ``op.execute("CREATE TABLE IF
NOT EXISTS ...")`` + ``CREATE INDEX IF NOT EXISTS`` (NOT
``op.create_table``, which would error if coord already self-healed the
table via
``qontinui-coord/src/canonical_repos.rs::ensure_canonical_repos_table``).
The two DDL paths are kept byte-identical so a row inserted via either is
the same. Same posture as ``coord.primary_trees`` / ``coord.alerts``
(alembic canonical, runtime self-heal is the recovery path per
[[feedback_canonical_db_behind_alembic]]).

Chains off ``workflow_mirror_2026_05_23`` (verified as the single
alembic head on origin/main 2026-05-23 via ``alembic heads`` per
[[feedback_verify_origin_state_before_phase_start]]).
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_canonical_repos"
down_revision: str = "workflow_mirror_2026_05_23"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.canonical_repos`` + indices. Idempotent.

    Raw SQL (not ``op.create_table``) so this is collision-safe with the
    coord runtime self-heal that may have already created the table.
    """
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.canonical_repos (
            id                  UUID NOT NULL DEFAULT gen_random_uuid(),
            repo                TEXT NOT NULL,
            github_remote       TEXT NOT NULL,
            mirror_state        JSONB NOT NULL DEFAULT '{}'::jsonb,
            last_reconciled_at  TIMESTAMPTZ,
            tenant_id           UUID,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (id),
            UNIQUE (repo)
        )
        """
    )
    # Partial tenant index — matches the house multi-tenant pattern
    # (NULLABLE tenant_id + partial index WHERE tenant_id IS NOT NULL).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_canonical_repos_tenant_id
            ON coord.canonical_repos (tenant_id) WHERE tenant_id IS NOT NULL
        """
    )
    # Reconciler ordering scan: pick the least-recently-reconciled repos
    # first. NULLS FIRST puts never-reconciled rows at the front.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_canonical_repos_last_reconciled
            ON coord.canonical_repos (last_reconciled_at NULLS FIRST)
        """
    )


def downgrade() -> None:
    """Drop ``coord.canonical_repos`` and its indices."""
    op.execute("DROP INDEX IF EXISTS coord.idx_canonical_repos_last_reconciled")
    op.execute("DROP INDEX IF EXISTS coord.idx_canonical_repos_tenant_id")
    op.execute("DROP TABLE IF EXISTS coord.canonical_repos")
