"""coord.operator_inputs — one point-event row per episode of a human acting

Revision ID: coordinput_01_operator_inputs
Revises: sched_cond_01_scheduled_tasks_conditions
Create Date: 2026-09-30

Phase 1 (qontinui-web half) of plan
``2026-09-20-agents-sustained-per-operator-hour-needs-an-operator-touch-record``
(VETTED 2026-09-30).

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the table
lands here, in qontinui-web, and must be applied in production BEFORE the coord
PR that writes to it (``POST /coord/sessions/operator-input``) leaves draft.
``down_revision`` is this repo's LOCAL single alembic head, and is deliberately
NOT pinned to the head this revision was authored against:
``alembic-graph-pr.yml`` serialises alembic PRs by construction, so every
revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; do NOT author an ``alembic merge``
revision, and do NOT hand-order it with coord dependency labels — the graph gate
owns this ordering, not coord. (The same rule, and the same reasoning, as
``coordtouch_01``.)

The gap — why a sibling table, not new kinds in ``coord.operator_touches``
=========================================================================

``coordtouch_01`` shipped ``coord.operator_touches`` as *"one unified store for
every time an agent **needed** a human"*. Every one of its six ``kind`` words is
DEMAND-side: an agent stopped, and a human had something to do. That is the
right store for ``stop-short-rate``. It cannot carry the SUPPLY side — the moment
a human actually typed into, answered, or redirected a session — for three
structural reasons:

1. **An unsolicited redirect is not a demand.** An operator typing "stop, do it
   the other way" into a *working* session is the most expensive steering there
   is, and no agent raised anything. There is no demand row for it to resolve.
2. **A demand row has a lifecycle; an input is a point event.** Writing inputs
   into the demand store as ``emitted_at = resolved_at`` rows would poison every
   wait-duration read computed over that table.
3. **An operator-hour is made of operator activity.** ``coordtouch_01``'s own
   plan says operator time is *"Not observable"* — true of a demand store.
   Input events are the closest observable to attention the product will ever
   have, and clustering them is the only sensor-free derivation of an
   operator-hour (the plan's D6; that derivation lives in coord's read door,
   never in a column here).

The vocabulary split (the plan's D1), fixed here so it cannot blur:

* **touch raised** — an agent stopped and needed a human →
  ``coord.operator_touches`` (shipped by ``coordtouch_01``; the demand half).
* **operator input** — a human acted on a session or on fleet state →
  ``coord.operator_inputs`` (this revision; the supply half).

A reader who wants "how often did agents stop short" reads the first table. A
reader who wants "how much steering did the operator actually spend" reads this
one. Neither is a substitute for the other, and nothing joins them by guessing.

What this migration does
========================

1. Creates ``coord.operator_inputs``: one **append-only** row per input
   EPISODE, written best-effort off the observing path.
2. Creates its two tenant-first read indexes and the dedup constraint.
3. Writes **no rows**. There is nothing to backfill: no shipped writer has ever
   recorded an operator's input as an event. ``coord.operator_audit`` records
   ``/admin/coord`` edits, but a backfill from it alone would fill exactly one
   channel of six and read as if the operator only ever edited fleet state —
   a biased history is worse than an honest empty one. The read door reports
   ``first_input_at`` so a window starting before the first emitter is visibly
   ``insufficient_coverage``, never a touch-free fleet. **It measures forward.**

The privacy rule — the column set is the contract
=================================================

A row records **the event and its class — never its content.** There is
deliberately:

* **no text / bytes / content column** — not the keystrokes, not the answer an
  operator typed into a question, not a prefix of either ("the first 40
  characters" is the helpful column that turns a metric into a keylogger);
* **no byte count** — a byte count per minute is a typing-rate biometric. The
  runner's in-memory ``PtyInputObservation.bytes`` stays in memory, and its own
  doc comment says why: *"keystrokes are exactly what must not be kept"*;
* **no question text, and no ``resource_key``** for admin edits —
  ``coord.operator_audit`` already stores what was edited, under its own access
  rules; this table is a projection of *when*, not a second audit log.

``test_coordinput_01_operator_inputs_migration.py`` pins the exact column set,
so a later revision that adds any column fails that test and must argue past
this paragraph in review. Treat that failure as the point, not as friction.

Row grain — an EPISODE, never a keystroke
=========================================

One row per ``(tenant, session-or-resource, channel, 60-second bucket)``. A
human typing a 400-character redirect produces one row, not 400. The bucket
width is the RUNNER's ``session::operator_touch::BUCKET_WIDTH_SECS`` /
``epoch_bucket()``, as defined in the demand store's emitter
(qontinui-runner#1680, still open when this revision was authored — it is not
on runner ``main`` yet). The operator-input emitter imports that constant
rather than defining a second one, and coord mints no bucket of its own; there
is one bucket width in the fleet, not two. Volume is therefore bounded by construction at ≤ 1 row per session per
channel per minute of actual human activity.

Column contract — ``coord.operator_inputs``
===========================================

The column set is a shared contract with coord's ``operator_inputs.rs`` write
route and its read door. The names must not drift from this list.

``input_id UUID PRIMARY KEY``
    Server-side ``gen_random_uuid()`` default. Nothing addresses an input by this
    id from outside; it exists so an append-only log has a stable primary key,
    and so a duplicate insert cannot be confused with an update.

``tenant_id UUID NOT NULL``
    Every input is tenant-scoped at the source: coord takes the tenant from the
    caller's verified JWT, never from the body. An input that cannot name its
    tenant is an input to nothing, so NOT NULL — there is no honest "unknown
    tenant" state to represent.

    Deliberately **no FK to** ``coord.tenants``, the same rationale as
    ``coord.operator_touches`` and ``coord.session_policy_reads``: this is an
    observation log fed from a hot path, and a best-effort insert must never
    fail for referential bookkeeping.

``session_id UUID NULL``  ← **NULL means Unavailable, never Absent**
    Which agent session the human acted on. NULL means coord could not PROVE
    which session this was — the id reaches coord as a caller claim and counts
    only when coord confirms the session is bound to the device the verified
    JWT names (``coordtouch_01``'s rule, reused verbatim). NULL is also the
    honest value for an ``admin_edit`` that addressed fleet state rather than a
    session.

    The rejected alternative is a ``(device, tenant) → most-recent-session``
    bridge to fill those NULLs. It names the WRONG session under concurrent
    sessions, which is this fleet's normal state. **Consumers must read NULL as
    Unavailable, never as Absent**: the read door reports the NULL share as
    ``session_unproven_share`` rather than silently dropping the rows or
    attributing them to a guessed session.

``device_id UUID NULL``  ← **NULL means Unavailable, never Absent**
    Which device the input arrived through. NULL for a non-device token (an SSO
    operator answering in the web console has no device), which is "this door
    has no device to name", not "no device was involved".

``operator_id UUID NULL``  ← **NULL means Unavailable, never Absent**
    WHICH human acted, where the door knows. Coord's own channels do
    (``OperatorContext.operator_id``). A local keyboard does not — the runner
    has a device, not a person — and the remote-terminal grant carries no
    operator identity either (plan Vet V5), so every runner-emitted row writes
    NULL here. There is deliberately **no ``device → most-recent-operator``
    bridge**, for the same reason there is no session bridge above. The read
    door reports ``operator_identity_coverage`` and breaks hours out per
    operator only where this is known.

    **The id space is coord's, not qontinui-web's.** The value is
    ``OperatorContext.operator_id``, which is ``coord.operators``' own primary
    key (minted by coord's SSO upsert) — **NOT** qontinui-web's
    ``auth.users.id``. qontinui-coord ``agent_registry.rs`` states in terms that
    these are different id spaces. A web-side per-operator join must therefore
    go through ``coord.operators``, never key this column on ``auth.users.id``:
    such a join matches nothing, raises no error, and reads as "no operator
    identity" — a silent zero, not a failure.

``channel TEXT NOT NULL``
    The door the input came through. Vocabulary at authoring time, closed at
    coord's write boundary (``ACCEPTED_CHANNELS``), not here:
    ``local_terminal``, ``remote_terminal``, ``runner_http``, ``coord_answer``,
    ``coord_gate_clearance``, ``admin_edit``.

``actor_class TEXT NOT NULL``  ← **from the DOOR, never from the content**
    ``human`` or ``unknown``, decided deterministically by producer / door
    identity (the plan's D3): ``human`` only for a door only a human uses (the
    runner's own pane keystrokes, a granted remote-terminal frame, a coord write
    completed under an interactive ``OperatorContext``); ``unknown`` for a door
    a human or an agent could both have used. No heuristic — typing cadence,
    time of day, text shape — ever promotes an ``unknown`` to ``human``; that
    would need the content this table refuses to hold.

    There is **no ``automated`` value, on purpose**: automated writers produce
    no row at all, and coord's write route answers ``automated`` with a 422, so
    a buggy emitter cannot fill a store about human steering with agent traffic.
    ``unknown`` rows are recorded and reported as their own share; they count
    toward neither "touched" nor "touch-free".

``session_state_at_input TEXT NOT NULL DEFAULT 'unknown'``
    ``at_prompt`` (the session was waiting — a SOLICITED input) / ``working``
    (the operator interrupted it — a REDIRECT) / ``unknown``. A state read at the
    first input of the bucket, not a classifier. Defaulted to ``unknown`` so a
    door that cannot read session state (every coord-side channel) writes the
    truth by omission rather than guessing ``at_prompt``.

``resource_kind TEXT NULL``
    For ``admin_edit`` rows, the ``resource_kind`` copied from
    ``coord.operator_audit`` — the KIND of thing edited, never its key or value.
    NULL on every other channel.

``occurred_at TIMESTAMPTZ NOT NULL``  ← **no default, deliberately**
    The start of the input's bucket, supplied by the emitter. Unlike
    ``coord.operator_touches.emitted_at`` this has no ``now()`` default: the
    runner's outbox may deliver an input minutes after it happened, and a
    server-side default would silently re-time every delayed row into the
    minute it was *delivered* — corrupting exactly the active-minute clustering
    the operator-hour is built from. A row with no time is refused rather than
    mis-timed.

``idempotency_key TEXT NOT NULL`` + UNIQUE  ← **load-bearing**
    The dedup contract every emitter's ``ON CONFLICT (idempotency_key) DO
    NOTHING`` relies on: a runner outbox retry, or a double emit from one
    funnel, must collapse to one row. Deterministic, derivable from the event
    alone. The runner's grammar is ``<session_id>:input:<channel>:<bucket>``;
    coord TENANT-PREFIXES every caller key before storing it (the
    ``stored_idempotency_key`` contract already on coord ``main`` for the demand
    store), because an unprefixed key would dedup one tenant's input against
    another's. NOT NULL rather than nullable-with-a-partial-unique-index: a row
    with no key is a row that can be duplicated, and there is no input for which
    a key cannot be constructed.

``recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()``
    When coord stored the row. The gap between this and ``occurred_at`` is the
    delivery lag — the observable that separates "the operator went quiet" from
    "the outbox stalled".

No CHECK constraints on the vocabulary columns — deliberately
=============================================================

``channel``, ``actor_class`` and ``session_state_at_input`` are plain ``TEXT``
with **no CHECK**. The vocabulary is closed at coord's write boundary instead
(typed 422 naming field, value and accepted words) — the resolved rule of the
demand store's emitter plan, and the pattern ``coord.work_units.status`` uses.
A CHECK would turn every new door (splitting a shared door to shrink the
``unknown`` share is expected follow-up work) into a schema migration that must
land and deploy here before coord may write the value; and on an observation
log a rejected write is a lost observation. Unlike ``coord.operator_touches``
there is no ``source`` column here to take the one CHECK that table carries:
provenance is the ``channel``.

Indexes
=======

Every index is tenant-first, because every read of this table is tenant-scoped
from the verified credential.

* ``uq_operator_inputs_idempotency_key`` — the UNIQUE constraint on
  ``(idempotency_key)``: the dedup contract above, and the ``ON CONFLICT``
  arbiter.
* ``ix_operator_inputs_tenant_occurred_at`` — ``(tenant_id, occurred_at)``:
  the active-minute scan behind operator-active-hours and agents-per-active-hour.
* ``ix_operator_inputs_tenant_session_occurred_at`` —
  ``(tenant_id, session_id, occurred_at)``: inputs per session, joined to shipped
  work units for the per-unit and touch-free reads. A NULL session matches no
  session, which is correct — an unproven input answers for no unit.

Append-only
===========

Nothing updates or deletes a row. No ``updated_at``, no upsert key beyond the
dedup one. A second input is a second event, not an edit of the first.
Retention, if it ever matters, is a later prune migration —
``coord_alerts_retention_01`` is the template.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coordinput_01_operator_inputs"
down_revision: str | Sequence[str] | None = "sched_cond_01_scheduled_tasks_conditions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the store + its indexes. No rows — it measures forward."""
    # Raw ``op.execute`` with IF NOT EXISTS throughout — the convention the
    # sibling coord observation tables use, and what keeps a re-run harmless.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    # The column list IS the privacy contract: no text, bytes, byte count or
    # resource key. See the module docstring before adding anything here.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.operator_inputs (
            input_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id               UUID NOT NULL,
            session_id              UUID NULL,
            device_id               UUID NULL,
            operator_id             UUID NULL,
            channel                 TEXT NOT NULL,
            actor_class             TEXT NOT NULL,
            session_state_at_input  TEXT NOT NULL DEFAULT 'unknown',
            resource_kind           TEXT NULL,
            occurred_at             TIMESTAMPTZ NOT NULL,
            idempotency_key         TEXT NOT NULL,
            recorded_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_operator_inputs_idempotency_key UNIQUE (idempotency_key)
        )
        """
    )
    # The active-minute scan: a tenant's inputs in time order.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_operator_inputs_tenant_occurred_at
            ON coord.operator_inputs (tenant_id, occurred_at)
        """
    )
    # Per-session lineage in time order — the join to shipped work units.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_operator_inputs_tenant_session_occurred_at
            ON coord.operator_inputs (tenant_id, session_id, occurred_at)
        """
    )


def downgrade() -> None:
    """Drop the store + its indexes. Any emitted rows go with them."""
    op.execute(
        "DROP INDEX IF EXISTS coord.ix_operator_inputs_tenant_session_occurred_at"
    )
    op.execute("DROP INDEX IF EXISTS coord.ix_operator_inputs_tenant_occurred_at")
    # No separate drop for ``uq_operator_inputs_idempotency_key``: it is a table
    # constraint, so DROP TABLE takes it (and its backing index) with it.
    op.execute("DROP TABLE IF EXISTS coord.operator_inputs")
