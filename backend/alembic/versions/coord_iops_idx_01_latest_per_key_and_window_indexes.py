"""coord read-IOPS: indexes for three readers that scan full history per call.

Plan ``2026-09-24-coord-postgres-read-iops-pinned-by-full-history-latest-per-key-scans``.

Root cause
==========

coord's RDS read IOPS sit pinned by a few readers that answer a narrow question
("the best row per key", "how many rows of this kind in a time window", "this
one repo's decisions") by reading an append-only table's WHOLE history on every
call. No existing index leads with the columns those readers filter on, so each
call is a (parallel) sequential scan of the full heap, and the table keeps
growing. The fix is the same for all three: an index whose leading columns are
the reader's equality and range filters, so the call reads only the rows it
answers about. Measurements below are from production on 2026-09-25
(PostgreSQL 16.13) unless marked otherwise.

1. ``idx_client_telemetry_obs_best_evidence``
---------------------------------------------

``coord.client_telemetry_observations (surface, origin, invariant, coverage DESC,
observed_at DESC)``.

Reader: coord ``client_telemetry_observer::latest_observations`` (the MCP tool's
cache fallback and the post-deploy gate's read). Today it sends::

    SELECT DISTINCT ON (invariant) observed_at, surface, origin, release,
           invariant, drift_class, drift_subclass, coverage, provenance,
           credibility, components
      FROM coord.client_telemetry_observations
     WHERE surface = $1 AND origin = $2
     ORDER BY invariant, coverage DESC, observed_at DESC

It picks the BEST-EVIDENCE row per invariant: coverage first, so a coverage-1.0
synthetic observation is not hidden by a newer coverage-0 beacon tick, then
recency. The only indexes are ``(surface, origin, observed_at DESC)`` and
``(observed_at)``, and neither supplies that order. So every call reads all of
the ``(surface, origin)`` history and sorts it to keep four rows.

This index alone does not make that statement cheap. ``DISTINCT ON`` still
visits every row of the ``(surface, origin)`` pair and could at best skip the
sort. In practice the planner does not even do that: on PostgreSQL 16.14, with
120 and with 12,030 interleaved rows per pair and sequential scans disabled, it
kept a bitmap scan plus ``Sort`` for today's statement. It uses this index for
that statement only when bitmap scans are disabled as well. The win comes from a
later coord PR that rewrites the read as a recursive-CTE loose index scan:

* step to the next distinct invariant with
  ``WHERE surface = $1 AND origin = $2 AND invariant > $prev ORDER BY invariant LIMIT 1``
  (an index-only probe on the first three columns), then
* for each invariant, take the best row with
  ``WHERE surface = $1 AND origin = $2 AND invariant = $i
  ORDER BY coverage DESC, observed_at DESC, id DESC LIMIT 1``.

With ``(surface, origin, invariant)`` fixed by equality, the index's remaining
``coverage DESC, observed_at DESC`` columns are already in the order the probe
asks for. So the per-invariant ``LIMIT 1`` is an index probe that stops at the
first row. The ``id DESC`` tie-break is not in the index: the planner adds an
``Incremental Sort`` over the presorted ``(coverage, observed_at)`` prefix,
which only sorts rows tied on both. That is acceptable and much cheaper than
adding a third sort column to every entry. This revision lands FIRST. Without
this index, each probe of the rewrite would read the whole ``(surface, origin)``
range of the ``(surface, origin, observed_at DESC)`` index and filter it by
invariant.

The name is deliberately short. The descriptive
``idx_client_telemetry_observations_surface_origin_invariant_best`` is exactly
63 bytes, which is PostgreSQL's identifier limit, so any longer variant would be
truncated silently. The coord rewrite references this name.

2. ``idx_alerts_kind_first_seen_at``
------------------------------------

``coord.alerts (kind, first_seen_at)``.

Reader: coord ``pr_merge/mod.rs`` ``refresh_phase8_db_stats``, leader-only,
every 60 s::

    SELECT COUNT(*) FILTER (WHERE resolution_action = 'accepted')::BIGINT,
           COUNT(*) FILTER (WHERE resolution_action IS NOT NULL)::BIGINT,
           COUNT(*)::BIGINT
      FROM coord.alerts
     WHERE kind = 'profile_drift_suggestion'
       AND first_seen_at > now() - INTERVAL '90 days'

Measured: a Parallel Seq Scan over 368k rows / 1.17 GB of heap, 129,411 blocks
read, 1.64 s per call. The kind it asks about has ZERO rows, so every block read
is wasted. None of the existing alerts indexes serves ``kind`` plus
``first_seen_at``: pkey, ``idx_alerts_active_severity``,
``idx_alerts_claim_expiry``, ``idx_alerts_paged``,
``idx_alerts_red_main_flake_healed`` (partial, ``red_main`` only),
``idx_alerts_tenant_id`` and ``uq_alerts_active_key``. With this index the
read is a range probe on ``(kind, first_seen_at)``. For a kind with no rows,
that is one descent to an empty leaf range.

It is a full index rather than a partial one on this kind, because two
``pr_merge/slo_routes.rs`` readers have the same shape for other kinds.
``merge_escalation`` is a windowed count. ``kill_switch_fired`` is a windowed
``ORDER BY first_seen_at DESC LIMIT 100``. Both also filter on
``tenant_id = $1``, which is applied on top of the range probe.

3. ``idx_policy_rule_resolutions_repo_pull_repo``
-------------------------------------------------

``coord.policy_rule_resolutions (((resolved_entity -> 'context') ->> 'repo'),
tenant_id) WHERE (resolved_entity ->> 'decision_domain') = 'repo_pull'``.

Reader: coord ``policies/evidence.rs`` ``pull_timing_outcome_by_repo``::

    WITH pulls AS (
        SELECT r.resolved_at AS decided_at,
               r.agent_decision->>'chosen_option' AS opt,
               EXISTS (SELECT 1 FROM coord.conflicts c
                        WHERE c.repo = $1
                          AND c.created_at >  r.resolved_at
                          AND c.created_at <= r.resolved_at + interval '24 hours')
                   AS conflict_after
          FROM coord.policy_rule_resolutions r
         WHERE (r.tenant_id = $2 OR r.tenant_id IS NULL)
           AND r.resolved_entity->>'decision_domain' = 'repo_pull'
           AND r.resolved_entity->'context'->>'repo' = $1
           AND r.agent_decision IS NOT NULL)
    SELECT COUNT(*)::bigint AS total_recorded,
           COUNT(*) FILTER (WHERE opt = 'pulled')::bigint AS pulled_cnt,
           COUNT(*) FILTER (WHERE opt = 'pulled' AND conflict_after)::bigint
               AS pulled_then_conflict
      FROM pulls

Measured for repo ``qontinui-runner`` (71,255 of its rows match, the largest
repo): a Parallel Seq Scan of the 5.5 GB heap, 560,609 blocks read, 98 s. The
existing ``idx_policy_rule_resolutions_tenant_domain_resolved``
``(tenant_id, (resolved_entity->>'decision_domain'), resolved_at DESC)`` cannot
narrow the read to one repo. The ``(tenant_id = $2 OR tenant_id IS NULL)``
disjunction also keeps the planner off it, so it seq-scans. (``tenant_id`` is
NOT NULL on this table, so the ``IS NULL`` arm matches nothing. PostgreSQL 16
still does not prune it.)

The key leads with the query's repo expression, spelled so that it parses to
the same tree as ``resolved_entity->'context'->>'repo'``. The partial predicate
is the query's ``decision_domain = 'repo_pull'`` literal conjunct, so the
planner can prove the query implies it in both the custom and the generic
(``$1``/``$2``) plan. Under today's ``OR``, ``tenant_id`` is applied as a filter
over the one repo's entries. It trails in the key so that a tenant-exact form of
the read can probe both columns.

The query's other literal conjunct, ``agent_decision IS NOT NULL``, is
deliberately NOT in the predicate, and must not be added. PostgreSQL cannot do a
HOT update when the UPDATE changes a column that any index references, and a
predicate column counts. coord UPDATEs ``agent_decision`` after the insert
(``policies/decide.rs``, ``next_step.rs`` and ``spawn_admission.rs``), and no
index references that column today. So adding it here would turn those updates
from HOT into full index-maintaining updates on the most-written table.
Measured on PostgreSQL 16 over 2000 such updates: 0 were HOT with the conjunct
in the predicate. Without it, 1628 were HOT in the code review's run and 779 in
a second run here; the HOT share depends on free space in each page, but the
zero does not. The conjunct would exclude only 7,888 of the 2,653,092
``repo_pull`` rows (about 0.3%). The read applies it as a heap filter instead.

The partial predicate does NOT make this index small. A production count on
2026-09-25 corrected the plan's draft here: ``decision_domain = 'repo_pull'``
matches 2,653,092 of about 3.05M rows, so the index holds about 2.65M entries
(about 87% of the table). The predicate is there to match the reader, not to
save space. The justification is per-call narrowing, from a 5.5 GB parallel seq
scan to one repo's slice of the index plus that repo's heap rows (71,255 at most
today).

Not added: ``coord.conflicts (repo, created_at)``. The plan's draft proposed it
for the correlated ``EXISTS``. The same production measurement shows that
subquery cost 195 buffer hits in total (``coord.conflicts`` has 573 rows, and
``idx_conflicts_repo_status`` already leads with ``repo``). The OUTER scan was
the whole 98 s, so a conflicts index would buy nothing.

Building: locks, I/O, and why the upgrade carries no guards
============================================================

``CREATE INDEX CONCURRENTLY IF NOT EXISTS``, never the plain form. All three
tables take continuous writes, and ``policy_rule_resolutions`` is coord's
most-written table. A plain build takes a ``SHARE`` lock that blocks writes, and
on a 5.5 GB heap that is minutes of stalled decision writes. CONCURRENTLY takes
``SHARE UPDATE EXCLUSIVE`` only. It cannot run inside a transaction, hence
``op.get_context().autocommit_block()``. Precedents: ``coord_pg_overload_idx_01``
/ ``_02``, ``coord_obs_idx_01``. On the CI fresh database the tables are empty
and every statement is instant.

I/O cost. Index 3's CONCURRENTLY build reads the 5.5 GB
``policy_rule_resolutions`` heap TWICE (build, then validate). It does so on a
disk measured pinned at its 3000 IOPS ceiling (queue depth about 30), so coord
latency degrades for the length of the build. Watch the ECS migrator task
directly, not the GitHub job: the job's ``aws ecs wait tasks-stopped`` gives up
at 10 minutes and goes red while the Fargate task keeps building. Do NOT
re-dispatch the migrator while that task is still building: a second
``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` of the same index prints "already
exists, skipping", and on PostgreSQL 16.14 the deadlock detector killed the
FIRST build in 2 of 4 reproductions, leaving it INVALID.

No in-migration guards, deliberately. An earlier draft of this revision
refused while another build was in progress (a ``pg_stat_progress_create_index``
read), dropped and rebuilt a dead INVALID leftover of its own index, and set
``statement_timeout = 0``. coord's migration classifier
(``pr_merge/migration_classifier.rs``) is fail-closed: it admits only DDL it can
prove additive, so it rejects a read through ``op.get_bind().execute``, any
``DROP`` on the upgrade path and a zero ``SET``, and it held that draft off the
auto-land path. This revision is the provable form, exactly the shape of the
precedents above. The hazard those guards covered is handled AFTER the deploy
instead, by a check that must be run and recorded (plan
``2026-09-24-coord-postgres-read-iops-pinned-by-full-history-latest-per-key-scans``,
Phase 2/3 verification):

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname IN ('idx_client_telemetry_obs_best_evidence',
                         'idx_alerts_kind_first_seen_at',
                         'idx_policy_rule_resolutions_repo_pull_repo');

Every row must read ``indisvalid = true``. A killed build leaves an INVALID
index, and ``IF NOT EXISTS`` would skip it on any later run, so it would never
serve a query. The recovery is a follow-up revision that runs
``DROP INDEX CONCURRENTLY IF EXISTS coord.<name>`` and then this revision's
CREATE again, once ``pg_stat_progress_create_index`` shows no build on the
table. Never a plain ``DROP INDEX``.

Additive and expand-only: no table, column or existing index is altered. Every
reader is correct WITHOUT these indexes, only slower, so there is no
column-before-migration hazard with coord. ``downgrade`` drops the three in
reverse order, CONCURRENTLY.

Behaviour test: ``tests/test_coord_iops_idx_01_migration.py``. It proves that
the planner can serve each reader from its index (the alerts and resolutions
readers' exact SQL, and the per-invariant probe of the coord rewrite for
index 1; today's ``DISTINCT ON`` telemetry statement does not choose it on
cost), that each reader's equality and range keys are index conditions
rather than filters, that a near-miss query does not match the partial
predicate, and that downgrade removes exactly the three.

Revision ID: coord_iops_idx_01
Revises: overview_02_authoring_core
Create Date: 2026-09-25

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_iops_idx_01"
down_revision: str | None = "overview_02_authoring_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Three additive CONCURRENTLY indexes; verify ``indisvalid`` after deploy."""
    with op.get_context().autocommit_block():
        # 1. client_telemetry_observer::latest_observations: best row per invariant.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_client_telemetry_obs_best_evidence
            ON coord.client_telemetry_observations (
                surface, origin, invariant, coverage DESC, observed_at DESC
            )
            """
        )
        # 2. pr_merge refresh_phase8_db_stats + slo_routes: kind in a time window.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_alerts_kind_first_seen_at
            ON coord.alerts (kind, first_seen_at)
            """
        )
        # 3. policies/evidence.rs pull_timing_outcome_by_repo: one repo's pulls.
        #    No `agent_decision IS NOT NULL` in the predicate: see the docstring (HOT).
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_policy_rule_resolutions_repo_pull_repo
            ON coord.policy_rule_resolutions (
                ((resolved_entity -> 'context') ->> 'repo'),
                tenant_id
            )
            WHERE (resolved_entity ->> 'decision_domain') = 'repo_pull'
            """
        )


def downgrade() -> None:
    """Drop the three additive indexes in reverse order. Tables and rows survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_policy_rule_resolutions_repo_pull_repo"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_alerts_kind_first_seen_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_client_telemetry_obs_best_evidence"
        )
