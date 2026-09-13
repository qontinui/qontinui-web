"""allow 'preset_provisional' profile_source on coord.tenant_repo_profiles

Phase 2 of plan ``2026-09-13-escalate-path-block-is-agent-clearable-on-evidence``
changes what coord writes when an enrollment root probe FAILS (e.g. a 403 on
the contents API). Today that failure is recorded as an authoritative
``profile_source='preset'`` built from a ``generic`` guess, which then blocks
the repo's escalate paths as if the probe had succeeded. Coord will instead
stamp ``profile_source='preset_provisional'`` — an UNKNOWN verdict that a later
successful probe may replace — so a failed probe no longer persists as an
authoritative ``preset``.

The CHECK last widened in ``presetsrc01_allow_preset_profile_source`` only
permits ``('audit','user_edit','drift_accept','manual','preset')``, so the coord
write would fail with a ``tenant_repo_profiles_source_check`` violation. This
widen MUST deploy before the coord write ships (served policy
``production-and-cost`` ``alembic-sole-authorship``).

Revision ID: presetprov01_allow_preset_provisional_profile_source
Revises: remote_create_01
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "presetprov01_allow_preset_provisional_profile_source"
down_revision = "remote_create_01"
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
        "CHECK (profile_source IN "
        "('audit', 'user_edit', 'drift_accept', 'manual', 'preset', 'preset_provisional'))"
    )


def downgrade() -> None:
    # presetsrc01's downgrade does not reclassify rows carrying the value it
    # removes; it only notes they must be handled first. A provisional row
    # records an UNKNOWN probe verdict, and silently rewriting it to 'preset'
    # would re-create exactly the false-authoritative state this revision
    # exists to prevent. So refuse loudly instead of guessing: an operator
    # must reclassify those rows (or delete them for re-probe) before
    # downgrading. The DO block works in both online and --sql modes.
    op.execute(
        """
        DO $$
        DECLARE
            provisional_count bigint;
        BEGIN
            SELECT count(*) INTO provisional_count
            FROM coord.tenant_repo_profiles
            WHERE profile_source = 'preset_provisional';
            IF provisional_count > 0 THEN
                RAISE EXCEPTION
                    'cannot downgrade presetprov01: % coord.tenant_repo_profiles '
                    'row(s) carry profile_source=''preset_provisional''; '
                    'reclassify or delete them first',
                    provisional_count;
            END IF;
        END
        $$;
        """
    )
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "DROP CONSTRAINT IF EXISTS tenant_repo_profiles_source_check"
    )
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "ADD CONSTRAINT tenant_repo_profiles_source_check "
        "CHECK (profile_source IN ('audit', 'user_edit', 'drift_accept', 'manual', 'preset'))"
    )
