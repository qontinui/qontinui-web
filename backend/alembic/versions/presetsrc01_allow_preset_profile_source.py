"""allow 'preset' profile_source on coord.tenant_repo_profiles

Zero-touch onboarding (deviceless preset profiles) writes
``profile_source='preset'``, but the original CHECK created in
``pr_merge_02_tenant_settings`` only permitted
``('audit','user_edit','drift_accept','manual')``. So every auto-enrolled
preset INSERT failed in prod with a CHECK violation
(``tenant_repo_profiles_source_check``), leaving auto-enrolled repos WITHOUT
their ``dry_run_override`` row and therefore inheriting the tenant's (live)
rollout — the opposite of the intended dry-run-safe enrollment. Widen the
CHECK to include ``'preset'``.

Revision ID: presetsrc01_allow_preset_profile_source
Revises: pr_unlandable_attempts_01_create_table
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "presetsrc01_allow_preset_profile_source"
down_revision = "pr_unlandable_attempts_01_create_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "DROP CONSTRAINT IF EXISTS tenant_repo_profiles_source_check"
    )
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "ADD CONSTRAINT tenant_repo_profiles_source_check "
        "CHECK (profile_source IN ('audit', 'user_edit', 'drift_accept', 'manual', 'preset'))"
    )


def downgrade() -> None:
    # Reverting requires no 'preset' rows to remain (they would violate the
    # narrower constraint); onboarding writes 'preset', so a downgrade should
    # be paired with reclassifying those rows first.
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "DROP CONSTRAINT IF EXISTS tenant_repo_profiles_source_check"
    )
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "ADD CONSTRAINT tenant_repo_profiles_source_check "
        "CHECK (profile_source IN ('audit', 'user_edit', 'drift_accept', 'manual'))"
    )
