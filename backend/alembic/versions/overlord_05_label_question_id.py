"""coord.overlord_interventions.label_question_id — the row that relayed an answer

Revision ID: overlord_05_label_question_id
Revises: overlord_04_runner_start_and_nudge_time
Create Date: 2026-11-14

Phase 1 of plan ``2026-11-02-overlord-one-answer-relays-once-server-side``.
The plan names this revision ``overlord_04_label_question_id``; that slot was
taken by ``overlord_04_runner_start_and_nudge_time`` before it was authored,
so it is ``overlord_05``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
column, its CHECK and its index land here, in qontinui-web, before the coord PR
that writes and reads them.

The gap
=======

``verify_relay_question`` (qontinui-coord
``crates/coord/src/overlord_interventions.rs``) checks that a question was
answered by the operator and bound to this intervention. It does not check that
the answer has not already been relayed, nor that the operator has not decided
again since. Re-sending an old ``label_question_id`` therefore writes the older
answer as the chain's newest label, marked ``operator_relayed``, over a newer
operator label. coord stores nothing that would let it tell.

The column (this docstring is its authority)
============================================

``coord.overlord_interventions.label_question_id UUID NULL``
    The id of the coord agent question whose operator answer THIS row relayed
    as its label. It marks the row that did the relaying, and only that row:

    * Set only when ``label_source = 'operator_relayed'``; the CHECK
      ``ck_overlord_interventions_label_question_relayed`` refuses it anywhere
      else.
    * A successor row on the same chain does NOT inherit it, even though it
      inherits the label. An inherited label is not a decision, and copying the
      id would make the unique index refuse the successor.
    * ``operator_relayed`` rows written before this revision stay NULL. They
      cannot be backfilled (nothing recorded which question they relayed). The
      coord half of the plan (Phase 2) is to date them by ``recorded_at``, which
      is never earlier than their answer, so the rule refuses an old answer and
      never accepts one.
    * NULL on any other row means "not a relay", never UNKNOWN.

    No foreign key: no revision in the ``overlord_0*`` series references a
    coord id table such as the agent-questions table (``overlord_03``'s only
    foreign key is to ``coord.overlord_passes``, within the ledger). The ledger
    references coord ids by value, and coord validates the question at the
    write boundary (answered by the operator, bound to this intervention).

The CHECK
=========

``ck_overlord_interventions_label_question_relayed``:
``label_question_id IS NULL OR label_source IS NOT DISTINCT FROM
'operator_relayed'``. The plan spells the right arm ``label_source =
'operator_relayed'``; that admits an id on an UNLABELLED row, because
``label_source`` is nullable and ``NULL = 'operator_relayed'`` is NULL, which a
CHECK passes. ``IS NOT DISTINCT FROM`` is false for NULL, so it refuses.
``label_source`` and its value set are ``overlord_02_four_class_vocabulary``'s
(``ck_overlord_interventions_label_source``).

The index
=========

``ux_overlord_interventions_label_question``: UNIQUE on
``(tenant_id, label_question_id) WHERE label_question_id IS NOT NULL``. A
question's context binds it to one intervention, so a second row carrying the
same id ANYWHERE in the tenant is a reuse. The coord half of the plan (Phase
2) maps the 23505 to the same 422 ``overlord_label_claim_unverified`` its
pre-check returns; until it lands, a reuse that reaches the index surfaces as
a database error.

Safety
======

Everything runs in one transaction under ``SET LOCAL lock_timeout = '3s'``
(``alembic/env.py`` restores lock_timeout after each revision). The ``ADD
COLUMN`` already takes ACCESS EXCLUSIVE, and the new column is NULL on every
row, so the CHECK validates trivially and the partial index is built empty over
a ledger of a few hundred rows. ``CONCURRENTLY`` would buy no lock relief here
and would add a failure mode that leaves an INVALID unique index behind.
Nullable, no DEFAULT. Every ``op.execute`` is one static literal.

Ordering
========

This revision must be APPLIED before the coord PR (Phase 2) that stores and
reads the column deploys; that coord PR's ``schema.manifest`` bump to this
revision is gated on it being the migrator head. ``down_revision`` is the local
single head at authoring time and is re-pointed, not merged, if another
revision lands first.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overlord_05_label_question_id"
down_revision: str | Sequence[str] | None = "overlord_04_runner_start_and_nudge_time"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Names as data; the migration test pins these against the static SQL below,
# which spells them as STATIC literals because coord's migration classifier can
# only inspect static op.execute literals.
_ADDED_COLUMN: tuple[str, str, str] = (
    "overlord_interventions",
    "label_question_id",
    "UUID",
)
_CHECK_NAME = "ck_overlord_interventions_label_question_relayed"
_INDEX_NAME = "ux_overlord_interventions_label_question"


def upgrade() -> None:
    """Add the column, its comment, its CHECK and its partial unique index."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.overlord_interventions
            ADD COLUMN label_question_id UUID
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.overlord_interventions.label_question_id IS
            'The coord agent question whose operator answer THIS row relayed as '
            'its label (plan 2026-11-02-overlord-one-answer-relays-once-server-'
            'side). Set only on the relaying row '
            '(label_source = ''operator_relayed''); a successor does not '
            'inherit it. Unique per '
            'tenant: an answer relays once. operator_relayed rows written before '
            'the column existed stay NULL and are dated by recorded_at.'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.overlord_interventions
            ADD CONSTRAINT ck_overlord_interventions_label_question_relayed
            CHECK (label_question_id IS NULL
                   OR label_source IS NOT DISTINCT FROM 'operator_relayed')
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX ux_overlord_interventions_label_question
            ON coord.overlord_interventions (tenant_id, label_question_id)
            WHERE label_question_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop the index, the CHECK and the column, in that order."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        DROP INDEX IF EXISTS coord.ux_overlord_interventions_label_question
        """
    )
    op.execute(
        """
        ALTER TABLE coord.overlord_interventions
            DROP CONSTRAINT IF EXISTS
                ck_overlord_interventions_label_question_relayed
        """
    )
    op.execute(
        """
        ALTER TABLE coord.overlord_interventions
            DROP COLUMN IF EXISTS label_question_id
        """
    )
