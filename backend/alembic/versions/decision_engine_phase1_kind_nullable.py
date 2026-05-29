"""coord Decision Engine (Policy Engine v2) — Phase 1: `kind` nullable for v2 rows

Revision ID: decision_engine_phase1_kind_nullable
Revises: decision_engine_phase0
Create Date: 2026-05-28

Phase 1 of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-05-28-coordination-decision-engine-design.md``.

The project priorities (clean code over back-compat) resolve the open design
question: ``decision_domain`` is the v2 discriminator, so a guidance /
data_driven policy row should not be forced to carry a meaningless reserved
``kind``. This migration:

* drops ``NOT NULL`` on ``coord.policy_rules.kind``;
* replaces the Phase-0 ``policy_rules_kind_or_domain_check`` with a MODE-AWARE
  CHECK ``policy_rules_mode_kind_check``: deterministic-mode rows still require
  one of the 5 reserved kinds (the v1 deterministic fast-path matches on it),
  while ``guidance`` / ``data_driven`` rows may have a NULL ``kind`` (or a
  reserved kind, for storage compatibility). The ``decision_domain`` non-empty
  guard is retained.

MUST stay byte-for-byte in lockstep with the coord runtime self-heal in
``qontinui-coord/src/policies/table.rs`` (``ensure_policy_tables`` — the
Phase-1 block) per [[feedback_canonical_db_behind_alembic]]. Idempotent: the
DROP NOT NULL is a no-op if already dropped, and the constraint swap is guarded
by name.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "decision_engine_phase1_kind_nullable"
down_revision: str = "decision_engine_phase0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make ``kind`` nullable for v2 rows and swap in the mode-aware CHECK.
    Idempotent. Additive — does not drop any column or data."""

    op.execute("ALTER TABLE coord.policy_rules ALTER COLUMN kind DROP NOT NULL")

    op.execute(
        "ALTER TABLE coord.policy_rules "
        "DROP CONSTRAINT IF EXISTS policy_rules_kind_or_domain_check"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'policy_rules_mode_kind_check'
                  AND conrelid = 'coord.policy_rules'::regclass
            ) THEN
                ALTER TABLE coord.policy_rules
                    ADD CONSTRAINT policy_rules_mode_kind_check CHECK (
                        (
                            (
                                -- `kind IS NOT NULL` is REQUIRED here: a CHECK
                                -- passes on NULL/UNKNOWN, so `kind IN (...)` with
                                -- a NULL kind would evaluate to UNKNOWN and let a
                                -- deterministic row slip through. Forcing
                                -- NOT NULL first makes the branch FALSE (not
                                -- UNKNOWN) so the OR can reject it.
                                mode = 'deterministic' AND kind IS NOT NULL AND kind IN (
                                    'baseline_waiver', 'block_override', 'escalation_rule',
                                    'question_auto_answer', 'session_conflict_rule'
                                )
                            )
                            OR (
                                mode IN ('guidance', 'data_driven') AND (
                                    kind IS NULL OR kind IN (
                                        'baseline_waiver', 'block_override', 'escalation_rule',
                                        'question_auto_answer', 'session_conflict_rule'
                                    )
                                )
                            )
                        )
                        AND (decision_domain IS NULL OR decision_domain <> '')
                    );
            END IF;
        END $$
        """
    )


def downgrade() -> None:
    """Reverse Phase 1: drop the mode-aware CHECK, restore the Phase-0
    kind/domain CHECK, and re-assert NOT NULL on ``kind``. NOTE: re-asserting
    NOT NULL will fail if any guidance/data_driven row left ``kind`` NULL; that
    is the intended safety behaviour for a downgrade (those rows are v2-only)."""

    op.execute(
        "ALTER TABLE coord.policy_rules "
        "DROP CONSTRAINT IF EXISTS policy_rules_mode_kind_check"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'policy_rules_kind_or_domain_check'
                  AND conrelid = 'coord.policy_rules'::regclass
            ) THEN
                ALTER TABLE coord.policy_rules
                    ADD CONSTRAINT policy_rules_kind_or_domain_check CHECK (
                        kind IN (
                            'baseline_waiver', 'block_override', 'escalation_rule',
                            'question_auto_answer', 'session_conflict_rule'
                        )
                        AND (decision_domain IS NULL OR decision_domain <> '')
                    );
            END IF;
        END $$
        """
    )
    op.execute("ALTER TABLE coord.policy_rules ALTER COLUMN kind SET NOT NULL")
