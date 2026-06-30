"""coord.pr_author_nudges — stuck-PR author-nudge dedup ledger

Revision ID: coord_pr_author_nudges_01
Revises: coord_work_unit_dispatches_01
Create Date: 2026-06-29

Backs the coord PR-merge orchestrator's stuck-PR author-nudge sweep
(plan ``2026-06-28-pr-stuck-author-nudge-sweep``, qontinui-coord
``src/pr_merge/stuck_author_nudge.rs``). The sweep is the SECOND in-session
continuation-delivery producer (beside ``CI_RED_TRIAGE``): a leader-gated tick
that, for an open non-mergeable non-draft PR whose only path forward is author
action (PR 1: a ``mergeStateStatus=dirty`` merge conflict), routes a typed
rework continuation to the authoring session.

This table is the per-``(repo, pr_number, reason)`` cooldown + cap dedup ledger
(mirrors coord's truth-heal cooldown/cap pattern) so a PR that sits ``dirty``
for an hour gets ONE nudge, not one per tick:

* ``repo            TEXT NOT NULL`` — ``owner/name``.
* ``pr_number       INTEGER NOT NULL`` — the PR.
* ``reason          TEXT NOT NULL`` — ``NudgeReason::code()`` (PR 1: ``merge_conflict``).
* ``first_nudged_at TIMESTAMPTZ NOT NULL DEFAULT now()`` — first nudge for this triple.
* ``last_nudged_at  TIMESTAMPTZ NOT NULL DEFAULT now()`` — drives the cooldown window
  (``COORD_PR_STUCK_NUDGE_COOLDOWN_SECS``).
* ``nudge_count     INTEGER NOT NULL DEFAULT 1`` — drives the cap (``COORD_PR_STUCK_NUDGE_MAX``).
* ``last_outcome    TEXT`` — delivered | spawned | notify_only | operator_alert.

Primary key ``(repo, pr_number, reason)`` — the natural dedup grain; coord's
``INSERT ... ON CONFLICT (repo, pr_number, reason) DO UPDATE`` is idempotent
against it.

## Schema authoring posture

alembic is the SOLE author of ``coord.*`` schema; ``qontinui-coord`` authors
ZERO ``coord.*`` DDL in its production binary (enforced by
``tests/coord_schema_authorship.rs``). Unlike the boot-asserted coord tables,
this one is OPTIONAL: the sweep is DARK behind ``COORD_PR_STUCK_AUTHOR_NUDGE_ENABLED``
(default OFF) and every access in coord is FAIL-SAFE on a missing table
(suppress rather than nudge without dedup). Coord therefore does NOT add it to
``require_table`` — the migration simply needs to APPLY before the flag is
armed, with no coord-deploy-ordering constraint while the flag is off.

Chains off ``coord_work_unit_dispatches_01`` — the live coord-chain alembic head
on main. (The migration-reserve advisory `89bb70f8` initially suggested
``config_yaml_overrides_01``, but that reservation orphaned: the sibling landed
under a DIFFERENT revision id, ``cfgyaml01_config_yaml_overrides``, leaving
``config_yaml_overrides_01`` a phantom that will never exist on main. Re-pointed
to the real head; coord's land-time re-point + the alembic-graph CI check remain
the fork backstop.)
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pr_author_nudges_01"
down_revision: str | Sequence[str] | None = "coord_work_unit_dispatches_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Idempotent: skip if a prior partial apply already created the table.
    if sa.inspect(op.get_bind()).has_table("pr_author_nudges", schema="coord"):
        return
    op.create_table(
        "pr_author_nudges",
        sa.Column("repo", sa.Text(), nullable=False),
        sa.Column("pr_number", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "first_nudged_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_nudged_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "nudge_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("last_outcome", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint(
            "repo",
            "pr_number",
            "reason",
            name="pk_pr_author_nudges",
        ),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_table("pr_author_nudges", schema="coord")
