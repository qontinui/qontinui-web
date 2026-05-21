"""pr_merge phase 7 — user_overrides table

Revision ID: pr_merge_06_user_overrides
Revises: pr_merge_04_merge_heads
Create Date: 2026-05-21

Phase 7 D7.4 of the PR Merge Orchestrator
(``D:/qontinui-root/plans/2026-05-21-pr-merge-orchestrator-design.md``).

Creates ``coord.user_overrides`` — the append-only table that records
every operator escalation decision (Phase 6 D6.5) and every author
override (Phase 7 D7.4). The schema is the verbatim Phase 8 D8.4
shape; Phase 8's drift-detection watcher reads these rows to bucket
override patterns into ``coord.alerts(kind='profile_drift_suggestion')``
cards.

Per the Phase 7 spec: since Phase 8 hasn't landed yet, ship the minimal
schema sufficient for Phase 7 here. Phase 8 will reuse this table
as-is (the columns + indexes are identical to D8.4's spec). No follow-up
migration needed when Phase 8 lands — it just starts reading from this
table.

Per the Phase 7 spec re: Phase 6: Phase 6 introduces
``coord.merge_escalations_meta`` (D6.1) chained off Phase 5's head.
This migration is chained off ``pr_merge_04_merge_heads`` (Phase 4+5
merge-heads). If Phase 6 lands AFTER this revision, its migration
chains off ``pr_merge_04_merge_heads`` too and a follow-up
``*_merge_heads.py`` revision joins both heads — same pattern as
``wave_6_02_merge_heads`` / ``pr_merge_04_merge_heads``.

Columns:

* ``override_id``       — UUID PK.
* ``tenant_id``         — UUID FK to ``coord.tenants``. Every override
                          is tenant-scoped.
* ``repo``              — TEXT, owner/name form. Nullable for
                          tenant-wide overrides (e.g. raising the global
                          confidence threshold).
* ``pr_number``         — INTEGER, GitHub PR number. NULL for overrides
                          not tied to a specific PR (e.g. settings
                          changes via drift acceptance).
* ``decision_id``       — UUID, FK to ``coord.merge_decisions`` when
                          the override is in response to a specialist
                          decision. NULL for direct settings changes.
* ``override_kind``     — TEXT enum (free-form to accommodate Phase 8's
                          extensions):
                          ``author_override_retry``,
                          ``author_override_force_merge``,
                          ``author_override_ignore_block_reason``,
                          ``author_override_set_label``,
                          ``operator_escalation_approve_merge``,
                          ``operator_escalation_reject``,
                          ``operator_escalation_force_merge``,
                          ``operator_predicate_force_escalate``,
                          ``drift_suggestion_accepted`` (Phase 8).
* ``override_subject``  — TEXT, free-form bucketing key for the drift
                          watcher (e.g. ``path:.github/workflows/x``,
                          ``confidence:0.78``, ``line_budget:1200``,
                          ``block_reason:main-red``). Drift watcher
                          groups overrides by this key.
* ``decided_by``        — UUID, references either ``coord.operators.operator_id``
                          or an ``agent_id`` from ``coord.agent_worktrees``.
                          No hard FK because both sources are valid;
                          the consumer disambiguates via
                          ``override_kind`` prefix.
* ``decided_at``        — TIMESTAMPTZ, server now() default.
* ``rationale``         — TEXT, free-form. The author's / operator's
                          reason. Required for the drift watcher's
                          rationale strings.
* ``payload``           — JSONB, opaque blob carrying the original
                          override body (the ``override_kind``,
                          ``block_reason_overridden``, ``set_label``,
                          and any future fields).

Indexes:

* ``(tenant_id, decided_at DESC)`` — drift watcher's per-tenant feed.
* ``(tenant_id, override_subject)`` — drift watcher's bucket-by-subject
                                       query.
* ``(repo, pr_number, decided_at DESC)`` — per-PR override history.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT
EXISTS``. Re-running against an already-applied DB is a no-op.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_merge_06_user_overrides"
down_revision: str = "pr_merge_04_merge_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.user_overrides + the three indexes."""

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.user_overrides (
            override_id        UUID         PRIMARY KEY
                                            DEFAULT gen_random_uuid(),
            tenant_id          UUID         NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            repo               TEXT,
            pr_number          INTEGER,
            decision_id        UUID
                REFERENCES coord.merge_decisions(decision_id) ON DELETE SET NULL,
            override_kind      TEXT         NOT NULL,
            override_subject   TEXT,
            decided_by         UUID         NOT NULL,
            decided_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
            rationale          TEXT,
            payload            JSONB        NOT NULL DEFAULT '{}'::jsonb
        )
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_overrides_tenant_recent
            ON coord.user_overrides (tenant_id, decided_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_overrides_subject
            ON coord.user_overrides (tenant_id, override_subject)
            WHERE override_subject IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_overrides_pr
            ON coord.user_overrides (repo, pr_number, decided_at DESC)
            WHERE repo IS NOT NULL AND pr_number IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop the table + its indexes.

    No data preservation. The drift watcher regenerates suggestions
    from the next 30-day window of overrides; historical overrides are
    not load-bearing across a downgrade.
    """
    op.execute("DROP INDEX IF EXISTS coord.idx_user_overrides_pr")
    op.execute("DROP INDEX IF EXISTS coord.idx_user_overrides_subject")
    op.execute("DROP INDEX IF EXISTS coord.idx_user_overrides_tenant_recent")
    op.execute("DROP TABLE IF EXISTS coord.user_overrides")
