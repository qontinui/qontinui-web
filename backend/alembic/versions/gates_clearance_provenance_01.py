"""coord.gates — gate_class, clearance-provenance columns, 'withdrawn' verdict

Revision ID: gates_clearance_provenance_01
Revises: prcheckruns_headbranch_02
Create Date: 2026-07-27

Schema prerequisite for plan ``2026-07-27-configurable-gate-clearance-authority``
(Phase 2 — lands and applies to RDS BEFORE any coord reader undrafts). Adds six
nullable columns to ``coord.gates`` and widens the verdict CHECK:

- ``gate_class TEXT NULL`` — registrant self-classified gate class (recommended
  vocabulary lives in the ``_gate-registration`` skill spec: ``security-surface``,
  ``routine-review``, ``ops-confirm``). Deliberately **no DB CHECK** (plan D4):
  tenants can mint classes without migrations; a NULL / unknown class always
  resolves to the strictest default authority coord-side, so unclassified is
  never a loophole.
- ``registered_by_agent_id UUID NULL`` — agent identity of the registrant when
  the registering token carried one (``sub_type=agent`` tokens only; device
  JWTs carry no agent_id by design). Provenance plus the pair-refinement arm of
  the separation-of-duties check (plan D3: device is the SoD floor, the
  ``(device_id, agent_id)`` pair refines it when both sides carry an agent_id).
- ``cleared_by_device_id UUID NULL`` / ``cleared_by_agent_id UUID NULL`` — who
  moved the gate to a terminal verdict.
- ``cleared_via TEXT NULL`` — which door did it. Vocabulary (documented here,
  enforced coord-side, no DB CHECK for the same D4 reason):
  ``operator_route | agent_attest | agent_reject | withdraw | force_clear | sweep``.
- ``cleared_under_rule UUID NULL`` — ``coord.policy_rules.policy_id`` of the
  ``gate_clearance`` decision-domain rule that authorized the action; NULL for
  operator routes and for the no-rule defaults.
- verdict CHECK widened from ``('open','cleared','failed','misconfigured')`` to
  add ``'withdrawn'`` — the registrant-cancelled terminal verdict (terminal,
  non-clear, non-paging; coord's ``coord_withdraw_gate`` PR is the producer and
  stays DRAFT until this migration has applied to prod RDS).

## House conventions followed

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` so the migration is
collision-safe against any canonical PG that might already carry a column —
same convention as the sibling ``coord_gates_clearance_audience``. All new
columns are nullable with no defaults, so there is no table rewrite and no
IMMUTABLE-predicate hazard. No index predicates are added.

The verdict constraint is the inline column CHECK created by
``coord_singleauthored_01_gates``, auto-named ``gates_verdict_check`` and last
widened by ``gateverdict_01_misconfigured``. It is dropped + re-added
idempotently (``DROP CONSTRAINT IF EXISTS`` then ``ADD CONSTRAINT``) so a
re-run does not collide on the constraint name — the same pattern that sibling
uses.

Touches **only** ``coord.gates`` (created earlier in this same linear chain),
so it applies cleanly anywhere the chain is run.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "gates_clearance_provenance_01"
down_revision: str | Sequence[str] | None = "prcheckruns_headbranch_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS gate_class TEXT NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS registered_by_agent_id UUID NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS cleared_by_device_id UUID NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS cleared_by_agent_id UUID NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS cleared_via TEXT NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS cleared_under_rule UUID NULL
        """
    )
    op.execute("ALTER TABLE coord.gates DROP CONSTRAINT IF EXISTS gates_verdict_check")
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD CONSTRAINT gates_verdict_check
            CHECK (verdict IN ('open', 'cleared', 'failed', 'misconfigured', 'withdrawn'))
        """
    )


def downgrade() -> None:
    # Reverting narrows the verdict value set; any row already carrying
    # 'withdrawn' would make the re-added CHECK fail (by design — you cannot
    # downgrade past data that uses the new value without first migrating
    # those rows).
    op.execute("ALTER TABLE coord.gates DROP CONSTRAINT IF EXISTS gates_verdict_check")
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD CONSTRAINT gates_verdict_check
            CHECK (verdict IN ('open', 'cleared', 'failed', 'misconfigured'))
        """
    )
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS cleared_under_rule")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS cleared_via")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS cleared_by_agent_id")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS cleared_by_device_id")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS registered_by_agent_id")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS gate_class")
