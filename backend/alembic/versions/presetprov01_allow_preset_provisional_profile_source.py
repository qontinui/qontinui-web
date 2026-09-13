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

One-time data reclassification (reviewer finding S4). The coord change only
stamps ``preset_provisional`` on probes that run AFTER it ships; it never heals
a row already stored as ``preset``. Rows enrolled earlier from a failed or
empty-root probe (e.g. ``portofino-pizzeria/backend``, enrolled while its repo
was still empty) therefore stay frozen on the generic escalate-everything
preset forever. After widening the CHECK, ``upgrade()`` reclassifies exactly
the rows that carry the generic preset's fingerprint — ``profile_source =
'preset'`` AND ``framework_signals = ARRAY['generic']`` AND
``escalate_paths_extra = ARRAY['**/*']`` (both ``TEXT[]``, exact equality) — to
``preset_provisional``, so the next default-branch push re-derives them. This
converges: a genuinely generic repo re-derives to ``preset`` with the same
generic values after one probe, while a mis-detected repo re-derives to its
real framework preset. Rows from any other source, and preset rows with any
other signal or escalate set, are untouched. The UPDATE is idempotent — a
second run matches nothing because matched rows no longer read ``preset``.

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
    # S4: reclassify frozen generic preset rows so coord re-derives them.
    # A row matching this fingerprint records the generic fallback preset
    # (coord ``pr_merge::presets::generic_preset``: frameworks ["generic"],
    # escalate_paths ["**/*"]), which is exactly what a FAILED or EMPTY-root
    # enrollment probe produced before coord learned to stamp
    # 'preset_provisional'. The stored row cannot tell a genuinely generic
    # repo from a mis-detected one, so treat it as the UNKNOWN verdict it may
    # be. Convergence: a genuinely generic repo re-derives to 'preset' with
    # the same generic values on its next default-branch push (one extra
    # probe, then stable); a mis-detected repo (e.g. empty at enrollment)
    # re-derives to its real preset. Matching is exact array equality on the
    # TEXT[] columns, so a polyglot/edited escalate set (``**/*`` plus
    # anything) or a non-generic signal is never touched, and the only coord
    # writer of 'preset' always writes both columns from the same preset.
    # Idempotent: matched rows no longer carry 'preset', so a rerun is a no-op.
    op.execute(
        "UPDATE coord.tenant_repo_profiles "
        "SET profile_source = 'preset_provisional', updated_at = now() "
        "WHERE profile_source = 'preset' "
        "AND framework_signals = ARRAY['generic']::text[] "
        "AND escalate_paths_extra = ARRAY['**/*']::text[]"
    )


def downgrade() -> None:
    # presetsrc01's downgrade does not reclassify rows carrying the value it
    # removes; it only notes they must be handled first. A provisional row
    # records an UNKNOWN probe verdict, and silently rewriting it to 'preset'
    # would re-create exactly the false-authoritative state this revision
    # exists to prevent. So refuse loudly instead of guessing: an operator
    # must reclassify those rows (or delete them for re-probe) before
    # downgrading. The DO block works in both online and --sql modes.
    #
    # Rows reclassified by upgrade() (S4) COUNT toward this refusal, and that
    # is deliberate. Reversing the reclassification here is not possible
    # safely: once coord has written its own 'preset_provisional' rows, a
    # reclassified row (generic signals + ``**/*``) is byte-identical to a
    # coord-written provisional row from a failed probe, and no marker was
    # stored to tell them apart. Flipping every generic provisional row back
    # to 'preset' would silently turn coord's UNKNOWN verdicts into
    # authoritative presets. If coord's next push has already re-derived a
    # reclassified row, it reads 'preset' again and does not block. An
    # operator who wants to downgrade before that must decide per row.
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
