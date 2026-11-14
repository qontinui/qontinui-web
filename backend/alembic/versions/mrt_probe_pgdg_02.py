"""Hosted Migration Reversal re-probe -- NEVER MERGE this revision.

Plan ``2026-11-11-migration-reversal-pgdg-client-for-resolute`` Phase 3 step 1.

This revision does nothing. The fix (#2210) landed on ``main`` as c559f58d0
with a ``migration-reversal.yml`` blob (cc3631c1c) that differs from the blob
the first probe (#2211, blob 0da588827) ran: a rebase over d220ffc11 added
``ram-<N>g`` labels to the self-hosted ``runs-on`` arms. So this DRAFT pull
request, based on ``main``, adds exactly one alembic revision to start
``Migration Reversal Test`` (its ``paths:`` filter is
``backend/alembic/versions/**``) on the landed workflow. ``Migration Reversal
Tested`` must install postgresql-client-16 from PGDG and snapshot the schema
with its pg_dump.

The pull request is closed unmerged after its run, and its branch is deleted.
If this file ever reaches ``main``, delete it: it was never meant to land.

``upgrade`` and ``downgrade`` are deliberate no-ops, so up -> down -1 -> up
changes no schema.

Revision ID: mrt_probe_pgdg_02
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-14
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "mrt_probe_pgdg_02"
down_revision: str | None = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """No-op: the probe exercises the workflow, not the schema."""


def downgrade() -> None:
    """No-op: there is nothing to reverse."""
