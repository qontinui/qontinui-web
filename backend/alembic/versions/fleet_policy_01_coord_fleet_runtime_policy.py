"""fleet-policy 01 coord.fleet_runtime_policy — data-driven fleet runtime-policy store

Revision ID: fleet_policy_01_coord_fleet_runtime_policy
Revises: gate_action_prefs_01_notification_preferences
Create Date: 2026-06-08

Phase 3 backing of the fleet-policy channel redesign
(``qontinui-dev-notes/plans/2026-06-08-fleet-policy-channel-redesign.md`` §3).

Creates one **data-driven** ``coord.*`` table consumed by qontinui-coord (Rust),
which cannot author DDL — Alembic in qontinui-web is the sole author of the
``coord.*`` schema:

* ``coord.fleet_runtime_policy`` — one row per (tenant, domain, scope) tuple
  holding the runtime policy ``level`` (and a ``master_enabled`` kill-switch)
  for a fleet-policy *domain* (e.g. ``install_interception``). Domains and
  levels are **data**, not enums — only the ``scope_band`` vocabulary is fixed
  (``system`` / ``tenant`` / ``repo``) and CHECK-constrained.

Design notes (mirrors ``install_sig_01_coord_install_signatures`` /
``decision_engine_phase0`` conventions):

* ``domain`` and ``level`` are plain TEXT with NO enum/CHECK — domains are added
  as data and ``level`` carries domain-specific values (off/observe/gate/...),
  validated app-side. Only ``scope_band`` has a fixed vocabulary so it gets a
  text+CHECK (``fleet_runtime_policy_scope_band_chk``), same rationale as
  ``coord.install_signatures.composed_outcome``.
* The scope uniqueness is a functional UNIQUE INDEX over
  ``(tenant_id, domain, scope_band, COALESCE(scope_key, ''))`` — the COALESCE is
  REQUIRED so the nullable ``scope_key`` (NULL for tenant/system bands) collapses
  to a single key per (tenant, domain, band); a plain UNIQUE over a nullable
  column would let multiple NULL rows duplicate. Alembic's ``op.create_index``
  cannot express COALESCE, so the index is emitted as raw SQL via ``op.execute``
  with a ``coord``-qualified table name — the established pattern in
  ``decision_engine_phase0`` (``uq_priority_sets_tenant_name_repo``) and
  ``consolidation_phase1_11_generation_pipeline``.
* ``coord`` already exists (created by ``consolidation_phase1_01_infrastructure``);
  this migration does NOT ``CREATE SCHEMA``.
* The ``now()`` default is a plain column default (evaluated per-row at INSERT) —
  fine; only a problem inside a partial-index predicate (none used here).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "fleet_policy_01_coord_fleet_runtime_policy"
down_revision: str | Sequence[str] | None = "gate_action_prefs_01_notification_preferences"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "fleet_runtime_policy",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        # Fleet-policy domain, e.g. 'install_interception' — generic data, no enum.
        sa.Column("domain", sa.Text(), nullable=False),
        # Fixed vocabulary: 'system' | 'tenant' | 'repo' (CHECK below).
        sa.Column("scope_band", sa.Text(), nullable=False),
        # Repo basename when scope_band='repo'; NULL for tenant/system.
        sa.Column("scope_key", sa.Text(), nullable=True),
        # Domain-specific level (off/observe/gate/...); validated app-side, no CHECK.
        sa.Column("level", sa.Text(), nullable=False),
        sa.Column(
            "master_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "scope_band IN ('system','tenant','repo')",
            name="fleet_runtime_policy_scope_band_chk",
        ),
        schema="coord",
    )
    # Scope uniqueness — COALESCE collapses the nullable scope_key so tenant/system
    # rows (scope_key IS NULL) can't duplicate. Raw SQL: op.create_index can't
    # express COALESCE (see module docstring / decision_engine_phase0 precedent).
    op.execute(
        """
        CREATE UNIQUE INDEX uq_fleet_runtime_policy_scope
            ON coord.fleet_runtime_policy
            (tenant_id, domain, scope_band, COALESCE(scope_key, ''))
        """
    )
    # Runner hot-lookup of all scopes for a (tenant, domain).
    op.create_index(
        "idx_fleet_runtime_policy_tenant_domain",
        "fleet_runtime_policy",
        ["tenant_id", "domain"],
        schema="coord",
    )


def downgrade() -> None:
    # Reverse order of upgrade().
    op.drop_index(
        "idx_fleet_runtime_policy_tenant_domain",
        table_name="fleet_runtime_policy",
        schema="coord",
    )
    op.drop_index(
        "uq_fleet_runtime_policy_scope",
        table_name="fleet_runtime_policy",
        schema="coord",
    )
    op.drop_table("fleet_runtime_policy", schema="coord")
