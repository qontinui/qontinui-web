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

The consumers are all hot and all unmemoized:

* the ``/metrics`` scrape — **recomputed per replica, on every scrape**, since
  the Φ_Infra gauges are DB-derived rather than fed from the observer loop;
* every ``infra_drift_clear`` gate evaluation;
* every ``coord_query_infra_drift`` call.

And the table is an **append-only oplog with no retention job** — the SDK
observer adds ~288 rows/day — so the cost grows without bound and does not
self-heal. New index ``(provenance, observed_at DESC)`` matches the ``ORDER BY``
exactly: ``DISTINCT ON`` becomes an ordered index scan that skips to the first
row of each ``provenance`` group. No sort node at all.

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
return the whole latest batch per ecosystem, not one row. The gap is the same
one: with only ``observed_at DESC``, the inner aggregate seq-scans the table and
HashAggregates it, and the outer join then seq-scans it a SECOND time. The new
index serves both halves — the aggregate becomes a grouped index scan (PG takes
``max(observed_at)`` per ``ecosystem`` from the group's first entry), and the
outer ``o.ecosystem = ? AND o.observed_at = ?`` lookup is an equality probe on
the index's two leading columns.

Do not "simplify" either index away
------------------------------------------------------------------------------
Both look redundant next to the existing ``observed_at DESC`` index. They are
not, and the direction of redundancy is the reverse of what it looks like: a
latest-per-key query needs the key column LEADING and ``observed_at DESC``
TRAILING in one index. Dropping the trailing column, or leaning on the existing
single-column index, reproduces exactly the plan this migration removes. The
pre-existing ``observed_at``-only indexes are deliberately left in place — they
still serve the global ``ORDER BY observed_at DESC LIMIT 1`` reads
(``infra_observer::latest_observation``) that neither new index leads with.

``CREATE INDEX CONCURRENTLY`` (not plain ``CREATE INDEX``)
------------------------------------------------------------------------------
Established repo convention for indexes on hot append-heavy ``coord.*``
observation tables — same precedent as ``coord_pg_overload_idx_01`` /
``coord_pg_overload_idx_02`` (which indexed the same latest-per-key shape on
``release_observations`` / ``config_observations`` /
``route_serving_observations`` during the 2026-07-21 RDS overload incident) and
``gate_action_02``. An in-transaction build takes a write-blocking ``SHARE``
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
