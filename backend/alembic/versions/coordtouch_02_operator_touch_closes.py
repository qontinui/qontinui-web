"""coord.operator_touch_closes — the append-only close sidecar for operator touches

Revision ID: coordtouch_02_operator_touch_closes
Revises: twin_11_seed_qontinui_production_url
Create Date: 2026-10-05

Phase 1 of plan ``2026-10-05-operator-touch-close-path`` (VETTED 2026-10-05).

coord authors **zero** DDL (served policy ``production-and-cost``
``alembic-sole-authorship``), so the table lands here, in qontinui-web, and must
be APPLIED in production before the coord PR that writes it (that plan's Phase
2a, which also bumps coord's migrator pin to this revision). ``down_revision``
is this repo's LOCAL single alembic head, and is deliberately NOT pinned to the
head this revision was authored against: ``alembic-graph-pr.yml`` serialises
alembic PRs by construction, so every revision that lands ahead of this one
re-forks the chain and this line is re-pointed at the new head. Re-point it; do
NOT author an ``alembic merge`` revision, and do NOT hand-order it with coord
dependency labels — the graph gate owns this ordering, not coord.

The gap
=======

Nothing resolves an operator touch after it is written. ``coordtouch_01``'s
``resolved_at`` / ``resolution`` can only be set by the FIRST insert for a key:
coord's insert ends ``ON CONFLICT (idempotency_key) DO NOTHING``, and a repeat
POST carrying a ``resolution`` is discarded (``DeduplicatedResolutionDiscarded``).
So every touch reads open forever, the wait duration Phase 5 of plan
``2026-08-27-operator-touch-read-and-surface`` needs is unmeasurable, and the
open-set partial index is the whole table.

Measured against production on 2026-10-05, before this revision (read-only,
ECS Exec into the ``web`` container, psycopg2 ``set_session(readonly=True)``,
``SELECT kind, count(*) FROM coord.operator_touches WHERE resolved_at IS NULL
GROUP BY kind``; recorded in the plan's Phase 1): **309** rows in
``coord.operator_touches``, **all 309 open** (``resolved_at IS NULL``) —
``idle_at_prompt`` 269, ``permission_prompt`` 8, ``session_exit`` 32 — every
one ``source = 'runner_hook'``, emitted between 2026-10-02 01:18 and
2026-10-05 20:18 UTC. No row has ever been closed. The emitter is live; the
close path is what is missing.

Why a sidecar and not an UPDATE
===============================

``coordtouch_01`` states the rule this revision keeps: *"Nothing updates or
deletes a row in either table."* Closing a touch by UPDATE would break it, and
re-POSTing the key with a ``resolution`` would turn coord's dedup into an
update. So a close is a second, append-only row in its own table — the same
shape as the shipped classification sidecar
(``coord.operator_touch_classifications``): FK to the touch with
``ON DELETE CASCADE``, a timestamp that coord's write stamps with
``clock_timestamp()`` under the row lock, and an actor.

What this migration does
========================

1. Creates ``coord.operator_touch_closes``: at most one **append-only** row per
   ``(touch, close_source)``.
2. Writes **no rows**. Nothing writes the table until the coord close door
   (Phase 2a) and the runner closer (Phase 3) ship.

Column contract — ``coord.operator_touch_closes``
=================================================

A shared contract with the coord Rust code that will write and fold it. The
names must not drift from this list.

``close_id UUID PRIMARY KEY``
    Server-side ``gen_random_uuid()`` default, as ``coordtouch_01``'s two
    tables use. A stable key for an append-only log; nothing outside addresses
    a close by it except the ``already_closed`` outcome naming the row it hit.

``touch_id UUID NOT NULL REFERENCES coord.operator_touches ON DELETE CASCADE``
    The touch this row closes. A close is a record OF a touch, so it must not
    outlive one — the classification sidecar's rule.

``resolution TEXT NOT NULL``
    How the touch ended, in ``coordtouch_01``'s vocabulary (``answered`` /
    ``timed_out`` / ``abandoned`` / ``self_resolved``). NOT NULL: a close row
    with no resolution would be a close of nothing.

``close_source TEXT NOT NULL``  ← **the one CHECKed column**
    Which closer wrote the row: ``runner_observed`` (the runner that opened the
    touch saw it end) or ``session_closed_sweep`` (coord's sweep found the
    touch's session closed, or the touch past its max open age). Set by coord
    from the principal, never read from a request body. The effective
    resolution of a touch is a fold over these (plan D2): the touch's own
    insert-time ``resolution``, else the ``runner_observed`` close, else the
    ``session_closed_sweep`` close — so a sweep that ran first never pre-empts
    the runner's later, truer close, and the table stays append-only.

``close_actor_class TEXT NULL``
    Who supplied the input that closed it, from the runner's input classifier:
    ``human`` / ``unknown`` / ``none``. NULL when the closer cannot say (a
    sweep close, an ``abandoned`` close). ``unknown`` is recorded as unknown,
    never rounded to ``human``.

``observed_wait_ms BIGINT NULL``
    The wait, measured by the runner as a DURATION on one device's clock — from
    the outbox ``recorded_at`` of the open to that of the close (plan D3). It
    is a duration, not a timestamp, so it never enters coord's ordering.

    **Why this is stored when** ``coordtouch_01`` **refused a stored wait.**
    ``coordtouch_01`` derived the wait from ``emitted_at`` / ``resolved_at``
    because both were meant to be the touch's real boundaries. They are not:
    ``emitted_at`` is coord's insert time, i.e. the outbox DRAIN time (*"a
    wedged box that drains an hour of queued touches stamps them all at drain
    time"*), and open and close share one per-session outbox chain, so after
    any backlog ``closed_at - emitted_at`` reads ≈0. The difference of two
    drain stamps measures the drain, not the wait. Only the emitter saw both
    ends, so only the emitter can report the duration — the same reasoning by
    which ``coordinput_01`` takes an emitter-supplied ``occurred_at``. NULL for
    every close that did not measure it (every sweep close), which is the
    honest value: a sweep knows THAT a touch ended, not WHEN.

``closed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()``
    When coord was TOLD the touch ended — the same meaning ``resolved_at``
    has on the touch row. ``clock_timestamp()`` rather than ``now()``: the
    close door inserts under a ``FOR UPDATE`` lock on the touch row, and only
    the wall clock read AFTER the lock orders serialized writers — the reason
    coord's classification write stamps ``classified_at`` the same way
    (``operator_touches.rs``, "``clock_timestamp()`` under the row lock").

``by_actor TEXT NOT NULL``
    The principal coord resolved from the verified JWT (or
    ``coord:session_closed_sweep`` for the sweep). NOT NULL, unlike the
    classification sidecar's ``by_actor``: the close door admits device
    principals only (plan D8), so every writer can name itself, and an
    unattributed close of an operator wait is exactly the laundering
    ``coordtouch_01``'s immutability exists to prevent.

The CHECK — only on ``close_source``
====================================

``close_source`` is a closed set naming the closers *in this codebase*; it does
not grow from data, and a bad value there silently poisons every
source-filtered wait statistic. ``resolution`` and ``close_actor_class`` carry
**no CHECK**, following ``coordtouch_01`` (whose only vocabulary CHECK is on
``source``): coord validates them at its write boundary (a 422) and decodes
them fail-open, so a new word never needs a cross-repo schema release before
coord may write it.

Indexes
=======

* ``uq_operator_touch_closes_touch_source`` — UNIQUE on
  ``(touch_id, close_source)``. Plan D2: at most one close per source, so a
  duplicate outbox drain is a typed no-op rather than a second row, and the
  ``ON CONFLICT`` target coord's close insert names. Its leading column also
  serves the open read's anti-join on ``touch_id`` (below), so no separate
  ``(touch_id)`` index is created.

The open read — why ``ix_operator_touches_tenant_open`` is NOT dropped here
============================================================================

``coordtouch_01`` built ``(tenant_id, emitted_at DESC) WHERE resolved_at IS
NULL`` for the "still open" read. Once closes live in this sidecar, a
sidecar-closed touch keeps ``resolved_at`` NULL on its own row, so that
predicate no longer means "open" — and with nothing ever setting
``resolved_at`` it already indexes the whole table (all 309 of 309 rows,
measured above). Plan D7 retires it, but NOT in this revision: the drop
moves to the revision that ships with the read-side switch (plan Phase 4),
when the last reader of that predicate goes away. Two reasons. First, a
revision that drops anything is "destructive outside downgrade()" to coord's
land-time re-point engine (E6), which then refuses to re-point it every time
``main`` gains a migration — an additive-only revision is re-pointed
mechanically. Second, until Phase 4 the open read still filters on
``resolved_at IS NULL``, so the index is not yet dead.

Append-only
===========

Nothing updates or deletes a row in this table. No ``updated_at``, no upsert
key beyond the ``(touch_id, close_source)`` dedup one. A second close from the
same source is a no-op naming the first, never an edit of it; a close from
another source is a second row, and the precedence fold above decides which one
is effective. The only way a close row goes away is with its touch
(``ON DELETE CASCADE``). Retention, if it ever matters, is a later prune
migration — ``coord_alerts_retention_01`` is the template.

No grants, row-level security or ownership changes: ``coordtouch_01`` applies
none to either of its tables, and this table follows it.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coordtouch_02_operator_touch_closes"
down_revision: str | Sequence[str] | None = "twin_11_seed_qontinui_production_url"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the close sidecar (additive only)."""
    # Raw ``op.execute`` with IF NOT EXISTS throughout — the convention
    # coordtouch_01 and the sibling coord observation tables use, and what keeps
    # a re-run harmless.
    #
    # `close_source` is the ONE vocabulary column that takes a CHECK: a closed
    # set of closers in this codebase, not a vocabulary that grows from data.
    # Named so a violation reports the invariant. It is declared INLINE rather
    # than added by a separate ALTER (coordtouch_01's drop-then-add): this
    # revision must contain no DROP outside downgrade(), or coord's land-time
    # alembic re-point refuses it as destructive (E6). A table this revision
    # creates has no prior vocabulary to converge from; a change is a new
    # revision.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.operator_touch_closes (
            close_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            touch_id           UUID NOT NULL
                REFERENCES coord.operator_touches(touch_id) ON DELETE CASCADE,
            resolution         TEXT NOT NULL,
            close_source       TEXT NOT NULL,
            close_actor_class  TEXT NULL,
            observed_wait_ms   BIGINT NULL,
            closed_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            by_actor           TEXT NOT NULL,
            CONSTRAINT ck_operator_touch_closes_close_source
                CHECK (close_source IN ('runner_observed', 'session_closed_sweep'))
        )
        """
    )
    # At most one close per (touch, source) — plan D2. The ON CONFLICT target
    # coord's close insert names, and (by its leading column) the index the
    # open read's anti-join on touch_id uses.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_operator_touch_closes_touch_source
            ON coord.operator_touch_closes (touch_id, close_source)
        """
    )


def downgrade() -> None:
    """Drop the close sidecar."""
    op.execute("DROP INDEX IF EXISTS coord.uq_operator_touch_closes_touch_source")
    # No separate constraint drop: DROP TABLE takes the CHECK and the FK with
    # it, and an ``ALTER TABLE IF EXISTS`` here would trip the repo's alembic
    # schema= gate (coordtouch_01's downgrade records the same).
    op.execute("DROP TABLE IF EXISTS coord.operator_touch_closes")
