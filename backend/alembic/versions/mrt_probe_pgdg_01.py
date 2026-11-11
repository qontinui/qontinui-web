"""Hosted Migration Reversal probe -- NEVER MERGE this revision.

Plan ``2026-11-11-migration-reversal-pgdg-client-for-resolute`` Phase 1 step 10.

This revision does nothing. It exists only so that a DRAFT probe pull request,
stacked on the fix branch
``agent/4b426e2bcc10-01a1cbf4671f/2026-11-11-migration-reversal-pgdg-client-for-resolute-phase``,
adds exactly one alembic revision. That starts ``Migration Reversal Test``
(its ``paths:`` filter is ``backend/alembic/versions/**``, which the fix PR
itself never touches) on the hosted ``ubuntu-latest`` image, running the fixed
workflow. ``Migration Reversal Tested`` must then install postgresql-client-16
from PGDG and snapshot the schema with its pg_dump.

The probe pull request is closed unmerged after its run, and its branch is
deleted. If this file ever reaches ``main``, delete it: it was never meant to
land.

``upgrade`` and ``downgrade`` are deliberate no-ops, so up -> down -1 -> up
changes no schema.

Revision ID: mrt_probe_pgdg_01
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-11
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "mrt_probe_pgdg_01"
down_revision: str | None = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """No-op: the probe exercises the workflow, not the schema."""


def downgrade() -> None:
    """No-op: there is nothing to reverse."""
