"""coord.tenant_policies — drop ``transcript_sync_enabled`` (retired into the egress fleet-policy family)

Revision ID: tenant_policies_03_drop_transcript_sync_enabled
Revises: fleet_policy_egress_01_transcript_sync
Create Date: 2026-10-10

Phase 6 step 3(d) of plan
``qontinui-dev-notes/plans/2026-10-10-spec-front-end-phase-9-generic-boundary.md``.

Transcript sync's per-tenant switch is the tenant-band
``egress_transcript_sync`` row in ``coord.fleet_runtime_policy`` (design
decision C4). ``fleet_policy_egress_01_transcript_sync`` copied every frozen
``false`` into ``off`` rows for both ``egress_transcript_sync`` and
``egress_terminal_stream``; qontinui-coord step 3(c2) stopped reading the
column.
This revision deletes it (``engineering-priorities`` delete-over-deprecate).

Deploy ordering (load-bearing)
==============================

Land only after coord step 3(c2) is DEPLOYED, verified by reading coord's
``/health`` build — ``production-and-cost`` ``alembic-sole-authorship``: a
coord build that still reads a dropped column fails every session-output append
fleet-wide. ``check_coord_column_drops.py`` enforces the same rule against
coord's served read-surface manifest and refuses this PR while any deployed or
``main`` coord still lists ``tenant_policies.transcript_sync_enabled``.

Downgrade
=========

Re-adds the column with its original ``NOT NULL DEFAULT true`` (the
``tenant_policies_02`` definition), then restores ``false`` for EVERY tenant in
``coord.tenants`` whose ``egress_transcript_sync`` OR ``egress_terminal_stream``
resolves off — the column governed both streams, so either being off must keep
both refused under a coord that reads the column again. "Resolves off" follows
coord's own resolution: the tenant-band row if there is one (off when its level
is not ``on`` or its master is off), else the system-band row, else the
deployment default, which is ``off`` only when this process runs with
``COORD_DEPLOYMENT_PROFILE=self_hosted`` (the migration cannot see coord's
setting any other way). A tenant with no ``tenant_policies`` row gets one
(``INSERT … ON CONFLICT (tenant_id) DO UPDATE``), so its ``off`` is not lost to
the column's ``true`` default.
"""

import os
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "tenant_policies_03_drop_transcript_sync_enabled"
down_revision: str | Sequence[str] | None = "fleet_policy_egress_01_transcript_sync"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop ``coord.tenant_policies.transcript_sync_enabled``."""
    op.drop_column("tenant_policies", "transcript_sync_enabled", schema="coord")


def downgrade() -> None:
    """Re-add the column and restore ``false`` for every tenant whose egress resolves off."""
    op.execute(
        """
        ALTER TABLE coord.tenant_policies
            ADD COLUMN IF NOT EXISTS transcript_sync_enabled
                BOOLEAN NOT NULL DEFAULT true
        """
    )
    self_hosted = os.environ.get("COORD_DEPLOYMENT_PROFILE") == "self_hosted"
    op.get_bind().execute(
        sa.text(
            """
            WITH resolved AS (
                SELECT t.tenant_id,
                       COALESCE(
                           (SELECT p.level <> 'on' OR NOT p.master_enabled
                              FROM coord.fleet_runtime_policy p
                             WHERE p.tenant_id = t.tenant_id AND p.domain = d.domain
                               AND p.scope_band = 'tenant'
                             LIMIT 1),
                           (SELECT p.level <> 'on' OR NOT p.master_enabled
                              FROM coord.fleet_runtime_policy p
                             WHERE p.tenant_id = t.tenant_id AND p.domain = d.domain
                               AND p.scope_band = 'system'
                             LIMIT 1),
                           CAST(:self_hosted AS boolean)
                       ) AS is_off
                FROM coord.tenants t
                CROSS JOIN (VALUES ('egress_transcript_sync'), ('egress_terminal_stream'))
                    AS d(domain)
            )
            INSERT INTO coord.tenant_policies (tenant_id, transcript_sync_enabled)
            SELECT tenant_id, false FROM resolved
            GROUP BY tenant_id
            HAVING bool_or(is_off)
            ON CONFLICT (tenant_id) DO UPDATE SET transcript_sync_enabled = false
            """
        ),
        {"self_hosted": self_hosted},
    )
