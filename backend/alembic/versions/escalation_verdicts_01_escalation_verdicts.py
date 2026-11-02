"""coord.escalation_verdicts — the independent "was this answerable?" record

Revision ID: escalation_verdicts_01
Revises: run_outcomes_01
Create Date: 2026-10-13

Phase 3 (qontinui-web half) of plan
``2026-09-20-stop-short-and-unnecessary-escalation-rates-are-counted-from-session-terminal-states``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the table
lands here and must be applied in production BEFORE the coord door that writes
it (``POST /coord/escalation-verdicts``, MCP ``coord_record_escalation_verdict``)
is deployed. ``down_revision`` is this repo's single alembic head at authoring
time. ``alembic-graph-pr.yml`` serialises alembic PRs, so if another revision
lands first, re-point this line at the new head. Do NOT author an ``alembic
merge`` revision.

What the table records
======================

One row per JUDGMENT, made by an agent that did not ask the question, of
whether an operator-audience question was already answerable from the served
policy and intent corpus when it was asked. The plan's D4 makes this an
after-the-fact metric input, never a gate on asking. Its D5 makes independence
structural: coord refuses a verdict whose judge is the session that asked
(``403 self_verdict_forbidden``).

The row is **append-only**. A re-judge INSERTs a new row whose ``supersedes``
names the row it replaces. It never UPDATEs. So every verdict any rate was ever
computed from stays readable, and ``corpus_snapshot`` makes each one
**replayable**: same brief, same document versions, same question, run again.

Column contract — shared with coord ``escalation_judgments.rs``
===============================================================

``id UUID PRIMARY KEY``
    Server-side ``gen_random_uuid()``.

``tenant_id UUID NOT NULL``
    From the caller's verified JWT, never from the body. No FK to
    ``coord.tenants``, the same rationale as the sibling observation tables.

``subject_kind TEXT NOT NULL`` + CHECK ``('question', 'session_close')``
    The plan names exactly these two subjects. ``session_close`` judgments (the
    D2 facets) wait on the plan's Phase 1 terminal-state deriver. The CHECK
    admits the value now so that half needs no second migration, but coord's
    write boundary refuses it until Phase 1 ships.

``subject_id UUID NOT NULL``
    ``coord.agent_questions.question_id`` for a question. There is deliberately
    **no FK**, for two reasons. First, the column is polymorphic over two
    subject tables (``coord.agent_questions`` and, for ``session_close``,
    ``coord.sessions``), and one column cannot reference both. Second, coord
    prunes closed ``coord.sessions`` rows after ``COORD_SESSION_RETENTION_DAYS``
    (default 7; ``main.session_retention_gc``), and a verdict must outlive a
    pruned subject row.

``verdict TEXT NOT NULL``
    For a question: ``answerable_from_corpus | not_answerable | unknown``. This
    is closed at coord's write boundary, NOT by a CHECK here, because the
    ``session_close`` half has not defined its words yet. A CHECK would have to
    be dropped and re-added the day it does.

``citations JSONB NOT NULL DEFAULT '[]'`` + CHECK (a JSON array)
    ``[{kind, name, version, quote, clause_id?}]``. coord refuses an
    ``answerable_from_corpus`` verdict with no citation. It also refuses a
    citation whose ``(kind, name, version)`` does not resolve in
    ``coord.prompt_document_versions``, a version created AFTER the question was
    asked (an answer written later did not answer it), and a quote that does
    not occur in that version's body. All three are mechanical checks.

``corpus_snapshot JSONB NOT NULL`` + CHECK (a JSON object)
    The ``current_version`` of every document the judge consulted. This is what
    makes the verdict replayable, so it is mandatory.

``facets JSONB NULL``
    The D2 facets (``offered_instead_of_taken``,
    ``scope_narrowed_on_own_caution``) for a ``session_close`` subject. NULL on
    every question row.

``judge_agent_session_id UUID NOT NULL``
    The judging agent's Claude Code session id, compared against the asking
    session's ``coord.agent_questions.agent_session_id`` for D5's refusal. NOT
    NULL: a verdict with no judge identity cannot be checked for independence.

``asker_session_resolved BOOLEAN NOT NULL``  ← **no default, deliberately**
    Whether the question named its asking session, so that D5's comparison
    could run. ``false`` means coord could NOT check independence: the
    question's ``agent_session_id`` was NULL. The verdict is still recorded,
    because refusing it would leave about 96% of questions unjudgeable. But a
    ``false`` row is **excluded from the escalation-rate numerators and
    denominators until the asker is attributed**. An unproven-independent
    verdict is UNKNOWN for the rates, never folded in as if independent
    (plan line 387's rule). Autopilot-lead decision, 2026-10-13, under served
    policy ``engineering-priorities`` ``design-tradeoff-ranking`` (#1
    capability, #3 robustness). There is no default so that a writer cannot
    omit it and have it read as either value.

    **Note for Phase 4 (the rates door).** Rows are append-only, so this flag
    is fixed at write time. If the asker is attributed LATER, either a re-judge
    supersedes the row (writing a fresh flag), or the rates door rechecks
    ``coord.agent_questions.agent_session_id`` live instead of trusting this
    column. A live recheck also catches an after-the-fact self-verdict: an
    asker attributed later who turns out to equal ``judge_agent_session_id``.

``judge_model TEXT NOT NULL``, ``brief_version TEXT NOT NULL``
    Which model judged, under which versioned brief. A replay must use the same
    brief to be a replay.

``judged_at TIMESTAMPTZ NOT NULL DEFAULT now()``
    When coord stored the verdict.

``supersedes UUID NULL`` → ``coord.escalation_verdicts(id)``
    The row this re-judgment replaces. A self-FK, so a supersede of a row that
    does not exist is refused by the database as well as by coord. Two partial
    UNIQUE indexes make each subject's verdicts ONE linear chain:

    * at most one ROOT per subject (``supersedes IS NULL``), so a second
      first-judgment of the same question is refused and a re-judge must
      supersede instead;
    * every row superseded at most once, so two concurrent re-judges of the
      same row cannot both land.

    Together they mean "the latest verdict for a subject" is a single row that
    cannot fork, whether the second write is a fresh judgment or a re-judge.

Indexes
=======

* ``ix_escalation_verdicts_tenant_subject`` —
  ``(tenant_id, subject_kind, subject_id, judged_at)``: the "does this subject
  have a verdict" probe behind ``GET /coord/escalation-verdicts/unjudged``, and
  the latest-verdict read the rates door (Phase 4) makes.
* ``uq_escalation_verdicts_subject_root`` — UNIQUE
  ``(tenant_id, subject_kind, subject_id)`` WHERE ``supersedes IS NULL``: one
  root per subject. coord maps a violation to ``409 subject_already_judged``.
* ``uq_escalation_verdicts_supersedes`` — UNIQUE ``(supersedes)`` WHERE
  ``supersedes IS NOT NULL``: one successor per row. coord maps a violation to
  ``409 supersedes_already_superseded``.

Writes **no rows**. There is nothing to backfill: no verdict has ever been
recorded.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "escalation_verdicts_01"
down_revision: str | Sequence[str] | None = "run_outcomes_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the verdict store, its three indexes and its comments. No rows."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.escalation_verdicts (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id               UUID NOT NULL,
            subject_kind            TEXT NOT NULL,
            subject_id              UUID NOT NULL,
            verdict                 TEXT NOT NULL,
            citations               JSONB NOT NULL DEFAULT '[]'::jsonb,
            corpus_snapshot         JSONB NOT NULL,
            facets                  JSONB NULL,
            judge_agent_session_id  UUID NOT NULL,
            asker_session_resolved  BOOLEAN NOT NULL,
            judge_model             TEXT NOT NULL,
            brief_version           TEXT NOT NULL,
            judged_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
            supersedes              UUID NULL,
            CONSTRAINT ck_escalation_verdicts_subject_kind
                CHECK (subject_kind IN ('question', 'session_close')),
            CONSTRAINT ck_escalation_verdicts_citations_is_array
                CHECK (jsonb_typeof(citations) = 'array'),
            CONSTRAINT ck_escalation_verdicts_corpus_snapshot_is_object
                CHECK (jsonb_typeof(corpus_snapshot) = 'object'),
            CONSTRAINT fk_escalation_verdicts_supersedes
                FOREIGN KEY (supersedes)
                REFERENCES coord.escalation_verdicts (id)
                ON DELETE NO ACTION
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_escalation_verdicts_tenant_subject
            ON coord.escalation_verdicts
               (tenant_id, subject_kind, subject_id, judged_at)
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_verdicts_supersedes
            ON coord.escalation_verdicts (supersedes)
         WHERE supersedes IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_verdicts_subject_root
            ON coord.escalation_verdicts (tenant_id, subject_kind, subject_id)
         WHERE supersedes IS NULL
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.escalation_verdicts IS
            'One row per independent judgment of whether an operator-audience '
            'question was answerable from the served corpus when asked. '
            'Append-only: a re-judge inserts a row whose supersedes names the '
            'one it replaces, one linear chain per subject. corpus_snapshot '
            'pins the document versions read, so a verdict is replayable.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.escalation_verdicts.asker_session_resolved IS
            'false = the question named no asking session, so coord could not '
            'check judge independence (D5). Rows with false are EXCLUDED from '
            'the escalation-rate numerators and denominators until the asker '
            'is attributed; they are never counted as independent verdicts.'
        """
    )


def downgrade() -> None:
    """Drop the store and its indexes. Any recorded verdicts go with them."""
    op.execute("DROP INDEX IF EXISTS coord.uq_escalation_verdicts_subject_root")
    op.execute("DROP INDEX IF EXISTS coord.uq_escalation_verdicts_supersedes")
    op.execute("DROP INDEX IF EXISTS coord.ix_escalation_verdicts_tenant_subject")
    op.execute("DROP TABLE IF EXISTS coord.escalation_verdicts")
