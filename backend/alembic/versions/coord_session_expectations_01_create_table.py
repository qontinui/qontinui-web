"""coord.session_expectations (subagent stall watchdog — expectation ledger)

Revision ID: coord_session_expectations_01
Revises: coord_device_status_mt_pk
Create Date: 2026-07-03

PR-4a (D1, plan §3) of plan
``D:/qontinui-root/plans/2026-07-03-subagent-stall-watchdog.md``.

Stands up ``coord.session_expectations``: the durable expectation ledger the
stall-watchdog supervisor scans. One row per supervised delegation — when a
spawn/dispatch hands work to a subagent it REGISTERS an expectation (what
observable evidence the delegate should produce, and by when); fulfillment,
cancellation, or a terminal escalation-ladder rung CLOSES it. A row that
outlives its ``soft_deadline_at`` without evidence is a stall candidate, not a
silent lost wakeup.

Schema:

* ``id UUID PRIMARY KEY``             — synthetic row id.
* ``tenant_id UUID NOT NULL``         — owning tenant (no cross-tenant scans).
* ``session_id UUID``                 — the delegate session, when known.
* ``device_id TEXT``                  — the delegate's device, when known.
* ``work_unit_id TEXT``               — the work unit the delegation serves.
* ``phase TEXT``                      — plan/phase label for operator triage.
* ``expected_kind TEXT NOT NULL``     — what evidence closes the row:
  ``commit_on_branch`` | ``pr_open`` | ``gate_attested`` |
  ``work_unit_status`` | ``checkin_only``.
* ``expected_ref JSONB NOT NULL``     — typed pointer for the evidence probe
  (branch name, repo, gate id, work-unit status …). Default ``'{}'``.
* ``soft_deadline_at TIMESTAMPTZ NOT NULL`` — first check-by time; passing it
  moves the row toward ``overdue``.
* ``hard_deadline_at TIMESTAMPTZ``    — terminal horizon; NULL = soft-only.
* ``status TEXT NOT NULL``            — ``open`` (default) | ``met`` |
  ``overdue`` | ``escalating`` | ``reclaimed`` | ``cancelled`` | ``operator``.
* ``ladder_rung SMALLINT NOT NULL``   — current escalation-ladder rung
  (0 = not escalated).
* ``last_checkin_at TIMESTAMPTZ``     — last liveness signal from the
  delegate.
* ``progress_seq BIGINT NOT NULL``    — monotonic progress counter; a bump
  proves forward motion between supervisor sweeps.
* ``progress_note TEXT``              — free-text last known progress.
* ``created_by TEXT NOT NULL``        — registering actor (session/agent id).
* ``created_at`` / ``updated_at TIMESTAMPTZ NOT NULL`` — row lifecycle.

Indices:

* ``ix_session_expectations_open``    — ``(tenant_id, status,
  soft_deadline_at)`` partial on ``status IN ('open','overdue','escalating')``
  — the supervisor's hot scan: live expectations ordered by deadline.

No FK to any web table and NO SQLAlchemy ORM model: this table is coord-only
(qontinui-web is the schema author, never a reader/writer), and web's
bidirectional-ORM FK-cycle trap means coord.* tables must stay out of the ORM
graph.

Idempotency: ``CREATE TABLE/INDEX IF NOT EXISTS`` (``coord_session_messages``
posture), so coord + this migration land in either order without a boot-gate
crash-loop.

NOTE (stacked reservation): ``down_revision`` is the ASSIGNED parent
``coord_device_status_mt_pk`` from the coord migration reserve queue
(reservation ``ec1ea4fc-4867-42c0-956d-85ae927525d2``). That parent is NOT on
main yet (in-flight multi-tenant sibling PR), so the alembic-heads check may
stay red until the sibling lands — do not re-point; coord's land-time
re-point is the fork-prevention authority.

Chains off ``coord_device_status_mt_pk``.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_session_expectations_01"
down_revision: str | Sequence[str] | None = "coord_device_status_mt_pk"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.session_expectations`` + index. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_expectations (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id        UUID        NOT NULL,
            session_id       UUID,
            device_id        TEXT,
            work_unit_id     TEXT,
            phase            TEXT,
            expected_kind    TEXT        NOT NULL,
            expected_ref     JSONB       NOT NULL DEFAULT '{}'::jsonb,
            soft_deadline_at TIMESTAMPTZ NOT NULL,
            hard_deadline_at TIMESTAMPTZ,
            status           TEXT        NOT NULL DEFAULT 'open',
            ladder_rung      SMALLINT    NOT NULL DEFAULT 0,
            last_checkin_at  TIMESTAMPTZ,
            progress_seq     BIGINT      NOT NULL DEFAULT 0,
            progress_note    TEXT,
            created_by       TEXT        NOT NULL,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # The supervisor's hot scan: live expectations ordered by soft deadline.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_session_expectations_open
            ON coord.session_expectations (tenant_id, status, soft_deadline_at)
            WHERE status IN ('open','overdue','escalating')
        """
    )


def downgrade() -> None:
    """Drop ``coord.session_expectations`` + index."""
    op.execute("DROP INDEX IF EXISTS coord.ix_session_expectations_open")
    op.execute("DROP TABLE IF EXISTS coord.session_expectations")
