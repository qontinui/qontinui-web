"""coord tenant_merge_settings — per-tenant work-unit verification dials

Revision ID: wuverif_02
Revises: wuverif_01
Create Date: 2026-09-30

Phase 1 (storage) of the work-unit verification plan, second half. Adds four
columns to ``coord.tenant_merge_settings``:

* ``verification_sample_rate_bp INTEGER NULL`` — CHECK 1..10000. NULL means
  "inherit coord's default rate"; 0 is not storable (sampling off is a
  separate decision, not a rate).
* ``calibration_floor_bp INTEGER NULL`` — CHECK 1..10000. NULL means "inherit".
* ``verification_salt BYTEA NULL`` — per-tenant salt for deterministic
  sampling. NULL until coord mints one; never defaulted here, so a salt is
  never shared across tenants by a column default.
* ``verification_demotion_mode TEXT NOT NULL DEFAULT 'shadow'`` — CHECK
  ``shadow`` | ``live``. Every existing tenant row starts in ``shadow``
  (metadata-only on PG >= 11: a constant default needs no rewrite), so this
  revision arms no demotion anywhere.

DDL ONLY. Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` and
drop-then-add named CHECKs, so a re-run is a no-op (same posture as
``vetev_01``'s ``coord.work_units`` columns). CHECK names follow the table's
historical ``tenant_merge_settings_<column>_check`` convention
(``tenant_merge_settings_rollout_state_check``, since dropped by
``merge_enabled_02_drop_rollout_state``).

Hand-written — never ``--autogenerate`` (served policy ``production-and-cost``
``alembic-sole-authorship``). Deploy order: applied to prod BEFORE the coord
image that reads these columns.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "wuverif_02"
down_revision: str | Sequence[str] | None = "wuverif_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the four verification dials and their three CHECKs."""
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            ADD COLUMN IF NOT EXISTS verification_sample_rate_bp INTEGER,
            ADD COLUMN IF NOT EXISTS calibration_floor_bp INTEGER,
            ADD COLUMN IF NOT EXISTS verification_salt BYTEA,
            ADD COLUMN IF NOT EXISTS verification_demotion_mode TEXT
                NOT NULL DEFAULT 'shadow'
        """
    )

    op.execute(
        "ALTER TABLE coord.tenant_merge_settings DROP CONSTRAINT IF EXISTS "
        "tenant_merge_settings_verification_sample_rate_bp_check"
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            ADD CONSTRAINT tenant_merge_settings_verification_sample_rate_bp_check
                CHECK (verification_sample_rate_bp BETWEEN 1 AND 10000)
        """
    )
    op.execute(
        "ALTER TABLE coord.tenant_merge_settings DROP CONSTRAINT IF EXISTS "
        "tenant_merge_settings_calibration_floor_bp_check"
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            ADD CONSTRAINT tenant_merge_settings_calibration_floor_bp_check
                CHECK (calibration_floor_bp BETWEEN 1 AND 10000)
        """
    )
    op.execute(
        "ALTER TABLE coord.tenant_merge_settings DROP CONSTRAINT IF EXISTS "
        "tenant_merge_settings_verification_demotion_mode_check"
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            ADD CONSTRAINT tenant_merge_settings_verification_demotion_mode_check
                CHECK (verification_demotion_mode IN ('shadow', 'live'))
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.tenant_merge_settings.verification_sample_rate_bp IS
        'Basis points (1..10000) of shipped units sampled for independent '
        'verification. NULL = inherit coord''s default.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.tenant_merge_settings.verification_demotion_mode IS
        'shadow = a refutation is recorded but demotes nothing; live = a live '
        'refutation demotes the unit. Every pre-existing tenant starts shadow.'
        """
    )


def downgrade() -> None:
    """Drop the CHECKs, then the four columns (mirror order)."""
    op.execute(
        "ALTER TABLE coord.tenant_merge_settings DROP CONSTRAINT IF EXISTS "
        "tenant_merge_settings_verification_demotion_mode_check"
    )
    op.execute(
        "ALTER TABLE coord.tenant_merge_settings DROP CONSTRAINT IF EXISTS "
        "tenant_merge_settings_calibration_floor_bp_check"
    )
    op.execute(
        "ALTER TABLE coord.tenant_merge_settings DROP CONSTRAINT IF EXISTS "
        "tenant_merge_settings_verification_sample_rate_bp_check"
    )
    op.execute(
        """
        ALTER TABLE coord.tenant_merge_settings
            DROP COLUMN IF EXISTS verification_demotion_mode,
            DROP COLUMN IF EXISTS verification_salt,
            DROP COLUMN IF EXISTS calibration_floor_bp,
            DROP COLUMN IF EXISTS verification_sample_rate_bp
        """
    )
