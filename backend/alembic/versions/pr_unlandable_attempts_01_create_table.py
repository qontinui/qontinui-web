"""coord.pr_unlandable_attempts — create table with composite unique key

Revision ID: pr_unlandable_attempts_01_create_table
Revises: gateverdict_01_misconfigured
Create Date: 2026-06-25

Creates the ``coord.pr_unlandable_attempts`` table for tracking spawn attempts
on unlandable PRs. The dedup key is *composite* ``(pr_number, head_sha, tier)``
to ensure that a new attempt on the same PR with a new head_sha or different
tier is not suppressed by a stale marker from a previous attempt.

This is critical: the original bug used ``ON CONFLICT (pr_number) DO UPDATE``,
which overwrote the marker unconditionally. With a composite key, only exact
matches (same PR, same head_sha, same tier) are deduplicated.

## Schema

- ``pr_id`` — Composite key string "{repo}#{pr_number}" (convenience for lookups)
- ``repo`` — Repository name
- ``pr_number`` — PR number (i32)
- ``head_sha`` — Git head SHA at spawn time
- ``tier`` — Escalation tier (0, 1, 2+)
- ``spawned_at`` — Timestamp of the spawn attempt

The composite unique constraint ``(pr_number, head_sha, tier)`` is a partial
natural key: within the `unlandable_lifecycle` sweep, a (PR, head_sha, tier)
tuple is unique. If the PR re-opens or resets to a new head_sha, it can be
spawned again because the (head_sha, tier) pair is different.

Deletion on PR terminal state (MERGED or CLOSED) happens in the engine
via a best-effort DELETE; the cleanup is not guaranteed by constraint but
is a liveness optimization to prevent stale markers from suppressing
re-open attempts.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_unlandable_attempts_01_create_table"
down_revision: str | Sequence[str] | None = "gateverdict_01_misconfigured"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pr_unlandable_attempts",
        sa.Column("pr_id", sa.String(length=100), nullable=False),
        sa.Column("repo", sa.String(length=255), nullable=False),
        sa.Column("pr_number", sa.Integer(), nullable=False),
        sa.Column("head_sha", sa.String(length=40), nullable=False),
        sa.Column("tier", sa.Integer(), nullable=False),
        sa.Column(
            "spawned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("pr_number", "head_sha", "tier", name="pr_unlandable_attempts_composite_key"),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_table("pr_unlandable_attempts", schema="coord")
