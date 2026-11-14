"""coord.policy_outcome_counts — delete a rollup row when its count reaches zero

Revision ID: coord_policy_outcome_counts_02
Revises: outbound_budget_windows_01
Create Date: 2026-11-02

Post-merge follow-up to ``coord_policy_outcome_counts_01``, plan
``2026-10-30-coord-calibration-counts-fetch-every-labeled-row-per-decision``.

## The gap

``coord_policy_outcome_counts_01`` leaves a row in place when its ``n`` reaches
zero and says that "coord seeding replaces a key wholesale, so they do not
accumulate meaningfully". The coord side that was then written does not do
that. Its seeder replaces only keys that are not yet seeded, once each, and its
reconcile replaces only drifted keys, where ``bucket_drift`` reads a row at
``n = 0`` and an absent row as the same value, which is correct for a count. So
nothing ever removes a zero row of a seeded key.

Those rows are made continuously: ``labeled_hour`` is in the key, and the
365-day retention prune takes every hourly bucket to zero as it ages out. Every
bucket a key ever had would therefore stay in the table for good. The readers
sum over all of a key's rows, dropping zero sums only after reading them, so
the cost of each per-decision read would grow without bound with the age of the
key. Removing that kind of growth from the per-decision read is the reason the
rollup exists.

That docstring stays as written. coord's escalate-evidence door clears a single
migration file per PR, and this docstring is the correction.

## The change

``policy_outcome_counts_apply()`` now collects the ``ctid`` of each row its
upsert left at ``n = 0`` and deletes those rows in its next statement. The
hourly buckets, the keys, the fence and the delta arithmetic are unchanged. An
absent row and a row at zero already read the same to every coord reader and to
reconcile, so no coord change is needed.

Addressing the rows by ``ctid`` needs no key match. Four of the seven key columns
are nullable, so a match needs ``IS NOT DISTINCT FROM``, which cannot use the
unique index, and it would read every row of the policy through
``ix_policy_outcome_counts_policy_surface``. ``AND c.n = 0`` stays on the DELETE
as a guard.

A statement that leaves no row at zero, which is every label on a seeded key,
only gains the ``array_agg`` over its own upsert: no extra write and no extra
lock.

## Concurrency

The function runs inside the writer's READ COMMITTED transaction, holding the
SHARED fence lock and, from its upsert, the lock on every row it touched.

* Against another writer of the same row. That writer's ``ON CONFLICT`` waits
  for this transaction. If this one commits the delete, the waiter's upsert
  retries and inserts the row with its own delta. If this one rolls back, the
  row is back and the waiter updates it. Either way the count is exact.
* Against deadlock. The DELETE touches only rows this statement already locked,
  so it adds no new lock order to the one in ``coord_policy_outcome_counts_01``.
* Against the seeder and reconcile. A replace holds the fence EXCLUSIVE, which
  this function waits for before it upserts, so a replace and a zero-row delete
  of one key never interleave. Reconcile's drift check takes no fence, but it
  reads one REPEATABLE READ snapshot and treats an absent row as zero, so a
  zero-row delete cannot read as drift.
* An unseeded key can still go negative and that row stays. Only ``n = 0`` is
  deleted. A row at ``-1`` that a later label takes to zero is deleted, which
  reads the same as the zero it holds.

Trigger errors still abort the writer. The statements added here do not add a
way to fail on a row the base table accepts, and ``coord_tenant`` already holds
DELETE on this table through the default privileges of ``coordrls_01``.

## The coord contract is kept

coord's seeder checks that this function's body contains
``pg_advisory_xact_lock_shared`` and that all four triggers fire before it
writes a trust marker. The body still takes that lock, and this revision does
not touch the triggers. ``CREATE OR REPLACE FUNCTION`` takes no lock on
``coord.policy_rule_resolutions``, so unlike the trigger DDL in
``coord_policy_outcome_counts_01`` it needs no autocommit block or lock_timeout.

## Zero rows that already exist

``upgrade()`` also deletes every row already at ``n = 0``, once. Otherwise a zero
row made earlier would stay if coord seeded its key first, because the seeder
does not revisit a seeded key and reconcile sees no drift. A downgrade followed
by a re-upgrade leaves the same residue. With this delete, the coord seeder
having run first (qontinui-coord#3725, which superseded #3583, landed before
this revision) and a round trip leave only the rare residue described below.

It runs in an autocommit block, after the batch holding the new function has
committed, so no transaction that starts from then on can leave a new zero row,
and its row locks last one statement. ``FOR UPDATE SKIP LOCKED`` means it never waits on a writer and cannot
deadlock with a multi-row upsert, which locks rows in key order while this scan
locks them in heap order. A row it skips is held by a live writer, whose commit
either moves the count or, under the new body, deletes the row. Two rare cases
can still leave a row at zero: a held row whose writer rolls back, and a row that
a transaction already in flight under the old body takes to zero and commits
after this statement's snapshot. Neither makes a count wrong; each costs a later read one
extra row. The table has no index on ``n``, so this scans the whole rollup.
It holds one row per seven-column rollup key, ``labeled_hour`` among them. No
production size was measured for this revision.

It sets no ``lock_timeout``. It never waits on a row lock, and its ROW EXCLUSIVE
table lock waits only behind a conflicting table lock on the rollup: DDL,
TRUNCATE, an explicit LOCK, or VACUUM FULL, CLUSTER or a plain REINDEX. If it fails,
the new function is already committed and the revision is not stamped, and a
re-run is safe: ``CREATE OR REPLACE FUNCTION``, the comment and this DELETE are
all idempotent.

## Downgrade

Restores the exact function body and comment of
``coord_policy_outcome_counts_01``. Rows are untouched: a deleted zero row
already read as zero, and later zero rows simply stay until the next upgrade.

"Exact" means byte for byte, indentation included. Postgres stores the text
between the ``$fn$`` markers verbatim as ``prosrc``, and ``pg_dump`` prints it
verbatim, so a body that differs only in leading whitespace is a different
schema to the ``Migration Reversal Tested`` check. Revision 01 creates the
function inside ``autocommit_block()`` and ``try:``, so its body is indented
eight spaces deeper than a literal at function level. The downgrade literal
carries that indentation, and the migration test compares the two bodies
exactly rather than with whitespace collapsed.

## Merge-train classifier disposition

Expected to classify Reject, as ``coord_policy_outcome_counts_01`` did:
``CREATE FUNCTION`` is not a form the classifier recognises. Every SQL string is
a static literal.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_policy_outcome_counts_02"
down_revision: str | Sequence[str] | None = "outbound_budget_windows_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Make the function delete rows that reach zero, then clear existing ones."""
    op.execute(
        """
        CREATE OR REPLACE FUNCTION coord.policy_outcome_counts_apply()
        RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = pg_catalog, coord
        AS $fn$
        DECLARE
            delta coord.policy_outcome_counts[];
            zero_rows tid[];
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

            -- A row left at n = 0 counts nothing. Delete it here, or it would
            -- stay for good and every later read of its key would scan it.
            -- These rows were locked by the upsert just above, so this cannot
            -- wait on another writer and their ctid cannot change first.
            WITH applied AS (
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
                DO UPDATE SET n = c.n + EXCLUDED.n
                RETURNING c.ctid AS row_tid, c.n
            )
            SELECT array_agg(a.row_tid) INTO zero_rows
              FROM applied a
             WHERE a.n = 0;

            IF zero_rows IS NOT NULL THEN
                DELETE FROM coord.policy_outcome_counts c
                 WHERE c.ctid = ANY (zero_rows) AND c.n = 0;
            END IF;

            RETURN NULL;
        END
        $fn$
        """
    )
    op.execute(
        """
        COMMENT ON FUNCTION coord.policy_outcome_counts_apply() IS
            'Statement trigger body maintaining coord.policy_outcome_counts from the transition tables of coord.policy_rule_resolutions: +1 per labeled NEW row, -1 per labeled OLD row, per full rollup key, zero-sum groups dropped, and a row whose n reaches zero is deleted. Takes pg_advisory_xact_lock_shared(774177001, hashtext(coalesce(decision_domain, empty) || pipe || coalesce(surface, empty))) per key before upserting: the coord seeding fence, which the seeder takes exclusive. On TRUNCATE empties the rollup and the seeded set and clears seed_state. Any error here aborts the writing statement.'
        """
    )
    # The new function must be committed first, so autocommit_block ends the
    # batch transaction before this runs and later transactions use the new body.
    with op.get_context().autocommit_block():
        op.execute(
            """
            DELETE FROM coord.policy_outcome_counts c
             WHERE c.n = 0
               AND c.ctid IN (
                   SELECT z.ctid
                     FROM coord.policy_outcome_counts z
                    WHERE z.n = 0
                      FOR UPDATE SKIP LOCKED
               )
            """
        )


def downgrade() -> None:
    """Restore the function body and comment of coord_policy_outcome_counts_01."""
    # The literal below is indented to match revision 01 byte for byte, because
    # the function body is stored and dumped verbatim. Do not re-indent it.
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
