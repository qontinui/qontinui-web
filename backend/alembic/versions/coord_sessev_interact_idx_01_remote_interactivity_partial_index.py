"""coord.session_events: partial index for the per-session interactivity read.

Phase A2 (web side, ordered FIRST) of plan
``qontinui-dev-notes/plans/2026-09-20-remote-session-interactivity-is-a-query-and-both-halves-hold.md``
(vet defect 8). Additive, index-only, forward-only in intent (the downgrade
drops exactly what this revision builds).

What reads it
==========================================================================

Coord's fleet page (``session_fleet.rs``) gains ``readableRemotely`` /
``writableRemotely`` per session: the newest ``remote-interactivity`` event
per ``(session, half)``, derived by a LATERAL over ``coord.session_events``
for every row of a fleet page (up to 500 sessions). Each LATERAL probe is::

    SELECT ... FROM coord.session_events
     WHERE session_id = s.id AND event_kind = 'remote-interactivity'
       AND payload ->> 'half' = $half
     ORDER BY occurred_at DESC
     LIMIT 1

The table's existing indexes cannot serve that shape
(``coord_session_substrate.py``): ``coord_session_events_kind_idx`` is
``(event_kind, occurred_at DESC)`` — it leads on the kind, so a per-session
probe walks EVERY interactivity event of the whole fleet newest-first until
it meets this session — and the ``UNIQUE (session_id, seq)`` constraint orders
by ``seq``, not ``occurred_at``, and does not filter the kind, so the probe
reads every event the session ever wrote (transport rungs, lifecycle, ...).

``(session_id, occurred_at DESC) WHERE event_kind = 'remote-interactivity'``
makes each probe an index descent to the session's newest interactivity rows:
the partial predicate removes every other kind from the index entirely, and
the key order is the LATERAL's ORDER BY. The ``half`` filter is applied to the
first few heap rows reached; a reporter coalesces to at most one row per
``(session, half, source)`` per 300 s, so the newest row of each half is a
handful of entries from the top.

The coord read does not DEPEND on the index for correctness — it degrades to
the slower plan without it — so the ordering edge (this lands first) is about
the 500-row page's latency on the day coord ships the LATERAL, not about a
missing column.

No ``event_kind`` DDL
==========================================================================

``coord.session_events.event_kind`` is ``TEXT NOT NULL`` with no CHECK (the
vet searched every revision; ``drr_01_readiness_on_resource_sample`` states it
in terms), so the new ``remote-interactivity`` kind needs no schema change.
This index is the whole of the plan's alembic step.

``CONCURRENTLY``
==========================================================================

``coord.session_events`` is a live, continuously-appended table (every
session transition and every coord transport-rung observation), so a plain
``CREATE INDEX`` would take a write-blocking ``SHARE`` lock for the build.
``CREATE INDEX CONCURRENTLY`` cannot run in a transaction and ``env.py`` wraps
the batch in one, hence ``op.get_context().autocommit_block()`` — the
precedent every coord.* index revision here follows
(``coord_alerts_pagedidx_01``, ``coord_pg_overload_idx_01`` / ``_02``).

Additive ONLY, so it lands without a human — and the INVALID-index trap
==========================================================================

This file is shaped to pass coord's merge-time additive-safety classifier
(qontinui-coord ``crates/coord/src/pr_merge/migration_classifier.rs``), which
auto-lands a migration only when every op on its upgrade path is proven
additive and escalates it to a human otherwise. Two things it would refuse,
and which this revision therefore does NOT do, even though
``coord_wu_list_order_02`` does both:

* a ``DROP`` on the upgrade path (``classify_sql_statement``: "destructive
  DROP statement") — so an INVALID leftover is not dropped and rebuilt here;
* any SQL run through something other than ``op.execute`` —
  ``op.get_bind().execute(...)`` included (``forbid_unclassifiable_code``:
  "SQL executed outside op.execute") — so the catalog cannot be read back
  to assert the index is valid after the build.

The cost, stated plainly: a killed CONCURRENTLY build leaves an INVALID index
of the same name, which ``IF NOT EXISTS`` then skips, so a re-run reports
success while the index serves no query (and a same-named index built with a
different definition is kept the same way). Coord's read does not depend on
the index for correctness — it only runs slower without it — so this is a
latency hazard, not a correctness one. Verify after deploy with
``pg_index.indisvalid`` and ``pg_get_indexdef``, never existence alone::

    SELECT i.indisvalid, pg_get_indexdef(i.indexrelid)
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'coord_session_events_interactivity_idx';

Recovery for an INVALID (or wrongly-defined) index:
``DROP INDEX CONCURRENTLY coord.coord_session_events_interactivity_idx``, then
re-run this migration (``alembic stamp overview_03_documents_and_wiki`` first
if the revision is already stamped).

Revision ID: coord_sessev_interact_idx_01
Revises: overview_03_documents_and_wiki
Create Date: 2026-09-27

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessev_interact_idx_01"
down_revision: str | Sequence[str] | None = "overview_03_documents_and_wiki"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one CONCURRENTLY partial index. Idempotent by IF NOT EXISTS."""
    with op.get_context().autocommit_block():
        # Plain literal, never an f-string: coord's classifier admits only a
        # STATIC op.execute argument, and the `alembic-schema-arg-gate`
        # pre-commit hook parses it to prove the statement names its schema.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                coord_session_events_interactivity_idx
            ON coord.session_events (session_id, occurred_at DESC)
            WHERE event_kind = 'remote-interactivity'
            """
        )


def downgrade() -> None:
    """Drop the partial index this revision built. The table is untouched."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.coord_session_events_interactivity_idx"
        )
