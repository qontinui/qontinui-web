"""project.design_policies — tenant-scoped user-authored design/UX policies.

Revision ID: design_policies_01
Revises: merged_count_01_merged_at_idx
Create Date: 2026-07-02

Advisory design guidance authored by tenant admins and read tool-agnostically
by AI agents / CI over ``GET /api/v1/design-policies``. Distinct from
``coord.policy_rules`` (runtime automations the decision engine executes) — this
is a first-party web table following the ``project.finding_category_configs``
pattern, tenant-scoped rather than user-scoped.

Raw ``op.execute`` with ``IF NOT EXISTS`` — the collision-safe convention used
across the project/coord migrations.

Chain position: this revision is the THIRD and last link of a three-PR linear
chain authored 2026-07-26 to clear the ``alembic-heads-pr`` gate on three PRs
that had each forked the chain (the original ``down_revision``,
``auto_fix_rm_flaky_01``, already had a child — ``pr_shepherd_retire_01`` — on
main):

    coord_sm_to_handle            (main head)
      -> coord_footprint_drift_events   (PR #789)
      -> merged_count_01_merged_at_idx  (PR #861)
      -> design_policies_01             (this revision, PR #706)

The three have NO data dependency on one another (distinct tables in distinct
schemas), so the order is purely a landing order; this PR is last because it is
by far the largest and oldest, so gating the other two behind it would be the
worst of the three choices. The order is self-enforcing, which is why no coord
dep labels are needed (and per fleet policy must not be added) — the
``down_revision`` chain IS the ordering.

READ THIS BEFORE "FIXING" A RED CHECK ON THIS PR. Until PR #861 lands
``merged_count_01_merged_at_idx`` on main, this branch's tree does not contain
that parent, and the checks below are EXPECTED to be red. They go green on their
own once #861 lands and this branch is rebased (coord's dry-rebase +
``merge-candidate/**`` push re-runs them). Nothing here needs a code change:

* ``alembic-heads-pr`` — reports two heads (``coord_sm_to_handle`` and this
  one). This is the honest message and matches the gate's own guidance.
* ``Migration Reversal Gate`` / ``reverse`` / ``Spec CI`` / ``Run Tests``
  (``test_coord_session_substrate_migration``,
  ``test_memory_links_migration``) / ``Backend E2E Tests`` — these run
  real ``alembic heads`` / ``alembic upgrade head``, and alembic does NOT report
  an extra head for a parent that is absent: it raises a ``KeyError`` naming the
  missing parent revision during revision-map construction, and exits non-zero
  with EMPTY stdout. (Do not paste that traceback line back into this docstring
  as a quoted literal — gitleaks' ``generic-api-key`` rule reads
  ``KeyError`` followed by a quoted high-entropy token as a secret and reds the
  ``Gitleaks Secret Detection`` check.) ``migration-reversal.yml``'s
  skip-on-multi-head guard therefore does not fire (it computes ``HEADS`` from
  stdout, which is empty, so it sees 0 — not >1) and the job falls through to
  ``alembic upgrade head`` and crashes. The red reads like a broken migration;
  it is not. Hardening that guard to also skip on a non-zero ``alembic heads``
  exit is a separate workflow fix, deliberately not bundled into this PR.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "design_policies_01"
down_revision: str | None = "merged_count_01_merged_at_idx"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS project")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project.design_policies (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID NOT NULL,
            slug         VARCHAR(100) NOT NULL,
            name         VARCHAR(255) NOT NULL,
            principle    TEXT NOT NULL DEFAULT '',
            rationale    TEXT NOT NULL DEFAULT '',
            enforcement  TEXT NOT NULL DEFAULT '',
            category     VARCHAR(50) NOT NULL DEFAULT '',
            severity     VARCHAR(20) NOT NULL DEFAULT 'info',
            applies_to   VARCHAR(255) NOT NULL DEFAULT '',
            is_built_in  BOOLEAN NOT NULL DEFAULT false,
            sort_order   INTEGER NOT NULL DEFAULT 0,
            enabled      BOOLEAN NOT NULL DEFAULT true,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_by   VARCHAR(255),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by   VARCHAR(255),
            CONSTRAINT uq_design_policy_tenant_slug UNIQUE (tenant_id, slug)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_project_design_policies_tenant_id
            ON project.design_policies (tenant_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS project.design_policies")
