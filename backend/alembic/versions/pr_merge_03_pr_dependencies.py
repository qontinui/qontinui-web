"""pr_merge phase 5 — cross-repo PR dependency graph

Revision ID: pr_merge_03_pr_dependencies
Revises: pr_merge_02_tenant_settings
Create Date: 2026-05-21

Phase 5 of the PR Merge Orchestrator
(``D:/qontinui-root/plans/2026-05-21-pr-merge-orchestrator-design.md``)
D5.1 — adds ``coord.pr_dependencies`` so coord can reason about
cross-repo cascades (schemas -> runner -> coord) and same-repo PR
stacks declared via the ``coord:upstream-of=<repo>#<n>``,
``coord:downstream-of=<repo>#<n>``, and ``coord:stacked-on=#<n>``
labels (Phase 2 D2.5 / D2.6 / D2.7).

Edges are derived from ``coord.pr_labels`` by the
``sync_edges_from_labels`` helper in
``qontinui-coord/src/pr_merge/dep_graph.rs`` and rebuilt idempotently
on every ``pull_request.labeled/unlabeled/edited`` webhook ingest.
The unique constraint on
``(from_repo, from_pr, to_repo, to_pr, edge_kind)`` is what makes
the rebuild idempotent — re-running sync_edges for the same PR with
the same label set produces no churn.

Indexes are oriented for the two query directions that matter for
graph traversal: "what does X point to?" and "what points to X?".
``tenant_id`` is partial-indexed per the existing
``coord_tenant_scope_columns`` posture so tenant-scoped graph queries
hit the index even before any backfill.

Idempotency: every DDL is ``CREATE TABLE / INDEX IF NOT EXISTS`` so a
re-run against an already-applied DB is a no-op. Matches the posture
established by ``pr_merge_01_pr_state_extensions`` and
``pr_merge_02_tenant_settings``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_merge_03_pr_dependencies"
down_revision: str = "pr_merge_02_tenant_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.pr_dependencies`` + supporting indexes."""

    # -----------------------------------------------------------------
    # coord.pr_dependencies — directed-edge fact table.
    #
    # Schema:
    #   edge_id    PK, auto-generated UUID v4
    #   from_*     edge origin (`upstream_of` means from_* must merge
    #              before to_*)
    #   to_*       edge target
    #   edge_kind  'upstream_of'  -> cross-repo or same-repo `upstream-of`
    #              'stacked_on'   -> same-repo PR stack
    #   source     'label'        -> derived from coord:upstream-of /
    #                                coord:downstream-of /
    #                                coord:stacked-on
    #              'trailer'      -> derived from Coord-Upstream-Of:
    #                                trailer (Phase 2 D2.7)
    #              'auto_inferred'-> reserved for future signals (NOT
    #                                used in Phase 5; reserved for the
    #                                drift loop in Phase 8 which may
    #                                propose edges)
    #   tenant_id  resolved via coord.tenant_repos.tenant_id on the
    #              from-repo at edge-write time. NULL when the PR's
    #              repo has no tenant claim yet (graph queries scoped
    #              by tenant skip these).
    #
    # The unique constraint on (from_repo, from_pr, to_repo, to_pr,
    # edge_kind) is what makes the label-driven UPSERT in
    # `sync_edges_from_labels` idempotent — re-syncing the same label
    # set is a no-op, and removing a label can be detected by walking
    # the existing rows and deleting any not present in the current
    # label-derived edge set.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.pr_dependencies (
            edge_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            from_repo   TEXT        NOT NULL,
            from_pr     INTEGER     NOT NULL,
            to_repo     TEXT        NOT NULL,
            to_pr       INTEGER     NOT NULL,
            edge_kind   TEXT        NOT NULL,
            source      TEXT        NOT NULL,
            tenant_id   UUID        REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT pr_dependencies_edge_kind_check
                CHECK (edge_kind IN ('upstream_of', 'stacked_on')),
            CONSTRAINT pr_dependencies_source_check
                CHECK (source IN ('label', 'trailer', 'auto_inferred')),
            CONSTRAINT pr_dependencies_no_self_loop
                CHECK (NOT (from_repo = to_repo AND from_pr = to_pr)),
            CONSTRAINT pr_dependencies_unique_edge
                UNIQUE (from_repo, from_pr, to_repo, to_pr, edge_kind)
        )
        """
    )

    # Forward-traversal index — "what does (from_repo, from_pr) depend on?"
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pr_dependencies_from
            ON coord.pr_dependencies (from_repo, from_pr)
        """
    )
    # Reverse-traversal index — "what depends on (to_repo, to_pr)?"
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pr_dependencies_to
            ON coord.pr_dependencies (to_repo, to_pr)
        """
    )
    # Tenant-scoped queries hit this partial index; matches
    # coord_tenant_scope_columns posture (no full-table backfill needed).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pr_dependencies_tenant
            ON coord.pr_dependencies (tenant_id)
            WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop ``coord.pr_dependencies`` + indexes.

    Reverse order of upgrade; DROP IF EXISTS so re-runs are no-ops.
    No data backfill / preservation — Phase 5 is greenfield.
    """
    op.execute("DROP INDEX IF EXISTS coord.idx_pr_dependencies_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_pr_dependencies_to")
    op.execute("DROP INDEX IF EXISTS coord.idx_pr_dependencies_from")
    op.execute("DROP TABLE IF EXISTS coord.pr_dependencies")
