"""coord.gates — continuation_spawn_attempts, the bounded spawn-retry counter

Revision ID: contspawn_01_gates_continuation_spawn_attempts
Revises: plan_library_07_plan_difficulty
Create Date: 2026-09-20

Phase 3's PRECONDITION (web slice) of plan
``2026-09-17-a-gate-continuation-delivered-before-the-runner-finishes-booting-is-consumed-as-spawn-failed-and-never-retried``.
Authored by alembic in ``qontinui-web`` — coord authors zero ``coord.*`` DDL
(served policy ``production-and-cost`` ``alembic-sole-authorship``).

## What this is for

A gate continuation is CLAIMED before it is spawned, and a claimed continuation
that then fails to spawn is gone: ``continuation_stall_watcher`` re-dispatches
only rows with ``continuation_consumed_at IS NULL``, ``gate_doctor`` treats
``spawn_failed`` as an honest recorded failure rather than rot, and no code path
anywhere writes ``continuation_consumed_at = NULL``. Measured 2026-09-17 on this
tenant: 202 of the newest 3,100 gates hold a ``spawn_failed`` continuation, ~186
of them a boot-race (``no Tauri AppHandle``/``SessionRegistry state not
managed``) that would have succeeded on a retry.

Plan Phase 3 gives coord a bounded, backed-off re-drive of the RETRIABLE
``spawn_failed`` family. A re-drive needs somewhere durable to count attempts,
or it is an unbounded retry loop:

- ``continuation_spawn_attempts INTEGER NOT NULL DEFAULT 0`` — how many times
  coord has re-driven this continuation after a retriable ``spawn_failed``.
  The Phase 3 scan selects on ``continuation_spawn_attempts < 3`` and its live
  arm increments this in the same statement that NULLs the consume marker, so
  the bound holds even if the re-drive races itself. ``0`` (the default, and the
  value every existing row backfills to) means "never re-driven", which is the
  correct reading for all 6,691 existing gates.

## Why NOT NULL DEFAULT 0 rather than a nullable column

The column is a COUNTER read by a ``<`` comparison in the retry predicate. A
NULL would make ``continuation_spawn_attempts < 3`` evaluate NULL — i.e. the row
silently drops out of the scan — so a nullable column would make "never
re-driven" and "not eligible" indistinguishable, which is the exact
absence-is-not-zero failure the plan exists to fix. ``NOT NULL DEFAULT 0`` makes
the backfilled value MEAN something. This mirrors its nearest sibling,
``continuation_deferred_count INTEGER NOT NULL DEFAULT 0``
(``contstall_01_gates_continuation_expiry``), which counts the same kind of
thing on the non-consuming path.

On PostgreSQL 11+ an ``ADD COLUMN ... NOT NULL DEFAULT <constant>`` does not
rewrite the table — the default is stored in the catalog and materialised on
read — so this is a metadata-only change on ``coord.gates`` at its present size.

## NO index change

The Phase 3 scan is anchored on ``continuation_consumed_outcome`` being in the
``spawn_failed`` family and on ``continuation_consumed_at`` age; this counter is
a further AND-term applied to the handful of rows those already prune to. Adding
an index on a low-cardinality integer that is never the leading predicate would
cost writes on every continuation lifecycle stamp and buy nothing. Same posture
as ``contstall_01``'s deferred columns.

## House conventions followed

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — mirrors
``contstall_01_gates_continuation_expiry`` and
``contcancel_01_gates_continuation_cancel_outcome`` exactly (collision-safe and
order-safe against the separate coord consumer PR). Touches only ``coord.*``,
and every statement carries its schema explicitly, which is what the
``alembic-schema-arg-gate`` pre-commit hook
(``.pre-commit-hooks/check_alembic_schema_args.py``, ``files:
^backend/alembic/versions/.*\\.py$``) audits for raw ``op.execute`` SQL — it
requires every ``CREATE``/``ALTER``/``DROP TABLE``, ``REFERENCES`` and
``INDEX ON`` to name an allowed schema. Note it is NOT ``forbid-public-schema``
that covers this file: that check's ``EXCLUDE_PATHSPECS``
(``scripts/ci/check_forbidden_public_schema.py``) contains
``":!backend/alembic/versions/*"`` and so never sees this directory at all.
Recorded because an author trusting the wrong gate name would believe CI
catches an unqualified identifier here on a lane that never runs.

## A property of the ``IF NOT EXISTS`` idiom the Phase 3 author must know

``ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT 0`` is idempotent in the column's
EXISTENCE only, not in its CONSTRAINTS. If the column somehow already exists in
another shape — nullable, from a partially-applied run or a hand-made mirror —
this statement silently no-ops and the ``NOT NULL DEFAULT 0`` is never applied,
leaving NULLs reachable and defeating the whole argument above. That is a
pre-existing property of the house idiom (``contstall_01`` carries it identically
for ``continuation_deferred_count``), so it is deliberately NOT worked around
here — diverging would break the mirroring this file is meant to preserve. The
consequence belongs to the coord side: Phase 3 should treat this column's
``NOT NULL`` as an assumption to ASSERT at boot rather than to trust, in the same
place ``require_table`` asserts the tables.

The coord side reads this column only AFTER this migration is live — the "web
migration FIRST" rule in served policy ``production-and-cost``
``alembic-sole-authorship``, which exists because coord and qontinui-web deploy
independently and a missing COLUMN (unlike a missing table, which ``require_table``
catches at boot) sails through boot and fails at query time.

Chains off the current single head ``plan_library_07_plan_difficulty`` (computed
from ``origin/main`` 2026-09-20: exactly one head across 577 revisions). coord
re-points ``down_revision`` at land time if the head moves — no head reservation
or stacked-on label needed.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "contspawn_01_gates_continuation_spawn_attempts"
down_revision: str | Sequence[str] | None = "plan_library_07_plan_difficulty"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the bounded spawn-retry counter to coord.gates."""
    # How many times coord has re-driven this continuation after a RETRIABLE
    # spawn_failed. NOT NULL DEFAULT 0 so that the `< max_attempts` predicate in
    # the Phase 3 scan is never NULL — a nullable column would silently drop
    # never-re-driven rows out of the scan, which is the population the scan
    # exists to find.
    op.execute("""
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_spawn_attempts INTEGER
                NOT NULL DEFAULT 0
        """)


def downgrade() -> None:
    """Drop the spawn-retry counter."""
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_spawn_attempts"
    )
