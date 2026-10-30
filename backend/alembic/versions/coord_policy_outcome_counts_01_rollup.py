"""coord.policy_outcome_counts — trigger-maintained rollup of labeled resolution counts

Revision ID: coord_policy_outcome_counts_01
Revises: slice_tel_01
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
  scoped to one such key trusts the rollup only when the key is here.
* ``coord.policy_outcome_counts_seed_state``: a singleton (``id boolean
  PRIMARY KEY DEFAULT true CHECK (id)``) whose ``full_pass_completed_at`` the
  coord seeder sets once one complete enumeration pass over every labeled key
  has finished. A reader NOT scoped to one ``(decision_domain, surface)`` key
  (``fetch_outcome_counts(policy_id, surface)`` spans domains) uses the rollup
  only when that column is NOT NULL. After the triggers are installed every
  new label is counted by them, so only labels that predate the triggers need
  seeding, and one completed pass seeds all of them.
* ``coord.policy_outcome_counts_apply()`` and four statement-level triggers on
  ``coord.policy_rule_resolutions`` that execute it.

The two key-only tables have every key column nullable, so neither can carry a
primary key or a ``REPLICA IDENTITY USING INDEX``. They are set ``REPLICA
IDENTITY FULL`` (every column type has a default equality operator), which is
what ``tests/test_replica_identity_published_schemas.py`` requires of a table
in a published schema with no primary key. Rows are a handful of narrow
columns, so the extra WAL from FULL is small. ``_seed_state`` has a primary
key, so its DEFAULT identity already satisfies that guard.

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
three row-changing triggers are ``AFTER ... FOR EACH STATEMENT`` with transition tables, so
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

## TRUNCATE

A fourth trigger, ``trg_policy_outcome_counts_trunc`` (``AFTER TRUNCATE ...
FOR EACH STATEMENT``, no transition table: PostgreSQL has none for TRUNCATE),
runs the same function, whose ``TRUNCATE`` branch empties
``policy_outcome_counts`` and ``policy_outcome_counts_seeded`` and sets
``seed_state.full_pass_completed_at`` back to NULL. Without it a TRUNCATE of
the base table (no production code issues one; test suites do) would leave
every seeded key trusted and wrong. The branch takes no fence lock. Its
serialization against the seeder comes from lock ORDER, which is a contract
with coord: the seeder takes ACCESS SHARE on the base table FIRST, before it
locks ``seed_state`` (``FOR SHARE``) or writes ``_seeded``. A TRUNCATE holds
ACCESS EXCLUSIVE on the base table before its trigger runs, so it waits for
any seeder transaction that already holds that ACCESS SHARE to end, and a
seeder that starts later waits for the TRUNCATE. A seeder that locked
``seed_state`` before touching the base table would instead meet the
TRUNCATE in the opposite order, and PostgreSQL would detect a deadlock and
abort one of them. The branch clears ``full_pass_completed_at`` before it
deletes, for the same reason as the downgrade below. It uses DELETE rather
than TRUNCATE on the rollup tables so it takes no ACCESS EXCLUSIVE on them.

## Windowed readers stay exact

Hourly buckets alone cannot answer the windowed reader, whose predicate is
second-exact (``outcome_labeled_at >= now() - N days``). coord sums the
buckets of full hours strictly after the hour of the cutoff from this rollup,
and adds a raw count of the base rows labeled in ``[cutoff, the next hour
boundary)`` through ``ix_proclog_policy_rule_resolutions_outcome_labeled_at``,
which is at most one hour of labels. The windowed count therefore stays exact.

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

## The seeding fence: advisory lock class 774177001, SHARED in the trigger

For each non-empty ``(decision_domain, surface)`` group in its delta the
function takes::

    pg_advisory_xact_lock_shared(774177001,
        hashtext(coalesce(decision_domain, '') || '|' || coalesce(surface, '')))

before it upserts. Class id ``774177001`` is reserved for this rollup, and the
key is computed in SQL with exactly that expression on both sides. The trigger
takes the lock SHARED, so concurrent labelers of one hot key do not serialize
on it; they serialize only on the rollup row itself, via ``ON CONFLICT DO
UPDATE``. Each statement upserts in one fixed key order, so two STATEMENTS
cannot deadlock on rollup rows. That holds per statement, not per transaction:
it relies on every label and labeled-row delete writer staying a
single-statement transaction, as all of them are today. A writer that labels
or deletes rows of different keys in two statements of one transaction can
meet another doing the reverse, and PostgreSQL then detects the deadlock and
aborts one of them. Keep those writers single-statement. The coord seeder (and reconcile) take the SAME
lock EXCLUSIVE, then in a later statement (a fresh READ COMMITTED snapshot)
recount the key from the base table, delete the key rollup rows, insert the
truth and record the key in ``_seeded``, all in one transaction. A labeling
transaction whose trigger took the shared lock first has committed before the
seeder obtains the exclusive lock, so its row is in the recount and its earlier
``+1`` is overwritten; one whose trigger arrives later blocks on the lock, is
invisible to the recount, and applies its ``+1`` after the seeder commits. Only
label writes and labeled-row deletes of the key being seeded wait. The lock is
taken in the statement trigger, so it is held to the end of the writing
transaction.

The locks are taken in ascending order of the lock key itself (the
``hashtext`` value), not of the text key. Shared locks never conflict with
each other, so the order matters only against an exclusive holder; the seeder
takes one key lock per transaction, so the order is internal to this function.

## Trigger errors abort the writer

Any error raised in ``policy_outcome_counts_apply()`` aborts the base
statement that fired it: a label UPDATE, a resolution INSERT, a 5,000-row
retention DELETE. That is the price of a rollup no writer can bypass, and it
is why the function has no CHECK to trip, upserts with ``ON CONFLICT``, and
pins ``SET search_path = pg_catalog, coord`` so a caller search_path cannot
resolve one of its names to another object. Anyone changing the function
must keep it unable to fail on any row the base table accepts.

Row level security: the rollup tables carry ``tenant_id`` but no policies,
like the rest of coord today. When coord adopts RLS tenant roles for
``coord.policy_rule_resolutions``, these three tables must get matching
policies in the same change, or the rollup becomes a cross-tenant read path
(and a trigger running as a restricted role would fail, aborting the writer).

## Locking on the hot table, and why the triggers are in an autocommit block

``CREATE TRIGGER`` takes ``SHARE ROW EXCLUSIVE`` on
``coord.policy_rule_resolutions`` (4.97 M rows, 8.9 GB heap, written on every
decision). That mode does NOT conflict with the ``ACCESS SHARE`` of the 20 to
50 s calibration count reads; it conflicts with ``ROW EXCLUSIVE`` (every
INSERT, UPDATE and DELETE) and ``SHARE UPDATE EXCLUSIVE`` (autovacuum), so it
queues behind in-flight writers and autovacuum, and while queued it stalls
every new writer behind it. env.py runs a whole upgrade batch in ONE
transaction, so a trigger created in the batch would also HOLD the lock until
the batch commits, stalling every writer for the rest of the batch. So the
function and the triggers are created inside
``op.get_context().autocommit_block()``, where each statement commits on its
own, with ``SET lock_timeout = '500ms'`` so a queued request stalls writers for
at most half a second at a time. The four ``CREATE OR REPLACE TRIGGER``
statements run in one DO block that retries ``lock_not_available`` (55P03)
with a pause of ``least(0.1 * attempt, 2)`` s, up to 40 attempts (about 80 s
worst case, far inside the migrate waiter deadline), then re-raises. The four
triggers are created in one subtransaction, so they appear together or not at
all. ``lock_timeout`` is RESET afterwards (env.py also resets it after every
revision).

The attempt budget can be lowered for a test through the custom setting
``qontinui.policy_outcome_counts_ddl_attempts`` (unset in production, so the
defaults above apply). It is read inside the DO block so every SQL string
stays a static literal.

``CREATE OR REPLACE TRIGGER`` (PostgreSQL 14+) is what makes a retry, or a
re-run after a partial apply, idempotent. ``DROP TRIGGER IF EXISTS`` would take
``ACCESS EXCLUSIVE`` on the table even when no trigger exists;
``CREATE OR REPLACE`` takes the same ``SHARE ROW EXCLUSIVE`` as a plain create.
The new tables are created in the normal batch transaction: they are new and
nothing references them.

## Downgrade

``DROP TRIGGER`` takes ``ACCESS EXCLUSIVE``, which DOES conflict with the
count reads, and one of those is almost always in flight. So the downgrade
first, in ONE transaction, replaces the function body with ``RETURN NULL`` (no
base-table lock at all, which makes the triggers inert at once) AND revokes
all trust in the rollup: it empties ``_seeded`` and clears
``seed_state.full_pass_completed_at``. The two must commit together: a rollup
that stopped counting while still marked seeded would be served to coord as
the truth if the trigger drops below then failed.

Inside that transaction the ``seed_state`` UPDATE runs BEFORE the ``_seeded``
DELETE. Under READ COMMITTED each PL/pgSQL statement takes a fresh snapshot.
A seeder holding the ``seed_state`` row ``FOR SHARE`` can insert a NEW
``_seeded`` row; were the DELETE first, its snapshot would not see that
uncommitted row, the seeder would commit while the UPDATE waited, and a
trusted ``_seeded`` row would survive over an inert trigger. With the UPDATE
first it queues behind the seeder ``FOR SHARE`` lock until the seeder commits,
and the DELETE that follows takes a fresh snapshot that sees the committed
row.

The reorder covers a seeder already holding the row; a seeder that takes
``FOR SHARE`` after this transaction commits is fenced by coord's side of the
contract instead: every coord transaction that writes a trust marker
(``_seeded`` or ``full_pass_completed_at``) first takes ``ACCESS SHARE`` on
``coord.policy_rule_resolutions``, then ``seed_state`` ``FOR SHARE`` (held for
that one per-key transaction only, never across a whole pass, so this UPDATE
never waits for more than one key's recount), then verifies in a later
statement that maintenance is live -- the singleton row exists, this
function's body is the real one (it takes ``pg_advisory_xact_lock_shared``),
and all four triggers exist and fire (``tgenabled IN ('O','A')``) -- and
writes no marker otherwise. A neutralised function fails that check, so a
failed downgrade cannot be re-trusted by a later seeder or reconcile.

Coord's windowed readers read the rollup buckets and the raw partial cutoff
hour in ONE statement (one snapshot), with the boundary computed exactly as
the trigger computes it, ``date_trunc('hour', cutoff AT TIME ZONE 'UTC')``,
so a label committed between two reads is neither double-counted nor missed.

Only then does the downgrade drop the four
triggers with ``lock_timeout = '200ms'`` and up to 100 attempts with the same
capped backoff (about 210 s worst case), then drops the function and the three
tables. Everything runs inside an autocommit block.

## Head choice

``down_revision`` is ``slice_tel_01``, the
single head of origin/main when last re-pointed. If main has moved before it
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
    "slice_tel_01"
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
            'Labeled coord.policy_rule_resolutions rows counted per (decision_domain, surface, decision, tenant_id, policy_id, labeled_hour, outcome_category). Maintained by the policy_outcome_counts_apply statement triggers; seeded per (decision_domain, surface) by coord. Trust a key only when it is in policy_outcome_counts_seeded (or, for a reader spanning keys, when policy_outcome_counts_seed_state.full_pass_completed_at is set): n may be transiently negative for an unseeded key.'
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
            'The (decision_domain, surface) keys coord has seeded into policy_outcome_counts under advisory lock class 774177001. A reader scoped to one key serves it from the rollup only when it is listed here.'
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.policy_outcome_counts_seed_state (
            id                      BOOLEAN NOT NULL DEFAULT true,
            full_pass_completed_at  TIMESTAMPTZ,
            CONSTRAINT policy_outcome_counts_seed_state_pkey PRIMARY KEY (id),
            CONSTRAINT policy_outcome_counts_seed_state_singleton_check CHECK (id)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.policy_outcome_counts_seed_state IS
            'Singleton, inserted by the migration. full_pass_completed_at is set by the coord seeder when one complete pass over every labeled (decision_domain, surface) key has finished, and cleared by a TRUNCATE of coord.policy_rule_resolutions or by the migration downgrade. A reader not scoped to one key uses the rollup only when it is set; an absent row reads as not seeded.'
        """
    )
    op.execute(
        """
        INSERT INTO coord.policy_outcome_counts_seed_state DEFAULT VALUES
        ON CONFLICT DO NOTHING
        """
    )

    # The function and the triggers run OUTSIDE the batch transaction, so the
    # SHARE ROW EXCLUSIVE lock on the hot base table is held for one short
    # statement and not until the batch commits, and each queued request stalls
    # writers for at most the lock_timeout.
    with op.get_context().autocommit_block():
        op.execute("SET lock_timeout = '500ms'")
        try:
            op.execute(
                """
                CREATE OR REPLACE FUNCTION coord.policy_outcome_counts_apply()
                RETURNS trigger
                LANGUAGE plpgsql
                SET search_path = pg_catalog, coord
                AS $fn$
                DECLARE
                    delta coord.policy_outcome_counts[];
                    k record;
                BEGIN
                    IF TG_OP = 'TRUNCATE' THEN
                        UPDATE coord.policy_outcome_counts_seed_state
                           SET full_pass_completed_at = NULL;
                        DELETE FROM coord.policy_outcome_counts;
                        DELETE FROM coord.policy_outcome_counts_seeded;
                        RETURN NULL;
                    ELSIF TG_OP = 'INSERT' THEN
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

                    -- Seeding fence: one SHARED advisory lock per
                    -- (decision_domain, surface) key, ascending by lock key.
                    -- The coord seeder takes the same lock EXCLUSIVE.
                    FOR k IN
                        SELECT DISTINCT pg_catalog.hashtext(
                                   coalesce(x.decision_domain, '') || '|' || coalesce(x.surface, '')
                               ) AS lock_key
                          FROM unnest(delta) AS x
                         ORDER BY 1
                    LOOP
                        PERFORM pg_catalog.pg_advisory_xact_lock_shared(774177001, k.lock_key);
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
                    'Statement trigger body maintaining coord.policy_outcome_counts from the transition tables of coord.policy_rule_resolutions: +1 per labeled NEW row, -1 per labeled OLD row, per full rollup key, zero-sum groups dropped. Takes pg_advisory_xact_lock_shared(774177001, hashtext(coalesce(decision_domain, empty) || pipe || coalesce(surface, empty))) per key before upserting: the coord seeding fence, which the seeder takes exclusive. On TRUNCATE empties the rollup and the seeded set and clears seed_state. Any error here aborts the writing statement.'
                """
            )
            op.execute(
                """
                DO $retry$
                DECLARE
                    attempt integer := 0;
                    max_attempts integer := greatest(coalesce(
                        nullif(current_setting('qontinui.policy_outcome_counts_ddl_attempts', true), '')::integer,
                        40), 1);
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
                            CREATE OR REPLACE TRIGGER trg_policy_outcome_counts_trunc
                                AFTER TRUNCATE ON coord.policy_rule_resolutions
                                FOR EACH STATEMENT
                                EXECUTE FUNCTION coord.policy_outcome_counts_apply();
                            EXIT;
                        EXCEPTION WHEN lock_not_available THEN
                            IF attempt >= max_attempts THEN
                                RAISE;
                            END IF;
                            RAISE NOTICE 'policy_outcome_counts triggers: lock_timeout on attempt %, retrying', attempt;
                            PERFORM pg_catalog.pg_sleep(least(0.1 * attempt, 2.0));
                        END;
                    END LOOP;
                END
                $retry$
                """
            )
        finally:
            op.execute("RESET lock_timeout")


def downgrade() -> None:
    """Neutralise the function, drop the triggers (bounded retry), then the rest."""
    with op.get_context().autocommit_block():
        # ONE transaction: the function goes inert (no lock on the base table)
        # and every trust marker is revoked together, so a later failure of the
        # trigger drops cannot leave an inert rollup that still reads as seeded.
        op.execute(
            """
            DO $neutralise$
            BEGIN
                CREATE OR REPLACE FUNCTION coord.policy_outcome_counts_apply()
                RETURNS trigger
                LANGUAGE plpgsql
                SET search_path = pg_catalog, coord
                AS $fn$
                BEGIN
                    RETURN NULL;
                END
                $fn$;
                UPDATE coord.policy_outcome_counts_seed_state
                   SET full_pass_completed_at = NULL;
                DELETE FROM coord.policy_outcome_counts_seeded;
            END
            $neutralise$
            """
        )
        # DROP TRIGGER takes ACCESS EXCLUSIVE, which conflicts with the count
        # reads, so each queued attempt may stall readers for 200 ms at most.
        op.execute("SET lock_timeout = '200ms'")
        try:
            op.execute(
                """
                DO $retry$
                DECLARE
                    attempt integer := 0;
                    max_attempts integer := greatest(coalesce(
                        nullif(current_setting('qontinui.policy_outcome_counts_ddl_attempts', true), '')::integer,
                        100), 1);
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
                            DROP TRIGGER IF EXISTS trg_policy_outcome_counts_trunc
                                ON coord.policy_rule_resolutions;
                            EXIT;
                        EXCEPTION WHEN lock_not_available THEN
                            IF attempt >= max_attempts THEN
                                RAISE;
                            END IF;
                            RAISE NOTICE 'policy_outcome_counts triggers: lock_timeout on attempt %, retrying', attempt;
                            PERFORM pg_catalog.pg_sleep(least(0.1 * attempt, 2.0));
                        END;
                    END LOOP;
                END
                $retry$
                """
            )
            op.execute("DROP FUNCTION IF EXISTS coord.policy_outcome_counts_apply()")
            op.execute("DROP TABLE IF EXISTS coord.policy_outcome_counts_seed_state")
            op.execute("DROP TABLE IF EXISTS coord.policy_outcome_counts_seeded")
            op.execute("DROP TABLE IF EXISTS coord.policy_outcome_counts")
        finally:
            op.execute("RESET lock_timeout")
