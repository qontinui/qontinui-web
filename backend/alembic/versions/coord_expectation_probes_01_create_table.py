"""coord.expectation_probes (subagent stall watchdog — typed evidence probes)

Revision ID: coord_expectation_probes_01
Revises: coord_session_expectations_01
Create Date: 2026-07-04

PR-5 (D3, plan §3) of plan
``D:/qontinui-root/plans/2026-07-03-subagent-stall-watchdog.md``.

Stands up ``coord.expectation_probes``: the durable probe-instruction store the
stall-watchdog supervisor uses to ask a device for READ-ONLY typed evidence
about a rung-2 (``escalating``) expectation, and to collect the device's typed
result. One row per dispatched probe.

The supervisor (coord, leader-gated) ENQUEUES a ``pending`` probe for the
device that hosts the stalled session; the device's ``probe_executor``
pull-loop (runner) GETs its pending probes, executes the CLOSED typed probe
kind READ-ONLY and worktree-scoped, and POSTs a typed result which flips the
row to ``completed``. The supervisor's next tick consumes the result and walks
the ladder (still-working ⇒ push the deadline; artifact present ⇒ collect;
process dead + artifact absent ⇒ operator).

Schema:

* ``id UUID PRIMARY KEY``              — synthetic probe id.
* ``tenant_id UUID NOT NULL``         — owning tenant (no cross-tenant scans).
* ``expectation_id UUID NOT NULL``    — the ``coord.session_expectations`` row
  this probe supervises (plain column, NO FK — coord-only tables stay out of
  the ORM graph, and a probe outlives its expectation harmlessly).
* ``session_id UUID``                 — the delegate session whose REGISTERED
  worktree the probe is scoped to (the device resolves the path itself; the
  requester never supplies a raw path — the RCE guard).
* ``device_id TEXT NOT NULL``         — the device that must execute the probe
  (the pull-loop key).
* ``probe_kind TEXT NOT NULL``        — CLOSED typed catalog:
  ``session_process_alive`` | ``path_activity`` | ``git_branch_state`` |
  ``artifact_present``.
* ``probe_args JSONB NOT NULL``       — kind-specific, NEVER a raw path
  (``{branch, repo}`` / ``{gate_id}`` / ``{work_unit_id}`` / an optional
  server-resolved ``{worktree_path}`` the device re-validates for containment).
  Default ``'{}'``.
* ``status TEXT NOT NULL``            — ``pending`` (default) | ``delivered`` |
  ``completed`` | ``expired``.
* ``verdict TEXT``                    — coord's typed interpretation of the
  result (``alive`` | ``dead`` | ``fresh`` | ``stale`` | ``present`` |
  ``absent`` | ``unknown`` | ``error``).
* ``result JSONB``                    — the device's raw typed result payload.
* ``requested_at TIMESTAMPTZ NOT NULL`` — enqueue time.
* ``delivered_at`` / ``completed_at TIMESTAMPTZ`` — lifecycle stamps.
* ``expires_at TIMESTAMPTZ NOT NULL`` — age-out horizon for an undelivered /
  never-answered probe (a dead device must not pin a rung-2 row forever).
* ``created_at`` / ``updated_at TIMESTAMPTZ NOT NULL`` — row lifecycle.

Indices:

* ``ix_expectation_probes_pending`` — ``(device_id, status, requested_at)``
  partial on ``status IN ('pending','delivered')`` — the device pull-loop's hot
  scan: this device's outstanding probes, oldest first.
* ``ix_expectation_probes_expectation`` — ``(expectation_id, status)`` — the
  supervisor's per-expectation lookup (is there an outstanding / completed
  probe for this row?).

No FK to any web table and NO SQLAlchemy ORM model: this table is coord-only
(qontinui-web is the schema author, never a reader/writer), and web's
bidirectional-ORM FK-cycle trap means coord.* tables must stay out of the ORM
graph.

Idempotency: ``CREATE TABLE/INDEX IF NOT EXISTS`` (the
``coord_session_expectations_01`` posture), so coord + this migration land in
either order without a boot-gate crash-loop; coord access is fail-soft on the
STRUCTURED missing-relation check.

NOTE (stacked reservation): ``down_revision`` is the assigned parent
``coord_session_expectations_01`` (itself stacked behind the in-flight
multi-tenant ``coord_device_status_mt_pk`` sibling). The alembic-heads check
may stay red until the ancestors land — do not re-point; coord's land-time
re-point is the fork-prevention authority.

Chains off ``coord_session_expectations_01``.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_expectation_probes_01"
down_revision: str | Sequence[str] | None = "coord_session_expectations_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.expectation_probes`` + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.expectation_probes (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id      UUID        NOT NULL,
            expectation_id UUID        NOT NULL,
            session_id     UUID,
            device_id      TEXT        NOT NULL,
            probe_kind     TEXT        NOT NULL,
            probe_args     JSONB       NOT NULL DEFAULT '{}'::jsonb,
            status         TEXT        NOT NULL DEFAULT 'pending',
            verdict        TEXT,
            result         JSONB,
            requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            delivered_at   TIMESTAMPTZ,
            completed_at   TIMESTAMPTZ,
            expires_at     TIMESTAMPTZ NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # The device pull-loop's hot scan: this device's outstanding probes.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_expectation_probes_pending
            ON coord.expectation_probes (device_id, status, requested_at)
            WHERE status IN ('pending','delivered')
        """
    )
    # The supervisor's per-expectation lookup (outstanding / completed probe?).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_expectation_probes_expectation
            ON coord.expectation_probes (expectation_id, status)
        """
    )


def downgrade() -> None:
    """Drop ``coord.expectation_probes`` + indices."""
    op.execute("DROP INDEX IF EXISTS coord.ix_expectation_probes_expectation")
    op.execute("DROP INDEX IF EXISTS coord.ix_expectation_probes_pending")
    op.execute("DROP TABLE IF EXISTS coord.expectation_probes")
