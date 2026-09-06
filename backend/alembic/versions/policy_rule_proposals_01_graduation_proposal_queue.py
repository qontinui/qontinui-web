"""coord policy_rule_proposals — agent-proposed policy-row graduation queue

Revision ID: policy_rule_proposals_01
Revises: plan_library_04_diagnostic_refutes
Create Date: 2026-09-06

Phase 2a of plan
``qontinui-dev-notes/plans/2026-09-06-decision-policy-rows-are-operator-only-to-create.md``.

Why a NEW table and not a reuse
===============================

Phase 2 of the plan originally asserted that an agent-proposed graduation of
``coord.policy_rules.autonomy_level`` could land in ``coord.prompt_document_proposals``
"in the same store and shape the prompt-document proposals use". Vet finding
**V5** measured that against ``origin/main`` and REFUTED it. The store is
prompt-document-specific in its columns and in its approve path:

* ``prompt_doc_proposals_01_policy_edit_proposal_queue.py`` declares
  ``doc_kind``, ``doc_name``, ``proposed_content`` and ``base_version`` all
  **NOT NULL**, and all four are prompt-document coordinates. A policy row is
  addressed by a UUID ``policy_id``; a graduation carries no content body; and
  ``coord.policy_rules`` has no ``current_version`` column for a
  ``base_version`` to pin against.
* coord's ``NewProposal`` (``crates/coord/src/policy_proposals.rs``) has no
  field that can hold a policy-row address, and ``from_tier``/``to_tier`` are
  the ``policy_clauses::TIERS`` vocabulary ordered by ``tier_rank`` — a
  different vocabulary from the three autonomy levels.
* ``approve_proposal`` applies a **clause edit** through
  ``policy_clauses::apply_clause_edit`` → ``prompt_documents::apply_document_edit_tx``,
  returns a ``document_version``, and reports ``DocumentGone`` / ``ClauseGone``
  / ``MetaPolicy``. It is a prompt-document review queue end to end.

The tempting shortcut — widening ``coord.prompt_document_proposals`` with
nullable policy columns — is **deliberately rejected** by the plan: it makes
four NOT NULL columns nullable for every existing row and leaves one table
meaning two things. What IS reused is the *pattern*, not the table: a
computable direction, tightening lands / loosening queues, a ``pending`` row
carrying ``proposed_by`` + ``rationale``, separation of duty at decision time,
a staleness guard, and the deploy-ordering posture (reads degrade to an empty
queue on ``42P01``; writes never degrade, because a proposal that was not
persisted must never be reported as recorded — the agent's edit was refused on
the strength of it).

What this migration creates
===========================

``coord.policy_rule_proposals`` — one row per re-routed (loosening) write to a
``coord.policy_rules`` row that an agent could not apply directly. Seeded use
is the ``autonomy_level`` graduation described in the plan's D1 table:
``always_escalate`` → ``guidance_only`` / ``auto_decide``. The operator's
approval in the console (D3's pending-proposals band) IS the graduation.

Column notes
============

* ``policy_id`` — **FK to ``coord.policy_rules(policy_id)`` ON DELETE CASCADE.**
  Note the referenced column is ``policy_id``, not ``id``: that is the primary
  key ``coord_policy_rules_rename`` gave the table. The FK matches the one
  in-family precedent, ``coord.policy_rules.overrides_system_rule_id``
  (``coord_policy_rules_tenant_override``), which uses exactly this reference
  and cascade. The cascade is right on the merits too — a proposal to graduate
  a row that no longer exists is not reviewable, and leaving it pending would
  put an unapprovable item at the top of the operator's queue forever.

  This deliberately DIVERGES from ``prompt_document_proposals``, which has no
  FK to ``coord.prompt_documents``. Its stated reason does not transfer: a
  prompt document is addressed by the natural key ``(tenant_id, doc_kind,
  doc_name)`` and is re-seeded under a NEW ``id`` on every deploy, so an FK
  there would break proposals across a re-seed. ``coord.policy_rules`` rows are
  authored, not seeded-and-reminted, and a UUID ``policy_id`` is their only
  address — so here the FK is the honest constraint.

* ``tenant_id`` — UUID NOT NULL, **no foreign key**, matching every coord
  ancestor (``coord.prompt_documents``, ``coord.agent_registry``,
  ``coord.policy_rules``, ``coord.prompt_document_proposals``). coord-side
  tenant seeding is warn-and-continue, and an FK would silently re-introduce
  the inert-feature failure class.

* ``field`` — which column of the policy row the proposal changes. Seeded use
  is ``autonomy_level``; ``enabled``, ``priority``, ``repo`` and ``expires_at``
  are the plan's per-field classifier arms and reach the same queue, which is
  why the target is a column NAME rather than a dedicated pair of
  autonomy-level columns.

* ``from_value`` — **the CAS / staleness guard, and the reason this table needs
  no ``base_version``.** It is the value of ``field`` the proposal was computed
  against. ``coord.policy_rules`` carries no version column to pin a
  ``base_version`` to (the check ``prompt_document_proposals`` performs against
  ``coord.prompt_documents.current_version`` is simply unavailable here), so
  approve compares ``from_value`` to the row's live value and refuses when they
  disagree: the row moved under the proposal. Compare-and-swap on the value is
  the natural analogue of compare-on-version for a store with no version.

* ``to_value`` — the proposed value. Both value columns are ``TEXT`` because
  the classifier is per-``field`` and the fields it covers are a mix of TEXT,
  BOOLEAN, INTEGER and TIMESTAMPTZ; the column stores the value's text form and
  the Rust seam owns the per-field parse.

* ``notification_ref`` — the ``coord.findings.finding_id`` the write call
  carried (D2: notification is the PRECONDITION of the write, not a report
  filed after it), so the operator reaches the author's stated reasoning in one
  click. ``UUID`` rather than ``TEXT`` for the reason ``pdann_01`` gives on the
  identically-named column it added to ``coord.prompt_document_versions``: that
  is what a finding id IS in this schema, and ``TEXT`` would admit a malformed
  id no read can ever resolve. **NULLABLE and deliberately NO FK** — coord
  findings carry a 14-day TTL and are purged, while a decided proposal is a
  permanent audit record that must outlive the finding that occasioned it. No
  table in this schema references ``coord.findings``.

* ``proposed_by`` / ``decided_by`` — free-text authenticated identities (the
  server-derived ``agent:``/``device:``-prefixed actor for the former, an
  operator user for the latter), never client-supplied. No FK to a users table:
  the two identity spaces differ. This mirrors ``prompt_document_proposals``
  and preserves the ``policies/routes.rs`` invariant that the actor is never
  read from the request body.

* No ``updated_at``. The only mutation a row ever takes is its decision, and
  ``decided_at`` records that; a second timestamp with no writer and no trigger
  is a column that can only go stale. (``prompt_document_proposals`` carries
  one; it is not load-bearing there either.)

CHECK constraints — and the divergence this one records
=======================================================

``direction`` and ``status`` carry named CHECKs. This DIVERGES from
``prompt_doc_proposals_01``, whose docstring argues vocab columns should stay
CHECK-free so vocabulary evolution never requires a migration. Within the
``policy_rule*`` family the convention runs the other way and is followed here:
``coord.policy_rules.kind`` has carried a CHECK since ``coord_policy_rules_rename``,
and ``coord.policy_rule_resolutions.outcome_category`` gained one in
``decision_engine_phase0``. Three further reasons:

1. Both vocabularies here are genuinely CLOSED by the design, not open by it.
   ``coord.policy_rules.autonomy_level`` has exactly three values
   (``always_escalate`` / ``guidance_only`` / ``auto_decide``, the column
   default being the first), and three ordered values admit exactly two
   directions. The decision lifecycle is three-valued in the plan's own D1/D3
   (pending → approved | rejected).
2. The write path is a security surface. Vet finding V2's resolution was to
   convert a reviewer's assumption into an enforced constant rather than a
   sentence in a doc comment; a CHECK is that same move at the column, and it
   turns a Rust bug into a constraint violation instead of an unreadable row
   the operator must adjudicate.
3. Relaxing one is cheap and this repo has the pattern for it. The constraints
   are NAMED — ``ck_policy_rule_proposals_direction`` /
   ``ck_policy_rule_proposals_status`` — precisely so a widening can drop and
   re-add them by name, the way ``plan_library_04`` widened
   ``ck_work_artifacts_kind`` and ``decision_engine_phase0`` relaxed
   ``policy_rules_kind_check``.

``direction`` admits ``tightening`` as well as ``loosening`` even though D1
lands a tightening immediately rather than queueing it: the column records the
classifier's verdict verbatim, and a vocabulary that cannot spell the other
outcome cannot be audited against the classifier.

Indexes
=======

* ``idx_policy_rule_proposals_tenant_status`` on
  ``(tenant_id, status, created_at DESC)`` — the pending-queue read D3's
  proposals band issues, tenant-scoped and newest-first. Same shape as
  ``ix_prompt_document_proposals_tenant_status``.
* ``idx_policy_rule_proposals_policy`` on ``(policy_id, created_at DESC)`` —
  per-row history ("what has been proposed for this policy?"), spelled like the
  sibling ``idx_policy_rule_resolutions_policy``.
* ``uq_policy_rule_proposals_pending`` — **partial** unique index on
  ``(tenant_id, policy_id, field) WHERE status = 'pending'``. At most one OPEN
  proposal per field of a row; decided rows (``approved``/``rejected``) are
  unconstrained, so the full history accumulates. Adopted on the merits: a
  retrying agent would otherwise fill the operator's queue with duplicate
  pending rows, and approving one leaves its twins silently unapprovable (their
  ``from_value`` CAS now fails) — queue noise the operator has to diagnose. The
  unique violation gives coord a ``23505`` to translate into the typed answer
  the agent actually wants ("a pending proposal already exists for this field"),
  which is the correct idempotent response to a retry. The partial-unique shape
  is the family's own: ``uq_policy_rules_tenant_override``
  (``coord_policy_rules_tenant_override``) and ``uq_priority_sets_tenant_name_repo``
  (``decision_engine_phase0``) both spell it this way.

Naming uses the ``idx_``/``uq_`` prefixes the ``policy_rule*`` family already
uses, not ``ix_``.

Deploy ordering and authorship
==============================

``[policy: alembic-sole-authorship]`` — alembic is the SOLE author of
``coord.*`` schema and coord's Rust authors ZERO coord DDL, so this revision
ships **no** runtime self-heal mirror (contrast ``policies::table::ensure_policy_tables``,
which predates the clause and mirrors ``coord.policy_rules``). This migration
must therefore LAND IN QONTINUI-WEB BEFORE coord reads the table; until it has,
coord's read path degrades to an empty queue on ``42P01`` and its write path
refuses rather than degrading.

Idempotency: every statement uses ``IF NOT EXISTS`` / ``IF EXISTS``. The
downgrade is symmetric and drops indexes before the table.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "policy_rule_proposals_01"
down_revision: str = "plan_library_04_diagnostic_refutes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the agent-proposed policy-row graduation queue."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.policy_rule_proposals (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id        UUID NOT NULL,
            policy_id        UUID NOT NULL
                                 REFERENCES coord.policy_rules(policy_id)
                                 ON DELETE CASCADE,
            field            TEXT NOT NULL,
            from_value       TEXT NOT NULL,
            to_value         TEXT NOT NULL,
            direction        TEXT NOT NULL
                CONSTRAINT ck_policy_rule_proposals_direction
                CHECK (direction IN ('tightening', 'loosening')),
            rationale        TEXT NOT NULL,
            proposed_by      TEXT NOT NULL,
            notification_ref UUID,
            status           TEXT NOT NULL DEFAULT 'pending'
                CONSTRAINT ck_policy_rule_proposals_status
                CHECK (status IN ('pending', 'approved', 'rejected')),
            decided_by       TEXT,
            decided_at       TIMESTAMPTZ,
            decision_note    TEXT,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # The proposals band's only list read: tenant-scoped, filtered by status,
    # newest first.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_policy_rule_proposals_tenant_status
            ON coord.policy_rule_proposals (tenant_id, status, created_at DESC)
        """
    )

    # Per-policy-row proposal history.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_policy_rule_proposals_policy
            ON coord.policy_rule_proposals (policy_id, created_at DESC)
        """
    )

    # At most one OPEN proposal per (tenant, policy row, field). Decided rows
    # are exempt, so the history accumulates.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_rule_proposals_pending
            ON coord.policy_rule_proposals (tenant_id, policy_id, field)
            WHERE status = 'pending'
        """
    )


def downgrade() -> None:
    """Drop the proposal queue (no data migrated in, plain drop)."""
    op.execute("DROP INDEX IF EXISTS coord.uq_policy_rule_proposals_pending")
    op.execute("DROP INDEX IF EXISTS coord.idx_policy_rule_proposals_policy")
    op.execute("DROP INDEX IF EXISTS coord.idx_policy_rule_proposals_tenant_status")
    op.execute("DROP TABLE IF EXISTS coord.policy_rule_proposals")
