"""coord.prepaid_balances — per-device prepaid (pay-as-you-go) credit balances

Revision ID: coord_prepaid_balances_01
Revises: policy_rules_tombstone_01
Create Date: 2026-09-12

Phase 1 of plan
``2026-09-12-prepaid-balance-is-a-fleet-fact-with-no-ingest``.

Creates ``coord.prepaid_balances``: one row per
``(tenant_id, device_id, provider)``, holding the remaining money balance a
prepaid AI provider (DeepSeek today) reports for that machine.

## Why this exists

Prepaid balance was the only account surface on qontinui-mobile's dashboard
with **no ingest at all** — the phone read it from the attached runner's
``/analytics/prepaid-balance`` and nowhere else, so one machine being powered
off blanked the Credit Balance card with ``Unable to load balance`` while the
number itself was a fleet-wide fact about money on the account. Every sibling
card had already moved onto ``readFromFleet``
(``qontinui-mobile/src/api/fleetRead.ts``); this one could not, because there
was no second door to race. This table is that door's storage.

## Why a NEW table, and not two columns on coord.claude_account_usage

``qontinui-mobile/docs/fleet-reads.md`` §R4 proposed extending
``coord.claude_account_usage``, on the reasoning that it "is already keyed
``(tenant, device, account_label)``, which is exactly the grain of a balance".
That premise is wrong, and following it would have damaged a shipped read
surface. Three reasons:

1. **Different identity space.** A prepaid balance is keyed by *provider*
   (``deepseek``). ``account_label`` is defined by coord's own wire contract as
   the "config-dir basename (e.g. ``.claude-gmail``) — never a full local
   path", i.e. a **Claude** account. Reusing the table would put two unrelated
   identity spaces under one ``uq_claude_account_usage_identity``.
2. **It would have to store a 0% that is not a reading.**
   ``coord_claude_acct_usage_01`` declares
   ``weekly_utilization DOUBLE PRECISION NOT NULL DEFAULT 0``. A prepaid row
   has no weekly utilization, so every one would carry a literal ``0`` —
   re-introducing precisely the defect qontinui-mobile removed in ``e7eb463``
   ("a fleet row nobody has probed is not an account at 0%") and ``4234fd6``
   ("stop rendering failed account probes as real usage numbers").
3. **Existing consumers would silently mis-render it.** Every reader of
   ``GET /api/v1/operations/claude-accounts`` — the spawn modal, mobile's
   Account Usage card, ``coordRosterToAccountUsage`` — would begin receiving a
   ``deepseek`` row as a Claude account sitting at 0% weekly.

The runner's own module says the same thing in one line: prepaid is "a
fundamentally different shape" from subscription accounts
(``src-tauri/src/ai_provider/prepaid_balance.rs``). The spec's only argument
for reuse was inheriting that table's ``UPSERT_WIDE``/``UPSERT_LEGACY``
column-tolerance dance — but that machinery exists to *add columns to an
existing table*. A new table needs only an existence check, which is strictly
simpler.

What the plan DOES keep from §R4 is its transport advice: no second reporter.
The runner's existing ``report_to_coord`` gains an optional ``prepaid`` array
in the body it already POSTs to ``/coord/claude-accounts/usage``, and coord's
existing read of that feed grows a ``prepaid`` key. One cadence, one credential
path, one staleness model — the same argument ``coord_claude_acct_usage_02``
made against giving a machine-global fact two writers.

## The producer cannot emit NULL yet — Phase 3 must make it able to

⚠️ These nullable columns are a contract the **runner does not yet satisfy**,
and writing them without saying so would leave the distinction above
decorative. As of this revision
``qontinui-runner/src-tauri/src/ai_provider/prepaid_balance.rs`` declares
``PrepaidBalanceInfo``'s money fields as bare ``f64``/``String``, not
``Option<_>``, so ``#[derive(Serialize)]`` can only ever emit ``0.0`` and
``""`` — never ``null``. Its own doc comment says the error path leaves "the
numeric fields as best-effort zeros".

For the error path that is survivable, because ``error IS NOT NULL`` marks the
row. **One path is not**: ``parse_amount`` (``prepaid_balance.rs``) falls back
to ``unwrap_or(0.0)`` on a missing or unparseable amount and returns with
``error: None``, which lands here as ``balance_micros = 0, error = NULL`` —
i.e. exactly the "you are out of credit" reading this file defines. A false
alarm about money, and the same absence-is-not-zero defect that
``e7eb463``/``4234fd6`` removed from the mobile card.

So Phase 3 of the plan owes three things, not one:

1. ``Option<f64>`` on the struct's money fields (and ``Option<String>`` for
   ``currency``), with ``parse_amount`` returning ``Option`` rather than
   defaulting to ``0.0``;
2. conversion to micros **from the provider's decimal string**, not through
   ``f64`` — DeepSeek reports ``"19.28"`` as text, and a truncating
   ``(x * 1e6) as i64`` is the classic way to lose a cent. Today's 2-dp values
   happen to round-trip exactly, so this is latent rather than live;
3. ``updated_at = now()`` in the ``DO UPDATE SET`` of coord's Phase-2 upsert —
   the column has a ``DEFAULT now()`` and no trigger, so an upsert that omits
   it freezes every row's staleness verdict at insert time (precedent:
   ``claude_account_usage.rs``'s own upsert sets it explicitly).

Until (1) lands, every row here carries zeros rather than NULLs, and a reader
must treat ``error IS NOT NULL`` as the only trustworthy "not a reading"
signal.

## No `source` column, unlike the sibling

``coord.claude_account_usage`` carries ``source TEXT`` naming which probe
produced a reading. This table deliberately omits it: prepaid has exactly one
producer (the runner's own provider probe) and no second path is planned, so a
column that would hold one constant value everywhere is noise. Stated
explicitly because this file's method is otherwise to mirror that sibling — the
omission is a decision, not an oversight.

## Money is BIGINT micros, not DOUBLE PRECISION

The runner's ``PrepaidBalanceInfo`` carries ``f64`` for every money field.
Binary floating point is the wrong type for currency and a schema boundary is
the right place to stop it, so the three money columns are ``BIGINT`` micros
(1e-6 of one unit of ``currency``). That holds DeepSeek's cent-precision
balances exactly, leaves ~9.2e12 units of headroom, and makes summing across
devices exact. The runner converts at the wire boundary.

## Every measured column is NULLABLE, with no default (deliberate)

``NULL`` means **"not reported"** — either this device's runner build predates
the report-body change, or its probe errored and the numbers are genuinely
unknown. It never means zero. A prepaid balance of ``0`` is a real and
alarming reading ("you are out of credit"); conflating it with "we have not
heard" is the same absence-is-not-zero error as item 2 above, and a
``NOT NULL DEFAULT 0`` would have destroyed the distinction at the only layer
that can preserve it. Consumers must render ``NULL`` as unknown.

``error`` carries the provider's own message when the probe failed, and is
``NULL`` on success — so ``error IS NOT NULL`` is the "this row's numbers are
not a reading" predicate, and no boolean flag can drift out of sync with it.

## Two-repo ordering — this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors zero ``coord.*`` DDL (guarded by
``qontinui-coord/tests/coord_schema_authorship.rs``). The coord change that
writes and reads this table is downstream, so this migration must be applied
in production BEFORE that coord binary ships — otherwise coord reads a table
that does not exist (the 2026-07-13 missing-column incident). Coord's ingest
and read both degrade on PG ``42P01 undefined_table`` to
``prepaid_table_provisioned: false`` rather than 5xx, so the intermediate state
is an honest unknown rather than an outage.

## Head choice

``down_revision`` is ``policy_rules_tombstone_01``, which was the repo's
**single** head at authoring time. This repo keeps strict single-head
discipline — ``scripts/ci/count_alembic_heads.py`` gates it, and the
surrounding history is full of "repoint onto the single head after rebase"
commits — so this revision is a linear append and the count stays 1. If a
rebase moves main underneath it, repoint ``down_revision`` at the new single
head rather than leaving a fork.

## Safety

``CREATE TABLE IF NOT EXISTS`` plus guarded index creation, so a partial apply
re-runs cleanly. No table is rewritten and no existing table is touched.
``downgrade()`` uses ``DROP TABLE IF EXISTS`` — the house convention named by
``coord_claude_acct_usage_01``, and the one that keeps both directions pure
``op.execute`` and therefore usable under ``alembic ... --sql`` offline mode,
where ``op.get_bind()`` has no connection.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_prepaid_balances_01"
down_revision: str | Sequence[str] | None = "policy_rules_tombstone_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.prepaid_balances."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.prepaid_balances (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id           UUID NOT NULL,
            device_id           UUID NOT NULL,
            provider            TEXT NOT NULL,
            label               TEXT,
            currency            TEXT,
            balance_micros      BIGINT,
            granted_micros      BIGINT,
            topped_up_micros    BIGINT,
            is_available        BOOLEAN,
            error               TEXT,
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_prepaid_balances_identity
                UNIQUE (tenant_id, device_id, provider)
        )
        """
    )
    # Mirrors ix_claude_account_usage_tenant_updated: every read is
    # tenant-scoped and freshness-ordered, and the staleness verdict is
    # computed from updated_at.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_prepaid_balances_tenant_updated
            ON coord.prepaid_balances (tenant_id, updated_at DESC)
        """
    )


def downgrade() -> None:
    # The index goes with the table; no separate DROP INDEX is needed or wanted.
    op.execute("DROP TABLE IF EXISTS coord.prepaid_balances")
