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

``CONCURRENTLY``, and the INVALID-index heal
==========================================================================

``coord.session_events`` is a live, continuously-appended table (every
session transition and every coord transport-rung observation), so a plain
``CREATE INDEX`` would take a write-blocking ``SHARE`` lock for the build.
``CREATE INDEX CONCURRENTLY`` cannot run in a transaction and ``env.py`` wraps
the batch in one, hence ``op.get_context().autocommit_block()`` — the
precedent every coord.* index revision here follows
(``coord_alerts_pagedidx_01``, ``coord_pg_overload_idx_01`` / ``_02``).

A killed CONCURRENTLY build leaves an INVALID index of the same name, which
``IF NOT EXISTS`` then skips — a migration that reports success while the
index never serves a query. So this revision follows
``coord_wu_list_order_02``'s heal-then-assert shape: an INVALID leftover is
dropped before the build, and after it the index must exist, be valid, and
carry both the key list and the partial predicate, or the revision raises
rather than stamping.

Revision ID: coord_sessev_interact_idx_01
Revises: overview_03_documents_and_wiki
Create Date: 2026-09-27

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessev_interact_idx_01"
down_revision: str | Sequence[str] | None = "overview_03_documents_and_wiki"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_IX_INTERACTIVITY = "coord_session_events_interactivity_idx"

# Fragments of `pg_get_indexdef` the built index must carry. `pg_get_indexdef`
# renders only non-defaults (so `occurred_at DESC` without NULLS FIRST, DESC's
# default) and parenthesises and casts the predicate — hence the `::text` and
# the outer parentheses.
_REQUIRED_FRAGMENTS: tuple[str, ...] = (
    "(session_id, occurred_at DESC)",
    "WHERE (event_kind = 'remote-interactivity'::text)",
)

_INDEX_STATE_SQL = """
    SELECT i.indisvalid, pg_get_indexdef(i.indexrelid)
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'coord' AND c.relname = :idx
"""


def _index_state() -> tuple[bool, str] | None:
    """``(indisvalid, definition)`` of the index; ``None`` when absent."""
    row = (
        op.get_bind()
        .execute(sa.text(_INDEX_STATE_SQL), {"idx": _IX_INTERACTIVITY})
        .one_or_none()
    )
    if row is None:
        return None
    return bool(row[0]), str(row[1])


def _require_healthy() -> None:
    """Raise unless the index exists, is valid, and has the right definition."""
    state = _index_state()
    common = (
        "The fleet page's per-session interactivity LATERAL depends on this "
        "index, and CREATE INDEX CONCURRENTLY IF NOT EXISTS reports success "
        "without it serving anything — so this raises rather than stamping "
        "the revision."
    )
    if state is None:
        raise RuntimeError(
            f"coord.{_IX_INTERACTIVITY} is MISSING after CREATE INDEX "
            f"CONCURRENTLY IF NOT EXISTS reported success. {common}"
        )
    valid, definition = state
    if not valid:
        raise RuntimeError(
            f"coord.{_IX_INTERACTIVITY} is INVALID after this revision's "
            f"CREATE INDEX CONCURRENTLY, so that build was itself interrupted. "
            f"{common} Recovery: DROP INDEX CONCURRENTLY "
            f"coord.{_IX_INTERACTIVITY}, then re-run this migration."
        )
    missing = [f for f in _REQUIRED_FRAGMENTS if f not in definition]
    if missing:
        raise RuntimeError(
            f"coord.{_IX_INTERACTIVITY} is valid but its definition lacks "
            f"{missing!r}; IF NOT EXISTS matches on NAME alone, so a same-named "
            f"index built differently is kept. {common} Recovery: DROP INDEX "
            f"CONCURRENTLY coord.{_IX_INTERACTIVITY}, then re-run this "
            f"migration.  found: {definition}"
        )


def upgrade() -> None:
    """Heal-then-build-then-assert the partial index. Idempotent."""
    with op.get_context().autocommit_block():
        state = _index_state()
        if state is not None and not state[0]:
            # Only an INVALID leftover is dropped; a valid one is kept and
            # checked by `_require_healthy` below.
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.coord_session_events_interactivity_idx"
            )
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook parses the raw SQL inside `op.execute(...)` to prove
        # every CREATE/DROP names its schema.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                coord_session_events_interactivity_idx
            ON coord.session_events (session_id, occurred_at DESC)
            WHERE event_kind = 'remote-interactivity'
            """
        )
        _require_healthy()


def downgrade() -> None:
    """Drop the partial index this revision built. The table is untouched."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.coord_session_events_interactivity_idx"
        )
