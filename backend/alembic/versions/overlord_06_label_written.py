"""coord.overlord_interventions.label_written — did this row write its own label

Revision ID: overlord_06_label_written
Revises: ci_measure_01_dispatch_measurement
Create Date: 2026-11-22

Phase 1 of plan ``2026-11-22-overlord-intervention-label-written-marker``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
column and its CHECK land here, in qontinui-web, before the coord PR that
writes and reads them.

The gap
=======

``verify_relay_is_fresh`` (qontinui-coord
``crates/coord/src/overlord_interventions.rs``) refuses a relayed operator
answer with ``RELAY_NOT_NEWER`` when the answer is not newer than the chain's
newest operator decision. Its ``operator_page`` arm counts every row with
``label_source = 'operator_page' AND recorded_by_user_id IS NOT NULL``. The
label columns are INHERITED by a row that writes no label, and
``recorded_by_user_id`` is bound from the writer, so an unlabelled
operator-page successor (an outcome row, say) counts as a decision dated at
its own ``recorded_at``. A genuinely newer answer is then refused.

The cheap fix -- skip a row whose label equals its predecessor's -- was
rejected (qontinui-coord ``verify_relay_is_fresh`` docstring at bb4cf4a6a,
recorded on qontinui-coord#4319 as a Coord-Handoff-Rejected line): an operator who
RE-AFFIRMS the same label writes a row identical in its label columns to an
inheriting one, and dropping it would let an older answer overwrite the
re-affirmation. The two cases differ only in whether the write path chose the
label, which ``resolve_label`` knows at write time and never stored. This
column stores it.

The column (this docstring is its authority)
============================================

``coord.overlord_interventions.label_written BOOLEAN NULL``
    Whether THIS row wrote its own label columns.

    * ``true`` -- the row wrote its label: ``resolve_label`` took its
      labelling branch, whatever the source (``operator_page``, ``agent`` or a
      verified ``operator_relayed`` relay).
    * ``false`` -- the row inherited its predecessor's label columns
      (``inherited_label``), or wrote none at all (an unlabelled root, or a
      class change that resets the label to empty).
    * ``NULL`` -- the row was written before this revision (or by a coord
      build that predates the marker). The marker is UNKNOWN, and coord's
      freshness rule counts such a row as a decision
      (``label_written IS NOT FALSE``), so the rule keeps failing closed: it
      may refuse an answer that is in fact newer, and it never accepts an
      older one.

    The marker is never inherited from the predecessor row, the same rule
    ``overlord_05_label_question_id`` applies to ``label_question_id``.

Why no DEFAULT and no backfill
==============================

The plan's Design decision weighed four shapes and resolved on this one
(option A: nullable, no DEFAULT, no backfill):

* **B. ``NOT NULL DEFAULT false``** would read every legacy row as
  "inherited", so every legacy operator-page label would silently stop
  counting as a decision -- the fail-closed rule would drop exactly the rows
  it must keep. Rejected.
* **C. ``NOT NULL DEFAULT true``** would store a claim nobody made: inherited
  legacy rows would read as written forever, indistinguishable from real
  writes (``[policy: unknown-must-not-render-as-a-default]``). Rejected.
* **D. A plus a partial backfill** of the decidable rows (label differs from
  the predecessor's, a labelled root, or a ``label_question_id``) still leaves
  the identical-label rows undecidable, so NULL stays necessary; and it is DML
  in a migration, inspected by coord's migration classifier, that changes no
  decision on today's data -- production held 335 interventions (362 history
  rows), none labelled by any source, on 2026-11-16 (finding
  ``8d4f3678-2064-49d8-b7f6-f03fd8adb9ef``). Rejected.

NULL is therefore not a permanent shim: once every new row carries the marker,
NULL rows are exactly the legacy rows that cannot be re-derived, and the NULL
arm of coord's query is their fail-closed path.

The CHECK
=========

``ck_overlord_interventions_label_written_has_source``:
``label_written IS NOT TRUE OR label_source IS NOT NULL``. "Wrote a label"
implies a stored source. ``resolve_label`` always sets a source on its
labelling branch, so the CHECK refuses only a writer bug. ``false`` and NULL
are unconstrained: an unlabelled row has no source. ``label_source`` and its
value set are ``overlord_02_four_class_vocabulary``'s.

Safety
======

Everything runs in one transaction under ``SET LOCAL lock_timeout = '3s'``
(``alembic/env.py`` restores lock_timeout after each revision). The ``ADD
COLUMN`` takes ACCESS EXCLUSIVE briefly; the new column is NULL on every row,
so the CHECK validates trivially over a ledger of a few hundred rows.
Nullable, no DEFAULT. Every ``op.execute`` is one static literal.

Ordering
========

This revision must be APPLIED in production before the coord PR (Phase 2)
that stores and reads the column deploys; that coord PR's ``schema.manifest``
bump to this revision is gated on it being the migrator head. The reverse
window (column live, old coord) is safe: old coord omits the column, rows
store NULL, and NULL fails closed. ``down_revision`` is the local single head
at authoring time and is re-pointed, not merged, if another revision lands
first.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overlord_06_label_written"
down_revision: str | Sequence[str] | None = "ci_measure_01_dispatch_measurement"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Names as data; the migration test pins these against the static SQL below,
# which spells them as STATIC literals because coord's migration classifier can
# only inspect static op.execute literals.
_ADDED_COLUMN: tuple[str, str, str] = (
    "overlord_interventions",
    "label_written",
    "BOOLEAN",
)
_CHECK_NAME = "ck_overlord_interventions_label_written_has_source"


def upgrade() -> None:
    """Add the column, its comment and its CHECK."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.overlord_interventions
            ADD COLUMN label_written BOOLEAN
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.overlord_interventions.label_written IS
            'Whether THIS row wrote its own label (plan 2026-11-22-overlord-'
            'intervention-label-written-marker). true = this row wrote its '
            'label (operator page, agent or relay); false = it inherited its '
            'predecessor''s label columns, or wrote none; NULL = written before '
            'this revision, unknown, and counted as a decision by coord''s '
            'freshness rule. Never inherited.'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.overlord_interventions
            ADD CONSTRAINT ck_overlord_interventions_label_written_has_source
            CHECK (label_written IS NOT TRUE OR label_source IS NOT NULL)
        """
    )


def downgrade() -> None:
    """Drop the CHECK, then the column."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.overlord_interventions
            DROP CONSTRAINT IF EXISTS
                ck_overlord_interventions_label_written_has_source
        """
    )
    op.execute(
        """
        ALTER TABLE coord.overlord_interventions
            DROP COLUMN IF EXISTS label_written
        """
    )
