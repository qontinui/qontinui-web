"""memhold backfill 01 — hold the sync-conflict sidecars out of the lifecycle

Revision ID: memhold_backfill_01
Revises: operators_disabled_01

Why
---
Phase 1b of plan
``D:/qontinui-root/plans/2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord.md``.

The retired 3-account file sync left 67 unadjudicated ``.conflict-*`` sidecars.
Phase 4a of the memory cutover imported BOTH sides of every divergence into
``coord.memory_records``: the losing text as ``source.origin =
'sync-conflict-sidecar'``, the winning topic file as ``source.origin =
'topic-file'``. Nothing recorded that one side lost a divergence, so coord
presents contradictory pairs as equally authoritative — and the automatic
lifecycle has been deciding them on cosine similarity ever since
(``memory_consolidate`` runs ``*/10 * * * *``; 86 of the 138 sidecar rows are
already superseded, and ``decay_prune`` hard-DELETEs a superseded row 90 days
after its supersession instant).

The prior commit on this branch's parent chain shipped the lever:
``source.lifecycle_hold = true`` takes a record out of EVERY automatic sweep —
``find_near_duplicate_pairs``, ``fetch_cluster_candidates``, ``supersede_many``,
``decay_invalidate``, ``decay_prune``, ``expire_closed_session_records`` and the
MEMORY.md bridge — while ``mark_superseded`` deliberately still overrides it,
which is how a human adjudication lands. This revision sets that flag on the
contested set so the adjudication (Phase 3) decides the pairs instead of a
similarity heuristic.

What it flags
-------------

1. **Every loser** — ``source->>'origin' = 'sync-conflict-sidecar'``, live AND
   already-superseded (138 rows measured against prod 2026-07-30). Superseded
   rows are flagged too and that is the point: the hold is what keeps
   ``decay_prune`` from physically deleting the ``superseded_by`` /
   ``consolidated_from`` lineage that records what consolidation decided.
2. **Their topic-file winners** — the ``'topic-file'`` rows for the same
   ``(project, base file)``. 11 rows measured. Only the 9 CONTENT base files
   have winners in coord: the 5 index-file groups (``MEMORY.md`` in four
   project dirs + ``MEMORY-archive.md``, 113 of the 138 sidecar rows) have no
   ``'topic-file'`` row at all, because the Phase-4a import did not import the
   index files as memories. Verified: zero ``'topic-file'`` rows carry
   ``source->>'file' IN ('MEMORY.md', 'MEMORY-archive.md')``.

Matching
--------

The loser's base file is its ``source.file`` with the ``.conflict-<account>-
<stamp>.md`` suffix stripped. Its project comes from ``source.project`` when
present and otherwise from the title, which the import always wrote as
``[sync-conflict sidecar] <project>/<filename>`` — 80 of the 138 rows carry a
NULL ``source.project`` (the first of the two import passes did not set it), so
the title fallback is load-bearing, not defensive. Both together resolve all
138 rows to 14 ``(project, base_file)`` pairs with no NULLs.

On the winner side ``source.project`` is likewise NULL for the first import
pass, so a project match cannot be required: a winner matches when it is in the
SAME TENANT, its ``source.file`` equals a loser's base file, and its project
either agrees or is NULL. That NULL arm cannot over-select an unrelated
project's file here — ``MEMORY.md`` is the only base file that exists in more
than one project, and it has no ``'topic-file'`` row at all.

Deliberately NOT keyed on the title prefix (``[sync-conflict sidecar]%``): the
structured ``source->>'origin'`` field selects the same set and is a strictly
stronger handle. Not keyed on ``kind`` either — the import derived ``kind``
from each file's frontmatter identically for winners and losers, so any
``kind`` predicate selects unrelated records too.

Value shape
-----------

The flag is written as a JSON ``true``, matching what ``_not_lifecycle_held``
reads: ``lower(source->>'lifecycle_hold') IS DISTINCT FROM 'true'``. That
predicate compares TEXT and never casts, so a malformed value would fail OPEN
(record collectable) rather than aborting a sweep — which is why this revision
writes the boolean and not a string.

Idempotent: both UPDATEs skip rows already reading ``'true'``, so a re-run
writes nothing. ``updated_at`` is deliberately left alone — the hold is
lifecycle metadata, not a content edit, and the retention math reads
``created_at`` / ``last_accessed_at``.

Downgrade drops the ``lifecycle_hold`` key from exactly the rows this revision
can have set it to ``true``. That is narrower than "every held record" in two
directions: a hold on a record outside the contested set (a future bulk import
setting its own) is not this revision's to remove, and neither is an explicit
``"lifecycle_hold": false`` — that value is Phase 3's record that a pair was
adjudicated and released, so the downgrade must leave it standing rather than
erase the decision.

⚠️ Clearing the flag is Phase 3's job, per record, as the last step of each
adjudication — an explicit ``"lifecycle_hold": false`` reads as "adjudicated
and released", which a presence-only check could not express. Do not clear
these in bulk.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "memhold_backfill_01"
down_revision: str = "operators_disabled_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# The losing side of every imported divergence. `source.origin` is the
# structured discriminator the Phase-4a import wrote; it selects the losers and
# nothing else.
_SIDECAR_ORIGIN = "sync-conflict-sidecar"
_WINNER_ORIGIN = "topic-file"

# Each loser resolved to (project, base file). `source.project` is NULL for the
# first import pass, so the title carries the fallback; the base file is the
# `.conflict-<account>-<stamp>.md` suffix stripped off `source.file`.
_SIDECAR_KEY_CTE = f"""
    SELECT
        tenant_id,
        COALESCE(
            source->>'project',
            NULLIF(
                split_part(
                    replace(title, '[sync-conflict sidecar] ', ''), '/', 1
                ),
                ''
            )
        ) AS project,
        regexp_replace(source->>'file', '\\.conflict-.*$', '') AS base_file
      FROM coord.memory_records
     WHERE source->>'origin' = '{_SIDECAR_ORIGIN}'
"""

# The winner predicate, shared by upgrade and downgrade so the two can never
# address different row sets. `w` is the row being matched; `sidecar` is the CTE
# above, which every statement using this fragment must declare.
#
# The tenant equality is load-bearing even though only one tenant holds the
# imported corpus today: `source.file` is a bare filename, so without it a
# sidecar in one tenant would hold a same-named record in another. Memory is
# tenant-isolated everywhere else in this schema and a data migration is the
# last place that should be the exception.
_WINNER_MATCH = f"""
    w.source->>'origin' = '{_WINNER_ORIGIN}'
    AND EXISTS (
        SELECT 1
          FROM sidecar s
         WHERE s.tenant_id = w.tenant_id
           AND s.base_file = w.source->>'file'
           AND (
                w.source->>'project' IS NULL
                OR w.source->>'project' = s.project
           )
    )
"""


def upgrade() -> None:
    """Set ``source.lifecycle_hold = true`` on the losers and their winners."""
    # 1. Every loser, live or already superseded.
    op.execute(
        f"""
        UPDATE coord.memory_records
           SET source = jsonb_set(
                   source, '{{lifecycle_hold}}', 'true'::jsonb, true
               )
         WHERE source->>'origin' = '{_SIDECAR_ORIGIN}'
           AND lower(source->>'lifecycle_hold') IS DISTINCT FROM 'true'
        """
    )

    # 2. The topic-file winner of each divergence.
    op.execute(
        f"""
        WITH sidecar AS ({_SIDECAR_KEY_CTE})
        UPDATE coord.memory_records w
           SET source = jsonb_set(
                   w.source, '{{lifecycle_hold}}', 'true'::jsonb, true
               )
         WHERE {_WINNER_MATCH}
           AND lower(w.source->>'lifecycle_hold') IS DISTINCT FROM 'true'
        """
    )


def downgrade() -> None:
    """Drop the ``lifecycle_hold`` key from the rows upgrade() set it true on.

    Keyed on the VALUE being ``true``, not on the key's presence, so an explicit
    ``false`` written by a Phase-3 adjudication survives a rollback.
    """
    op.execute(
        f"""
        UPDATE coord.memory_records
           SET source = source - 'lifecycle_hold'
         WHERE source->>'origin' = '{_SIDECAR_ORIGIN}'
           AND lower(source->>'lifecycle_hold') = 'true'
        """
    )
    op.execute(
        f"""
        WITH sidecar AS ({_SIDECAR_KEY_CTE})
        UPDATE coord.memory_records w
           SET source = w.source - 'lifecycle_hold'
         WHERE {_WINNER_MATCH}
           AND lower(w.source->>'lifecycle_hold') = 'true'
        """
    )
