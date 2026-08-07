"""coord.alerts retention: one-shot prune of the two historical burst kinds.

Phase 4 (web side) of plan
``qontinui-dev-notes/plans/2026-08-06-coord-alert-heal-lateral-jsonb-aggregate.md``.

``coord.alerts`` has **no production retention path of any kind**. Resolution
sets ``resolved_at = now()`` and leaves the row; the only ``DELETE FROM
coord.alerts`` statements in the coord crate are test fixtures. The table has
therefore only ever grown, and 83% of it is two kinds written in a burst that
ended in June. This revision clears that burst. The ongoing bound on ``dN/dt``
is a coord-side retention worker and is NOT part of this migration — alembic is
the sole author of ``coord.*`` schema and this file is the one-shot half.

⚠️ WHAT THIS DOES **NOT** BUY: it reclaims NO disk space
==========================================================================

**This prune removes tuple-processing CPU. It does NOT shrink any sequential
scan, and it must not be reported as a size win.** That distinction is the
whole robustness gate on this phase, so it is stated first.

``DELETE`` marks tuples dead. ``VACUUM`` then makes their space *reusable*; it
does not return pages to the OS. A sequential scan reads every page of the
**relation file**, so after this migration the scan still reads ~1121 MB of
(now mostly empty) heap. Autovacuum's trailing-page truncation cannot help
either: it only truncates *trailing* all-empty pages, and the burst rows are the
OLDEST — measured id range of the prune set is **4,376 … 8,415,077** against a
whole-table range of **1 … 40,904,732**, i.e. they sit at the FRONT of the heap.

Could the space be reclaimed? Not from here. Measured on the prod instance
2026-08-07 (read-only ECS probe, throwaway task-def, since deregistered):

* ``pg_repack`` — **available but unusable from a migration.** It is present in
  ``pg_available_extensions`` (default_version ``1.5.3``,
  installed_version ``NULL``) and allowed by ``rds.extensions``. But the
  extension only ships server-side support functions; the online rewrite is
  driven by the external ``pg_repack`` **client binary**, which must connect
  from a host that has it installed. The migrator image has neither ``psql``
  nor ``pg_repack``. ``CREATE EXTENSION`` alone rewrites nothing.
* ``pg_squeeze`` — **not available at all**, on either
  ``pg_available_extensions`` or the ``rds.extensions`` allow-list.
* ``VACUUM FULL`` — disqualified. It takes ``ACCESS EXCLUSIVE`` on a live table
  with a 2 s-tick writer.

So the honest accounting is: **live tuples 1,474,452 → ~249,700 (−83%);
relation file ~1121 MB → ~1121 MB (unchanged).** Every statement that scans this
table stops paying per-tuple cost (jsonb traversal, filter evaluation,
aggregation) on 83% of it — which is the right lever on an instance measured at
CPU 39% of wait time — while shared-buffer pressure and scan I/O are
**unchanged**. A separate, operator-run ``pg_repack`` is what would reclaim the
gigabyte, and it is deliberately out of scope here.

One upside of not truncating: the freed space becomes a reservoir. At the
current accretion of ~300–1,300 rows/day it would take years to refill 1.22 M
rows' worth, so the relation file should not grow again for a long time.

Measured census that scopes this prune (prod, 2026-08-07)
==========================================================================

1,474,452 rows / 1259 MB total (1121 MB heap, 137 MB index). Top kinds:

===========================  =========  ==========  ============
kind                             rows     resolved    unresolved
===========================  =========  ==========  ============
``stale_wip``                  663,684     663,530           154
``stale_primary_tree``         562,024     561,488           536
``repo_pull_hold``              94,112      94,075            37
``worktree_unjunctioned``       88,637      88,325           312
===========================  =========  ==========  ============

The two burst kinds are **1,225,708 rows = 83.1%** of the table, and their
first-seen distribution shows the burst plainly: 533,961 + 644,620 rows in
2026-06 alone, against 219 + 120 in 2026-07 and 46 + 55 in 2026-08.

Why the cutoff is 30 days, and why it is not 90
==========================================================================

**A 90-day window would delete exactly ZERO rows.** Measured resolved-row counts
for the two burst kinds, by cutoff:

====== ===========
cutoff       rows
====== ===========
 7 d    1,224,918
14 d    1,224,878
30 d    1,224,752
45 d    1,224,556
60 d      682,627
75 d            0
90 d            0
====== ===========

The whole table is younger than 90 days (oldest ``first_seen_at`` is
2026-05-17), so any 90-day retention is a no-op *today*. The curve is also
essentially flat between 7 and 45 days — the burst resolved in the week of
2026-06-08 (541,871 rows in that one week) and the trickle since is 15–45
rows/week/kind. So the cutoff is not a delicate tuning knob: anything in the
7–45 day band captures the same ~1.2248 M rows.

**30 days** is chosen as the round value in the middle of that flat band. It
captures 1,224,752 of the 1,225,018 resolved burst rows (99.98%) while leaving a
full month of recent history for every reader.

Reconciling the shorter-than-90-day window with the readers of resolved rows
==========================================================================

The plan requires that a window shorter than 90 days be reconciled explicitly
against every consumer of resolved ``coord.alerts`` rows, because the longest
reader window is ``INTERVAL '90 days'``. The reconciliation is that **every
windowed reader is itself kind-scoped, and none of them names a burst kind** —
the sets do not intersect, so no reader's result set changes at any window
length. Verified against ``qontinui-coord`` ``a931477e``:

* ``pr_merge/mod.rs`` ``refresh_phase8_db_stats`` — the 90-day one::

      WHERE kind = 'profile_drift_suggestion'
        AND first_seen_at > now() - INTERVAL '90 days'

* ``pr_merge/slo_routes.rs`` — two readers, both kind-pinned::

      WHERE kind = 'merge_escalation'   ... INTERVAL '{days} days'
      WHERE kind = 'kill_switch_fired'  ... INTERVAL '30 days'

  (The plan cites these at ``pr_merge/mod.rs:1993-2000`` and
  ``slo_routes.rs:255-262`` / ``:356-362``; main has moved since and the line
  numbers no longer hold. The kind predicates are what matter and they do.)

* ``fleet_health.rs``'s ``build_get_alerts_query`` ``include_resolved`` path is
  the one reader NOT kind-scoped, so it is reconciled on shape instead. It is
  opt-in (resolved rows are excluded by default), tenant-scoped through
  ``coord.tenant_devices``, and ordered
  ``(severity='critical') DESC, (severity='warning') DESC, last_seen_at DESC
  LIMIT 500``. Pruned rows are by construction the OLDEST resolved rows in the
  table, so they already rank last within their severity class. The prune
  therefore changes only how deep into history an explicitly
  resolved-inclusive query can scroll; it removes no live alert and no recent
  one.

* ``alert_pageout_metrics.rs``'s ``COUNTS_SQL`` is the other kind-agnostic
  reader of resolved rows: it counts every row with ``paged_at IS NOT NULL``,
  irrespective of kind or resolution. **Measured impact of this prune on it:
  exactly zero.** Of the 1,224,752 rows in the prune set, **0** carry
  ``paged_at``, **0** carry ``page_due_at``, and **0** of all 1,225,708
  burst-kind rows carry a ``detail->'pageout'`` key at all. Nothing this
  migration deletes has ever been paged. Even if that changed, the three
  families are **deliberately declared ``gauge``, not ``counter``, despite
  their ``_total`` names** — the module states the reason verbatim: they are
  live ``count(*)``s over a mutable table, so a bucket can go DOWN. A prune
  moving them down is already in-contract, not a regression.

* ``fleet_health.rs``'s severity roll-ups (the fleet-devices JSON block) filter
  ``resolved_at IS NULL``, so they see only LIVE rows and this prune is
  invisible to them. The plan also lists ``fleet_health.rs:3884`` as a reader;
  it is **``#[cfg(test)]`` code** (the test module opens at ``:1723``), so it is
  not a production consumer at all.

The one ``# TYPE … counter`` derived from this table is
``coord_red_main_flake_healed_total``, and the prerequisite to preserve its
monotonicity is **vacuous**: it is recomputed from rows carrying
``detail->>'suspected_flake' = 'true'``, and there are **0** such rows in
1,474,452 (re-verified 2026-08-07 in the same probe — the key is absent at ANY
value). There is no durable tally to keep monotonic. Independently, that
counter's rows are ``kind = 'red_main'``, which this prune does not touch.

Robustness: the FK blast radius, read from the LIVE catalog
==========================================================================

Enumerated with ``SELECT conrelid::regclass, conname, confdeltype FROM
pg_constraint WHERE contype='f' AND confrelid='coord.alerts'::regclass`` on
prod — **not** from migration files, which are an append-only history and
already produced one stale answer on this table (a CASCADE edge was read out of
a dropped table's own ``downgrade()``).

Exactly ONE foreign key references ``coord.alerts(id)``::

    coord.merge_decisions.merge_decisions_resolved_alert_id_fkey
        FOREIGN KEY (resolved_alert_id) REFERENCES coord.alerts(id)
        ON DELETE SET NULL          -- confdeltype = 'n'

There is **no ``ON DELETE CASCADE`` edge**; the ``coord.merge_escalations_meta``
table that once carried one was dropped on 2026-06-24. So the worst this prune
can do is null an audit back-link on an operator-decision row.

And in practice it does not even do that. Measured:

* ``coord.merge_decisions`` rows with ``resolved_alert_id IS NOT NULL``: **0**
  (of 2,217 rows total).
* ``merge_decisions`` rows pointing at a row in the prune set: **0**.

The prune set is likewise free of every operator-facing marker — of its
1,224,752 rows, **0** carry ``paged_at``, **0** carry ``page_due_at``, **0**
carry ``resolution_action``, **0** carry ``resolution_by``, and **0** carry a
``detail->'pageout'`` key. So it also cannot perturb the ``alert_pageout``
metric buckets.

``coord.merge_decisions.resolved_alert_id`` is indexed
(``idx_merge_decisions_resolved_alert``, partial ``WHERE resolved_alert_id IS
NOT NULL``), so the per-row ``RI_FKey_setnull_del`` trigger this DELETE fires is
an index probe against an 872 kB table, not a sequential scan. That was checked
deliberately: an unindexed FK target would have made a 1.22 M-row delete fire
1.22 M sequential scans.

There are no publications and no replication slots on this instance, so the
delete incurs no logical-decoding amplification.

Why the delete is BATCHED
==========================================================================

``env.py`` wraps the whole migration batch in ONE transaction. Deleting
1.22 M rows inside it would (a) queue 1.22 M ``AFTER DELETE`` RI trigger events,
spilling the after-trigger queue to disk, (b) hold one snapshot for the whole
run, stalling autovacuum fleet-wide meanwhile, and (c) discard all progress if
the migrator is killed — on an instance that is already CPU-saturated, which is
precisely when it might be.

So the delete runs inside ``op.get_context().autocommit_block()`` in bounded
batches, each its own transaction. Progress survives an interruption and a
re-run finishes the job, which also makes this revision safely idempotent.

Batches walk the primary key with a high-water cursor (``id > :after_id``,
``ORDER BY id``, ``RETURNING id``) rather than a bare ``LIMIT``. A bare
``LIMIT`` would re-traverse every already-deleted-but-not-yet-vacuumed index
entry on each pass, making the prune O(batches²); the cursor makes it O(N).
Termination is structural: a batch that returns rows always advances the
cursor past them, and a batch that returns none ends the loop.

Idempotency / authorship posture
==========================================================================

* **alembic is the SOLE author of ``coord.*``**; coord issues zero DDL. This
  revision authors no schema at all — it is pure DML.
* Re-running is a no-op once the prune set is empty (the WHERE clause simply
  matches nothing), so a partially-applied run is repaired by re-running.
* ``downgrade()`` is a deliberate no-op: a one-time data drain is not
  reconstructable. Same posture as ``step5drain_01_merge_escalations``, which
  is the reviewed precedent for deleting ``coord.alerts`` rows from alembic.
  Downgrading the chain past this revision is therefore not blocked.

Revision ID: coord_alerts_retention_01
Revises: fleet_res_tel_03
Create Date: 2026-08-07

"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_alerts_retention_01"
down_revision: str | Sequence[str] | None = "fleet_res_tel_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

# The two historical burst kinds — 83.1% of the table as measured 2026-08-07.
# Both are worktree-hygiene alerts; neither is read by any windowed pr_merge
# consumer (see the reconciliation section in the module docstring).
BURST_KINDS: tuple[str, ...] = ("stale_wip", "stale_primary_tree")

# Retention cutoff. Sits in the middle of the flat 7–45 day band where the
# prune set is ~1.2248 M rows regardless; see the docstring's cutoff table.
RETENTION_DAYS: int = 30

# Rows per transaction. Small enough to keep the RI after-trigger queue in
# memory and to release the snapshot often; large enough that the prune is
# ~62 batches rather than thousands.
BATCH_ROWS: int = 20_000

# Defensive ceiling. The cursor guarantees termination, so tripping this means
# something is structurally wrong and the loop should fail loudly rather than
# spin. 2,000 batches = 40 M rows, far above any plausible table size.
MAX_BATCHES: int = 2_000

# One batch: pick the next BATCH_ROWS doomed ids in primary-key order strictly
# above the cursor, delete exactly those, and report them so the cursor can
# advance. `resolved_at IS NOT NULL` is redundant with the range test (a NULL
# comparison is never true) but is written out so the "live alerts are never
# pruned" invariant is stated rather than inferred from NULL semantics.
_DELETE_BATCH_SQL = """
WITH doomed AS (
    SELECT id
      FROM coord.alerts
     WHERE kind = ANY(:kinds)
       AND resolved_at IS NOT NULL
       AND resolved_at < :cutoff
       AND id > :after_id
     ORDER BY id
     LIMIT :batch
)
DELETE FROM coord.alerts a
      USING doomed d
      WHERE a.id = d.id
  RETURNING a.id
"""


def upgrade() -> None:
    """Prune resolved burst-kind alerts older than the cutoff, in batches.

    Runs in an autocommit block so each batch commits independently: the work
    survives an interruption and a re-run completes it. See the module
    docstring for why this reclaims CPU but not disk.
    """
    with op.get_context().autocommit_block():
        bind = op.get_bind()

        # Freeze the cutoff ONCE. Each batch is its own transaction, so a
        # `now()` inside the loop would drift forward batch by batch and make
        # the prune set non-deterministic mid-run.
        cutoff = bind.execute(
            sa.text("SELECT now() - make_interval(days => :days)"),
            {"days": RETENTION_DAYS},
        ).scalar_one()

        total = 0
        batches = 0
        after_id = 0

        while True:
            ids = list(
                bind.execute(
                    sa.text(_DELETE_BATCH_SQL),
                    {
                        "kinds": list(BURST_KINDS),
                        "cutoff": cutoff,
                        "after_id": after_id,
                        "batch": BATCH_ROWS,
                    },
                ).scalars()
            )
            if not ids:
                break

            after_id = max(ids)
            total += len(ids)
            batches += 1

            if batches >= MAX_BATCHES:
                raise RuntimeError(
                    f"coord_alerts_retention_01: exceeded {MAX_BATCHES} batches "
                    f"after deleting {total} row(s) (cursor at id={after_id}). "
                    "The primary-key cursor should make this unreachable; "
                    "refusing to spin."
                )

        logger.info(
            "coord_alerts_retention_01: deleted %d coord.alerts row(s) of kind %s "
            "resolved before %s, in %d batch(es). Live tuples drop by that much; "
            "the relation FILE does not shrink (no pg_repack from a migration) — "
            "the win is tuple-processing CPU, not scan size.",
            total,
            list(BURST_KINDS),
            cutoff,
            batches,
        )

        if total:
            # Without this the planner keeps ~1.47 M-row estimates for this
            # table until autoanalyze happens to fire, which is how a prune
            # that helps every statement can instead flip one to a bad plan.
            # Cheap (a sampled scan) and safe to repeat.
            op.execute("ANALYZE coord.alerts")


def downgrade() -> None:
    """Deliberate no-op: a one-time data drain is not reconstructable.

    Mirrors ``step5drain_01_merge_escalations``. Making this raise would block
    downgrading the chain past this revision for no gain, since the deleted
    alert rows cannot be recovered either way.
    """
