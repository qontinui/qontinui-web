"""coord prompt_documents + prompt_document_versions — versioned prompt-document store

Revision ID: coord_prompt_docs_01
Revises: coord_push_tool_01_widen_ledger_initiator
Create Date: 2026-07-17

Phase 2 of the session-autonomy-fabric plan
(``D:/qontinui-root/plans/2026-07-17-session-autonomy-fabric.md``, design
decision D1): evolve ``coord.policy_documents`` into a general, versioned
``coord.prompt_documents`` store instead of growing a parallel table.

What this migration does
========================

1. Creates ``coord.prompt_documents`` — one editable prompt-shaped document
   per ``(tenant_id, kind, name)``. ``kind`` distinguishes the four content
   families that today live in four unrelated homes:

   * ``policy``            — canonical policy prose (ex-``policy_documents``)
   * ``response_prompt``   — e.g. the agent Q&A meta-answer template
   * ``continuation_rules``— the Stop-hook continuation umbrella prompt
   * ``agent_playbook``    — e.g. the merge-shepherd playbook

2. Creates ``coord.prompt_document_versions`` — append-only immutable
   snapshots, one row per version. Shape copied from the proven
   ``project.prompt_template_versions`` pattern
   (``backend/app/models/prompt_template_version.py``): the parent row
   tracks ``current_version``; every edit INSERTs a new version row.

3. Data-migrates existing ``coord.policy_documents`` rows into
   ``prompt_documents`` with ``kind='policy'``, ``name=handle``,
   ``description=title``, seeding a version-1 snapshot per document.
   The old table is NOT dropped here — coord's reader cutover must deploy
   first (D1 sequencing); the drop ships as a separate follow-up migration
   in its own PR, labeled downstream of the coord cutover PR.

Design notes
============

* ``tenant_id`` carries NO foreign key to ``coord.tenants``, matching its
  ancestors ``coord.policy_documents`` / ``coord.policy_rules``: coord-side
  seeding is warn-and-continue, and an FK would silently re-introduce the
  inert-feature class documented in ``coord_policy_documents_default_source``.
* ``format`` keeps the ancestor's ('markdown', 'rubric') CHECK; every seed
  writes 'markdown'.
* ``default_source`` is nullable on the documents table: NULL means
  "hand-authored", non-NULL names the code constant the row was seeded from
  (what coord's ``restore-default`` route re-seeds from). Migrated policy
  rows keep their original ``policy_doc/<handle>/v1`` stamps.
* ``current_version`` starts at 1; coord bumps it in the same transaction
  that INSERTs each new ``prompt_document_versions`` row.
* Version rows are immutable snapshots; ``description`` on a version row is
  the change note (per the prompt_template_versions ``change_description``),
  not the document description.
* Idempotency: every DDL uses ``IF NOT EXISTS`` / ``IF EXISTS``; the data
  copy uses ``ON CONFLICT DO NOTHING`` and a ``WHERE NOT EXISTS`` guard on
  version seeding, and tolerates ``coord.policy_documents`` being absent
  (fresh databases created after the follow-up drop migration).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_prompt_docs_01"
down_revision: str = "coord_push_tool_01_widen_ledger_initiator"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create prompt_documents(+versions) and copy policy_documents in."""
    # 1. The generalized, versioned document store.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.prompt_documents (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL,
            name            TEXT NOT NULL,
            description     TEXT,
            kind            TEXT NOT NULL
                CHECK (kind IN ('policy', 'response_prompt',
                                'continuation_rules', 'agent_playbook')),
            body            TEXT NOT NULL,
            format          TEXT NOT NULL DEFAULT 'markdown'
                CHECK (format IN ('markdown', 'rubric')),
            default_source  TEXT,
            current_version INTEGER NOT NULL DEFAULT 1,
            updated_by      TEXT,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # Required by the coord seeder's ON CONFLICT (tenant_id, kind, name)
    # DO NOTHING, and serves the by-tenant/by-kind list reads (tenant_id
    # leading).
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_documents_tenant_kind_name
            ON coord.prompt_documents (tenant_id, kind, name)
        """
    )

    # 2. Append-only immutable version snapshots.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.prompt_document_versions (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id    UUID NOT NULL
                REFERENCES coord.prompt_documents (id) ON DELETE CASCADE,
            version_number INTEGER NOT NULL,
            body           TEXT NOT NULL,
            description    TEXT,
            edited_by      TEXT,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # Required by coord's ON CONFLICT (document_id, version_number) DO
    # NOTHING seeding, and serves the versions-of-a-document list read.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_document_versions_doc_version
            ON coord.prompt_document_versions (document_id, version_number)
        """
    )

    # 3. Copy existing policy documents in as kind='policy'. Tolerates the
    #    source table being absent (a fresh DB migrated after the follow-up
    #    drop migration re-runs history without coord.policy_documents...
    #    which cannot happen in a linear chain, but IF EXISTS costs nothing
    #    and keeps the re-run/downgrade paths honest).
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('coord.policy_documents') IS NOT NULL THEN
                INSERT INTO coord.prompt_documents
                    (tenant_id, name, description, kind, body, format,
                     default_source, current_version, updated_by, updated_at)
                SELECT tenant_id, handle, title, 'policy', body, format,
                       default_source, 1, updated_by, updated_at
                FROM coord.policy_documents
                ON CONFLICT DO NOTHING;
            END IF;
        END
        $$
        """
    )

    # 4. Seed the version-1 snapshot for every document that has no version
    #    row yet (the rows just migrated, plus any row a partially-applied
    #    earlier run left behind). Idempotent via WHERE NOT EXISTS.
    op.execute(
        """
        INSERT INTO coord.prompt_document_versions
            (document_id, version_number, body, description,
             edited_by, created_at)
        SELECT d.id, 1, d.body,
               'migrated from coord.policy_documents',
               d.updated_by, d.updated_at
        FROM coord.prompt_documents d
        WHERE NOT EXISTS (
            SELECT 1 FROM coord.prompt_document_versions v
            WHERE v.document_id = d.id
        )
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    """Drop the versioned prompt-document store.

    ``coord.policy_documents`` was never touched on upgrade, so downgrade
    is a plain drop — no reverse data copy.
    """
    op.execute("DROP INDEX IF EXISTS coord.uq_prompt_document_versions_doc_version")
    op.execute("DROP TABLE IF EXISTS coord.prompt_document_versions")
    op.execute("DROP INDEX IF EXISTS coord.uq_prompt_documents_tenant_kind_name")
    op.execute("DROP TABLE IF EXISTS coord.prompt_documents")
