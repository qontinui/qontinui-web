"""Mark the bootstrap "system" tenant with a durable, slug-independent flag.

Phase 3 step 1 of plan ``2026-08-06-identity-cleanup-users-tenants-devices``.

WHY THIS EXISTS
---------------
Coord resolves its fleet-wide "system" tenant **by slug string**::

    // crates/coord/src/tenant_scope.rs
    pub const SYSTEM_TENANT_SLUG: &str = "personal-jspinak";

Twelve production modules bind that constant into
``SELECT tenant_id FROM coord.tenants WHERE slug = $1`` — the policy tables,
the gate machinery, ``ci_runner_registrar``, ``deploy_effects``,
``fleet_health``, ``restack_autoresolve``, ``route_serving_observer``,
``work_unit_pr_citations`` and the priority-set / next-step settings routes.

That makes the operator's **personal** tenant slug load-bearing infrastructure,
which has two consequences the identity-cleanup plan ran into head-on:

1. Renaming the tenant (``personal-jspinak`` → ``qontinui``) silently breaks
   all twelve. Every one of those lookups is a ``query_opt`` whose ``None``
   arm logs at ``debug!`` and returns ``Ok(())`` — so the failure mode is not
   an error, it is twelve subsystems quietly becoming no-ops.
2. ``tenant_scope.rs``'s own doc comment already flagged it: "When a second
   tenant exists, this slug-based default becomes load-bearing for a decision
   rather than a convenience." A second tenant (``pizzeria``) exists.

The remediation that comment prescribes is to stop keying on a
tenant-specific slug at all. This migration is the schema half of that: a
durable marker coord can resolve instead. Once coord reads the marker, the
slug becomes an ordinary label and the rename is genuinely the one-row
``UPDATE`` the plan originally assumed it already was.

ORDERING
--------
This migration MUST land and deploy **before** the coord change that reads
``is_system`` — a coord read of a new ``coord.*`` column needs its
qontinui-web migration in prod first. alembic is the sole author of
``coord.*`` schema.

The marker is set from the CURRENT bootstrap slug, so this migration is
correct whether or not the rename has happened yet: on a fresh DB the
``coord_tenant_scope_columns`` migration mints ``personal-jspinak`` earlier in
the chain, and on prod that row already exists.

Revision ID: coord_system_tenant_marker
Revises: coordnotif_01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_system_tenant_marker"
down_revision: str | Sequence[str] | None = "coordnotif_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The slug the bootstrap tenant is minted under earlier in the chain
# (``coord_tenant_scope_columns``). Referenced here ONLY to locate the row
# once; after this migration nothing needs to know it.
_BOOTSTRAP_SLUG = "personal-jspinak"


def upgrade() -> None:
    """Add ``coord.tenants.is_system`` and set it on the bootstrap tenant."""
    op.execute(
        """
        ALTER TABLE coord.tenants
            ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false
        """
    )

    # At most one tenant may be the system tenant. A partial unique index
    # makes that an invariant the database enforces rather than a convention
    # coord has to trust: without it, a second `is_system` row would make
    # `WHERE is_system` non-deterministic and reintroduce exactly the silent
    # ambiguity this migration exists to remove.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_is_system
            ON coord.tenants (is_system) WHERE is_system
        """
    )

    # Point the marker at the existing bootstrap row. Idempotent, and a no-op
    # on a DB where the row is absent (nothing to mark yet) or where a system
    # tenant has already been designated (the partial unique index would
    # reject a second one anyway, so guard rather than collide).
    op.execute(
        f"""
        UPDATE coord.tenants
           SET is_system = true
         WHERE slug = '{_BOOTSTRAP_SLUG}'
           AND NOT EXISTS (SELECT 1 FROM coord.tenants WHERE is_system)
        """
    )


def downgrade() -> None:
    """Drop the marker. Coord falls back to the slug constant."""
    op.execute("DROP INDEX IF EXISTS coord.uq_tenants_is_system")
    op.execute("ALTER TABLE coord.tenants DROP COLUMN IF EXISTS is_system")
