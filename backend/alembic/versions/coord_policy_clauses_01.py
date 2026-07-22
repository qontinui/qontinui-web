"""coord policy_clauses + prompt_documents.attrs — structured clause data model

Revision ID: coord_policy_clauses_01
Revises: coord_memory_links
Create Date: 2026-07-19

Phase 1 of the policy-clause-schema web data-model plan
(``D:/qontinui-root/plans/2026-07-18-policy-clause-schema-web-data-model.md``).

What this migration does
========================

1. Creates ``coord.policy_clauses`` — one row per citable, structured clause
   inside a policy ``coord.prompt_documents`` row. A clause is the granular,
   machine-actionable unit the agent cites and applies (tier / trigger /
   action / bounds / escalate_if), decomposed out of the free-prose policy
   body. Each clause hangs off its parent document via ``document_id`` and is
   citable within that document by its kebab-case ``clause_id``.

2. Adds ``coord.prompt_documents.attrs JSONB`` (nullable) — generic,
   kind-agnostic per-document attributes. For policy documents this carries
   the category's default tier + description; other kinds may use it freely.

Design / column-contract notes
==============================

* The ``coord.policy_clauses`` column set is a **shared contract** with the
  coord Rust code — column names must not drift from this list.
* ``id`` / ``tenant_id`` / ``document_id`` are ``UUID`` to match
  ``coord.prompt_documents.id`` and ``.tenant_id`` (both UUID, see
  ``coord_prompt_docs_01_prompt_documents.py``).
* ``document_id`` FKs ``coord.prompt_documents(id) ON DELETE CASCADE`` — a
  clause cannot outlive its document.
* ``category`` is a **denormalized copy** of the parent document's ``name``.
  A pure-SQL CHECK cannot reference another table, so the invariant
  (``category == parent document name``) is validated at the app layer —
  coord checks it on write. A column comment records the invariant.
* ``status`` CHECK ∈ (gap, proposed, confirmed, active, retired).
* ``tier`` is nullable; when set, CHECK ∈
  (proceed, proceed+log, proceed+notify, ask-first, never).
* ``anti_triggers`` / ``depends_on`` / ``links`` are ``TEXT[]`` defaulting to
  ``'{}'`` (never NULL).
* ``source`` JSONB shape: ``{session, origin: debrief|gap|manual}``.
* ``tenant_id`` carries NO foreign key to ``coord.tenants``, matching the
  ancestor prompt/policy tables (coord-side seeding is warn-and-continue; an
  FK would re-introduce the inert-feature class).
* UNIQUE(document_id, clause_id) — a clause id is unique within its document.
* Index on (document_id, position) for ordered fetch; index on tenant_id for
  by-tenant reads.
* Idempotency: every DDL uses ``IF NOT EXISTS`` / ``DO $$ ... IF NOT EXISTS``
  for constraints, mirroring the neighbor coord migrations.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_policy_clauses_01"
down_revision: str = "coord_memory_links"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.policy_clauses and add coord.prompt_documents.attrs."""
    # 1. Generic per-document attributes bag (nullable). For policy docs this
    #    holds the category default tier + description; kind-agnostic.
    op.execute(
        """
        ALTER TABLE coord.prompt_documents
            ADD COLUMN IF NOT EXISTS attrs JSONB
        """
    )

    # 2. Structured, citable clause rows under a policy document.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.policy_clauses (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID NOT NULL,
            document_id   UUID NOT NULL
                REFERENCES coord.prompt_documents (id) ON DELETE CASCADE,
            clause_id     TEXT NOT NULL,
            category      TEXT NOT NULL,
            status        TEXT NOT NULL
                CHECK (status IN ('gap', 'proposed', 'confirmed',
                                  'active', 'retired')),
            tier          TEXT
                CHECK (tier IS NULL OR tier IN ('proceed', 'proceed+log',
                                                'proceed+notify', 'ask-first',
                                                'never')),
            trigger       TEXT,
            action        TEXT,
            bounds        TEXT,
            escalate_if   TEXT,
            anti_triggers TEXT[] NOT NULL DEFAULT '{}',
            depends_on    TEXT[] NOT NULL DEFAULT '{}',
            links         TEXT[] NOT NULL DEFAULT '{}',
            position      INTEGER NOT NULL DEFAULT 0,
            source        JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_by    TEXT,
            updated_by    TEXT,
            CONSTRAINT uq_policy_clauses_document_clause
                UNIQUE (document_id, clause_id)
        )
        """
    )

    # Invariant recorded for humans + coord: category mirrors the parent
    # document's name. Enforced at the app layer (no cross-table SQL CHECK).
    op.execute(
        """
        COMMENT ON COLUMN coord.policy_clauses.category IS
            'Denormalized copy of the parent coord.prompt_documents.name. '
            'Invariant category == parent document name is enforced at the '
            'app layer (coord checks on write); no cross-table SQL CHECK.'
        """
    )

    # Ordered fetch of a document's clauses.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_policy_clauses_document_position
            ON coord.policy_clauses (document_id, position)
        """
    )

    # By-tenant reads.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_policy_clauses_tenant
            ON coord.policy_clauses (tenant_id)
        """
    )


def downgrade() -> None:
    """Drop coord.policy_clauses and the prompt_documents.attrs column."""
    op.execute("DROP INDEX IF EXISTS coord.ix_policy_clauses_tenant")
    op.execute("DROP INDEX IF EXISTS coord.ix_policy_clauses_document_position")
    op.execute("DROP TABLE IF EXISTS coord.policy_clauses")
    op.execute("ALTER TABLE coord.prompt_documents DROP COLUMN IF EXISTS attrs")
