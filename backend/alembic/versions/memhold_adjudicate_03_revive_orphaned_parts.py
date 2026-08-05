"""Revive the multi-part documents `memhold_adjudicate_01` orphaned, and hold them.

`memhold_adjudicate_01` never treated a winner's liveness as a PREDICATE. In its
`_WINNER_LINK_CTE` the term ``w.superseded_by IS NULL`` appears only in an
``ORDER BY`` — as a sort key — and never in a ``WHERE``, and nothing checked the
reverse edge before writing ``superseded_by``. A ranking PREFERS a live winner
but with a single candidate returns that candidate whatever its state, so the
revision could, and did, point rows at targets that were themselves dead.

That produced two distinguishable kinds of damage:

* a supersede **2-cycle** (A→B while B→A), which failed
  `memhold_adjudicate_02`'s ``not_live`` invariant, held ``applied_head`` behind
  ``chain_head``, and — via coord's ``touches_migration`` deferral of everything
  matching ``alembic/versions/`` — deferred EVERY migration PR fleet-wide for
  >5h on 2026-08-04. Repaired; **0 cycles fleet-wide, measured 2026-08-05.**
* a supersede **chain into a dead row**, which is silent. Nothing asserts it,
  and the retrieval predicate (``memory_store._retrieval_where``, which filters
  ``is_tombstone`` / ``valid_from`` / ``valid_until`` / ``scope``) does not read
  ``superseded_by`` at all — so these rows go dark because of ``valid_until``
  and the supersede damage never surfaces. This is the kind still outstanding,
  and it is what this revision repairs.

## What this revision revives

Rows in one specific shape: **a non-live part-N of a multi-part document whose
other parts are LIVE, superseded onto a DIFFERENT document.** Measured
read-only against prod on 2026-08-05 — four rows, all in tenant
``c231d9da-0ca8-4fe4-bd81-0e3d6c20339a``:

    memory_id     document                                  superseded onto
    c997972f…     [MSI] _index-archive-2026-07-04 (1/3)     _index-archive-2026-07-06 (1/3)
    8e0efa14…     [MSI] _index-archive-2026-07-14 (1/3)     _index-archive-2026-07-19 (1/3)
    81707c99…     [MSI] _index-archive-2026-07-19 (1/3)     _index-archive-2026-07-10 (1/3)
    4a14e94e…     [qontinui-coord] pr-1060-specimen… (1/2)  its own dead .conflict-… sidecar

``4a14e94e…`` is the casualty this plan was written for. Its chain is
``4a14e94e`` → ``fc1ae5ea`` (a sync-conflict sidecar, NOT live) → ``03281759``
(part 2/2, LIVE) — i.e. part 1 was superseded, transitively, onto its own part
2, and only part 1 went dark. ``decay_prune`` physically DELETEs (it does not
tombstone) once ``valid_until`` passes ``DECAY_PRUNE_GRACE_DAYS`` (90), which
dates its loss at **2026-10-26 16:20 UTC**. Nothing is past the grace window
yet (measured: 0), so this revision is ahead of the clock, not behind it.

⚠️ **`memhold_adjudicate_01` did NOT write these edges, and this revision does
not claim it did.** `_01` selects `source->>'origin' = 'sync-conflict-sidecar'`
(`_SIDECAR_ROW_CTE`) and writes ``superseded_by`` on the SIDECAR, pointing it
at a topic-file winner. All four rows above are ``origin='topic-file'``, and
their ``valid_until`` stamps (2026-07-28 16:20; 2026-08-01 15:30 and 15:40) do
not match `_01`'s single apply instant (2026-08-01 15:00:59). The likeliest
writer is the automatic consolidation path, whose folding is not in itself
wrong.

That matters because it narrows the claim this revision makes. The defect is a
property of the RESULT, not of a writer: a document left HALF folded, part N
dark while its siblings stay live. That is incoherent whoever produced it —
and asymmetric in consequence, because the dark part is on ``decay_prune``'s
DELETE clock and the live parts are not. Reviving restores the document to a
consistent state; it does not overturn an adjudication, and it is reversible
via ``downgrade()``. The plan's own root-cause narrative (liveness as a sort
key) is still correct about the CLASS of bug and about the fleet wedge; it is
the attribution of these four specific edges that does not hold up, and the
fix for the productive defect lives in ``memory_store``, not here.

## What it deliberately does NOT revive, and why the predicate is narrow

The LOOSE shape — "non-live part of a live multi-part document" — matched
**eight** rows when this revision was written, and four of them must not be
touched. Re-measured after the rebase (see "Chain" below) it matches **five**,
and the difference is fully accounted for:

* **Three** (``c2beda78``, ``bca4dffa``, ``d88f28f7``) were superseded onto a
  live ``mental_model`` carrying ``source.synthesis_job``. Those belong to
  `memrestore_01_synthesis_superseded_documents`, which restores all 597 of
  them. `memrestore_01` **has since applied** — prod's stamped head is
  ``coord_primary_trees_selfheal_backfill``, two revisions past it — so those
  three are live again and no longer match the loose shape at all. That is why
  the loose count fell 8 → 5, and it is the *expected* consequence of the
  parent landing, not drift.

  The ``NOT jsonb_exists(superseder.source,'synthesis_job')`` term is kept
  regardless. It is what held the two revisions apart before `memrestore_01`
  applied, and it still guards every environment whose corpus has not had that
  restore pass run against it (a fresh test database, a replayed chain, a
  future synthesis fold that re-creates the shape). Dropping it because prod
  happens to be past that point would make the predicate depend on apply
  ORDER — exactly the coupling the term exists to remove.
* **One** (``f689235f``, ``MEMORY.pre-compaction-2026-07-08 (part 1/5)``) was
  superseded onto ``18ec67bb`` — the SAME title and the SAME
  ``source.file``, from a later re-import of the same document (project
  ``null`` on 2026-07-27, ``D--qontinui-root`` on 2026-07-28). That is
  ORDINARY DEDUP and it is correct. Reviving it would resurrect a duplicate.

Hence the discriminating term: the superseder's part-stripped title must be
DISTINCT FROM the orphan's. Cross-document supersession is the defect
signature; same-document supersession is the import working as intended. A
sweep of the shape ALONE would have quietly resurrected a duplicate — which is
why the shape is not the predicate. ``f689235f`` STILL matches the loose shape
in the re-measurement above and is STILL excluded, so this term is doing live
work, not historical work.

## Chain

Authored against `memrestore_01_synthesis_superseded_documents`, then re-pointed
on 2026-08-05 when two siblings landed underneath it: `memrestore_01` gained a
child (``coord_tenant_repo_unenroll_01``), so chaining here would have forked
the graph and `alembic-heads-pr` failed the PR on a 2-head chain. The parent is
now ``coord_primary_trees_selfheal_backfill``, the single head of `origin/main`
and — verified read-only against prod — the head prod has actually STAMPED.
`memrestore_01` remains an ANCESTOR three revisions back (two intervening:
``coord_tenant_repo_unenroll_01``, then ``coord_primary_trees_selfheal_backfill``),
so everything this docstring says about the two revisions dividing the work
still holds; only the edge moved.

## Why the hold is set HERE and not by hand

``source.lifecycle_hold`` is migration-managed. `memhold_adjudicate_02` carries
an ``_UNCOVERED_HELD_SQL`` invariant that ABORTS on held rows it does not
account for, and an abort is exactly the fleet-wide deferral described above.
So a hold set out of band risks wedging a future memhold revision. **The hold
must be set BY the revision that also accounts for it** — that is the whole
reason this is a migration rather than a DML fix.

Baseline before `memrestore_01` applied: **0** rows carried
``lifecycle_hold='true'`` fleet-wide (149 read ``'false'``, 5488 had no key),
and `memrestore_01` was noted as creating 597 the moment it applied. It has
since applied, and the re-measurement is exactly that prediction landing:
**597** now read ``'true'`` (all 597 stamped ``source.restore_2026_08_04``,
`memrestore_01`'s provenance key), 149 read ``'false'``, 4920 have no key.
(The no-key column falls 5488 → 4920 rather than to 4891 because the corpus
also GREW by ~29 rows between the two reads — it is a live corpus, not a
frozen one. The two totals are not meant to balance.)

This revision's holds are additive to either state, because ``_COVERED_HELD``
is keyed on ``source.memhold_adjudicate_03`` and not on ``lifecycle_hold``
alone — it subtracts this revision's OWN rows and is blind to
`memrestore_01`'s 597. Verified: **0** rows currently carry
``source.memhold_adjudicate_03``, so the coverage query reports 0 before the
apply and one row per REVIVED target after. On the corpus as measured that is
4, since ``_COLLIDES`` currently finds no collision for any target; a target
skipped on a live-dedup collision takes the ``continue`` before ``_REVIVE`` and
so is never stamped, which would make it fewer.

The hold is a STOPGAP with a named exit, the same one `memrestore_01` names:
these rows re-enter `fetch_cluster_candidates`' selector once live, and
consolidation runs every 10 minutes. The hold keeps them out until the durable
fix (the supersede guard in ``memory_store._supersede_target_is_safe``, shipped
alongside this revision) has demonstrably held.

## Skip, do not abort

Every failure mode here reports and continues. A migration that raises fails
coord's pre-deploy migration drift gate, which blocks EVERY coord deploy
fleet-wide — qontinui-web#904 blocked it ~25h, and the 2026-08-04 incident
blocked it >5h. `memrestore_01` settled this policy earlier in the chain and
this revision follows it: a skipped row is visible in the logs and recoverable
on the next pass; a blocked fleet is neither.

The one thing that DOES abort is genuine corruption — a supersede 2-cycle —
because that is unrepairable by a later pass and is precisely what a subsequent
memhold revision's invariant will trip over.

Revision ID: memhold_adjudicate_03
Revises: coord_primary_trees_selfheal_backfill
Create Date: 2026-08-05
"""

from __future__ import annotations

import logging

import sqlalchemy as sa

from alembic import op

logger = logging.getLogger("alembic.runtime.migration")

revision: str = "memhold_adjudicate_03"
down_revision: str = "coord_primary_trees_selfheal_backfill"
branch_labels = None
depends_on = None


# The provenance key this revision stamps. Mirrors `memrestore_01`'s
# `restore_2026_08_04` and `memhold_adjudicate_01`'s `prior_*` idiom, so the
# memory revisions share ONE provenance shape rather than one per author.
# `downgrade()` reads it back, and it is what makes this revision's holds
# nameable by a successor's uncovered-held check.
_PROVENANCE_KEY = "memhold_adjudicate_03"

# The part suffix a chunked import writes: "<doc> (part i/n)".
_PART_SUFFIX = r"\s*\(part\s+\d+\s*/\s*\d+\)\s*$"

# Liveness, verbatim from `uq_memory_records_tenant_content_hash_live`'s partial
# predicate (and `memory_store._LIVE_DEDUP_PREDICATE`). A migration cannot
# import runtime code, so this is a textual copy — token-for-token identical.
_LIVE = "is_tombstone = false AND superseded_by IS NULL AND valid_until IS NULL"


def _live(alias: str) -> str:
    return " AND ".join(f"{alias}.{atom.strip()}" for atom in _LIVE.split(" AND "))


# The rows this revision owns. See the module docstring for why each term is
# present; every one of them EXCLUDES a row that would otherwise be revived
# wrongly, so none is an optimisation.
_TARGETS = f"""
    WITH parts AS (
        SELECT memory_id, tenant_id, title, source, content_hash,
               regexp_replace(title, '{_PART_SUFFIX}', '') AS doc,
               superseded_by, valid_until, is_tombstone,
               ({_LIVE}) AS is_live
          FROM coord.memory_records
         WHERE title ~ '\\(part\\s+\\d+\\s*/\\s*\\d+\\)'
    )
    SELECT p.memory_id, p.tenant_id, p.doc, p.content_hash,
           p.superseded_by, p.valid_until, s.title AS superseder_title
      FROM parts p
      JOIN coord.memory_records s ON s.memory_id = p.superseded_by
     WHERE NOT p.is_live
       AND p.is_tombstone = false
       -- at least one OTHER part of the same document is live: that is what
       -- makes this an orphaned HALF rather than a wholly retired document.
       AND EXISTS (
            SELECT 1 FROM parts sib
             WHERE sib.tenant_id = p.tenant_id AND sib.doc = p.doc
               AND sib.is_live AND sib.memory_id <> p.memory_id
       )
       -- cross-document supersession is the defect signature; same-document is
       -- ordinary re-import dedup and must be left alone.
       AND regexp_replace(s.title, '{_PART_SUFFIX}', '') IS DISTINCT FROM p.doc
       -- the synthesis-superseded set belongs to memrestore_01 (an ancestor,
       -- three revisions back), which restores all 597 of them.
       AND NOT jsonb_exists(s.source, 'synthesis_job')
     ORDER BY p.doc
"""

# Would reviving this row collide with a row that is ALREADY live? Mirrors the
# partial unique index's own predicate, so what it finds is what the index would
# reject. Measured 0 for all four targets before `memrestore_01` applied.
#
# RE-MEASURED read-only against prod after it applied, because this is the query
# the restore pass could most plausibly have disturbed: `_COLLIDES` searches for
# a LIVE row sharing (tenant_id, content_hash), and `memrestore_01` turned 597
# rows live, enlarging exactly that search space. Still **0** hits for all four
# targets, and none of those 597 shares a (tenant_id, content_hash) with any
# target — so the restore pass did not enlarge the collision surface for THIS
# revision at all. Re-checked at apply time regardless, because the corpus moves.
_COLLIDES = f"""
    SELECT memory_id, title FROM coord.memory_records o
     WHERE o.tenant_id = :tenant_id
       AND o.content_hash = :content_hash
       AND o.memory_id <> :memory_id
       AND {_live("o")}
     LIMIT 1
"""

# Genuine corruption: A→B while B→A. Unrepairable by a later pass, and exactly
# what a successor memhold revision's invariant trips over. This is the ONE
# condition that aborts.
_CYCLES = """
    SELECT a.memory_id AS a_id, b.memory_id AS b_id,
           a.title AS a_title, b.title AS b_title
      FROM coord.memory_records a
      JOIN coord.memory_records b ON b.memory_id = a.superseded_by
     WHERE b.superseded_by = a.memory_id
"""

# Every row this revision holds, by its own stamp. A successor's uncovered-held
# check can subtract exactly this set — which is what "the hold must be set BY
# the revision that also accounts for it" means in practice.
_COVERED_HELD = f"""
    SELECT memory_id, title
      FROM coord.memory_records
     WHERE jsonb_exists(source, '{_PROVENANCE_KEY}')
       AND lower(source->>'lifecycle_hold') = 'true'
"""

_REVIVE = f"""
    UPDATE coord.memory_records
       SET valid_until   = NULL,
           superseded_by = NULL,
           updated_at    = now(),
           source = jsonb_set(
               jsonb_set(source, '{{lifecycle_hold}}', 'true'::jsonb, true),
               '{{{_PROVENANCE_KEY}}}',
               jsonb_build_object(
                   'reason', CAST(:reason AS text),
                   'prior_valid_until', to_jsonb(CAST(:prior_valid_until AS text)),
                   'prior_superseded_by', to_jsonb(CAST(:prior_superseded_by AS text)),
                   'prior_lifecycle_hold', COALESCE(source->'lifecycle_hold', 'null'::jsonb),
                   'held_pending', 'the supersede guard in memory_store proving out'
               ),
               true)
     WHERE memory_id = :memory_id
"""

# ⚠️ States what is OBSERVED, not who did it.
#
# An earlier draft of this revision blamed `memhold_adjudicate_01`. That is
# FALSE and the provenance would have been a lie in the corpus. `_01`'s
# `_SIDECAR_ROW_CTE` selects `source->>'origin' = 'sync-conflict-sidecar'` and
# its UPDATE writes `superseded_by` on the SIDECAR, pointing it at a
# topic-file winner. Every row below is `origin='topic-file'` and points AT a
# non-sidecar-winner direction, so `_01` cannot have written any of these
# edges — and their `valid_until` stamps (2026-07-28 16:20, 2026-08-01 15:30,
# 15:40) do not match `_01`'s single apply instant (2026-08-01 15:00:59)
# either.
#
# What actually wrote them is NOT established. The likeliest writer is the
# automatic consolidation path (`apply_merge` / `supersede_many`), whose whole
# job is to fold near-duplicates — and folding is not in itself wrong. The
# defect this revision repairs is narrower and is a property of the RESULT,
# not of any writer: a document was left HALF folded, with part N dark while
# its siblings stayed live. A partially-folded document is incoherent whoever
# produced it, and the dark part is on `decay_prune`'s DELETE clock while the
# live parts are not.
_REASON = (
    "part-N of a multi-part document was superseded onto a DIFFERENT document "
    "while sibling parts stayed live, leaving the document half-dark and the "
    "dark part on decay_prune's DELETE clock; writer not established"
)

# The rows verified in prod on 2026-08-05, read-only, by this module's own
# `_TARGETS`. Pinned so the apply is checked against a MEASURED set rather than
# trusting a shape query re-evaluated weeks later against a corpus that has
# moved. A mismatch does not abort — that would hand a fleet-wide deploy block
# to ordinary corpus drift — but it is reported at ERROR so the difference is
# adjudicated deliberately instead of silently revived.
#
# RE-VERIFIED read-only against prod on 2026-08-05 after the rebase onto
# `coord_primary_trees_selfheal_backfill`, precisely because `memrestore_01` had
# applied in between and could have altered rows this revision targets. It did
# not: `_TARGETS` returns these same FOUR ids, no extras and none missing, and
# all four remain non-live with their recorded `superseded_by` intact. The
# supersede-cycle count — the one condition that aborts — is 0.
_VERIFIED_TARGETS = {
    "c997972f-5fcc-4006-82b0-8dff65ff51a4": "[MSI] _index-archive-2026-07-04",
    "8e0efa14-69dd-47d0-982d-f9fbcf281dc7": "[MSI] _index-archive-2026-07-14",
    "81707c99-9680-435b-99dc-039a052bf22f": "[MSI] _index-archive-2026-07-19",
    "4a14e94e-77cc-4028-b392-259b436a3719": (
        "[qontinui-coord] pr-1060-specimen-never-lands"
    ),
}


# ---------------------------------------------------------------------------
# The winner-liveness classifier (Change 3), for SUCCESSOR revisions.
#
# `memhold_adjudicate_02` aborts on ANY non-live resolved winner. That blanket
# rule is what took the fleet down on 2026-08-04: of the two rows that tripped
# it, only ONE was corrupt. `6cf34411…` was superseded onto a LIVE consolidation
# synthesis — correct, organic, recurring behaviour — and it still aborted the
# migration and deferred every migration PR in the fleet.
#
# A legitimately superseded winner must NOT be able to do that again. So the
# distinction the old invariant could not draw is drawn here:
#
#   live                  → proceed
#   superseded onto LIVE  → SKIP the record and REPORT it (organic)
#   superseded onto NON-LIVE, tombstoned, validity-ended, or in a cycle
#                         → ABORT (genuine corruption)
#
# ⚠️ This is deliberately NOT an edit to `memhold_adjudicate_02`. That revision
# is APPLIED, and an applied revision never runs again — narrowing an invariant
# inside one is dead code the moment the data fix makes it apply. "Fix the data
# now, harden _02 later" is not a sequence; the later half evaporates. So the
# narrowed rule lives HERE, and a successor imports it the same way `_02`
# imports `_01` (`_load_adjudicate_01`).
# ---------------------------------------------------------------------------

WINNER_LIVE = "live"
WINNER_SUPERSEDED_ONTO_LIVE = "superseded_onto_live"
WINNER_CORRUPT = "corrupt"

_CLASSIFY_SQL = f"""
    SELECT w.memory_id,
           ({_live("w")}) AS is_live,
           w.is_tombstone,
           w.valid_until,
           w.superseded_by,
           t.memory_id AS target_id,
           t.title AS target_title,
           CASE WHEN t.memory_id IS NULL THEN NULL
                ELSE ({_live("t")}) END AS target_is_live,
           (t.superseded_by = w.memory_id) AS target_points_back
      FROM coord.memory_records w
      LEFT JOIN coord.memory_records t ON t.memory_id = w.superseded_by
     WHERE w.memory_id = :memory_id
"""


def classify_winner_liveness(conn: object, memory_id: object) -> tuple[str, str]:
    """Classify a resolved winner row. Returns ``(verdict, human reason)``.

    ``verdict`` is one of :data:`WINNER_LIVE`,
    :data:`WINNER_SUPERSEDED_ONTO_LIVE` (skip and report — organic), or
    :data:`WINNER_CORRUPT` (abort).

    A missing row classifies CORRUPT: a winner that resolved to an id which is
    not in the table is not an organic lifecycle outcome.
    """
    row = (
        conn.execute(  # type: ignore[attr-defined]
            sa.text(_CLASSIFY_SQL), {"memory_id": memory_id}
        )
        .mappings()
        .first()
    )

    if row is None:
        return WINNER_CORRUPT, f"winner {memory_id} does not exist"
    if row["is_live"]:
        return WINNER_LIVE, "winner is live"
    if row["is_tombstone"]:
        return WINNER_CORRUPT, f"winner {memory_id} is tombstoned"
    if row["superseded_by"] is None:
        # Not live, not tombstoned, not superseded → validity ended by decay or
        # an explicit temporal bound. Nothing points anywhere; there is no
        # lineage to follow, so the adjudicated text would land nowhere.
        return WINNER_CORRUPT, (
            f"winner {memory_id} has its validity ended (valid_until="
            f"{row['valid_until']}) without a supersession — no lineage to follow"
        )
    if row["target_points_back"]:
        return WINNER_CORRUPT, (
            f"winner {memory_id} and its target {row['target_id']} point at each "
            "other — a supersede 2-cycle"
        )
    if row["target_is_live"]:
        return WINNER_SUPERSEDED_ONTO_LIVE, (
            f"winner {memory_id} was superseded onto LIVE row {row['target_id']} "
            f"({row['target_title']!r}) — an organic lifecycle outcome, not "
            "corruption"
        )
    return WINNER_CORRUPT, (
        f"winner {memory_id} was superseded onto {row['target_id']} "
        f"({row['target_title']!r}), which is ITSELF not live — the lineage "
        "dead-ends and the document is unreachable"
    )


def upgrade() -> None:
    conn = op.get_bind()

    # ---------------------------------------------------------------
    # 0. Genuine corruption aborts BEFORE anything is written. A cycle
    #    cannot be repaired by a later pass, and reviving rows around
    #    one would leave a corpus a successor revision cannot apply to.
    # ---------------------------------------------------------------
    cycles = conn.execute(sa.text(_CYCLES)).mappings().all()
    if cycles:
        for c in cycles:
            logger.error(
                "memhold_adjudicate_03: SUPERSEDE CYCLE — %s (%r) and %s (%r) "
                "point at each other.",
                c["a_id"],
                c["a_title"],
                c["b_id"],
                c["b_title"],
            )
        raise RuntimeError(
            "memhold_adjudicate_03 INVARIANT VIOLATED: "
            f"{len(cycles)} supersede 2-cycle(s) exist (see the ERROR lines "
            "above). This is the corruption memhold_adjudicate_01 minted and "
            "the 2026-08-04 repair cleared; its return means a writer is still "
            "creating back-edges. Reviving rows around a cycle would leave a "
            "corpus the next memhold revision cannot apply to. Break the cycle, "
            "then re-run."
        )

    targets = conn.execute(sa.text(_TARGETS)).mappings().all()
    logger.info(
        "memhold_adjudicate_03: %d orphaned multi-part document row(s) in scope",
        len(targets),
    )

    # ------------------------------------------------------------------
    # Reconcile the shape query against the set MEASURED in prod. Reported,
    # never raised: this revision revives rows and sets holds, and handing a
    # fleet-wide deploy block to ordinary corpus drift is the failure mode the
    # whole plan exists to stop. But an unreviewed row must not be revived
    # silently either — a revive is a lifecycle decision, and the difference
    # between "the sweep found what we verified" and "the sweep found
    # something else" is exactly what a human needs to see.
    # ------------------------------------------------------------------
    found = {str(r["memory_id"]) for r in targets}
    expected = set(_VERIFIED_TARGETS)
    for extra in sorted(found - expected):
        logger.error(
            "memhold_adjudicate_03: UNVERIFIED target %s — it matches the "
            "orphaned-part shape but was NOT in the set measured read-only "
            "against prod on 2026-08-05. It is being revived and held, which "
            "is reversible via downgrade(), but adjudicate it: the shape also "
            "matches ordinary re-import dedup and synthesis supersession, and "
            "only the cross-document terms above separate them.",
            extra,
        )
    for missing in sorted(expected - found):
        logger.warning(
            "memhold_adjudicate_03: verified target %s (%s) NO LONGER matches "
            "the shape — already repaired, re-superseded, or deleted. Nothing "
            "to do for it.",
            missing,
            _VERIFIED_TARGETS[missing],
        )

    revived = 0
    skipped = 0
    for row in targets:
        collides = (
            conn.execute(
                sa.text(_COLLIDES),
                {
                    "tenant_id": row["tenant_id"],
                    "content_hash": row["content_hash"],
                    "memory_id": row["memory_id"],
                },
            )
            .mappings()
            .first()
        )
        if collides:
            skipped += 1
            logger.error(
                "memhold_adjudicate_03: SKIPPING memory_id=%s (%r) — live row "
                "%s (%r) in tenant %s already holds content_hash %s, so "
                "reviving this one would violate "
                "uq_memory_records_tenant_content_hash_live. The part stays "
                "dark and stays on decay_prune's DELETE clock; merge the two "
                "by hand. Skipped rather than aborted so a single collision "
                "cannot block every coord deploy fleet-wide.",
                row["memory_id"],
                row["doc"],
                collides["memory_id"],
                collides["title"],
                row["tenant_id"],
                row["content_hash"],
            )
            continue

        conn.execute(
            sa.text(_REVIVE),
            {
                "memory_id": row["memory_id"],
                "reason": _REASON,
                "prior_valid_until": row["valid_until"],
                "prior_superseded_by": row["superseded_by"],
            },
        )
        revived += 1
        logger.info(
            "memhold_adjudicate_03: revived %s (%r) — was superseded onto %r; "
            "now live and held.",
            row["memory_id"],
            row["doc"],
            row["superseder_title"],
        )

    held = conn.execute(sa.text(_COVERED_HELD)).mappings().all()
    logger.info(
        "memhold_adjudicate_03: revived %d, skipped %d on live-dedup collision. "
        "%d row(s) now carry source.%s with lifecycle_hold=true — this revision "
        "ACCOUNTS for exactly those, so a successor's uncovered-held check can "
        "subtract them by that key.",
        revived,
        skipped,
        len(held),
        _PROVENANCE_KEY,
    )

    if revived + skipped != len(targets):
        raise RuntimeError(
            "memhold_adjudicate_03 INVARIANT VIOLATED: outcomes do not "
            f"partition the target set — revived {revived} + skipped {skipped} "
            f"against {len(targets)} target(s). Every target must end in "
            "exactly one outcome."
        )


def downgrade() -> None:
    """Re-hide exactly the rows this revision revived, from their own provenance.

    Only rows carrying ``source.memhold_adjudicate_03`` are touched, and each
    is put back to the ``valid_until`` / ``superseded_by`` it actually had —
    never a blanket re-invalidation, which would catch rows that were live all
    along.

    The hold is restored to its RECORDED prior value rather than dropped.
    ``4a14e94e…`` carried an explicit ``lifecycle_hold: false`` before this
    revision (Phase 3's record that a pair was adjudicated); the other three
    carried no key at all. Dropping the key unconditionally — as
    `memrestore_01`'s downgrade does, correctly, for rows it knows had none —
    would erase that distinction here, so this one restores what it stashed.
    """
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            f"""
            UPDATE coord.memory_records
               SET valid_until = NULLIF(
                       source->'{_PROVENANCE_KEY}'->>'prior_valid_until', 'None'
                   )::timestamptz,
                   superseded_by = NULLIF(
                       source->'{_PROVENANCE_KEY}'->>'prior_superseded_by', 'None'
                   )::uuid,
                   updated_at = now(),
                   source = CASE
                       WHEN COALESCE(
                                source->'{_PROVENANCE_KEY}'->'prior_lifecycle_hold',
                                'null'::jsonb
                            ) = 'null'::jsonb
                       THEN (source - '{_PROVENANCE_KEY}') - 'lifecycle_hold'
                       ELSE jsonb_set(
                                source - '{_PROVENANCE_KEY}',
                                '{{lifecycle_hold}}',
                                source->'{_PROVENANCE_KEY}'->'prior_lifecycle_hold',
                                true)
                   END
             WHERE jsonb_exists(source, '{_PROVENANCE_KEY}')
            """
        )
    )
    logger.info(
        "memhold_adjudicate_03: downgrade re-hid %d row(s) from their stashed "
        "prior state.",
        result.rowcount or 0,
    )
