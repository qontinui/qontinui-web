"""coord observation indexes: latest-per-key reads on the twin oplogs

Revision ID: coord_obs_idx_01
Revises: wf_resume_fingerprint_01
Create Date: 2026-08-21

Deferred follow-up #1 (the index half) of
``D:/qontinui-root/plans/2026-08-15-terraform-plan-infra-observer-phase-3b.md``.
The coord-side doc comment on
``crates/coord/src/infra_observer.rs::latest_observation_per_provenance``
already names this migration as the fix and states why it was deliberately NOT
bundled into Phase 3b: it is a performance follow-up with its own cross-repo
deploy ordering, not a correctness prerequisite. **coord authors zero
``coord.*`` DDL** — alembic is the sole author — so the index has to land here.

Two sibling append-only observation oplogs, one identical gap
------------------------------------------------------------------------------
``coord.infra_drift_observations`` (``twin_02_coord_infra_drift_observations``)
and ``coord.dependency_observations``
(``twin_03_coord_dependency_observations``) were each created with exactly ONE
index — ``observed_at DESC`` — chosen for the then-only hot read, "the latest
observation" (``ORDER BY observed_at DESC LIMIT 1``). Both have since grown a
**latest-per-key** read that a lone ``observed_at`` index cannot serve, because
the key column must lead and ``observed_at DESC`` must trail *in the same
index*.

1. ``coord.infra_drift_observations (provenance, observed_at DESC)``
------------------------------------------------------------------------------
Phase 3b replaced the provenance-blind single-row read with a per-writer fold
(``infra_observer::latest_observation_per_provenance``), so that one observer's
clean reading can no longer bury another's finding::

    SELECT DISTINCT ON (provenance) <cols>
      FROM coord.infra_drift_observations
     ORDER BY provenance, observed_at DESC

``idx_infra_drift_observations_observed_at`` is led by the wrong column, so the
planner cannot supply this ordering and degrades to **Seq Scan -> Sort ->
Unique** — sorting tuples that carry the ``resource_observations`` JSONB column,
which makes each sort tuple wide and pushes the sort to disk as the table grows.

The consumers are all hot and all unmemoized (verified against
``qontinui-coord`` ``origin/main``):

* the ``/metrics`` scrape — **recomputed per replica, on every scrape**, since
  the Φ_Infra gauges are DB-derived rather than fed from the observer loop
  (``metrics::assemble_metrics`` calls ``infra_metrics::render`` directly, NOT
  through the ``metrics::cached`` TTL memo);
* every ``infra_drift_clear`` gate evaluation (``InfraDriftClearEvaluator``);
* every ``coord_query_infra_drift`` call;
* every ``deploy_effects`` predict/verify site — four of them, reaching the
  same read through ``latest_observation_worst_across_provenances``.

And the table is an **append-only oplog with no retention job** — the SDK
observer adds ~288 rows/day (a 300s leader-gated tick, one INSERT per cycle).

New index ``(provenance, observed_at DESC)`` matches the ``ORDER BY`` exactly,
so ``DISTINCT ON`` is served by an ordered index scan and the Sort node
disappears entirely.

**Stated precisely, because the tempting overstatement is wrong.** PostgreSQL
has no loose/skip index scan for ``DISTINCT ON``: it does NOT jump to the first
row of each ``provenance`` group. It walks every index entry in order and a
``Unique`` node discards all but each group's first row. So this index removes
the *sort* (and with it the wide-``resource_observations``-JSONB sort tuples and
the disk spill), but the scan stays **O(rows)**. It is a large constant-factor
win, not an asymptotic one — the unbounded growth is closed by the deferred
RETENTION follow-up, not by this migration. Do not read "no sort node" as
"bounded cost".

The index does buy an asymptotic win on the table's OTHER per-key read, which
is why it is worth more than the ``DISTINCT ON`` alone:
``infra_observer::latest_observation_of_provenance`` —
``WHERE provenance = $1 ORDER BY observed_at DESC LIMIT 1``, live at four call
sites (``config_observation_watcher``, ``policies::decide``, and two MCP tool
handlers). Equality pins the leading column and ``observed_at DESC`` trails, so
that read goes from Seq Scan + Top-N to a single **O(log n)** index probe that
stops at the first row.

2. ``coord.dependency_observations (ecosystem, observed_at DESC)``
------------------------------------------------------------------------------
``dependency_observer::latest_observation_per_ecosystem`` — feeding the
``coord_dependency_*`` gauges, likewise recomputed per replica per scrape::

    SELECT o.ecosystem, o.observed_at, o.workspace_member, ...
      FROM coord.dependency_observations o
      JOIN (SELECT ecosystem, max(observed_at) AS mx
              FROM coord.dependency_observations GROUP BY ecosystem) l
        ON o.ecosystem = l.ecosystem AND o.observed_at = l.mx
     ORDER BY o.ecosystem

Written as a join rather than ``DISTINCT ON`` because a dependency *cycle*
writes one row per workspace member sharing a single ``observed_at``, so it must
return the whole latest batch per ecosystem, not one row. The gap rhymes with #1
but is NOT identical: with only ``observed_at DESC``, the inner aggregate
seq-scans the table and HashAggregates it, and the outer join then seq-scans it
a SECOND time. The new index serves both halves, and it is worth being exact
about *how*, because the two halves gain very different amounts:

* **outer join** — ``o.ecosystem = ? AND o.observed_at = ?`` is an equality
  probe on the index's two leading columns. This is the real win: the second
  seq scan becomes an O(log n) lookup per driving row.
* **inner aggregate** — ``GROUP BY ecosystem / max(observed_at)`` becomes a
  ``GroupAggregate`` over an **index-only** scan (both referenced columns are in
  the index), which drops the heap access and the hash table. It does NOT
  become a per-group first-entry lookup: PostgreSQL's MIN/MAX index shortcut
  applies to *ungrouped* aggregates only, and there is no loose/skip index scan
  for a ``GROUP BY``. This half stays O(rows), just much cheaper per row.

**``DESC`` is deliberate-but-not-load-bearing on THIS index**, unlike #1. An
equality probe is direction-agnostic, and ``GroupAggregate`` only needs the
input grouped by ``ecosystem`` — which either scan direction supplies. A plain
``(ecosystem, observed_at)`` would perform identically here. ``DESC`` is kept
for symmetry with #1 (where it *is* load-bearing) and because it costs nothing;
do not "fix" it in either direction expecting a plan change.

Do not "simplify" either index away
------------------------------------------------------------------------------
Both look redundant next to the existing ``observed_at DESC`` index. They are
not, and the direction of redundancy is the reverse of what it looks like: a
latest-per-key query needs the key column LEADING in the SAME index. Dropping
the trailing column, or leaning on the existing single-column index, reproduces
exactly the plan this migration removes.

**Why ``DESC`` is load-bearing on index #1 specifically.** It is tempting to
call it cargo-cult — PostgreSQL scans a btree backwards perfectly well, so a
trailing ``DESC`` is usually free to omit. It is not free here. The infra read
wants ``ORDER BY provenance ASC, observed_at DESC`` — the two columns in
OPPOSITE directions. A plain ``(provenance, observed_at)`` gives
``(ASC, ASC)`` scanned forward and ``(DESC, DESC)`` scanned backward, and a
backward scan cannot flip one column without flipping the other. Neither
direction satisfies the request, so the planner falls back to an Incremental
Sort (presorted on ``provenance``, re-sorting ``observed_at`` within each
group) — and with only ~2 provenances, the "groups" are nearly the whole table,
so that is barely better than the full Sort this migration is removing. The
``DESC`` is what makes the match exact. (Index #2 is the opposite case — see
its section above.)

**The retained ``observed_at``-only indexes are NOT symmetric — read this
before assuming both are still earning their keep.**

* ``coord.dependency_observations``: ``idx_dependency_observations_observed_at``
  IS still live. ``dependency_observer::latest_observation`` issues an
  *ungrouped* ``SELECT max(observed_at) FROM coord.dependency_observations``
  (which PostgreSQL rewrites into an ``observed_at``-led index scan + LIMIT 1)
  and then a ``WHERE observed_at = $1`` batch fetch. Both are led by
  ``observed_at``, which the new ``(ecosystem, …)`` index cannot serve. Keep it.
* ``coord.infra_drift_observations``: ``idx_infra_drift_observations_observed_at``
  has **NO remaining reader**. The provenance-blind
  ``infra_observer::latest_observation`` that justified it was **DELETED** in
  Phase 3b, not deprecated — see the standing comment above
  ``latest_observation_of_provenance`` in ``infra_observer.rs``. Every surviving
  read of that table is either the ``DISTINCT ON (provenance)`` fold or
  ``WHERE provenance = $1 ORDER BY observed_at DESC LIMIT 1``, and the new
  composite serves BOTH strictly better. The old index is now pure write
  amplification on an append-heavy oplog.

It is deliberately NOT dropped in this migration. Dropping it is a separate,
separately-reversible change of a different risk class (a drop cannot be undone
by a re-run the way ``CREATE … IF NOT EXISTS`` can), and it should follow the
same shape as ``coord_pg_overload_idx_03``, which did exactly this cleanup for
``_02`` in its own revision after the superseding indexes had landed. Note it is
NOT a prefix-redundancy of the kind ``_03`` handled — ``observed_at`` is not a
prefix of ``(provenance, observed_at)`` — so ``pg_stat_user_indexes.idx_scan``
on production should be the evidence for the drop, not this reasoning alone.

``CREATE INDEX CONCURRENTLY`` (not plain ``CREATE INDEX``)
------------------------------------------------------------------------------
Established repo convention for indexes on hot append-heavy ``coord.*``
observation tables. The precedents, kept distinct because they are two
different incidents and conflating them misdates both:
``coord_pg_overload_idx_01`` (2026-06-28, the unindexed per-tick FAN-OUT
queries on ``policy_rule_resolutions`` / ``pr_events`` / ``worktree_census``);
``coord_pg_overload_idx_02`` (2026-07-21, the 42-AAS RDS overload incident,
which indexed this same latest-per-key shape on ``release_observations`` /
``config_observations`` / ``route_serving_observations``); and
``coord_pg_overload_idx_03`` / ``gate_action_02``, which additionally establish
``DROP INDEX CONCURRENTLY`` inside the same block.

An in-transaction build takes a write-blocking ``SHARE``
lock on a table the observer loops are actively appending to. CONCURRENTLY
cannot run inside a transaction, hence ``op.get_context().autocommit_block()``.
On the CI fresh DB both tables are empty, so the builds are instant.

Additive / forward-only / expand-only: ``upgrade`` creates each index
``IF NOT EXISTS``; ``downgrade`` drops ``IF EXISTS``. No table, column, or
existing index is altered.

Note on a killed CONCURRENTLY build: a partial build leaves an INVALID index of
the same name, which ``IF NOT EXISTS`` would then skip. If that happens,
manually ``DROP INDEX`` the invalid index and re-run.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_obs_idx_01"
down_revision: str | None = "wf_resume_fingerprint_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: two CONCURRENTLY composite indexes. Idempotent."""
    with op.get_context().autocommit_block():
        # 1. infra_observer::latest_observation_per_provenance —
        #    DISTINCT ON (provenance) ORDER BY provenance, observed_at DESC.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_infra_drift_observations_provenance_observed
            ON coord.infra_drift_observations (
                provenance, observed_at DESC
            )
            """
        )
        # 2. dependency_observer::latest_observation_per_ecosystem — the
        #    GROUP BY ecosystem / max(observed_at) aggregate AND the
        #    (ecosystem, observed_at) equality join back onto the table.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_dependency_observations_ecosystem_observed
            ON coord.dependency_observations (
                ecosystem, observed_at DESC
            )
            """
        )


def downgrade() -> None:
    """Reverse the two additive indexes. Tables + all other indexes survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_dependency_observations_ecosystem_observed"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_infra_drift_observations_provenance_observed"
        )
