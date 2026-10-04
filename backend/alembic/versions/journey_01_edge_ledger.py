"""project.journey_edge_observations + project.journey_frontier — the observed journey ledger

Revision ID: journey_01_edge_ledger
Revises: findings_dossier_idx_01
Create Date: 2026-09-30

Phase 1 (qontinui-web half) of plan
``2026-09-20-ui-bridge-represents-the-users-path-and-the-passage-of-time``.
The two tables implement the plan's "Edge-observation contract" section,
frozen by its Phase 0, EXACTLY — the runner producer (``src-tauri/src/journey/``)
and ``qontinui-schemas`` ``rust/src/journey.rs`` implement the same contract, so
a column here that the contract does not name is drift, not a convenience.

``down_revision`` is this repo's LOCAL single alembic head at authoring time and
is deliberately NOT pinned: ``alembic-graph-pr.yml`` serialises alembic PRs, so
any revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; never author an ``alembic merge``
revision for it.

The gap
=======

The state model (IR ``IrState`` / ``IrTransition``) has a durable OBSERVED
half for states only: the runner's passive capture writes one
``co_occurrence_observations`` row per snapshot and derives states from them.
No transition is observed anywhere durable — every transition in the corpus is
AI-asserted, and the in-page recorders (``SessionRecorder``,
``RecordingSessionManager``) keep what they observe in memory for one page
lifetime. So every journey question (can a user get from A to B? what is a dead
end?) is answered over a declared graph that holds zero cross-page edges.

What this revision adds
=======================

``project.journey_edge_observations`` — one row per agent UI action the runner
carried (``from_node`` → ``to_node``, the trigger, the outcome, provenance).
Mirrors ``co_occurrence_observations`` deliberately in its JSONB payload
columns, its server-stamped time column (``observed_at``, as ``captured_at``
there), and the SAME four invalidation columns with the same types, so a bad
run is withdrawn the same way (set ``invalidated_*``) and every read filters
``invalidated_at IS NULL``. The ``id`` default ``gen_random_uuid()`` is NEW
here — ``co_occurrence_observations.id`` has no server default (its writer
supplies the id) — so the producer's INSERT may omit ``id``. The graph is
DERIVED on read (plan D1); nothing here is a graph.

``project.journey_frontier`` — one row per affordance that was SEEN on a node
and never activated from it, keyed ``(app_id, node_key,
affordance_fingerprint)``. It is what makes *unexplored* distinguishable from
*unreachable*: a journey query may only answer "not reachable" over a closed
frontier (plan D6). The key bounds it, so it needs no retention.

CHECK constraints — the vocabularies are closed HERE
====================================================

Every enumerated column carries a CHECK naming its full vocabulary, copied from
the contract:

* ``run_kind`` ∈ ``agent_action, explorer, passive_session``;
* ``outcome`` ∈ ``changed, no_change, error, settle_timeout,
  to_node_unobserved``;
* ``to_node IS NULL`` **iff** ``outcome = 'to_node_unobserved'`` — plan D3's
  pending-edge rule: a second action arriving before any snapshot closes the
  first edge with an UNKNOWN destination rather than a guessed one, and a NULL
  destination under any other outcome would be a guess the reader cannot see;
* frontier ``declared_effect`` ∈ ``read, write, destructive`` (NULL =
  undeclared, which is NOT "safe");
* frontier ``reason`` ∈ ``not_yet_activated, effect_undeclared, effect_write,
  effect_destructive, budget_exhausted, activation_failed``.

The JSONB columns carry a shape CHECK as well: ``from_node``, ``trigger`` and
frontier ``node`` must be JSON objects, and ``to_node`` is SQL NULL or an
object. Without it a JSON ``null`` (``'null'::jsonb``, which is NOT SQL NULL)
could pose as a node — satisfying ``NOT NULL`` and slipping past the
pending-edge rule as an "observed" destination that names nothing.

A CHECK rather than trusting the writer: the producer is a fire-and-forget task
on the runner's hot path, and a misspelled outcome word would otherwise sit in
the ledger as a row every Phase 2 query silently fails to classify. A refused
INSERT is loud (the runner's ``LedgerState`` reports ``write_failing``); a
quietly unclassifiable row is not.

``trigger`` has no typed-text slot — by contract, not by convention: the
runner's ``JourneyTrigger`` is ``deny_unknown_fields`` and has no ``value`` /
``text`` field, which keeps passive recording inside the structural redaction
line of plan ``2026-07-20-ui-bridge-structural-redaction-enforcement``. The
column is JSONB because the TYPE, not the table, is where that line is held.

Indexes
=======

Exactly the two the contract names:

* ``(app_id, observed_at DESC) WHERE invalidated_at IS NULL`` — the Phase 2
  query shape: every live edge of one app, newest first;
* ``(app_id, run_id)`` — withdrawing or inspecting one run.

No ``observed_at``-only index for the retention job
(``app.jobs.journey_edge_retention``): it runs hourly over a table measured at
~11 snapshot-equivalents per 30 days on the one box that reported (Phase 0 U5),
so a b-tree maintained on every INSERT to speed an hourly scan is the worse
trade. Revisit — add ``(observed_at)`` — when EITHER trigger fires in THIS
database: the job's ``estimated_rows`` (``pg_class.reltuples``) exceeds
1,000,000, or one retention pass takes longer than 60 s. Both are logged by the
job on every pass, so both are observable in the backend log.

``project.journey_explorations`` is NOT created here — Phase 3 adds it with the
explorer that writes it (no table without a writer).

Shaped for coord's migration classifier
=======================================

The upgrade path is written so qontinui-coord's merge-train migration
classifier (``crates/coord/src/pr_merge/migration_classifier.rs``) can prove it
additive-safe:

* every ``op.execute`` argument is ONE static string literal written inline at
  the call — a module constant, f-string or concatenation is "dynamic" to the
  classifier and holds the PR;
* both tables are ``CREATE TABLE IF NOT EXISTS`` with a plain column list (the
  table-level ``CONSTRAINT`` clauses sit inside that list, which the classifier
  admits);
* both indexes are ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` inside
  ``with op.get_context().autocommit_block():`` — the classifier rejects a
  non-concurrent ``CREATE INDEX`` even on a table created in the same
  revision, because it cannot see that the table is new.

``IF NOT EXISTS`` on the tables is a fleet decision that OVERRIDES this
revision's earlier choice of a plain ``CREATE`` (which would have refused a
pre-existing same-named table of unknown shape): the classifier requires the
guard, and the cost is that such a table would be adopted silently. That risk
is ACCEPTED, and nothing detects it in a real database: the migration test runs
only against a fresh ephemeral one. Likewise a CONCURRENTLY build that failed
part-way leaves an INVALID index that ``IF NOT EXISTS`` keeps on a re-run; over
a table created empty moments earlier that needs a crash mid-build. CI asserts
both indexes are VALID (``pg_index.indisvalid``) after upgrade; production has
no such check.

Order: both tables first (in alembic's transaction), then the index block, which
commits that transaction and builds the indexes in autocommit. A failure in the
block leaves the tables created and the revision unstamped; a re-run is
idempotent through the guards.

The downgrade drops both tables (their indexes and constraints go with them).

The tests read the DDL out of THIS file — the literal arguments of the
``op.execute`` calls in ``upgrade()``, parsed with ``ast`` — so neither test
holds a copy that could drift.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# Keep ``down_revision`` on ONE physical line — the ``alembic-heads-pr`` CI gate
# parses it with a line-based regex.
revision: str = "journey_01_edge_ledger"
down_revision: str | Sequence[str] | None = "findings_dossier_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the edge ledger and the frontier, then the ledger's two indexes."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project.journey_edge_observations (
            id UUID NOT NULL DEFAULT gen_random_uuid(),
            observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            app_id TEXT NOT NULL,
            app_version TEXT,
            runner_build_id TEXT NOT NULL,
            runner_instance TEXT NOT NULL,
            run_id TEXT,
            run_kind TEXT NOT NULL,
            from_node JSONB NOT NULL,
            to_node JSONB,
            trigger JSONB NOT NULL,
            outcome TEXT NOT NULL,
            timeline JSONB,
            invalidated_at TIMESTAMPTZ,
            invalidated_reason TEXT,
            invalidated_by TEXT,
            invalidation_token TEXT,
            CONSTRAINT journey_edge_observations_pkey PRIMARY KEY (id),
            CONSTRAINT ck_journey_edge_observations_run_kind
                CHECK (run_kind IN ('agent_action', 'explorer', 'passive_session')),
            CONSTRAINT ck_journey_edge_observations_outcome
                CHECK (outcome IN (
                    'changed', 'no_change', 'error', 'settle_timeout',
                    'to_node_unobserved'
                )),
            CONSTRAINT ck_journey_edge_observations_to_node_iff_observed
                CHECK ((to_node IS NULL) = (outcome = 'to_node_unobserved')),
            CONSTRAINT ck_journey_edge_observations_from_node_object
                CHECK (jsonb_typeof(from_node) = 'object'),
            CONSTRAINT ck_journey_edge_observations_to_node_object
                CHECK (to_node IS NULL OR jsonb_typeof(to_node) = 'object'),
            CONSTRAINT ck_journey_edge_observations_trigger_object
                CHECK (jsonb_typeof(trigger) = 'object')
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS project.journey_frontier (
            app_id TEXT NOT NULL,
            node_key TEXT NOT NULL,
            node JSONB NOT NULL,
            affordance_fingerprint TEXT NOT NULL,
            affordance_role TEXT,
            declared_effect TEXT,
            reason TEXT NOT NULL,
            first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen_run_id TEXT,
            CONSTRAINT journey_frontier_pkey
                PRIMARY KEY (app_id, node_key, affordance_fingerprint),
            CONSTRAINT ck_journey_frontier_declared_effect
                CHECK (declared_effect IN ('read', 'write', 'destructive')),
            CONSTRAINT ck_journey_frontier_reason
                CHECK (reason IN (
                    'not_yet_activated', 'effect_undeclared', 'effect_write',
                    'effect_destructive', 'budget_exhausted', 'activation_failed'
                )),
            CONSTRAINT ck_journey_frontier_node_object
                CHECK (jsonb_typeof(node) = 'object')
        )
        """
    )
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_journey_edge_observations_app_observed_at
                ON project.journey_edge_observations (app_id, observed_at DESC)
                WHERE invalidated_at IS NULL
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_journey_edge_observations_app_run
                ON project.journey_edge_observations (app_id, run_id)
            """
        )


def downgrade() -> None:
    """Drop both tables; their indexes and constraints go with them."""
    op.execute("DROP TABLE IF EXISTS project.journey_frontier")
    op.execute("DROP TABLE IF EXISTS project.journey_edge_observations")
