"""coord agent_logs: the deferred-load hold index also covers continuation_deferred_load

Revision ID: cfo_02_continuation_deferred_load_index
Revises: coord_topics_01
Create Date: 2026-11-20

Phase 2 of plan
``2026-11-15-gate-continuations-fail-over-off-a-device-that-refuses-them-for-load``.
coord authors zero DDL (``[policy: alembic-sole-authorship]``), so the index
its Phase 2 hold read plans on lands here first, and this revision must deploy
BEFORE the coord PR that writes and reads the new event.
Hand-authored; ``alembic revision --autogenerate`` was not run and is never
run against ``coord.*``.

Why the predicate widens
========================

``lacap_01`` built ``idx_agent_logs_deferred_load_retire_device`` on
``coord.agent_logs (device_id, occurred_at DESC)``, PARTIAL on
``event = 'spawn_deferred_load_retire'``, so coord's per-device refusal hold
reads the newest retire row without scanning the fleet-wide log.

Phase 2 makes coord's ``post_continuation_deferred`` write a second refusal
event, ``continuation_deferred_load`` (typed ``device_id`` = the verified
poster), and the capacity model's refusal hold then reads both. This is the
SHAPE the predicate must serve, not a copy of coord's query::

    SELECT ... FROM coord.agent_logs
     WHERE event IN ('spawn_deferred_load_retire', 'continuation_deferred_load')
       AND device_id = $1
       AND occurred_at > now() - <window>
     ...

coord's real hold read (``spawn_admission.rs`` ``REFUSAL_HOLD_SQL``) adds a
``payload->>'stamp'`` filter and orders first by a computed expression over the
stamp, then by ``occurred_at DESC``. No index can supply that ordering, so the
index's job there is the ACCESS PATH: an equality on ``device_id`` plus a range
on ``occurred_at`` over the refusal population only, followed by a small sort
of one device's in-window rows. The migration test EXPLAINs that shape.

A partial index serves a query only when the planner can prove the query's
WHERE implies the index's predicate. ``event IN (a, b)`` does not imply
``event = a``, so under lacap_01's index this read would scan the log. With
the predicate widened to the same IN list, both this read and the old
single-event read (``event = a`` implies ``event IN (a, b)``) plan on it. The
columns, their order and the DESC are unchanged.

The swap — no window without an index
=====================================

A partial index's predicate cannot be altered in place, so the index is
rebuilt. Dropping first would leave coord's hold read unindexed for the whole
CONCURRENTLY build, so the order is build-new, drop-old, rename:

1. ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` a temporary-named index with
   the new predicate, beside the old one;
2. ``DROP INDEX CONCURRENTLY IF EXISTS`` the old one;
3. ``ALTER INDEX IF EXISTS ... RENAME TO`` the original name, so the name
   coord's schema manifest and lacap_01's documentation carry stays the name of
   the index that serves the hold read.

Between 1 and 2 both indexes exist (the planner picks either); there is no
instant with neither. The rename takes ``SHARE UPDATE EXCLUSIVE`` on the index
(Postgres 12+), which does not conflict with the INSERTs coord's log writes
take or the reads its placement takes.

``downgrade()`` is the same swap in reverse under a DIFFERENT temporary name,
restoring lacap_01's ``event = 'spawn_deferred_load_retire'`` predicate under
the original name. The two temporary names differ on purpose: a temporary
index left VALID by an interrupted run of one direction then always carries
the predicate of that direction, so ``IF NOT EXISTS`` keeping it is correct.
After its rename, each direction also drops the OTHER direction's temporary
name (``DROP INDEX CONCURRENTLY IF EXISTS``), so an interrupted run that was
abandoned rather than re-run leaves no orphan partial index on the log table.

Build posture (same as ``lacap_01``)
====================================

Every step runs inside ``autocommit_block()``, because CONCURRENTLY cannot run
inside a transaction. A failed CONCURRENTLY build leaves an INVALID index of
the temporary name that ``IF NOT EXISTS`` would silently keep, so each
direction first checks ``pg_index.indisvalid`` for its temporary name and
drops an invalid one concurrently; a VALID one is left alone and reused.

No timeout may fail a CONCURRENTLY build or drop: their waits for older
transactions are lock waits, and a timeout there leaves an INVALID index (or a
half-done drop) behind. So, as in ``lacap_01``, the block opens with
session-level ``SET lock_timeout = 0`` and ``SET statement_timeout = 0`` and
RESETs both after the last step, since ``alembic/env.py``'s per-revision RESET
covers ``lock_timeout`` but not ``statement_timeout``. The cost is stated
rather than hidden: a long-running transaction (on any table, holding an older
snapshot) delays the deploy until it ends rather than failing it.

Re-runs
=======

Every step is ``IF [NOT] EXISTS``, so a re-run after an interruption at any
step converges: interrupted after step 1, the VALID temporary index is reused;
after step 2, the drop is a no-op and the rename completes; during step 2, an
INVALID half-dropped old index is dropped by the re-run's ``IF EXISTS``. A
re-run after a COMPLETE upgrade (``alembic stamp coord_topics_01`` then
``upgrade``) builds the temporary index afresh and swaps again: correct, at the
cost of one more build. A run that finds the original already dropped and the
temporary index present (interrupted between steps 2 and 3) builds nothing and
only renames.

Every ``op.execute`` takes a static string literal. That does NOT make this
revision auto-landable: coord's merge-train migration classifier
(``pr_merge/migration_classifier.rs``) fails closed on SQL executed outside
``op.execute`` (the ``pg_index.indisvalid`` probe in ``_index_is_invalid``) and
on any DROP statement in ``upgrade()`` (the swap's drop of the old index and
the invalid-index repair), so the merge train HOLDS this revision for review by
design — as it held lacap_01, for the same reasons.
"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cfo_02_continuation_deferred_load_index"
down_revision: str = "coord_topics_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# down_revision is the single alembic head of this branch at authoring time.
# If `alembic-heads-pr` reports HEAD_COUNT=2 after another revision lands
# first, re-point this line, the `Revises:` line above and
# `_PARENT_REVISION_ID` in
# tests/test_cfo_02_agent_logs_continuation_deferred_load_index_migration.py
# together.

_INDEX_NAME = "idx_agent_logs_deferred_load_retire_device"

# Temporary names, one per direction (see "The swap" in the docstring).
_UPGRADE_TEMP_INDEX_NAME = "idx_agent_logs_deferred_load_device_cfo02"
_DOWNGRADE_TEMP_INDEX_NAME = "idx_agent_logs_deferred_load_retire_device_lacap01"

# The events the widened predicate covers. The static SQL in upgrade() spells
# the same list, and the migration test asserts the two agree.
_HOLD_EVENTS: tuple[str, ...] = (
    "spawn_deferred_load_retire",
    "continuation_deferred_load",
)

# lacap_01's predicate event, which downgrade() restores.
_LACAP_01_EVENT = "spawn_deferred_load_retire"


def _index_is_invalid(index_name: str) -> bool:
    """True when ``coord.<index_name>`` exists and is INVALID (a failed build)."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT NOT i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        )
        .scalar()
    )


def upgrade() -> None:
    """Swap the hold index for one whose predicate also covers continuation_deferred_load."""
    with op.get_context().autocommit_block():
        # No timeout may fail the swap (see the module docstring). Session-
        # level, so it covers the autocommit statements below; both are RESET
        # after the swap, since env.py's per-revision RESET omits
        # statement_timeout.
        op.execute("SET lock_timeout = 0")
        op.execute("SET statement_timeout = 0")
        # A failed earlier CONCURRENTLY build leaves an INVALID temporary index
        # that IF NOT EXISTS would keep. Drop it so the CREATE below rebuilds it.
        if _index_is_invalid(_UPGRADE_TEMP_INDEX_NAME):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.idx_agent_logs_deferred_load_device_cfo02"
            )
        # Plain literals, never f-strings: the `alembic-schema-arg-gate`
        # pre-commit hook statically checks that every CREATE/DROP names its
        # schema, and coord's migration classifier reads only static literals.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_logs_deferred_load_device_cfo02
            ON coord.agent_logs (device_id, occurred_at DESC)
            WHERE event IN ('spawn_deferred_load_retire', 'continuation_deferred_load')
            """
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_agent_logs_deferred_load_retire_device"
        )
        op.execute(
            "ALTER INDEX IF EXISTS coord.idx_agent_logs_deferred_load_device_cfo02 "
            "RENAME TO idx_agent_logs_deferred_load_retire_device"
        )
        # An abandoned interrupted downgrade's temporary index, if any.
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_agent_logs_deferred_load_retire_device_lacap01"
        )
        op.execute("RESET statement_timeout")
        op.execute("RESET lock_timeout")


def downgrade() -> None:
    """Swap back to lacap_01's single-event predicate under the same name."""
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = 0")
        op.execute("SET statement_timeout = 0")
        if _index_is_invalid(_DOWNGRADE_TEMP_INDEX_NAME):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.idx_agent_logs_deferred_load_retire_device_lacap01"
            )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_logs_deferred_load_retire_device_lacap01
            ON coord.agent_logs (device_id, occurred_at DESC)
            WHERE event = 'spawn_deferred_load_retire'
            """
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_agent_logs_deferred_load_retire_device"
        )
        op.execute(
            "ALTER INDEX IF EXISTS "
            "coord.idx_agent_logs_deferred_load_retire_device_lacap01 "
            "RENAME TO idx_agent_logs_deferred_load_retire_device"
        )
        # An abandoned interrupted upgrade's temporary index, if any.
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_agent_logs_deferred_load_device_cfo02"
        )
        op.execute("RESET statement_timeout")
        op.execute("RESET lock_timeout")
