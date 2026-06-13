"""coord.plan_pr_citations — plan → realized-PR citation/provenance edge table

Revision ID: coord_plan_pr_citations
Revises: autoresp01autoresprules
Create Date: 2026-06-13

Implements Phase 1 (the alembic slice) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-06-13-coord-plan-pr-citation-index.md``
(plan→PR citation index: "which PRs/commits realized this plan?").

Stands up one new additive fact table ``coord.plan_pr_citations`` recording the
provenance edge from a plan (by slug) to the PR(s) / commit(s) that cite it.
Population is out of scope for this migration (the PR-body / commit-message
scanners and the ``mcp_declare_intent`` ingest path are coord/runner work in
sibling PRs); this revision only stands the table up so those handler PRs target
a live column set.

Schema (per plan §Schema):

* ``id          UUID PRIMARY KEY DEFAULT gen_random_uuid()`` — surrogate key.
* ``tenant_id   UUID`` — NULLABLE, no FK. Mirrors ``coord.commit_lineage``'s
  tenant-scoping posture (tenant is recorded as a plain fact, not constrained).
* ``plan_slug   TEXT NOT NULL`` — normalized plan slug. **SOFT FK** to
  ``coord.plans.slug`` — there is deliberately NO hard FK constraint: a citation
  can legitimately arrive (e.g. a PR body cites a plan) BEFORE plan-ingest has
  mirrored that plan row. A hard FK would drop real, durable citations on that
  timing race, so the edge is kept and reconciled out-of-band instead.
* ``repo        TEXT NOT NULL`` — repository (``owner/name`` or short name).
* ``pr_number   INTEGER`` — NULLABLE: a citation may be commit-only.
* ``commit_sha  TEXT`` — NULLABLE: a citation may be PR-body-only.
* ``source      TEXT NOT NULL`` —
  ``'pr_body'`` | ``'commit_message'`` | ``'mcp_declare_intent'``.
* ``cited_at    TIMESTAMPTZ NOT NULL DEFAULT now()`` — record time.

Idempotent ingest key
=====================

* ``UNIQUE NULLS NOT DISTINCT (plan_slug, repo, pr_number, commit_sha)``.
  Ingest is idempotent via ``INSERT ... ON CONFLICT DO NOTHING`` bound to this
  key. The ``NULLS NOT DISTINCT`` clause (Postgres 15+) is REQUIRED: by default
  Postgres treats ``NULL`` values in a unique key as distinct, so two rows that
  differ only by a ``NULL`` ``pr_number`` (PR-body-only citation) or ``NULL``
  ``commit_sha`` (commit-only citation) would NOT dedupe under a plain UNIQUE
  and the same citation would be inserted repeatedly. ``NULLS NOT DISTINCT``
  makes those NULL parts compare equal so re-ingest is a true no-op. coord prod
  is on PG15+ (the repo relies on ``gen_random_uuid()`` and other PG14+
  features). Implemented as a unique INDEX so ``ON CONFLICT`` can bind to it.

Indexes (per plan §Schema):

* ``idx_plan_pr_citations_plan_slug ON (plan_slug)`` — the
  "PRs realizing this plan" lookup path.
* ``idx_plan_pr_citations_repo_pr ON (repo, pr_number)`` — the
  "plans cited by this PR" lookup path.

Idempotency / authorship posture
================================

* DDL uses ``CREATE TABLE IF NOT EXISTS`` / ``CREATE [UNIQUE] INDEX IF NOT
  EXISTS`` raw ``op.execute`` — matching the ``coord.*`` migration house style
  (see ``coord_commit_lineage`` / ``coord_singleauthored_01_gates``). coord
  boots against this same schema, so re-running against an already-applied DB
  must be a no-op.
* **alembic is the SOLE author of the coord.* schema.** No Rust
  ``CREATE``/``ALTER`` self-heal — the coord crate only SELECTs / INSERTs into
  this table.

Stacked behind two in-flight migrations: ``down_revision`` is the coord-assigned
slot predecessor ``autoresp01autoresprules`` (position 3). The CI alembic gate
auto-rebinds this if the predecessor chain shifts before merge.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_plan_pr_citations"
down_revision: str | Sequence[str] | None = "autoresp01autoresprules"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.plan_pr_citations (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID,
            plan_slug   TEXT NOT NULL,
            repo        TEXT NOT NULL,
            pr_number   INTEGER,
            commit_sha  TEXT,
            source      TEXT NOT NULL,
            cited_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Idempotent-ingest key. NULLS NOT DISTINCT (PG15+) so PR-body-only
    # (commit_sha IS NULL) and commit-only (pr_number IS NULL) citations still
    # dedupe under ON CONFLICT DO NOTHING. Implemented as a unique INDEX so
    # ON CONFLICT can bind to it.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_pr_citations_dedupe "
        "ON coord.plan_pr_citations "
        "(plan_slug, repo, pr_number, commit_sha) NULLS NOT DISTINCT"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_pr_citations_plan_slug "
        "ON coord.plan_pr_citations (plan_slug)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_pr_citations_repo_pr "
        "ON coord.plan_pr_citations (repo, pr_number)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_plan_pr_citations_repo_pr")
    op.execute("DROP INDEX IF EXISTS coord.idx_plan_pr_citations_plan_slug")
    op.execute("DROP INDEX IF EXISTS coord.uq_plan_pr_citations_dedupe")
    op.execute("DROP TABLE IF EXISTS coord.plan_pr_citations")
