"""coord hooks 03 attempt audits

Revision ID: coord_hooks_03_attempt_audits
Revises: coord_hooks_02_unit_retrospectives
Create Date: 2026-05-24

Track 2 (UI-Bridge preview-verification) Phase 2 — the durable
persisted-verdict store the co-located audit routine writes and the pure
``verify`` hook later reads
(``D:/qontinui-root/qontinui-dev-notes/plans/2026-05-23-ui-bridge-preview-verification-phase1-plan.md``
§3 Phase 2, §4 verify-gate contract, §5 risk 7, §7 deliverable 2).

Creates ``coord.attempt_audits`` — one row per ``(unit_id, attempt_id)``.
The audit (preflight + ``POST /vision/assert``) runs in the I/O-capable
``post_attempt`` side-effect slot (which holds ``Arc<AppState>``), NOT
inside the structurally-pure ``verify`` hook (which gets only a
``GateCtx`` with no connection). The audit persists the ``AssertResponse``
verdict here; the ``verify`` hook reads it back from a materialized
``GateCtx`` snapshot and reduces it to a ``VerifyVerdict`` — byte-for-byte
the shipped ``CiVerifyGate``-over-``CiSnapshot`` pattern, with
``coord.attempt_audits`` playing the role ``coord.pr_check_runs`` plays for
CI. Persist-then-read makes the verdict a durable, replay-safe single
source of truth and eliminates the fail-mode where a pure verify gate
silently does network I/O it isn't structurally allowed to do.

Dual-source (same pattern as ``coord.hook_invocations`` and
``coord.unit_retrospectives``): this alembic revision is canonical, AND
coord self-heals the identical shape at boot via
``preview_audit::ensure_attempt_audits_table`` (mirrors
``ensure_hook_invocations_table``), so the surface works even before this
revision is applied. The self-heal uses ``CREATE TABLE IF NOT EXISTS``, so
the alembic-created table and the self-healed table coexist.

Chains off ``coord_hooks_02_unit_retrospectives`` (the current head of the
coord_hooks branch) so the alembic graph does NOT fork — the attempt-audit
store is the Track-2 sibling of the Phase-5 retrospective and shares the
``unit_id`` keyspace.

Columns:

* ``unit_id`` — UUID NOT NULL. The work unit / merge proposal.
* ``attempt_id`` — UUID NOT NULL. The attempt. The all-zero sentinel
  (``'00000000-...'``) means "unit-scoped, no specific attempt", identical
  to the ``coord.hook_invocations`` ``attempt_id`` sentinel — a nullable PK
  column is impossible in PG (PK columns are implicitly NOT NULL), so the
  sentinel is how an attempt-less audit keys.
* ``gate`` — TEXT NOT NULL. The reduced verdict
  ``∈ {pass, fail_assertion, fail_preflight, fail_infra}``.
* ``all_passed`` — BOOLEAN nullable. The ``AssertResponse.all_passed``;
  NULL when the assert leg never ran (preflight/infra fail).
* ``results`` — JSONB. The ``AssertionResult[]`` array (per-assertion
  pass/fail + reason). The actionable failure detail the ``verify`` hook
  surfaces.
* ``preflight`` — JSONB. ``{ok, connected, connections, url_ok}``.
* ``preview`` — JSONB. ``{port, git_sha, resolved_sha}`` — the preview
  handle the audit ran against (provenance).
* ``created_at`` — TIMESTAMPTZ DEFAULT now().
* ``tenant_id`` — UUID nullable. Tenant scope for retention / dashboards.

A new row per ``(unit_id, attempt_id)``; a re-audit OVERWRITES via
``ON CONFLICT (unit_id, attempt_id) DO UPDATE`` (latest verdict wins — the
audit is the source of truth for ``verify``).

Indexes:

* PK on ``(unit_id, attempt_id)`` — the upsert key.
* ``idx_attempt_audits_unit`` — "all audits for this unit", newest first.
* ``idx_attempt_audits_tenant`` — partial index for tenant-scoped sweeps.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_hooks_03_attempt_audits"
# CRITICAL: chain off the current head of the coord_hooks branch so the alembic
# graph does NOT fork. coord_hooks_02_unit_retrospectives is the verified head.
down_revision: str = "coord_hooks_02_unit_retrospectives"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Idempotent: skip if coord self-heal / a prior partial apply already
    # created this table out-of-band (the table + indexes are present).
    if sa.inspect(op.get_bind()).has_table("attempt_audits", schema="coord"):
        return
    op.create_table(
        "attempt_audits",
        sa.Column("unit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "attempt_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            # All-zero sentinel = "unit-scoped, no attempt" — identical to the
            # coord.hook_invocations sentinel (nullable PK columns are
            # impossible in PG).
            server_default=sa.text("'00000000-0000-0000-0000-000000000000'"),
        ),
        sa.Column("gate", sa.Text(), nullable=False),
        # Actionable failure detail the pure `verify` hook surfaces as
        # `Fail{reason}` — read verbatim, never recomputed (parity with the
        # coord-side self-heal `ensure_attempt_audits_table`).
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("all_passed", sa.Boolean(), nullable=True),
        sa.Column(
            "results",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "preflight",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "preview",
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
        sa.PrimaryKeyConstraint("unit_id", "attempt_id"),
        schema="coord",
    )

    op.create_index(
        "idx_attempt_audits_unit",
        "attempt_audits",
        ["unit_id", sa.text("created_at DESC")],
        schema="coord",
    )
    op.create_index(
        "idx_attempt_audits_tenant",
        "attempt_audits",
        ["tenant_id"],
        schema="coord",
        postgresql_where=sa.text("tenant_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_attempt_audits_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_attempt_audits_unit")
    op.drop_table("attempt_audits", schema="coord")
