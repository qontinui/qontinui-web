"""cmpaxis 01 -- project.comparison_runs computed treatment axis + drift class

Revision ID: cmpaxis_01_comparison_computed_axis
Revises: coord_obs_idx_01
Create Date: 2026-08-22

Schema half of plan ``2026-08-20-comparison-treatment-axis-is-declared-not-computed``.

Why
===

``project.comparison_runs.variation_type`` is a *declared* label -- the author's
claim about what varies between the arms of a comparison run. Nothing has ever
checked it against what actually differs, so a run labelled ``same`` was never
verified to be same, and a ``custom`` run could silently move an axis nobody
declared. That matters because a comparison feeds an autonomous promotion path:
a comparison-derived ``config_change`` recommendation at confidence >= 0.75 is
swept into a 10% canary with no further human step, and the canary is auto-
promoted or rolled back on a loop that re-fires on every workflow run.

These two columns are the *actual* side of that declared-vs-actual pair.

Columns added
=============

* ``computed_axis jsonb NULL`` -- the set of JSON key paths that were observed to
  actually differ across the run's arms, as a JSON array of dotted/indexed path
  strings (e.g. ``["model"]``, ``["config_override", "prompt.system"]``). The
  runner computes it from the per-arm ``overrides`` blobs inside ``entries_json``.

  **NULL means the axis was never computed** -- a row that predates this column,
  or one whose arms could not be parsed. It does NOT mean "no axis moved"; an
  empty array ``[]`` is what "nothing differed" looks like. Readers must keep
  those two distinct (absence-is-not-zero; fleet policy
  ``verification-and-evidence`` ``silent-empty-is-unknown``).

  ``jsonb`` rather than ``text`` deliberately: the whole point of promoting this
  out of the untyped ``entries_json`` blob is that it be *queryable* across runs
  -- the plan's Phase 1 falsification probe and the Phase 2->3 rate observation
  both need cross-run aggregation. A second unqueryable blob would re-create the
  exact defect this plan closes.

* ``axis_drift_class text NOT NULL DEFAULT 'unknown'`` -- the declared-vs-actual
  classification, using the fleet's canonical drift-class wire vocabulary
  (``qontinui-coord``'s ``CanonicalDriftClass``, shipped by
  ``2026-05-30-twin-declared-vs-actual-generalization``):

  - ``none``            -- declared and computed agree.
  - ``in_place``        -- declared ``same`` but the arms actually differ.
  - ``pending``         -- the declared axis is absent from the computed set
    (declared is ahead of actual; absence, not negation).
  - ``benign_add``      -- the computed set strictly contains the declared one
    (**multi-axis**): the run moved more than it claimed.
  - ``active_negation`` -- the computed set is empty for a non-``same``
    declaration: the run asserts a treatment that demonstrably is not there. A
    comparison that compared nothing. This is the apply-block signal.
  - ``divergent``       -- the declared side is itself inconsistent.
  - ``unknown``         -- could not be determined (a coverage gap).

  ``NOT NULL DEFAULT 'unknown'`` is the robustness choice, and it is the reason
  this column is not nullable while ``computed_axis`` is. Every existing row
  backfills to ``unknown`` -- honestly "we never looked" -- rather than to
  ``none``, which would assert agreement nobody ever verified. Postgres 11+
  materializes a non-volatile default without a table rewrite, so no backfill
  statement is needed. It also matches coord's own parser, whose
  ``CanonicalDriftClass::from_wire_str`` maps any unrecognized or empty token to
  ``Unknown`` for exactly this reason.

  No CHECK constraint and no enum type: the vocabulary is owned by coord's Rust
  side, and pinning a copy of it in Postgres would create a second source of
  truth that drifts the first time coord adds a class. The runner parses the
  token and treats anything unrecognized as ``unknown``.

Index
=====

``idx_comparison_runs_axis_drift`` on ``axis_drift_class``, partial on
``axis_drift_class NOT IN ('none', 'unknown')`` -- the actual *mismatch* set.

The predicate excludes both uninteresting poles deliberately, and it is chosen so
the index stays small in BOTH states of the world: before the runner half lands
every row is ``unknown`` (index empty), and after it lands the overwhelming
majority will be ``none`` (index holds only the genuine mismatches). A plain
index on a seven-value column would be near-useless to the planner, and a
partial index on ``<> 'none'`` alone would cover the whole table today, when
every row is ``unknown``.

Consumer ordering
=================

The runner reads and writes these columns, but its ``schema.pg.sql.generated``
is a pg_dump of THIS alembic-managed schema. So this revision must land and be
applied before the runner half can go green: the runner PR regenerates that file
and its ``schema-fresh`` CI gate fails on a non-empty diff.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "cmpaxis_01_comparison_computed_axis"
down_revision: str = "coord_obs_idx_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "comparison_runs",
        sa.Column("computed_axis", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="project",
    )
    op.add_column(
        "comparison_runs",
        sa.Column(
            "axis_drift_class",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'unknown'"),
        ),
        schema="project",
    )
    op.create_index(
        "idx_comparison_runs_axis_drift",
        "comparison_runs",
        ["axis_drift_class"],
        schema="project",
        postgresql_where=sa.text("axis_drift_class NOT IN ('none', 'unknown')"),
    )


def downgrade() -> None:
    op.drop_index("idx_comparison_runs_axis_drift", table_name="comparison_runs", schema="project")
    op.drop_column("comparison_runs", "axis_drift_class", schema="project")
    op.drop_column("comparison_runs", "computed_axis", schema="project")
