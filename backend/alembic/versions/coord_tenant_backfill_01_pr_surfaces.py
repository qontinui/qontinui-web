"""coord tenant backfill 01 — stamp NULL tenant_id on the PR/action surfaces

Revision ID: coord_tenant_backfill_01
Revises: coord_test_targets

Why
---
The coord console isolates by the operator's EFFECTIVE tenant (the dashboard
tenant switcher). Four read surfaces carried a NULLABLE ``tenant_id`` with an
``OR tenant_id IS NULL`` compatibility filter, so legacy rows written before
the column existed were visible to EVERY tenant — a cross-tenant leak on the
PR events / labels / plan-citation / dev-action feeds.

coord's read side is moving to STRICT ``tenant_id = $tenant`` filters
(qontinui-coord ``pr_merge/pr_events_read.rs``), which makes unstamped rows
visible to nobody. This data migration stamps every row that CAN be
attributed, so history survives the strictening:

* ``coord.pr_events``, ``coord.pr_labels``, ``coord.plan_pr_citations``,
  ``coord.commit_lineage`` — derived from the row's ``repo`` via
  ``coord.tenant_repos`` (the ``owner/name``-keyed repo→tenant ownership
  map). For a repo owned by multiple tenants the LOWEST tenant_id is picked
  deterministically — the same ordering the Rust write paths use
  (``repo_branches.rs``: ``... ORDER BY tenant_id LIMIT 1``).
  ``commit_lineage`` is included because its own migration's backfill
  derives from the writing device, which misses rows whose device was never
  registered in ``coord.devices`` — the repo-derived pass catches those.
  ``plan_pr_citations`` may carry a SHORT repo name (``name`` without the
  ``owner/`` prefix — its DDL allows both), so it gets a second bare-name
  pass.
* ``coord.dev_action_snapshots`` — derived from the acting device via
  ``coord.devices.tenant_id`` (NOT NULL since ``coord_tenant_id_not_null``).

Rows that cannot be attributed (repo owned by no tenant; device-less action
snapshots) stay NULL: invisible to every tenant under the strict filters,
which is the intended fail-closed posture. ``coord.alerts`` is deliberately
NOT touched — it has no repo column, and its NULL-tenant rows are the
staff-only infra alerts (deploy freshness / CI / budget watchers) whose
visibility is already gated by the D3 ``is_admin`` read rule.

Idempotent: every UPDATE targets ``tenant_id IS NULL`` only, so re-running
stamps nothing twice and never overwrites a Rust-written value.

Downgrade is a no-op: un-stamping would erase information (the derived
attribution) without restoring any prior behavior.
"""

from alembic import op

revision: str = "coord_tenant_backfill_01"
down_revision: str | None = "coord_conditions_01_condition_groups"
branch_labels = None
depends_on = None

# Deterministic first-owner pick per repo (lowest tenant_id), matching the
# Rust write paths' `ORDER BY tenant_id LIMIT 1` convention.
_OWNER_CTE = (
    "SELECT DISTINCT ON (repo) repo, tenant_id "
    "FROM coord.tenant_repos ORDER BY repo, tenant_id"
)

# Same pick keyed by the BARE repo name (`name` from `owner/name`), for
# tables whose rows may carry a short repo name (plan_pr_citations).
_BARE_OWNER_CTE = (
    "SELECT DISTINCT ON (split_part(repo, '/', 2)) "
    "split_part(repo, '/', 2) AS bare, tenant_id "
    "FROM coord.tenant_repos WHERE repo LIKE '%/%' "
    "ORDER BY split_part(repo, '/', 2), tenant_id"
)


def upgrade() -> None:
    for table in ("pr_events", "pr_labels", "plan_pr_citations", "commit_lineage"):
        op.execute(
            f"""
            UPDATE coord.{table} t
            SET tenant_id = owners.tenant_id
            FROM ({_OWNER_CTE}) AS owners
            WHERE t.tenant_id IS NULL
              AND t.repo = owners.repo
            """
        )

    # plan_pr_citations allows short repo names ("name" without "owner/");
    # a second pass matches those against the bare form of tenant_repos.
    op.execute(
        f"""
        UPDATE coord.plan_pr_citations t
        SET tenant_id = owners.tenant_id
        FROM ({_BARE_OWNER_CTE}) AS owners
        WHERE t.tenant_id IS NULL
          AND t.repo = owners.bare
        """
    )

    op.execute(
        """
        UPDATE coord.dev_action_snapshots s
        SET tenant_id = d.tenant_id
        FROM coord.devices d
        WHERE s.tenant_id IS NULL
          AND s.device_id = d.device_id
          AND d.tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    # Data-only stamp; reversing would destroy the derived attribution
    # without restoring any previous behavior. Intentionally a no-op.
    pass
