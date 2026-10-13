"""agent.work_artifact_edges — follow-up closure states and file anchors

Revision ID: plan_library_11_followup_anchors_and_closure
Revises: twin_fidelity_01_coord_twin_fidelity_observations
Create Date: 2026-10-12

Phase 3 of ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``.

The gap
=======

A ``spawned_followup`` edge left the open queue ONLY by being claimed — its
``to_id`` pointed at an artifact that owns the work. A two-line docstring fix
has no artifact, so it could never close. And the edge's whole payload was a
free-text ``note``, so nothing machine-readable said WHICH file in WHICH repo a
follow-up is about: a session editing that exact file could not be told about
it, and nothing could group follow-ups by repo.

What this revision adds
=======================

1. **A closure state (D1)**, valid only on ``spawned_followup``:

   * ``resolution`` — ``fixing`` | ``fixed`` | ``already_fixed`` |
     ``dismissed``; NULL is OPEN;
   * ``resolution_pr`` (``owner/name#n``), ``resolution_commit``,
     ``resolution_note``, ``resolved_by``, ``resolved_at`` — the CURRENT state's
     facts;
   * ``resolution_history`` — ``jsonb NOT NULL DEFAULT '[]'``, an append-only
     list of ``{from, to, at, by, pr, commit, note}``.

   A follow-up is OPEN iff ``to_id IS NULL AND resolution IS NULL``.

2. **Matching facts (D2)**: ``size_class`` (``trivial`` | ``small`` |
   ``plan_sized``; NULL is unclassified), ``size_class_source`` (``declared`` |
   ``sweep``; set iff ``size_class`` is) and ``unanchored_reason``.

3. **The anchor table (D2)** ``agent.work_artifact_edge_anchors`` — many
   ``(repo, path, line_start, line_end, symbol)`` rows per follow-up, deleted
   with their edge, unique on ``(edge_id, repo, path, coalesce(line_start,
   -1))`` and indexed on ``(repo, path)``, the key every match uses.

4. **The open-queue index** ``ix_work_artifact_edges_open_followup_queue_created_id``
   — ``(created_at, id)`` PARTIAL on the open predicate, so the oldest-first
   walk over OPEN follow-ups never scans the resolved history first.

The fences
==========

Every CHECK is declared INSIDE the ``ADD COLUMN IF NOT EXISTS`` of the column
it is about, as a named column constraint, never as ``ADD CONSTRAINT``, for the
reasons ``plan_library_07_plan_difficulty`` records: coord's merge-train
migration classifier rejects an ``ADD CONSTRAINT`` without ``NOT VALID``, and
``IF NOT EXISTS`` skips the column and its constraints together, so a re-run is
clean. Validating them costs nothing: every column is new, so every existing row
holds NULL (and ``'[]'``), which each CHECK admits. A constraint may reference
another column (PostgreSQL does not restrict a column constraint to its own
column), so the columns are added in the order their CHECKs need.

The predicates are ``app.models.work_artifact.FOLLOWUP_EDGE_CHECKS`` /
``FOLLOWUP_ANCHOR_CHECKS`` spelled out — this revision imports nothing from
``app`` (no revision in this tree does: a model module changes, a revision must
not). ``tests/test_plan_library_11_followup_anchors_and_closure_migration.py``
proves each one equal to the model's through PostgreSQL's own normalisation.

One deliberate difference from the plan's first sketch: ``fixed`` does NOT
require ``resolution_commit``. ``fixed`` is coord's land verdict, and coord can
report a land with no recorded commit (a PR whose commits landed through
another one); refusing that row would leave a landed fix reading ``fixing``
forever. ``already_fixed`` is nothing but its commit, so it keeps the
requirement.

The open predicate is spelled ONCE in the model (``OPEN_FOLLOWUP_SQL``); the
index build below is a static literal of the same text (coord's classifier
refuses an interpolated ``op.execute``), and the migration test pins the two
equal. ``uq_work_artifact_edges_open_followup`` keeps its predicate on purpose:
re-posting the note of a RESOLVED follow-up returns that resolved row (with its
state) rather than a duplicate.

Why the old index is not rebuilt
================================

``ix_work_artifact_edges_open_followups_created_id``
(``plan_library_10_keyset_walk_indexes``) is partial on ``relation =
'spawned_followup' AND to_id IS NULL`` — "open" before this revision. It is
LEFT AS IT IS and a new index carries the narrower predicate: rebuilding or
renaming it needs a ``DROP`` / ``ALTER INDEX`` on the upgrade path, which the
classifier refuses, parking the PR on ``escalate-path-matched``. The old index
keeps a real job — it serves the walks over every unclaimed follow-up (the
``fixing`` and resolved views, the reconcile's walk over ``fixing``).

Lock footprint
==============

Each ``ADD COLUMN`` takes ``agent.work_artifact_edges``' ACCESS EXCLUSIVE lock
briefly; every default is a constant (``'[]'::jsonb``), so nothing is rewritten.
The anchor table is new, so its two non-concurrent indexes are built on zero
rows (the classifier reads them as a new-table claim it discharges against
trunk). The open-queue index is built ``CONCURRENTLY`` in an autocommit block,
last, because the table is live.

Downgrade
=========

Drops the open-queue index, the anchor table and the ten columns (each
column's CHECKs go with it). Destructive in the only way it can be: every
resolution and every anchor is discarded, so a follow-up that was resolved
reads OPEN again afterwards — the pre-revision schema has no column that could
hold its state. Idempotent: ``IF EXISTS`` throughout.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_11_followup_anchors_and_closure"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "twin_fidelity_01_coord_twin_fidelity_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EDGES = "agent.work_artifact_edges"

#: The columns ``upgrade()`` adds, in order; the downgrade drops them reversed.
#: ``tests/test_plan_library_11_followup_anchors_and_closure_migration.py``
#: asserts this equals the ``ADD COLUMN`` sequence the upgrade executes.
_COLUMNS: tuple[str, ...] = (
    "resolution_pr",
    "resolution_commit",
    "resolution_note",
    "resolved_by",
    "resolved_at",
    "resolution",
    "resolution_history",
    "size_class",
    "size_class_source",
    "unanchored_reason",
)

_ANCHORS = "agent.work_artifact_edge_anchors"
_OPEN_QUEUE_INDEX = "ix_work_artifact_edges_open_followup_queue_created_id"


def upgrade() -> None:
    """Add the closure columns, the anchor table and the open-queue index.

    One PLAIN string literal per call — adjacent literals, a raw one where the
    SQL carries ``E'…'`` escapes — and no f-string or formatting, because
    coord's migration classifier rejects dynamic SQL (it cannot prove an
    interpolated statement additive).
    """
    # ── the closure columns (D1) ────────────────────────────────────────
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS resolution_pr TEXT "
        "CONSTRAINT ck_work_artifact_edges_resolution_pr_shape "
        "CHECK (resolution_pr ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[1-9][0-9]*$')"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS resolution_commit TEXT "
        "CONSTRAINT ck_work_artifact_edges_resolution_commit_shape "
        "CHECK (resolution_commit ~ '^[0-9a-f]{7,64}$')"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS resolution_note TEXT"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS resolved_by TEXT"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ"
    )
    # ``resolution`` last of the current-state columns: its CHECKs read the
    # five above, and ``to_id``.
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS resolution TEXT "
        "CONSTRAINT ck_work_artifact_edges_resolution "
        "CHECK (resolution IN ('fixing', 'fixed', 'already_fixed', 'dismissed')) "
        "CONSTRAINT ck_work_artifact_edges_resolution_unclaimed "
        "CHECK (resolution IS NULL OR to_id IS NULL) "
        "CONSTRAINT ck_work_artifact_edges_resolution_pr_required "
        "CHECK (resolution IS NULL OR resolution NOT IN ('fixing', 'fixed') "
        "OR resolution_pr IS NOT NULL) "
        "CONSTRAINT ck_work_artifact_edges_resolution_commit_required "
        "CHECK (resolution IS DISTINCT FROM 'already_fixed' "
        "OR resolution_commit IS NOT NULL) "
        "CONSTRAINT ck_work_artifact_edges_resolved_at_required "
        "CHECK (resolution IS NULL OR resolved_at IS NOT NULL) "
        "CONSTRAINT ck_work_artifact_edges_dismissed_reason "
        "CHECK (resolution IS DISTINCT FROM 'dismissed' "
        r"OR (resolution_note IS NOT NULL AND btrim(resolution_note, E' \t\n\r\f\v') <> '')) "
        "CONSTRAINT ck_work_artifact_edges_open_carries_no_resolution "
        "CHECK (resolution IS NOT NULL OR (resolution_pr IS NULL "
        "AND resolution_commit IS NULL AND resolution_note IS NULL "
        "AND resolved_by IS NULL AND resolved_at IS NULL))"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS resolution_history JSONB NOT NULL "
        "DEFAULT '[]'::jsonb "
        "CONSTRAINT ck_work_artifact_edges_resolution_history_array "
        "CHECK (jsonb_typeof(resolution_history) = 'array')"
    )

    # ── the matching facts (D2) ─────────────────────────────────────────
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS size_class TEXT "
        "CONSTRAINT ck_work_artifact_edges_size_class "
        "CHECK (size_class IN ('trivial', 'small', 'plan_sized'))"
    )
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS size_class_source TEXT "
        "CONSTRAINT ck_work_artifact_edges_size_class_source "
        "CHECK (size_class_source IN ('declared', 'sweep')) "
        "CONSTRAINT ck_work_artifact_edges_size_class_paired "
        "CHECK ((size_class IS NULL) = (size_class_source IS NULL))"
    )
    # Added LAST: the follow-up-only fence reads every closure column.
    op.execute(
        "ALTER TABLE agent.work_artifact_edges "
        "ADD COLUMN IF NOT EXISTS unanchored_reason TEXT "
        "CONSTRAINT ck_work_artifact_edges_unanchored_reason_nonblank "
        r"CHECK (unanchored_reason IS NULL OR btrim(unanchored_reason, E' \t\n\r\f\v') <> '') "
        "CONSTRAINT ck_work_artifact_edges_followup_only_columns "
        "CHECK (relation = 'spawned_followup' OR (resolution IS NULL "
        "AND resolution_pr IS NULL AND resolution_commit IS NULL "
        "AND resolution_note IS NULL AND resolved_by IS NULL "
        "AND resolved_at IS NULL AND size_class IS NULL "
        "AND size_class_source IS NULL AND unanchored_reason IS NULL "
        "AND resolution_history = '[]'::jsonb))"
    )

    # ── the anchor table (D2) ───────────────────────────────────────────
    op.execute(
        "CREATE TABLE IF NOT EXISTS agent.work_artifact_edge_anchors ("
        "id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "edge_id UUID NOT NULL "
        "REFERENCES agent.work_artifact_edges (id) ON DELETE CASCADE, "
        "repo TEXT NOT NULL, "
        "path TEXT NOT NULL, "
        "line_start INTEGER, "
        "line_end INTEGER, "
        "symbol TEXT, "
        "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "CONSTRAINT ck_work_artifact_edge_anchors_repo_shape "
        "CHECK (length(repo) <= 255 "
        "AND repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'), "
        "CONSTRAINT ck_work_artifact_edge_anchors_path_shape "
        "CHECK (path <> '' AND length(path) <= 1024 "
        "AND left(path, 1) NOT IN ('/', ' ') AND right(path, 1) NOT IN ('/', ' ') "
        "AND strpos(path, chr(92)) = 0 AND strpos(path, '//') = 0 "
        "AND path !~ '(^|/)[.][.]?(/|$)' AND path !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')), "
        "CONSTRAINT ck_work_artifact_edge_anchors_lines "
        "CHECK ((line_start IS NULL OR line_start >= 1) AND (line_end IS NULL "
        "OR (line_start IS NOT NULL AND line_end >= line_start))), "
        "CONSTRAINT ck_work_artifact_edge_anchors_symbol_nonblank "
        r"CHECK (symbol IS NULL OR btrim(symbol, E' \t\n\r\f\v') <> '')"
        ")"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS "
        "uq_work_artifact_edge_anchors_edge_repo_path_line "
        "ON agent.work_artifact_edge_anchors "
        "(edge_id, repo, path, coalesce(line_start, -1))"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_work_artifact_edge_anchors_repo_path "
        "ON agent.work_artifact_edge_anchors (repo, path)"
    )

    # ── the open-queue index — live table, so CONCURRENTLY, and last ─────
    # The predicate is ``app.models.work_artifact.OPEN_FOLLOWUP_SQL`` verbatim.
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_work_artifact_edges_open_followup_queue_created_id "
            "ON agent.work_artifact_edges (created_at, id) "
            "WHERE relation = 'spawned_followup' AND to_id IS NULL "
            "AND resolution IS NULL"
        )


def downgrade() -> None:
    """Drop the index, the anchor table and the columns (their CHECKs go with
    them). Every resolution and anchor is discarded — see the docstring."""
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS agent.{_OPEN_QUEUE_INDEX}")
    op.execute(f"DROP TABLE IF EXISTS {_ANCHORS}")
    for column in reversed(_COLUMNS):
        op.execute(f"ALTER TABLE {_EDGES} DROP COLUMN IF EXISTS {column}")
