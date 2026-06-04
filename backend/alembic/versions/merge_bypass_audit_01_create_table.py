"""merge bypass audit 01 create table

Revision ID: merge_bypass_audit_01
Revises: cred_threshold_cols_01
Create Date: 2026-06-04

Phase 3c (coded bypass policy) of
``D:/qontinui-root/plans/2026-06-03-unbypassable-autonomous-merge-gates.md``.

Creates ``coord.merge_bypass_audit`` — the append-only audit oplog for
every coded-bypass land the merge orchestrator performs. The policy
(coord ``src/bypass_policy.rs``) may land a proposal whose required CI
is red ONLY for a provable, enumerated set of spurious conditions
(``actions_outage``: the candidate ref pushed but zero check runs ever
reported across N consecutive ci-timeout cycles; ``infra_step_failure``:
retries exhausted and every failing check's failed *step* is an
enumerated pre-test infra step, proven via the GitHub jobs API). Every
such land writes one row here plus a ``bypass:<condition>`` PR comment,
so the bypass surface is reviewable and §6.2 of the plan is verifiable.

Posture: **best-effort overlay, NOT boot-gated** (the
``edit_effects``-style posture, NOT ``require_table``): the audit row
augments a land that already happened — coord must never crash-loop or
refuse to boot because this table is missing, and writes are
warn-on-fail. This decouples web/coord deploy order. Coord ships a
``#[cfg(test)]`` CREATE TABLE mirror for its DB-gated tests; alembic
(this file) remains the sole production author.

Columns:

* ``id`` — UUID PK, ``gen_random_uuid()``.
* ``proposal_id`` — UUID, nullable. The merge proposal landed via
  bypass (null for batch-level rows).
* ``batch_id`` — UUID, nullable. The batch landed via bypass (null for
  single-proposal rows).
* ``repo`` — TEXT. ``owner/name`` of the repo whose gate was bypassed.
* ``head_sha`` — TEXT. The candidate tip whose CI state was bypassed.
* ``condition`` — TEXT. The enumerated condition (``actions_outage`` /
  ``infra_step_failure``). TEXT, not a PG ENUM, per the ``coord.*``
  convention (a new condition must come with policy code + review, not
  a schema migration).
* ``reason`` — TEXT. One-line human-readable rationale (mirrors the PR
  comment body's first line).
* ``evidence`` — JSONB. The machine evidence the condition was proven
  from (failing check names/conclusions, failed step names, outage
  cycle count, job ids) — enough to re-litigate the decision later.
* ``pr_number`` — INTEGER, nullable. The PR the bypass comment was
  posted on, when known.
* ``created_at`` — TIMESTAMPTZ, ``now()``.

Index: ``(repo, created_at DESC)`` — the review surface is "recent
bypasses per repo".
"""

from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "merge_bypass_audit_01"
down_revision: Union[str, None] = "cred_threshold_cols_01"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "merge_bypass_audit",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("proposal_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("batch_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column("head_sha", sa.Text(), nullable=False),
        sa.Column("condition", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "evidence",
            sa.dialects.postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("pr_number", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="coord",
    )
    op.create_index(
        "ix_merge_bypass_audit_repo_created",
        "merge_bypass_audit",
        ["repo", sa.text("created_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_merge_bypass_audit_repo_created",
        table_name="merge_bypass_audit",
        schema="coord",
    )
    op.drop_table("merge_bypass_audit", schema="coord")
