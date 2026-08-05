"""Restore topic-file documents that a synthesis job superseded onto a summary.

On 2026-07-28 the weekly consolidation sweep clustered imported topic-file
DOCUMENTS as if they were episodes, wrote ``mental_model`` syntheses, and
superseded each source onto its summary. `apply_synthesis_result`
(``memory_store.py``) does that by design — "insert the mental_model row
(``consolidated_from`` = targets), **supersede the member rows**" — and
`fetch_cluster_candidates` selects ``kind IN ('episode','observation')``, so the
2026-07-28 file-corpus import, which filed whole documents as
``kind='observation'``, made them eligible.

The result, measured live before authoring this revision:

    SELECT count(*) FROM coord.memory_records
     WHERE valid_until IS NOT NULL AND is_tombstone = false
       AND (source->>'origin') = 'topic-file';
    -- 643

Broken down by mechanism, 597 were superseded onto a row carrying
``source.synthesis_job`` and **zero** were clock-decayed. Supersession, not
decay, is what consumed the corpus — worth stating plainly, because the
obvious reading of "records went invisible" is a decay-curve problem and
tuning the decay curve would leave this path completely untouched.

An 11,235-byte document was replaced in retrieval by a 1,203-byte paraphrase,
1.5 ms after the paraphrase was written. Being outside
``_LIVE_DEDUP_PREDICATE`` puts these rows outside every retrieval selector,
so they are on disk and unreachable.

They are also on a deletion clock. ``decay_prune`` physically DELETEs any row
whose ``valid_until`` is older than ``DECAY_PRUNE_GRACE_DAYS`` (90) AND which
carries a terminal marker — and ``superseded_by IS NOT NULL`` is one of the
three markers it reads. Nothing is past the grace window yet (measured: 0),
which dates the loss at roughly 2026-10-26.

## What this revision restores, and what it deliberately does not

ONLY rows whose superseder carries ``source.synthesis_job``. That is a
provable mechanism: a summary displaced its own source.

The other 46 invalidated topic-file rows are left alone, because inspection
showed they are legitimate:

    superseder origin  | kind        | adjudicated | count
    topic-file         | reference   | no          | 15
    topic-file         | observation | no          | 17
    topic-file         | feedback    | no          |  5
    topic-file         | reference   | no          |  1
    (none)             | reference   | no          |  6
    sync-conflict-...  | observation | YES         |  1
    topic-file         | reference   | YES         |  1

Topic-file superseding topic-file is ordinary dedup — the import ran more than
once. The two ``adjudicated`` rows are the operator's own decisions, landed by
`memhold_adjudicate_01`. Restoring either class would resurrect duplicates or
overturn an adjudication, so the predicate below names the synthesis mechanism
explicitly rather than selecting on ``origin='topic-file'`` alone.

The ``mental_model`` syntheses are NOT deleted. They are legitimate derived
records and keep their ``consolidated_from`` links; they simply stop standing
in for their sources.

## Why the restored rows are also HELD

Restoring alone would put 597 rows back into `fetch_cluster_candidates`'
selector, and consolidation runs Sundays 04:20 UTC. The next run would consume
them again.

So each restored row also gets ``source.lifecycle_hold = true``, which
`_not_lifecycle_held` honours across EVERY automatic sweep —
`find_near_duplicate_pairs`, `fetch_cluster_candidates`, `supersede_many`,
`decay_invalidate`, `decay_prune`, session expiry, and the MEMORY.md bridge.
`supersede_many` re-checks the hold at apply time, which also covers a job
already enqueued naming a restored row as a member.

The hold is a STOPGAP with a named exit: these documents are misclassified as
``kind='observation'``, and reclassifying them out of the
``('episode','observation')`` selector is the durable fix. The hold protects
them until that lands. It is deliberately the same flag the `memhold_*`
revisions used for human adjudication, because this is the same situation —
a record parked out of the automatic path pending a decision.

A real JSON boolean is written, matching `set_lifecycle_hold`'s output.
`_not_lifecycle_held` compares on TEXT and case-folds precisely because holds
applied by raw SQL historically were not well-formed; this revision does not
rely on that tolerance.

## Collision safety

`memory_records` carries a partial unique index on ``(tenant_id,
content_hash)`` WHERE the row is live. Clearing ``valid_until`` +
``superseded_by`` makes a row live, so a restore CAN violate it if some other
live row already holds that hash.

Measured before authoring: **0** of the 597 collide. This revision still
re-checks at apply time and SKIPS any that would collide, reporting each at
ERROR, rather than aborting.

Aborting was the tempting choice and is the wrong one here. A migration that
raises fails coord's pre-deploy migration drift gate, which blocks EVERY coord
deploy fleet-wide — that is qontinui-web#904, which blocked the fleet for
roughly 25 hours and was still blocking when this corpus damage was found. A
skipped row is visible in the logs and recoverable on the next pass; a blocked
fleet is neither.

Revision ID: memrestore_01_synthesis_superseded_documents
Revises: coord_memory_obs_access_distribution
Create Date: 2026-08-04
"""

from __future__ import annotations

import logging

import sqlalchemy as sa
from alembic import op

logger = logging.getLogger("alembic.runtime.migration")

revision: str = "memrestore_01_synthesis_superseded_documents"
down_revision: str = "coord_memory_obs_access_distribution"
branch_labels = None
depends_on = None


# Rows this revision owns: an invisible topic-file document whose superseder is
# a synthesis output. Everything else invalidated is out of scope by design.
_TARGETS = """
    SELECT m.memory_id, m.tenant_id, m.content_hash,
           m.valid_until, m.superseded_by
      FROM coord.memory_records m
      JOIN coord.memory_records s ON s.memory_id = m.superseded_by
     WHERE m.valid_until IS NOT NULL
       AND m.is_tombstone = false
       AND (m.source->>'origin') = 'topic-file'
       AND jsonb_exists(s.source, 'synthesis_job')
"""

# Would restoring this row collide with a row that is ALREADY live? Mirrors the
# partial unique index's own predicate, so what it finds is what the index
# would reject.
_COLLIDES = """
    SELECT 1 FROM coord.memory_records o
     WHERE o.tenant_id = :tenant_id
       AND o.content_hash = :content_hash
       AND o.memory_id <> :memory_id
       AND o.is_tombstone = false
       AND o.superseded_by IS NULL
       AND o.valid_until IS NULL
     LIMIT 1
"""


def upgrade() -> None:
    conn = op.get_bind()
    targets = conn.execute(sa.text(_TARGETS)).mappings().all()
    logger.info(
        "memrestore_01: %d synthesis-superseded topic-file document(s) in scope",
        len(targets),
    )

    restored = 0
    skipped = 0
    for row in targets:
        collides = conn.execute(
            sa.text(_COLLIDES),
            {
                "tenant_id": row["tenant_id"],
                "content_hash": row["content_hash"],
                "memory_id": row["memory_id"],
            },
        ).first()
        if collides:
            skipped += 1
            logger.error(
                "memrestore_01: SKIPPING memory_id=%s — a live row in tenant %s "
                "already holds content_hash %s, so restoring this one would "
                "violate the live-dedup unique index. The document stays "
                "invisible; the live duplicate carries its content. Merge them "
                "by hand if the invisible copy has content the live one lacks.",
                row["memory_id"],
                row["tenant_id"],
                row["content_hash"],
            )
            continue

        # `prior_*` mirrors the key names `memhold_adjudicate_01` used, so the
        # provenance shape is one idiom across the memory revisions rather than
        # a new one per author. downgrade() reads these back.
        #
        # The casts are spelled `CAST(:x AS text)` and NOT `:x::text` on purpose.
        # `sa.text()` finds binds with `(?<![\w:\\]):(\w+)(?!:)` — that trailing
        # `(?!:)` exists to leave PostgreSQL's `::` cast operator alone, and it
        # backtracks rather than failing: given `:prior_valid_until::text` it
        # registers a bind named `prior_valid_unti` (one character short) and
        # emits the ORIGINAL `:prior_valid_until::text` into the compiled SQL.
        # The `:name` then reaches PostgreSQL literally — `syntax error at or
        # near ":"` — while the value silently never binds. That is exactly how
        # this revision failed to apply on 2026-08-04 (run 30947022520). Do not
        # "simplify" these back to `::text`.
        conn.execute(
            sa.text(
                """
                UPDATE coord.memory_records
                   SET valid_until   = NULL,
                       superseded_by = NULL,
                       source = jsonb_set(
                           jsonb_set(
                               source,
                               '{lifecycle_hold}', 'true'::jsonb, true),
                           '{restore_2026_08_04}',
                           jsonb_build_object(
                               'reason', 'synthesis job superseded its own source document',
                               'prior_valid_until', to_jsonb(CAST(:prior_valid_until AS text)),
                               'prior_superseded_by', to_jsonb(CAST(:prior_superseded_by AS text)),
                               'held_pending', 'reclassification out of kind=observation'
                           ),
                           true)
                 WHERE memory_id = :memory_id
                """
            ),
            {
                "memory_id": row["memory_id"],
                "prior_valid_until": row["valid_until"],
                "prior_superseded_by": row["superseded_by"],
            },
        )
        restored += 1

    logger.info(
        "memrestore_01: restored %d document(s), skipped %d on live-dedup collision. "
        "Restored rows carry source.lifecycle_hold=true and are out of every "
        "automatic sweep until reclassified.",
        restored,
        skipped,
    )


def downgrade() -> None:
    """Re-hide exactly the rows this revision restored, from their own provenance.

    Only rows carrying ``source.restore_2026_08_04`` are touched, and each is
    put back to the ``valid_until`` / ``superseded_by`` it actually had — never
    a blanket re-invalidation, which would catch rows that were live all along.

    The hold is released on the way back only if THIS revision set it. A row
    that already carried a hold from a `memhold_*` revision keeps it: the
    absence of a recorded prior hold state is why the flag is dropped rather
    than set false, leaving `_not_lifecycle_held`'s "absent key" reading intact.
    """
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE coord.memory_records
               SET valid_until = NULLIF(
                       source->'restore_2026_08_04'->>'prior_valid_until', 'None'
                   )::timestamptz,
                   superseded_by = NULLIF(
                       source->'restore_2026_08_04'->>'prior_superseded_by', 'None'
                   )::uuid,
                   source = (source - 'restore_2026_08_04') - 'lifecycle_hold'
             WHERE jsonb_exists(source, 'restore_2026_08_04')
            """
        )
    )
