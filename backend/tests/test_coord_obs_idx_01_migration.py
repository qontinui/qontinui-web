"""Behaviour test for the ``coord_obs_idx_01`` latest-per-key observation indexes.

The revision creates two composite indexes, both ``CONCURRENTLY``::

    coord.infra_drift_observations (provenance, observed_at DESC)
    coord.dependency_observations  (ecosystem,  observed_at DESC)

``migration-reversal.yml`` confirms those statements *execute* on an empty
database, and nothing more. Executing is not the contract. The contract is that
**the planner chooses each index for the exact SQL coord sends**, and the
migration's docstring makes a series of specific, falsifiable planner claims to
justify shipping them - claims a future reader will trust and a future edit can
silently break. This test pins every one of them.

Why this test exists at all
===========================

The revision's own docstring opens a section headed *"Do not 'simplify' either
index away"*, because both indexes look redundant beside the ``observed_at
DESC`` index each table already had. It then argues - in prose - that the
redundancy runs the other way, that ``DESC`` is load-bearing on one index and
free on the other, and that one of the two retained single-column indexes is
still earning its keep while the other is not. Prose does not fail a build.
Each claim below is re-stated as an assertion against a real Postgres planner.

What is asserted
================

1. **The revision adds; it does not replace.** At the parent revision neither
   composite exists and both pre-existing ``observed_at DESC`` indexes do.

2. **Both indexes exist, are ``indisvalid``, and have the intended definition.**
   Validity is checked explicitly because the migration's own closing note
   describes the trap: a killed ``CONCURRENTLY`` build leaves an INVALID index
   of the same name that ``CREATE INDEX ... IF NOT EXISTS`` then skips on
   re-run, so "exists" alone would pass against an index that can never serve a
   query.

3. **The infra fold rides the index with NO sort node.** This is the migration's
   headline claim: ``DISTINCT ON (provenance) ... ORDER BY provenance,
   observed_at DESC`` becomes ``Unique`` over an ordered ``Index Scan``, and the
   ``Sort`` that was spilling wide ``resource_observations`` JSONB tuples
   disappears.

4. **The DESC is load-bearing on index #1 - the sensitivity case.** The same
   query against a clone carrying a plain ``(provenance, observed_at)`` index
   falls back to an ``Incremental Sort``. Without this assertion, #3 would still
   pass against an index whose direction had been "cleaned up" to match the
   sibling, and the test would not be measuring the exact-ordering-match claim
   at all. The migration explicitly warns against that edit; this is what makes
   the warning enforceable.

5. **The equality-pinned infra read becomes an index probe.**
   ``WHERE provenance = $1 ORDER BY observed_at DESC LIMIT 1`` pins the leading
   column and lets ``observed_at DESC`` trail, so the read drops from Seq Scan +
   Top-N to a single O(log n) probe that stops at the first row. This is the one
   read that gains an *asymptotic* win rather than a constant-factor one - the
   migration is explicit that the ``DISTINCT ON`` fold does not.

6. **Both halves of the dependency join leave the sequential scan behind.** The
   inner ``GROUP BY ecosystem / max(observed_at)`` aggregate becomes a
   ``GroupAggregate`` over an **Index Only** scan of the new composite - which
   nothing else can supply - and the outer join back onto the table becomes an
   ``Index Scan`` rather than the table's second sequential pass.

   *Which* index the outer half rides is deliberately NOT asserted here, and
   that is a correction to the migration's docstring rather than a weakening of
   the test - see "One docstring claim needs narrowing" below.

7. **The new composite CAN serve the outer probe on both leading columns.**
   Asserted against a clone that carries the composite and nothing else, so the
   capability is isolated from the planner's cost comparison against the
   retained ``observed_at`` index. This is the claim the migration makes, tested
   where it is actually decidable.

8. **The DESC is NOT load-bearing on index #2 - the stated asymmetry.** A second
   clone carrying a plain ``(ecosystem, observed_at)`` index produces a plan
   identical to #7's, node for node. The docstring says so and says "do not
   'fix' it in either direction expecting a plan change"; asserting it keeps
   claim #4 from being over-generalised into a rule about both indexes.

9. **The retained ``idx_dependency_observations_observed_at`` is still
   load-bearing.** The ungrouped ``SELECT max(observed_at)`` read rides *it*,
   not the new composite, because the new index's leading column is
   ``ecosystem``. The migration flags a follow-up that will drop one retained
   single-column index; this pins which one must survive, so that cleanup cannot
   take the wrong one on the "both look redundant" reasoning the docstring warns
   about.

10. **The indexes are self-maintaining and the answers are right.** Every row
    is seeded AFTER the indexes are built - no ``REINDEX`` - and the two reads
    are checked for their VALUES, not only their plans: one newest row per
    provenance, and the whole latest same-``observed_at`` batch per ecosystem
    (the reason that read is a join rather than a ``DISTINCT ON``).

11. **Downgrade removes exactly the two new indexes.** Both pre-existing
    ``observed_at`` indexes, both tables, and every row survive.

One docstring claim needs narrowing
===================================

The migration says of index #2 that the *"**outer join** - ``o.ecosystem = ?
AND o.observed_at = ?`` is an equality probe on the index's two leading columns.
This is the real win: the second seq scan becomes an O(log n) lookup per driving
row."* The second half is right and is asserted in #6. The attribution is not
reliably right: measured on PostgreSQL 16.14 against the fixture below (CI runs
``pgvector/pgvector:pg16``, the same major), the planner serves
that outer probe from the **retained ``idx_dependency_observations_observed_at``**
(cost 5.75) in preference to the new composite (cost 6.77), applying
``Filter: (ecosystem = ...)`` on top. Both are O(log n) index probes, so the win
the migration claims is real either way - but it does not necessarily come from
the index the migration credits. Assertion #7 shows the composite *can* serve
that probe when nothing competes with it, which is the honest form of the claim.

This is worth writing down rather than papering over, because it gives the
retained single-column index a **second** reason to survive the deferred
"drop the readerless observed_at index" follow-up, on top of the ungrouped
``max()`` read that assertion #9 pins. That follow-up should read
``pg_stat_user_indexes.idx_scan`` on production for BOTH tables, as the
migration already says, and not reason from the docstring's attribution alone.

``enable_seqscan = off`` for the plan assertions
================================================

The fixture is deliberately small, so a sequential scan wins on cost regardless
of index quality - the same reason ``test_coord_alerts_flakeidx_01_migration``
does this. Turning it off removes the cost question and leaves the one being
asked: CAN the planner use this index for this query shape? If the ordering
match does not hold, no penalty makes it usable - which is exactly how the
negative case in #4 discriminates, since it still shows a sort with sequential
scans disabled.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "coord_obs_idx_01"
_PARENT_REVISION_ID = "wf_resume_fingerprint_01"

_IDX_INFRA = "idx_infra_drift_observations_provenance_observed"
_IDX_DEP = "idx_dependency_observations_ecosystem_observed"

# The single-column indexes twin_02 / twin_03 created. This revision adds
# alongside them, and its downgrade must leave them untouched.
_IDX_INFRA_PRE = "idx_infra_drift_observations_observed_at"
_IDX_DEP_PRE = "idx_dependency_observations_observed_at"

# Clones used only as controls. Each carries the same columns and the same rows
# as the table it clones and exactly ONE index, so a plan difference can come
# from nothing but that index.
#
# * ``_CTL_INFRA``  - ASC/ASC composite: the negative case proving DESC is
#                     load-bearing on index #1 (assertion 4).
# * ``_CTL_DEP``    - the shipped ``(ecosystem, observed_at DESC)`` alone, with
#                     no retained ``observed_at`` index to out-cost it: where
#                     the two-leading-column probe is actually decidable
#                     (assertion 6).
# * ``_CTL_DEP_ASC``- the same composite ASC, to show the direction changes
#                     nothing on index #2 (assertion 7).
_CTL_INFRA = "coord.ctl_infra_asc"
_CTL_DEP = "coord.ctl_dep_desc"
_CTL_DEP_ASC = "coord.ctl_dep_asc"

# ---------------------------------------------------------------------------
# The reader SQL, transcribed from qontinui-coord ``origin/main``. Kept close to
# character-for-character: these are the statements whose plans the migration
# claims to change, and a simplified stand-in would prove nothing about them.
# ---------------------------------------------------------------------------

# ``infra_observer::OBSERVATION_COLUMNS`` - the shared SELECT list of all three
# infra readers. The width matters: these are the tuples the removed Sort was
# spilling.
_INFRA_COLUMNS = (
    "observed_at, drift_class, has_active_negation, resource_observations, "
    "terraform_owned_drift, ci_owned_drift, coverage, provenance, credibility"
)

# ``infra_observer::latest_observation_per_provenance`` - the Phase-3b per-writer
# fold. Index #1 exists for this statement.
_INFRA_FOLD_SQL = (
    f"SELECT DISTINCT ON (provenance) {_INFRA_COLUMNS} "
    "FROM coord.infra_drift_observations "
    "ORDER BY provenance, observed_at DESC"
)

# ``infra_observer::latest_observation_of_provenance`` - the equality-pinned read
# that gains the asymptotic win (Seq Scan + Top-N -> a single O(log n) probe).
_INFRA_PIN_SQL = (
    f"SELECT {_INFRA_COLUMNS} FROM coord.infra_drift_observations "
    "WHERE provenance = 'aws_sdk_describe' ORDER BY observed_at DESC LIMIT 1"
)

# ``dependency_observer::latest_observation_per_ecosystem`` - written as a join
# rather than DISTINCT ON because one dependency cycle writes one row per
# workspace member under a single ``observed_at``, so the whole latest batch must
# come back. Index #2 serves both halves.
_DEP_JOIN_SQL = (
    "SELECT o.ecosystem, o.observed_at, o.workspace_member, o.declared_ranges, "
    "o.installed_versions, o.lock_hash, o.lock_stale, "
    "o.installed_outside_declared, o.sibling_widening_required, "
    "o.drift_class, o.coverage, o.credibility "
    "FROM coord.dependency_observations o "
    "JOIN (SELECT ecosystem, max(observed_at) AS mx "
    "      FROM coord.dependency_observations GROUP BY ecosystem) l "
    "  ON o.ecosystem = l.ecosystem AND o.observed_at = l.mx "
    "ORDER BY o.ecosystem"
)

# ``dependency_observer::latest_observation``'s first leg - the UNGROUPED max
# that keeps ``_IDX_DEP_PRE`` alive (assertion 7).
_DEP_MAX_SQL = "SELECT max(observed_at) FROM coord.dependency_observations"

# Two provenances, matching prod: the SDK observer ticking every 300s and the
# terraform-plan observer. The fold must return exactly one row per provenance.
_PROVENANCES = ("aws_sdk_describe", "terraform_plan")
# Three ecosystems x four workspace members: each cycle writes one row per
# member sharing a single ``observed_at``, which is what makes the dependency
# read a join rather than a ``DISTINCT ON``.
_ECOSYSTEMS = ("cargo", "npm", "pip")
_MEMBERS = ("core", "types", "ui", "utils")
_CYCLES = 12

# The newest cycle's timestamp - what every latest-per-key read must return.
_NEWEST = datetime(2026, 8, 21, 12, 0, tzinfo=UTC)


def _index_def(engine: Engine, index_name: str) -> str:
    """``pg_get_indexdef`` - the recorded column list AND their directions."""
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(
                    "SELECT pg_get_indexdef(c.oid) FROM pg_class c WHERE c.relname = :n"
                ),
                {"n": index_name},
            ).scalar()
            or ""
        )


def _index_is_valid(engine: Engine, index_name: str) -> bool:
    """``indisvalid`` - a half-built CONCURRENTLY index exists but cannot serve."""
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT i.indisvalid
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                     WHERE c.relname = :n
                    """
                ),
                {"n": index_name},
            ).scalar()
        )


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised - see the module docstring."""
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        return "\n".join(str(r[0]) for r in conn.execute(text(f"EXPLAIN {sql}")).all())


def _seed(engine: Engine) -> None:
    """Insert every row AFTER the indexes were built - the self-maintenance case.

    Timestamps are computed in Python rather than with ``now() - :i * interval``
    so no bind parameter sits next to a ``::`` cast: SQLAlchemy's ``text()``
    parses ``:name`` itself and mis-parses a cast that immediately follows one.
    """
    with engine.begin() as conn:
        for cycle in range(_CYCLES):
            cycle_at = _NEWEST - timedelta(minutes=cycle)
            for provenance in _PROVENANCES:
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.infra_drift_observations
                            (observed_at, drift_class, provenance,
                             resource_observations, coverage, credibility)
                        VALUES (:at, 'ok', :p, CAST(:r AS jsonb), 1.0, 0.9)
                        """
                    ),
                    {
                        "at": cycle_at,
                        "p": provenance,
                        "r": '[{"resource": "aws_iam_role.coord", '
                        '"classification": "ok"}]',
                    },
                )
            for ecosystem in _ECOSYSTEMS:
                # One cycle -> one row per member, ALL sharing one observed_at.
                for member in _MEMBERS:
                    conn.execute(
                        text(
                            """
                            INSERT INTO coord.dependency_observations
                                (observed_at, ecosystem, workspace_member,
                                 drift_class, provenance, coverage, credibility)
                            VALUES (:at, :e, :m, 'ok',
                                    'coord_dependency_observer', 1.0, 0.9)
                            """
                        ),
                        {"at": cycle_at, "e": ecosystem, "m": member},
                    )
        conn.execute(text("ANALYZE coord.infra_drift_observations"))
        conn.execute(text("ANALYZE coord.dependency_observations"))


def _build_controls(engine: Engine) -> None:
    """Clone each table with exactly one index - the controls.

    ``INCLUDING ALL EXCLUDING INDEXES`` copies the column types, defaults and
    check constraints but no index, so a clone differs from its original only in
    which index it carries. Any plan difference is therefore attributable to
    that index and to nothing else - which is what lets the dependency controls
    answer "can the composite serve this?" separately from "does the planner
    prefer it over the retained observed_at index?".
    """
    clones = (
        (_CTL_INFRA, "coord.infra_drift_observations", "(provenance, observed_at)"),
        (_CTL_DEP, "coord.dependency_observations", "(ecosystem, observed_at DESC)"),
        (_CTL_DEP_ASC, "coord.dependency_observations", "(ecosystem, observed_at)"),
    )
    with engine.begin() as conn:
        for clone, source, columns in clones:
            index_name = f"{clone.split('.')[1]}_idx"
            conn.execute(
                text(
                    f"CREATE TABLE {clone} "
                    f"(LIKE {source} INCLUDING ALL EXCLUDING INDEXES)"
                )
            )
            conn.execute(text(f"INSERT INTO {clone} SELECT * FROM {source}"))
            conn.execute(text(f"CREATE INDEX {index_name} ON {clone} {columns}"))
            conn.execute(text(f"ANALYZE {clone}"))


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_obs_idx_01_serves_the_latest_per_key_reads() -> None:
    """Build both indexes, prove each reader's plan, prove the direction claims."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_obs_idx_test") as (
        engine,
        url,
    ):
        # ------------------------------------------------------------------
        # Step 1 (claim 1). Parent revision: the composites must not exist yet,
        # and the
        #    single-column indexes this revision adds ALONGSIDE must.
        # ------------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _IDX_INFRA)
        assert not index_exists(engine, _IDX_DEP), (
            "both indexes must be created by this revision, not an earlier one"
        )
        assert index_exists(engine, _IDX_INFRA_PRE)
        assert index_exists(engine, _IDX_DEP_PRE), (
            "twin_02/twin_03 created the observed_at indexes; this revision is "
            "additive beside them, so their absence would mean the premise of "
            "the whole 'do not simplify either index away' argument has moved"
        )

        # ------------------------------------------------------------------
        # Step 2 (claim 2). Apply: both exist, both VALID, both with the
        # intended definition.
        # ------------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        for name, expected_cols in (
            (_IDX_INFRA, "(provenance, observed_at DESC)"),
            (_IDX_DEP, "(ecosystem, observed_at DESC)"),
        ):
            assert index_exists(engine, name)
            assert _index_is_valid(engine, name), (
                f"{name} is INVALID - a killed CONCURRENTLY build leaves an "
                "index of the right name that IF NOT EXISTS skips on re-run, "
                "so existence alone is not the contract"
            )
            definition = _index_def(engine, name)
            assert expected_cols in definition, (
                f"{name} must be {expected_cols}; the column ORDER and the "
                f"direction are both load-bearing. Got: {definition!r}"
            )

        # ------------------------------------------------------------------
        # Step 3 (setup for claim 10). Seed AFTER the build (self-maintaining),
        # then build the controls.
        # ------------------------------------------------------------------
        _seed(engine)
        _build_controls(engine)

        # ------------------------------------------------------------------
        # Step 4 (claim 3). The infra fold: an index-ordered scan, and NO sort
        # node at all.
        #    This is the claim the migration exists to make.
        # ------------------------------------------------------------------
        fold_plan = _plan_for(engine, _INFRA_FOLD_SQL)
        assert _IDX_INFRA in fold_plan, (
            f"the DISTINCT ON (provenance) fold must ride {_IDX_INFRA}; "
            f"got:\n{fold_plan}"
        )
        assert "Sort" not in fold_plan, (
            "the index matches ORDER BY provenance, observed_at DESC exactly, so "
            "the Sort node (which was spilling wide resource_observations JSONB "
            f"tuples) must be gone entirely; got:\n{fold_plan}"
        )

        # ------------------------------------------------------------------
        # Step 5 (claim 4). Sensitivity for claim 3: a plain
        # (provenance, observed_at) cannot supply
        #    the two columns in OPPOSITE directions, so the sort comes back.
        #    Without this, #4 would pass against a "cleaned up" index too.
        # ------------------------------------------------------------------
        ctl_plan = _plan_for(
            engine,
            _INFRA_FOLD_SQL.replace("coord.infra_drift_observations", _CTL_INFRA),
        )
        assert "Sort" in ctl_plan, (
            "a plain (provenance, observed_at) index must NOT satisfy "
            "ORDER BY provenance, observed_at DESC - a backward scan cannot flip "
            "one column without flipping the other. If this passes without a "
            "sort, assertion #4 above has stopped measuring anything:\n" + ctl_plan
        )

        # ------------------------------------------------------------------
        # Step 6 (claim 5). The equality-pinned read: an index probe that stops
        # at row one.
        # ------------------------------------------------------------------
        pin_plan = _plan_for(engine, _INFRA_PIN_SQL)
        assert _IDX_INFRA in pin_plan and "Index Cond" in pin_plan, (
            "WHERE provenance = $1 ORDER BY observed_at DESC LIMIT 1 must become "
            f"an index probe on {_IDX_INFRA}; got:\n{pin_plan}"
        )
        assert "Sort" not in pin_plan, (
            "equality pins the leading column and observed_at DESC trails, so "
            f"the Top-N sort must be gone; got:\n{pin_plan}"
        )

        # ------------------------------------------------------------------
        # Step 7 (claim 6). The dependency join: both halves leave the
        # sequential scan behind.
        #    The inner aggregate can ONLY come from the new composite, so its
        #    index is named. The outer probe is deliberately not pinned to an
        #     index name - see "One docstring claim needs narrowing" above.
        # ------------------------------------------------------------------
        dep_plan = _plan_for(engine, _DEP_JOIN_SQL)
        assert "GroupAggregate" in dep_plan, (
            "the inner GROUP BY ecosystem / max(observed_at) must become a "
            "GroupAggregate over ordered index input, not a HashAggregate over "
            f"a seq scan; got:\n{dep_plan}"
        )
        assert f"Index Only Scan using {_IDX_DEP}" in dep_plan, (
            "both columns the aggregate references are in the new index and no "
            "other index leads with ecosystem, so the aggregate's input must be "
            f"an INDEX ONLY scan of {_IDX_DEP}; got:\n{dep_plan}"
        )
        assert "Index Scan using idx_dependency_observations_" in dep_plan, (
            "the outer join's o.ecosystem = ? AND o.observed_at = ? must become "
            "an O(log n) index probe - the real win, replacing the table's "
            f"SECOND sequential pass; got:\n{dep_plan}"
        )
        assert "Seq Scan" not in dep_plan, (
            f"neither half of the join may scan the table sequentially; "
            f"got:\n{dep_plan}"
        )

        # ------------------------------------------------------------------
        # Step 8 (claim 7). The two-leading-column probe, tested where it is
        # decidable: a clone
        #    carrying the shipped composite and NOTHING else. On the real table
        #    the planner may prefer the narrower retained observed_at index for
        #    this half (it does, on this fixture); that is a cost comparison, not
        #    a capability. Here there is nothing to compare against, so the
        #    Index Cond has to name both columns or the claim is false.
        # ------------------------------------------------------------------
        ctl_dep_plan = _plan_for(
            engine, _DEP_JOIN_SQL.replace("coord.dependency_observations", _CTL_DEP)
        )
        assert "GroupAggregate" in ctl_dep_plan, ctl_dep_plan
        assert "Index Only Scan using ctl_dep_desc_idx" in ctl_dep_plan, (
            f"the aggregate half must ride the composite alone; got:\n{ctl_dep_plan}"
        )
        assert "Index Cond: ((ecosystem = " in ctl_dep_plan, (
            "with no competing index the outer probe must use BOTH leading "
            "columns - if it cannot, the migration's 'equality probe on the "
            f"index's two leading columns' claim is wrong:\n{ctl_dep_plan}"
        )
        assert "Seq Scan" not in ctl_dep_plan, (
            f"the composite alone must serve both halves; got:\n{ctl_dep_plan}"
        )

        # ------------------------------------------------------------------
        # Step 9 (claim 8). The stated asymmetry: DESC is NOT load-bearing on
        # index #2. An
        #    equality probe is direction-agnostic and GroupAggregate only needs
        #    its input GROUPED, which either direction supplies. The migration
        #    says so and says not to "fix" it; asserting it keeps assertion 5
        #    from being over-generalised into a rule about both indexes.
        # ------------------------------------------------------------------
        ctl_asc_plan = _plan_for(
            engine, _DEP_JOIN_SQL.replace("coord.dependency_observations", _CTL_DEP_ASC)
        )
        assert ctl_asc_plan.replace("ctl_dep_asc", "X") == ctl_dep_plan.replace(
            "ctl_dep_desc", "X"
        ), (
            "a plain (ecosystem, observed_at) index must produce a plan "
            "identical to the DESC composite's, node for node and cost for "
            "cost. If it does not, the migration's 'DESC is kept for symmetry "
            "and costs nothing; do not fix it in either direction expecting a "
            f"plan change' note is wrong and must be corrected.\n"
            f"--- ASC ---\n{ctl_asc_plan}\n--- DESC ---\n{ctl_dep_plan}"
        )

        # ------------------------------------------------------------------
        # Step 10 (claim 9). The retained single-column dependency index is
        # STILL load-bearing.
        #     The migration flags a follow-up that drops one retained
        #     observed_at index. This pins which one must survive: the new
        #     composite is led by `ecosystem` and cannot serve an ungrouped
        #     max(observed_at).
        # ------------------------------------------------------------------
        max_plan = _plan_for(engine, _DEP_MAX_SQL)
        assert _IDX_DEP_PRE in max_plan, (
            "the ungrouped SELECT max(observed_at) rewrites into an "
            f"observed_at-led scan + LIMIT 1, which only {_IDX_DEP_PRE} can "
            "serve - it is NOT redundant with the new composite and must not be "
            f"dropped as such; got:\n{max_plan}"
        )
        assert _IDX_DEP not in max_plan, (
            f"{_IDX_DEP} is led by ecosystem and cannot serve this read; if the "
            f"planner picked it, the premise above is wrong:\n{max_plan}"
        )

        # ------------------------------------------------------------------
        # Step 11 (claim 10). Values, not just plans. Rows seeded after the
        # build are indexed
        #     with no REINDEX, and each read returns what its caller needs.
        # ------------------------------------------------------------------
        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            fold = conn.execute(text(_INFRA_FOLD_SQL)).all()
            dep = conn.execute(text(_DEP_JOIN_SQL)).all()

        assert [r.provenance for r in fold] == sorted(_PROVENANCES), (
            "the fold returns exactly one row per provenance, ordered by "
            f"provenance so the gauge series is stable across scrapes; got: {fold!r}"
        )
        assert all(r.observed_at == _NEWEST for r in fold), (
            "each provenance's row must be its NEWEST - an index that returned "
            "the oldest would satisfy every plan assertion above"
        )

        assert len(dep) == len(_ECOSYSTEMS) * len(_MEMBERS), (
            "one dependency cycle writes one row per workspace member under a "
            "single observed_at, and the read must return the WHOLE latest batch "
            f"per ecosystem - that is why it is a join; got {len(dep)} rows"
        )
        assert {r.ecosystem for r in dep} == set(_ECOSYSTEMS)
        assert all(r.observed_at == _NEWEST for r in dep)

        # ------------------------------------------------------------------
        # Step 12 (claim 11). Downgrade removes exactly the two new indexes.
        # ------------------------------------------------------------------
        with engine.begin() as conn:
            for clone in (_CTL_INFRA, _CTL_DEP, _CTL_DEP_ASC):
                conn.execute(text(f"DROP TABLE {clone}"))

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)

        assert not index_exists(engine, _IDX_INFRA)
        assert not index_exists(engine, _IDX_DEP)
        assert index_exists(engine, _IDX_INFRA_PRE)
        assert index_exists(engine, _IDX_DEP_PRE), (
            "downgrade drops the two additive indexes only - the pre-existing "
            "observed_at indexes are not this revision's to remove"
        )
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT count(*) FROM coord.infra_drift_observations")
            ).scalar() == _CYCLES * len(_PROVENANCES)
            assert conn.execute(
                text("SELECT count(*) FROM coord.dependency_observations")
            ).scalar() == _CYCLES * len(_ECOSYSTEMS) * len(_MEMBERS), (
                "downgrade drops indexes only - rows are untouched"
            )
