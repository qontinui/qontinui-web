"""agent.work_artifacts: give the plan corpus a tenant axis (non-identity).

Phase 1 of plan
``qontinui-dev-notes/plans/2026-09-22-the-plan-corpus-has-no-tenant-axis-so-a-multi-bound-device-cannot-scope-its-plans.md``.
Additive. Identity is NOT touched.

What this adds
==========================================================================

* ``agent.work_artifacts.tenant_id UUID NULL`` — which COORD TENANT this
  artifact belongs to.
* ``agent.work_artifacts.tenant_source TEXT NOT NULL DEFAULT 'unknown'`` —
  HOW that tenant was established.
* ``ck_work_artifacts_tenant_source`` over the same five values as
  ``ck_session_artifacts_tenant_source``: ``declared``, ``derived_repo``,
  ``derived_sole_binding``, ``ambiguous``, ``unknown``.
* ``ix_work_artifacts_tenant_id``.

Why a tenant column at all
==========================================================================

``agent.work_artifacts`` carried no tenant axis, and every plan-library route
derives its scope from the CALLER'S PERSONAL ORGANIZATION
(``plan_library._resolve_org_id`` -> ``resolve_personal_organization``). A
device bound to N coord tenants and operated by one person therefore resolves
to ONE organization and ONE corpus. Two tenants sharing a plan stem under the
same ``source_repo`` collide on ``uq_work_artifacts_identity`` and the upsert
OVERWRITES one with the other — silent cross-tenant data destruction recorded
as an ordinary version bump, not a visibility bug.

The tenant is already carried, already verified and already read once
(``devices.py`` reads ``tenant_id`` off the verified device JWT for
``GET /devices/me``); it was simply discarded at the dual-auth door. Nothing
is invented here.

Why the backfill is ``unknown`` and not a guess
==========================================================================

``device_tenant_bindings`` lives in COORD and does not exist in this database
(grep across ``app/`` and ``alembic/``: zero hits), so a web-side migration
cannot join to bindings to derive a tenant for an existing row. A guessed
tenant that renders identically to a declared one is the exact defect
``tenant_source`` exists to prevent. Every existing row is therefore
``tenant_id = NULL`` / ``tenant_source = 'unknown'`` — the vocabulary's word
for "no attribution attempted or available" — and the runner's scanner
re-stamps rows on its next push, so the population heals forward.

That is also why the ``server_default`` is kept rather than dropped after the
backfill: rows arrive from writers this migration cannot see, and a row that
states no source is worse than one that states ``unknown``.

Why identity is NOT re-keyed here
==========================================================================

Adding the tenant to ``uq_work_artifacts_identity`` can only ever SEPARATE
rows that are currently fused (adding a term to a unique key refines it), so
it is safe in principle — but it is gated on a MEASUREMENT (the cross-tenant
arm of ``GET /plan-library/divergent``, Phase 3) rather than run blind, and it
must move ``crud.get_by_identity`` / ``crud.list_by_scan_identity`` in the
same commit. Re-keying the index alone would turn today's silent overwrite
into an ``IntegrityError`` 500: the lookup hands back another tenant's row,
the upsert writes to it, and the new unique index refuses the result.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "plan_library_tenant_axis_01"
down_revision: str | Sequence[str] | None = "devconn_inst_01_device_connections_instance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


#: Value for value with ``ck_session_artifacts_tenant_source``. A second
#: vocabulary would be drift, not design.
_TENANT_SOURCE_VALUES = (
    "'declared', 'derived_repo', 'derived_sole_binding', 'ambiguous', 'unknown'"
)


def upgrade() -> None:
    # Hand-authored and idempotent in both directions: a migration that dies
    # part way through must be re-runnable, and ``--autogenerate`` is never
    # the author of ``coord.*``/``agent.*`` DDL here (served policy
    # ``production-and-cost`` ``alembic-sole-authorship``).
    op.execute(
        "ALTER TABLE agent.work_artifacts ADD COLUMN IF NOT EXISTS tenant_id UUID NULL"
    )
    # NOT NULL in ONE statement: the DEFAULT backfills every existing row to
    # 'unknown' as the column is added, so there is no separate UPDATE pass
    # and no window in which a row states nothing.
    op.execute(
        "ALTER TABLE agent.work_artifacts "
        "ADD COLUMN IF NOT EXISTS tenant_source TEXT NOT NULL DEFAULT 'unknown'"
    )
    op.execute(
        "ALTER TABLE agent.work_artifacts "
        "DROP CONSTRAINT IF EXISTS ck_work_artifacts_tenant_source"
    )
    op.execute(
        "ALTER TABLE agent.work_artifacts "
        "ADD CONSTRAINT ck_work_artifacts_tenant_source "
        f"CHECK (tenant_source IN ({_TENANT_SOURCE_VALUES}))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_work_artifacts_tenant_id "
        "ON agent.work_artifacts (tenant_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifacts_tenant_id")
    op.execute(
        "ALTER TABLE agent.work_artifacts "
        "DROP CONSTRAINT IF EXISTS ck_work_artifacts_tenant_source"
    )
    op.execute("ALTER TABLE agent.work_artifacts DROP COLUMN IF EXISTS tenant_source")
    op.execute("ALTER TABLE agent.work_artifacts DROP COLUMN IF EXISTS tenant_id")
