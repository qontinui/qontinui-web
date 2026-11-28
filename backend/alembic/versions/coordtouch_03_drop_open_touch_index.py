"""coord.operator_touches — drop the open-set partial index the close sidecar retired

Revision ID: coordtouch_03_drop_open_touch_index
Revises: overlord_02_four_class_vocabulary
Create Date: 2026-10-17

Phase 4 of plan ``2026-10-05-operator-touch-close-path`` (design decision D7).

coord authors **zero** DDL (served policy ``production-and-cost``
``alembic-sole-authorship``), so the index drop lands here, in qontinui-web.
``down_revision`` is this repo's LOCAL single alembic head, and is deliberately
NOT pinned to the head this revision was authored against:
``alembic-graph-pr.yml`` serialises alembic PRs by construction, so every
revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; do NOT author an ``alembic merge``
revision, and do NOT hand-order it with coord dependency labels — the graph
gate owns this ordering, not coord.

Why the index goes
==================

``coordtouch_01`` built ``ix_operator_touches_tenant_open`` as
``(tenant_id, emitted_at DESC) WHERE resolved_at IS NULL`` for the "still
open" read, sized to what is open. That predicate stopped meaning "open" when
``coordtouch_02`` moved closes into the append-only sidecar
``coord.operator_touch_closes``: a touch closed through the sidecar keeps
``resolved_at`` NULL on its own row, because nothing updates a touch row
(``coordtouch_01``'s immutability rule). So the partial index indexes every
sidecar-closed touch as if it were open — measured on 2026-10-05 it already
covered all 309 of 309 rows — and it never becomes selective again.

The open read is re-shaped instead (plan D7, by coord's Phase 4 read-side
switch, qontinui-coord#3351, not yet landed when this was written): an open
touch is one with no EFFECTIVE resolution — the touch's own insert-time
``resolution``, else a ``runner_observed`` close, else a
``session_closed_sweep`` close — and the read is **window-bounded** on
``(tenant_id, emitted_at)``, served by
``ix_operator_touches_tenant_emitted_at`` (``coordtouch_01``), with an
anti-join on the sidecar's ``touch_id``, served by the leading column of
``uq_operator_touch_closes_touch_source`` (``coordtouch_02``). Its cost is
bounded by the window, not by history. Once that read ships, nothing filters
on ``resolved_at IS NULL`` and this index is pure write overhead on every
touch insert.

The one non-additive step — and why it is here
==============================================

Plan D7 originally dropped the index in ``coordtouch_02``. It was moved here
during implementation (amended 2026-10-06), for two reasons:

1. coord's land-time alembic re-point classifies any revision with a drop
   outside ``downgrade()`` as destructive (refusal clause **E6**) and will not
   re-point it mechanically when ``main``'s head moves; it refused web#1693
   twice on that ground before the drop was split out. ``coordtouch_02`` is
   therefore additive-only, and THIS revision carries the plan's single
   destructive step on its own.
2. Until coord's Phase 4 read switch is live the open read still filters on
   ``resolved_at IS NULL``. Dropping the index before it is still harmless:
   a partial index changes speed, never results, and this one already covers
   every row, so it is no more selective than
   ``ix_operator_touches_tenant_emitted_at``, which the window-bounded read
   uses anyway.

Consequence for whoever lands it: because this revision IS destructive outside
``downgrade()``, coord's re-point engine refuses it (E6) whenever another
migration lands first, and posts the exact hand edits instead. Apply them by
hand — the ``down_revision`` assignment and the ``Revises:`` header line above
— and push; the test reads its parent from this file at runtime, so it needs
no edit.

What this migration does
========================

1. Drops ``coord.ix_operator_touches_tenant_open`` (``IF EXISTS``, so a re-run
   is harmless).
2. Touches no table and no row. ``coord.operator_touches`` and both sidecars
   are unchanged; the window index and the close sidecar's unique index stay.

``downgrade()`` recreates the index exactly as ``coordtouch_01`` created it,
so a downgrade restores the read path the pre-Phase-4 coord build relies on.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coordtouch_03_drop_open_touch_index"
down_revision: str | Sequence[str] | None = "overlord_02_four_class_vocabulary"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the open-set partial index (plan D7) — the one destructive step."""
    # Raw ``op.execute`` with IF EXISTS, the convention coordtouch_01/02 and the
    # sibling coord revisions use, which keeps a re-run harmless. Plain rather
    # than CONCURRENTLY: alembic runs each revision in a transaction, and the
    # table is small (hundreds of rows at authoring).
    op.execute("DROP INDEX IF EXISTS coord.ix_operator_touches_tenant_open")


def downgrade() -> None:
    """Recreate the open-set partial index exactly as coordtouch_01 built it."""
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_operator_touches_tenant_open
            ON coord.operator_touches (tenant_id, emitted_at DESC)
            WHERE resolved_at IS NULL
        """
    )
