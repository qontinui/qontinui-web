"""coord prompt_document_proposals — pending policy-edit proposal queue

Revision ID: prompt_doc_proposals_01
Revises: agent_registry_01
Create Date: 2026-07-28

Phase 5 of the CLAUDE.md-into-qontinui migration plan
(``qontinui-dev-notes/plans/2026-07-28-migrate-claude-md-into-qontinui.md``):
direction enforcement on agent-authored prompt-document edits.

Background
==========

coord's ``coord_write_prompt_document`` MCP tool already lets agents APPEND
clauses to served policy documents. Phase 5 adds a *direction* comparator on
top of it. Tier ordering, strictest → loosest::

    never > ask-first > proceed+notify > proceed+log > proceed

Additive clauses and tier-RAISING edits keep landing immediately. An edit
that LOWERS a clause's tier or widens authority — and, fail-closed, any edit
the comparator cannot classify — is re-routed into this table as a *pending
proposal* for operator review instead of landing.

What this migration does
========================

Creates ``coord.prompt_document_proposals`` — one row per re-routed edit.
It records the target document (``doc_kind``/``doc_name``, optional
``clause_id``), the ``proposed_content``, the comparator's verdict
(``direction`` + ``from_tier``/``to_tier``), the author's ``rationale``
(the change_note they supplied), the authenticated ``proposed_by``
identity, the ``base_version`` the edit was authored against, and the
operator's decision (``status``, ``decided_by``, ``decided_at``,
``decision_note``).

Design notes
============

* ``tenant_id`` carries NO foreign key to ``coord.tenants``, matching the
  ancestor pattern (``coord.prompt_documents``, ``coord.agent_registry``,
  ``coord.policy_rules``): coord-side seeding is warn-and-continue and an
  FK would silently re-introduce the inert-feature failure class.
* Deliberately NO foreign key to ``coord.prompt_documents`` either. The
  target is addressed by ``(tenant_id, doc_kind, doc_name)`` — the same
  natural key coord's read path uses — so a proposal survives a document
  being re-seeded (which mints a new ``id``) and can be authored against a
  document that a peer deploy has not seeded yet.
* ``direction`` (``loosening`` | ``unclassifiable``), ``status``
  (``pending`` | ``approved`` | ``rejected``) and the tier columns
  (``from_tier``/``to_tier``: ``never`` | ``ask-first`` | ``proceed+notify``
  | ``proceed+log`` | ``proceed``) are **Rust-enforced vocabularies,
  deliberately NOT DB CHECK constraints** — per the coord
  ``sessions.rs:356-377`` design rationale and the precedent set by
  ``coord.agent_registry`` in revision ``agent_registry_01``, vocab columns
  stay CHECK-free so vocabulary evolution (a new tier, a new terminal
  status) never requires a migration. Only ``loosening`` and
  ``unclassifiable`` edits ever become rows; tier-raising and additive
  edits land directly and are never written here.
* ``base_version`` is the document's ``current_version`` at authoring time.
  It is NOT a constraint — it powers stale-proposal detection: the review
  feed warns when ``base_version`` trails the document's live
  ``current_version``, i.e. the document moved under the proposal.
* ``proposed_by`` / ``decided_by`` are free-text authenticated identities
  (agent id or operator user), never client-supplied arguments; no FK to a
  users table because the two identity spaces differ.
* ``clause_id`` is NULL when the edit targets the document as a whole
  rather than a single clause.
* One index on ``(tenant_id, status, created_at DESC)`` — the exact shape
  of the review feed's only list read
  (``?status=pending``, newest first, tenant-scoped).
* Idempotency: every DDL uses ``IF NOT EXISTS`` / ``IF EXISTS``; the
  downgrade is symmetric and drops index-then-table.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "prompt_doc_proposals_01"
down_revision: str = "agent_registry_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the pending policy-edit proposal queue."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.prompt_document_proposals (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id        UUID NOT NULL,
            doc_kind         TEXT NOT NULL,
            doc_name         TEXT NOT NULL,
            clause_id        TEXT,
            proposed_content TEXT NOT NULL,
            direction        TEXT NOT NULL,
            from_tier        TEXT,
            to_tier          TEXT,
            rationale        TEXT NOT NULL,
            proposed_by      TEXT NOT NULL,
            base_version     INTEGER NOT NULL,
            status           TEXT NOT NULL DEFAULT 'pending',
            decided_by       TEXT,
            decided_at       TIMESTAMPTZ,
            decision_note    TEXT,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # Serves the review feed's only list read: tenant-scoped, filtered by
    # status, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_prompt_document_proposals_tenant_status
            ON coord.prompt_document_proposals (tenant_id, status, created_at DESC)
        """
    )


def downgrade() -> None:
    """Drop the proposal queue (no data migrated in, plain drop)."""
    op.execute("DROP INDEX IF EXISTS coord.ix_prompt_document_proposals_tenant_status")
    op.execute("DROP TABLE IF EXISTS coord.prompt_document_proposals")
