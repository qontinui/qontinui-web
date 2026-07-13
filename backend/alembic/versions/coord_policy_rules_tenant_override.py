"""coord policy_rules tenant override — per-tenant override of a system built-in rule

Revision ID: coord_policy_rules_tenant_override
Revises: coord_memory_synthesis_jobs
Create Date: 2026-07-05

Why
---
A built-in rate-limit rule is seeded on the SYSTEM tenant in
``coord.policy_rules`` and acts on every runner, but the authoring UI
(``GET /coord/policies``) only listed the caller tenant's own rows, so the
built-in was invisible and uneditable. coord's effective-set resolver now
returns the caller's rules PLUS the system built-ins (annotated), and a
tenant may OVERRIDE a built-in for its own workspace — disable it, or
substitute a customized version.

An override is a normal ``coord.policy_rules`` row owned by the tenant that
points back at the system rule it shadows via ``overrides_system_rule_id``.
The resolver uses that link to fold the override in place of the built-in
(``override_state`` = ``disabled`` / ``customized``) for the owning tenant
only.

* ``overrides_system_rule_id UUID NULL REFERENCES coord.policy_rules(policy_id)
  ON DELETE CASCADE`` — a self-FK to the system rule being shadowed. ON DELETE
  CASCADE so retiring a built-in cleans up every tenant's override of it.
* Partial unique index ``uq_policy_rules_tenant_override`` on
  ``(tenant_id, overrides_system_rule_id) WHERE overrides_system_rule_id
  IS NOT NULL`` — at most one override per (tenant, system rule); ordinary
  authored rows (``overrides_system_rule_id IS NULL``) are unconstrained.

Column is NULL-able and additive; existing rows are untouched. Idempotent
via ``IF NOT EXISTS`` on both the column and the index.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_policy_rules_tenant_override"
down_revision: str = "coord_memory_synthesis_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``coord.policy_rules.overrides_system_rule_id`` + partial-unique index."""
    # ----------------------------------------------------------------
    # 1. ADD COLUMN IF NOT EXISTS overrides_system_rule_id UUID NULL.
    #    Self-FK to the shadowed system rule; ON DELETE CASCADE so a
    #    retired built-in drops every tenant's override of it.
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.policy_rules
            ADD COLUMN IF NOT EXISTS overrides_system_rule_id UUID
                REFERENCES coord.policy_rules(policy_id) ON DELETE CASCADE
        """
    )

    # ----------------------------------------------------------------
    # 2. Partial unique index — at most one override per
    #    (tenant_id, system rule). Authored rows (NULL) are exempt.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_rules_tenant_override
            ON coord.policy_rules (tenant_id, overrides_system_rule_id)
            WHERE overrides_system_rule_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop the partial-unique index + the override column."""
    op.execute("DROP INDEX IF EXISTS coord.uq_policy_rules_tenant_override")
    op.execute(
        "ALTER TABLE coord.policy_rules DROP COLUMN IF EXISTS overrides_system_rule_id"
    )
