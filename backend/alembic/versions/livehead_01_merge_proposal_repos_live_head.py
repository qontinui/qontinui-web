"""coord.merge_proposal_repos: one LIVE merge proposal per head, enforced.

Phase 2 of plan
``qontinui-dev-notes/plans/2026-11-23-coord-one-live-merge-proposal-per-head-is-a-database-invariant.md``
(D2, D4). Makes "at most one non-terminal ``coord.merge_proposals`` row per
``(repo, branch, head_sha)``" a database invariant instead of the conjunction
of coord's four hand-written lock-and-re-check guards.

What this adds
==========================================================================

* ``coord.merge_proposal_status_is_live(text) RETURNS boolean IMMUTABLE`` —
  true iff the status is NOT one of ``('merged', 'conflict', 'cancelled',
  'shadow-landed')``, coord's ``TERMINAL_PROPOSAL_STATUSES``
  (``crates/coord/src/merge.rs``). This is the ONLY SQL spelling of the
  terminal set; coord's Phase 3 DB test pins it to the Rust constant.
* ``coord.merge_proposal_repos.proposal_live boolean NOT NULL DEFAULT false``
  — the parent's liveness, copied onto the child, because ``status`` lives on
  ``coord.merge_proposals`` while ``(repo, branch, head_sha)`` lives on the
  child, and a partial unique index cannot span two tables.
* Two triggers keep it true:

  - ``trg_merge_proposal_repos_proposal_live`` — ``BEFORE INSERT OR UPDATE``
    on the child: ``NEW.proposal_live`` is always RECOMPUTED from the parent's
    status, so no writer can store a wrong value. On INSERT (or a re-parenting
    UPDATE) it reads the parent ``FOR SHARE``, so a child inserted while
    another transaction is changing the parent's status waits for that change
    and sees its result instead of a stale ``true``. That WIDENS contention
    for a child inserted under an EXISTING parent: the FK alone took ``FOR KEY
    SHARE``, which no non-key UPDATE waits for; ``FOR SHARE`` makes any parent
    UPDATE (status, ``updated_at``, …) wait for the open child-inserting
    transaction, and two transactions that each insert a child under the same
    parent and then update that parent can deadlock (one is aborted). coord's
    writers insert the parent and its children in one transaction, where the
    lock is on their own uncommitted row and costs nothing. The race the lock
    closes is exercised by a two-connection test (a cancel in flight, a child
    insert waiting for it); the deadlock shape above is covered by reasoning,
    not a test.
  - ``trg_merge_proposals_propagate_live`` — ``AFTER UPDATE OF status`` on the
    parent, ``FOR EACH ROW WHEN (live(OLD.status) IS DISTINCT FROM
    live(NEW.status))``: rewrites the children's ``proposal_live``. A
    live-to-live move (``queued`` -> ``dry-rebasing``) does not fire it and
    writes no child row. The nested child write fires the child BEFORE
    trigger, which recomputes from the parent row the statement just wrote —
    the same value, so there is no recursion and no disagreement.
* ``uq_merge_proposal_repos_live_head`` — ``UNIQUE (repo, branch, head_sha)
  WHERE proposal_live``.

What a writer sees afterwards
==========================================================================

A second live proposal at a held head fails its child INSERT with SQLSTATE
``23505`` on ``uq_merge_proposal_repos_live_head``. A status UPDATE that
revives a terminal row while another live row holds its head fails the same
way (raised from the parent trigger), and the row stays terminal. coord's
Phase 1 (``pr_merge/live_head_guard.rs``) maps exactly that error to each
writer's existing "already live" outcome, and runs revives under a savepoint.
coord never needs the index at query time: it reacts to the error, so a
database without this revision still works.

The index is NOT deferrable (Postgres cannot defer a partial unique index), so
it is checked row by row, as each row is written. A transaction — or a single
statement — that hands liveness from one proposal to another at the same head
must make the OLD row terminal BEFORE it revives the new one; in the other
order, or in one multi-row UPDATE whose row trigger for the revive fires
first, the revive raises ``23505``.

The cleanup (D4), and its expected production effect
==========================================================================

Existing live duplicates would make the index build fail, so the revision
first cancels them. In each group of live rows sharing ``(repo, branch,
head_sha)`` it keeps the MOST ADVANCED row — ``landing`` > ``awaiting-ci`` >
``speculative-ci`` > ``dry-rebasing`` > ``blocked-by-overlap`` > ``queued`` —
breaking ties by the OLDEST ``proposal_id`` (UUIDv7 sorts by mint time). Every
other row in the group is set to::

    status       = 'cancelled'
    cancelled_at = now()
    updated_at   = now()
    error        = 'duplicate live proposal for this head; kept <keeper id> (alembic livehead_01)'

Rows are cancelled, never deleted, so each stays readable and names its keeper.

**Expected production effect: exactly two rows cancelled**, both ``queued`` in
qontinui/qontinui-coord, both legacy rows of the qontinui-coord#3714 concurrent
enqueue race (minted 2026-11-05/06, before coord's ``ef162e15c`` guard):

* ``01a1abe0-ca5d-…`` (PR #3768, head ``482835e4``) — kept ``01a1abe0-ca3c-…``;
* ``01a1b0c0-0c88-…`` (PR #3836, head ``15ad9761``) — kept ``01a1b0c0-0c7e-…``.

(Coord finding ``273077f0-f6aa-40ec-a20e-f7a7a0df6027``.) A different count at
deploy time means the duplicate population moved since that measurement.

**The cleanup REFUSES** — ``RAISE EXCEPTION``, the whole upgrade rolls back,
and the web deploy fails visibly — when a row it would cancel:

* is a batch member (``batch_id IS NOT NULL``) or spans more than one repo
  (more than one ``merge_proposal_repos`` row): cancelling it has side effects
  on a batch or on other repos' heads; or
* is past ``queued`` / ``blocked-by-overlap`` — ``dry-rebasing``,
  ``speculative-ci``, ``awaiting-ci`` or ``landing`` (the last when the keeper
  is also ``landing``): coord may be mid-rebase, mid-CI or mid-land on it, and
  cancelling it behind coord's back is not this migration's call.

Each needs its own decision. The message names every such row with its
reasons. The check runs BEFORE anything is cancelled. A batch member,
multi-repo or advanced row that is the KEEPER is fine. Phase 0 expects only
``queued`` losers, so in the expected case the refusal costs nothing.

Step order is load-bearing
==========================================================================

One transaction (``env.py`` runs a whole upgrade batch in one), in this order
— ``UPGRADE_STEPS`` below, pinned by the test:

1. ``LOCK TABLE coord.merge_proposals IN SHARE ROW EXCLUSIVE MODE``, then
   ``LOCK TABLE coord.merge_proposal_repos IN ACCESS EXCLUSIVE MODE`` —
   parent first. Held until the batch commits, so no new duplicate can appear
   between the cleanup and the index build (see "Locking").
2. The liveness function.
3. The cleanup.
4. ``ADD COLUMN proposal_live`` and its backfill from the parent's status.
5. The triggers.
6. The unique index.

The cleanup MUST precede the backfill. The pre-vet draft backfilled first and
created the triggers only afterwards, so every loser the cleanup cancelled
kept ``proposal_live = true`` and the index build raised ``23505`` on exactly
the rows the cleanup existed to clear. The test runs the old order and shows
it fail.

Locking
==========================================================================

Every table lock this revision needs is taken in step 1, before any DDL,
under the house ``SET LOCAL lock_timeout = '3s'`` followed by the REQUIRED
``RESET lock_timeout`` (env.py also resets after every revision):

* ``coord.merge_proposals`` in ``SHARE ROW EXCLUSIVE``: blocks coord's writers,
  not its readers. The cleanup's UPDATE, the backfill's read and the parent
  trigger's ``CREATE TRIGGER`` need nothing stronger.
* ``coord.merge_proposal_repos`` in ``ACCESS EXCLUSIVE``: the ``ADD COLUMN``
  (step 4) needs it anyway and would hold it to commit, so taking it up front
  costs readers nothing extra and removes a mid-transaction lock UPGRADE
  (``SHARE ROW EXCLUSIVE`` -> ``ACCESS EXCLUSIVE``) that could deadlock with a
  reader of ``merge_proposal_repos`` that then writes ``merge_proposals``. So
  steps 2-6 take no new table lock and need no timeout of their own (the
  test asserts ``ADD COLUMN`` adds none). Readers of ``merge_proposal_repos``
  wait for the whole migration; the tables are bounded by the live queue plus
  history, so that is short.

``lock_timeout`` applies to each lock acquisition separately, so step 1 can
wait up to 3 s per table (about 6 s in all, holding ``merge_proposals`` while
it waits for ``merge_proposal_repos``). The locks are taken ONE AT A TIME,
parent first. That matches coord's writers, which insert the parent before
its children, and coord's one same-transaction parent+child write
(``heal_missing_rebased_tip``), which updates the parent row before the child
row. A transaction that holds a lock on ``merge_proposal_repos`` and then
writes ``merge_proposals`` would collide with step 1; such a collision is
resolved by Postgres's deadlock detector, or by the timeout, aborting one
side, and an aborted migration is simply re-run. The ``ADD COLUMN`` itself is
catalog-only (a constant default, no rewrite). The index is built in the
transaction, not ``CONCURRENTLY``, because the lock is what closes the
duplicate window.

Row-lock order the parent trigger introduces
==========================================================================

A live/terminal flip of ``merge_proposals.status`` now also writes that
proposal's child rows, from the AFTER trigger: parent row first, then child
rows. A transaction that UPDATEs a ``merge_proposal_repos`` row and LATER
flips its parent's status in the same transaction takes them in the opposite
order and could deadlock against a concurrent flip. Read on qontinui-coord
``origin/main`` ``dddc66b19`` (every ``UPDATE coord.merge_proposal_repos`` in
``crates/``): no production path does that. The child writers in
``merge_scheduler.rs`` — ``persist_repo_conflict``,
``persist_rebase_results``, ``persist_overlap_paths``,
``record_pushed_candidate_tip``, ``persist_batch_member_result``,
``record_batch_reemitted_tip`` — each run one autocommit statement on a pooled
connection, holding no lock across a parent write. The one statement that
writes both, ``heal_missing_rebased_tip``'s ``WITH counted AS (UPDATE
coord.merge_proposals …), cleared AS (UPDATE coord.merge_proposal_repos …)``,
locks the parent row first, which is the trigger's own order (the test runs
that shape through a live-to-terminal flip). Every other site is a test
fixture. A new coord path that writes a child and then flips the parent in one
transaction must take the parent row first (``SELECT … FOR UPDATE``).

Merge-train classifier disposition
==========================================================================

coord's migration classifier (``pr_merge/migration_classifier.rs``, read at
qontinui-coord ``dddc66b19``) fails closed on ``upgrade()``, so the merge
train HOLDS this revision for review by design. Each of these would hold it
on its own: the dollar-quoted function and ``DO`` bodies (the lexer rejects
any dollar quote rather than guess at it), the ``LOCK TABLE`` (no handler),
every ``RESET`` (only ``SET LOCAL lock_timeout`` / ``statement_timeout`` are
admitted), the cleanup and backfill DML, ``CREATE FUNCTION`` /
``CREATE TRIGGER``, and the non-concurrent ``CREATE UNIQUE INDEX`` on a live
table. All are kept on purpose: the lock closes the duplicate window, the DML
is the D4 cleanup the index needs, and the triggers are the invariant. The
classifier skips ``downgrade()``, so its drops play no part in the hold.

Downgrade — and restoring a cancelled row by hand
==========================================================================

``downgrade()`` drops the index, both triggers, both trigger functions, the
liveness function and the column. **It does NOT un-cancel the rows the
cleanup cancelled.** To restore one by hand, find it by its error text and put
it back in the queue (its previous error, normally NULL for a queued row, is
not recoverable; ``queued`` is the safe re-entry status, the scheduler
re-advances it)::

    SELECT proposal_id, error FROM coord.merge_proposals
     WHERE error LIKE 'duplicate live proposal for this head; kept % (alembic livehead_01)';

    UPDATE coord.merge_proposals
       SET status = 'queued', cancelled_at = NULL, error = NULL, updated_at = now()
     WHERE proposal_id = '<id>'
       AND error LIKE 'duplicate live proposal for this head; kept % (alembic livehead_01)';

While this revision is applied, that UPDATE raises ``23505`` if the keeper is
still live at the same head — the invariant refusing to recreate the
duplicate; restore after a downgrade, or after the keeper is terminal.

Revision ID: livehead_01
Revises: coord_subprojects_05_note_events
Create Date: 2026-11-23

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "livehead_01"
down_revision: str | Sequence[str] | None = "coord_subprojects_05_note_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Every SQL string below is a plain literal, never an f-string: the
# `alembic-schema-arg-gate` pre-commit hook statically checks that each
# statement names its schema.

LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '3s'"
RESET_LOCK_TIMEOUT_SQL = "RESET lock_timeout"

# Step 1. Parent first, then the child in the mode ADD COLUMN needs, so no
# later step takes a new table lock. Taken one at a time (see "Locking").
LOCK_PARENT_SQL = "LOCK TABLE coord.merge_proposals IN SHARE ROW EXCLUSIVE MODE"
LOCK_CHILD_SQL = "LOCK TABLE coord.merge_proposal_repos IN ACCESS EXCLUSIVE MODE"

# Step 2. The only SQL spelling of coord's TERMINAL_PROPOSAL_STATUSES. A plain
# SQL function with no SET clause, so the planner can inline it. NULL is not
# live (the column is NOT NULL, so this only matters for a parent-less child,
# which the FK rejects anyway).
IS_LIVE_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION coord.merge_proposal_status_is_live(status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
    SELECT $1 IS NOT NULL
       AND $1 <> ALL (ARRAY['merged', 'conflict', 'cancelled', 'shadow-landed']::text[])
$fn$
"""

# Step 3. D4: refuse first, then cancel every loser of every live duplicate
# group, naming its keeper.
CLEANUP_SQL = """
DO $cleanup$
DECLARE
    loser_ids  uuid[];
    keeper_ids uuid[];
    refused    text;
    n_cancelled integer;
BEGIN
    WITH live AS (
        SELECT r.repo, r.branch, r.head_sha, p.proposal_id,
               CASE p.status
                   WHEN 'landing'            THEN 0
                   WHEN 'awaiting-ci'        THEN 1
                   WHEN 'speculative-ci'     THEN 2
                   WHEN 'dry-rebasing'       THEN 3
                   WHEN 'blocked-by-overlap' THEN 4
                   WHEN 'queued'             THEN 5
                   ELSE 6
               END AS advance_rank
          FROM coord.merge_proposals p
          JOIN coord.merge_proposal_repos r ON r.proposal_id = p.proposal_id
         WHERE coord.merge_proposal_status_is_live(p.status)
    ), ranked AS (
        SELECT l.proposal_id,
               row_number()   OVER w AS rn,
               first_value(l.proposal_id) OVER w AS keeper_id
          FROM live l
        WINDOW w AS (PARTITION BY l.repo, l.branch, l.head_sha
                     ORDER BY l.advance_rank, l.proposal_id)
    ), losers AS (
        SELECT DISTINCT ON (proposal_id) proposal_id, keeper_id
          FROM ranked
         WHERE rn > 1
         ORDER BY proposal_id, keeper_id
    )
    SELECT array_agg(proposal_id ORDER BY proposal_id),
           array_agg(keeper_id   ORDER BY proposal_id)
      INTO loser_ids, keeper_ids
      FROM losers;

    IF loser_ids IS NULL THEN
        RAISE NOTICE 'livehead_01: no live duplicate proposals; nothing cancelled';
        RETURN;
    END IF;

    SELECT string_agg(
               format('%s (%s)', p.proposal_id,
                      concat_ws(', ',
                          CASE WHEN p.batch_id IS NOT NULL
                               THEN 'batch member of ' || p.batch_id END,
                          CASE WHEN c.n_repos > 1
                               THEN 'spans ' || c.n_repos || ' repos' END,
                          CASE WHEN p.status NOT IN ('queued', 'blocked-by-overlap')
                               THEN 'status ' || p.status END)),
               '; ' ORDER BY p.proposal_id)
      INTO refused
      FROM coord.merge_proposals p
      CROSS JOIN LATERAL (
          SELECT count(*) AS n_repos
            FROM coord.merge_proposal_repos x
           WHERE x.proposal_id = p.proposal_id
      ) c
     WHERE p.proposal_id = ANY (loser_ids)
       AND (p.batch_id IS NOT NULL
            OR c.n_repos > 1
            OR p.status NOT IN ('queued', 'blocked-by-overlap'));

    IF refused IS NOT NULL THEN
        RAISE EXCEPTION 'livehead_01 refuses: cancelling these duplicate live merge proposals would touch a batch, another repo, or a row coord is already working on: %', refused
            USING HINT = 'Resolve these rows explicitly (plan 2026-11-23-coord-one-live-merge-proposal-per-head-is-a-database-invariant, D4), then re-run the migration. Nothing was cancelled.';
    END IF;

    UPDATE coord.merge_proposals p
       SET status       = 'cancelled',
           cancelled_at = now(),
           updated_at   = now(),
           error        = format(
               'duplicate live proposal for this head; kept %s (alembic livehead_01)',
               l.keeper_id)
      FROM unnest(loser_ids, keeper_ids) AS l(proposal_id, keeper_id)
     WHERE p.proposal_id = l.proposal_id;
    GET DIAGNOSTICS n_cancelled = ROW_COUNT;
    RAISE NOTICE 'livehead_01: cancelled % duplicate live proposal(s): %',
        n_cancelled, loser_ids;
END
$cleanup$
"""

# Step 4. Catalog-only add (constant default), then the backfill — AFTER the
# cleanup, so every cancelled loser reads false.
ADD_COLUMN_SQL = (
    "ALTER TABLE coord.merge_proposal_repos "
    "ADD COLUMN IF NOT EXISTS proposal_live boolean NOT NULL DEFAULT false"
)

BACKFILL_SQL = """
UPDATE coord.merge_proposal_repos r
   SET proposal_live = coord.merge_proposal_status_is_live(p.status)
  FROM coord.merge_proposals p
 WHERE p.proposal_id = r.proposal_id
   AND r.proposal_live IS DISTINCT FROM coord.merge_proposal_status_is_live(p.status)
"""

# Step 5. Both trigger functions pin their search_path so a caller's
# search_path cannot resolve a name to another object. A trigger error aborts
# the writer's statement — for the parent trigger that is the point (a revive
# at a held head raises 23505); neither function can fail otherwise on a row
# the tables accept.
TRIGGERS_SQL = """
CREATE OR REPLACE FUNCTION coord.merge_proposal_repos_set_proposal_live()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, coord
AS $fn$
DECLARE
    parent_status text;
BEGIN
    IF TG_OP = 'INSERT' OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id THEN
        -- A new child: wait out any in-flight status change on the parent,
        -- so a concurrent cancel cannot leave this row a stale `true`.
        SELECT p.status INTO parent_status
          FROM coord.merge_proposals p
         WHERE p.proposal_id = NEW.proposal_id
           FOR SHARE;
    ELSE
        SELECT p.status INTO parent_status
          FROM coord.merge_proposals p
         WHERE p.proposal_id = NEW.proposal_id;
    END IF;
    NEW.proposal_live := coord.merge_proposal_status_is_live(parent_status);
    RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION coord.merge_proposals_propagate_proposal_live()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, coord
AS $fn$
BEGIN
    UPDATE coord.merge_proposal_repos r
       SET proposal_live = coord.merge_proposal_status_is_live(NEW.status)
     WHERE r.proposal_id = NEW.proposal_id;
    RETURN NULL;
END
$fn$;

CREATE OR REPLACE TRIGGER trg_merge_proposal_repos_proposal_live
    BEFORE INSERT OR UPDATE ON coord.merge_proposal_repos
    FOR EACH ROW
    EXECUTE FUNCTION coord.merge_proposal_repos_set_proposal_live();

CREATE OR REPLACE TRIGGER trg_merge_proposals_propagate_live
    AFTER UPDATE OF status ON coord.merge_proposals
    FOR EACH ROW
    WHEN (coord.merge_proposal_status_is_live(OLD.status)
          IS DISTINCT FROM coord.merge_proposal_status_is_live(NEW.status))
    EXECUTE FUNCTION coord.merge_proposals_propagate_proposal_live();
"""

# Step 6.
INDEX_SQL = """
CREATE UNIQUE INDEX IF NOT EXISTS uq_merge_proposal_repos_live_head
    ON coord.merge_proposal_repos (repo, branch, head_sha)
    WHERE proposal_live
"""

# The load-bearing order (see the module docstring). Only step 1 takes a new
# table lock, so only step 1 runs under the lock timeout (see upgrade()).
UPGRADE_STEPS: tuple[str, ...] = (
    LOCK_PARENT_SQL,
    LOCK_CHILD_SQL,
    IS_LIVE_FUNCTION_SQL,
    CLEANUP_SQL,
    ADD_COLUMN_SQL,
    BACKFILL_SQL,
    TRIGGERS_SQL,
    INDEX_SQL,
)

_LOCK_STEPS = (LOCK_PARENT_SQL, LOCK_CHILD_SQL)


def upgrade() -> None:
    """Lock, function, cleanup, column + backfill, triggers, index. Idempotent."""
    op.execute(LOCK_TIMEOUT_SQL)
    for statement in _LOCK_STEPS:
        op.execute(statement)
    # SET LOCAL is transaction-scoped and env.py runs the whole batch in one
    # transaction: reset so the bound does not leak onward. Every later step
    # runs under locks step 1 already holds.
    op.execute(RESET_LOCK_TIMEOUT_SQL)
    for statement in UPGRADE_STEPS[len(_LOCK_STEPS) :]:
        op.execute(statement)


def downgrade() -> None:
    """Drop index, triggers, functions and column. Cancelled rows stay cancelled."""
    op.execute(LOCK_TIMEOUT_SQL)
    op.execute("DROP INDEX IF EXISTS coord.uq_merge_proposal_repos_live_head")
    op.execute(
        "DROP TRIGGER IF EXISTS trg_merge_proposals_propagate_live "
        "ON coord.merge_proposals"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_merge_proposal_repos_proposal_live "
        "ON coord.merge_proposal_repos"
    )
    op.execute(
        "DROP FUNCTION IF EXISTS coord.merge_proposals_propagate_proposal_live()"
    )
    op.execute("DROP FUNCTION IF EXISTS coord.merge_proposal_repos_set_proposal_live()")
    op.execute("DROP FUNCTION IF EXISTS coord.merge_proposal_status_is_live(text)")
    op.execute(
        "ALTER TABLE coord.merge_proposal_repos DROP COLUMN IF EXISTS proposal_live"
    )
    op.execute(RESET_LOCK_TIMEOUT_SQL)
