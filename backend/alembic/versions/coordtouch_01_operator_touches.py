"""coord.operator_touches — one unified store for every time an agent needed a human

Revision ID: coordtouch_01
Revises: ffland_headsync_01
Create Date: 2026-08-27

Phase 1 of plan ``2026-08-27-instrument-operator-touch-events`` (VETTED
2026-08-27).

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the two
tables land here, in qontinui-web, and must merge BEFORE the coord PR that
writes to them. ``down_revision`` is this repo's LOCAL single alembic head at
authoring time (``ffland_headsync_01``, the head of the 510-revision chain);
``alembic-graph-pr.yml`` enforces the single chain — do NOT hand-order this
with coord dependency labels.

The gap
=======

The fleet's whole autonomy claim rests on a number nobody can compute: how
often does an agent stop short and make a human do something? The evidence for
that number exists, but it is scattered across stores that were each built for
a different purpose and share no vocabulary:

* ``coord.agent_questions`` — an agent hit an ``AskUserQuestion`` checkpoint.
  Knows the question and the answer; knows nothing about whether asking was
  *authorized*.
* ``coord.gates`` — an agent registered a blocking condition. Knows the
  predicate and the clearance, and mixes operator-cleared gates (a human did
  something) with agent-cleared ones (nobody was touched) in one table.
* The runner's permission prompts, idle-at-prompt stalls and session exits —
  recorded nowhere durable at all.

So "what fraction of sessions finished without touching a human?" is not merely
unanswered, it is **unanswerable**, and every claim about it to date has been
an anecdote. This table is the instrumentation that makes it answerable; Phase
5's baseline and Phase 6's ranked operator feed both read it.

What this migration does
========================

1. Creates ``coord.operator_touches``: one **append-only** row per operator
   touch, written best-effort off the observing path.
2. Creates ``coord.operator_touch_classifications``: an append-only audit of
   every Phase 3 enrichment of a touch's classification.
3. **Backfills** ``coord.operator_touches`` from the two partial ledgers that
   already exist (``coord.agent_questions`` and the operator-cleared subset of
   ``coord.gates``), idempotently.

Why the backfill is part of this revision
=========================================

The plan's original premise — "the fleet records nothing" — was corrected at
vet: it records *partially*, in two places, and has done so for months. If the
store started empty, Phase 5's baseline would open at zero touches and then
climb as instrumentation landed, which reads as a regression in exactly the
metric the plan exists to improve. Worse, it would be a dishonest zero: the
history is right there and discarding it is a choice, not a limitation.

So the backfill runs inside ``upgrade()``. It is ``ON CONFLICT
(idempotency_key) DO NOTHING`` throughout — re-running it, or running it
against rows a live coord has meanwhile emitted for the same events, changes
nothing. Each half is additionally guarded on its source table (and, for
``coord.gates``, on the clearance columns) actually existing: PL/pgSQL plans a
statement on first execution rather than at block compile, so an early
``RETURN`` means a missing column is never referenced. A fresh database built
by ``alembic upgrade head`` will always have both sources — they are earlier in
this same chain — but a partially-migrated one is not a reason to abort.

Column contract — ``coord.operator_touches``
============================================

The column set is a shared contract with the coord Rust code that will emit
into it. The names must not drift from this list.

``touch_id UUID PRIMARY KEY``
    Server-side ``gen_random_uuid()`` default. Nothing addresses a touch by
    this id from outside — it exists so an append-only log has a stable primary
    key, and so a duplicate insert is impossible to confuse with an update.
    Cross-row references (the classification sidecar) use it.

``tenant_id UUID NOT NULL``
    Every touch is tenant-scoped at the source: the tenant comes from the
    caller's verified JWT, never from an argument. A touch that cannot name its
    tenant is a touch of nothing, so this is NOT NULL — unlike ``session_id``
    below, there is no honest "unknown tenant" state to represent.

    Deliberately **no FK to** ``coord.tenants``, matching the sibling
    observation tables (``coord.session_policy_reads`` states the same
    rationale): this is an observation log on a hot path, and a best-effort
    insert must never fail for referential bookkeeping.

``session_id UUID NULL``  ← **NULL is a first-class value**
    Which agent session was touched. **Nullable, and NULL means "coord could
    not PROVE which session this was" — never "no session".**

    The same fail-closed reasoning as ``coord.session_policy_reads
    .claude_session_id``: the session id reaches coord as a caller-supplied
    header, which is spoofable, so it counts only when coord can confirm the
    named session is bound to the device the verified JWT names. Two cases
    survive that gate with no proven id and BOTH write NULL: a non-device token
    (nothing to bind to), and a header naming a session not bound to the
    calling device.

    The rejected alternative was a ``(device, tenant) → most-recent-session``
    bridge to fill those NULLs. coord's own source rejects it in terms: it
    names the WRONG parent under concurrent sessions, which is this fleet's
    normal state. **Consumers must read NULL as Unavailable, never as Absent.**
    A stop-short rate that silently attributes unprovable touches to a guessed
    session is worse than one that reports its own blind spot.

``device_id UUID NULL``
    Which device hosted the touched session. Best-effort and nullable for the
    same reason: a non-device token has none.

``kind TEXT NOT NULL``
    What class of touch this was. The vocabulary at authoring time:

    * ``question`` — an agent asked the operator a question and waited.
    * ``gate`` — an agent registered a gate an operator had to clear.
    * ``permission_prompt`` — the harness asked the operator to approve a tool
      call. The agent did not choose to stop; the harness stopped it.
    * ``idle_at_prompt`` — a session sat at an input prompt with no agent
      activity. Nobody asked for anything; the session simply stopped and a
      human had to notice.
    * ``session_exit`` — a session ended with work incomplete, so the next move
      belonged to a human.
    * ``merge_escalation`` — the merge train could not decide and escalated.

``reason_code TEXT NOT NULL DEFAULT 'unclassified'``
    WHY the touch happened, at a finer grain than ``kind``. Every row starts
    ``'unclassified'``; Phase 3's enrichment pass assigns the real code and
    records the move in the sidecar table below.

``policy_authorized TEXT NOT NULL DEFAULT 'unknown'``  ← **tri-state, not a boolean**
    Whether fleet policy actually *permitted* this escalation:
    ``'yes'`` / ``'no'`` / ``'unknown'``.

    A boolean would be the obvious modelling choice and it would be wrong.
    ``unknown`` is not an edge case here, it is the **common case at emit
    time**: the emitting path sees that a human was touched, it does not see
    whether ``escalation-bar``'s closed list covered the reason. Authorization
    is a Phase 3 judgement made later, against a policy document, and possibly
    revised. Collapsing that into a boolean forces the emitter to pick ``false``
    (manufacturing policy violations out of missing information) or ``true``
    (hiding real ones). Both are fabrications; ``unknown`` is the truth.

    This matters downstream: the plan is explicit that an **authorized**
    escalation must NOT be counted as avoidable. A metric that cannot
    distinguish "authorized" from "not yet assessed" cannot honour that.

``source TEXT NOT NULL``
    Provenance of the ROW — not of the touch. Added at vet precisely so a
    backfilled row can never be mistaken for an observed one:

    * ``runner_hook`` — observed live by the runner as it happened.
    * ``agent_questions`` — reconstructed by this migration from
      ``coord.agent_questions``.
    * ``gates`` — reconstructed by this migration from ``coord.gates``.
    * ``merge_decisions`` — derived from the merge train's escalations.
    * ``enrichment`` — created by a later analysis pass rather than observed.

    Any rate computed over this table should be able to say which rows it was
    computed from, because a backfilled row's timestamps come from a store
    built for another purpose and its fidelity is not the same.

``emitted_at TIMESTAMPTZ NOT NULL DEFAULT now()``
    When the touch began — when the human first had something to do. Defaulted
    server-side so a client clock cannot skew the ordering that every read
    depends on.

``resolved_at TIMESTAMPTZ NULL``
    When the touch ended. NULL while the touch is still open.

    **Wait duration is DERIVED from these two columns and is NEVER stored.**
    There is deliberately no ``wait_seconds``. A stored duration is a
    denormalization that goes stale the moment either timestamp is corrected,
    and it forces the writer to invent a value for a still-open touch — which
    would put a fabricated number in the column that Phase 5 reports. An open
    touch has an unknown duration, and ``NULL - timestamp`` is NULL, which is
    exactly the right answer.

``resolution TEXT NULL``
    How the touch ended: ``'answered'`` (a human acted), ``'timed_out'``,
    ``'abandoned'`` (nobody ever acted and the context is gone),
    ``'self_resolved'`` (the condition cleared without a human). NULL while
    the touch is open — and NULL is the ONLY honest value for an open touch.

``work_unit_id UUID NULL`` / ``gate_id UUID NULL``
    Nullable joins to whatever the touch was about. No FK, same hot-path
    rationale as ``tenant_id``; and a touch outlives the gate it was about.

``idempotency_key TEXT NOT NULL`` + UNIQUE  ← **load-bearing**
    The plan's own Risks section names double-counting as the primary threat,
    for two independent reasons: the runner and the agent can both observe a
    single touch, and this migration's backfill can collide with a live coord
    already emitting for the same events. A UNIQUE key with ``ON CONFLICT DO
    NOTHING`` is what makes both harmless.

    The key must be **deterministic** — derivable from the event alone, by
    either observer, without coordination. The grammar, which the Rust side
    must derive identically:

    * ``question:<question_id>`` — from ``coord.agent_questions.question_id``.
    * ``gate:<gate_id>`` — from ``coord.gates.gate_id``.
    * ``<session_id>:<kind>:<epoch-bucket>`` — for runner-observed touches with
      no natural id (``permission_prompt``, ``idle_at_prompt``,
      ``session_exit``). ``epoch-bucket`` is the touch's start time floored to a
      fixed bucket, so two observers whose clocks differ by less than the bucket
      collapse to one row. The bucket is a *deduplication window*, not a
      timestamp; ``emitted_at`` remains the record of when it happened.

    NOT NULL rather than nullable-with-a-partial-unique-index: a row with no
    key is a row that can be duplicated, and there is no touch for which a key
    cannot be constructed.

No CHECK constraints on the vocabulary columns — deliberately
=============================================================

``kind``, ``reason_code``, ``policy_authorized`` and ``resolution`` are plain
``TEXT NOT NULL`` / ``TEXT NULL`` with **no CHECK**. This is a vetted decision
and a reviewer will otherwise reasonably ask about it, so the reasoning is
recorded here rather than left to be re-derived:

* It is the pattern ``coord.work_units.status`` already uses — opaque ``TEXT
  NOT NULL``, no CHECK, vocabulary enforced in Rust
  (``work_unit_registry.rs:1328-1352``). That table has lived with a growing
  status vocabulary and the absence of a CHECK is why it could.
* **Phase 3 exists to extend the reason-code vocabulary as the data shows what
  is actually happening.** That is the point of the phase. With a CHECK, every
  newly-discovered reason code becomes a schema migration that must land in
  qontinui-web and deploy before coord may write the value — turning a
  ten-minute analysis insight into a cross-repo release. The vocabulary would
  stop growing, and the metric would stop learning.
* An observation log records **what happened**, including things the schema
  author did not anticipate. A rejected write here is a lost observation, and
  losing observations is the failure mode this whole plan is against.

``source`` is different and DOES carry a CHECK: it is a closed set naming the
writers *in this codebase*, it does not grow from data, and a bad value there
silently poisons every provenance-filtered rate. It is dropped-then-added below
so a re-run converges on the current vocabulary.

Indexes
=======

Every index is tenant-first, because every read of this table is tenant-scoped.

* ``uq_operator_touches_idempotency_key`` — UNIQUE on ``(idempotency_key)``.
  The dedup contract above; also the conflict target of both backfill halves.
* ``(tenant_id, emitted_at DESC)`` — the rate window and the operator feed.
* ``(tenant_id, reason_code, emitted_at DESC)`` — Phase 6's ranked-by-reason
  read ("what is touching humans most this week?").
* ``(tenant_id, session_id)`` — per-session lineage: every touch one session
  incurred.
* ``(tenant_id, emitted_at DESC) WHERE resolved_at IS NULL`` — partial, for the
  "still open" read and for collapsing a wedged session. Partial keeps it
  proportional to what is *open* rather than to everything that ever happened,
  which on an append-only log is the difference between a small index and an
  unbounded one.

``coord.operator_touch_classifications`` — why a sidecar
========================================================

Without it, ``stop-short-rate`` is a metric its own subjects can silently edit.
An enrichment call could move a touch out of an avoidable reason code, or flip
``policy_authorized`` from ``no`` to ``yes``, and nothing would show the prior
value or who changed it — the rate would improve and the improvement would be
indistinguishable from the work actually getting better. That is not a
hypothetical failure mode for a metric an agent fleet reports about itself.

The shape mirrors the shipped ``coord.work_unit_status_history``: append-only,
FK to the parent with ``ON DELETE CASCADE``, ``from_``/``to_`` pairs, a
timestamp and an actor. ``from_*`` columns are nullable because the first
classification of a row has no prior value to record beyond the defaults, and
``to_*`` are nullable because an enrichment pass may move one axis and leave
the other alone — NULL there means "this pass did not touch this axis", which
is not the same as "this pass set it to nothing".

Append-only
===========

Nothing updates or deletes a row in either table. No ``updated_at``, no upsert
key beyond the dedup one. Re-touching a human is a second event, not an edit of
the first. Retention, if it ever matters, is a later prune migration — the
sibling ``coord_alerts_retention_01`` is the template.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coordtouch_01"
down_revision: str | Sequence[str] | None = "ffland_headsync_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


#: Backfill half A — ``coord.agent_questions`` → ``coord.operator_touches``.
#:
#: Exported as a module constant rather than inlined so the behaviour test can
#: execute the EXACT statement this migration runs when it re-checks
#: idempotency. A paraphrased copy in the test would pass while measuring SQL
#: nothing executes.
#:
#: ``resolution`` is ``'answered'`` only where ``responded_at`` is set. A
#: pending question stays OPEN — ``resolved_at`` NULL and ``resolution`` NULL.
#: Stamping ``'abandoned'`` on a still-pending row would be inventing a terminal
#: state that cannot be known, which is exactly the fabrication the plan's
#: "unknown is represented as unknown" rule forbids; some of those questions are
#: waiting on an operator right now.
BACKFILL_AGENT_QUESTIONS_SQL = """
DO $$
BEGIN
    IF to_regclass('coord.agent_questions') IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO coord.operator_touches (
        tenant_id, session_id, device_id, kind, reason_code,
        policy_authorized, source, emitted_at, resolved_at, resolution,
        idempotency_key
    )
    SELECT
        q.tenant_id,
        q.agent_session_id,
        q.device_id,
        'question',
        'unclassified',
        'unknown',
        'agent_questions',
        q.created_at,
        q.responded_at,
        CASE WHEN q.responded_at IS NOT NULL THEN 'answered' ELSE NULL END,
        'question:' || q.question_id::text
      FROM coord.agent_questions q
     WHERE q.tenant_id IS NOT NULL
    ON CONFLICT (idempotency_key) DO NOTHING;
END
$$;
"""

#: Backfill half B — the operator-cleared subset of ``coord.gates``.
#:
#: The filter is the whole point, and it is the touch/no-touch split: a gate
#: counts only when ``clearance_audience = 'operator'`` AND
#: ``cleared_by_device_id IS NOT NULL``. An operator-audience gate cleared by an
#: AGENT (``cleared_by_device_id IS NULL``) is an agent attestation — no human
#: was touched — and backfilling it would inflate the very rate this store
#: exists to measure. An agent-audience gate never involved a human at all.
#:
#: ``policy_authorized = 'yes'``: a registered gate is by construction an
#: authorized ask. The gate protocol IS the sanctioned way to escalate, and the
#: plan is explicit that authorized escalation must not be counted as avoidable.
#: This is the one place a backfill can honestly assert something better than
#: ``'unknown'``.
BACKFILL_GATES_SQL = """
DO $$
BEGIN
    IF to_regclass('coord.gates') IS NULL THEN
        RETURN;
    END IF;

    -- The three columns this half filters and projects on all arrive in
    -- LATER revisions than the one that created coord.gates. On a fully
    -- migrated database they are always present; on a partially migrated one,
    -- skipping is correct and erroring is not. PL/pgSQL plans a statement on
    -- first execution rather than at block compile, so returning here means
    -- the INSERT below never references a column that does not exist.
    IF (
        SELECT COUNT(DISTINCT column_name)
          FROM information_schema.columns
         WHERE table_schema = 'coord'
           AND table_name = 'gates'
           AND column_name IN ('clearance_audience', 'cleared_by_device_id',
                               'agent_session_id')
    ) < 3 THEN
        RETURN;
    END IF;

    INSERT INTO coord.operator_touches (
        tenant_id, session_id, kind, reason_code, policy_authorized,
        source, emitted_at, resolved_at, resolution, gate_id,
        idempotency_key
    )
    SELECT
        g.tenant_id,
        g.agent_session_id,
        'gate',
        'unclassified',
        'yes',
        'gates',
        g.created_at,
        g.cleared_at,
        CASE WHEN g.cleared_at IS NOT NULL THEN 'answered' ELSE NULL END,
        g.gate_id,
        'gate:' || g.gate_id::text
      FROM coord.gates g
     WHERE g.tenant_id IS NOT NULL
       AND g.clearance_audience = 'operator'
       AND g.cleared_by_device_id IS NOT NULL
    ON CONFLICT (idempotency_key) DO NOTHING;
END
$$;
"""


def upgrade() -> None:
    """Create both tables + indexes, then backfill from the two partial ledgers."""
    # Raw ``op.execute`` with IF NOT EXISTS throughout — the convention the
    # sibling coord observation tables use, and what keeps a re-run harmless.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.operator_touches (
            touch_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id          UUID NOT NULL,
            session_id         UUID NULL,
            device_id          UUID NULL,
            kind               TEXT NOT NULL,
            reason_code        TEXT NOT NULL DEFAULT 'unclassified',
            policy_authorized  TEXT NOT NULL DEFAULT 'unknown',
            source             TEXT NOT NULL,
            emitted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_at        TIMESTAMPTZ NULL,
            resolution         TEXT NULL,
            work_unit_id       UUID NULL,
            gate_id            UUID NULL,
            idempotency_key    TEXT NOT NULL
        )
        """
    )
    # `source` is the ONE vocabulary column that takes a CHECK: a closed set of
    # writers in this codebase, not a vocabulary that grows from data. Named so
    # a violation reports the invariant, and dropped-then-added so a re-run
    # against a table created by an earlier form of this revision converges.
    op.execute(
        """
        ALTER TABLE coord.operator_touches
            DROP CONSTRAINT IF EXISTS ck_operator_touches_source
        """
    )
    op.execute(
        """
        ALTER TABLE coord.operator_touches
            ADD CONSTRAINT ck_operator_touches_source
            CHECK (source IN ('runner_hook', 'agent_questions', 'gates',
                              'merge_decisions', 'enrichment'))
        """
    )
    # The dedup contract. Created BEFORE the backfill because both backfill
    # halves name it as their ``ON CONFLICT`` target.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_operator_touches_idempotency_key
            ON coord.operator_touches (idempotency_key)
        """
    )
    # The rate window and the operator feed: a tenant's touches, newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_operator_touches_tenant_emitted_at
            ON coord.operator_touches (tenant_id, emitted_at DESC)
        """
    )
    # Phase 6's ranked read: "which reason codes are touching humans most?"
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_operator_touches_tenant_reason_emitted_at
            ON coord.operator_touches (tenant_id, reason_code, emitted_at DESC)
        """
    )
    # Per-session lineage. A NULL session simply does not match, which is
    # correct — an unattributable touch answers for no session.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_operator_touches_tenant_session
            ON coord.operator_touches (tenant_id, session_id)
        """
    )
    # Still-open touches. Partial so the index stays proportional to what is
    # open rather than to everything that ever happened.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_operator_touches_tenant_open
            ON coord.operator_touches (tenant_id, emitted_at DESC)
            WHERE resolved_at IS NULL
        """
    )

    # ------------------------------------------------------------------
    # Classification sidecar — append-only audit of Phase 3 enrichment.
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.operator_touch_classifications (
            classification_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            touch_id               UUID NOT NULL
                REFERENCES coord.operator_touches(touch_id) ON DELETE CASCADE,
            from_reason_code       TEXT NULL,
            to_reason_code         TEXT NULL,
            from_policy_authorized TEXT NULL,
            to_policy_authorized   TEXT NULL,
            classified_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            by_actor               TEXT NULL
        )
        """
    )
    # "How did this touch's classification get to where it is?" — the audit
    # read, in order. Mirrors idx_work_unit_status_history_unit's access shape.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_operator_touch_classifications_touch
            ON coord.operator_touch_classifications (touch_id, classified_at)
        """
    )

    # ------------------------------------------------------------------
    # Backfill. Idempotent, guarded, and NOT separately reversible — the
    # downgrade drops the table, which takes the backfilled rows with it.
    # ------------------------------------------------------------------
    op.execute(BACKFILL_AGENT_QUESTIONS_SQL)
    op.execute(BACKFILL_GATES_SQL)


def downgrade() -> None:
    """Drop both tables + their indexes. The backfilled rows go with them."""
    op.execute("DROP INDEX IF EXISTS coord.ix_operator_touch_classifications_touch")
    # The sidecar first: it is the FK child, and dropping the parent while it
    # stands would need a CASCADE that could take an unrelated dependency too.
    op.execute("DROP TABLE IF EXISTS coord.operator_touch_classifications")
    op.execute("DROP INDEX IF EXISTS coord.ix_operator_touches_tenant_open")
    op.execute("DROP INDEX IF EXISTS coord.ix_operator_touches_tenant_session")
    op.execute(
        "DROP INDEX IF EXISTS coord.ix_operator_touches_tenant_reason_emitted_at"
    )
    op.execute("DROP INDEX IF EXISTS coord.ix_operator_touches_tenant_emitted_at")
    op.execute("DROP INDEX IF EXISTS coord.uq_operator_touches_idempotency_key")
    # No separate constraint drop: DROP TABLE takes the CHECK constraint with
    # it, and an ``ALTER TABLE IF EXISTS`` here would trip the repo's alembic
    # schema= gate, whose raw-SQL parser reads the token after ``ALTER TABLE``
    # as the (then unqualified) identifier.
    op.execute("DROP TABLE IF EXISTS coord.operator_touches")
