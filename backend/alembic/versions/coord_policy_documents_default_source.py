"""coord policy_documents + policy_rules.default_source — agent Q&A meta-answer DDL

Revision ID: coord_policy_docs_default_source
Revises: coord_memory_synthesis_jobs
Create Date: 2026-07-13

Ships the schema half of the decision-delegation meta-answer plan
(``D:/qontinui-root/plans/2026-07-07-agent-qa-meta-answer-decision-delegation.md``).

Why this is a REPAIR, not a feature
===================================

The coord half of that plan (``src/policy_documents.rs``,
``src/agent_meta_answer.rs``, the ``default_source`` restore route) is
already merged AND deployed — build ``358d6e54`` is live — but its
alembic migration was never authored. coord authors ZERO ``coord.*``
DDL (CI gate ``tests/coord_schema_authorship.rs``), so the tables it
reads simply do not exist. Two consequences, both observed in prod:

* ``coord.policy_rules.default_source`` is SELECTed by
  ``policies/resolver.rs::fetch_policies`` — the loader used for EVERY
  ``PolicyKind``, not just the new one. So every policy evaluation in
  the fleet fails with ``column "default_source" does not exist``. The
  PR-merge engine logs this as a fail-safe WARN (``engine.rs:816``:
  evaluation error -> preserve the block) at a rate of ~140 per 20
  minutes across all five repos. Green PRs still land (policy is only
  consulted when the predicate is not already green), but every
  policy-driven override/unblock is silently dead.
* ``coord.policy_documents`` does not exist, so ``coord_request_policy``
  with a ``handle`` argument 500s, and the per-tenant seeding of the
  canonical policy documents warns-and-continues on every question.

Adding the two missing objects repairs the policy engine and activates
the already-deployed feature (which stays in shadow mode regardless:
``COORD_AGENT_META_ANSWER`` defaults to ``shadow`` and is not set in
``deploy/taskdef.json``).

Design notes
============

* The ``coord.policy_documents`` shape is copied verbatim from the
  contract documented in ``coord/src/policy_documents.rs`` (module
  docstring) and cross-checked against its SQL: ``SELECT_COLS`` is
  ``id, tenant_id, handle, title, body, format, default_source,
  updated_by, updated_at``, and the seed relies on
  ``ON CONFLICT (tenant_id, handle) DO NOTHING`` — hence the UNIQUE.
* ``tenant_id`` carries NO foreign key to ``coord.tenants``, matching
  its sibling ``coord.policy_rules`` (see ``coord_policy_rules_rename``)
  and the documented contract. An FK would be stricter, but a tenant
  that is absent from ``coord.tenants`` would then fail seeding — the
  seed is warn-and-continue, so that would silently re-introduce
  exactly the inert-feature class this migration exists to fix.
* ``format`` is CHECKed to ('markdown', 'rubric') per the plan. Every
  seed writes 'markdown', and ``upsert_edit`` only ever updates
  ``title``/``body`` — ``format`` is effectively write-once at seed
  time, so the constraint cannot be tripped by the live code paths.
* ``default_source`` is nullable on BOTH objects: NULL means
  "hand-authored", non-NULL names the code constant the row was seeded
  from and is what the ``POST /coord/policies/:id/restore-default``
  route re-seeds from.
* No new index on ``policy_rules.default_source``: the seed's guard
  query filters ``(tenant_id, kind, default_source, enabled)`` and is
  already served by the existing partial ``enabled = true`` index.
  ``UNIQUE (tenant_id, handle)`` likewise serves the
  list-documents-by-tenant read (tenant_id is the leading column).
* Idempotency: every DDL uses ``IF NOT EXISTS`` / ``IF EXISTS`` so a
  re-run against an already-applied DB is a no-op.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_policy_docs_default_source"
down_revision: str = "coord_memory_synthesis_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add policy_rules.default_source and create coord.policy_documents."""
    # 1. The column the live policy resolver already SELECTs. Nullable:
    #    NULL = hand-authored, non-NULL = seeded from a code default.
    op.execute(
        """
        ALTER TABLE coord.policy_rules
            ADD COLUMN IF NOT EXISTS default_source TEXT
        """
    )

    # 2. Tenant-scoped canonical policy prose, addressed by handle.
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

    # Required by the seeder's ON CONFLICT (tenant_id, handle) DO NOTHING,
    # and serves the by-tenant list read (tenant_id leading).
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_documents_tenant_handle
            ON coord.policy_documents (tenant_id, handle)
        """
    )


def downgrade() -> None:
    """Drop policy_documents and the default_source column."""
    op.execute("DROP INDEX IF EXISTS coord.uq_policy_documents_tenant_handle")
    op.execute("DROP TABLE IF EXISTS coord.policy_documents")
    op.execute("ALTER TABLE coord.policy_rules DROP COLUMN IF EXISTS default_source")
