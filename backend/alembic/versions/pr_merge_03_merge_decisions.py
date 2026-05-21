"""pr_merge phase 4 — merge_decisions audit table

Revision ID: pr_merge_03_merge_decisions
Revises: pr_merge_02_tenant_settings
Create Date: 2026-05-21

Phase 4 D4.6 of the PR Merge Orchestrator
(``D:/qontinui-root/plans/2026-05-21-pr-merge-orchestrator-design.md``).

Creates ``coord.merge_decisions`` — the append-only audit table that
records every merge-related decision the system makes, whether from the
specialist subagent, an operator escalation response, or an automated
system action. Phase 4 only writes ``decided_by='specialist'`` rows; the
``operator`` provenance fills in Phase 6 D6.5 and ``system`` covers the
auto-route paths (confidence-below-floor → escalate, uncited → escalate)
the executor (D4.4) generates on the specialist's behalf.

The table is the single source of truth for the §4 Phase 4 ship
criterion ("≥95% match to operator-labeled correct action on holdout
fixtures") — the regression test suite reads `expected.json` payloads
and the specialist subagent emits rows in this same shape via the
``MERGE_DECISION`` JSON line that the executor parses.

Columns:

* ``decision_id``         — UUID PK, `gen_random_uuid()` default.
* ``tenant_id``           — UUID FK to ``coord.tenants``. Every
                            decision is tenant-scoped; cross-tenant
                            queries always carry ``WHERE tenant_id = $1``.
* ``repo``                — TEXT, owner/name form (e.g.
                            ``qontinui/qontinui-coord``).
* ``pr_number``           — INTEGER, GitHub PR number.
* ``decided_at``          — TIMESTAMPTZ, server now() at INSERT.
* ``decided_by``          — TEXT enum:
                            ``specialist | operator | system``.
                            Enforced by CHECK; coord refuses to insert
                            anything else.
* ``action``              — TEXT enum:
                            ``merge | wait | rebase | reject | escalate_operator``.
                            CHECK-enforced; matches the §3.4
                            ``MERGE_DECISION.action`` field.
* ``merge_strategy``      — TEXT enum, NULL except when ``action='merge'``:
                            ``squash | rebase | merge``. CHECK-enforced.
* ``rationale``           — TEXT, free-form explanation. Required
                            (NOT NULL). The specialist always emits
                            text here; system rows carry the auto-
                            route reason ("confidence 0.72 below tenant
                            floor 0.85").
* ``rule_citations``      — TEXT[], rule names from §2.3's rulebook.
                            ``[]`` is permitted but auto-escalates on
                            the specialist path per
                            ``feedback_explicit_instruction_over_convenient_interpretation``.
* ``confidence``          — REAL nullable. The specialist's self-rated
                            confidence; operator and system rows leave
                            NULL.
* ``rulebook_version``    — TEXT nullable. The base rulebook version
                            (``v1`` initially) the specialist saw at
                            decision time. NULL for operator and system
                            rows.
* ``rulebook_overrides_hash`` — TEXT nullable. SHA-256 of the tenant's
                            ``rulebook_overrides`` JSONB at the moment
                            the decision was rendered. Lets the drift
                            loop (Phase 8) bucket decisions by override
                            version without ambiguity even after the
                            tenant edits their overrides.
* ``payload``             — JSONB, full original ``MERGE_DECISION`` JSON
                            (or the operator's response payload), with
                            ``preconditions_verified``, ``next_check_at``,
                            ``operator_question`` and any future fields.
                            Defaults to ``{}::jsonb`` so the column is
                            always queryable.

Indexes:

* ``(tenant_id, decided_at DESC)`` — per-tenant most-recent feed (the
                                     dashboard's history view).
* ``(repo, pr_number, decided_at DESC)`` — per-PR chronological view
                                            (the audit-trail for a
                                            single PR).
* ``(decided_by, decided_at DESC)`` — operator-override-rate calc and
                                       Phase 8 drift watcher inputs.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT
EXISTS``. Re-running against an already-applied DB is a no-op. Mirrors
the posture of every other Phase 1+2 migration.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_merge_03_merge_decisions"
down_revision: str = "pr_merge_02_tenant_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.merge_decisions + the three lookup indexes."""

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.merge_decisions (
            decision_id              UUID         PRIMARY KEY
                                                  DEFAULT gen_random_uuid(),
            tenant_id                UUID         NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            repo                     TEXT         NOT NULL,
            pr_number                INTEGER      NOT NULL,
            decided_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
            decided_by               TEXT         NOT NULL,
            action                   TEXT         NOT NULL,
            merge_strategy           TEXT,
            rationale                TEXT         NOT NULL,
            rule_citations           TEXT[]       NOT NULL DEFAULT '{}'::text[],
            confidence               REAL,
            rulebook_version         TEXT,
            rulebook_overrides_hash  TEXT,
            payload                  JSONB        NOT NULL DEFAULT '{}'::jsonb,
            CONSTRAINT merge_decisions_decided_by_check
                CHECK (decided_by IN ('specialist', 'operator', 'system')),
            CONSTRAINT merge_decisions_action_check
                CHECK (action IN ('merge', 'wait', 'rebase', 'reject', 'escalate_operator')),
            CONSTRAINT merge_decisions_merge_strategy_check
                CHECK (merge_strategy IS NULL
                       OR merge_strategy IN ('squash', 'rebase', 'merge'))
        )
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_merge_decisions_tenant_recent
            ON coord.merge_decisions (tenant_id, decided_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_merge_decisions_pr_recent
            ON coord.merge_decisions (repo, pr_number, decided_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_merge_decisions_provenance
            ON coord.merge_decisions (decided_by, decided_at DESC)
        """
    )


def downgrade() -> None:
    """Drop the table + its indexes.

    No data preservation. The specialist regenerates decisions on the
    next escalation; operator decisions are also captured in
    ``coord.alerts`` (kind=``merge_escalation``) which survives.
    """
    op.execute("DROP INDEX IF EXISTS coord.idx_merge_decisions_provenance")
    op.execute("DROP INDEX IF EXISTS coord.idx_merge_decisions_pr_recent")
    op.execute("DROP INDEX IF EXISTS coord.idx_merge_decisions_tenant_recent")
    op.execute("DROP TABLE IF EXISTS coord.merge_decisions")
