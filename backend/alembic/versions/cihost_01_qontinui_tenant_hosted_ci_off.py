"""Seed the qontinui tenant's ``github_hosted_ci`` fleet-policy dial OFF

Revision ID: cihost_01
Revises: mdroles_01
Create Date: 2026-10-04

Phase 1 (design decision D2) of plan
``qontinui-dev-notes/plans/2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting.md``.

What this is
============

A DATA revision. It authors **no schema**: no CREATE, no ALTER, no DROP. The
new fleet-policy domain ``github_hosted_ci`` needs no DDL because
``coord.fleet_runtime_policy.domain`` and ``.level`` are plain TEXT with no
CHECK (``fleet_policy_01``) — declaring a domain is a code-only change on the
coord side. What a domain cannot get from code is a tenant's *choice*, and the
operator directive of 2026-10-04 (coord memory ``ed245b84`` —
``coord_memory_search`` 2026-10-04 returned memory ``ed245b84``) states
Qontinui's own: GitHub-hosted Actions CI is OFF permanently for the Qontinui
tenant.

So this writes exactly one tenant-band row (``coord_query_identity``
2026-10-04 returned slug ``qontinui`` for this tenant id),

```text
tenant_id      c231d9da-0ca8-4fe4-bd81-0e3d6c20339a   (slug ``qontinui``)
domain         github_hosted_ci
scope_band     tenant
scope_key      NULL
level          off
master_enabled true
current_version 1
updated_by     migration:cihost_01
```

plus its version-1 snapshot in ``coord.fleet_runtime_policy_versions``.

Why a migration and not a PUT
=============================

``PUT /coord/fleet-policy`` is SSO-operator-only (``OperatorContext``), and a
hand-run DML against production is ad-hoc mutation. Alembic is the sole author
of ``coord.*`` (``[policy: alembic-sole-authorship]``) and the deploy pipeline
is the reviewable, reversible path (``[policy:
pipeline-deploys-are-not-adhoc-mutation]``). It must land before any coord
consumer of the domain exists (the ordering arm of the same clause).

The write obligations this honours
==================================

* **Every row that claims a version has its snapshot.** The versions table's
  own ``COMMENT ON TABLE`` (``fleet_res_tel_02``) requires every write that
  creates a ``fleet_runtime_policy`` row to INSERT the matching snapshot in the
  SAME transaction, "including the first one, or current_version=1 describes
  history that does not exist". The parent INSERT and the snapshot INSERT are
  therefore ONE statement — a data-modifying CTE — so they commit together.
* **The snapshot is written only for a row this revision wrote.** The CTE's
  ``RETURNING id`` yields nothing when ``ON CONFLICT DO NOTHING`` skips the
  parent, so a pre-existing row (a choice the operator already made) gets
  neither its level overwritten nor a spurious second v1 snapshot.
* **Snapshot payload equals the parent payload.** The control columns added by
  ``fleet_res_tel_03`` / ``sess_guard_01`` are all nullable "no override"
  columns, NULL on the parent here, so they are NULL on the snapshot too (left
  to their NULL default on both). ``change_note`` and ``updated_by`` name the
  directive.
* **Scope uniqueness.** The conflict target is the functional unique index
  ``uq_fleet_runtime_policy_scope`` over
  ``(tenant_id, domain, scope_band, COALESCE(scope_key, ''))``
  (``fleet_policy_01``), spelled with the same expression so Postgres infers
  it.
* **Only this tenant.** Guarded by ``WHERE EXISTS`` on ``coord.tenants``, so a
  database without the qontinui tenant (CI, a developer DB, another
  deployment) is a no-op. No other tenant is touched; a tenant with no row
  resolves to the domain default ``on`` (D10), which is coord-side code.

Downgrade
=========

Deletes exactly what the upgrade wrote, and only while it is still in the state
the upgrade left it: the qontinui tenant-band ``github_hosted_ci`` row whose
``updated_by`` is ``migration:cihost_01`` AND whose ``current_version`` is
still 1. Once an operator has edited the dial (version 2+, ``updated_by`` an
operator), the row is theirs and the downgrade leaves it.

The versions table is append-only ("never UPDATE or DELETE a row here"), and
this downgrade deletes from it anyway. That rule governs history of a row that
continues to exist; here the parent row itself is being removed, and its
history goes with it — the versions FK is ``ON DELETE CASCADE``
(``fleet_res_tel_02``), so the parent DELETE would remove the snapshot
regardless. The snapshot DELETE is written out first so the downgrade states
what it removes rather than depending on the cascade.

Merge-train note: coord's migration classifier (``migration_classifier.rs``)
rejects this revision through its fail-closed unrecognized-statement arm — the
upgrade is a single statement beginning ``WITH … INSERT``; ``downgrade()`` is
not classified. So the PR parks on ``escalate-path-matched`` and is cleared by
``coord_submit_escalate_evidence`` (plan Phase 1).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "cihost_01"
down_revision: str | Sequence[str] | None = "mdroles_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Insert the qontinui tenant-band row OFF plus its v1 snapshot, atomically."""
    op.execute(
        """
        WITH ins AS (
            INSERT INTO coord.fleet_runtime_policy
                (tenant_id, domain, scope_band, scope_key, level,
                 master_enabled, current_version, updated_by, updated_at)
            SELECT 'c231d9da-0ca8-4fe4-bd81-0e3d6c20339a'::uuid,
                   'github_hosted_ci', 'tenant', NULL, 'off',
                   true, 1, 'migration:cihost_01', now()
            WHERE EXISTS (
                SELECT 1 FROM coord.tenants
                WHERE tenant_id = 'c231d9da-0ca8-4fe4-bd81-0e3d6c20339a'::uuid
            )
            ON CONFLICT (tenant_id, domain, scope_band, COALESCE(scope_key, ''))
                DO NOTHING
            RETURNING id
        )
        INSERT INTO coord.fleet_runtime_policy_versions
            (policy_id, version, level, master_enabled,
             change_note, updated_by, created_at)
        SELECT ins.id, 1, 'off', true,
               'Operator directive 2026-10-04 (coord memory ed245b84): '
               'GitHub-hosted CI is OFF permanently for the Qontinui tenant',
               'migration:cihost_01', now()
        FROM ins
        """
    )


def downgrade() -> None:
    """Delete only the row this revision wrote, while it is still at version 1."""
    op.execute(
        """
        DELETE FROM coord.fleet_runtime_policy_versions v
        USING coord.fleet_runtime_policy p
        WHERE v.policy_id = p.id
          AND p.tenant_id = 'c231d9da-0ca8-4fe4-bd81-0e3d6c20339a'::uuid
          AND p.domain = 'github_hosted_ci'
          AND p.scope_band = 'tenant'
          AND p.updated_by = 'migration:cihost_01'
          AND p.current_version = 1
        """
    )
    op.execute(
        """
        DELETE FROM coord.fleet_runtime_policy
        WHERE tenant_id = 'c231d9da-0ca8-4fe4-bd81-0e3d6c20339a'::uuid
          AND domain = 'github_hosted_ci'
          AND scope_band = 'tenant'
          AND updated_by = 'migration:cihost_01'
          AND current_version = 1
        """
    )
