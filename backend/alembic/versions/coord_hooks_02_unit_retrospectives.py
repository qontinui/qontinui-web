"""coord hooks 02 unit retrospectives

Revision ID: coord_hooks_02_unit_retrospectives
Revises: coord_hooks_01_hook_invocations
Create Date: 2026-05-24

Phase 5 (final) of the coord lifecycle-hook taxonomy
(``D:/qontinui-root/qontinui-dev-notes/plans/2026-05-23-coord-hook-taxonomy-phase1-plan.md``
§3 Phase 5 + §4). The first NEW behavior that attaches as a pure
``on_retrospective`` side-effect hook (Track 3a) — the per-unit
retrospective record.

Creates ``coord.unit_retrospectives`` — one row per landed work unit,
written by the ``OnRetrospectiveHook`` after the unit has already
CAS-merged (post ``finish_landed`` ``post_merge`` chain). The row records
ONLY the three signal classes that are STRUCTURALLY ABSENT from the
runner's ``WorkflowOutcome``
(``qontinui-runner/src-tauri/src/orchestrator/learning_recorder.rs:15-38``)
— per plan §4 + the honest caveat §179, NO column maps 1:1 onto a
``WorkflowOutcome`` field. The delta is the *coord-side* view the runner
physically cannot see:

* ``attempt_count`` + ``winning_attempt_id`` + ``paired_contrast`` —
  cross-attempt comparison (best-of-N). ``WorkflowOutcome`` is per-run;
  it has no unit↔attempt linkage. At N=1 this is degenerate
  (attempt_count=1, no losers) but the COLUMNS exist — they ARE the
  linkage ``WorkflowOutcome`` lacks.
* ``coord_mechanism_events`` jsonb — coord-mechanism efficacy: did verify
  catch a bug, how many rebases / overlap-blocks, did the AC-gate
  short-circuit. These are coord lifecycle events the runner never
  observes.
* ``policy_actuators`` jsonb — the unit-level policy levers coord
  actuates: best-of-N width (``on_unit_open`` fanout), model routing,
  require-verify, batch-compat. At N=1 these are defaults; the column
  captures the LEVER, not a runner-side measured value.

Dual-source (same pattern as the Phase-1 ``coord.hook_invocations``
ledger): this alembic revision is canonical, AND coord self-heals the
identical shape at boot via
``hooks::retrospective::ensure_unit_retrospectives_table`` (mirrors
``ensure_hook_invocations_table``), so the surface works even before this
revision is applied.

Chains off ``coord_hooks_01_hook_invocations`` (the current single head)
so the alembic graph does NOT fork — the retrospective is the Phase-5
sibling of the Phase-1 ledger and shares its ``unit_id`` keyspace.

Columns:

* ``unit_id`` — UUID PRIMARY KEY. The merge proposal / work unit. PK so a
  replayed ``finish_landed`` cannot insert a second row (the ledger
  ``(unit_id, on_retrospective)`` key gates it first; this PK is the
  belt-and-braces backstop).
* ``repo`` — TEXT. The primary repo of the landed unit (first repo on the
  proposal), for per-repo dashboards / event routing.
* ``attempt_count`` — INTEGER. Number of attempts coord ran for this unit
  (best-of-N width realized). 1 at N=1.
* ``winning_attempt_id`` — UUID nullable. The attempt that landed. NULL at
  N=1 when no attempt-level row exists yet (Track 1 populates it).
* ``paired_contrast`` — JSONB. Winner-vs-losers contrast (model / prompt /
  temperature + per-attempt verify verdicts). ``[]`` / degenerate at N=1.
* ``coord_mechanism_events`` — JSONB. Coord-mechanism efficacy snapshot.
* ``policy_actuators`` — JSONB. Unit-level policy levers.
* ``created_at`` — TIMESTAMPTZ DEFAULT now().
* ``tenant_id`` — UUID nullable. Tenant scope for retention / dashboards.

Indexes:

* PK on ``unit_id`` — the dedupe key.
* ``idx_unit_retrospectives_repo`` — "all retrospectives for this repo",
  newest first.
* ``idx_unit_retrospectives_tenant`` — partial index for tenant-scoped
  retention sweeps.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_hooks_02_unit_retrospectives"
# CRITICAL: chain off the current single head so the alembic graph does NOT
# fork. coord_hooks_01_hook_invocations is the Phase-1 ledger head.
down_revision: str = "coord_hooks_01_hook_invocations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Idempotent: skip if coord self-heal / a prior partial apply already
    # created this table out-of-band (the table + indexes are present).
    if sa.inspect(op.get_bind()).has_table("unit_retrospectives", schema="coord"):
        return
    op.create_table(
        "unit_retrospectives",
        sa.Column("unit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("repo", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column(
            "attempt_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("winning_attempt_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "paired_contrast",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "coord_mechanism_events",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "policy_actuators",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("unit_id"),
        schema="coord",
    )

    op.create_index(
        "idx_unit_retrospectives_repo",
        "unit_retrospectives",
        ["repo", sa.text("created_at DESC")],
        schema="coord",
    )
    op.create_index(
        "idx_unit_retrospectives_tenant",
        "unit_retrospectives",
        ["tenant_id"],
        schema="coord",
        postgresql_where=sa.text("tenant_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_unit_retrospectives_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_unit_retrospectives_repo")
    op.drop_table("unit_retrospectives", schema="coord")
