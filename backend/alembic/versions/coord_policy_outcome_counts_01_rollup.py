"""coord.policy_outcome_counts — trigger-maintained rollup of labeled resolution counts

Revision ID: coord_policy_outcome_counts_01
Revises: journey_04_explorations_stop_detail_any_stop
Create Date: 2026-10-30

Phase 1 of plan
``2026-10-30-coord-calibration-counts-fetch-every-labeled-row-per-decision``.

## Why

The number one statement on the production database (PI ``7A5B3A11``, 1.34 AAS
on 2026-10-30, plus its windowed twin ``E458C774`` at 0.43 AAS) is the coord
calibration count::

    SELECT outcome_category, COUNT(*) FROM coord.policy_rule_resolutions
     WHERE resolved_entity->>'decision_domain' = $1
       AND resolved_entity->>'surface' = $2
       AND outcome_category IS NOT NULL
     GROUP BY outcome_category

``idx_policy_rule_resolutions_domain_surface_labeled`` is used, but PostgreSQL
cannot index-only-scan an expression index over a JSONB base column, so every
count is one random heap fetch per labeled row (121,347 rows for the largest
key, about 40 s at the IOPS ceiling), repeated on every decision. The
predecessor plan deliberately left these per-decision callers un-memoized
because a stale count would change behavior, so the counts must stay exact.
This revision provides the exact, incrementally maintained answer: a rollup
table kept current by triggers on the base table.

## What it creates

* ``coord.policy_outcome_counts``: one row per ``(decision_domain, surface,
  decision, tenant_id, policy_id, labeled_hour, outcome_category)`` carrying
  ``n``, the number of labeled resolution rows with that key.
  ``decision_domain`` / ``surface`` / ``decision`` are
  ``resolved_entity->>`` of the same names (the keys the coord readers in
  ``policies/calibration.rs`` filter on). ``labeled_hour`` is
  ``date_trunc('hour', outcome_labeled_at AT TIME ZONE 'UTC')``, a UTC wall
  clock hour as a plain ``timestamp``; it is NULL when ``outcome_labeled_at``
  is NULL, and such rows count toward all-time totals only. Unique index
  ``ux_policy_outcome_counts_key`` over all seven key columns ``NULLS NOT
  DISTINCT`` (PostgreSQL 15+, production is 16.13), so ``ON CONFLICT`` on the
  seven columns works when any of them is NULL. Second index
  ``ix_policy_outcome_counts_policy_surface (policy_id, surface)`` for the
  policy-scoped reader.
* ``coord.policy_outcome_counts_seeded``: one row per ``(decision_domain,
  surface)`` key coord has seeded, unique ``NULLS NOT DISTINCT``. A reader
  trusts the rollup for a key only when the key is here.
* ``coord.policy_outcome_counts_apply()`` and three statement-level triggers on
  ``coord.policy_rule_resolutions`` that execute it.

Both tables have every key column nullable, so neither can carry a primary key
or a ``REPLICA IDENTITY USING INDEX``. They are set ``REPLICA IDENTITY FULL``
(every column type has a default equality operator), which is what
``tests/test_replica_identity_published_schemas.py`` requires of a table in a
published schema with no primary key. Rows are a handful of narrow columns, so
the extra WAL from FULL is small.

## The FIRST trigger and the FIRST function in the coord chain

Until this revision the house had no ``CREATE TRIGGER`` and no ``CREATE
FUNCTION`` under ``coord`` (``coord_ci_pool_baselines_01`` says so in terms;
coord ``crates/coord-migrations/schema.manifest`` records ``count function 0``
and ``count trigger 0``). The usual alternative, having each writer maintain
the rollup in its own SQL, is rejected here because the writers are many and
the failure is silent. ``outcome_category`` is written by
``decide.rs`` ``label_outcomes_for_device`` (a multi-row UPDATE) and
``label_outcomes_for_device_domain``, by the ``lifecycle_autonomy.rs``
reconcile UPDATE, by test fixtures that INSERT already labeled rows, and rows
leave through the ``table_retention.rs`` 365-day prune. One writer that forgets
the rollup does not error: it silently skews a Beta posterior that gates a
safety decision. A trigger is the one place no writer can bypass.

## Why statement-level triggers with transition tables

Row-level triggers would run the rollup upsert once per affected row: 5,000
times per retention batch, and once per row of a multi-row label UPDATE. The
three triggers are ``AFTER ... FOR EACH STATEMENT`` with transition tables, so
each statement aggregates its own delta once and upserts one row per distinct
key it touched. Three triggers rather than one, because PostgreSQL refuses
transition tables on a trigger with more than one event, and refuses them on a
trigger with a column list (``UPDATE OF outcome_category``). The column list
would also have been wrong: it misses labeled INSERTs and a change to any other
key column.

The function computes a signed delta, ``+1`` for each transition NEW row with
``outcome_category IS NOT NULL`` and ``-1`` for each transition OLD row with
it, grouped by the full seven column key, and drops every group whose sum is
zero. That one rule covers a label (``NULL`` to a category, ``+1``), a relabel
(moves one count between categories), an unlabel (``-1``), a labeled INSERT, an
UPDATE that changes only ``agent_decision`` (``+1 -1`` on the same key, dropped)
and a retention DELETE (``-n``). When the delta is empty, which is every
unlabeled INSERT and every ``agent_decision`` UPDATE, the function returns
before taking any lock or writing anything. Rows whose ``n`` reaches zero are
left in place; coord seeding replaces a key wholesale, so they do not
accumulate meaningfully.

Cost: a transition table makes PostgreSQL capture every affected row of every
INSERT, UPDATE and DELETE on the table into a tuplestore for the statement.
For the single-row hot writers that is one tuple; a 5,000-row retention batch
spills to a temporary file beyond ``work_mem``, once per batch.

The delta is held in a ``coord.policy_outcome_counts[]`` array, so the
function depends on the table row type having exactly the eight columns in
this order. A later revision that adds a column to the rollup must rewrite the
function with it.

## No CHECK on n

``n`` has no ``CHECK (n >= 0)``. The triggers go live before coord has seeded
any key, so a retention DELETE of an old labeled row under an unseeded key
legitimately takes that key below zero. A CHECK would abort the whole
5,000-row prune statement and stall retention. A negative ``n`` is a transient
of unseeded keys only: readers never trust an unseeded key, seeding replaces
the key with the truth, and coord reconcile asserts ``n >= 0`` for seeded keys.

## No backfill here

This revision seeds nothing. A backfill in alembic would race the trigger it
just installed: a row labeled between trigger install and the backfill
snapshot of its batch would be counted twice (label time is independent of
``resolution_id``, a random UUID, so id-range batches are also random heap
I/O), and a multi-minute scan holding a snapshot risks the migrate workflow
waiter deadline. Seeding is coord Phase 2, per key, behind the fence below.

## The seeding fence: advisory lock class 774177001

For each non-empty ``(decision_domain, surface)`` group in its delta the
function takes::

    pg_advisory_xact_lock(774177001,
        hashtext(coalesce(decision_domain, '') || '|' || coalesce(surface, '')))

before it upserts. Class id ``774177001`` is reserved for this rollup. coord
seeder takes the SAME lock, then in a later statement (a fresh READ COMMITTED
snapshot) recounts the key from the base table, deletes the key rollup rows,
inserts the truth and records the key in ``_seeded``, all in one transaction.
A labeling transaction whose trigger took the lock first has committed before
that snapshot, so its row is in the recount and its earlier ``+1`` is
overwritten; one whose trigger arrives later blocks on the lock, is invisible
to the recount, and applies its ``+1`` after the seeder commits. Only label
writes and labeled-row deletes of that one key wait. The lock is taken in the
statement trigger, so it is held to the end of the writing transaction.

The locks are taken in ascending order of the lock key itself (the
``hashtext`` value), not of the text key. Both orders are consistent across
statements, but ordering by the lock key is also deadlock-free when two text
keys hash to the same lock. The seeder takes one key lock per transaction, so
the order is internal to this function.

## Locking on the hot table, and why the triggers are in an autocommit block

``CREATE TRIGGER`` takes ``SHARE ROW EXCLUSIVE`` on
``coord.policy_rule_resolutions`` (4.97 M rows, 8.9 GB heap, written on every
decision). env.py runs a whole upgrade batch in ONE transaction, so a trigger
created in it would hold that lock until the batch commits, and its queued
request would sit behind the 21 to 48 s calibration counts and stall every
writer behind it. So the function and the triggers are created inside
``op.get_context().autocommit_block()`` with ``SET lock_timeout = '3s'``, and
the three ``CREATE OR REPLACE TRIGGER`` statements run in one DO block that
retries ``lock_not_available`` (55P03) up to 10 attempts with a growing pause
(worst case about 52 s, far inside the migrate waiter deadline), then re-raises.
The three triggers are created in one subtransaction, so they appear together
or not at all. ``lock_timeout`` is RESET afterwards (env.py also resets it
after every revision).

``CREATE OR REPLACE TRIGGER`` (PostgreSQL 14+) is what makes a retry, or a
re-run after a partial apply, idempotent. ``DROP TRIGGER IF EXISTS`` would take
``ACCESS EXCLUSIVE`` on the table even when no trigger exists, blocking every
reader while queued; ``CREATE OR REPLACE`` takes the same ``SHARE ROW
EXCLUSIVE`` as a plain create. The two new tables are created in the normal
batch transaction: they are new and nothing references them.

## Downgrade

Drops the triggers (``ACCESS EXCLUSIVE``, so the same bounded retry), the
function, then both tables, all inside an autocommit block.

## Head choice

``down_revision`` is ``journey_04_explorations_stop_detail_any_stop``, the
single head of this worktree when authored. If main has moved before it
lands, re-point ``down_revision``, the ``Revises:`` header and
``_PARENT_REVISION_ID`` in the migration test at the new single head.

## Merge-train classifier disposition

Expected to classify Reject: a DO block, ``CREATE FUNCTION`` and ``CREATE
TRIGGER`` are not forms the classifier recognises, and ``downgrade()`` drops
tables. Every SQL string is a static literal.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_policy_outcome_counts_01"
down_revision: str | Sequence[str] | None = (
    "journey_04_explorations_stop_detail_any_stop"
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Create the rollup tables, then the function and triggers outside the batch."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.policy_outcome_counts (
            decision_domain   TEXT,
            surface           TEXT,
            decision          TEXT,
            tenant_id         UUID NOT NULL,
            policy_id         UUID NOT NULL,
            labeled_hour      TIMESTAMP,
            outcome_category  TEXT NOT NULL,
            n                 BIGINT NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_policy_outcome_counts_key
            ON coord.policy_outcome_counts (
                decision_domain, surface, decision, tenant_id, policy_id,
                labeled_hour, outcome_category
            ) NULLS NOT DISTINCT
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_policy_outcome_counts_policy_surface
            ON coord.policy_outcome_counts (policy_id, surface)
        """
    )
    op.execute("ALTER TABLE coord.policy_outcome_counts REPLICA IDENTITY FULL")
    op.execute(
        """
        COMMENT ON TABLE coord.policy_outcome_counts IS
            'Labeled coord.policy_rule_resolutions rows counted per (decision_domain, surface, decision, tenant_id, policy_id, labeled_hour, outcome_category). Maintained by the policy_outcome_counts_apply statement triggers; seeded per (decision_domain, surface) by coord. Trust a key only when it is in policy_outcome_counts_seeded: n may be transiently negative for an unseeded key.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.policy_outcome_counts.labeled_hour IS
            'date_trunc of outcome_labeled_at to the hour, in UTC, as a plain timestamp. NULL when outcome_labeled_at is NULL; such rows count toward all-time totals only.'
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.policy_outcome_counts_seeded (
            decision_domain  TEXT,
            surface          TEXT,
            seeded_at        TIMESTAMPTZ NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_policy_outcome_counts_seeded_key
            ON coord.policy_outcome_counts_seeded (decision_domain, surface)
            NULLS NOT DISTINCT
        """
    )
    op.execute("ALTER TABLE coord.policy_outcome_counts_seeded REPLICA IDENTITY FULL")
    op.execute(
        """
        COMMENT ON TABLE coord.policy_outcome_counts_seeded IS
            'The (decision_domain, surface) keys coord has seeded into policy_outcome_counts under advisory lock class 774177001. A reader serves a key from the rollup only when it is listed here.'
        """
    )

    # The function and the triggers run OUTSIDE the batch transaction, so the
    # SHARE ROW EXCLUSIVE lock on the hot base table is held for one short
    # statement and not until the batch commits.
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '3s'")
        try:
            op.execute(
                """
                CREATE OR REPLACE FUNCTION coord.policy_outcome_counts_apply()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $fn$
                DECLARE
                    delta coord.policy_outcome_counts[];
                    k record;
                BEGIN
                    IF TG_OP = 'INSERT' THEN
                        SELECT array_agg(ROW(g.decision_domain, g.surface, g.decision,
                                             g.tenant_id, g.policy_id, g.labeled_hour,
                                             g.outcome_category, g.n
                                         )::coord.policy_outcome_counts)
                          INTO delta
                          FROM (
                            SELECT s.decision_domain, s.surface, s.decision,
                                   s.tenant_id, s.policy_id, s.labeled_hour,
                                   s.outcome_category, sum(s.sign)::bigint AS n
                              FROM (
                                SELECT r.resolved_entity->>'decision_domain' AS decision_domain,
                                       r.resolved_entity->>'surface' AS surface,
                                       r.resolved_entity->>'decision' AS decision,
                                       r.tenant_id, r.policy_id,
                                       date_trunc('hour', r.outcome_labeled_at AT TIME ZONE 'UTC') AS labeled_hour,
                                       r.outcome_category,
                                       1 AS sign
                                  FROM new_rows r
                                 WHERE r.outcome_category IS NOT NULL
                              ) s
                             GROUP BY 1, 2, 3, 4, 5, 6, 7
                            HAVING sum(s.sign) <> 0
                          ) g;
                    ELSIF TG_OP = 'UPDATE' THEN
                        SELECT array_agg(ROW(g.decision_domain, g.surface, g.decision,
                                             g.tenant_id, g.policy_id, g.labeled_hour,
                                             g.outcome_category, g.n
                                         )::coord.policy_outcome_counts)
                          INTO delta
                          FROM (
                            SELECT s.decision_domain, s.surface, s.decision,
                                   s.tenant_id, s.policy_id, s.labeled_hour,
                                   s.outcome_category, sum(s.sign)::bigint AS n
                              FROM (
                                SELECT r.resolved_entity->>'decision_domain' AS decision_domain,
                                       r.resolved_entity->>'surface' AS surface,
                                       r.resolved_entity->>'decision' AS decision,
                                       r.tenant_id, r.policy_id,
                                       date_trunc('hour', r.outcome_labeled_at AT TIME ZONE 'UTC') AS labeled_hour,
                                       r.outcome_category,
                                       1 AS sign
                                  FROM new_rows r
                                 WHERE r.outcome_category IS NOT NULL
                                UNION ALL
                                SELECT r.resolved_entity->>'decision_domain',
                                       r.resolved_entity->>'surface',
                                       r.resolved_entity->>'decision',
                                       r.tenant_id, r.policy_id,
                                       date_trunc('hour', r.outcome_labeled_at AT TIME ZONE 'UTC'),
                                       r.outcome_category,
                                       -1
                                  FROM old_rows r
                                 WHERE r.outcome_category IS NOT NULL
                              ) s
                             GROUP BY 1, 2, 3, 4, 5, 6, 7
                            HAVING sum(s.sign) <> 0
                          ) g;
                    ELSIF TG_OP = 'DELETE' THEN
                        SELECT array_agg(ROW(g.decision_domain, g.surface, g.decision,
                                             g.tenant_id, g.policy_id, g.labeled_hour,
                                             g.outcome_category, g.n
                                         )::coord.policy_outcome_counts)
                          INTO delta
                          FROM (
                            SELECT s.decision_domain, s.surface, s.decision,
                                   s.tenant_id, s.policy_id, s.labeled_hour,
                                   s.outcome_category, sum(s.sign)::bigint AS n
                              FROM (
                                SELECT r.resolved_entity->>'decision_domain' AS decision_domain,
                                       r.resolved_entity->>'surface' AS surface,
                                       r.resolved_entity->>'decision' AS decision,
                                       r.tenant_id, r.policy_id,
                                       date_trunc('hour', r.outcome_labeled_at AT TIME ZONE 'UTC') AS labeled_hour,
                                       r.outcome_category,
                                       -1 AS sign
                                  FROM old_rows r
                                 WHERE r.outcome_category IS NOT NULL
                              ) s
                             GROUP BY 1, 2, 3, 4, 5, 6, 7
                            HAVING sum(s.sign) <> 0
                          ) g;
                    END IF;

                    IF delta IS NULL THEN
                        RETURN NULL;
                    END IF;

                    -- Seeding fence: one advisory lock per (decision_domain,
                    -- surface) key, ascending by lock key so concurrent
                    -- statements cannot deadlock, even on a hash collision.
                    FOR k IN
                        SELECT DISTINCT pg_catalog.hashtext(
                                   coalesce(x.decision_domain, '') || '|' || coalesce(x.surface, '')
                               ) AS lock_key
                          FROM unnest(delta) AS x
                         ORDER BY 1
                    LOOP
                        PERFORM pg_catalog.pg_advisory_xact_lock(774177001, k.lock_key);
                    END LOOP;

                    INSERT INTO coord.policy_outcome_counts AS c (
                        decision_domain, surface, decision, tenant_id, policy_id,
                        labeled_hour, outcome_category, n
                    )
                    SELECT x.decision_domain, x.surface, x.decision, x.tenant_id,
                           x.policy_id, x.labeled_hour, x.outcome_category, x.n
                      FROM unnest(delta) AS x
                     ORDER BY x.decision_domain, x.surface, x.decision, x.tenant_id,
                              x.policy_id, x.labeled_hour, x.outcome_category
                    ON CONFLICT (decision_domain, surface, decision, tenant_id,
                                 policy_id, labeled_hour, outcome_category)
                    DO UPDATE SET n = c.n + EXCLUDED.n;

                    RETURN NULL;
                END
                $fn$
                """
            )
            op.execute(
                """
                COMMENT ON FUNCTION coord.policy_outcome_counts_apply() IS
                    'Statement trigger body maintaining coord.policy_outcome_counts from the transition tables of coord.policy_rule_resolutions: +1 per labeled NEW row, -1 per labeled OLD row, per full rollup key, zero-sum groups dropped. Takes pg_advisory_xact_lock(774177001, hashtext(coalesce(decision_domain, empty) || pipe || coalesce(surface, empty))) per key before upserting: the coord seeding fence.'
                """
            )
            op.execute(
                """
                DO $retry$
                DECLARE
                    attempt integer := 0;
                BEGIN
                    LOOP
                        attempt := attempt + 1;
                        BEGIN
                            CREATE OR REPLACE TRIGGER trg_policy_outcome_counts_ins
                                AFTER INSERT ON coord.policy_rule_resolutions
                                REFERENCING NEW TABLE AS new_rows
                                FOR EACH STATEMENT
                                EXECUTE FUNCTION coord.policy_outcome_counts_apply();
                            CREATE OR REPLACE TRIGGER trg_policy_outcome_counts_upd
                                AFTER UPDATE ON coord.policy_rule_resolutions
                                REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
                                FOR EACH STATEMENT
                                EXECUTE FUNCTION coord.policy_outcome_counts_apply();
                            CREATE OR REPLACE TRIGGER trg_policy_outcome_counts_del
                                AFTER DELETE ON coord.policy_rule_resolutions
                                REFERENCING OLD TABLE AS old_rows
                                FOR EACH STATEMENT
                                EXECUTE FUNCTION coord.policy_outcome_counts_apply();
                            EXIT;
                        EXCEPTION WHEN lock_not_available THEN
                            IF attempt >= 10 THEN
                                RAISE;
                            END IF;
                            RAISE NOTICE 'policy_outcome_counts triggers: lock_timeout on attempt %, retrying', attempt;
                            PERFORM pg_catalog.pg_sleep(0.5 * attempt);
                        END;
                    END LOOP;
                END
                $retry$
                """
            )
        finally:
            op.execute("RESET lock_timeout")


def downgrade() -> None:
    """Drop the triggers (bounded retry), the function, then both tables."""
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '3s'")
        try:
            op.execute(
                """
                DO $retry$
                DECLARE
                    attempt integer := 0;
                BEGIN
                    LOOP
                        attempt := attempt + 1;
                        BEGIN
                            DROP TRIGGER IF EXISTS trg_policy_outcome_counts_ins
                                ON coord.policy_rule_resolutions;
                            DROP TRIGGER IF EXISTS trg_policy_outcome_counts_upd
                                ON coord.policy_rule_resolutions;
                            DROP TRIGGER IF EXISTS trg_policy_outcome_counts_del
                                ON coord.policy_rule_resolutions;
                            EXIT;
                        EXCEPTION WHEN lock_not_available THEN
                            IF attempt >= 10 THEN
                                RAISE;
                            END IF;
                            RAISE NOTICE 'policy_outcome_counts triggers: lock_timeout on attempt %, retrying', attempt;
                            PERFORM pg_catalog.pg_sleep(0.5 * attempt);
                        END;
                    END LOOP;
                END
                $retry$
                """
            )
            op.execute("DROP FUNCTION IF EXISTS coord.policy_outcome_counts_apply()")
            op.execute("DROP TABLE IF EXISTS coord.policy_outcome_counts_seeded")
            op.execute("DROP TABLE IF EXISTS coord.policy_outcome_counts")
        finally:
            op.execute("RESET lock_timeout")
