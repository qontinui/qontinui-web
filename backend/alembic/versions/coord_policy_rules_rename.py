"""coord coordination-policy engine: rename to coord.policy_rules

Revision ID: coord_policy_rules_rename
Revises: coord_group_claim_provisioning
Create Date: 2026-05-29

Phase 0 of plan
``D:/qontinui-root/plans/2026-05-29-tenant-policies-collision-fix.md``.

Resolves a table-name collision: the session-substrate migration
``coord_session_substrate`` already owns ``coord.tenant_policies`` (a
per-tenant policy-knobs table, PK on ``tenant_id``, live data + a
load-bearing read in ``coord/src/sessions.rs``). The coordination
policy engine (PR #157) also tried to claim ``coord.tenant_policies``
with an incompatible rule-engine schema (PK ``policy_id``) via a
runtime ``CREATE TABLE IF NOT EXISTS`` self-heal — which silently
no-op'd against the existing substrate table, then aborted the whole
batch on the very next ``CREATE INDEX ... (tenant_id, enabled, kind)``
because ``enabled``/``kind`` don't exist on the substrate schema. The
engine's tables therefore never existed in any environment, and the
first real INSERT against ``/coord/policies`` would 500.

This migration gives the engine its own tables:

* ``coord.policy_rules`` — the rule-engine table (schema lifted
  verbatim from ``coord/src/policies/table.rs``).
* ``coord.policy_rule_resolutions`` — the resolution audit log
  (was ``coord.policy_resolutions`` in the never-created self-heal).

The session-substrate ``coord.tenant_policies`` is left entirely
untouched — no DROP, no column change, no data migration.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT
EXISTS``. Runtime self-heal posture per
[[feedback_canonical_db_behind_alembic]]: the coord-side helper
``policies::table::ensure_policy_tables`` mirrors these statements
under the same new names so coord boots cleanly against a PG where
this revision hasn't been applied yet.

Chains off ``coord_group_claim_provisioning``, the current single head.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_policy_rules_rename"
down_revision: str = "coord_group_claim_provisioning"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the policy-engine tables under their non-colliding names.
    Idempotent. Does NOT touch coord.tenant_policies (substrate's)."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.policy_rules (
            policy_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL,
            repo        TEXT,
            name        TEXT NOT NULL,
            kind        TEXT NOT NULL CHECK (kind IN (
                'baseline_waiver', 'block_override', 'escalation_rule',
                'question_auto_answer', 'session_conflict_rule'
            )),
            condition   JSONB NOT NULL,
            action      JSONB NOT NULL,
            priority    INTEGER NOT NULL DEFAULT 100,
            enabled     BOOLEAN NOT NULL DEFAULT true,
            expires_at  TIMESTAMPTZ,
            expire_when JSONB,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_by  TEXT NOT NULL,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by  TEXT NOT NULL,
            rationale   TEXT
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_policy_rules_tenant_active
            ON coord.policy_rules (tenant_id, enabled, kind)
            WHERE enabled = true
              AND (expires_at IS NULL OR expires_at > now())
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_policy_rules_tenant_repo
            ON coord.policy_rules (tenant_id, repo)
            WHERE enabled = true
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.policy_rule_resolutions (
            resolution_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            policy_id       UUID NOT NULL,
            tenant_id       UUID NOT NULL,
            resolved_entity JSONB NOT NULL,
            action_taken    JSONB NOT NULL,
            resolved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_by     TEXT NOT NULL DEFAULT 'policy'
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_policy_rule_resolutions_policy
            ON coord.policy_rule_resolutions (policy_id, resolved_at DESC)
        """
    )


def downgrade() -> None:
    """Drop the two engine tables. coord.tenant_policies (substrate's)
    is never touched by this revision, so downgrade leaves it intact."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_policy_rule_resolutions_policy"
    )
    op.execute("DROP TABLE IF EXISTS coord.policy_rule_resolutions")
    op.execute("DROP INDEX IF EXISTS coord.idx_policy_rules_tenant_repo")
    op.execute("DROP INDEX IF EXISTS coord.idx_policy_rules_tenant_active")
    op.execute("DROP TABLE IF EXISTS coord.policy_rules")
