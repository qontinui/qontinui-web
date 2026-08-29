"""coord.agent_questions — backfill audience from the question's decision domain

Revision ID: coord_agent_questions_audience_backfill
Revises: cgaudit_01
Create Date: 2026-08-29

Phase D4b of plan ``2026-08-27-escalation-audience-agent-vs-operator``.

``coord_agent_questions_audience`` added the column with every existing row
taking the ``'operator'`` DDL default, deliberately: the backfill was held back
until coord's agent-tier door existed, so that reclassified rows would be
readable by *something* rather than merely invisible. That door has landed
(``GET /coord/agent-questions/agent-pending`` and
``POST /coord/agent-questions/:id/agent/respond``), so this is that backfill.

What it does
============

Applies the same classification coord's writer now applies at INSERT time:
``pr_fix`` and ``red_main_fix`` are operational by construction and go to
``agent``; every other domain keeps ``operator``.

Measured against production at 2026-08-29T13:20:57Z:

===========================  ======
bucket (pending)             rows
===========================  ======
total                        24,296
``pr_fix``                   23,854
``repo_pull``                   430
no domain in text                11
``implementation``                1
``red_main_fix``                  0
===========================  ======

**The counts move continuously** — this table gains 244-1,461 rows/day and has
no autonomous drain — so treat those as a dated snapshot, not a target to
assert against. A re-measure at 13:37Z already read 24,376 total / 23,887
matching.

Scope: ALL rows, not only pending
=================================

The ``UPDATE`` carries no ``responded_at IS NULL``, and that is deliberate:
``audience`` is a property of the row, and the whole point of the column is
that *"how many escalations went to an agent last week"* becomes answerable,
which reads answered rows too. The partial index
``idx_agent_questions_agent_pending`` is defined ``WHERE responded_at IS NULL``,
so including answered rows costs no index churn.

Measured consequence, so this is a stated decision rather than a silent one:
**zero answered rows currently match** the predicate (2026-08-29). The 43-47
rows answered in this table's history are POLICY_GAP questions carrying machine
responders, not domain escalations, so nothing in the answered history is
reclassified today — including the single human-answered row.

Why the predicate is the anchored question TEXT
===============================================

``create_escalation_question`` formats
``'Policy decision required for `<decision_domain>`: <reason>. …'`` at offset
zero, so the domain is read straight back out of the text.

**The pattern is anchored with ``^``, and the anchor is load-bearing.** Without
it, any question merely *containing* the preamble is reclassified — and
``create_agent_question`` questions are hand-authored by ~16 autonomous agents,
write no ``audience`` at all (so they take the ``operator`` default), and an
agent asking *about* this very pile-up quotes the preamble verbatim. That is
the exact shape that would be caught. The error direction is what makes it
matter: it would move a human-addressed row into the queue an agent JWT is
permitted to answer, and ``audience`` is an authorization boundary rather than
a label. Measured on production 2026-08-29: the anchored and unanchored
predicates currently agree exactly (23,887 = 23,887, zero false positives), so
the anchor changes no row today and exists to keep it that way.

``substring(... from '…')`` + ``IN`` is used rather than
``LIKE 'Policy decision required for `pr_fix`:%'`` because ``_`` is a LIKE
wildcard, so the LIKE form would also match a hypothetical ``prXfix`` domain.
Extracting the domain and comparing it with ``IN`` is exact, and mirrors
coord's own classifier (``audience_for_domain``, a lookup over
``AGENT_AUDIENCE_DOMAINS``) rather than approximating it.

The plan originally proposed two "stronger structural discriminators" —
``agent_id = device_id`` and ``agent_session_id IS NULL``. **Both were measured
and both are unsound**, which is why neither appears here: on 2026-08-28
``agent_id = device_id`` held for **23,700 of 23,700** pending rows including
all 11 that are genuine ``create_agent_question`` questions, and
``agent_session_id IS NULL`` held for 23,694 of 23,700.

Rows already ``'agent'`` are excluded, so a re-run is a no-op and this never
fights coord's live writer for a row it has already classified.
``red_main_fix`` is in the predicate although it matches zero rows today: it is
operational by construction and coord's writer will produce such rows, and
omitting it would make the migration disagree with the classifier it mirrors.

What this does NOT establish — read before quoting a number
===========================================================

**1. This is a reclassification, not a drain.** Nothing polls the agent queue.
The plan's census found the fleet's autonomous-consumer count for
``coord.agent_questions`` is zero, and D3 shipped a *door*, not a poller. These
rows become readable by an agent and remain unanswered.

**2. It does not change what the operator sees.** coord's operator inbox door
is unfiltered by audience *on purpose* — ``get_pending`` passes
``PendingAudience::All``, documented as "the operator inbox's historical
behavior, preserved byte-for-byte" — and the console page behind it
(``/admin/coord/questions``) never mentions ``audience``. So after this
migration the operator's rendered inbox still lists every row.

What this migration actually delivers is that the two populations become
**distinguishable**, and the agent-tier door can see its half. Turning that
into a smaller operator inbox needs a filter on the operator door or its
console — which is NOT in this plan, and is recorded as follow-up rather than
smuggled in here.

Locking
=======

Pure DML: a single ``UPDATE`` taking ROW EXCLUSIVE, which does not block
readers and does not conflict with the producers' ``INSERT``s. Following
``coord_plan_pr_citations_3a_backfill`` — *"no ACCESS EXCLUSIVE is taken and no
``lock_timeout`` is needed"* — this revision sets **no** ``lock_timeout``. The
sibling ``coord_agent_questions_audience`` does set one, but its justification
was a queued ACCESS EXCLUSIVE request blocking everyone behind it, and that
does not transfer to DML. Copying it here would actively invert the risk:
``env.py`` wraps the whole run in ONE transaction, so a 3s timeout tripped by a
single concurrent row lock would roll back *every* revision in the upgrade and
fail the migrate job, where waiting would simply have succeeded.

Concurrency is safe by inspection of coord ``origin/main``: every concurrent
writer to this table is a single-row ``UPDATE … WHERE question_id = $n`` in
autocommit, with no bulk sweep and no ``SELECT … FOR UPDATE``, so a peer holds
exactly one row lock and deadlock is not reachable. Rows inserted after this
statement's snapshot are already classified by the live writer.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_questions_audience_backfill"
down_revision: str | Sequence[str] | None = "cgaudit_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The domains coord's own classifier treats as agent-audience
# (`AGENT_AUDIENCE_DOMAINS` = [PR_FIX_DOMAIN, RED_MAIN_FIX_DOMAIN]).
_AGENT_DOMAINS = "('pr_fix', 'red_main_fix')"

# Pulls `<domain>` out of "Policy decision required for `<domain>`: ...".
# ANCHORED: see "Why the predicate is the anchored question TEXT" above — the
# `^` is what stops a hand-authored question that merely QUOTES the preamble
# from being moved into the agent-answerable queue.
_DOMAIN_EXPR = "substring(question from '^Policy decision required for `([^`]+)`')"


def upgrade() -> None:
    """Classify existing escalations by the domain named in their question."""
    op.execute(
        f"""
        UPDATE coord.agent_questions
           SET audience = 'agent'
         WHERE audience = 'operator'
           AND {_DOMAIN_EXPR} IN {_AGENT_DOMAINS}
        """
    )


def downgrade() -> None:
    """Deliberately a no-op.

    Following ``coord_alerts_subject_tenant_backfill_01``, the nearest house
    precedent — the same shape (a one-time backfill mirroring a live producer's
    derivation) and the same reasoning: reversing would destroy the derived
    classification without restoring any previous behavior.

    A naive inverse is worse than nothing here, and not merely inelegant.
    ``upgrade()`` guards on ``audience = 'operator'``, so it leaves alone any
    ``pr_fix`` row that coord's live writer had ALREADY classified ``agent``.
    An inverse keyed on ``audience = 'agent'`` has no matching guard, so it
    would set those rows — every ``pr_fix`` escalation written since the column
    landed, at 244-1,461 rows/day — to ``operator``, a value they never held.
    That is data loss dressed as a rollback.

    To genuinely undo this, re-derive from the classifier rather than inverting
    this statement.
    """
