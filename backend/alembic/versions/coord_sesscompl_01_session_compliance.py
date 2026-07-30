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

* ``reason`` is free-text and deliberately **not value-CHECKed**: the reason
  vocabulary (``absent``, ``unreconciled_claims``, ``enforcement_disabled``,
  ``clause_absent``, …) is expected to grow as reconciliation gets more
  signals, and a CHECK there would force a migration per new reason. It is
  NULL for a clean ``verified``.

  One structural invariant IS enforced: ``reason = 'absent'`` implies
  ``report IS NULL``. The row asserts "the session emitted no block", so it
  must not simultaneously carry a block. The guard matters because this table
  is **upserted** — a re-check of a session whose block went away, written with
  a defensive ``ON CONFLICT DO UPDATE SET report = COALESCE(EXCLUDED.report,
  session_compliance.report)``, would otherwise preserve the stale report and
  show the operator a report the session did not emit. The constraint is
  deliberately one-directional: ``report IS NULL`` does NOT imply
  ``reason = 'absent'``, because a ``not_applicable`` row (enforcement off, or
  clause absent) legitimately has no report and a different reason.

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

  **The TEXT column is CHECK-constrained to UUID shape, and that is
  load-bearing** — unlike ``session_handles.claude_session_id``, this column
  gets JOINed against genuinely-``UUID`` columns (notably
  ``coord.gates.agent_session_id``, added by ``coord_sesscompl_03``, which is
  UUID because every coord ``agent_session_id`` is). Two failure modes follow
  from an unconstrained TEXT column and the CHECK closes both:

  - A ``::text`` cast on the UUID side makes the join case- and
    whitespace-sensitive, so an uppercase or padded stored value silently
    fails to match and reports a genuinely-compliant session's ``state: gated``
    claim as unreconciled — a false ``unverified``, in exactly the check whose
    false-positive rate has to stay near zero.
  - A ``::uuid`` cast on the TEXT side raises ``22P02`` on the first
    non-UUID row, erroring the whole reconciliation query.

  With the CHECK in place every stored value is castable, so **the required
  join direction is ``gates.agent_session_id = claude_session_id::uuid``** —
  cast TEXT to UUID, never UUID to TEXT. ``::uuid`` normalizes case, so the
  match is correct regardless of how coord cased the path segment. The CHECK is
  case-insensitive (``~*``) so a well-formed uppercase id is stored rather than
  rejected: a hard insert failure on the Stop-hook path would be worse than a
  cased value the mandated cast already handles.

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
            verdict                 TEXT NOT NULL,
            reason                  TEXT,
            report                  JSONB,
            reconciliation          JSONB NOT NULL DEFAULT '{}'::jsonb,
            prompt_document_version INTEGER,
            enforced_clause_ref     TEXT,
            checked_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_session_compliance_tenant_session
                UNIQUE (tenant_id, claude_session_id),
            -- Named, because this is the set most likely to be widened
            -- later and widening needs DROP CONSTRAINT <name>.
            CONSTRAINT ck_session_compliance_verdict
                CHECK (verdict IN ('verified', 'unverified',
                                   'not_applicable')),
            -- Guarantees every value is ::uuid-castable, which is what makes
            -- the mandated join direction safe. See the module docstring.
            CONSTRAINT ck_session_compliance_claude_session_id_uuid
                CHECK (claude_session_id ~*
                       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-'
                       '[0-9a-f]{4}-[0-9a-f]{12}$'),
            -- reason='absent' asserts "no block was emitted", so the row
            -- must not also carry one. One-directional on purpose.
            CONSTRAINT ck_session_compliance_absent_has_no_report
                CHECK (reason IS DISTINCT FROM 'absent' OR report IS NULL)
        )
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.session_compliance.claude_session_id IS
            'The Claude Code session UUID (the id space keying '
            'coord.agent_sessions and every *.agent_session_id), NOT '
            'coord.sessions.id. Stored as TEXT to match '
            'coord.session_handles.claude_session_id, but CHECK-constrained '
            'to UUID shape. Canonical form is lowercase-hyphenated. Joins '
            'against a UUID column MUST cast this side: '
            'gates.agent_session_id = claude_session_id::uuid — never '
            'agent_session_id::text, which would be case-sensitive and could '
            'silently miss.'
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
