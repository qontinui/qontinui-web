"""coord alerts backfill — stamp tenant_id on gate/unit continuation alerts

Revision ID: coord_alerts_subject_tenant_backfill_01
Revises: tagpurge_01_phantom_tag_branch_rows

Why
---
``COORD_ALERTS_TENANT_STRICT`` (armed, live) scopes ``GET /coord/alerts`` so a
tenant sees an alert only if it belongs to one of the tenant's devices, carries
a matching ``tenant_id``, or is a repo-scoped infra alert whose repo the tenant
owns. The device-membership arm is qualified
``tenant_member AND (a.tenant_id IS NULL OR a.tenant_id = $1)`` — so a
NULL-tenant device-keyed alert still surfaces to EVERY tenant the alert's device
is bound to.

``gate_continuation_pending`` alerts are device-keyed but carry no
``detail.repo``, so they went unstamped and leaked: the operator's machine is
bound to both ``personal-jspinak`` and the ``pizzeria`` customer tenant, so ~296
alerts naming one tenant's PRs / gates (``claim:pr:qontinui/qontinui-coord#987``,
internal ``qontinui-*-wt-*`` worktrees) rendered inside the customer console.

The producer (``qontinui-coord`` ``gates::insert_continuation_alert``) now stamps
NEW alerts from their subject — ``detail.gate_id`` → ``coord.gates.tenant_id``,
``detail.unit_id`` → ``coord.work_units.tenant_id`` — but existing rows do NOT
re-fire (a gate fires its continuation alert once, then it lingers), so they stay
unstamped and keep leaking. This one-time data migration stamps the existing
rows with the SAME FK-safe derivation the producer uses.

FK-safety
---------
``coord.alerts.tenant_id`` has an FK to ``coord.tenants``, but
``coord.gates.tenant_id`` / ``coord.work_units.tenant_id`` do NOT. Each arm JOINs
``coord.tenants`` so a subject carrying a tenant absent from ``coord.tenants`` (a
deleted tenant / gate) resolves to NULL rather than violating the FK. Both
``id`` keys are UUID-validated before the ``::uuid`` cast.

Rows that cannot be attributed (the gate/unit row was deleted) stay NULL —
device-health fallback, still visible to bound tenants, which is the intended
fail-open posture for an alert whose subject no longer exists.

Idempotent: targets ``tenant_id IS NULL`` only, so re-running stamps nothing
twice and never overwrites a producer-written value.

Downgrade is a no-op: un-stamping would erase the derived attribution without
restoring any prior behavior.
"""

from alembic import op

revision: str = "coord_alerts_subject_tenant_backfill_01"
down_revision: str | None = "tagpurge_01_phantom_tag_branch_rows"
branch_labels = None
depends_on = None

_UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


def upgrade() -> None:
    # Gate-subject alerts: detail.gate_id -> coord.gates.tenant_id, JOINed to
    # coord.tenants so an absent tenant resolves to NULL (FK-safe).
    op.execute(
        f"""
        UPDATE coord.alerts a
        SET tenant_id = g.tenant_id
        FROM coord.gates g
        JOIN coord.tenants t ON t.tenant_id = g.tenant_id
        WHERE a.tenant_id IS NULL
          AND a.kind = 'gate_continuation_pending'
          AND (a.detail->>'gate_id') ~* '{_UUID_RE}'
          AND g.gate_id = (a.detail->>'gate_id')::uuid
        """
    )

    # Unit-subject alerts: detail.unit_id -> coord.work_units.tenant_id
    # (work_units keys on `id`), likewise JOINed to coord.tenants.
    op.execute(
        f"""
        UPDATE coord.alerts a
        SET tenant_id = w.tenant_id
        FROM coord.work_units w
        JOIN coord.tenants t ON t.tenant_id = w.tenant_id
        WHERE a.tenant_id IS NULL
          AND a.kind = 'gate_continuation_pending'
          AND (a.detail->>'unit_id') ~* '{_UUID_RE}'
          AND w.id = (a.detail->>'unit_id')::uuid
        """
    )


def downgrade() -> None:
    # Data-only stamp; reversing would destroy the derived attribution without
    # restoring any previous behavior. Intentionally a no-op.
    pass
