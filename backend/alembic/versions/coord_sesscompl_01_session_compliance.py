"""coord.session_compliance — POLICY_COMPLIANCE verdict store

Revision ID: coord_sesscompl_01
Revises: operators_disabled_01
Create Date: 2026-07-30

Phase 2 (§A2) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-07-30-session-compliance-report-enforcement.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
storage for coord's ``POST /coord/sessions/:claude_session_id/compliance``
handler lands here, in qontinui-web, and this migration must merge BEFORE the
coord PR that reads these columns.

What this migration does
========================

Creates ``coord.session_compliance`` — one row per
``(tenant_id, claude_session_id)`` recording whether that Claude Code session
emitted the ``policy-compliance/1`` block required by
``policy/session-protocol`` v4 Step 3, and whether the claims in that block
reconciled against what coord independently observed.

Design / column-contract notes
==============================

* The column set is a **shared contract** with the coord Rust code — column
  names must not drift from this list.

* ``verdict`` has exactly **THREE** values, never two
  (``[policy: ux-priorities#honesty]``, plan §A2):

  - ``verified``       — block present AND every checkable claim reconciled.
  - ``unverified``     — block present but ≥1 claim unconfirmed/contradicted,
                         **or the block was absent entirely**.
  - ``not_applicable`` — enforcement disabled, or the enforced clause is
                         absent from the active prompt-document version.

  A missing block is ``unverified`` with ``reason = 'absent'`` — deliberately
  **not** a fourth state, so the UI never has to explain "no report" and "bad
  report" as separate concepts. The CHECK constraint encodes exactly those
  three values; a CHECK is the house convention for small closed value sets on
  coord tables (``coord.gates.verdict``, ``coord.prompt_documents.kind`` /
  ``.format``, ``coord.policy_clauses.status`` / ``.tier``).

* ``reason`` is free-text and deliberately **un-CHECKed**: the reason
  vocabulary (``absent``, ``unreconciled_claims``, ``enforcement_disabled``,
  ``clause_absent``, …) is expected to grow as reconciliation gets more
  signals, and a CHECK there would force a migration per new reason. It is
  NULL for a clean ``verified``.

* ``claude_session_id`` is the **Claude Code session UUID** — the id space that
  keys ``coord.agent_sessions`` and every ``*.agent_session_id`` column — NOT
  ``coord.sessions.id`` (which is coord's own PK, bridged by
  ``coord.sessions.claude_code_session_id``). Plan §A3 is explicit that every
  existing session-footprint query uses the Claude UUID; use it consistently.

  It is stored as ``TEXT``, matching the one existing column of that exact name
  and meaning — ``coord.session_handles.claude_session_id TEXT UNIQUE NOT NULL``
  (``coord_session_handles.py:89``), the anchor/rebind key. No FK to
  ``coord.agent_sessions``: compliance is recorded at Stop-hook time and must
  not fail because the session-lookup upsert has not run yet (the same
  best-effort-link stance the newer coord lineage tables take).

* ``report`` JSONB is the ``policy-compliance/1`` block **verbatim**, and is
  NULL exactly when the block was absent. Storing it raw keeps the operator
  surface (plan §B3) able to show what the session actually claimed rather than
  a lossy projection.

* ``reconciliation`` JSONB is NOT NULL DEFAULT ``'{}'::jsonb`` — coord's
  per-item reconciliation outcome, including the honest degradation labels plan
  §A3 requires (e.g. ``attribution: "heuristic"``, which must never promote a
  claim to ``verified``). Never NULL, so readers do not branch on absent-vs-empty.

* ``prompt_document_version`` / ``enforced_clause_ref`` snapshot WHICH policy
  version and WHICH clause the verdict was rendered against. Both nullable:
  a ``not_applicable`` verdict may have been reached precisely because no
  clause resolved.

* ``tenant_id`` carries NO foreign key to ``coord.tenants``, matching every
  ancestor coord table in this schema (``coord.prompt_documents``,
  ``coord.policy_clauses``): coord-side seeding is warn-and-continue, and an FK
  would re-introduce the inert-feature class.

* UNIQUE ``(tenant_id, claude_session_id)`` — one verdict per session per
  tenant; coord upserts on it (a re-check overwrites rather than accumulating).

* Indices: ``(tenant_id, checked_at DESC)`` serves the "recent sessions" panel
  (plan §B3.2); ``(tenant_id, verdict)`` serves the verdict-chip filter and the
  outstanding-work ledger's scan for non-``verified`` rows.

Idempotency: raw ``op.execute`` with ``CREATE TABLE / INDEX IF NOT EXISTS`` —
the house convention for coord tables (``coord_singleauthored_01_gates``,
``coord_prompt_docs_01``, ``coord_policy_clauses_01``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sesscompl_01"
down_revision: str | Sequence[str] | None = "operators_disabled_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.session_compliance."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_compliance (
            id                      UUID PRIMARY KEY
                                        DEFAULT gen_random_uuid(),
            tenant_id               UUID NOT NULL,
            claude_session_id       TEXT NOT NULL,
            verdict                 TEXT NOT NULL
                CHECK (verdict IN ('verified', 'unverified',
                                   'not_applicable')),
            reason                  TEXT,
            report                  JSONB,
            reconciliation          JSONB NOT NULL DEFAULT '{}'::jsonb,
            prompt_document_version INTEGER,
            enforced_clause_ref     TEXT,
            checked_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_session_compliance_tenant_session
                UNIQUE (tenant_id, claude_session_id)
        )
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.session_compliance.claude_session_id IS
            'The Claude Code session UUID (the id space keying '
            'coord.agent_sessions and every *.agent_session_id), NOT '
            'coord.sessions.id. Stored as TEXT to match '
            'coord.session_handles.claude_session_id.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_compliance.verdict IS
            'Exactly three values. A missing policy-compliance/1 block is '
            'verdict=unverified with reason=absent — never a fourth state.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_compliance.report IS
            'The policy-compliance/1 block verbatim; NULL exactly when the '
            'block was absent.'
        """
    )

    # "Recent sessions" panel: per-tenant reverse-chronological scan.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_session_compliance_tenant_checked
            ON coord.session_compliance (tenant_id, checked_at DESC)
        """
    )
    # Verdict-chip filter + the outstanding-work ledger's non-verified scan.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_session_compliance_tenant_verdict
            ON coord.session_compliance (tenant_id, verdict)
        """
    )


def downgrade() -> None:
    """Drop coord.session_compliance."""
    op.execute("DROP INDEX IF EXISTS coord.idx_session_compliance_tenant_verdict")
    op.execute("DROP INDEX IF EXISTS coord.idx_session_compliance_tenant_checked")
    op.execute("DROP TABLE IF EXISTS coord.session_compliance")
