"""agent.work_artifacts (+ versions, edges) — the Plan & Prompt Library store

Revision ID: plan_library_01_work_artifacts
Revises: coord_system_tenant_marker
Create Date: 2026-08-15

Phase 1 of the plan ``2026-08-10-plan-and-prompt-library-in-web``: give the
web backend a first-class, versioned home for the *work artifacts* the fleet
already produces as loose markdown on disk — investigation prompts, plan
authoring prompts, implementation prompts, investigation reports, handoffs
and the plans themselves.

Three tables, all in the **web-owned** ``agent`` schema (created by
``consolidation_phase1_01_infrastructure``; the ``CREATE SCHEMA IF NOT
EXISTS`` below is defensive only):

``agent.work_artifacts``
    One row per (org, kind, slug, source_repo) artifact. Mutable head row —
    ``body`` / ``content_sha256`` / ``current_version`` always describe the
    latest revision.

``agent.work_artifact_versions``
    Append-only immutable snapshots, one row per revision. Shape copied from
    the proven ``coord.prompt_document_versions`` /
    ``project.prompt_template_versions`` pattern: the parent row tracks
    ``current_version``, every content change INSERTs a new version row in
    the same transaction that bumps it.

``agent.work_artifact_edges``
    The provenance graph between artifacts: an investigation prompt
    ``produced_report`` an investigation report, which ``feeds`` a plan
    authoring prompt, which ``authored_plan`` a plan, which a later plan may
    ``supersede`` or ``depend_on``.

Design notes
============

* **Identity is a FUNCTIONAL unique index**, not a plain UNIQUE constraint:
  ``(coalesce(organization_id, nil-uuid), kind, slug, coalesce(source_repo,
  ''))``. Both ``organization_id`` and ``source_repo`` are nullable and in
  PostgreSQL ``NULL <> NULL``, so a plain UNIQUE over the raw columns would
  admit unlimited duplicates for exactly the rows the library most needs to
  deduplicate (an org-less runner scan of a repo-less plan file). The
  ``coalesce`` collapses NULL onto a sentinel so the uniqueness actually
  bites. The API's upsert keys on the same expression.

* **``status`` is opaque TEXT with NO CHECK and no default vocabulary.**
  Deliberate: the statuses in the wild (``VETTED``, ``IN PROGRESS``,
  ``SHIPPED``, ``ABANDONED``, ``draft``, …) are authored by humans and agents
  in free-form plan front-matter, and a CHECK here would turn every new
  status word into a 500 at ingest time and a 422 at the API. The library is
  a *mirror* of what the fleet wrote, not its schema police.

* **``kind`` and ``captured_by`` DO carry CHECKs**, under explicit stable
  names (``ck_work_artifacts_kind`` / ``ck_work_artifacts_captured_by``) so
  a future widening can ``DROP CONSTRAINT <known name>`` instead of the
  discover-and-drop ``pg_constraint`` loop ``coord_prompt_docs_02`` needed
  after ``coord_prompt_docs_01`` left PostgreSQL to auto-name an inline
  CHECK. Same for ``ck_work_artifact_edges_relation``.

* **``work_unit_slug`` carries NO foreign key.** It is a soft link to coord's
  ``work_units`` table, which lives in coord's own schema in coord's own
  deployment. A cross-schema FK would re-couple precisely what the
  web↔coord schema-boundary decoupling (P4) separated, so the column is a
  plain indexed TEXT that is ALLOWED TO DANGLE: readers join it as nullable
  and never 404 on a missing work unit.

* **No FK on ``organization_id`` / ``created_by_user_id`` either.** Rows are
  ingested by runner scans of on-disk markdown whose authorship is a git
  identity, not necessarily a provisioned ``auth.users`` row; the same
  warn-and-continue reasoning that left ``coord.prompt_documents.tenant_id``
  FK-less applies. Uniqueness and scoping are enforced by the functional
  index and by the API always deriving the org from the authenticated
  principal.

* **Search** is a GIN index over ``to_tsvector('english', title || body)``.
  The regconfig is spelled explicitly because ``to_tsvector(text)`` (the
  one-argument form, which reads ``default_text_search_config``) is only
  STABLE and cannot be indexed.

Idempotency: every statement uses ``IF NOT EXISTS`` / ``IF EXISTS``, so a
partially-applied run re-runs cleanly and the downgrade → upgrade round-trip
is a no-op on a fresh database.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
#
# NOTE: the ``coord_prompt_docs_02`` prefix is already shared by two files
# (``_02_prompt_template_kind`` and ``_02_drop_policy_documents``), so this
# revision deliberately takes an unambiguous, unshared id.
revision: str = "plan_library_01_work_artifacts"
down_revision: str = "coord_system_tenant_marker"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The sentinel the functional unique index folds a NULL organization onto.
_NIL_UUID = "00000000-0000-0000-0000-000000000000"


def upgrade() -> None:
    """Create the work-artifact store, its version log and its edge table."""
    # Defensive only — consolidation_phase1_01_infrastructure created it.
    op.execute("CREATE SCHEMA IF NOT EXISTS agent")

    # ── 1. The mutable head rows ────────────────────────────────────────
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent.work_artifacts (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id    UUID,
            created_by_user_id UUID,
            kind               TEXT NOT NULL
                CONSTRAINT ck_work_artifacts_kind CHECK (kind IN (
                    'investigation_prompt',
                    'plan_authoring_prompt',
                    'implementation_prompt',
                    'investigation_report',
                    'handoff',
                    'plan'
                )),
            slug               TEXT NOT NULL,
            title              TEXT NOT NULL DEFAULT '',
            -- Opaque free-form text. No CHECK, no vocabulary: see the module
            -- docstring. Never validated, never a 422.
            status             TEXT NOT NULL DEFAULT '',
            body               TEXT NOT NULL DEFAULT '',
            content_sha256     TEXT NOT NULL,
            source_path        TEXT,
            source_repo        TEXT,
            -- Soft link to coord's work-unit slug. NO FK by design; may dangle.
            work_unit_slug     TEXT,
            repos              TEXT[] NOT NULL DEFAULT '{}',
            authored_at        TIMESTAMPTZ,
            captured_by        TEXT NOT NULL DEFAULT 'agent'
                CONSTRAINT ck_work_artifacts_captured_by CHECK (
                    captured_by IN ('runner_scan', 'agent', 'operator')
                ),
            current_version    INTEGER NOT NULL DEFAULT 1,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # Identity. NULL-collapsing so the constraint bites on org-less /
    # repo-less rows (see the docstring). This is the upsert conflict target.
    op.execute(
        f"""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifacts_identity
            ON agent.work_artifacts (
                coalesce(organization_id, '{_NIL_UUID}'::uuid),
                kind,
                slug,
                coalesce(source_repo, '')
            )
        """
    )

    # Serves the primary list read (`?kind=&status=`).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_work_artifacts_kind_status
            ON agent.work_artifacts (kind, status)
        """
    )

    # Serves "everything attached to this work unit".
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_work_artifacts_work_unit_slug
            ON agent.work_artifacts (work_unit_slug)
        """
    )

    # Serves `?repo=` — array containment.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_work_artifacts_repos
            ON agent.work_artifacts USING GIN (repos)
        """
    )

    # Serves `?q=` — full-text over title + body. Explicit regconfig: the
    # single-argument to_tsvector() is only STABLE and is not indexable.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_work_artifacts_search
            ON agent.work_artifacts USING GIN (
                to_tsvector(
                    'english',
                    coalesce(title, '') || ' ' || coalesce(body, '')
                )
            )
        """
    )

    # Serves the divergence read: same (kind, slug), differing sha.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_work_artifacts_kind_slug
            ON agent.work_artifacts (kind, slug)
        """
    )

    # ── 2. Append-only version snapshots ────────────────────────────────
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent.work_artifact_versions (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id        UUID NOT NULL
                REFERENCES agent.work_artifacts (id) ON DELETE CASCADE,
            version_number     INTEGER NOT NULL,
            body               TEXT NOT NULL,
            content_sha256     TEXT NOT NULL,
            change_description TEXT,
            created_by         TEXT,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_versions_doc_version
            ON agent.work_artifact_versions (document_id, version_number)
        """
    )

    # ── 3. The provenance graph ─────────────────────────────────────────
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent.work_artifact_edges (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            from_id    UUID NOT NULL
                REFERENCES agent.work_artifacts (id) ON DELETE CASCADE,
            to_id      UUID NOT NULL
                REFERENCES agent.work_artifacts (id) ON DELETE CASCADE,
            relation   TEXT NOT NULL
                CONSTRAINT ck_work_artifact_edges_relation CHECK (
                    relation IN (
                        'produced_report',
                        'feeds',
                        'authored_plan',
                        'supersedes',
                        'depends_on'
                    )
                ),
            note       TEXT,
            created_by TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_edges_from_to_relation
            ON agent.work_artifact_edges (from_id, to_id, relation)
        """
    )

    # Both directions are first-class reads (`GET /{id}` returns incoming AND
    # outgoing edges), so both endpoints get their own index. The unique index
    # above already serves from_id as a leading column, but naming it
    # explicitly keeps the intent legible and costs one small btree.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_work_artifact_edges_from_id
            ON agent.work_artifact_edges (from_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_work_artifact_edges_to_id
            ON agent.work_artifact_edges (to_id)
        """
    )


def downgrade() -> None:
    """Drop the store. Children first — the FKs cascade, but be explicit."""
    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifact_edges_to_id")
    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifact_edges_from_id")
    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifact_edges_from_to_relation")
    op.execute("DROP TABLE IF EXISTS agent.work_artifact_edges")

    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifact_versions_doc_version")
    op.execute("DROP TABLE IF EXISTS agent.work_artifact_versions")

    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifacts_kind_slug")
    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifacts_search")
    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifacts_repos")
    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifacts_work_unit_slug")
    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifacts_kind_status")
    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifacts_identity")
    op.execute("DROP TABLE IF EXISTS agent.work_artifacts")
