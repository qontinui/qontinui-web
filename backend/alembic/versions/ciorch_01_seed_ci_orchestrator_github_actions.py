"""Seed ``ci_orchestrator = github_actions`` for every tenant existing now

Revision ID: ciorch_01
Revises: journey_01_edge_ledger
Create Date: 2026-10-04

Phase 1 (design decision D1) of plan
``qontinui-dev-notes/plans/2026-10-04-coord-managed-ci-for-every-tenant-with-an-actions-free-mode.md``.

What this is
============

A DATA revision. It authors **no schema**: no CREATE, no ALTER, no DROP. The
new fleet-policy domain ``ci_orchestrator`` (``github_actions`` | ``coord``)
needs no DDL because ``coord.fleet_runtime_policy.domain`` and ``.level`` are
plain TEXT with no CHECK (``fleet_policy_01``) — declaring a domain is a
code-only change on the coord side.

What a domain cannot get from code is the guarantee D1 makes: **existing
tenants never flip silently.** A later phase (Phase 7) gives the domain a
no-row default of ``coord`` in coord's ``domain_default_level``. Every tenant
that exists when this revision runs must therefore already hold an explicit
``github_actions`` row by then, so the default reaches only tenants created
afterwards. This revision writes, for EVERY row of ``coord.tenants`` (the
system tenant included — its tenant-band row is its own setting, not a fleet
default), one tenant-band row

```text
tenant_id       <each coord.tenants.tenant_id>
domain          ci_orchestrator
scope_band      tenant
scope_key       NULL           (tenant band: coord reads COALESCE(scope_key,'') = '')
level           github_actions
master_enabled  true
current_version 1
updated_by      alembic:ciorch_01
```

plus its version-1 snapshot in ``coord.fleet_runtime_policy_versions``.

``coord.tenants`` is the tenant registry every coord table FKs to
(``coord.tenant_repos``, ``coord.tenant_devices``, …) and the one the sibling
seed ``cihost_01`` guards on; it carries no soft-delete column, so every row
is a live tenant.

The write obligations this honours
==================================

* **Never overwrite an operator's choice.** The conflict target is the
  functional unique index ``uq_fleet_runtime_policy_scope`` over
  ``(tenant_id, domain, scope_band, COALESCE(scope_key, ''))``
  (``fleet_policy_01``), spelled with the same expression so Postgres infers
  it, with ``DO NOTHING``. A tenant that already has a tenant-band
  ``ci_orchestrator`` row keeps it, whatever its level.
* **Every row that claims a version has its snapshot.** The versions table's
  ``COMMENT ON TABLE`` (``fleet_res_tel_02``) requires the snapshot INSERT in
  the SAME transaction as the parent, "including the first one". The parent
  INSERT and the snapshot INSERT are one statement — a data-modifying CTE.
* **The snapshot is written only for a row this revision wrote.** The CTE's
  ``RETURNING id`` yields nothing for a skipped tenant, so a pre-existing row
  gets no spurious second v1 snapshot.
* **Snapshot payload equals the parent payload.** The control columns added by
  ``fleet_res_tel_03`` / ``sess_guard_01`` are nullable "no override" columns,
  NULL on the parent here, so NULL on the snapshot too.

Downgrade
=========

Deletes exactly what the upgrade wrote, and only while it is still in the state
the upgrade left it: tenant-band ``ci_orchestrator`` rows whose ``updated_by``
is ``alembic:ciorch_01`` AND whose ``current_version`` is still 1. A row an
operator has since edited (version 2+, ``updated_by`` an operator) is theirs and
stays. The snapshot DELETE is written out before the parent DELETE so the
downgrade states what it removes rather than leaning on the versions FK's
``ON DELETE CASCADE``.

Merge-train note: coord's migration classifier rejects a ``WITH … INSERT``
statement through its fail-closed unrecognized-statement arm, exactly as for
``cihost_01``; the PR parks on ``escalate-path-matched`` and is cleared with
``coord_submit_escalate_evidence``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "ciorch_01"
down_revision: str | Sequence[str] | None = "journey_01_edge_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Insert a github_actions tenant-band row plus v1 snapshot per tenant, atomically."""
    op.execute(
        """
        WITH ins AS (
            INSERT INTO coord.fleet_runtime_policy
                (tenant_id, domain, scope_band, scope_key, level,
                 master_enabled, current_version, updated_by, updated_at)
            SELECT t.tenant_id, 'ci_orchestrator', 'tenant', NULL, 'github_actions',
                   true, 1, 'alembic:ciorch_01', now()
            FROM coord.tenants t
            ON CONFLICT (tenant_id, domain, scope_band, COALESCE(scope_key, ''))
                DO NOTHING
            RETURNING id
        )
        INSERT INTO coord.fleet_runtime_policy_versions
            (policy_id, version, level, master_enabled,
             change_note, updated_by, created_at)
        SELECT ins.id, 1, 'github_actions', true,
               'Plan 2026-10-04-coord-managed-ci-for-every-tenant-with-an-actions-free-mode '
               'D1: existing tenant pinned to github_actions so the coord no-row '
               'default never flips it silently',
               'alembic:ciorch_01', now()
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
          AND p.domain = 'ci_orchestrator'
          AND p.scope_band = 'tenant'
          AND p.updated_by = 'alembic:ciorch_01'
          AND p.current_version = 1
        """
    )
    op.execute(
        """
        DELETE FROM coord.fleet_runtime_policy
        WHERE domain = 'ci_orchestrator'
          AND scope_band = 'tenant'
          AND updated_by = 'alembic:ciorch_01'
          AND current_version = 1
        """
    )
