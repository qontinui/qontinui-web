"""cciobs 01 — coord.merge_proposals.candidate_ci_observed_at observed-CI memo

Revision ID: cciobs_01
Revises: fleet_res_tel_05_socket_census
Create Date: 2026-09-07

Phase 4a of plan ``2026-09-02-candidate-ci-absence-is-unobserved-not-detected``
(§6 item 1). Adds ``candidate_ci_observed_at TIMESTAMPTZ NULL`` to
``coord.merge_proposals``.

## What it stores

A MEMO that a candidate CI run — a check run or a workflow run — has been
observed on the proposal's candidate ref (``merge-candidate/<proposal_id>``).
The timestamp is the first moment coord saw such a run; it is never cleared by
a later tick and it is not a liveness signal about that run.

## NULL means UNOBSERVED — never "absent"

A NULL row says only that coord has not yet recorded seeing candidate CI for
this proposal. It does NOT say the candidate ref has no CI: the ref may have
been pushed seconds ago, GitHub may not have fired the workflow yet, or coord
may simply not have looked. That is the same reading as served policy
``verification-and-evidence`` ``silent-empty-is-unknown``. The plan exists
because a proposal held a merge slot in ``awaiting-ci`` for 19h with no
candidate CI in existence and nothing could say so; this column is the durable
input that lets the scheduler distinguish "never observed" from "observed and
still running".

## Who writes it, who reads it

Written by coord, from the two places candidate CI is already observed:

* the ``coord.ci_runs`` upsert path, when the run's ``head_branch`` is a
  ``merge-candidate/<proposal_id>`` ref;
* the candidate-CI liveness probe (``probe_candidate_ci_liveness``), when it
  sees a live or completed run.

Read by the ``awaiting-ci`` early existence check in ``advance_awaiting_ci``:
a row still NULL past the first-run grace is the trigger for the existing
classifier to run, routing through the existing ``AbsentRequeue`` /
``PushNeededRequeue`` / ``NoCandidateCiProducer`` arms.

Persisted in the DB rather than kept in a leader-local map so that a failover
does not re-probe every held row and the accompanying metric
(``coord_merge_slots_held_without_candidate_ci{repo}``) has a durable input.

## Two-repo ordering — this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema (served
policy ``production-and-cost`` ``alembic-sole-authorship``; coord's Rust binary
authors zero ``coord.*`` DDL). The coord read of this column DEGRADES on a
missing-column error rather than failing the tick, and the coord PR (Phase 4b)
is labelled downstream of this one, so this migration must land and deploy
before that coord binary ships.

## No index

The column is a nullable timestamp read per proposal row by primary key inside
the scheduler's own tick; nothing scans it, so no index is created.

## Safety

A single ``ADD COLUMN`` that is nullable with no default is a metadata-only
operation on PG >= 11 (no table rewrite); the table is small regardless.
Historical and terminal rows stay NULL — they are closed, and the existence
check only runs for rows in ``awaiting-ci``.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cciobs_01"
down_revision: str | Sequence[str] | None = "fleet_res_tel_05_socket_census"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "merge_proposals",
        sa.Column(
            "candidate_ci_observed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("merge_proposals", "candidate_ci_observed_at", schema="coord")
