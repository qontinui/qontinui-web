"""agent.work_artifact_edges - a follow-up is identified by its note, not by its pair

Revision ID: plan_library_12_followup_identity_is_the_note
Revises: coord_test_result_runs_01
Create Date: 2026-11-08

Plan ``2026-11-08-a-plan-can-own-many-followups-from-one-source-plan`` Phase 2
(D1, D2, D3, D5, D6).

The defect
==========

``uq_work_artifact_edges_from_to_relation`` is ``UNIQUE (from_id, to_id,
relation)`` over EVERY row. It was written for the two-ended relations, where
the pair IS the identity: it stops a ``depends_on`` or ``supersedes`` edge from
being recorded twice. When ``spawned_followup`` arrived
(``plan_library_03_spawned_followup``) the index was left alone on the
reasoning that an OPEN follow-up has ``to_id NULL``, SQL treats NULLs as
distinct, and so several follow-ups off one plan stay legal. That reasoning
stops at the moment of the claim: the instant a second follow-up from the same
source gets the same owner, both rows read ``(source, owner,
'spawned_followup')`` and the second ``UPDATE`` is refused. One plan could own
one of a source plan's follow-ups, and the claim route reported the refusal as
"already claimed by <the REQUESTED owner>" while the edge stayed open.

A follow-up's identity is the finding it records, which inside a source plan is
its NOTE. The database can state that only per population. It already keys OPEN
follow-ups by ``(source, note)`` (``uq_work_artifact_edges_open_followup``); this
revision keys OWNED ones by ``(source, owner, note)``, so an owned follow-up is
identified by what it says as well as by whom it connects. It relates neither an
open row to an owned one nor two owners of one note: a unique ``(source, note)``
over every state could fail on rows earlier builds left behind, so that is the
follow-up once a census of them reads zero. Until then identity ACROSS states
and owners is enforced by the write doors' lookups, which ``create_edge``
serializes per ``(source, note)`` with a transaction-scoped advisory lock - two
concurrent posts of one finding cannot both insert.

What this revision does
=======================

Three statements, in this order, inside ONE autocommit block:

1. ``uq_work_artifact_edges_from_to_relation_non_followup`` - the old pair
   index narrowed to ``WHERE relation <> 'spawned_followup'``, under a NEW name.
   Every other relation keeps the database-level uniqueness it has today.
2. ``uq_work_artifact_edges_owned_followup`` - ``UNIQUE (from_id, to_id,
   relation, btrim(note, E' \\t\\n\\r\\f\\v')) WHERE relation = 'spawned_followup'
   AND to_id IS NOT NULL``. An owner can hold any number of a source's
   follow-ups, but never the same finding twice. The open-follow-up guard
   ``uq_work_artifact_edges_open_followup`` is untouched and keeps the same job
   for the unowned rows.
3. ``DROP INDEX CONCURRENTLY IF EXISTS`` the old full pair index.

Neither new index can fail on existing data: the old index allowed at most one
owned follow-up per pair, so no owned group repeats. There is never a moment
without a guard, and the table is never write-locked for a build.

Why the shape is not simpler
----------------------------

* **A new name.** While the old index exists, ``CREATE UNIQUE INDEX IF NOT
  EXISTS <same name>`` is a silent no-op.
* **Create first, drop last.** Dropping first would hold the table's ACCESS
  EXCLUSIVE lock through a non-concurrent rebuild (the shape of the open
  edge-correction PR); made concurrent, it would leave a window with no
  uniqueness guard on any relation.
* **The validity assertion.** ``CREATE INDEX CONCURRENTLY`` that fails part-way
  leaves an INVALID index, and ``IF NOT EXISTS`` then SKIPS it by name. A retry
  would carry on to the final ``DROP`` and remove the only VALID guard on
  eleven relations. So, in order: any INVALID leftover of the two new names is
  dropped (``indisvalid`` read first), both builds run, BOTH are asserted
  ``indisvalid`` (:func:`_require_valid`, the ``census_idx_01`` pattern) and the
  old index is dropped only after that. An assertion that fails leaves the old
  index in place. Recovery by hand, should it ever be needed: ``DROP INDEX
  CONCURRENTLY agent.<name>`` for the named index and re-run the revision.

``retracted_at``
----------------

qontinui-web#1459 (edge correction) is not on ``main`` at the time of writing
and ``WorkArtifactEdge`` has no ``retracted_at`` column, so neither predicate
carries ``AND retracted_at IS NULL``. Whichever of the two lands second chains
on the other's revision and adds that term to both predicates here and in
``app.models.work_artifact`` (``NON_FOLLOWUP_PAIR_SQL``, ``OWNED_FOLLOWUP_SQL``).
Anything that restores a pair index covering ``spawned_followup`` reddens
``tests/test_plan_library_12_followup_identity_migration.py``'s head-level
ratchet in its own PR.

The predicates are those two constants spelled out: this revision imports
nothing from ``app`` (no revision in this tree imports it at module scope; the
one guarded import, in ``github_id_01_add_github_identity``, sits inside a
function) and coord's migration classifier refuses an interpolated
``op.execute``, so the test pins the two equal, and equal through PostgreSQL's
own normalisation of the model's DDL.

coord's classifier
------------------

The classifier REJECTS this revision, and that is expected: the ``DROP`` of the
old index is destructive on the upgrade path, and the validity probe reads
through the migration connection, which the classifier cannot inspect. No
route removes a unique index without a ``DROP`` or an ``ALTER INDEX``, so the
hold is accepted rather than engineered around, and cleared as agent work
(``decision_record/escalate-path-clearance-is-agent-work``). The builds are
``CONCURRENTLY ... IF NOT EXISTS`` inside an autocommit block, the shape the
classifier admits.

Nothing reads the old index by name: over ``origin/main`` it is named only in
migrations, the model, one exception comment and tests; the runner's generated
schema snapshot lists it and no SQL there reads it, and coord and claude-config
do not mention it. Dropping a unique index only loosens, so the previous
application build runs unchanged against the new schema.

Downgrade
=========

Recreating the old FULL pair index fails once two owned follow-ups share a pair
- exactly the state this revision makes legal. So ``downgrade()`` first counts
those groups and REFUSES (one ``DO`` block, one ``RAISE EXCEPTION``) naming
the count and the query. It never deletes or re-points an ownership row to make
the index build: that is a decision about each row. On a database with no such
rows it round-trips cleanly. The rebuilt index is asserted valid before the new
ones are dropped, for the same reason as on the way up.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_12_followup_identity_is_the_note"
# One line, unannotated - see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "coord_test_result_runs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NON_FOLLOWUP_INDEX = "uq_work_artifact_edges_from_to_relation_non_followup"
_OWNED_INDEX = "uq_work_artifact_edges_owned_followup"
_OLD_INDEX = "uq_work_artifact_edges_from_to_relation"


def _index_valid(name: str) -> bool | None:
    """``indisvalid`` of ``agent.<name>``, or ``None`` when no such index exists."""
    return (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT i.indisvalid FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'agent' AND c.relname = :n"
            ),
            {"n": name},
        )
        .scalar()
    )


def _invalid_leftovers() -> tuple[str, ...]:
    """The new indexes an earlier, interrupted run left INVALID.

    ``IF NOT EXISTS`` skips an index by name whatever its state, so a leftover
    that is not dropped is never rebuilt.
    """
    return tuple(
        name
        for name in (_NON_FOLLOWUP_INDEX, _OWNED_INDEX)
        if _index_valid(name) is False
    )


def _require_valid(*names: str) -> None:
    """Refuse unless every named ``agent.<name>`` exists and is ``indisvalid``.

    Called BETWEEN the builds and the destructive step, so a refusal leaves the
    old guard in place.
    """
    for name in names:
        valid = _index_valid(name)
        if valid is not True:
            state = "INVALID" if valid is False else "absent"
            raise RuntimeError(
                f"agent.{name} is {state} after CREATE UNIQUE INDEX CONCURRENTLY "
                "IF NOT EXISTS - a failed or killed concurrent build left it "
                "(IF NOT EXISTS skipped it). The guard it replaces has NOT been "
                "dropped, so nothing is unguarded. "
                f"Run `DROP INDEX CONCURRENTLY agent.{name}` and re-run this "
                "revision."
            )


def upgrade() -> None:
    """Narrow the pair index, add the owned-note guard, then drop the old index.

    One PLAIN string literal per call - adjacent literals, a raw one where the
    SQL carries ``E'...'`` escapes - and no f-string or formatting, because
    coord's migration classifier rejects dynamic SQL.
    """
    with op.get_context().autocommit_block():
        # A leftover INVALID index of a new name would be skipped by IF NOT
        # EXISTS below and then counted on. Drop it so the build runs again.
        leftovers = _invalid_leftovers()
        if _NON_FOLLOWUP_INDEX in leftovers:
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "agent.uq_work_artifact_edges_from_to_relation_non_followup"
            )
        if _OWNED_INDEX in leftovers:
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "agent.uq_work_artifact_edges_owned_followup"
            )

        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
            "uq_work_artifact_edges_from_to_relation_non_followup "
            "ON agent.work_artifact_edges (from_id, to_id, relation) "
            "WHERE relation <> 'spawned_followup'"
        )
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
            "uq_work_artifact_edges_owned_followup "
            "ON agent.work_artifact_edges "
            r"(from_id, to_id, relation, btrim(note, E' \t\n\r\f\v')) "
            "WHERE relation = 'spawned_followup' AND to_id IS NOT NULL"
        )

        # Both guards must be VALID before the old one goes.
        _require_valid(_NON_FOLLOWUP_INDEX, _OWNED_INDEX)

        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "agent.uq_work_artifact_edges_from_to_relation"
        )


def downgrade() -> None:
    """Restore the full pair index - or refuse, naming why it cannot be rebuilt.

    Excluded from coord's classification (it runs only on downgrade). The refusal
    is a single ``DO`` block rather than a Python read through the connection
    so that this function adds nothing of its own to what the classifier reads.
    """
    op.execute(
        """
        DO $$
        DECLARE
            shared bigint;
        BEGIN
            SELECT count(*) INTO shared FROM (
                SELECT 1
                  FROM agent.work_artifact_edges
                 WHERE to_id IS NOT NULL
                 GROUP BY from_id, to_id, relation
                HAVING count(*) > 1
            ) AS groups;
            IF shared > 0 THEN
                RAISE EXCEPTION
                    'cannot restore uq_work_artifact_edges_from_to_relation: % (from_id, to_id, relation) group(s) hold more than one row, which this revision made legal (owned spawned_followup edges sharing a source and an owner). Find them with SELECT from_id, to_id, relation, count(*) FROM agent.work_artifact_edges WHERE to_id IS NOT NULL GROUP BY from_id, to_id, relation HAVING count(*) > 1. This downgrade never deletes or re-points an ownership row; resolve each group deliberately and re-run it.',
                    shared;
            END IF;
        END
        $$
        """
    )
    with op.get_context().autocommit_block():
        # A leftover INVALID rebuild of the old name is skipped by IF NOT EXISTS.
        if _index_valid(_OLD_INDEX) is False:
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "agent.uq_work_artifact_edges_from_to_relation"
            )
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
            "uq_work_artifact_edges_from_to_relation "
            "ON agent.work_artifact_edges (from_id, to_id, relation)"
        )
        _require_valid(_OLD_INDEX)
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "agent.uq_work_artifact_edges_owned_followup"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "agent.uq_work_artifact_edges_from_to_relation_non_followup"
        )
