"""coord.operator_touches — one unified store for every time an agent needed a human

Revision ID: coordtouch_01
Revises: pdann_01
Create Date: 2026-08-27

Phase 1 of plan ``2026-08-27-instrument-operator-touch-events`` (VETTED
2026-08-27).

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the two
tables land here, in qontinui-web, and must merge BEFORE the coord PR that
writes to them. ``down_revision`` is this repo's LOCAL single alembic head, and
is deliberately NOT pinned to the head this revision was authored against:
``alembic-graph-pr.yml`` serialises alembic PRs by construction, so every
revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; do NOT author an ``alembic merge``
revision (this revision has not landed, so re-pointing leaves nothing behind
while a merge revision is permanent bookkeeping), and do NOT hand-order it with
coord dependency labels — the graph gate owns this ordering, not coord.

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
3. Writes **no rows**. The store ships **empty by design** — see *Why there is
   no backfill* below.

Why there is no backfill
========================

An earlier form of this revision backfilled the store from the two partial
ledgers that already exist (``coord.agent_questions``, and the operator-cleared
subset of ``coord.gates``). The premise: the fleet had months of real
operator-touch history, starting at zero would read as a regression in exactly
the metric the plan exists to improve, and discarding that history would be a
choice rather than a limitation.

**Phase 0 measured that premise against production, and the history does not
exist:**

* ``coord.agent_questions`` — **43 rows, ever**. Exactly **one** was answered by
  a human operator (185.6 s). The other 42 were answered by ``auto:policy_gap``
  — a machine; no human touched them.
* ``coord.agent_questions`` pending — **≥1,309** (the read route caps at 500
  with no offset, so that is a lower bound, not a count).
* ``coord.gates`` — 3,133 live, and **495 of the newest 500 cleared on
  "predicate satisfied"**: approximately zero operator clearances, despite 44%
  of them carrying ``clearance_audience = 'operator'``.
* Total confirmed operator touches recoverable from all history: **1**.

The backfill's only filter was ``tenant_id IS NOT NULL``, so it would import
**≥1,309 machine-generated rows to recover one real touch**, with the gates half
contributing approximately nothing. That does not preserve a signal, it swamps
the one this table exists to measure — a ``stop-short-rate`` computed over those
rows would be noise.

Filtering it instead of cutting it was considered and rejected: it keeps ~500
lines of SQL and test alive for one row, and leaves a fragile dependency on the
``auto:%`` prefix in ``responded_by_operator`` staying correct as that
vocabulary evolves. The raw tables still exist, so any future query can recover
that single row. **Phase 5 measures forward.**

The touch/no-touch split — for Phase 2's emitter
================================================

The cut gates backfill carried the sharpest statement of a distinction that is
not going away, so it is recorded here rather than deleted with the SQL. A gate
counts as an operator touch only when ``clearance_audience = 'operator'``
**AND** ``cleared_by_device_id IS NOT NULL``. The audience column says who the
gate was *addressed to*; ``cleared_by_device_id`` is the only evidence a *human*
actually did anything. An operator-audience gate cleared by an AGENT
(``cleared_by_device_id IS NULL``) is an agent attestation — no human was
touched — and counting it would inflate the very rate this store exists to
measure. An agent-audience gate never involved a human at all.

This now governs **live emission** rather than a reconstruction: Phase 2's
emitter faces the identical question every time it fires, and the production
numbers above are what the split looks like at scale — 44% of gates
operator-addressed, near-zero operator-cleared.

Its companion holds too: ``policy_authorized = 'yes'`` is honest for a gate
touch, because a registered gate is by construction an authorized ask. The gate
protocol IS the sanctioned way to escalate, and the plan is explicit that
authorized escalation must not be counted as avoidable.

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
    reconstructed row can never be mistaken for an observed one:

    * ``runner_hook`` — observed live by the runner as it happened.
    * ``agent_questions`` — reconstructed from ``coord.agent_questions``.
    * ``gates`` — reconstructed from ``coord.gates``.
    * ``merge_decisions`` — derived from the merge train's escalations.
    * ``enrichment`` — created by a later analysis pass rather than observed.

    The two reconstruction values are **reserved, not used**: this revision
    writes no rows (see *Why there is no backfill*), so every row in the table
    today came from a live emitter. They stay in the vocabulary because Phase 2
    onwards still needs row provenance, and any rate computed over this table
    should be able to say which rows it was computed from — a reconstructed
    row's timestamps come from a store built for another purpose and its
    fidelity is not the same.

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
    and the live reason for it survives this revision writing no rows: the
    runner and the agent can both observe a single touch. A UNIQUE key with
    ``ON CONFLICT DO NOTHING`` is what makes that harmless. (The second reason
    it once carried — a backfill colliding with a live coord emitting for the
    same events — went with the backfill.)

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
  The dedup contract above, and the ``ON CONFLICT`` target every emitter names.
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
down_revision: str | Sequence[str] | None = "pdann_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create both tables + indexes. No rows — the store ships empty."""
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
    # The dedup contract: the UNIQUE index every emitter names as its
    # ``ON CONFLICT`` target.
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
    # No backfill: the store ships EMPTY BY DESIGN. See the module docstring's
    # "Why there is no backfill" — Phase 0 measured all of production's history
    # at ONE confirmed operator touch, against the >=1,309 machine-generated
    # rows the backfill would have imported to reach it. Phase 5 measures
    # forward.
    # ------------------------------------------------------------------


def downgrade() -> None:
    """Drop both tables + their indexes. Any emitted rows go with them."""
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
