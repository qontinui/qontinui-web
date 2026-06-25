"""coord.gates — widen verdict CHECK to add 'misconfigured'

Revision ID: gateverdict_01_misconfigured
Revises: drop_line_budget_columns_01
Create Date: 2026-06-20

Widens the ``coord.gates.verdict`` CHECK constraint from
``('open', 'cleared', 'failed')`` to add ``'misconfigured'`` for plan
``2026-06-19-coord-gate-robustness`` (Phase 3 — "loud verdicts at both poles").

``'misconfigured'`` is a NEW, terminal-ish verdict distinct from ``'open'``: it
marks a gate whose predicate references something that cannot be evaluated (a
nonexistent repo, a malformed reference) — today such gates silently sit
``'open'`` forever, indistinguishable from "legitimately not satisfied yet".
The coord-side evaluator change that PRODUCES this verdict (the ``file_exists``
repo-existence sub-probe + ``GateVerdict::Misconfigured`` persist arm) ships in
the paired qontinui-coord PR; this migration is the schema prerequisite and
MUST be applied to prod RDS **before** that coord image deploys (the coord boot
``require_table`` / verdict-write path would otherwise reject the new value).

## House conventions followed

Raw ``op.execute`` (not the SQLAlchemy constraint API). The verdict constraint
is the inline column CHECK created by ``coord_singleauthored_01_gates`` (line
46), which Postgres auto-named ``gates_verdict_check`` (``{table}_{column}_check``
for an inline column check). It is dropped + re-added idempotently
(``DROP CONSTRAINT IF EXISTS`` then ``ADD CONSTRAINT``) so a re-run does not
collide on the constraint name — the same pattern the sibling
``coord_gates_clearance_audience`` migration uses for its CHECK.

The widened CHECK is a pure value-list constraint over an existing column — no
table rewrite, no IMMUTABLE-predicate hazard, no index changes. It touches
**only** ``coord.gates`` (created earlier in this same linear chain), so it
applies cleanly anywhere the chain is run.

``down_revision`` is the value COORD ASSIGNED via the migration-reservation
handshake (``POST /coord/migrations/reserve``, reservation
``11efec55-6a7e-4402-b009-4ff9d9df13a1``) — used verbatim, never computed from a
local checkout head.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "gateverdict_01_misconfigured"
down_revision: str | Sequence[str] | None = "drop_line_budget_columns_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE coord.gates DROP CONSTRAINT IF EXISTS gates_verdict_check")
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD CONSTRAINT gates_verdict_check
            CHECK (verdict IN ('open', 'cleared', 'failed', 'misconfigured'))
        """
    )


def downgrade() -> None:
    # Reverting narrows the value set; any row already carrying 'misconfigured'
    # would make the re-added CHECK fail (by design — you cannot downgrade past
    # data that uses the new value without first migrating those rows).
    op.execute("ALTER TABLE coord.gates DROP CONSTRAINT IF EXISTS gates_verdict_check")
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD CONSTRAINT gates_verdict_check
            CHECK (verdict IN ('open', 'cleared', 'failed'))
        """
    )
