"""coord.account_usage_samples.session_window — whether a reading HAD a five-hour window

Revision ID: launch_budget_02_session_window
Revises: overview_07_schedule_last_known
Create Date: 2026-11-26

Phase 3 of plan
``2026-11-26-runner-usage-source-is-dark-so-the-launch-budget-never-reads-a-session-figure``.
Hand-authored; ``alembic revision --autogenerate`` was not run and is never
run against ``coord.*``.

Why the column exists
=====================

``session_pct`` (``launch_budget_01``) is NULL for two different reasons, and
coord's launch-budget decision can only tell them apart if the runner says
which one it saw:

* **absent** — the provider sends NO five-hour window for this account, as the
  runner infers it from positive evidence: a rate-limit header set that carries
  the unified family (``-unified-status``, ``-unified-representative-claim``,
  ``-unified-7d-*``) and no ``-unified-5h-*`` header, or a 2xx OAuth usage body
  whose ``five_hour`` is null. The header half was measured on one Claude Max
  20x account's response on 2026-11-26; the OAuth half is an assumption the
  plan's Phase 1 checks against a live grant. Once classified, it is an
  observation: there is no session window to read, so the decision prices the
  run on the weekly and model windows.
* **unread** — the window may exist, and this reading could not see it (a
  failed probe, a response without the unified family, a runner build that
  predates the classification). That is UNKNOWN, and coord keeps answering
  ``UNKNOWN session_unread`` for it, exactly as it does for every NULL today.
* **reported** — the reading carries a five-hour figure in ``session_pct``.

The runner classifies each reading from positive evidence (plan D1, Phase 2)
and sends the word on the ingest wire; coord stores it here (Phase 4) and reads
it in ``decide_account``. Today every NULL ``session_pct`` is read as unread, so
every launcher pinned to a hashed Max 20x account is capped at one run.

NULL is "the runner did not say", never ``absent``
==================================================

The column is nullable with no DEFAULT and NOTHING is backfilled. Every row
written before this revision, and every row from a runner that predates Phase
2, carries NULL. coord reads NULL as ``unread`` — today's behaviour exactly. A
default of ``absent`` would be the worst possible value: it would silently
drop the session constraint for every account whose window was merely not read
[policy: unknown-must-not-render-as-a-default].

No caps column
==============

Whether a reading read the per-model weekly caps is NOT stored as a new column.
It is derived from the existing ``source`` column (``launch_budget_01``): the
runner sends ``"oauth_usage"`` from the OAuth branch, the only source that
reports per-model caps, and ``"probe"`` from the header probe. Caps are read
exactly when ``source = 'oauth_usage'`` (plan D3). A second column would be a
second spelling of the same fact, free to disagree with the first.

The CHECK, and why it is declared inside the ADD COLUMN
=======================================================

``session_window`` is a fixed vocabulary the runner and coord share, so it
carries ``CHECK (session_window IN ('reported', 'absent', 'unread'))``. NULL
passes it by SQL semantics. A CHECK violation fails the whole INSERT, so coord's
ingest (Phase 4) maps any other spelling to NULL at the door before it inserts;
the CHECK is the backstop that stops a typo'd word from ever being stored as a
value the decision does not recognise.

It is a named column constraint inside ``ADD COLUMN IF NOT EXISTS`` — the
``plan_library_07_plan_difficulty`` shape — rather than a separate ``ADD
CONSTRAINT``, for two reasons:

* **Re-runnable with no guard.** ``IF NOT EXISTS`` skips the column AND its
  constraint together, so ``stamp <parent>`` then ``upgrade`` (or a retried
  deploy) is a no-op. Postgres has no ``ADD CONSTRAINT IF NOT EXISTS``; the
  separate form would need a ``DO $$`` lookup, and coord's merge-train
  migration classifier (``qontinui-coord``
  ``crates/coord/src/pr_merge/migration_classifier.rs``) rejects any dollar
  quote and any ``DROP`` on the upgrade path, parking the PR for review.
* **Classifier-admitted.** Every statement here is one the classifier proves
  additive: ``SET LOCAL lock_timeout``, ``ALTER TABLE … ADD COLUMN IF NOT
  EXISTS`` with a nullable type and a CHECK, and ``COMMENT ON COLUMN``.

The cost, stated rather than hidden: Postgres validates a CHECK added with its
column by scanning the existing rows while the ALTER holds ACCESS EXCLUSIVE
(no rewrite). The table is append-only with 31-day retention, at one row per
reported account per runner report, and coord states that report's cadence as
10 minutes, so it holds about 4,464 rows per reported account: on the order of
10^5 rows fleet-wide. The classifier's own measurement, ~125 ms per 3M rows on
PG16, was taken on a table of unrecorded width and a scan costs per heap page,
so it is a guide rather than a bound; a table this size still scans in well
under a second at any plausible row width. Every pre-existing row holds NULL,
which passes, so the scan cannot fail the upgrade.

The ALTER's lock WAIT is bounded by the house ``SET LOCAL lock_timeout = '3s'``
(``alembic/env.py`` resets ``lock_timeout`` after each revision). While it
waits, the queued ACCESS EXCLUSIVE request blocks the table's readers and
writers alike (coord's ingest and its launch-budget reads) for at most 3 s;
then the batch transaction aborts and the migrate run fails and pages. Nothing
retries it automatically: the next push, the nightly 03:00 UTC run or a
dispatch re-applies it. Once granted, the lock is held until the alembic batch
transaction commits.

The CHECK has an evolution cost as well as a per-INSERT one: adding a word to
the set later needs a revision that drops and re-adds this named constraint,
which coord's migration classifier rejects on the upgrade path and parks for
review (removing a word can instead add a second CHECK ``NOT VALID``, which it
admits). That cost is accepted because the vocabulary is closed by design (the
plan's D1 has exactly three states), and a stored word outside it would make
the launch budget's absent-versus-unread decision unreadable.

``IF NOT EXISTS`` is type-blind: a pre-existing ``session_window`` column of
another type or without the CHECK makes the ADD a silent no-op. Re-running the
upgrade is not a repair for that; a new revision is.

Two-repo ordering — this schema half lands FIRST
================================================

alembic in qontinui-web is the SOLE author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``). The coord build that
writes and reads ``session_window`` is plan Phase 4, held behind this revision
being live, and it steps down to today's column set on SQLSTATE ``42703``, so an
early coord deploy fails safe rather than wrong.

Head choice
===========

``down_revision`` is the repo's single alembic head on ``origin/main`` at
authoring time (``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``,
``HEAD=overview_07_schedule_last_known``, web ``26b52d3b1``, 2026-11-26). If
``alembic-heads-pr`` reports two heads after a sibling lands first, re-point the
``down_revision`` line and the ``Revises:`` line above together; the migration
test reads the parent from this file, so it follows.

Safety
======

Additive: one nullable column with its CHECK, and its comment. No row is
written or rewritten, nothing is backfilled, no existing column or constraint
is touched. ``downgrade`` drops only the column; its CHECK and its comment go
with it, and no sample row is deleted.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "launch_budget_02_session_window"
down_revision: str | Sequence[str] | None = "overview_07_schedule_last_known"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable ``session_window`` column with its vocabulary CHECK."""
    # Bound the ACCESS EXCLUSIVE lock WAIT (house style): a queued lock request
    # blocks every reader and writer of the table behind it. env.py resets
    # lock_timeout after each revision.
    op.execute("SET LOCAL lock_timeout = '3s'")
    # One static literal: coord's migration classifier and the
    # alembic-schema-arg-gate pre-commit hook both read only static SQL, and the
    # hook requires the table to name its schema.
    op.execute(
        """
        ALTER TABLE coord.account_usage_samples
            ADD COLUMN IF NOT EXISTS session_window TEXT
                CONSTRAINT ck_account_usage_samples_session_window
                CHECK (session_window IN ('reported', 'absent', 'unread'))
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.account_usage_samples.session_window IS
            'Whether this reading had a five-hour session window, as the runner classified it from positive evidence: reported = session_pct carries the figure; absent = the provider sends no five-hour window for this account (the unified rate-limit family arrived with no -unified-5h-* header, or a 2xx OAuth body said five_hour null), so the launch budget prices the run on the weekly and model windows; unread = the window may exist and this reading could not see it, so the decision stays UNKNOWN session_unread. NULL = the runner did not say (rows before plan 2026-11-26-runner-usage-source-is-dark-so-the-launch-budget-never-reads-a-session-figure, or a runner build that predates it), read as unread, never as absent. Whether the per-model caps were read is not stored here: it is source = oauth_usage.'
        """
    )


def downgrade() -> None:
    """Drop the column; its CHECK and its comment go with it. No row is deleted."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.account_usage_samples
            DROP COLUMN IF EXISTS session_window
        """
    )
