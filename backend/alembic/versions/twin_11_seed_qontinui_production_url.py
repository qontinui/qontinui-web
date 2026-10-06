"""twin served-bundle — seed qontinui's own twin_targets.production_url

Revision ID: twin_11_seed_qontinui_production_url
Revises: coord_maintenance_windows_01
Create Date: 2026-09-29

Phase 2 of plan ``2026-09-17-twin-observer-genericity-non-release-consumers``,
the data half. ``twin_10_served_bundle_target_columns`` added
``coord.twin_targets.production_url`` as pure schema; this revision fills it on
the one row coord's served-bundle observer watches today, so that Phase 3 (the
coord change that removes the hardcoded ``ENTRY_URL`` and observes every
``vercel`` row declaring a ``production_url``) keeps observing qontinui's own
site instead of going dark.

It is a separate revision because it is data DML: coord's migration
classifier refuses any ``UPDATE`` and holds a PR carrying one on
``escalate-path-matched``. Kept apart, twin_10 lands on the auto-safe path, and
this one lands by operator override.

What it does
============

Sets ``production_url = 'https://qontinui.io/'`` — the value of the
``ENTRY_URL`` const coord hardcodes until Phase 3 — on the system tenant's
``vercel`` / ``qontinui-web`` row.

* **The system tenant, by its flag.** The row is matched through
  ``coord.tenants.is_system``. The unique partial index ``uq_tenants_is_system``
  (``coord_system_tenant_marker``) allows at most one such tenant, so no other
  tenant's row can be matched. Matching by slug alone would be wrong:
  ``coord_system_tenant_rename_qontinui`` (#1385) is a no-op on a database
  where another tenant already owns ``qontinui``, and a slug match would then
  seed that other tenant too.
* **Only while the system tenant still carries a qontinui slug.** The extra
  ``slug IN ('qontinui', 'personal-jspinak')`` filter covers both spellings
  (before and after #1385), and skips the seed on a deployment whose operator
  has renamed its system tenant to something else.
* **Fresh databases are seeded too.** ``twin_08`` inserts the
  ``vercel``/``qontinui-web`` row for the bootstrap tenant and #1385 renames
  that tenant to ``qontinui``. So every database built through the chain,
  including a new deployment that is not qontinui, gets this URL on its system
  tenant. That keeps what coord does today (it hardcodes ``ENTRY_URL``) rather
  than making it worse. The operator of such a deployment should set that
  row's ``production_url`` to their own site, or clear it.
* **Fills NULL only.** An operator-set URL is never overwritten.
* **Single row.** ``(tenant_id, surface, target)`` is the primary key of
  ``coord.twin_targets`` and at most one tenant is the system tenant, so the
  filter matches at most one row. A database whose system tenant has no such row (one not built
  through the chain) is a no-op.
* **Idempotent.** A re-run finds the value set and matches nothing.
* **Silent when it matches nothing.** A zero-row match (a renamed system
  tenant, a missing row, or a URL already set) is not reported here. Before
  merging Phase 3, read the production row back to confirm the URL is set.

Downgrade
=========

A no-op. The URL cannot be told apart from one an operator set to the same
value afterwards, so un-setting it could erase operator data. Downgrading past
twin_10 drops the column, and the value with it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_11_seed_qontinui_production_url"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "coord_maintenance_windows_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Seed qontinui's own production URL on its vercel/qontinui-web row."""
    op.execute(
        """
        UPDATE coord.twin_targets
           SET production_url = 'https://qontinui.io/',
               updated_at = now()
         WHERE surface = 'vercel'
           AND target = 'qontinui-web'
           AND production_url IS NULL
           AND tenant_id IN (
                   SELECT tenant_id FROM coord.tenants
                    WHERE is_system
                      AND slug IN ('qontinui', 'personal-jspinak')
               )
        """
    )


def downgrade() -> None:
    """No-op: an equal operator-set value is indistinguishable from the seed."""
