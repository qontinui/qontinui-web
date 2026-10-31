"""coord.account_usage_samples + coord.launch_ledger — the launch-budget record

Revision ID: launch_budget_01
Revises: overview_05_cost_ledger
Create Date: 2026-10-31

Phase 1 of plan
``2026-10-29-launch-budget-is-a-coord-answer-not-a-per-box-script``.

Two new, empty tables. They let coord answer "can this account afford another
agent run, and if not here, where?" for every launcher in the fleet. Today the
per-box helper ``qontinui-claude-config/scripts/sweep-token-budget.py`` answers
that from a file on one box.

## coord.account_usage_samples — usage HISTORY, beside the latest snapshot

``coord.claude_account_usage`` (``coord_claude_acct_usage_01``) holds ONE row
per ``(tenant_id, device_id, account_label)``, upserted on every runner report,
so it only ever knows the latest reading. A cost rate (usage rise per agent-hour)
needs the rise BETWEEN readings. This table is the append-only series of the
same feed. coord's existing ``POST /coord/claude-accounts/usage`` ingest appends
one row per reported account (plan Phase 3); no new route writes here. The
snapshot table is left exactly as it is.

* ``session_pct`` / ``weekly_pct`` are PERCENT (the runner wire sends
  fractions; the ingest multiplies by 100), nullable. A NULL is UNKNOWN (not
  reported, or the probe failed), never 0.
* A failed probe is still a row: ``error = true`` with every figure NULL. It is
  not a reading, but its ``status`` (a provider ``rejected``) is the
  ``provider_rejected`` HOLD signal, exactly as the shipped helper keeps it. This mirrors ``coord.prepaid_balances`` and avoids the
  ``NOT NULL DEFAULT 0`` defect that ``coord_prepaid_balances_01`` documents for
  ``claude_account_usage.weekly_utilization``.
* ``model_limits`` keeps the per-model weekly caps verbatim (the shipped helper's
  ``model_budget`` HOLD reads them). It is pinned to a JSON array. Each entry's
  ``utilization`` stays a FRACTION as the runner sent it; only the two top-level
  figures are converted.
* ``account_hash`` is the cross-device account identity introduced by
  ``coord_claude_acct_usage_04`` (SHA-256 of ``oauthAccount.accountUuid``).
  NULL means none was readable. Two NULL rows are never the same account, so the
  per-device ``(device_id, account_label)`` index is the fallback key.
* Retention is 31 days (the raw window of ``coord.session_runs``). It is
  enforced by a coord sweep (plan Phase 3), so ``sampled_at`` is indexed alone
  for it.

## coord.launch_ledger — the agent runs in flight, fleet-wide

One row per agent run a launcher starts against an account: a
``/vet-imp-sweep`` subagent, an ``/autopilot`` agent, a coord continuation.
These are NOT sessions. A sweep's subagents run inside one Claude session, so
``coord.session_runs`` cannot see them. That is why the ledger is its own
table rather than a view over session runs.

* ``pending`` marks a booked resume (the helper's ``launch --pending``).
  ``launched_at`` is then the booked start, which may be in the future.
* ``coord_session_id`` is the launching coord session. When coord reaps that
  session, it closes the session's open rows ``status = 'orphaned'``. That
  replaces a guessed stale-hours timeout with an observed end.
* ``status`` / ``work_type`` / ``launcher`` carry no CHECK. Their vocabularies
  are validated by coord at ingest, as ``coord.session_runs.work_type`` is.
* There is no token column, deliberately. The decision reads percent, and
  per-task cost accounting is out of scope under served policy
  ``production-and-cost`` ``spawn-routing-reads-account-budget``.

## Head choice

``down_revision`` is the repo's single alembic head on ``origin/main`` at
authoring time (``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``,
``HEAD=overview_05_cost_ledger``, 2026-10-31). coord re-points it at land time
if a sibling lands first.

## Two-repo ordering — this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``). The coord build that reads
and writes these tables is plan Phase 3. It is held behind this migration
landing, and it is table-tolerant: it degrades to ``recorded: false`` on a
missing table, as ``claude_account_usage.rs`` already does.

## Safety

Additive: two ``CREATE TABLE IF NOT EXISTS`` on new names, with indexes on the
tables this file creates and ``COMMENT ON``. No existing table is touched, so
there is no lock on a hot table and nothing to backfill. ``downgrade`` drops
only what ``upgrade`` created.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "launch_budget_01"
down_revision: str | Sequence[str] | None = "overview_05_cost_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create both tables, their indexes, and document them. No rows."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.account_usage_samples (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id          UUID NOT NULL,
            device_id          UUID NOT NULL,
            account_label      TEXT NOT NULL,
            account_hash       TEXT NULL,
            sampled_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            session_pct        DOUBLE PRECISION NULL,
            session_resets_at  TIMESTAMPTZ NULL,
            weekly_pct         DOUBLE PRECISION NULL,
            weekly_resets_at   TIMESTAMPTZ NULL,
            model_limits       JSONB NOT NULL DEFAULT '[]'::jsonb,
            status             TEXT NULL,
            exhausted          BOOLEAN NULL,
            error              BOOLEAN NOT NULL DEFAULT false,
            source             TEXT NULL,
            CONSTRAINT ck_account_usage_samples_session_pct_nonneg
                CHECK (session_pct IS NULL OR session_pct >= 0),
            CONSTRAINT ck_account_usage_samples_weekly_pct_nonneg
                CHECK (weekly_pct IS NULL OR weekly_pct >= 0),
            CONSTRAINT ck_account_usage_samples_model_limits_array
                CHECK (jsonb_typeof(model_limits) = 'array')
        )
        """
    )
    # The cross-device series for one account (the decision's main read).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_account_usage_samples_tenant_hash_sampled
            ON coord.account_usage_samples (tenant_id, account_hash, sampled_at DESC)
            WHERE account_hash IS NOT NULL
        """
    )
    # The per-device fallback series, for rows with no readable account_hash.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_account_usage_samples_device_label_sampled
            ON coord.account_usage_samples
               (tenant_id, device_id, account_label, sampled_at DESC)
        """
    )
    # The 31-day retention sweep.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_account_usage_samples_sampled
            ON coord.account_usage_samples (sampled_at)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.launch_ledger (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id         UUID NOT NULL,
            device_id         UUID NULL,
            account_label     TEXT NOT NULL,
            account_hash      TEXT NULL,
            launcher          TEXT NOT NULL,
            label             TEXT NOT NULL,
            work_type         TEXT NOT NULL DEFAULT 'unknown',
            coord_session_id  UUID NULL,
            pending           BOOLEAN NOT NULL DEFAULT false,
            launched_at       TIMESTAMPTZ NOT NULL,
            finished_at       TIMESTAMPTZ NULL,
            status            TEXT NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_launch_ledger_status_only_when_finished
                CHECK (status IS NULL OR finished_at IS NOT NULL),
            CONSTRAINT ck_launch_ledger_label_nonblank
                CHECK (btrim(label) <> ''),
            CONSTRAINT ck_launch_ledger_launcher_nonblank
                CHECK (btrim(launcher) <> '')
        )
        """
    )
    # Runs in flight on one account (the decision's in-flight read).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_launch_ledger_open
            ON coord.launch_ledger (tenant_id, account_hash, device_id, account_label)
            WHERE finished_at IS NULL
        """
    )
    # Learned run durations by work type.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_launch_ledger_work_type_launched
            ON coord.launch_ledger (tenant_id, work_type, launched_at)
        """
    )
    # Orphan closure when the launching coord session is reaped.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_launch_ledger_open_session
            ON coord.launch_ledger (coord_session_id)
            WHERE finished_at IS NULL AND coord_session_id IS NOT NULL
        """
    )

    # Document both tables. Each statement is a complete static literal.
    op.execute(
        """
        COMMENT ON TABLE coord.account_usage_samples IS
            'Append-only history of per-account Claude usage readings, one row per reported account per runner report through POST /coord/claude-accounts/usage. coord.claude_account_usage holds only the latest reading per device and account; this is the series a cost rate is learned from. Kept 31 days by a coord sweep. Plan 2026-10-29-launch-budget-is-a-coord-answer-not-a-per-box-script.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.account_usage_samples.session_pct IS
            'Five-hour session window used, in PERCENT. NULL = not reported (a probe-only source carries no session figure), never zero.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.account_usage_samples.weekly_pct IS
            'Seven-day window used, in PERCENT (the runner wire sends a fraction; the ingest multiplies by 100). NULL = not reported or the probe failed, never zero.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.account_usage_samples.error IS
            'true = the probe failed: every figure is NULL and the row is not a reading, but its status (e.g. rejected) still holds launches.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.account_usage_samples.account_hash IS
            'Opaque cross-device account identity (lowercase hex SHA-256 of oauthAccount.accountUuid), as coord.claude_account_usage.account_hash. NULL = no identity readable; two NULL rows are never the same account.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.account_usage_samples.model_limits IS
            'Per-model weekly caps as the runner reported them: an array of {model, utilization, resets_at}, utilization a FRACTION as reported. Read by the model_budget HOLD.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.launch_ledger IS
            'One row per agent run a launcher started against an account (a sweep subagent, an autopilot agent, a coord continuation). These are not sessions, so coord.session_runs cannot see them. Open rows are the in-flight runs every launcher on the account shares. Plan 2026-10-29-launch-budget-is-a-coord-answer-not-a-per-box-script.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.launch_ledger.pending IS
            'true = a booked resume (launch --pending): launched_at is the booked start, which may be in the future, and the row holds a slot around it without entering rate learning.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.launch_ledger.coord_session_id IS
            'The coord session that launched the run. When coord reaps it, the session''s open rows are closed with status orphaned. NULL = not known, so only the stale-hours backstop closes the row.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.launch_ledger.status IS
            'The finish verdict as the launcher reported it, or orphaned. NULL while the run is open. No CHECK: the vocabulary is validated by coord at ingest.'
        """
    )


def downgrade() -> None:
    """Drop both tables; their indexes and constraints go with them."""
    op.execute("DROP TABLE IF EXISTS coord.launch_ledger")
    op.execute("DROP TABLE IF EXISTS coord.account_usage_samples")
