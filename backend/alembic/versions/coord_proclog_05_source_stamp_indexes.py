"""Source-stamp indexes the process-log projector pages on

Revision ID: coord_proclog_05
Revises: coord_proclog_04
Create Date: 2026-10-12

Phase 1 of plan ``2026-10-11-process-twin-event-log-and-flow-metrics``. The
coord projector (Phases 2-3) pages every source on a per-``(source, stamp)``
watermark: ``WHERE <stamp> > $watermark ORDER BY <stamp>, <key>`` every 30 s
(plan D1). Most sources have no single monotone "changed at" column, so each
lifecycle stamp is its own watermark — and a 30 s page read over an unindexed
stamp is a sequential scan per tick, on a database the plan's Risks section
already reads as under pressure. Applied in production before any coord read
(``[policy: alembic-sole-authorship]``).

How the list was derived (the Phase 0 index census)
===================================================

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
===================

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
========================================================

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
=========================================================

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
==============================================================

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

Revision 05 also changes live tables now, unlike 01-04: every insert or stamp
update on the 21 indexed tables maintains the new indexes, and the planner may
choose them for existing coord queries.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_proclog_05"
down_revision: str | Sequence[str] | None = "coord_proclog_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one partial CONCURRENTLY index per unindexed stamp. Idempotent."""
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
    """Drop exactly the indexes upgrade() created. Tables are untouched."""
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
