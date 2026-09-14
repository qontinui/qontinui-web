"""coord.test_results — per-test history indexes for the flakiness read.

Adds two composite b-tree indexes, both ``CONCURRENTLY``::

    coord.test_results (repo, test_id, observed_at DESC)   idx_test_results_repo_test_observed
    coord.test_results (repo, observed_at DESC)            idx_test_results_repo_observed

Why now
------------------------------------------------------------------------------
``coord.test_results`` is an append-only per-test outcome oplog. Until
2026-09-04 its only steady producer was coord's own ~9.5k-test suite, a few
runs a day. That week ``qontinui/qontinui-runner`` joined the rail (runner
#1306): ~11k tests x 2 matrix shards x ~100 ``ci.yml`` runs/day is ~2M rows/day,
and the two readers of this table — ``POST /coord/test-flakiness`` and the
declare-time duration predictor, both through
``test_run_effects::load_result_history`` — had been written as a window
function over EVERY row of the repo::

    SELECT ... row_number() OVER (PARTITION BY test_id ORDER BY observed_at DESC)
      FROM coord.test_results WHERE repo = $1

That reads and sorts the whole history to keep 20 rows per test. Measured on
2026-09-12, eight days in: four consecutive flakiness calls for the runner each
returned ``history_read: failed`` at ~60 s — coord's ``statement_timeout`` —
so the repo's flake signal went dark exactly when it had accumulated enough
history to score. The companion coord change rewrites the read as a bounded
per-test probe::

    WITH latest AS (SELECT head_sha FROM coord.test_results
                     WHERE repo = $1 AND head_sha IS NOT NULL
                     ORDER BY observed_at DESC LIMIT 1),                  -- (A)
         roster AS (SELECT DISTINCT t.test_id FROM coord.test_results t, latest
                     WHERE t.repo = $1 AND t.head_sha = latest.head_sha)  -- (B)
    SELECT h.* FROM roster r
    CROSS JOIN LATERAL (SELECT ... FROM coord.test_results
                         WHERE repo = $1 AND test_id = r.test_id
                         ORDER BY observed_at DESC LIMIT $2) h            -- (C)

Its cost is (tests x window) index probes — flat as the oplog grows — but ONLY
with an index whose ordering matches each probe. These two are those indexes.

What each index serves
------------------------------------------------------------------------------
1. ``(repo, test_id, observed_at DESC)`` serves probe (C), the one that runs
   once per test (~11k times per call on the runner). ``repo`` and ``test_id``
   are bound by equality in the leading positions and ``observed_at DESC``
   trails, so ``ORDER BY observed_at DESC LIMIT n`` is an ordered index scan
   that stops after ``n`` entries — no heap-wide fetch, no Sort node. The
   pre-existing ``idx_test_results_repo_test`` ``(repo, test_id)`` finds the
   same rows but then has to fetch EVERY one of the test's rows (hundreds by
   now, unbounded over time) and sort them to find the newest 20. It is now a
   strict prefix of this index and is retired below.

2. ``(repo, observed_at DESC)`` serves probe (A), the repo's newest row.
   The pre-existing ``idx_test_results_observed_at`` on ``observed_at`` alone
   can only walk backwards through EVERY repo's rows until it happens on one
   with the right ``repo`` — instant for a repo that ingested a minute ago,
   millions of entries for one that has been quiet while the runner writes
   2M rows/day on top. Binding ``repo`` first makes it one probe regardless.

Probe (B) rides the pre-existing ``idx_test_results_repo_head``
``(repo, head_sha)`` unchanged.

What is dropped, and what is deliberately NOT
------------------------------------------------------------------------------
``idx_test_results_repo_test`` ``(repo, test_id)`` is dropped: it is a strict
prefix of index #1, backs no constraint, and is not partial, so every query it
could serve the composite serves at least as well — keeping it would be pure
write amplification on the fleet's hottest append table (same reasoning and
same shape as ``coord_pg_overload_idx_03``). Ordering inside ``upgrade`` is
create-then-drop, so there is never a window in which neither exists.

``idx_test_results_observed_at`` is NOT dropped here, although
``coord_alerts_dropmachineidx_01`` already flagged it as never-scanned (428 MB,
``idx_scan = 0`` on 2026-08-07). Two reasons. That measurement predates the
runner's arrival on the rail and this revision is the mitigation for a dark
read, not a cleanup. And it is not even certain to be idle once probe (A)
exists: measured on PostgreSQL 16.14 against the accompanying test's fixture,
the planner serves probe (A) from a BACKWARD scan of that single-column index
with a residual ``repo`` filter (cost 0.48) in preference to index #2 — both
are O(log n) probes on a fixture where the repo's newest row is also the
table's newest, so the choice is a cost tie the narrower index wins. It is on
production, where the runner's 2M rows/day sit on top of every other repo's
newest row, that binding ``repo`` first stops being a tie; the test therefore
asserts that index #2 CAN serve the probe (on a clone carrying nothing else)
rather than that the planner picks it. Re-read ``pg_stat_user_indexes.idx_scan``
for BOTH indexes on production AFTER this lands and the coord read is
deployed, then retire whichever is idle in its own follow-up.

Ordering / safety
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY`` / ``DROP INDEX CONCURRENTLY`` (not the plain
forms): this table is under continuous production write load from every CI leg
on the rail. An in-transaction build takes a write-blocking ``SHARE`` lock for
the whole build — on a table that is already several GB, that is minutes of
every ingest chunk stalling and then aborting on its own client timeout,
which is precisely the data loss the coord change is fixing. CONCURRENTLY
takes ``SHARE UPDATE EXCLUSIVE`` only. It cannot run inside a transaction,
hence ``op.get_context().autocommit_block()`` (precedent:
``coord_pg_overload_idx_01`` / ``_02`` / ``_03``, ``coord_obs_idx_01``). On
the CI fresh database the table is empty and every statement is instant.

A killed CONCURRENTLY build leaves an INVALID index of the same name, which
``IF NOT EXISTS`` then SKIPS on re-run — a false success that, in ``upgrade``,
would go on to DROP the prefix index with no valid replacement behind it:
probe (C) would then fall back to ``idx_test_results_repo_head`` with a
residual ``test_id`` filter, a full scan of the repo's rows per test, times
~11k tests — worse than the dark read this revision exists to fix. And the
exposure is real here: the production migrator is a Fargate one-shot whose
watcher gives up after ~10 min, and two CONCURRENTLY builds over several GB
under continuous ingest can outlast that; a task stop, an RDS failover or an
operator re-dispatch all land on the re-run path. So each CREATE is followed
by an explicit ``indisvalid`` check that RAISES, naming the index and the
recovery (``DROP INDEX`` it plainly, re-run), before anything is dropped —
in both directions. ``IF NOT EXISTS`` / ``IF EXISTS`` make the revision
re-runnable; the validity check is what makes a re-run honest.

Do not re-dispatch the migrator while a first task may still be running: a
second concurrent one would ``IF NOT EXISTS``-skip the in-progress (still
invalid) index and trip the check above — harmless, but a red for nothing.

The coord read is correct WITHOUT these indexes — only slower — so there is no
column-before-migration ordering hazard between the two repos: this revision
may land before or after the coord change and neither breaks. Landing it
first is what makes the coord change fast on arrival.

Revision ID: coord_test_results_idx_01
Revises: plan_library_05_scan_root_observations
Create Date: 2026-09-12

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_test_results_idx_01"
down_revision: str | None = "plan_library_05_scan_root_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "coord.test_results"
_IDX_REPO_TEST_OBSERVED = "idx_test_results_repo_test_observed"
_IDX_REPO_OBSERVED = "idx_test_results_repo_observed"
_IDX_PREFIX = "idx_test_results_repo_test"


def _require_valid(index_name: str) -> None:
    """Refuse to continue unless ``coord.<index_name>`` exists and is ``indisvalid``.

    ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` reports success when it SKIPS an
    invalid leftover of a killed build. This is the check that turns that false
    success into a loud refusal before the next statement drops the index the
    leftover was meant to replace.
    """
    valid = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT i.indisvalid FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'coord' AND c.relname = :n"
            ),
            {"n": index_name},
        )
        .scalar()
    )
    if valid is not True:
        state = "INVALID" if valid is False else "absent"
        raise RuntimeError(
            f"coord.{index_name} is {state} after CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "— a killed concurrent build left it (IF NOT EXISTS skipped it). "
            f"Run `DROP INDEX coord.{index_name}` plainly and re-run this revision."
        )


def upgrade() -> None:
    """Create the two per-test history indexes, then retire the prefix they supersede."""
    with op.get_context().autocommit_block():
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_IDX_REPO_TEST_OBSERVED} "
            f"ON {_TABLE} (repo, test_id, observed_at DESC)"
        )
        _require_valid(_IDX_REPO_TEST_OBSERVED)
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_IDX_REPO_OBSERVED} "
            f"ON {_TABLE} (repo, observed_at DESC)"
        )
        _require_valid(_IDX_REPO_OBSERVED)
        # Only once its superseding composite exists AND is valid (the two
        # statements above, in that order).
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS coord.{_IDX_PREFIX}")


def downgrade() -> None:
    """Restore the prefix index exactly as ``runtests_effect_tables_01`` built it, then drop the two."""
    with op.get_context().autocommit_block():
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_IDX_PREFIX} ON {_TABLE} (repo, test_id)"
        )
        _require_valid(_IDX_PREFIX)
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS coord.{_IDX_REPO_TEST_OBSERVED}")
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS coord.{_IDX_REPO_OBSERVED}")
