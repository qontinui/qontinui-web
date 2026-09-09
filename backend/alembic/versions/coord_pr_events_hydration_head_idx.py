"""Partial expression index for the per-head hydration scan on coord.pr_events.

HARD PREREQUISITE for option C of plan
``2026-08-29-hydration-events-are-96-percent-identical-repeats`` (the
window-aware thinning job for ``hydration`` rows). **This index must be LIVE IN
PRODUCTION before that coord-side job is armed — merged is not sufficient.** A
job whose GROUP BY is unindexed is precisely the failure mode this migration
exists to prevent, and "the migration merged" says nothing about whether the
index has finished building on the live RDS instance.

What the job needs
------------------------------------------------------------------------------
Thinning ``hydration`` rows may not simply delete by age: two live readers each
depend on a *different* extreme of the per-head window, so the job must group on
``(repo, pr_number, payload->>'head_sha')`` and preserve both ends of each
group:

* the per-head **newest** row — read by ``pr_merge/engine.rs``'s
  ``HEAD_OBSERVATION_SCAN_SQL``;
* the per-head **oldest** row — read as ``MIN(created_at)`` by
  ``pr_merge/conflicting_now.rs::conflict_since_by_pr`` and by
  ``stuck_pr_watcher.rs::head_first_seen_by_pr``.

Why an index is required rather than merely nice
------------------------------------------------------------------------------
``coord.pr_events`` carries **no index of any shape on
``payload->>'head_sha'``** — its six existing indexes lead with ``repo``,
``event_kind``, ``tenant_id`` or ``created_at``, and the only expression index
on the table keys ``payload->>'block_reason_code'`` under a
``predicate_eval`` partial predicate. So a grouped scan on the head SHA is
today an unbounded expression scan over ~3M rows on the fleet's hottest
append-only table: every candidate row must be visited on the heap and its
JSONB payload deserialized to evaluate the grouping key.

That is the same shape as the two incidents already on record for this table —
the 2026-06-28 PG-overload incident and the PR #709 RDS-CPU incident (see
``coord_pg_overload_idx_01_fanout_query_indexes`` and
``coord_pg_overload_idx_02_observation_query_indexes``, whose docstrings
describe an instance driven to 99.7% CPU by exactly this class of unindexed
read). Arming a periodic thinning sweep with that scan shape would reproduce
them on a timer.

Note the constraint this index *removes*. Both existing ``head_sha`` readers
already bound their scans to 90 days — **specifically because the expression is
unindexed**, not because 90 days is the semantically correct window. The new
job needs the full retained window, which is only affordable once the grouping
key is index-resolvable.

Index shape
------------------------------------------------------------------------------
::

    (repo, pr_number, (payload->>'head_sha'), created_at)
    WHERE event_kind = 'hydration'

The three grouping columns form the leading prefix, so the GROUP BY becomes an
ordered index scan that walks each ``(repo, pr_number, head_sha)`` group
contiguously; the trailing ``created_at`` then supplies both extremes of each
group as the first and last entries of that group's index range — no sort node,
and MIN/MAX resolve without a heap visit.

``event_kind`` is a **literal** in every query this serves, so it belongs in the
partial predicate rather than in the key — exactly the reasoning applied to
``idx_pr_events_tenant_reason_created``, which is partial on
``event_kind = 'predicate_eval'``. It costs zero key bytes and keeps the index
restricted to the one kind these scans ever touch, which matters here because
``hydration`` is a large fraction of a ~3M-row table.

Mechanics
------------------------------------------------------------------------------
``CREATE INDEX CONCURRENTLY`` (not plain ``CREATE INDEX``): ``coord.pr_events``
is a hot append-heavy table under live production write load, and an
in-transaction build would take a write-blocking ``SHARE`` lock. CONCURRENTLY
cannot run inside a transaction, hence ``op.get_context().autocommit_block()``
— same precedent as ``coord_pg_overload_idx_01`` / ``_02`` and
``coord_pr_events_resolutions_age_idx``. On the CI fresh DB the table is empty,
so the build is instant.

Additive / forward-only / expand-only: ``upgrade`` creates the index
``IF NOT EXISTS``; ``downgrade`` drops it ``IF EXISTS``. No table, column or
existing index is altered, and every current reader is correct (just slower)
without it — so deploy order is not load-bearing for anything already shipped.
It IS load-bearing for the thinning job, which must not be armed until this is
live.

Note on a killed CONCURRENTLY build: a partial build leaves an INVALID index of
the same name, which ``IF NOT EXISTS`` would then skip. If that happens,
manually ``DROP INDEX`` the invalid index and re-run.

Revision ID: coord_pr_events_hydration_head_idx
Revises: atu_02_atu_provenance
Create Date: 2026-09-02

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pr_events_hydration_head_idx"
down_revision: str | None = "atu_02_atu_provenance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one CONCURRENTLY partial expression index. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_events_hydration_head_created
            ON coord.pr_events (
                repo,
                pr_number,
                (payload->>'head_sha'),
                created_at
            )
            WHERE event_kind = 'hydration'
            """
        )


def downgrade() -> None:
    """Reverse the additive index. Table + all other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_pr_events_hydration_head_created"
        )
