"""coord.overlord_interventions — the four-class vocabulary and label provenance

Revision ID: overlord_02_four_class_vocabulary
Revises: replident_01
Create Date: 2026-10-17

Phase 2b of plan
``2026-10-01-overlord-session-supervisor-classifies-stops-and-absorbs-avoidable-escalations``
(revision 4, items 5 and 6). Web FIRST: coord authors zero DDL
(``[policy: alembic-sole-authorship]``), and the coord validator that admits the
new vocabulary reads these columns.

The re-point rule
=================

``down_revision`` is this repo's single alembic head at authoring time. If
another revision lands ahead of this one, re-point it at the new head; do NOT
author an ``alembic merge`` revision.

What changes
============

* ``legacy_class BOOLEAN NOT NULL DEFAULT false`` marks a row that predates the
  four-class vocabulary (A, B, E, U). The migration sets it ``true`` on every
  existing row whose ``stop_class`` or ``operator_label`` is C, D or F. That
  marks provenance and changes no judgment: the row keeps its letter, because
  the ledger is append-only and the legacy mapping is applied by read, never by
  rewrite. The migration logs the count it marked. coord never accepts
  ``legacy_class`` from a request body.
* ``stop_class`` admits C, D, F only on a ``legacy_class`` row; ``operator_label``
  likewise, and its new-row set is A, B, E.
* ``outcome`` adds ``queued`` (a message receipt with no delivery or ack yet),
  ``reopened`` (a re-check gate reopened a session after an executed finish) and
  ``finished`` (the finish half executed and was read back, the process not
  closed; ``closed`` stays reserved for the Phase 6 close).
* ``label_kind`` (``class`` | ``false_finish``) says what an operator label is
  about; ``label_source`` says who wrote it. coord derives ``label_source`` from
  the principal and never accepts it from the body. Existing labelled rows are
  backfilled ``label_kind = 'class'``, ``label_source = 'unknown'``.
* ``recorded_by_user_id`` is set only when the writing principal is an operator
  USER session. A device JWT carries a ``user_id`` too, but that is the
  device's bound user and not proof of who acted, so it stays NULL there.
* ``recorded_by_agent_id`` is the agent id from an agent token.
* ``executed`` promotes the brief's top-level flag. NULL means a pre-2b row.

Append-only
===========

The two UPDATEs below are the only in-place writes ever made to this table.
They touch only the new provenance columns and never a judgment column.

The eight verbs ``ck_overlord_interventions_verb`` pins are unchanged:
``leave``, ``nudge``, ``handoff-prompt``, ``gate-register-nudge``, ``escalate``,
``finish+close``, ``spawn``, ``redirect``.
"""

import logging
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "overlord_02_four_class_vocabulary"
down_revision: str | Sequence[str] | None = "replident_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

# No row observed at or after this instant can claim legacy status.
_LEGACY_CUTOFF = "2026-10-17T22:00:00+00"

_TABLE = "coord.overlord_interventions"


def upgrade() -> None:
    """Add the provenance columns, backfill them, swap the CHECKs."""
    op.execute(
        f"""
        ALTER TABLE {_TABLE}
            ADD COLUMN IF NOT EXISTS legacy_class BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS label_kind TEXT NULL,
            ADD COLUMN IF NOT EXISTS label_source TEXT NULL,
            ADD COLUMN IF NOT EXISTS recorded_by_user_id UUID NULL,
            ADD COLUMN IF NOT EXISTS recorded_by_agent_id UUID NULL,
            ADD COLUMN IF NOT EXISTS executed BOOLEAN NULL
        """
    )

    # The first of the two in-place writes: mark provenance, never a judgment.
    bind = op.get_bind()
    marked = bind.exec_driver_sql(
        f"""
        UPDATE {_TABLE}
           SET legacy_class = true
         WHERE stop_class IN ('C', 'D', 'F')
            OR operator_label IN ('C', 'D', 'F')
        """
    ).rowcount
    logger.info("overlord_02: marked %s existing row(s) legacy_class", marked)

    # The second: every existing label is a class label of unknown source.
    labelled = bind.exec_driver_sql(
        f"""
        UPDATE {_TABLE}
           SET label_kind = 'class', label_source = 'unknown'
         WHERE operator_label IS NOT NULL
           AND label_kind IS NULL
        """
    ).rowcount
    logger.info("overlord_02: backfilled %s existing label(s)", labelled)

    op.execute(
        f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS ck_overlord_interventions_stop_class"
    )
    op.execute(
        f"""
        ALTER TABLE {_TABLE}
            ADD CONSTRAINT ck_overlord_interventions_stop_class
            CHECK (stop_class IN ('A', 'B', 'E', 'U')
                   OR (legacy_class AND stop_class IN ('C', 'D', 'F')))
        """
    )

    op.execute(
        f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS ck_overlord_interventions_operator_label"
    )
    op.execute(
        f"""
        ALTER TABLE {_TABLE}
            ADD CONSTRAINT ck_overlord_interventions_operator_label
            CHECK (operator_label IS NULL
                   OR operator_label IN ('A', 'B', 'E')
                   OR (legacy_class AND operator_label IN ('C', 'D', 'F')))
        """
    )

    op.execute(
        f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS ck_overlord_interventions_outcome"
    )
    op.execute(
        f"""
        ALTER TABLE {_TABLE}
            ADD CONSTRAINT ck_overlord_interventions_outcome
            CHECK (outcome IS NULL OR outcome IN ('resumed', 'did_work',
                                                  'escalated', 'closed',
                                                  'no_change', 'unknown',
                                                  'queued', 'reopened',
                                                  'finished'))
        """
    )

    op.execute(
        f"""
        ALTER TABLE {_TABLE}
            ADD CONSTRAINT ck_overlord_interventions_label_kind
            CHECK (label_kind IS NULL OR label_kind IN ('class', 'false_finish')),
            ADD CONSTRAINT ck_overlord_interventions_label_source
            CHECK (label_source IS NULL
                   OR label_source IN ('operator_page', 'operator_relayed',
                                       'recheck_gate', 'agent', 'unknown')),
            ADD CONSTRAINT ck_overlord_interventions_label_has_kind
            CHECK (operator_label IS NULL OR label_kind IS NOT NULL),
            ADD CONSTRAINT ck_overlord_interventions_class_kind_has_label
            CHECK (label_kind IS DISTINCT FROM 'class' OR operator_label IS NOT NULL),
            ADD CONSTRAINT ck_overlord_interventions_kind_has_source
            CHECK (label_kind IS NULL OR label_source IS NOT NULL),
            ADD CONSTRAINT ck_overlord_interventions_false_finish_not_e
            CHECK (NOT (label_kind = 'false_finish' AND operator_label = 'E')),
            ADD CONSTRAINT ck_overlord_interventions_legacy_cutoff
            CHECK (NOT legacy_class OR observed_at < '{_LEGACY_CUTOFF}'::timestamptz)
        """
    )


def downgrade() -> None:
    """Restore the Phase 2 vocabulary. New-vocabulary-only rows block it."""
    for name in (
        "ck_overlord_interventions_legacy_cutoff",
        "ck_overlord_interventions_false_finish_not_e",
        "ck_overlord_interventions_kind_has_source",
        "ck_overlord_interventions_class_kind_has_label",
        "ck_overlord_interventions_label_has_kind",
        "ck_overlord_interventions_label_source",
        "ck_overlord_interventions_label_kind",
        "ck_overlord_interventions_outcome",
        "ck_overlord_interventions_operator_label",
        "ck_overlord_interventions_stop_class",
    ):
        op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS {name}")

    op.execute(
        f"""
        ALTER TABLE {_TABLE}
            ADD CONSTRAINT ck_overlord_interventions_stop_class
            CHECK (stop_class IN ('A', 'B', 'C', 'D', 'E', 'F', 'U')),
            ADD CONSTRAINT ck_overlord_interventions_operator_label
            CHECK (operator_label IS NULL
                   OR operator_label IN ('A', 'B', 'C', 'D', 'E', 'F')),
            ADD CONSTRAINT ck_overlord_interventions_outcome
            CHECK (outcome IS NULL OR outcome IN ('resumed', 'did_work',
                                                  'escalated', 'closed',
                                                  'no_change', 'unknown'))
        """
    )
    op.execute(
        f"""
        ALTER TABLE {_TABLE}
            DROP COLUMN IF EXISTS executed,
            DROP COLUMN IF EXISTS recorded_by_agent_id,
            DROP COLUMN IF EXISTS recorded_by_user_id,
            DROP COLUMN IF EXISTS label_source,
            DROP COLUMN IF EXISTS label_kind,
            DROP COLUMN IF EXISTS legacy_class
        """
    )
