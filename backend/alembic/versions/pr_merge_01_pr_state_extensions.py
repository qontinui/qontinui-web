"""pr_merge phase 1 — PR-state ingest extensions

Revision ID: pr_merge_01_pr_state_extensions
Revises: coord_tenant_id_not_null
Create Date: 2026-05-21

Phase 1 of the PR Merge Orchestrator
(``D:/qontinui-root/plans/2026-05-21-pr-merge-orchestrator-design.md``)
D1.1 — extends the existing PR-state substrate so coord can know every
open PR's lifecycle state (mergeable, merge_state_status, review
decision, required-checks satisfaction) in near-realtime.

Substrate that already exists and is reused as-is (do not recreate per
the plan §2.1 audit):

* ``coord.repo_branches`` — PR-level fact row, ``(repo, branch)`` PK,
  carries ``pr_number``, ``pr_state``, ``head_sha``, ``base_branch``,
  ``touched_files``, ``correlation_id``. Added in
  ``coord_phase_1_01_agent_worktrees`` + sibling revs.
* ``coord.pr_check_runs`` — per-check telemetry keyed
  ``(repo, check_id)``. Added in
  ``coordinator_phase_6_agent_coordination_hardening``.
* ``coord.ci_baselines`` — per-(repo, workflow) failure-pattern
  fingerprint. Same Phase 6 migration.
* ``coord.alerts`` — fleet-wide alert sink with severity / kind /
  page_due_at columns. Added in ``row_9_phase_4_01_coord_alerts``.

What this revision adds:

1. **PR-lifecycle columns on ``coord.repo_branches``** (all nullable —
   legacy rows from before the GitHub App lands have NULL):

   * ``merge_state_status TEXT`` — GitHub's ``mergeStateStatus``
     enum (``clean | dirty | unstable | blocked | behind |
     unknown | draft``).
   * ``review_decision TEXT`` — GitHub's ``reviewDecision``
     (``APPROVED | REVIEW_REQUIRED | CHANGES_REQUESTED``).
   * ``required_checks_satisfied BOOLEAN`` — derived from
     ``statusCheckRollup`` against branch-protection's required-
     contexts list.
   * ``mergeable BOOLEAN`` — GitHub's PR-level ``mergeable`` flag.
   * ``last_predicate_eval_at TIMESTAMPTZ`` — when the Tier 1
     ``is_simple_green_path/1`` predicate last evaluated this PR.
     Used by Phase 3+; Phase 1 wires the column but doesn't write
     it.

2. **``coord.pr_events``** — append-only event log for both outer
   (PR-level) and inner (proposal-level) state transitions.
   ``event_kind`` is free-form text so Phase 3+ can add states
   (``state_change``, ``predicate_eval``, ``ingest``, ``escalation``,
   ``merge_landed``, ``reconciler_drift``, ``review``) without
   migrations. ``tenant_id`` nullable because the PR's tenant is
   resolved via ``coord.tenant_repos`` (Phase 2) — Phase 1 PRs are
   tenant-unknown at ingest time.

3. **``coord.pr_files``** — per-PR file list. ``(repo, pr_number, path)``
   PK; populated by GraphQL hydration (D1.4) and webhook ingest where
   the payload carries it. Future predicate input — Phase 3's
   ``escalate_paths`` glob match runs over this.

4. **``coord.pr_labels``** — per-PR label set with provenance.
   ``source`` discriminates GitHub-set labels from coord-set
   (``coord:*`` namespace, Phase 2 trailers). Phase 1 only persists
   GitHub-source labels; the ``coord_trailer`` / ``coord_skill``
   provenances are placeholders for Phase 2's authoring-skill flow.

5. **``coord.alerts.tenant_id``** — nullable UUID FK to
   ``coord.tenants``. The Phase 1 reconciler watcher (D1.5) fires
   ``pr_reconciler_drift`` alerts that should be tenant-scoped once
   the per-tenant settings model (Phase 2) lands. Adding the column
   here keeps the migration footprint of Phase 2 small. ``coord.alerts``
   pre-dates the tenant-scope rollout and was not on the original
   ``coord_tenant_scope_columns`` table list, so we add it inline here
   with the same partial-index posture (``WHERE tenant_id IS NOT NULL``).
   Existing rows stay NULL; Phase 2 will backfill or leave them as
   pre-tenant historical rows.

Idempotency: every DDL is ``IF NOT EXISTS`` or ``ALTER TABLE … ADD
COLUMN IF NOT EXISTS``. Re-running against an already-applied DB is a
no-op. Matches the posture of ``coord_tenant_scope_columns``.

Partial-index discipline: every new ``tenant_id`` lookup is gated on
``WHERE tenant_id IS NOT NULL`` per the convention established in
``coord_tenant_scope_columns``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_merge_01_pr_state_extensions"
down_revision: str = "coord_tenant_id_not_null"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add PR-lifecycle columns + three append-only/cache tables + tenant_id on coord.alerts."""

    # -----------------------------------------------------------------
    # 1. PR-lifecycle columns on coord.repo_branches.
    #    All nullable — legacy rows from before the GitHub App lands
    #    have NULL. ADD COLUMN IF NOT EXISTS keeps the migration
    #    idempotent across re-runs and concurrent ensure_* self-heal
    #    paths (coord's boot helpers may add a subset of these inline
    #    in a future PR).
    # -----------------------------------------------------------------
    op.execute(
        "ALTER TABLE coord.repo_branches "
        "ADD COLUMN IF NOT EXISTS merge_state_status TEXT"
    )
    op.execute(
        "ALTER TABLE coord.repo_branches "
        "ADD COLUMN IF NOT EXISTS review_decision TEXT"
    )
    op.execute(
        "ALTER TABLE coord.repo_branches "
        "ADD COLUMN IF NOT EXISTS required_checks_satisfied BOOLEAN"
    )
    op.execute(
        "ALTER TABLE coord.repo_branches "
        "ADD COLUMN IF NOT EXISTS mergeable BOOLEAN"
    )
    op.execute(
        "ALTER TABLE coord.repo_branches "
        "ADD COLUMN IF NOT EXISTS last_predicate_eval_at TIMESTAMPTZ"
    )

    # -----------------------------------------------------------------
    # 2. coord.pr_events — append-only event log.
    #    Single source of truth for both outer (PR-level) and inner
    #    (proposal-level) state transitions per §3.2 of the plan.
    #    Index on (repo, pr_number, created_at DESC) so the
    #    "current state" lookup (the latest event for a PR) is a
    #    one-row scan.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.pr_events (
            event_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            repo        TEXT        NOT NULL,
            pr_number   INTEGER     NOT NULL,
            event_kind  TEXT        NOT NULL,
            state       TEXT,
            payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
            tenant_id   UUID        REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pr_events_repo_pr_created
            ON coord.pr_events (repo, pr_number, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pr_events_tenant_id
            ON coord.pr_events (tenant_id)
            WHERE tenant_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pr_events_event_kind
            ON coord.pr_events (event_kind, created_at DESC)
        """
    )

    # -----------------------------------------------------------------
    # 3. coord.pr_files — per-PR file list.
    #    ``(repo, pr_number, path)`` composite PK. Populated by the
    #    bulk hydration job (D1.4) + PR-event ingest. Phase 3+
    #    predicate uses this for ``escalate_paths`` glob match.
    #
    #    ``status`` is GitHub's per-file diff status — the lifecycle
    #    is "added | modified | removed | renamed | copied | changed
    #    | unchanged" per the docs; TEXT keeps the schema permissive.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.pr_files (
            repo        TEXT        NOT NULL,
            pr_number   INTEGER     NOT NULL,
            path        TEXT        NOT NULL,
            additions   INTEGER     NOT NULL DEFAULT 0,
            deletions   INTEGER     NOT NULL DEFAULT 0,
            status      TEXT,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (repo, pr_number, path)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pr_files_repo_pr
            ON coord.pr_files (repo, pr_number)
        """
    )

    # -----------------------------------------------------------------
    # 4. coord.pr_labels — per-PR label set with provenance.
    #    ``source`` discriminates GitHub-set labels from coord-set
    #    (``coord:*`` namespace, Phase 2 trailers).
    #    ``tenant_id`` nullable + partial-indexed — matches the
    #    posture established by ``coord_tenant_scope_columns``.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.pr_labels (
            repo        TEXT        NOT NULL,
            pr_number   INTEGER     NOT NULL,
            label       TEXT        NOT NULL,
            source      TEXT        NOT NULL,
            added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            tenant_id   UUID        REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL,
            PRIMARY KEY (repo, pr_number, label)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pr_labels_repo_pr
            ON coord.pr_labels (repo, pr_number)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pr_labels_tenant_id
            ON coord.pr_labels (tenant_id)
            WHERE tenant_id IS NOT NULL
        """
    )

    # -----------------------------------------------------------------
    # 5. coord.alerts.tenant_id — nullable FK to coord.tenants.
    #    coord.alerts pre-dates the tenant-scope rollout
    #    (row_9_phase_4_01_coord_alerts) and was not on the original
    #    coord_tenant_scope_columns table list. Adding the column
    #    inline so the Phase 1 reconciler watcher (D1.5) can stamp
    #    ``pr_reconciler_drift`` alerts with the PR's resolved tenant.
    #    Same partial-index posture as the other six tables.
    # -----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.alerts
            ADD COLUMN IF NOT EXISTS tenant_id UUID
                REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_alerts_tenant_id
            ON coord.alerts (tenant_id)
            WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop columns + tables in reverse order.

    Append-only event log (``coord.pr_events``) is dropped wholesale — by
    construction it carries no data the upstream PRs depend on; the
    GitHub webhook stream is the source of truth and a fresh ingest will
    rehydrate.

    Bulk hydration cache (``coord.pr_files``, ``coord.pr_labels``) is
    likewise dropped — recoverable via the Phase 1 hydration job.
    """
    op.execute("DROP INDEX IF EXISTS coord.idx_alerts_tenant_id")
    op.execute("ALTER TABLE coord.alerts DROP COLUMN IF EXISTS tenant_id")

    op.execute("DROP INDEX IF EXISTS coord.idx_pr_labels_tenant_id")
    op.execute("DROP INDEX IF EXISTS coord.idx_pr_labels_repo_pr")
    op.execute("DROP TABLE IF EXISTS coord.pr_labels")

    op.execute("DROP INDEX IF EXISTS coord.idx_pr_files_repo_pr")
    op.execute("DROP TABLE IF EXISTS coord.pr_files")

    op.execute("DROP INDEX IF EXISTS coord.idx_pr_events_event_kind")
    op.execute("DROP INDEX IF EXISTS coord.idx_pr_events_tenant_id")
    op.execute("DROP INDEX IF EXISTS coord.idx_pr_events_repo_pr_created")
    op.execute("DROP TABLE IF EXISTS coord.pr_events")

    op.execute(
        "ALTER TABLE coord.repo_branches DROP COLUMN IF EXISTS last_predicate_eval_at"
    )
    op.execute(
        "ALTER TABLE coord.repo_branches DROP COLUMN IF EXISTS mergeable"
    )
    op.execute(
        "ALTER TABLE coord.repo_branches DROP COLUMN IF EXISTS required_checks_satisfied"
    )
    op.execute(
        "ALTER TABLE coord.repo_branches DROP COLUMN IF EXISTS review_decision"
    )
    op.execute(
        "ALTER TABLE coord.repo_branches DROP COLUMN IF EXISTS merge_state_status"
    )
