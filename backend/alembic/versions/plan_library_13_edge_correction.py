"""agent.work_artifact_edges — retract / correct a recorded edge

Revision ID: plan_library_13_edge_correction
Revises: overview_07_schedule_last_known
Create Date: 2026-11-27

Phase 5 of
``2026-09-20-a-recorded-delivery-scope-is-permanent-so-a-mis-declared-phase-is-uncorrectable``.
Adopts qontinui-web#1459 (``plan_library_08_edge_correction``, never landed)
onto the current chain. Renamed because the chain has moved on since #1459:
this revises the head, ``overview_07_schedule_last_known``.

The gap
=======

``POST /plan-library/{id}/edges`` is the ONLY write verb a provenance edge
has. Re-posting an identical ``(from_id, to_id, relation)`` triple is
idempotent, but a DIFFERENT triple off the same ``(from_id, relation)`` pair
APPENDS a second edge, and there is no delete — so a wrong edge can only be
buried beside a right one. Two permanent false ``supersedes`` edges already
sit on a real artifact for exactly this reason.

What this revision does
=======================

1. Adds eight nullable columns to ``agent.work_artifact_edges``:

   * ``retracted_at`` / ``retracted_by`` / ``retracted_reason`` — stamped
     together by ``DELETE /plan-library/edges/{id}``, a SOFT delete. The row
     survives (the wrong claim is itself provenance); a retracted edge stops
     asserting its relation to every reader.
   * ``source`` / ``corrected_at`` / ``corrected_by`` / ``corrected_reason`` /
     ``corrected_replaced`` — stamped together by ``PUT
     /plan-library/edges/{id}``, which overwrites ``relation`` / ``to_id`` /
     ``note`` in place. ``source`` is NULL for an edge as first recorded and
     ``'corrected'`` after a correction (``ck_work_artifact_edges_source``);
     ``corrected_replaced`` is the claim the correction replaced, nesting any
     earlier correction, so nothing is silently rewritten.

2. Rebuilds the two UNIQUE indexes as PARTIAL on ``retracted_at IS NULL``,
   under their own names, so a retracted edge cannot block re-recording the
   right claim on the same key:

   * ``uq_work_artifact_edges_from_to_relation`` — the two-ended triple.
   * ``uq_work_artifact_edges_open_followup`` — an open follow-up's note.

   Each rebuild is a ``DROP INDEX IF EXISTS`` of the old definition followed
   by the ``CREATE UNIQUE INDEX`` of the new one under the SAME name, inside
   this revision's transaction: there is no moment at which the key is
   unguarded, and Postgres will not let two indexes share a name. Each
   CREATE's head — ``CREATE UNIQUE INDEX IF NOT EXISTS <name> ON
   agent.work_artifact_edges`` — is ONE string literal, because coord's
   re-point planner recognises a same-name rebuild only when that head is
   contiguous in one literal (the migration test pins it). coord's
   migration classifier refuses any DROP on the upgrade path, so this
   revision is expected to take the escalate path rather than auto-land; the
   alternative — a second index beside the old full one — would leave the old
   one blocking exactly the re-record this revision exists for.

   The two non-unique partial indexes over the follow-up queues
   (``ix_work_artifact_edges_open_followups_created_id`` and
   ``ix_work_artifact_edges_open_followup_queue_created_id``) are left alone:
   their readers now add ``retracted_at IS NULL`` to the index predicate, and
   a query predicate that contains every index clause still proves it.

Idempotency: every DDL statement carries ``IF NOT EXISTS`` / ``IF EXISTS``,
so the upgrade re-runs cleanly and upgrade -> downgrade -> upgrade
round-trips. The downgrade's leading ``DELETE`` reads ``retracted_at``, so the
downgrade runs from this revision applied — the only way alembic runs it.
Hand-authored — ``alembic revision --autogenerate`` is never run here (served
policy ``production-and-cost`` ``alembic-sole-authorship``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_13_edge_correction"
down_revision = "overview_07_schedule_last_known"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the correction columns, then rebuild the two unique indexes partial."""
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
    # The CHECK rides inside its ADD COLUMN as a named column constraint, never
    # a separate ADD CONSTRAINT: coord's classifier refuses an ADD CONSTRAINT
    # without NOT VALID (the convention ``plan_library_07_plan_difficulty`` set).
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS source TEXT "
        "CONSTRAINT ck_work_artifact_edges_source "
        "CHECK (source IS NULL OR source = 'corrected')"
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
        "ADD COLUMN IF NOT EXISTS corrected_replaced JSONB"
    )

    # Same-name rebuilds (see the module docstring). Every row is live at this
    # point — the columns were added a moment ago — so neither build can fail
    # on a duplicate the old index did not already refuse.
    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifact_edges_from_to_relation")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_edges_from_to_relation ON agent.work_artifact_edges "
        "(from_id, to_id, relation) "
        "WHERE retracted_at IS NULL"
    )

    # The trim expression is spelled exactly as ``plan_library_03_spawned_followup``
    # spelled it (``NOTE_TRIM_SQL`` in ``app/models/work_artifact.py``), so this
    # rebuild changes the index's predicate and nothing else. That spelling is
    # NOT what ``create_edge``'s dedup probe binds (``NOTE_TRIM_CHARS``, a
    # parameter). On PostgreSQL 16, which CI and production run, an E-string
    # reads ``\v`` as the letter ``v``; from 17 it is U+000B. An index keeps
    # what the server that built it lexed, so on 16 the two disagree on a note
    # that ends in ``v`` or in a vertical tab. That mismatch dates from
    # revision 03 and is left to its own change.
    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifact_edges_open_followup")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_edges_open_followup ON agent.work_artifact_edges "
        "(from_id, relation, btrim(note, E' \\t\\n\\r\\f\\v')) "
        "WHERE to_id IS NULL AND relation = 'spawned_followup' "
        "AND retracted_at IS NULL"
    )


def downgrade() -> None:
    """Remove the retracted rows, restore the full indexes, drop the columns.

    The retracted rows go FIRST, and on purpose. The schema this returns to has
    no way to say "retracted", so a kept row would silently re-assert the claim
    somebody withdrew; and a retracted row may share its key with the live edge
    that replaced it, which the restored full unique index would refuse.

    Dropping the correction columns is destructive too: every correction's
    provenance goes with them, so a corrected edge comes back carrying its
    corrected claim as if first recorded, with the claim it replaced (and who
    replaced it, when and why) gone. Both losses are confined to
    ``downgrade()``.
    """
    op.execute("DELETE FROM agent.work_artifact_edges WHERE retracted_at IS NOT NULL")

    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifact_edges_open_followup")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_edges_open_followup ON agent.work_artifact_edges "
        "(from_id, relation, btrim(note, E' \\t\\n\\r\\f\\v')) "
        "WHERE to_id IS NULL AND relation = 'spawned_followup'"
    )

    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifact_edges_from_to_relation")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_edges_from_to_relation ON agent.work_artifact_edges "
        "(from_id, to_id, relation)"
    )

    op.execute(
        "ALTER TABLE agent.work_artifact_edges DROP COLUMN IF EXISTS corrected_replaced"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges DROP COLUMN IF EXISTS corrected_reason"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges DROP COLUMN IF EXISTS corrected_by"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges DROP COLUMN IF EXISTS corrected_at"
    )
    op.execute("ALTER TABLE agent.work_artifact_edges DROP COLUMN IF EXISTS source")
    op.execute(
        "ALTER TABLE agent.work_artifact_edges DROP COLUMN IF EXISTS retracted_reason"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges DROP COLUMN IF EXISTS retracted_by"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges DROP COLUMN IF EXISTS retracted_at"
    )
