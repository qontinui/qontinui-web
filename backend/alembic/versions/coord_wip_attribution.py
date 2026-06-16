"""coord.wip_attribution per-file WIP authorship store

Revision ID: coord_wip_attribution
Revises: autoresp01autoresprules
Create Date: 2026-06-14

Phase 1 of plan
``D:/qontinui-root/plans/2026-06-14-coord-wip-authorship-attribution.md``.

Stands up ``coord.wip_attribution``: one row per uncommitted file per
device checkout, recording who most recently edited it and which
sessions have touched it during the current WIP epoch. Joins 1:1 against
the entries in ``coord.primary_trees.dirty_files`` — ``file`` is the
repo-relative path exactly as ``git status --porcelain`` reports it
(forward slashes), so the two surfaces line up per ``(device_id, repo,
file)``.

Schema:

* ``device_id UUID``          — FK to ``coord.devices(device_id)`` ON
  DELETE CASCADE. Same registry ``coord.primary_trees`` references.
* ``repo TEXT``               — repository name, e.g. ``qontinui-runner``.
* ``file TEXT``               — repo-relative path as ``git status
  --porcelain`` reports it (forward slashes), matching an entry in
  ``coord.primary_trees.dirty_files``. ``file`` is a valid unquoted
  PostgreSQL identifier (not a reserved keyword), used unquoted just as
  ``repo`` is.
* ``last_writer_session UUID`` — Claude Code session UUID of the most
  recent edit. Nullable: the hook may run in a session with no
  resolvable id.
* ``last_writer_agent TEXT``   — optional human-readable agent label.
  Reserved for future use; nullable.
* ``contributors JSONB``       — JSONB array (used as a set) of
  session-id strings that touched this file during the current WIP epoch
  (since the file last went clean). Defaults to ``'[]'``.
* ``last_edit_at TIMESTAMPTZ`` — server-stamped time of the most recent
  attribution event. Defaults to ``now()``.
* ``tenant_id UUID``           — resolved server-side from ``device_id``
  (mirrors ``coord.primary_trees.tenant_id``). Nullable.

Composite primary key ``(device_id, repo, file)`` — one row per
uncommitted file per device checkout, matching the per-file UPSERT
pattern the attribution writer uses.

Indices:

* ``idx_wip_attribution_device_repo`` — per-checkout lookup
  ``(device_id, repo)`` for the join against ``coord.primary_trees``.
* ``idx_wip_attribution_tenant`` — partial on ``tenant_id`` for
  tenant-scoped reads (skips the common NULL rows).
* ``idx_wip_attribution_session`` — partial on ``last_writer_session``
  for last-writer reverse lookups (skips NULL rows).

Idempotency: ``CREATE TABLE IF NOT EXISTS`` and ``CREATE INDEX IF NOT
EXISTS`` throughout — same posture as ``coord.primary_trees`` /
``coord.alerts`` (alembic canonical, runtime self-heal is the recovery
path per [[feedback_canonical_db_behind_alembic]]).

Chains off ``autoresp01autoresprules`` — the current single linear alembic
tip on origin/main (re-pointed during a rebase: sibling migrations
``coord_plan_pr_citations`` → ``coord_gate_progress_samples`` →
``autoresp01autoresprules`` landed off the same ``chkguard_02_parked_pr_head_sha``
parent this migration originally used, so it was re-based onto the new tip to
keep a single head).
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_wip_attribution"
down_revision: str = "autoresp01autoresprules"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.wip_attribution`` + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.wip_attribution (
            device_id           UUID NOT NULL
                REFERENCES coord.devices(device_id) ON DELETE CASCADE,
            repo                TEXT NOT NULL,
            file                TEXT NOT NULL,
            last_writer_session UUID,
            last_writer_agent   TEXT,
            contributors        JSONB NOT NULL DEFAULT '[]'::jsonb,
            last_edit_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            tenant_id           UUID,
            PRIMARY KEY (device_id, repo, file)
        )
        """
    )
    # Per-checkout lookup joining against coord.primary_trees.dirty_files.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_wip_attribution_device_repo
            ON coord.wip_attribution (device_id, repo)
        """
    )
    # Tenant-scoped reads; skip the common NULL rows.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_wip_attribution_tenant
            ON coord.wip_attribution (tenant_id)
            WHERE tenant_id IS NOT NULL
        """
    )
    # Last-writer reverse lookups; skip NULL rows.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_wip_attribution_session
            ON coord.wip_attribution (last_writer_session)
            WHERE last_writer_session IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop ``coord.wip_attribution`` and its indices."""
    op.execute("DROP INDEX IF EXISTS coord.idx_wip_attribution_session")
    op.execute("DROP INDEX IF EXISTS coord.idx_wip_attribution_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_wip_attribution_device_repo")
    op.execute("DROP TABLE IF EXISTS coord.wip_attribution")
