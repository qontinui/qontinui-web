"""coord pull-decision feed — (tenant_id, decision_domain, resolved_at) index

Revision ID: pull_decision_resolutions_index
Revises: cognito_legacy_auth_teardown_02
Create Date: 2026-05-31

Phase 2 of plan
``D:/qontinui-root/plans/2026-05-30-coord-pull-decision-ui.md`` (Feature A,
Open-Q2 — scalability).

The Pull Decisions activity page polls coord's ``GET
/coord/policies/resolutions`` every 10s with the query::

    SELECT ...
    FROM coord.policy_rule_resolutions
    WHERE tenant_id = $1
      AND resolved_entity->>'decision_domain' = $2     -- 'repo_pull'
    ORDER BY resolved_at DESC
    LIMIT $n

The existing indexes on ``coord.policy_rule_resolutions``
(``idx_policy_rule_resolutions_policy (policy_id, resolved_at DESC)``, the
partial ``idx_policy_rule_resolutions_unlabeled_device``, and
``idx_policy_rule_resolutions_labeled_policy`` — added by
``coord_policy_rules_rename`` + ``decision_engine_phase3``) cover NONE of this
access path: there is no tenant-leading index and no
``decision_domain`` expression index. So the polled query is a tenant-wide
sequential scan that grows as resolutions accrue fleet-wide across ALL decision
domains. This migration adds the covering expression index.

The index expression mirrors the WHERE/ORDER BY exactly:
``(tenant_id, (resolved_entity->>'decision_domain'), resolved_at DESC)``. The
``->>`` text extraction is IMMUTABLE, so Postgres accepts it in an index
expression (unlike a ``now()``-bearing predicate — see
``reference_alembic_now_index_and_offline_sql_gap``).

ALEMBIC IS THE SOLE ``coord.*`` SCHEMA AUTHOR
(``proj_alembic_sole_author_coord_schema``): there is NO Rust self-heal mirror
for this index; ``coord/tests/coord_schema_authorship.rs`` fails CI on any
production-Rust ``coord.*`` DDL. Forward-only / expand-only
(``reference_alembic_expand_contract_forward_only``): ``upgrade`` creates the
index ``IF NOT EXISTS``; ``downgrade`` drops it ``IF EXISTS``. No
``CONCURRENTLY`` — alembic runs each migration inside a transaction.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pull_decision_resolutions_index"
down_revision: str = "cognito_legacy_auth_teardown_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: covering expression index for the Pull Decisions feed query.
    Idempotent. Does not alter or drop any existing object."""
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_policy_rule_resolutions_tenant_domain_resolved
            ON coord.policy_rule_resolutions
               (tenant_id, (resolved_entity->>'decision_domain'), resolved_at DESC)
        """
    )


def downgrade() -> None:
    """Reverse the additive index. The table + every other index survive."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_policy_rule_resolutions_tenant_domain_resolved"
    )
