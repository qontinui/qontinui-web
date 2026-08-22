"""coord.pr_author_nudges.failure_signature — CI-red nudge dedup on failure identity

Revision ID: coord_pr_author_nudges_02
Revises: coord_obs_idx_01
Create Date: 2026-08-22

Phase 3 of plan
``2026-08-20-ci-nudge-dedup-and-inbound-injection-sanitization``.

Adds ``failure_signature TEXT`` (nullable, no default) to
``coord.pr_author_nudges`` — the table created by
``coord_pr_author_nudges_01_create_table``.

## What it stores

A hash of the *identity of the CI failure* that produced the nudge:
``(repo, pr_number, head_sha, the sorted failing (check name, conclusion)
pairs)``. coord's Rust side is the authority for the exact hashing shape
(``pr_merge/engine.rs``; it mirrors ``compute_scope_fingerprint``'s blake3
precedent); this column merely persists the resulting string.

## Why a column and NOT part of the primary key

The table's primary key stays ``(repo, pr_number, reason)`` — deliberately
unchanged by this migration. Today's CI-red nudge de-noises on a *state edge*
(``prev != Some(outer)``), so a PR that oscillates ``BLOCKED ->
CI_RED_TRIAGE -> BLOCKED`` re-notifies with the identical failing checks. The
fix is to key the dedup on the failure's identity instead.

Putting the signature **in the primary key** would give every distinct
signature its own row and therefore its own ``nudge_count`` cap of 3 — i.e.
unbounded nudging on a flapping PR, which is the opposite of a dedup ledger.
Keeping it a plain column means one row per ``(repo, pr_number, reason)``
holding the **last-seen** signature: a repeat of the same signature is
suppressed by the existing cooldown/cap, and a genuinely NEW signature resets
``nudge_count`` to 1 so the cap of 3 is per-failure rather than a lifetime cap.

The accepted consequence of *last-seen* (stated so it is a choice, not a
surprise): an ``A -> B -> A`` oscillation re-notifies on the third transition.
That is over-notification, which the plan's Risk 1 explicitly prefers over
over-suppression.

## Nullable, no default, no backfill (deliberate)

Existing rows predate any signature and there is nothing to derive one from —
the failing-check set and head SHA at the time of those nudges are not
recoverable from this table. NULL therefore reads as an honest "no signature
recorded yet", which coord's consumer treats as **always eligible** (fail
OPEN). That matches today's behaviour, which is what the CI-red path must
degrade to: the sweep's ``Suppressed("schema_absent")`` posture is correct for
the leader-gated stuck-PR sweep, but reusing it on the CI-red path would mean
ZERO CI-red nudges during the migration window — total silence, the inverted
failure.

## Two-repo ordering — this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors ZERO ``coord.*`` DDL (guarded by
``qontinui-coord/tests/coord_schema_authorship.rs``). The coord PR that WRITES
and READS ``failure_signature`` is downstream of this one, so **this migration
must be applied in production BEFORE that coord binary ships**. Do not be
misled by ``pr_merge/stuck_author_nudge.rs``'s stale "coord-self-created table"
doc comment — the ``CREATE TABLE IF NOT EXISTS`` beside it is
``#[cfg(test)]``-only self-provisioning; the production table is this chain's.

## Safety

A single ``ADD COLUMN`` that is nullable with no default is a metadata-only
operation on PG >= 11 (no table rewrite); the table is small regardless. The
upgrade is guarded on the column's absence, mirroring the ``has_table`` guard
in ``coord_pr_author_nudges_01_create_table``, so a partial apply re-runs
cleanly.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pr_author_nudges_02"
down_revision: str | Sequence[str] | None = "coord_obs_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_failure_signature() -> bool:
    columns = sa.inspect(op.get_bind()).get_columns("pr_author_nudges", schema="coord")
    return any(column["name"] == "failure_signature" for column in columns)


def upgrade() -> None:
    # Idempotent: skip if a prior partial apply already added the column.
    if _has_failure_signature():
        return
    op.add_column(
        "pr_author_nudges",
        sa.Column("failure_signature", sa.Text(), nullable=True),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("pr_author_nudges", "failure_signature", schema="coord")
