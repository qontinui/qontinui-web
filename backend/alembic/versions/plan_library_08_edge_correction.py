"""agent.work_artifact_edges — retract / correct a recorded edge

Revision ID: plan_library_08_edge_correction
Revises: overview_02_authoring_core
Create Date: 2026-09-22

Phase 5 of
``2026-09-20-a-recorded-delivery-scope-is-permanent-so-a-mis-declared-phase-is-uncorrectable``.

The gap
=======

``POST /plan-library/{id}/edges`` is the ONLY write verb a provenance edge
has. Re-posting an identical ``(from_id, to_id, relation)`` triple is
idempotent (``create_edge`` returns the existing row), but a DIFFERENT
triple off the same ``(from_id, relation)`` pair does not replace anything —
it APPENDS a second edge. There is no delete. This has already produced two
permanent FALSE ``supersedes`` edges on a real artifact
(``e5090437-ccd1-4349-b360-01e1a8267f19``) that could not be retracted.

This is the SAME defect class as coord's own ``delivery_scope`` correction
gap, in a different store, and this revision adopts the same provenance
shape coord uses for its fix rather than inventing a second design:
``{"source": "corrected", "corrected_by": ..., "corrected_at": ...}``.

What this revision does
========================

1. Adds seven nullable columns to ``agent.work_artifact_edges``:

   * ``retracted_at`` / ``retracted_by`` / ``retracted_reason`` — set
     together by ``DELETE /plan-library/edges/{id}``, a SOFT delete. The row
     survives (provenance is the point); a retracted edge simply stops
     asserting its relation.
   * ``corrected_at`` / ``corrected_by`` / ``corrected_reason`` / ``source``
     — set together by ``PUT /plan-library/edges/{id}``, which replaces
     ``relation`` / ``to_id`` / ``note`` IN PLACE. ``source`` is ``NULL`` for
     an edge exactly as first recorded, ``'corrected'`` for one that was
     overwritten this way — guarded by ``ck_work_artifact_edges_source``.

2. Makes ``uq_work_artifact_edges_from_to_relation`` PARTIAL
   (``WHERE retracted_at IS NULL``), so a retracted edge cannot block
   re-recording the same ``(from, to, relation)`` triple — the exact shape a
   false-``supersedes`` correction needs (retract the wrong claim, then
   record the right one).

3. Extends ``uq_work_artifact_edges_open_followup``'s partial predicate with
   the same ``retracted_at IS NULL`` condition, for consistency — a
   retracted ``spawned_followup`` must not block re-surfacing the same note.

Why the columns are added as bare ``ADD COLUMN`` statements
=============================================================

Each ``CHECK`` this revision needs (only one: ``ck_work_artifact_edges_source``
on the new ``source`` column) is declared INSIDE its ``ADD COLUMN IF NOT
EXISTS`` as a named column constraint — never as a separate ``ADD
CONSTRAINT`` — for the same reason ``plan_library_07_plan_difficulty``
does this: coord's merge-train migration classifier rejects a bare ``ADD
CONSTRAINT`` without ``NOT VALID`` and any ``DROP`` inside ``ALTER TABLE``.
An index rebuild is a genuine exception the classifier already accepts
elsewhere in this tree (``coord_workunits_03_work_unit_owner_actor``, among
others): ``DROP INDEX IF EXISTS`` / ``CREATE UNIQUE INDEX IF NOT EXISTS`` are
standalone statements, not an ``ALTER TABLE ... DROP``.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout, so each direction
re-runs cleanly and upgrade -> downgrade -> upgrade round-trips.
Hand-authored — ``alembic revision --autogenerate`` is never run here (served
policy ``production-and-cost`` ``alembic-sole-authorship``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_08_edge_correction"
down_revision = "overview_02_authoring_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent.work_artifact_edges"

#: ``(column, ddl type + inline constraint)`` in upgrade order; the downgrade
#: drops the columns reversed. Mirrors ``plan_library_07_plan_difficulty``'s
#: ``_COLUMNS`` convention: plain data, one PLAIN string literal per
#: ``ADD COLUMN`` call, no f-string, no dynamic SQL.
_COLUMNS: tuple[str, ...] = (
    "retracted_at",
    "retracted_by",
    "retracted_reason",
    "corrected_at",
    "corrected_by",
    "corrected_reason",
    "source",
)


def upgrade() -> None:
    """Add the seven correction/retraction columns, then rebuild the two indexes."""
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS retracted_at TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS retracted_by TEXT"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS retracted_reason TEXT"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS corrected_by TEXT"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS corrected_reason TEXT"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS source TEXT "
        "CONSTRAINT ck_work_artifact_edges_source "
        "CHECK (source IS NULL OR source = 'corrected')"
    )

    # Rebuild the main uniqueness guard as PARTIAL — a retracted edge (soft
    # deleted, kept for its audit trail) must not block re-recording the same
    # (from, to, relation) triple. Old index dropped first: a plain
    # non-partial UNIQUE and this partial one are different indexes even
    # under the same name, and Postgres will not let two indexes of the same
    # name coexist mid-migration.
    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifact_edges_from_to_relation")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_edges_from_to_relation "
        "ON agent.work_artifact_edges (from_id, to_id, relation) "
        "WHERE retracted_at IS NULL"
    )

    # Same treatment for the open-follow-up duplicate guard — see the module
    # docstring. The trim expression is spelled identically to
    # ``plan_library_03_spawned_followup`` (``NOTE_TRIM_SQL`` in
    # ``app/models/work_artifact.py``): the two MUST agree, since Postgres
    # matches an index by its parsed expression rather than by resemblance.
    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifact_edges_open_followup")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_edges_open_followup "
        "ON agent.work_artifact_edges (from_id, relation, btrim(note, E' \\t\\n\\r\\f\\v')) "
        "WHERE to_id IS NULL AND relation = 'spawned_followup' AND retracted_at IS NULL"
    )


def downgrade() -> None:
    """Restore the two non-partial indexes, then drop the six columns."""
    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifact_edges_open_followup")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_edges_open_followup "
        "ON agent.work_artifact_edges (from_id, relation, btrim(note, E' \\t\\n\\r\\f\\v')) "
        "WHERE to_id IS NULL AND relation = 'spawned_followup'"
    )

    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifact_edges_from_to_relation")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_edges_from_to_relation "
        "ON agent.work_artifact_edges (from_id, to_id, relation)"
    )

    for column in reversed(_COLUMNS):
        op.execute(f"ALTER TABLE {_TABLE} DROP COLUMN IF EXISTS {column}")
