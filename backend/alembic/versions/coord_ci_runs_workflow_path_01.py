"""coord.ci_runs: add ``workflow_path`` -- the run's workflow FILE path.

Plan ``2026-11-17-red-main-fix-qualifies-matches-a-validation-red-by-display-name-not-path``
Phase 2.

coord's red-main-fix lane qualifies a PR head against a main tip whose workflow
file FAILS VALIDATION. That red row is keyed by the workflow file's path
(``.github/workflows/ci.yml``), because GitHub names a run that never parsed by
its path. Today coord can only compare the head's ``pull_request`` runs by
DISPLAY name (``ci_runs.workflow_name``), which has two failure modes:

* a fix that also edits the file's ``name:`` key never qualifies, because its
  run carries the new display name;
* two workflow files sharing a display name cross-qualify.

GitHub's ``workflow_run.path`` is exact, unique per file, and unchanged by a
rename. coord writes it here (with any ``@<ref>`` suffix stripped) from the
webhook, the runs-list observer and the poll backstop, and matches validation
rows by it, falling back to the display name for rows written before this
column existed.

Nullable, no default, no index: rows observed before coord's ingest change stay
NULL, and that NULL is the fallback signal. Nothing filters on the column alone;
the one read (``red_main_fix_ids_for_repo``) already selects by ``repo`` and
``head_sha``. Additive and idempotent (``IF NOT EXISTS`` / ``IF EXISTS``).

The coord PR is labelled ``coord:downstream-of`` this one; coord carries a
column-missing fallback for both the write and the read, so a coord deploy that
precedes this migration in production degrades to today's behaviour rather than
failing.

``down_revision`` is the repo's single local alembic head at authoring time
(``ScriptDirectory.get_heads()`` on ``origin/main`` ``4e69e26a5``); coord
re-points it at land time if the chain moved.

Revision ID: coord_ci_runs_workflow_path_01
Revises: coord_iops_idx_02
Create Date: 2026-11-17
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_runs_workflow_path_01"
down_revision: str | Sequence[str] | None = "coord_iops_idx_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE coord.ci_runs ADD COLUMN IF NOT EXISTS workflow_path TEXT")
    op.execute(
        "COMMENT ON COLUMN coord.ci_runs.workflow_path IS "
        "'The run''s workflow FILE path (GitHub workflow_run.path, @ref stripped), "
        "e.g. .github/workflows/ci.yml. Exact and rename-stable, unlike workflow_name. "
        "NULL for rows observed before coord wrote it.'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE coord.ci_runs DROP COLUMN IF EXISTS workflow_path")
