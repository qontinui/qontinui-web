"""coord.work_unit_pr_citations — work-unit → realized-PR citation edge table

Revision ID: coord_workunits_04_work_unit_pr_citations
Revises: coord_workunits_03_work_unit_owner_actor
Create Date: 2026-06-18

Phase 1 (§7.3/§7.7) of plan
``D:/qontinui-root/plans/2026-06-18-coord-workunit-authz-graduated-trust.md``
("work-unit authz: evidence-based + graduated trust").

Stands up ``coord.work_unit_pr_citations`` — the work-unit analogue of
``coord.plan_pr_citations`` (see ``coord_plan_pr_citations``). It records the
provenance edge from a work-unit to the PR(s) / commit(s) that cite it, so the
generalized delivery verdict can derive ``shipped`` from the same
``citations ⋈ pr_state(merged) ⋈ deploy_includes_commit ⋈ healthy`` join for
work-units that it already computes for plans. Population is out of scope for
this migration (the harvester extension matching a ``Work-Unit:``/``Unit:``
citation line is coord work in a sibling PR); this revision only stands the
table up so those handler PRs target a live column set.

Schema (mirrors ``coord.plan_pr_citations``, substituting a HARD FK anchor):

* ``id            UUID PRIMARY KEY DEFAULT gen_random_uuid()`` — surrogate key.
* ``tenant_id     UUID`` — NULLABLE, no FK. Mirrors ``plan_pr_citations``'s
  tenant-scoping posture (recorded as a plain fact, not constrained).
* ``work_unit_id  UUID NOT NULL REFERENCES coord.work_units(id) ON DELETE
  CASCADE`` — the anchor. Unlike ``plan_pr_citations`` (which keeps a SOFT FK to
  ``plans.slug`` because a citation can arrive before plan-ingest mirrors the
  row), a work-unit row already exists in coord before it can be cited, so a
  HARD FK with cascade-delete is safe and keeps the edge clean.
* ``repo          TEXT NOT NULL`` — repository (``owner/name`` or short name).
* ``pr_number     INTEGER`` — NULLABLE: a citation may be commit-only.
* ``commit_sha    TEXT`` — NULLABLE: a citation may be PR-body-only.
* ``source        TEXT NOT NULL`` —
  ``'pr_body'`` | ``'commit_message'`` | ``'mcp_declare_intent'``.
* ``cited_at      TIMESTAMPTZ NOT NULL DEFAULT now()`` — record time.

Idempotent ingest key
=====================

* ``UNIQUE NULLS NOT DISTINCT (work_unit_id, repo, pr_number, commit_sha)`` —
  mirroring ``uq_plan_pr_citations_dedupe``. Ingest is idempotent via
  ``INSERT ... ON CONFLICT DO NOTHING`` bound to this key. ``NULLS NOT
  DISTINCT`` (PG15+) is REQUIRED so PR-body-only (``commit_sha IS NULL``) and
  commit-only (``pr_number IS NULL``) citations still dedupe under a plain
  UNIQUE. Implemented as a unique INDEX so ``ON CONFLICT`` can bind to it.

Indexes (mirror ``plan_pr_citations``):

* ``idx_work_unit_pr_citations_work_unit ON (work_unit_id)`` — the
  "PRs realizing this work-unit" lookup path.
* ``idx_work_unit_pr_citations_repo_pr ON (repo, pr_number)`` — the
  "work-units cited by this PR" lookup path.

Idempotency / authorship posture
================================

* DDL uses ``CREATE TABLE IF NOT EXISTS`` / ``CREATE [UNIQUE] INDEX IF NOT
  EXISTS`` raw ``op.execute`` — matching the ``coord.*`` migration house style.
  coord boots against this same schema, so re-running against an
  already-applied DB must be a no-op.
* **alembic is the SOLE author of the coord.* schema.** No Rust
  ``CREATE``/``ALTER`` self-heal — the coord crate only SELECTs / INSERTs.
* This web migration MUST be applied to prod RDS BEFORE the coord image
  deploys (downstream-of ordering), or coord crash-loops on the boot gate.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_workunits_04_work_unit_pr_citations"
down_revision: str | Sequence[str] | None = "coord_workunits_03_work_unit_owner_actor"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_unit_pr_citations (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID,
            work_unit_id  UUID NOT NULL
                REFERENCES coord.work_units(id) ON DELETE CASCADE,
            repo          TEXT NOT NULL,
            pr_number     INTEGER,
            commit_sha    TEXT,
            source        TEXT NOT NULL,
            cited_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Idempotent-ingest key. NULLS NOT DISTINCT (PG15+) so PR-body-only
    # (commit_sha IS NULL) and commit-only (pr_number IS NULL) citations still
    # dedupe under ON CONFLICT DO NOTHING. Implemented as a unique INDEX so
    # ON CONFLICT can bind to it.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_unit_pr_citations_dedupe "
        "ON coord.work_unit_pr_citations "
        "(work_unit_id, repo, pr_number, commit_sha) NULLS NOT DISTINCT"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_work_unit_pr_citations_work_unit "
        "ON coord.work_unit_pr_citations (work_unit_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_work_unit_pr_citations_repo_pr "
        "ON coord.work_unit_pr_citations (repo, pr_number)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_work_unit_pr_citations_repo_pr")
    op.execute("DROP INDEX IF EXISTS coord.idx_work_unit_pr_citations_work_unit")
    op.execute("DROP INDEX IF EXISTS coord.uq_work_unit_pr_citations_dedupe")
    op.execute("DROP TABLE IF EXISTS coord.work_unit_pr_citations")
