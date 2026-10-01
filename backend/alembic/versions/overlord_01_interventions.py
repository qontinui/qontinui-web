"""coord.overlord_interventions — the overlord's append-only intervention ledger

Revision ID: overlord_01_interventions
Revises: coordinput_01_operator_inputs
Create Date: 2026-10-01

Phase 2 of plan
``2026-10-01-overlord-session-supervisor-classifies-stops-and-absorbs-avoidable-escalations``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
table lands here, in qontinui-web, and must merge BEFORE the coord PR whose
``POST /coord/overlord/interventions`` and ``GET /coord/overlord/interventions``
routes read and write it. Until it is deployed, coord answers those routes with
a typed schema-not-ready refusal rather than a 500.

The re-point rule
=================

``down_revision`` is this repo's LOCAL single alembic head at authoring time,
and is deliberately NOT pinned to it: ``alembic-graph-pr.yml`` serialises
alembic PRs by construction, so every revision that lands ahead of this one
re-forks the chain and this line is re-pointed at the new head. Re-point it; do
NOT author an ``alembic merge`` revision (this revision has not landed, so
re-pointing leaves nothing behind, while a merge revision is permanent
bookkeeping), and do NOT hand-order it with coord dependency labels — the graph
gate owns this ordering, not coord.

The gap
=======

The overlord is a runner looping agent that sits in the operator's seat: when a
session stops (idle at an empty prompt, a pending question, a turn that handed
control back) it assigns the stop exactly one class from the plan's stop
taxonomy and answers it — leave it alone, nudge it with the clause that already
covers it, tell it to hand one step off, escalate, close it, or replace it.

None of that is recorded anywhere today. ``coord.operator_touches`` records that
a HUMAN was touched; it has no row for a stop that the overlord answered so that
no human was touched, and no row for what the overlord *would* have done while
it runs in shadow. So three questions the plan's go-live rule (D6) depends on
are unanswerable:

* How often did the overlord's judgment agree with the operator's? (D5/D6 —
  each verb goes live only on measured agreement against ``operator_label``.)
* Did the nudge work? (``outcome`` — did the session resume, do the work, or
  escalate anyway.)
* Which operator touches did the overlord absorb? (D4 — derived from this
  ledger's ``touch_key`` join, NOT from a column on ``coord.operator_touches``:
  one writer per fact.)

This table is that record.

Append-only, and how a row is "updated"
=======================================

Nothing updates or deletes a row. An intervention is a CHAIN of rows sharing one
``intervention_id``:

* The first row is the judgment itself. Its ``intervention_id`` is its own
  ``id`` and its ``supersedes`` is NULL. coord mints the id in Rust and writes it
  into both columns in one INSERT.
* A later observation — the outcome once the session's next turn is seen, or the
  operator's label from the Phase 5 page — is a NEW row with the same
  ``intervention_id`` and ``supersedes`` = the prior row's ``id``. It carries the
  full judgment forward, so the newest row of a chain is always a complete
  statement of the intervention as currently understood.

``ck_overlord_interventions_chain_root`` pins that shape in the schema: a row is
a chain root (``supersedes IS NULL``) exactly when ``intervention_id = id``. So a
root that names another intervention, and a successor that claims to be its own
chain, are both unrepresentable. Same-tenant and same-chain ``supersedes`` are
coord's write-boundary checks (a 422), since a CHECK cannot read another row and
an FK would forbid nothing useful here.

The read model is "newest row per ``intervention_id``, with the chain as
``history``" — the ``(tenant_id, intervention_id, recorded_at DESC)`` index is
that read.

Column contract — the shared contract with coord's Rust code
============================================================

``id UUID PRIMARY KEY``
    ``gen_random_uuid()`` default, but coord supplies it on every insert so a
    chain root can name itself.

``intervention_id UUID NOT NULL``
    The chain key. Equals ``id`` on the root row.

``supersedes UUID NULL``
    The prior row's ``id`` in the same chain; NULL on the root. No FK: the
    chain is append-only and coord validates it at the write boundary.

``tenant_id UUID NOT NULL``
    From the caller's verified JWT, never the request body. No FK to
    ``coord.tenants``, matching ``coord.operator_touches``: an observation log
    must never fail an insert for referential bookkeeping.

``session_id UUID NULL`` / ``claude_code_session_id UUID NULL``
    The coord session and the Claude Code session the stop belonged to.
    **NULL means "not proven", never "no session"** — the same reading as
    ``coord.operator_touches.session_id``. No FK to ``coord.sessions``: the
    ledger must outlive the 7-day closed-session prune, because calibration
    (D5) reads interventions long after the session they were about is gone.

``observed_at TIMESTAMPTZ NOT NULL DEFAULT now()``
    When the overlord observed the stop. Caller-supplied when known.

``recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()``
    When this ROW was written. Server-stamped; it orders a chain.

``stop_class TEXT NOT NULL`` — CHECK ``A`` | ``B`` | ``C`` | ``D`` | ``E`` | ``F`` | ``U``
    The plan's stop taxonomy: false escalation, agent-restricted, operator
    decision, waiting on an observable, finished, stuck/looping, unknown.

``strike SMALLINT NULL`` — CHECK ``0..2``
    The two-strike rule's position (0 = catalog match, 1 = proof-demanding
    nudge, 2 = graded reply). NULL for classes the rule does not apply to.

``catalog_hits JSONB NOT NULL DEFAULT '[]'``
    Restricted-action catalog entries (Phase 1) the blocker matched.

``evidence JSONB NOT NULL DEFAULT '{}'``
    The judgment's replayable inputs (D2): transcript-tail digest, clause
    versions consulted, catalog version. Size-bounded by coord.

``inputs_unreadable TEXT[] NOT NULL DEFAULT '{}'``
    What could not be read. Non-empty is what a class-``U`` row exists to say.

``verb TEXT NOT NULL`` — CHECK ``leave`` | ``nudge`` | ``handoff-prompt`` |
``gate-register-nudge`` | ``escalate`` | ``finish+close`` | ``spawn`` | ``redirect``
    What the overlord did — or, in shadow, would have done.

``mode TEXT NOT NULL`` — CHECK ``shadow`` | ``live``
    Whether the verb was actually executed. D6 graduates each verb from shadow
    to live separately, on measured agreement.

``message_id`` / ``question_id UUID NULL``, ``touch_key TEXT NULL``
    Joins to what the verb produced: the coord message sent, the operator
    question raised, and the ``coord.operator_touches`` idempotency key of the
    touch this intervention absorbed (D4).

``outcome TEXT NULL`` — CHECK ``resumed`` | ``did_work`` | ``escalated`` |
``closed`` | ``no_change`` | ``unknown``
    What followed. NULL until observed — NULL is the only honest value before.

``outcome_observed_at TIMESTAMPTZ NULL``
    When the outcome was observed.

``operator_label TEXT NULL`` — CHECK ``A`` .. ``F``
    The operator's verdict on the class (Phase 5's label loop). There is no
    ``U`` label: an operator who reads the stop has, by construction, read it.

``brief_version TEXT NULL`` / ``judge_model TEXT NULL``
    Which overlord brief and model made the judgment, so agreement can be
    measured per brief version.

``recorded_by_device_id UUID NULL``
    The device the writing JWT named. From the JWT, never the body; NULL for a
    non-device token.

Why the vocabularies ARE CHECK-constrained here
===============================================

``coord.operator_touches`` deliberately leaves its reason-code vocabulary
unconstrained because Phase 3 of that plan grows it from data. This ledger's
vocabularies are the opposite kind: they are the plan's normative taxonomy
(``stop_class``), the overlord's closed verb set, and the go-live switch
(``mode``). A new class or verb is a design change that must move the plan,
coord's write boundary and this schema together, and a stray value would
silently fall outside every agreement rate D6 computes. The plan names them
CHECK-constrained vocabularies, so they are. coord validates the same sets in
Rust first, so a bad value is a 422 naming the field rather than a constraint
violation.

Indexes
=======

Every index is tenant-first, because every read is tenant-scoped.

* ``(tenant_id, intervention_id, recorded_at DESC)`` — newest row per chain,
  and the chain as history.
* ``(tenant_id, observed_at DESC)`` — the feed, newest first.
* ``(tenant_id, session_id)`` — every intervention one session received.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "overlord_01_interventions"
down_revision: str | Sequence[str] | None = "coordinput_01_operator_inputs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the ledger + its indexes. No rows."""
    # Raw ``op.execute`` with IF NOT EXISTS throughout — the convention the
    # sibling coord observation tables use, and what keeps a re-run harmless.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.overlord_interventions (
            id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            intervention_id        UUID NOT NULL,
            supersedes             UUID NULL,
            tenant_id              UUID NOT NULL,
            session_id             UUID NULL,
            claude_code_session_id UUID NULL,
            observed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
            recorded_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
            stop_class             TEXT NOT NULL,
            strike                 SMALLINT NULL,
            catalog_hits           JSONB NOT NULL DEFAULT '[]'::jsonb,
            evidence               JSONB NOT NULL DEFAULT '{}'::jsonb,
            inputs_unreadable      TEXT[] NOT NULL DEFAULT '{}'::text[],
            verb                   TEXT NOT NULL,
            mode                   TEXT NOT NULL,
            message_id             UUID NULL,
            question_id            UUID NULL,
            touch_key              TEXT NULL,
            outcome                TEXT NULL,
            outcome_observed_at    TIMESTAMPTZ NULL,
            operator_label         TEXT NULL,
            brief_version          TEXT NULL,
            judge_model            TEXT NULL,
            recorded_by_device_id  UUID NULL,
            CONSTRAINT ck_overlord_interventions_stop_class
                CHECK (stop_class IN ('A', 'B', 'C', 'D', 'E', 'F', 'U')),
            CONSTRAINT ck_overlord_interventions_strike
                CHECK (strike IS NULL OR strike BETWEEN 0 AND 2),
            CONSTRAINT ck_overlord_interventions_verb
                CHECK (verb IN ('leave', 'nudge', 'handoff-prompt',
                                'gate-register-nudge', 'escalate',
                                'finish+close', 'spawn', 'redirect')),
            CONSTRAINT ck_overlord_interventions_mode
                CHECK (mode IN ('shadow', 'live')),
            CONSTRAINT ck_overlord_interventions_outcome
                CHECK (outcome IS NULL OR outcome IN ('resumed', 'did_work',
                                                      'escalated', 'closed',
                                                      'no_change', 'unknown')),
            CONSTRAINT ck_overlord_interventions_operator_label
                CHECK (operator_label IS NULL
                       OR operator_label IN ('A', 'B', 'C', 'D', 'E', 'F')),
            CONSTRAINT ck_overlord_interventions_chain_root
                CHECK ((supersedes IS NULL) = (intervention_id = id))
        )
        """
    )
    # Newest row per chain, and the chain itself as history.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_overlord_interventions_tenant_chain
            ON coord.overlord_interventions
               (tenant_id, intervention_id, recorded_at DESC)
        """
    )
    # The feed: a tenant's interventions, newest observation first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_overlord_interventions_tenant_observed_at
            ON coord.overlord_interventions (tenant_id, observed_at DESC)
        """
    )
    # Per-session lineage. A NULL session simply does not match, which is
    # correct — an unattributed intervention answers for no session.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_overlord_interventions_tenant_session
            ON coord.overlord_interventions (tenant_id, session_id)
        """
    )


def downgrade() -> None:
    """Drop the ledger + its indexes. Any recorded rows go with it."""
    op.execute("DROP INDEX IF EXISTS coord.ix_overlord_interventions_tenant_session")
    op.execute(
        "DROP INDEX IF EXISTS coord.ix_overlord_interventions_tenant_observed_at"
    )
    op.execute("DROP INDEX IF EXISTS coord.ix_overlord_interventions_tenant_chain")
    # DROP TABLE takes every CHECK constraint with it.
    op.execute("DROP TABLE IF EXISTS coord.overlord_interventions")
