"""coord.session_messages park_work_unit_slug — expand + backfill (Stage 3a)

Revision ID: parkwuslug_01
Revises: memhold_adjudicate_02
Create Date: 2026-08-03

Stage 3a (EXPAND half) of plan
``D:/qontinui-root/plans/2026-07-28-coord-post-plan-slug-surfaces-rename.md``.
Authored by alembic in ``qontinui-web`` — coord authors zero ``coord.*`` DDL
(memory ``reference_coord_rust_authors_zero_coord_schema``).

``coord.session_messages.park_plan_slug`` was added by revision
``coord_sm_to_handle``. It records the SENDER's work-unit context when a
``claim:``/``resource:`` message is sent with no live holder and is therefore
parked: a later acquirer receives the parked row only when its own context
matches, which is what stops a stale directive from being replayed at whoever
happens to pick the claim up next. The surrounding surfaces have since been
renamed plan-slug → work-unit-slug, and this column is the last name still
carrying the old vocabulary. It is renamed via expand/contract:

* **Stage 3a (this revision)** — ADD the new ``park_work_unit_slug`` column and
  BACKFILL it from ``park_plan_slug``. Both columns exist; ``park_plan_slug``
  remains the live column that coord reads and writes.
* Stage 3b/3c — coord dual-writes, then switches its read to the new column.
* Stage 3d (a LATER release) — DROP ``park_plan_slug``. Not here.

Why the backfill is in THIS migration and must never be split out
-----------------------------------------------------------------
coord's parked-delivery predicate is::

    (park_plan_slug IS NULL OR park_plan_slug = $5)

A NULL in that column does not mean "no rows match" — it means **"deliver to
ANY acquirer"**. So an expand column left un-backfilled is not merely
incomplete, it is a correctness hole with a live blast radius: the moment
coord's read switches to ``park_work_unit_slug`` (Stage 3c), every historical
parked row still holding NULL there stops being context-bound and starts
delivering to **every** context. That is precisely the stale
mis-targeted-directive leak the column was introduced to prevent, and it would
be reintroduced silently — no error, no failed delivery, just parked
directives fanning out to acquirers they were never meant for.

Shipping the ADD without the UPDATE would therefore arm that leak for the
whole interval between the two revisions. The two statements are one atomic
unit of correctness and travel together in a single transaction.

The backfill is written ``WHERE park_work_unit_slug IS NULL AND
park_plan_slug IS NOT NULL`` so it is re-runnable and never overwrites a value
already present (e.g. if a dual-writing coord is deployed before this applies
on some environment).

No index
--------
None is needed and none is added. ``coord_sm_to_handle`` indexes
``session_messages`` three times — ``(to_handle) WHERE acked_at IS NULL``,
``(park_expires_at) WHERE park_expires_at IS NOT NULL``, and ``((1)) WHERE
action ? 'park_source_id'`` — and **none of them is on ``park_plan_slug``**
(verified against the full revision set: ``park_plan_slug`` appears in no
``CREATE INDEX`` anywhere in this repo). The parked scan is backed by
``idx_session_messages_address``; the slug is a filter applied to that already
tiny candidate set, not a lookup key. So the rename adds no index to mirror.

Idempotency: ``ADD COLUMN IF NOT EXISTS`` plus a guarded ``UPDATE``
(``coord_session_messages`` / ``coord_sm_to_handle`` posture). Additive and
nullable, so it deploys in either order relative to coord and legacy rows
degrade gracefully.

Downgrade drops ONLY the new column. It must not touch ``park_plan_slug``,
which is still the live column at this stage.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "parkwuslug_01"
down_revision: str | Sequence[str] | None = "memhold_adjudicate_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``park_work_unit_slug`` and backfill it. Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.session_messages
            ADD COLUMN IF NOT EXISTS park_work_unit_slug TEXT
        """
    )
    # MANDATORY, and mandatory HERE: a NULL park slug reads as "deliver to any
    # acquirer", so an un-backfilled row silently loses its context binding the
    # moment coord's read switches to the new column. See the module docstring.
    op.execute(
        """
        UPDATE coord.session_messages
           SET park_work_unit_slug = park_plan_slug
         WHERE park_work_unit_slug IS NULL
           AND park_plan_slug IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop the new column only — ``park_plan_slug`` is still live."""
    op.execute(
        "ALTER TABLE coord.session_messages DROP COLUMN IF EXISTS park_work_unit_slug"
    )
