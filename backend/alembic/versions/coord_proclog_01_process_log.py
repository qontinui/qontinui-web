"""coord process log: event log, flow/conformance/forecast tables, source-stamp indexes

Revision ID: coord_proclog_01
Revises: coord_agent_worktrees_client_allocation_id_01
Create Date: 2026-10-12

Phase 1 of plan ``2026-10-11-process-twin-event-log-and-flow-metrics``
(VETTED 2026-10-12): every table and source index the process twin reads, in
ONE revision. The plan wants a single web -> coord deploy boundary for all of
its DDL, and the ``Migration Reversal Tested`` required check admits exactly
one added migration file per PR, so the seven tables and the 37 source-stamp
indexes land together here. coord authors **zero** DDL
(``[policy: alembic-sole-authorship]``); this revision must be **applied in
production before any coord read of these tables deploys** (coord's projector
is plan Phase 2; every coord read degrades to UNKNOWN on 42P01 until then).
``down_revision`` is this repo's local single alembic head; re-point it if
another revision lands first — never author an ``alembic merge`` revision.

Order inside ``upgrade()``: the seven new tables and their indexes run in the
migration's transaction; the 37 indexes on EXISTING coord tables then run
``CONCURRENTLY`` inside ``op.get_context().autocommit_block()``, which commits
the table DDL first. A failure in the concurrent half therefore leaves the
tables (and every index built before the failure) committed while the version
stays at the parent, so a later ``downgrade`` from the parent does not remove
them. A re-run converges, because every statement is ``IF NOT EXISTS`` — with
one exception: a killed concurrent build leaves an INVALID index that ``IF NOT
EXISTS`` then skips forever. Drop any INVALID ``ix_proclog_*`` index first; see
"If a concurrent build fails" below.

The event log (events, E2O, O2O, watermarks)
============================================

The gap
-------

coord holds ~40 process-relevant stores (work units, gates, sessions, merge
proposals, PR events, scheduler ticks, claims audit, operator touches, …),
each with its own key space, timestamp meaning and retention — the scheduler
ring is 48 h, closed sessions are pruned after 7 d. There is no durable,
joined event log of the factory itself, so flow metrics, conformance and
process forecasts have nothing to read. This revision creates that log in the
OCEL 2.0 relational shape (plan D3): one row per event, one row per
event–object relation (E2O), one row per object–object relation (O2O).

Tables
------

``coord.process_events`` — one row per lifecycle-significant event.
    ``tenant_id`` is NULL only for a fleet-scope event (the tick-scope
    ``train.occupancy_hourly`` rows, plan D5); the idempotency key is therefore
    ``UNIQUE NULLS NOT DISTINCT (tenant_id, source, source_key)`` — a plain
    UNIQUE would let every fleet-scope replay insert a duplicate, since NULLs
    compare distinct. Every projector write is ``INSERT … ON CONFLICT (tenant_id,
    source, source_key) DO NOTHING`` against that index. ``activity`` is a
    closed vocabulary owned by coord's code, so it takes no CHECK here (a new
    activity must not need a migration). ``evidence_tier`` and ``time_basis``
    are closed categorical labels and DO take CHECKs: an evidence tier is a
    label, never a number (``[policy: unknown-must-not-render-as-a-default]``).
    ``(occurred_at)`` is the age index the batched retention delete needs.

``coord.process_event_objects`` — E2O. ``occurred_at`` is denormalised from
    the event so a per-object trace is one index range scan on
    ``(tenant_id, object_type, object_id, occurred_at)``. Rows cascade with
    their event, so the warm-tier retention sweep deletes events only.

``coord.process_object_links`` — O2O, upserted: a re-observation moves
    ``last_observed_at``. Only ``resolved`` and ``ambiguous`` resolutions are
    links (plan D5); anything else stays in the event's ``attrs``. Keyed
    ``NULLS NOT DISTINCT`` for the same reason as the events.
    ``(last_observed_at)`` serves its retention prune (Phase 5); the reverse
    ``(tenant_id, to_type, to_id)`` index serves the "which PRs implement this
    work unit" direction the unique key's prefix cannot.

``coord.process_log_watermarks`` — one row per ``(source, stamp column)`` the
    projector pages on (plan D1: most sources have several independent
    lifecycle stamps and no single monotone "changed at"). ``completed_at`` is
    set by a one-shot source such as Phase 4's JetStream replay.

Every CHECK is declared inside its ``CREATE TABLE`` body, never as a
``ALTER TABLE … DROP CONSTRAINT`` / ``ADD CONSTRAINT`` pair: coord's
``pr_merge/migration_classifier.rs`` rejects any ``ALTER TABLE`` carrying
``DROP`` and any ``ADD CONSTRAINT`` without ``NOT VALID``, and one rejected
statement escalates the whole PR to an operator.

No FK to tenants, and no trigger: this is an observation log, and a
best-effort insert must never fail for referential bookkeeping (the
``coordtouch_01_operator_touches`` rationale); triggers on source tables were
rejected in plan D1 because a twin bug would then fail a business write.

coord.process_flow_snapshots
============================

Why a snapshot table
--------------------

Flow metrics (per-state dwell, WIP ageing, flow efficiency, Little's law, the
DORA five, development speed) are too heavy to compute at request time:
``coord_query_twin_fidelity`` timed out 4 of 4 times at coord's 30 s per-tool
cap doing exactly that, and the ``/digital-twin`` page's probe budget is 8 s
(plan D9). A leader worker computes; the read serves the latest persisted row
with ``staleness_seconds``, so every replica answers the same row and a stale
result is labelled rather than served as current.

``body`` is the whole computed result for one tenant and window. Its shape is
owned by coord's code, not by this schema, so a new metric needs no migration.
``(computed_at)`` is the age index the worker's prune uses.

coord.process_conformance_verdicts
==================================

What a row is
-------------

The plan encodes the declared process (``finished-criteria``,
``session-protocol``, ``plan-discipline``, ``planning-and-scope``) as Declare
templates — ``response(a, b, within)``, ``precedence``, ``existence`` … — each
citing its policy clause. A missing expected event is a first-class deviation:
a ``response`` whose window closed with no ``b`` is ``violated``.

Every case's verdict is exactly one of ``held``, ``violated`` or ``unknown``
(CHECKed here). An unobservable activity, an unresolved attribution, or a
window that has not closed plus its inputs' ingestion lag is ``unknown`` with
its ``reason`` — never ``held`` and never ``violated``
(``[policy: an-unknown-input-must-not-fire-a-detector]``). Verdicts observe;
none of them blocks, refuses or delays an agent action (plan D12).

The primary key makes the worker's write an upsert: re-evaluating a case
replaces its verdict. The read aggregates per ``(tenant_id, constraint_id)``,
which the key's prefix serves.

coord.process_forecasts
=======================

What a row is
-------------

One forecast per question per object, issued when the object enters the state
the question is about — ``land_within_t`` for a queued merge proposal,
``stall_within_t`` for a session entering ``working``, ``gate_clear_within_t``
for a registered gate (plan D13). ``p`` is the forecast probability. At
``issued_at + horizon_secs`` the worker resolves it from the event log,
writing ``resolved_at`` and ``observed``, and scores it with coord's shipped
ByteSized32 scorer (``twin_fidelity::score_transitions``) against a
majority-class baseline.

The question vocabulary is owned by coord's code, so it takes no CHECK (a new
question must not need a migration). ``p`` and ``horizon_secs`` are CHECKed:
a probability outside [0, 1] or a non-positive horizon is a writer bug, and
refusing it is cheaper than scoring it.

The unique key makes issuing idempotent. The partial index on unresolved rows
is the resolver's work queue: it stays proportional to what is outstanding,
not to every forecast ever issued.

Source-stamp indexes on existing coord tables
=============================================

How the list was derived (the Phase 0 index census)
---------------------------------------------------

For every ``(source, stamp)`` the projector will page on, the canonical schema
dump (qontinui-runner ``src-tauri/schema.pg.sql.generated`` at ``fc3a9155b``)
was searched for an index whose LEADING column is that stamp. This revision
adds one for each stamp that had none. Stamps already served, and therefore
NOT indexed here: ``pr_events.created_at``, ``commit_lineage.recorded_at``,
``findings.created_at``, ``agent_questions.withdrawn_at``,
``alerts.first_seen_at`` / ``resolved_at`` / ``paged_at`` and
``policy_rule_resolutions.resolved_at``. ``scheduler_ticks`` and
``session_events`` page on their serial ``bigint`` primary key instead.

Shape of each index
-------------------

* **Partial, ``WHERE <stamp> IS NOT NULL``**: on a NULLABLE lifecycle stamp
  (``cleared_at``, ``retracted_at``, ``acked_at`` …) a row that never reaches
  the stamp costs nothing, and only the write that sets it maintains the
  index. On a NOT NULL stamp (``created_at``, ``occurred_at``,
  ``transitioned_at`` …) the predicate is vacuous but harmless — the planner
  still proves ``<stamp> > $1`` implies it — and is kept so every index has
  one shape.
* **Keyed ``(<stamp>, <primary key>)``**: the projector's keyset page orders
  by the stamp and breaks ties on the row key, so the index serves the order
  as well as the range.
* **``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` inside
  ``op.get_context().autocommit_block()``**: the
  ``coord_pg_overload_idx_01_fanout_query_indexes`` shape. CONCURRENTLY never
  blocks the business writes on these tables, and fails at runtime outside an
  autocommit block.

``coord.gates.evaluated_at`` is deliberately NOT indexed
--------------------------------------------------------

The 10 s gate sweep rewrites ``evaluated_at`` (``SET evaluated_at = now(),
verdict_reason = ...``) on every open gate. PostgreSQL keeps an UPDATE
heap-only (HOT) only when no indexed column's value changes, so an index
naming ``evaluated_at`` would make every one of those sweep writes non-HOT. A
gate's terminal verdict other than ``cleared`` is stamped only by
``evaluated_at`` (every terminal write sets it, and the sweep re-evaluates
only ``open`` gates), so the reader finds new terminal rows through
``ix_proclog_gates_terminal_unarchived`` — whose key (``gate_id``) and
predicate (``verdict``, ``archived_at``) change only at a real transition — and
filters ``evaluated_at > watermark`` itself. The set it covers is bounded by
the ~14-day gate archive.

The other stamp indexes on ``coord.gates`` keep sweep writes HOT for the same
reason: the sweep does not change those stamps' values on a tick that is not a
transition, and HOT compares values, not the SET list.

``updated_at`` indexes DO cost HOT, and that was weighed
--------------------------------------------------------

Three sources have no lifecycle stamp but ``updated_at``: ``merge_proposals``
(plan D1: a proposal re-enters ``queued`` with no stamp, so ``updated_at`` is
the only way to see every status change), ``session_expectations`` (current
status only) and ``session_compliance``. None had an index on ``updated_at``
before, so every write that bumps it — a session check-in on
``session_expectations``, a lease or requeue on ``merge_proposals`` — now
maintains indexes instead of staying heap-only. Accepted: these are low-rate
tables next to the gate sweep (one check-in per session phase boundary; one
proposal write per scheduler decision), and the alternative for
``merge_proposals`` is missing requeues entirely. The Phase 0 SQL census
(owed; see the plan's status block) measures their update rates, and an index
it shows too costly is dropped in a follow-up revision.

For Phase 2's gates reader: the terminal index excludes archived rows, and
``work_unit_derive_worker.rs`` sets ``archived_at`` directly, so a gate that
fails or is withdrawn and is archived within one projector tick never appears
here. The ``archived_at`` reader must therefore also project the terminal
verdict of an archived gate whose terminal event was never projected.

If a concurrent build fails, and why this revision cannot check
---------------------------------------------------------------

A cancelled, deadlocked or timed-out ``CREATE INDEX CONCURRENTLY`` leaves an
INVALID index behind, and ``IF NOT EXISTS`` then skips it on every re-run
while the revision reports success. Recovery: find it with

    SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'coord' AND c.relname LIKE 'ix_proclog_%'
       AND NOT i.indisvalid;

then ``DROP INDEX CONCURRENTLY coord.<name>`` for each and re-run this
revision. The check cannot live in ``upgrade()``: coord's migration
classifier rejects any ``.execute`` whose receiver is not ``op`` (an
``op.get_bind().execute`` validity query escalates the PR to an operator), and
``op.execute`` of a ``SELECT`` or a ``DO`` block is rejected as an
unrecognized statement. It runs instead where it can: the Phase 1 exit check
before Phase 2 deploys, and the Phase 2 projector's health envelope, which
must report an INVALID ``ix_proclog_*`` index as a degraded source.

Unlike the seven new tables, which nothing reads until Phase 2, these 37
indexes change live tables the moment they apply: every insert or stamp update
on the 21 indexed tables maintains them, and the planner may choose them for
existing coord queries.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_proclog_01"
down_revision: str | Sequence[str] | None = "coord_agent_worktrees_client_allocation_id_01"  # fmt: skip
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Seven new tables (transactional), then 37 CONCURRENTLY indexes. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # ------------------------------------------------------------------
    # Events.
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_events (
            event_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id      UUID NULL,
            activity       TEXT NOT NULL,
            occurred_at    TIMESTAMPTZ NOT NULL,
            recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            source         TEXT NOT NULL,
            source_key     TEXT NOT NULL,
            actor          TEXT NULL,
            evidence_tier  TEXT NOT NULL,
            time_basis     TEXT NOT NULL,
            attrs          JSONB NOT NULL DEFAULT '{}'::jsonb,
            CONSTRAINT ck_process_events_evidence_tier
                CHECK (evidence_tier IN ('coord_observed', 'derived',
                                         'agent_reported', 'operator')),
            CONSTRAINT ck_process_events_time_basis
                CHECK (time_basis IN ('event', 'insert', 'observed', 'declared'))
        )
        """
    )
    # The idempotency key and every projector write's ON CONFLICT target.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_process_events_source_key
            ON coord.process_events (tenant_id, source, source_key)
            NULLS NOT DISTINCT
        """
    )
    # A tenant's events in time order: the flow, conformance and export reads.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_events_tenant_occurred_at
            ON coord.process_events (tenant_id, occurred_at)
        """
    )
    # The age index the batched warm-tier retention delete pages on.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_events_occurred_at
            ON coord.process_events (occurred_at)
        """
    )

    # ------------------------------------------------------------------
    # Event-to-object relations (E2O).
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_event_objects (
            event_id     UUID NOT NULL
                REFERENCES coord.process_events(event_id) ON DELETE CASCADE,
            tenant_id    UUID NULL,
            object_type  TEXT NOT NULL,
            object_id    TEXT NOT NULL,
            qualifier    TEXT NOT NULL,
            occurred_at  TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (event_id, object_type, object_id, qualifier)
        )
        """
    )
    # A per-object trace, and a per-type fold, as one index range scan.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_event_objects_object_trace
            ON coord.process_event_objects
               (tenant_id, object_type, object_id, occurred_at)
        """
    )

    # ------------------------------------------------------------------
    # Object-to-object relations (O2O).
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_object_links (
            link_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id          UUID NULL,
            from_type          TEXT NOT NULL,
            from_id            TEXT NOT NULL,
            to_type            TEXT NOT NULL,
            to_id              TEXT NOT NULL,
            qualifier          TEXT NOT NULL,
            resolution         TEXT NOT NULL,
            source             TEXT NOT NULL,
            first_observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_observed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_process_object_links_resolution
                CHECK (resolution IN ('resolved', 'ambiguous'))
        )
        """
    )
    # The upsert key: a re-observation of the same link from the same source
    # moves last_observed_at instead of inserting a second row.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_process_object_links_link
            ON coord.process_object_links
               (tenant_id, from_type, from_id, to_type, to_id, qualifier, source)
            NULLS NOT DISTINCT
        """
    )
    # The reverse direction (to -> from) the unique key's prefix cannot serve.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_object_links_to
            ON coord.process_object_links (tenant_id, to_type, to_id)
        """
    )
    # The retention prune (Phase 5).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_object_links_last_observed_at
            ON coord.process_object_links (last_observed_at)
        """
    )

    # ------------------------------------------------------------------
    # Projector watermarks, one per (source, stamp column).
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_log_watermarks (
            source           TEXT NOT NULL,
            stamp            TEXT NOT NULL,
            watermark_ts     TIMESTAMPTZ NULL,
            watermark_key    TEXT NULL,
            rows_projected   BIGINT NOT NULL DEFAULT 0,
            late_rows_found  BIGINT NOT NULL DEFAULT 0,
            last_error       TEXT NULL,
            completed_at     TIMESTAMPTZ NULL,
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (source, stamp)
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_flow_snapshots (
            tenant_id    UUID NOT NULL,
            computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            window_days  INTEGER NOT NULL,
            body         JSONB NOT NULL,
            PRIMARY KEY (tenant_id, computed_at),
            CONSTRAINT ck_process_flow_snapshots_window_days
                CHECK (window_days > 0)
        )
        """
    )
    # The worker's age-based prune.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_flow_snapshots_computed_at
            ON coord.process_flow_snapshots (computed_at)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_conformance_verdicts (
            tenant_id         UUID NOT NULL,
            constraint_id     TEXT NOT NULL,
            case_type         TEXT NOT NULL,
            case_id           TEXT NOT NULL,
            verdict           TEXT NOT NULL,
            reason            TEXT NULL,
            evaluated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            window_closes_at  TIMESTAMPTZ NULL,
            evidence          JSONB NOT NULL DEFAULT '{}'::jsonb,
            PRIMARY KEY (tenant_id, constraint_id, case_type, case_id),
            CONSTRAINT ck_process_conformance_verdicts_verdict
                CHECK (verdict IN ('held', 'violated', 'unknown'))
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_forecasts (
            forecast_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID NOT NULL,
            question      TEXT NOT NULL,
            object_type   TEXT NOT NULL,
            object_id     TEXT NOT NULL,
            issued_at     TIMESTAMPTZ NOT NULL,
            horizon_secs  INTEGER NOT NULL,
            p             DOUBLE PRECISION NOT NULL,
            predicted     JSONB NOT NULL DEFAULT '{}'::jsonb,
            resolved_at   TIMESTAMPTZ NULL,
            observed      JSONB NULL,
            CONSTRAINT ck_process_forecasts_p CHECK (p >= 0 AND p <= 1),
            CONSTRAINT ck_process_forecasts_horizon_secs CHECK (horizon_secs > 0)
        )
        """
    )
    # Issuing is idempotent: one forecast per question, object and entry time.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_process_forecasts_issue
            ON coord.process_forecasts
               (tenant_id, question, object_type, object_id, issued_at)
        """
    )
    # The resolver's queue: unresolved forecasts by age.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_forecasts_unresolved
            ON coord.process_forecasts (issued_at)
            WHERE resolved_at IS NULL
        """
    )

    # ------------------------------------------------------------------
    # Source-stamp indexes on EXISTING coord tables, built CONCURRENTLY.
    # ------------------------------------------------------------------
    with op.get_context().autocommit_block():
        # Phase 2: work_unit.status_changed
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_work_unit_status_history_transitioned_at
                ON coord.work_unit_status_history (transitioned_at, history_id)
                WHERE transitioned_at IS NOT NULL
            """
        )
        # Phase 2: plan.authored (new units)
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_work_units_created_at
                ON coord.work_units (created_at, id)
                WHERE created_at IS NOT NULL
            """
        )
        # Phase 2: work_unit.pr_cited
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_work_unit_pr_citations_cited_at
                ON coord.work_unit_pr_citations (cited_at, id)
                WHERE cited_at IS NOT NULL
            """
        )
        # Phase 2: phase.attested
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_work_unit_phase_attestations_attested_at
                ON coord.work_unit_phase_attestations (attested_at, id)
                WHERE attested_at IS NOT NULL
            """
        )
        # Phase 2: phase.retracted
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_work_unit_phase_attestations_retracted_at
                ON coord.work_unit_phase_attestations (retracted_at, id)
                WHERE retracted_at IS NOT NULL
            """
        )
        # Phase 2: pr.author_bound
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_repo_branches_author_bound_at
                ON coord.repo_branches (author_bound_at, repo, branch)
                WHERE author_bound_at IS NOT NULL
            """
        )
        # Phase 2: proposal.* and proposal.status_changed
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_merge_proposals_updated_at
                ON coord.merge_proposals (updated_at, proposal_id)
                WHERE updated_at IS NOT NULL
            """
        )
        # Phase 2: gate.registered
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_gates_created_at
                ON coord.gates (created_at, gate_id)
                WHERE created_at IS NOT NULL
            """
        )
        # Phase 2: gate.condition_met
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_gates_condition_met_since
                ON coord.gates (condition_met_since, gate_id)
                WHERE condition_met_since IS NOT NULL
            """
        )
        # Phase 2: gate.cleared
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_gates_cleared_at
                ON coord.gates (cleared_at, gate_id)
                WHERE cleared_at IS NOT NULL
            """
        )
        # Phase 2: gate.continuation_dispatched (the existing index covers only PENDING rows)
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_gates_continuation_dispatched_at
                ON coord.gates (continuation_dispatched_at, gate_id)
                WHERE continuation_dispatched_at IS NOT NULL
            """
        )
        # Phase 2: gate.continuation_consumed
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_gates_continuation_consumed_at
                ON coord.gates (continuation_consumed_at, gate_id)
                WHERE continuation_consumed_at IS NOT NULL
            """
        )
        # Phase 2: gate.continuation_cancelled
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_gates_continuation_cancelled_at
                ON coord.gates (continuation_cancelled_at, gate_id)
                WHERE continuation_cancelled_at IS NOT NULL
            """
        )
        # Phase 2: gate.continuation_expired
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_gates_continuation_expired_at
                ON coord.gates (continuation_expired_at, gate_id)
                WHERE continuation_expired_at IS NOT NULL
            """
        )
        # Phase 2: gate.continuation_deferred
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_gates_continuation_deferred_at
                ON coord.gates (continuation_deferred_at, gate_id)
                WHERE continuation_deferred_at IS NOT NULL
            """
        )
        # Phase 2: gate.archived
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_gates_archived_at
                ON coord.gates (archived_at, gate_id)
                WHERE archived_at IS NOT NULL
            """
        )
        # Phase 3: claim.*
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_claims_audit_occurred_at
                ON coord.claims_audit (occurred_at, id)
                WHERE occurred_at IS NOT NULL
            """
        )
        # Phase 3: operator.touch
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_operator_touches_emitted_at
                ON coord.operator_touches (emitted_at, touch_id)
                WHERE emitted_at IS NOT NULL
            """
        )
        # Phase 3: operator.touch resolution
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_operator_touches_resolved_at
                ON coord.operator_touches (resolved_at, touch_id)
                WHERE resolved_at IS NOT NULL
            """
        )
        # Phase 3: touch classification folds
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_operator_touch_classifications_classified_at
                ON coord.operator_touch_classifications (classified_at, classification_id)
                WHERE classified_at IS NOT NULL
            """
        )
        # Phase 3: question.asked
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_agent_questions_created_at
                ON coord.agent_questions (created_at, question_id)
                WHERE created_at IS NOT NULL
            """
        )
        # Phase 3: question.responded
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_agent_questions_responded_at
                ON coord.agent_questions (responded_at, question_id)
                WHERE responded_at IS NOT NULL
            """
        )
        # Phase 3: message.created
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_session_messages_created_at
                ON coord.session_messages (created_at, message_id)
                WHERE created_at IS NOT NULL
            """
        )
        # Phase 3: message.delivered
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_session_messages_delivered_at
                ON coord.session_messages (delivered_at, message_id)
                WHERE delivered_at IS NOT NULL
            """
        )
        # Phase 3: message.read
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_session_messages_read_at
                ON coord.session_messages (read_at, message_id)
                WHERE read_at IS NOT NULL
            """
        )
        # Phase 3: message.acked
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_session_messages_acked_at
                ON coord.session_messages (acked_at, message_id)
                WHERE acked_at IS NOT NULL
            """
        )
        # Phase 3: finding.triaged
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_findings_triaged_at
                ON coord.findings (triaged_at, finding_id)
                WHERE triaged_at IS NOT NULL
            """
        )
        # Phase 3: alert.claimed
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_alerts_claimed_at
                ON coord.alerts (claimed_at, id)
                WHERE claimed_at IS NOT NULL
            """
        )
        # Phase 3: decision.outcome_labeled
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_policy_rule_resolutions_outcome_labeled_at
                ON coord.policy_rule_resolutions (outcome_labeled_at, resolution_id)
                WHERE outcome_labeled_at IS NOT NULL
            """
        )
        # Phase 3: work_unit.dispatched
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_work_unit_dispatches_dispatched_at
                ON coord.work_unit_dispatches (dispatched_at, dispatch_id)
                WHERE dispatched_at IS NOT NULL
            """
        )
        # Phase 3: work_unit.dispatch_consumed
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_work_unit_dispatches_consumed_at
                ON coord.work_unit_dispatches (consumed_at, dispatch_id)
                WHERE consumed_at IS NOT NULL
            """
        )
        # Phase 3: expectation.* (current status only)
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_session_expectations_updated_at
                ON coord.session_expectations (updated_at, id)
                WHERE updated_at IS NOT NULL
            """
        )
        # Phase 3: deploy.declared
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_deploy_signatures_created_at
                ON coord.deploy_signatures (created_at, id)
                WHERE created_at IS NOT NULL
            """
        )
        # Phase 3: deploy.verified
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_deploy_verifications_created_at
                ON coord.deploy_verifications (created_at, id)
                WHERE created_at IS NOT NULL
            """
        )
        # Phase 3: session.footer_recorded
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_session_compliance_updated_at
                ON coord.session_compliance (updated_at, id)
                WHERE updated_at IS NOT NULL
            """
        )
        # Phase 3: policy.read
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_session_policy_reads_read_at
                ON coord.session_policy_reads (read_at, read_id)
                WHERE read_at IS NOT NULL
            """
        )
        # Phase 2: a gate's terminal verdict other than `cleared` (`failed`,
        # `withdrawn`, `misconfigured`) carries no stamp but `evaluated_at`,
        # which must stay UNINDEXED (module docstring). The reader finds new
        # terminal rows here and filters `evaluated_at > watermark` itself.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_proclog_gates_terminal_unarchived
                ON coord.gates (gate_id)
                WHERE verdict <> 'open' AND archived_at IS NULL
            """
        )


def downgrade() -> None:
    """Drop the 37 stamp indexes (CONCURRENTLY), then the seven tables."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_gates_terminal_unarchived"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_work_unit_status_history_transitioned_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_work_units_created_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_work_unit_pr_citations_cited_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_work_unit_phase_attestations_attested_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_work_unit_phase_attestations_retracted_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_repo_branches_author_bound_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_merge_proposals_updated_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_gates_created_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_gates_condition_met_since"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_gates_cleared_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_gates_continuation_dispatched_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_gates_continuation_consumed_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_gates_continuation_cancelled_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_gates_continuation_expired_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_gates_continuation_deferred_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_gates_archived_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_claims_audit_occurred_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_operator_touches_emitted_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_operator_touches_resolved_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_operator_touch_classifications_classified_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_agent_questions_created_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_agent_questions_responded_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_session_messages_created_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_session_messages_delivered_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_session_messages_read_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_session_messages_acked_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_findings_triaged_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_alerts_claimed_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_policy_rule_resolutions_outcome_labeled_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_work_unit_dispatches_dispatched_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_work_unit_dispatches_consumed_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_session_expectations_updated_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_deploy_signatures_created_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_deploy_verifications_created_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_session_compliance_updated_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_proclog_session_policy_reads_read_at"
        )

    op.execute("DROP TABLE IF EXISTS coord.process_forecasts")
    op.execute("DROP TABLE IF EXISTS coord.process_conformance_verdicts")
    op.execute("DROP TABLE IF EXISTS coord.process_flow_snapshots")
    op.execute("DROP TABLE IF EXISTS coord.process_log_watermarks")
    op.execute("DROP TABLE IF EXISTS coord.process_object_links")
    op.execute("DROP TABLE IF EXISTS coord.process_event_objects")
    op.execute("DROP TABLE IF EXISTS coord.process_events")
