"""coord.continuation_dispatches — gate-executor dispatch journal

Revision ID: 111c659fc165
Revises: twin_auth_02_coverage_float8
Create Date: 2026-06-10

Phase 4a substrate of the coord deploy/migrate gate-executor plan
(``plans/2026-06-10-coord-deploy-migrate-executor.md`` §3.2 step 1 / §4 4a).

Creates one ``coord.*`` journal table consumed by qontinui-coord (Rust),
which cannot author DDL — Alembic in qontinui-web is the sole author of the
``coord.*`` schema (coord's ``coord_schema_authorship.rs`` CI gate forbids
coord-side CREATE TABLE):

* ``coord.continuation_dispatches`` — one row per Deploy/Migrate gate
  continuation the executor enqueues (``gate_executor.rs``, built in a
  parallel coord PR against EXACTLY this DDL). The gates dispatch site
  INSERTs ``status='queued'``; the leader-only tick loop claims rows
  (``FOR UPDATE SKIP LOCKED``), re-verifies ``gate_dispatch_safety_verdict``
  at dispatch time, runs the action-specific Φ_Schema pre-flight, fires the
  GitHub ``workflow_dispatch``, then correlates the spawned run via the
  declared ``dispatch_id`` input echoed into ``run-name`` and records
  ``workflow_run_id`` / ``verify_ref`` and the terminal status.

Design notes (mirror the sibling coord.* migrations
``deploy_effect_01_coord_deploy_tables`` /
``install_sig_01_coord_install_signatures``):

* ``action_kind`` / ``status`` are TEXT + CHECK rather than PG enums — same
  rationale as ``coord.deploy_signatures.environment``: text+CHECK evolves
  without ``ALTER TYPE`` acrobatics. The status tokens are kept
  byte-for-byte in sync with the coord-side executor state machine built
  against this contract (``queued`` → ``dispatched`` → ``verified`` |
  ``failed`` | ``timed_out``; ``suppressed`` = COORD_GATE_EXECUTOR=off,
  ``would_dispatch`` = shadow mode, ``aborted_unsafe`` = dispatch-time
  re-verify veto).
* UNIQUE index on ``(gate_id)`` — the gate's continuation-consume
  idempotency does NOT cover double-dispatch across leader takeover; one
  dispatch per cleared gate, ever (re-clears of a re-registered gate are
  new gate_ids).
* Partial index on ``status WHERE terminal_at IS NULL`` — the tick loop's
  hot scan over non-terminal rows.
* Raw ``op.execute`` DDL, every statement schema-qualified to ``coord``
  (the ``check_alembic_schema_args.py`` pre-commit/CI gate requires it).
* ``IF NOT EXISTS`` everywhere keeps the migration idempotent; the
  ``coord`` schema already exists (created by
  ``consolidation_phase1_01_infrastructure``) so it is NOT created here,
  and no per-table GRANT is needed (that migration grants
  ``ALL ON SCHEMA coord TO qontinui_user`` at the schema level; no sibling
  coord.* table migration issues per-table grants).
* Pure DDL, no app-code imports, no backfill — the prod migrator container
  lacks app deps.

Coord reserve: reservation_id=aee59da4-7d59-4d63-8bc5-9a68877c244a,
position=1 (down_revision coord assigned: d6e7f8a9b0c1 — reflects coord's
stale view of the chain head; ``d6e7f8a9b0c1`` already has the local child
``coord_commit_lineage_tenant_id``, so chaining off it would fork the
chain. The actual local single head is
``coord_singleauthored_11_git_frontier_manifest`` (since superseded by
``twin_auth_02_coverage_float8``, #557), which is what this
migration chains off — same resolution as
``gate_action_prefs_01_notification_preferences``; the alembic-heads-pr CI
gate is the authoritative single-head guard.)
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "111c659fc165"
down_revision: str = "twin_auth_02_coverage_float8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the coord.continuation_dispatches gate-executor journal."""

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.continuation_dispatches (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            gate_id           UUID NOT NULL,
            tenant_id         UUID NOT NULL,
            action_kind       TEXT NOT NULL,
            target            TEXT NOT NULL,
            verdict_rationale TEXT NOT NULL,
            status            TEXT NOT NULL DEFAULT 'queued',
            dispatch_id       UUID NOT NULL DEFAULT gen_random_uuid(),
            workflow_run_id   BIGINT,
            verify_ref        TEXT,
            last_error        TEXT,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            dispatched_at     TIMESTAMPTZ,
            terminal_at       TIMESTAMPTZ,
            CONSTRAINT continuation_dispatches_action_kind_chk
                CHECK (action_kind IN ('deploy','migrate')),
            CONSTRAINT continuation_dispatches_status_chk
                CHECK (status IN ('queued','suppressed','would_dispatch','dispatched','verified','failed','timed_out','aborted_unsafe'))
        )
        """
    )
    # One dispatch per cleared gate, ever — leader-takeover double-dispatch
    # guard (continuation-consume idempotency does not cover it).
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_continuation_dispatches_gate
            ON coord.continuation_dispatches (gate_id)
        """
    )
    # Tick-loop hot scan: non-terminal rows by status.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_continuation_dispatches_active
            ON coord.continuation_dispatches (status) WHERE terminal_at IS NULL
        """
    )


def downgrade() -> None:
    """Drop the journal table (indexes drop with it)."""
    op.execute("DROP TABLE IF EXISTS coord.continuation_dispatches")
