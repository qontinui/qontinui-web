"""coord Decision Engine (Policy Engine v2) — Phase 0 additive schema

Revision ID: decision_engine_phase0
Revises: coord_policy_rules_rename
Create Date: 2026-05-28

Phase 0 of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-05-28-coordination-decision-engine-design.md``.

Purely additive generalization of the v1 deterministic policy engine into
the Decision Engine v2 schema. Depends on (chains off) the collision-fix
revision ``coord_policy_rules_rename`` which created
``coord.policy_rules`` + ``coord.policy_rule_resolutions`` under their
non-colliding names.

This migration:

* Adds the open ``decision_domain`` / ``mode`` / ``autonomy_level`` /
  ``payload`` columns to ``coord.policy_rules`` (§4.3, App A.1), backfills
  ``decision_domain`` from the legacy ``kind``, relaxes the closed ``kind``
  CHECK to a NULL-tolerant, domain-aware constraint, and adds the resolver
  index ``idx_policy_rules_tenant_domain`` (predicate ``enabled = true``
  ONLY — Postgres rejects ``now()`` in an index predicate; the not-expired
  filter lives in ``resolver.rs``).
* Adds the provenance + feedback-flywheel columns to
  ``coord.policy_rule_resolutions`` (§6, App A.2) plus an
  ``outcome_category`` CHECK allowing the 5 effect-calculus categories or
  NULL.
* Creates the ``coord.priority_sets`` and ``coord.composition_rules``
  registry tables (§4.5).

MUST stay byte-for-byte in lockstep with the coord runtime self-heal in
``qontinui-coord/src/policies/table.rs`` (``ensure_policy_tables``) per
[[feedback_canonical_db_behind_alembic]]. Every statement is idempotent
(``ADD COLUMN IF NOT EXISTS`` / ``CREATE ... IF NOT EXISTS`` / guarded
constraint adds) so the migration and the self-heal can each be a no-op on
a re-run regardless of which ran first.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "decision_engine_phase0"
down_revision: str = "coord_policy_rules_rename"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive Decision Engine v2 Phase-0 schema. Idempotent. Does not
    alter or drop any existing column, and never touches the unrelated
    substrate table coord.tenant_policies."""

    # --- coord.policy_rules: additive v2 columns. ---
    op.execute(
        """
        ALTER TABLE coord.policy_rules
            ADD COLUMN IF NOT EXISTS decision_domain TEXT,
            ADD COLUMN IF NOT EXISTS mode            TEXT NOT NULL DEFAULT 'deterministic',
            ADD COLUMN IF NOT EXISTS autonomy_level  TEXT NOT NULL DEFAULT 'always_escalate',
            ADD COLUMN IF NOT EXISTS payload         JSONB
        """
    )
    # Backfill decision_domain from the legacy kind for existing rows.
    op.execute(
        """
        UPDATE coord.policy_rules
            SET decision_domain = kind
            WHERE decision_domain IS NULL
        """
    )
    # Relax the closed `kind` CHECK so open decision_domain values are
    # allowed while the 5 reserved kinds stay valid. Drop the old form by
    # name (idempotent), then add a NULL-tolerant, domain-aware CHECK only
    # if it isn't already present.
    op.execute(
        "ALTER TABLE coord.policy_rules DROP CONSTRAINT IF EXISTS policy_rules_kind_check"
    )
    op.execute(
        "ALTER TABLE coord.policy_rules DROP CONSTRAINT IF EXISTS coord_policy_rules_kind_check"
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
    # Resolver index for the v2 decision_domain query path. Predicate is
    # `enabled = true` ONLY (Postgres rejects now()/expires_at in an index
    # predicate; the not-expired filter stays in resolver.rs).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_policy_rules_tenant_domain
            ON coord.policy_rules (tenant_id, decision_domain, enabled)
            WHERE enabled = true
        """
    )

    # --- coord.policy_rule_resolutions: provenance + flywheel columns. ---
    op.execute(
        """
        ALTER TABLE coord.policy_rule_resolutions
            ADD COLUMN IF NOT EXISTS served_policy_version BIGINT,
            ADD COLUMN IF NOT EXISTS resolution_payload    JSONB,
            ADD COLUMN IF NOT EXISTS agent_decision        JSONB,
            ADD COLUMN IF NOT EXISTS outcome               JSONB,
            ADD COLUMN IF NOT EXISTS outcome_category      TEXT
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'policy_rule_resolutions_outcome_category_check'
                  AND conrelid = 'coord.policy_rule_resolutions'::regclass
            ) THEN
                ALTER TABLE coord.policy_rule_resolutions
                    ADD CONSTRAINT policy_rule_resolutions_outcome_category_check CHECK (
                        outcome_category IS NULL OR outcome_category IN (
                            'confirmed', 'surprise', 'failure', 'contradiction', 'partial'
                        )
                    );
            END IF;
        END $$
        """
    )

    # --- coord.priority_sets — named, layered priority-set registry. ---
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.priority_sets (
            priority_set_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            set_name    TEXT NOT NULL,
            tenant_id   UUID NOT NULL,
            repo        TEXT,
            ordering    JSONB NOT NULL,
            non_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
            version     BIGINT NOT NULL DEFAULT 1,
            enabled     BOOLEAN NOT NULL DEFAULT true,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_by  TEXT NOT NULL DEFAULT 'system',
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by  TEXT NOT NULL DEFAULT 'system'
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_priority_sets_tenant_name_repo
            ON coord.priority_sets (tenant_id, set_name, COALESCE(repo, ''))
            WHERE enabled = true
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_priority_sets_tenant_name
            ON coord.priority_sets (tenant_id, set_name)
            WHERE enabled = true
        """
    )

    # --- coord.composition_rules — context selector → composition model. ---
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.composition_rules (
            composition_rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            decision_domain TEXT,
            surface         TEXT NOT NULL,
            activity        TEXT,
            layers          JSONB NOT NULL,
            tenant_id       UUID NOT NULL,
            priority        INTEGER NOT NULL DEFAULT 100,
            enabled         BOOLEAN NOT NULL DEFAULT true,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_by      TEXT NOT NULL DEFAULT 'system',
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by      TEXT NOT NULL DEFAULT 'system'
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_composition_rules_tenant_selector
            ON coord.composition_rules (tenant_id, decision_domain, surface, activity)
            WHERE enabled = true
        """
    )


def downgrade() -> None:
    """Reverse the Phase-0 additions. Drops the two new registry tables and
    the additive columns/indexes/constraints. coord.policy_rules and
    coord.policy_rule_resolutions themselves (owned by the prior revision)
    survive; only the Phase-0 additions are removed."""
    op.execute("DROP INDEX IF EXISTS coord.idx_composition_rules_tenant_selector")
    op.execute("DROP TABLE IF EXISTS coord.composition_rules")
    op.execute("DROP INDEX IF EXISTS coord.idx_priority_sets_tenant_name")
    op.execute("DROP INDEX IF EXISTS coord.uq_priority_sets_tenant_name_repo")
    op.execute("DROP TABLE IF EXISTS coord.priority_sets")

    op.execute(
        "ALTER TABLE coord.policy_rule_resolutions "
        "DROP CONSTRAINT IF EXISTS policy_rule_resolutions_outcome_category_check"
    )
    op.execute(
        """
        ALTER TABLE coord.policy_rule_resolutions
            DROP COLUMN IF EXISTS outcome_category,
            DROP COLUMN IF EXISTS outcome,
            DROP COLUMN IF EXISTS agent_decision,
            DROP COLUMN IF EXISTS resolution_payload,
            DROP COLUMN IF EXISTS served_policy_version
        """
    )

    op.execute("DROP INDEX IF EXISTS coord.idx_policy_rules_tenant_domain")
    op.execute(
        "ALTER TABLE coord.policy_rules "
        "DROP CONSTRAINT IF EXISTS policy_rules_kind_or_domain_check"
    )
    # Restore the original closed `kind` CHECK so a downgrade returns the
    # table to the prior revision's shape.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'policy_rules_kind_check'
                  AND conrelid = 'coord.policy_rules'::regclass
            ) THEN
                ALTER TABLE coord.policy_rules
                    ADD CONSTRAINT policy_rules_kind_check CHECK (
                        kind IN (
                            'baseline_waiver', 'block_override', 'escalation_rule',
                            'question_auto_answer', 'session_conflict_rule'
                        )
                    );
            END IF;
        END $$
        """
    )
    op.execute(
        """
        ALTER TABLE coord.policy_rules
            DROP COLUMN IF EXISTS payload,
            DROP COLUMN IF EXISTS autonomy_level,
            DROP COLUMN IF EXISTS mode,
            DROP COLUMN IF EXISTS decision_domain
        """
    )
