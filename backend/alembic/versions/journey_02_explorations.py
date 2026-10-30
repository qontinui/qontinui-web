"""project.journey_explorations — one row per budgeted explorer run

Revision ID: journey_02_explorations
Revises: coord_agent_questions_recommendation
Create Date: 2026-10-25

Phase 3 (qontinui-web half) of plan
``2026-09-20-ui-bridge-represents-the-users-path-and-the-passage-of-time``.
Phase 0's decision 3 deferred this table out of ``journey_01_edge_ledger``
("no table without a writer"); its writer is the runner's explorer
(``src-tauri/src/journey/explorer.rs``, ``POST /apps/{app_id}/journey/explore``),
which lands with it in the same phase.

``down_revision`` is this repo's LOCAL single alembic head at authoring time and
is deliberately NOT pinned: ``alembic-graph-pr.yml`` serialises alembic PRs, so
any revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; never author an ``alembic merge``
revision for it.

What a row is
=============

One finished explorer run — the answer ``POST /journey/explore`` returned,
persisted, so a later journey query can ask *how* a component's frontier came
to be closed or open. The explorer has no private write path: every edge it
causes is written to ``project.journey_edge_observations`` by the Phase 1
producer with ``run_kind = 'explorer'`` and ``run_id`` equal to this row's
``run_id``. This table holds only the run's own facts:

* ``run_id`` — the primary key, and the SAME text the run's edges carry in
  ``journey_edge_observations.run_id`` (also ``TEXT`` there), so a run joins to
  its edges without a cast;
* the BUDGET, as three NOT NULL columns. The route refuses (422) a request that
  omits any of ``max_actions``, ``max_depth`` or ``max_wall_clock_s``, and the
  table holds the same line: there is no unset dial here either, so a row can
  never read as "unbounded";
* what the run SPENT, as three NOT NULL columns, each CHECKed against its
  budget (actions and depth never exceed theirs; wall clock may overrun by the
  one in-flight action the stop check waits for, so it is not CHECKed against
  ``budget_max_wall_clock_s``);
* ``stopped_because`` — the closed six-word vocabulary below;
* ``stop_node`` — the ``JourneyNode`` the run stopped on. REQUIRED for
  ``auth_wall`` (the plan: "hitting a login wall is ``stopped_because:
  auth_wall`` with the node recorded"); optional otherwise (an
  ``app_unreachable`` run may have resolved no node at all);
* ``edges_added`` and ``frontier_remaining_by_reason`` — the run's accounting,
  so "nothing vanishes" (acceptance criterion 1) is checkable after the fact
  — but only inside the edge ledger's retention window: edge rows age out
  (``app/jobs/journey_edge_retention.py``) while these rows are kept, so for an
  older run ``edges_added`` exceeding its surviving edges is expiry, not loss;
* ``start`` — the request's start, a JSON object (``{"url": …}`` or
  ``{"node": …}``);
* ``started_at`` / ``finished_at`` and the runner's ``runner_build_id`` /
  ``runner_instance``, with the same meanings as on the edge ledger. The writer
  sends ``finished_at`` from the same clock as ``started_at``; the ``now()``
  default is a fallback only, since a database clock behind the runner's would
  trip ``finished_at >= started_at`` on a short run;
* the SAME four invalidation columns as the edge ledger, so a bad run is
  withdrawn the same way (set ``invalidated_*`` here and on its edges) and every
  read filters ``invalidated_at IS NULL``.

Why ``stopped_because`` matters downstream
==========================================

``frontier_exhausted`` is the ONLY stop reason under which a later
``not_reachable`` can be claimed for the explored component: every other reason
(a spent budget, an unreachable app, an auth wall) means the run stopped while
activatable frontier remained, so "the explorer did not get there" is not "there
is no way there". The journey queries already refuse ``absent`` over any open
frontier row (plan D6); this column is the run-level record of the same fact.

CHECK constraints — the vocabulary and the budget are closed HERE
=================================================================

* ``stopped_because`` ∈ ``budget_actions, budget_depth, budget_time,
  frontier_exhausted, app_unreachable, auth_wall``;
* every budget column is positive except ``budget_max_depth``, which may be 0
  (explore the start node only); every spent column is non-negative;
* ``spent_actions <= budget_max_actions`` and ``spent_depth <=
  budget_max_depth``;
* ``edges_added >= 0`` and ``edges_added <= spent_actions`` — an edge is
  written per activation, never more;
* ``finished_at >= started_at``;
* ``auth_wall`` ⇒ ``stop_node IS NOT NULL``;
* JSONB shape: ``start``, ``frontier_remaining_by_reason`` must be JSON objects
  and ``stop_node`` SQL NULL or an object, so a JSON ``null`` cannot pose as a
  node (the same rule as ``journey_01_edge_ledger``).

Indexes
=======

One: ``(app_id, finished_at DESC) WHERE invalidated_at IS NULL`` — "the live
runs of one app, newest first", the read a journey answer cites. Rows are
bounded by explorer invocations (each operator- or agent-initiated, each under a
stated budget), so the table needs no retention job; revisit if a scheduler
ever starts runs on its own.

Shaped for coord's migration classifier
=======================================

Exactly as ``journey_01_edge_ledger``: every ``op.execute`` argument is ONE
static string literal inline at the call; the table is ``CREATE TABLE IF NOT
EXISTS`` with its constraints inside the column list; the index is ``CREATE
INDEX CONCURRENTLY IF NOT EXISTS`` inside ``autocommit_block()``.

The downgrade drops the table (its index and constraints go with it).

The test reads the DDL out of THIS file — the literal arguments of the
``op.execute`` calls in ``upgrade()``, parsed with ``ast`` — so it holds no copy
that could drift.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# Keep ``down_revision`` on ONE physical line — the ``alembic-heads-pr`` CI gate
# parses it with a line-based regex.
revision: str = "journey_02_explorations"
down_revision: str | Sequence[str] | None = "coord_agent_questions_recommendation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the explorations table, then its one index."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project.journey_explorations (
            run_id TEXT NOT NULL,
            app_id TEXT NOT NULL,
            runner_build_id TEXT NOT NULL,
            runner_instance TEXT NOT NULL,
            started_at TIMESTAMPTZ NOT NULL,
            finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            start JSONB NOT NULL,
            budget_max_actions INTEGER NOT NULL,
            budget_max_depth INTEGER NOT NULL,
            budget_max_wall_clock_s INTEGER NOT NULL,
            spent_actions INTEGER NOT NULL,
            spent_depth INTEGER NOT NULL,
            spent_wall_clock_ms BIGINT NOT NULL,
            stopped_because TEXT NOT NULL,
            stop_node JSONB,
            edges_added INTEGER NOT NULL,
            frontier_remaining_by_reason JSONB NOT NULL,
            invalidated_at TIMESTAMPTZ,
            invalidated_reason TEXT,
            invalidated_by TEXT,
            invalidation_token TEXT,
            CONSTRAINT journey_explorations_pkey PRIMARY KEY (run_id),
            CONSTRAINT ck_journey_explorations_stopped_because
                CHECK (stopped_because IN (
                    'budget_actions', 'budget_depth', 'budget_time',
                    'frontier_exhausted', 'app_unreachable', 'auth_wall'
                )),
            CONSTRAINT ck_journey_explorations_budget_positive
                CHECK (
                    budget_max_actions > 0
                    AND budget_max_depth >= 0
                    AND budget_max_wall_clock_s > 0
                ),
            CONSTRAINT ck_journey_explorations_spent_non_negative
                CHECK (
                    spent_actions >= 0
                    AND spent_depth >= 0
                    AND spent_wall_clock_ms >= 0
                ),
            CONSTRAINT ck_journey_explorations_spent_within_budget
                CHECK (
                    spent_actions <= budget_max_actions
                    AND spent_depth <= budget_max_depth
                ),
            CONSTRAINT ck_journey_explorations_edges_added
                CHECK (edges_added >= 0 AND edges_added <= spent_actions),
            CONSTRAINT ck_journey_explorations_finished_after_started
                CHECK (finished_at >= started_at),
            CONSTRAINT ck_journey_explorations_auth_wall_names_node
                CHECK (stopped_because <> 'auth_wall' OR stop_node IS NOT NULL),
            CONSTRAINT ck_journey_explorations_start_object
                CHECK (jsonb_typeof(start) = 'object'),
            CONSTRAINT ck_journey_explorations_stop_node_object
                CHECK (stop_node IS NULL OR jsonb_typeof(stop_node) = 'object'),
            CONSTRAINT ck_journey_explorations_frontier_remaining_object
                CHECK (jsonb_typeof(frontier_remaining_by_reason) = 'object')
        )
        """
    )
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_journey_explorations_app_finished_at
                ON project.journey_explorations (app_id, finished_at DESC)
                WHERE invalidated_at IS NULL
            """
        )


def downgrade() -> None:
    """Drop the table; its index and constraints go with it."""
    op.execute("DROP TABLE IF EXISTS project.journey_explorations")
