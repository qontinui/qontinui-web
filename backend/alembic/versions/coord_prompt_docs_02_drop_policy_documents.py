"""drop coord.policy_documents — prompt_documents cutover complete

Revision ID: coord_prompt_docs_02_drop
Revises: auto_fix_rm_flaky_01
Create Date: 2026-07-17

The teardown half of the session-autonomy-fabric Phase 2 chain
(``D:/qontinui-root/plans/2026-07-17-session-autonomy-fabric.md``, design
decision D1). ``coord_prompt_docs_01`` created ``coord.prompt_documents``
(+ versions) and copied every ``policy_documents`` row in as
``kind='policy'``; coord's reader-cutover PR repointed every reader
(``prompt_documents.rs``, the meta-answer ``{{policy:<handle>}}`` resolver,
``coord_request_policy``'s handle path, the HTTP CRUD) at the new store.
Nothing reads ``coord.policy_documents`` any more — delete-over-deprecate.

SEQUENCING (why this is a separate migration in a separate PR)
==============================================================

This migration must apply only AFTER the coord reader cutover has
DEPLOYED (verify ``/coord/build-info``), not merely merged. A coord build
still reading ``coord.policy_documents`` when this drop applies would hard-
fail policy-document reads fleet-wide (the ``fetch_policies``-kill incident
class documented in ``coord_policy_documents_default_source``). The PR
carrying this file is therefore labeled
``coord:downstream-of=<the coord cutover PR>`` so the merge train enforces
the land order; the deploy-lag window between the cutover's land and its
deploy is covered by coord's table-tolerant reads on the OLD table having
been deleted (the cutover build no longer touches it at all).

* Idempotent: ``IF EXISTS`` on both drops.
* Downgrade recreates the empty table shape (from
  ``coord_policy_documents_default_source``) — data is NOT restored;
  the authoritative copies live in ``coord.prompt_documents`` and coord
  re-seeds canonical documents per tenant on first touch.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_prompt_docs_02_drop"
down_revision: str = "auto_fix_rm_flaky_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the superseded coord.policy_documents table."""
    op.execute("DROP INDEX IF EXISTS coord.uq_policy_documents_tenant_handle")
    op.execute("DROP TABLE IF EXISTS coord.policy_documents")


def downgrade() -> None:
    """Recreate the empty policy_documents shape (no data restore)."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.policy_documents (
            id             BIGSERIAL PRIMARY KEY,
            tenant_id      UUID NOT NULL,
            handle         TEXT NOT NULL,
            title          TEXT NOT NULL,
            body           TEXT NOT NULL,
            format         TEXT NOT NULL DEFAULT 'markdown'
                CHECK (format IN ('markdown', 'rubric')),
            default_source TEXT,
            updated_by     TEXT,
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_documents_tenant_handle
            ON coord.policy_documents (tenant_id, handle)
        """
    )
