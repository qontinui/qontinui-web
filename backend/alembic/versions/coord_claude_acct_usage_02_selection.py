"""coord.claude_account_usage — which account rotation PICKED, and by what rule

Revision ID: coord_claude_acct_usage_02
Revises: coord_pr_author_nudges_02
Create Date: 2026-08-25

Phase 2 of plan
``2026-08-25-general-purpose-session-spawn-machine-account-prompt``.

Adds two nullable columns to ``coord.claude_account_usage`` (the table created
by ``coord_claude_acct_usage_01_account_usage``):

* ``is_active BOOLEAN`` — whether THIS account is the one the runner's
  rotation actually picked on that device right now. Sourced from the
  runner-side ``AccountInfo.is_active`` that
  ``ai_provider::get_account_statuses()`` already computes in-process; it has
  simply never crossed the wire.
* ``account_selection_mode TEXT`` — the device's machine-global
  ``AccountSelectionMode`` from ``claude-accounts.json``: ``manual`` or
  ``least_usage`` (the ``#[default]``).

## Why

The spawn modal is to tell the operator *"this machine will use: <mode>"*
over that device's account list. Utilization alone cannot answer it: the feed
records how used each account is, not which one is next nor by what rule. The
mode is the rule; ``is_active`` is the current answer.

## Why on THIS table and not a new one

The per-device account feed already ships end to end — the runner's
``report_to_coord`` (``commands/ai_settings.rs``) device-auth-POSTs a snapshot
to ``POST /coord/claude-accounts/usage`` on the ~10-minute usage refresh, one
row per ``(tenant_id, device_id, account_label)``, read back with a computed
``stale`` flag. A second table (or folding the roster into
``fleet::publish_budget``, as the plan first proposed) would give the same
machine-global fact two writers, two refresh cadences and two staleness
models. Extending the shipped feed keeps one channel and one staleness model.

## Nullable, no default, no backfill (deliberate)

``account_selection_mode`` is per-DEVICE while a row is per-ACCOUNT, so it is
denormalized across that device's rows — every row a given runner writes in one
report carries the same value. That is intentional: the ingest is a whole-roster
upsert, so the values move together, and it avoids a second table for a
single scalar.

Both columns are NULL for every row written by a runner build that predates the
report-body change. NULL therefore means **"this device's build has not
reported it yet"** — UNKNOWN, not ``false`` and not ``least_usage``. Consumers
must render it as unknown rather than defaulting: telling the operator "this
machine will use least_usage" on the strength of a NULL would be inventing a
fact about a machine we have not heard from. A ``NOT NULL DEFAULT`` would have
destroyed exactly that distinction, which is why neither column has one.

The coord read route reports whether these columns exist at all
(``columns_provisioned``) so a coord deployed ahead of this migration degrades
to an honest unknown rather than a silent empty roster.

## Two-repo ordering — this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors ZERO ``coord.*`` DDL (guarded by
``qontinui-coord/tests/coord_schema_authorship.rs``). The coord change that
READS these columns is downstream of this one, so this migration must be
applied in production BEFORE that coord binary ships.

## Safety

Two nullable ``ADD COLUMN``s with no default are metadata-only on PG >= 11 (no
table rewrite); the table holds one row per (tenant, device, account) and is
tiny regardless. Each add is guarded on the column's absence so a partial apply
re-runs cleanly.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_claude_acct_usage_02"
down_revision: str | Sequence[str] | None = "coord_pr_author_nudges_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "claude_account_usage"
_SCHEMA = "coord"


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns(_TABLE, schema=_SCHEMA)}


def upgrade() -> None:
    existing = _existing_columns()
    if "is_active" not in existing:
        op.add_column(
            _TABLE,
            sa.Column("is_active", sa.Boolean(), nullable=True),
            schema=_SCHEMA,
        )
    if "account_selection_mode" not in existing:
        op.add_column(
            _TABLE,
            sa.Column("account_selection_mode", sa.Text(), nullable=True),
            schema=_SCHEMA,
        )


def downgrade() -> None:
    existing = _existing_columns()
    if "account_selection_mode" in existing:
        op.drop_column(_TABLE, "account_selection_mode", schema=_SCHEMA)
    if "is_active" in existing:
        op.drop_column(_TABLE, "is_active", schema=_SCHEMA)
