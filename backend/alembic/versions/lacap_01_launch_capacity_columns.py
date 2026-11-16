"""coord launch capacity: the runner's own launch verdict on the sample row, and the retire-hold index

Revision ID: lacap_01
Revises: coord_subprojects_02_session_reported_index
Create Date: 2026-11-14

Phase 1 of plan
``2026-11-14-coord-spawn-admission-uses-the-runners-own-launch-ceiling``.
coord authors zero DDL (``[policy: alembic-sole-authorship]``), so the columns
its Phase 2 ingest writes and its Phase 3/4 admission reads land here first,
and this revision must deploy BEFORE the coord PR that reads them.
Hand-authored; ``alembic revision --autogenerate`` was not run and is never
run against ``coord.*``.

Why these columns exist
=======================

coord's autofix placement graded a device's thread pressure against FLEET
constants (``spawn_admission.rs`` ``critical_thread_count``, 400), while the
runner on that device refuses a launch against its OWN machine-scaled thread
ceilings (``resource_guard.rs`` ``scaled_thread_ceilings``). The two disagree,
so coord kept offering spawns to a device whose runner then refused them with
``deferred_load`` — roughly a 21 s refuse/retire cycle per offer. None of the
runner's ceilings, and none of its launch verdict, was published anywhere coord
could read; ``fleet/resource_sample.rs`` documents that gap in so many words.

Phase 2 makes the runner publish, on the host-lane sample it already sends
every 30 s, the SAME computation its ``admit_launch`` enforces:

```text
coord.device_resource_samples.launch_headroom          INTEGER NULL
coord.device_resource_samples.launch_verdict           TEXT    NULL  CHECK IN (...)
coord.device_resource_samples.thread_graded            INTEGER NULL
coord.device_resource_samples.thread_warn_ceiling      INTEGER NULL
coord.device_resource_samples.thread_critical_ceiling  INTEGER NULL
```

* ``launch_headroom`` — how many more launches the runner would admit right now
  (the smallest ``k`` whose projection trips, capped). ``0`` means "the runner
  refuses the next launch", which is the fact coord's placement needs.
* ``launch_verdict`` — the runner's verdict word for the same reading.
* ``thread_graded`` / ``thread_warn_ceiling`` / ``thread_critical_ceiling`` —
  the thread figure the runner graded and the two ceilings it graded it
  against, so a refusal can be explained and coord's display grade, parity
  check and readiness surface use the device's real thresholds.

NULL is "the publisher predates this", never 0
==============================================

Every column is nullable with no DEFAULT, inheriting ``fleet_res_tel_01``'s
rule: a publisher reports what it can probe and omits what it cannot. Here a
fabricated ``0`` is the most dangerous possible value in BOTH directions:
``launch_headroom = 0`` would refuse a healthy device forever, and a
defaulted ceiling of ``0`` would grade every device critical. A NULL headroom
is UNKNOWN, and plan D2 makes coord refuse on unknown (``launch_capacity_unknown``)
rather than admit — which is why it must stay distinguishable from both 0 and
a positive number. Existing rows keep NULL; there is no observation to
backfill from.

``guard_disabled`` carries a NULL headroom on purpose (the runner's guard is
off, so it has no launch ceiling to report); ``unreadable`` carries the
headroom computed from whichever lane WAS readable (plan D2).

``INTEGER``, not ``BIGINT``
===========================

These join the ``lasac_01`` counter group (``thread_count``,
``active_terminal_sessions``) and the ``build_slots_busy`` / ``ci_jobs_running``
peers, which coord reads with ``row.get`` as ``Option<i32>``. tokio-postgres
treats a width mismatch as a runtime type error that panics rather than a
degradable SQLSTATE, so the width is an interface with the coord read. The
values are a process's thread count and its ceilings — bounded far below 2^31.

The one CHECK, and why it is safe here
======================================

``launch_verdict`` is a FIXED vocabulary the runner and coord share — the same
stance ``wthr_01`` took for ``worktree_headroom_mode`` and ``fleet_policy_01``
for ``level``. A CHECK violation fails the whole best-effort INSERT and would
discard the memory and disk metrics on that row (the reason ``lasac_01``
declined CHECKs on its counters), so the coord ingest (Phase 2) is obliged to
map any verdict word outside this set to NULL at the door before it INSERTs.
The CHECK is then a backstop that can never fire on a well-behaved coord, and
it stops a typo'd verdict from ever being stored as a value the admission
grader does not recognise. NULL passes the CHECK by SQL semantics. The numeric
columns carry no CHECK, as in ``lasac_01``.

The CHECK is a separate ``ADD CONSTRAINT ... NOT VALID``, never inline on the
``ADD COLUMN``. An inline CHECK makes Postgres validate every existing row of
``coord.device_resource_samples`` while the ALTER holds ACCESS EXCLUSIVE,
and ``lock_timeout`` bounds only the WAIT for that lock, not how long it is
held — so every sample INSERT and every coord read of the table would stall
behind a scan whose length grows with the table. ``NOT VALID`` is catalogue-only:
it skips the scan of existing rows and still checks every row inserted or
updated afterwards, which is all the backstop needs. No ``VALIDATE
CONSTRAINT`` follows, because there is nothing to validate: the column is new,
so every pre-existing row holds NULL, which passes. ``convalidated`` stays
false in ``pg_constraint``; that flag is the only observable difference.

Postgres has no ``ADD CONSTRAINT IF NOT EXISTS``, so the ADD runs in a ``DO``
block that first looks the constraint up in ``pg_constraint`` by name on this
table. A re-run of ``upgrade()`` (a ``stamp`` back, or a deploy retried after a
later step failed) therefore skips it rather than failing on a duplicate name.

The ``coord.agent_logs`` retire index
=====================================

Plan D4: a verified ``deferred_load`` refusal writes a
``spawn_deferred_load_retire`` row to ``coord.agent_logs``, and Phase 4 sets
its existing typed ``device_id`` column (``coord_agent_logs``) instead of
leaving it NULL. Placement then reads, per candidate device, the newest such
row, and holds the device until a host-lane sample with ``launch_headroom > 0``
arrives after it. That read is::

    SELECT occurred_at FROM coord.agent_logs
     WHERE event = 'spawn_deferred_load_retire' AND device_id = $1
     ORDER BY occurred_at DESC LIMIT 1

``coord.agent_logs`` is the fleet-wide structured log of every agent run, and
none of its three indexes (``idx_agent_logs_agent``, ``_session``, ``_recent``)
leads on ``device_id`` or filters on ``event``. Without this index the hold
read is a scan of a log table per candidate per placement pass. The index is
PARTIAL on the one event, so it is the size of the retire population, not of
the log.

Build posture (same as ``agent_questions_alert_id_idx_01``): ``CREATE INDEX
CONCURRENTLY IF NOT EXISTS`` inside ``autocommit_block()``, so the build takes
no lock that blocks coord's log writes. A failed CONCURRENTLY build leaves an
INVALID index of this name that ``IF NOT EXISTS`` would silently keep, so the
upgrade first checks ``pg_index.indisvalid`` and drops an invalid one
concurrently; a re-run over a VALID index leaves it untouched.

No timeout may fail the CONCURRENTLY build or drop: its waits for older
transactions are lock waits, and a timeout there leaves an INVALID index (or a
half-done drop) behind. So, as in ``coord_agent_status_session_02``, the
autocommit block opens with session-level ``SET lock_timeout = 0`` and
``SET statement_timeout = 0`` and RESETs both after the CONCURRENTLY step, since
``alembic/env.py``'s per-revision RESET covers ``lock_timeout`` but not
``statement_timeout``. The cost is stated rather than hidden: a long-running
transaction (on any table, holding an older snapshot) delays the deploy until
it ends rather than failing it.

Ordering and locks
==================

The index is built FIRST, in its own autocommit block, because a
CONCURRENTLY build cannot run inside a transaction and committing it before the
transactional part means a re-run finds it VALID and leaves it alone. The
transactional part then runs under the house ``SET LOCAL lock_timeout = '3s'``
bound (``alembic/env.py`` resets ``lock_timeout`` after each revision): one
ALTER carrying all five ADDs, so the table can never carry a subset, then the
guarded ``NOT VALID`` CHECK, then the COMMENTs. Every step is safe to re-run.
``downgrade()`` drops the index concurrently, then the five columns; the
COMMENTs and the CHECK constraint go with their columns.

``IF NOT EXISTS`` is type-blind: a pre-existing column of the right name and
wrong type makes the ADD a silent no-op and leaves the wrong type, where
coord's ``row.get`` panics. Re-running ``upgrade()`` is not a repair for that;
fix it with an explicit ``ALTER COLUMN ... TYPE`` in a new revision. The CHECK
is separate from the ADD, so a pre-existing ``launch_verdict`` column still
gets it — unless a constraint of that NAME already exists on the table, which
the guard takes as present whatever its expression; a wrong expression under
the right name is likewise repaired only by a new revision that drops and
re-adds it.

Every ``op.execute`` takes a static string literal. That does NOT make this
revision auto-landable: coord's merge-train migration classifier
(``pr_merge/migration_classifier.rs``) fails closed on three things here, so the
merge train HOLDS this revision for review by design:

* SQL executed outside ``op.execute`` — the ``pg_index.indisvalid`` probe in
  ``_index_is_invalid`` runs through ``op.get_bind().execute(...)``;
* any dollar-quoted string — the ``DO $$`` guard around the CHECK;
* any DROP statement in ``upgrade()`` — the invalid-index repair.

All three are kept deliberately: the probe and the repair are what stop a failed
CONCURRENTLY build from being kept INVALID forever, and the guard is what makes
a re-run of ``upgrade()`` safe (Postgres has no ``ADD CONSTRAINT IF NOT
EXISTS``). Re-runnability and self-repair outrank an
unattended land for a migration on two hot coord tables.
"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "lacap_01"
down_revision: str = "coord_subprojects_02_session_reported_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# down_revision is the single alembic head of origin/main at authoring time
# (web e78a2455b). If `alembic-heads-pr` reports HEAD_COUNT=2 after another
# revision lands first, re-point this line, the `Revises:` line above and
# `_PARENT_REVISION_ID` in
# tests/test_lacap_01_launch_capacity_columns_migration.py together.

_TABLE = "coord.device_resource_samples"

# The interface the migration test pins: (name, DDL type). The static SQL in
# upgrade()/downgrade() spells the same five columns, and the test asserts the
# two agree. coord reads these names over a 42703-swallowing degrade path, so a
# rename idles forever with no error.
_LAUNCH_CAPACITY_COLUMNS: tuple[tuple[str, str], ...] = (
    ("launch_headroom", "INTEGER"),
    ("launch_verdict", "TEXT"),
    ("thread_graded", "INTEGER"),
    ("thread_warn_ceiling", "INTEGER"),
    ("thread_critical_ceiling", "INTEGER"),
)

# The runner's verdict vocabulary — the CHECK's IN list, and the set coord's
# Phase 2 ingest maps every other word to NULL against.
_LAUNCH_VERDICTS: tuple[str, ...] = (
    "proceed",
    "warn",
    "critical",
    "guard_disabled",
    "unreadable",
)

_VERDICT_CHECK_NAME = "device_resource_samples_launch_verdict_check"

_RETIRE_INDEX_NAME = "idx_agent_logs_deferred_load_retire_device"


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
    """Build the retire-hold index, then add the five launch-capacity columns."""
    with op.get_context().autocommit_block():
        # No timeout may fail the build (see the module docstring). Session-
        # level, so it covers the autocommit statements below; both are RESET
        # after the build, since env.py's per-revision RESET omits
        # statement_timeout.
        op.execute("SET lock_timeout = 0")
        op.execute("SET statement_timeout = 0")
        # A failed earlier CONCURRENTLY build leaves an INVALID index that
        # IF NOT EXISTS would keep. Drop it so the CREATE below rebuilds it.
        if _index_is_invalid(_RETIRE_INDEX_NAME):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.idx_agent_logs_deferred_load_retire_device"
            )
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook statically checks that every CREATE/DROP names its
        # schema, and coord's migration classifier reads only static literals.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_agent_logs_deferred_load_retire_device
            ON coord.agent_logs (device_id, occurred_at DESC)
            WHERE event = 'spawn_deferred_load_retire'
            """
        )
        op.execute("RESET statement_timeout")
        op.execute("RESET lock_timeout")

    # Bound the ACCESS EXCLUSIVE lock wait (house style): a QUEUED lock request
    # blocks every reader of the table behind it. env.py resets lock_timeout
    # after each revision.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS launch_headroom INTEGER,
            ADD COLUMN IF NOT EXISTS launch_verdict TEXT,
            ADD COLUMN IF NOT EXISTS thread_graded INTEGER,
            ADD COLUMN IF NOT EXISTS thread_warn_ceiling INTEGER,
            ADD COLUMN IF NOT EXISTS thread_critical_ceiling INTEGER
        """
    )
    # NOT VALID: catalogue-only, no scan of existing rows under ACCESS
    # EXCLUSIVE; new rows are still checked. Guarded because Postgres has no
    # ADD CONSTRAINT IF NOT EXISTS. See the module docstring.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint
                 WHERE conname = 'device_resource_samples_launch_verdict_check'
                   AND conrelid = 'coord.device_resource_samples'::regclass
            ) THEN
                ALTER TABLE coord.device_resource_samples
                    ADD CONSTRAINT device_resource_samples_launch_verdict_check
                    CHECK (launch_verdict IN (
                        'proceed', 'warn', 'critical', 'guard_disabled',
                        'unreadable'
                    )) NOT VALID;
            END IF;
        END
        $$
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.launch_headroom IS
            'How many more agent launches the PUBLISHING RUNNER would admit at '
            'sample time: the smallest k whose projected lanes trip, capped. '
            'The same computation the runner''s admit_launch enforces, so 0 '
            'means the runner refuses the next launch (plan '
            '2026-11-14-coord-spawn-admission-uses-the-runners-own-launch-ceiling). '
            'NULL = NOT REPORTED (a runner build that predates the field) or '
            'launch_verdict = guard_disabled; coord reads it as UNKNOWN and '
            'refuses, never as 0 and never as room. Host lane only.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.launch_verdict IS
            'The runner''s launch verdict for the same reading as '
            'launch_headroom: proceed | warn | critical | guard_disabled | '
            'unreadable. guard_disabled carries a NULL headroom; unreadable '
            'carries the headroom of the lane that WAS readable. Fixed '
            'vocabulary, hence the CHECK; coord''s ingest maps any other word '
            'to NULL before INSERT so the CHECK never discards a sample row. '
            'NULL = NOT REPORTED, never proceed.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.thread_graded IS
            'The thread figure the runner GRADED for its launch verdict (the '
            'value compared against thread_warn_ceiling / '
            'thread_critical_ceiling). Not necessarily equal to thread_count. '
            'NULL = NOT REPORTED, never 0, which would read as an idle process.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.thread_warn_ceiling IS
            'The runner''s OWN machine-scaled thread WARN ceiling at sample '
            'time (resource_guard scaled_thread_ceilings), replacing coord''s '
            'fleet constant for this device when present. NULL = NOT REPORTED; '
            'coord then falls back to the fleet constant. Never 0, which would '
            'grade every reading as over the ceiling.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.thread_critical_ceiling IS
            'The runner''s OWN machine-scaled thread CRITICAL ceiling at sample '
            'time (resource_guard scaled_thread_ceilings). NULL = NOT REPORTED; '
            'coord then falls back to the fleet constant. Never 0, which would '
            'grade every reading critical.'
        """
    )


def downgrade() -> None:
    """Drop the retire-hold index, then the five columns. Reverse of upgrade().

    The column COMMENTs and the launch_verdict CHECK go with their columns; no
    sample row and no log row is deleted.

    The index DROP runs in an autocommit block, so it is COMMITTED before the
    column ALTER starts. If that ALTER then fails (for example on the 3 s
    ``lock_timeout`` behind a long reader), the database is left at
    ``lacap_01`` WITHOUT the retire index but WITH the five columns. That is
    harmless to coord (the hold read only loses its index) and recoverable:
    re-running the downgrade finishes it, because every step is
    ``IF EXISTS``. Re-running the upgrade does NOT rebuild the index, because
    the database is still stamped ``lacap_01`` and the upgrade is a no-op. To
    restore the index instead, run ``alembic stamp
    coord_subprojects_02_session_reported_index`` and then ``alembic upgrade
    lacap_01``.
    """
    with op.get_context().autocommit_block():
        # Same no-timeout posture as upgrade(), for the same reason.
        op.execute("SET lock_timeout = 0")
        op.execute("SET statement_timeout = 0")
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_agent_logs_deferred_load_retire_device"
        )
        op.execute("RESET statement_timeout")
        op.execute("RESET lock_timeout")

    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS thread_critical_ceiling,
            DROP COLUMN IF EXISTS thread_warn_ceiling,
            DROP COLUMN IF EXISTS thread_graded,
            DROP COLUMN IF EXISTS launch_verdict,
            DROP COLUMN IF EXISTS launch_headroom
        """
    )
