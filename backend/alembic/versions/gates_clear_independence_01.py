"""coord.gates — clear_independence: the recorded independence declaration

Revision ID: gates_clear_independence_01
Revises: coord_dp_write_auth_daily_01
Create Date: 2026-09-27

Schema prerequisite for plan
``2026-09-26-gate-ladder-session-rung-is-caller-mintable-so-tier-5-proves-a-session-not-an-actor``
(Phase 1 — lands and applies BEFORE the coord Phase 2 PR that reads and writes
it; served policy ``production-and-cost`` ``alembic-sole-authorship``). Adds one
nullable column to ``coord.gates``:

- ``clear_independence JSONB NULL`` — the record of the independence
  declaration (if any) behind the gate's decisions. An agent may supply a
  declaration ``{verified, against, context}`` with any gate decision (attest,
  force-clear, reject, or an audience change). It is REQUIRED, and is what
  authorizes the decision, when a same-device caller decides an
  ``agent_non_author`` gate; on an identity- or ``agent_any``-admitted decision
  a supplied declaration is stored as a courtesy record.

  Invariant coord maintains (authority: qontinui-coord ``gates.rs``
  ``independence_transition_sql``, which every verdict write goes through, in
  the SAME ``UPDATE`` that sets the verdict): the top-level object describes
  the decision that set the gate's CURRENT verdict — or, while the gate is
  open, the latest declared audience change. A declared decision writes its
  declaration plus coord-stamped keys (``action``, ``admitted_by``,
  ``verdict``, ``declared_by: {device, agent, session}``, timestamps); an
  undeclared VERDICT write writes a stub with ``admitted_by: "none"`` once any
  record exists, and leaves the column NULL otherwise. Each replaced top-level
  record is kept under ``supersedes`` (newest first, bounded, preferring
  declared records over stubs, with a truncation count), because coord keeps
  no other durable history of a gate's prior decisions. Read coord's helper
  for the exact key set rather than this docstring.

Why it exists: served policy ``verification-and-evidence``
``independence-is-context-not-credential`` says independence is a property of
context, not of a credential or session id, and that *"the independence claim
MUST BE RECORDED with the artifact"*. The gate ladder's session rung admitted
on a session id the author can mint; the declaration replaces that rung, and
this column is where the claim is recorded.

Fail-closed contract (coord-side, documented here so the column's absence is
never read as optional): any decision (attest, force-clear, reject, audience)
admitted ON THE STRENGTH OF a declaration is REFUSED — the gate is left
unchanged — when this column is missing, exactly as a work-unit transition
fails when its attestation cannot be stored. A decision admitted by identity
stores a supplied declaration when the column exists and
drops it with a warning when it does not, because it authorized nothing.

NULL means no declaration was recorded — including every row cleared before
this column existed. It is deliberately NEVER BACKFILLED: no historical clear
carried a declaration, and inventing one would record a claim nobody made.

## House conventions followed

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` so the migration is
collision-safe against any canonical PG that might already carry the column —
same convention as ``gates_clearance_provenance_01`` and
``shadowreap01_gates_shadow_reap_cols``. Nullable with no default, so there is
no table rewrite; no index. ``COMMENT ON COLUMN`` follows
``coord_sesscompl_03_gates_agent_session_id``.

Touches **only** ``coord.gates`` (created earlier in this same linear chain),
so it applies cleanly anywhere the chain is run.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# NOTE: ``down_revision`` chains off the LOCAL single head at authoring time
# (``coord_dp_write_auth_daily_01``, per
# ``scripts/ci/count_alembic_heads.py``). No coord migration reservation is
# taken; coord re-points at land time and ``alembic-graph-pr.yml`` is the
# fork-prevention authority.
revision: str = "gates_clear_independence_01"
down_revision: str | Sequence[str] | None = "coord_dp_write_auth_daily_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable independence-declaration column to coord.gates."""
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS clear_independence JSONB
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.gates.clear_independence IS
            'Independence-declaration record for this gate''s decisions. Top '
            'level: the decision that set the CURRENT verdict (or, while the '
            'gate is open, the latest declared audience change) - the agent''s '
            '{verified, against, context} plus coord-stamped action, '
            'admitted_by, verdict, declared_by and timestamps, or a stub with '
            'admitted_by=none when that decision carried no declaration. '
            'Replaced records are kept under supersedes (newest first, '
            'bounded, declarations preferred, truncation counted). Required '
            'for, and the authorization of, a same-device agent_non_author '
            'decision (policy verification-and-evidence '
            'independence-is-context-not-credential); coord REFUSES such a '
            'decision if this column is missing. NULL: no record ever written '
            '(never backfilled). Exact shape: qontinui-coord gates.rs '
            'independence_transition_sql.'
        """
    )


def downgrade() -> None:
    """Drop the independence-declaration column from coord.gates."""
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS clear_independence")
