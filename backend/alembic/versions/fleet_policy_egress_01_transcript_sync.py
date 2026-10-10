"""Copy each tenant's transcript-sync ``off`` into the ``egress_transcript_sync`` and ``egress_terminal_stream`` fleet-policy domains

Revision ID: fleet_policy_egress_01_transcript_sync
Revises: census_idx_01_device_repo_path_observed
Create Date: 2026-10-10

Phase 6 step 3(b) of plan
``qontinui-dev-notes/plans/2026-10-10-spec-front-end-phase-9-generic-boundary.md``.

What this is
============

A DATA revision. It authors **no schema**. Transcript sync joins the egress
fleet-policy family (design decision C4): its per-tenant switch moves from the
column ``coord.tenant_policies.transcript_sync_enabled`` to a tenant-band
``coord.fleet_runtime_policy`` row for the domain ``egress_transcript_sync``.
The domain itself needs no DDL — ``domain`` and ``level`` are plain TEXT with
no CHECK (``fleet_policy_01``) — so the only thing a migration must carry over
is each tenant's existing *choice*.

The column governed BOTH session-output streams (coord refused ``pty`` and
``transcript`` alike while it was ``false``), and the two streams are now two
domains — ``egress_transcript_sync`` (``transcript``) and
``egress_terminal_stream`` (``pty``). So for every ``coord.tenant_policies`` row
whose ``transcript_sync_enabled`` is ``false``, this writes one tenant-band row
per domain

```text
domain          egress_transcript_sync | egress_terminal_stream
scope_band      tenant
scope_key       NULL
level           off
master_enabled  true
current_version 1
updated_by      migration:fleet_policy_egress_01_transcript_sync
```

plus each row's version-1 snapshot in ``coord.fleet_runtime_policy_versions``.
Tenants left at ``true`` (the column default) get NO row and inherit the
domains' no-row default, which is coord-side code (``on`` under the hosted
deployment profile).

Deploy ordering (load-bearing)
==============================

The four landings of step 3 exist so no tenant's ``off`` is ever unhonoured:

* (a) qontinui-coord, FIRST: the ingest refusal reads the domain AND still
  the column, which refuses BOTH streams (``transcript`` and ``pty``) while it
  is ``false``; ``PATCH /tenant-policy`` refuses (422) any body naming
  ``transcript_sync_enabled``, which FREEZES the column.
* (b) THIS revision, only after (a) is deployed (verified by reading coord's
  ``/health`` build): the column can no longer change, so the copy taken here
  is final.
* (c) qontinui-coord: stop honouring the column once it OBSERVES this revision
  applied (its stamped alembic head, or ancestry in
  ``coord.migration_revisions``) — safe even if deployed before this runs.
* (c2) qontinui-coord: delete the column read, after (c) reports
  ``egress_legacy_column = "retired"`` on ``GET /tenant-policy``.
* (d) qontinui-web ``tenant_policies_03_drop_transcript_sync_enabled``: drop
  the column, after (c2) is deployed.

Landing this before (a) would leave a window in which a ``PATCH`` after the
copy was silently dropped at the read switch.

The write obligations this honours
==================================

* **Every row that claims a version has its snapshot**, in the same statement
  (a data-modifying CTE), as the versions table's ``COMMENT ON TABLE``
  (``fleet_res_tel_02``) requires — the ``cihost_01`` precedent.
* **A tenant that already wrote a domain row keeps it.** ``ON CONFLICT DO
  NOTHING`` on the functional unique index ``uq_fleet_runtime_policy_scope``
  (spelled with its exact expression so Postgres infers it); the CTE's
  ``RETURNING id`` is empty for a skipped row, so no spurious snapshot either.
* **Only tenants that chose ``off``.** ``WHERE transcript_sync_enabled =
  false``; a ``NULL`` cannot occur (the column is ``NOT NULL``).

Downgrade
=========

**Rollback precondition: only safe while the running coord is step 3(a) or
3(c) before it has confirmed this revision** — a coord that still honours the
frozen column. Once a coord has stopped honouring it (3(c) after confirmation,
or 3(c2)), the rows this downgrade deletes are the ONLY record of a tenant's
``off``, and removing them turns both streams back on for that tenant.

Deletes exactly what the upgrade wrote and only while it is still in that
state: tenant-band rows of the two domains with ``updated_by`` equal to
this revision's identity and ``current_version`` still 1. A row an operator has
since edited (version 2+) is theirs and stays. The snapshot DELETE is written
first rather than relying on the versions FK's ``ON DELETE CASCADE``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "fleet_policy_egress_01_transcript_sync"
down_revision: str | Sequence[str] | None = "census_idx_01_device_repo_path_observed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Insert tenant-band ``off`` rows for both stream domains, plus v1 snapshots."""
    op.execute(
        """
        WITH ins AS (
            INSERT INTO coord.fleet_runtime_policy
                (tenant_id, domain, scope_band, scope_key, level,
                 master_enabled, current_version, updated_by, updated_at)
            SELECT tp.tenant_id, d.domain, 'tenant', NULL, 'off',
                   true, 1, 'migration:fleet_policy_egress_01_transcript_sync', now()
            FROM coord.tenant_policies tp
            CROSS JOIN (VALUES ('egress_transcript_sync'), ('egress_terminal_stream'))
                AS d(domain)
            WHERE tp.transcript_sync_enabled = false
            ON CONFLICT (tenant_id, domain, scope_band, COALESCE(scope_key, ''))
                DO NOTHING
            RETURNING id
        )
        INSERT INTO coord.fleet_runtime_policy_versions
            (policy_id, version, level, master_enabled,
             change_note, updated_by, created_at)
        SELECT ins.id, 1, 'off', true,
               'Copied from coord.tenant_policies.transcript_sync_enabled = false '
               '(plan 2026-10-10-spec-front-end-phase-9-generic-boundary, Phase 6 step 3b)',
               'migration:fleet_policy_egress_01_transcript_sync', now()
        FROM ins
        """
    )


def downgrade() -> None:
    """Delete only the rows this revision wrote, while they are still at version 1."""
    op.execute(
        """
        DELETE FROM coord.fleet_runtime_policy_versions v
        USING coord.fleet_runtime_policy p
        WHERE v.policy_id = p.id
          AND p.domain IN ('egress_transcript_sync', 'egress_terminal_stream')
          AND p.scope_band = 'tenant'
          AND p.updated_by = 'migration:fleet_policy_egress_01_transcript_sync'
          AND p.current_version = 1
        """
    )
    op.execute(
        """
        DELETE FROM coord.fleet_runtime_policy
        WHERE domain IN ('egress_transcript_sync', 'egress_terminal_stream')
          AND scope_band = 'tenant'
          AND updated_by = 'migration:fleet_policy_egress_01_transcript_sync'
          AND current_version = 1
        """
    )
