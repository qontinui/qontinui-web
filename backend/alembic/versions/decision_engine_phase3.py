"""coord Decision Engine (Policy Engine v2) — Phase 3: feedback-flywheel linkage

Revision ID: decision_engine_phase3
Revises: decision_engine_phase1_kind_nullable
Create Date: 2026-05-28

Phase 3 of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-05-28-coordination-decision-engine-design.md``
(§6.2 the flywheel, §11 Phase 3).

Closes the loop: a decision → the agent's choice → the observed outcome → a
labeled data point that future Mode-C / confidence calibration reads.

The provenance + flywheel columns ``served_policy_version`` /
``resolution_payload`` / ``agent_decision`` / ``outcome`` /
``outcome_category`` were already added on ``coord.policy_rule_resolutions``
by ``decision_engine_phase0``. The ONE thing still missing is the
**resolution↔unit linkage**: a resolution row carries no key that the
``on_retrospective`` hook (which fires at unit-land with only a ``unit_id`` =
merge-proposal id) can map back from.

Linkage decision (§6.2 — the core design problem):

* At ``coord_request_policy`` time the engine reliably knows the caller's
  ``device_id`` and ``tenant_id`` from the validated JWT (``CallerIdentity``),
  and NOTHING ELSE that is stable — the agent is mid-decision and has not yet
  produced a merge proposal, so the eventual ``unit_id`` does not exist yet.
* At unit-land the ``on_retrospective`` hook has ``unit_id`` →
  ``coord.merge_proposals.agent_id`` → ``coord.agent_worktrees.device_id``
  (the same join ``tenant_scope::resolve_tenant_from_agent_id`` already walks).
* Therefore ``device_id`` is the cleanest stable key that BOTH sides can
  produce. This migration stamps it on the resolution row as
  ``requester_device_id``; the labeling sweep attributes a landed unit's
  outcome to that device's *acted-upon* resolutions (those with an
  ``agent_decision`` recorded but no ``outcome_category`` yet), most-recent
  first.

This migration:

* Adds ``requester_device_id UUID`` (nullable — a resolution may come from a
  service/non-device token) to ``coord.policy_rule_resolutions``.
* Adds ``outcome_labeled_at TIMESTAMPTZ`` (nullable — set when the flywheel
  labels the row) for idempotency + observability of the labeling step.
* Adds the partial index the labeling sweep queries on: the unlabeled,
  decision-recorded rows for a ``(tenant_id, requester_device_id)``.

ALEMBIC IS THE SOLE ``coord.*`` SCHEMA AUTHOR (per the §10 SUPERSEDED note +
the §11 posture banner): there is NO Rust self-heal mirror for these columns;
``coord/tests/coord_schema_authorship.rs`` fails CI on any production-Rust
``coord.*`` DDL. Every statement here is idempotent
(``ADD COLUMN IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS``).
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "decision_engine_phase3"
down_revision: str = "decision_engine_phase1_kind_nullable"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive Phase-3 flywheel linkage on coord.policy_rule_resolutions.
    Idempotent. Does not alter or drop any existing column."""

    op.execute(
        """
        ALTER TABLE coord.policy_rule_resolutions
            ADD COLUMN IF NOT EXISTS requester_device_id UUID,
            ADD COLUMN IF NOT EXISTS outcome_labeled_at  TIMESTAMPTZ
        """
    )

    # The labeling sweep (on_retrospective) queries: for a landed unit's
    # device, the not-yet-labeled resolutions that the agent acted on
    # (agent_decision IS NOT NULL), most-recent first. The partial index
    # covers exactly that hot path. Predicate is `outcome_category IS NULL`
    # ONLY (an IMMUTABLE expression — no now()/clock function), so Postgres
    # accepts it; the recency window + agent_decision filter live in the
    # query in hooks/retrospective.rs.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_policy_rule_resolutions_unlabeled_device
            ON coord.policy_rule_resolutions (tenant_id, requester_device_id, resolved_at DESC)
            WHERE outcome_category IS NULL
        """
    )

    # The warm-confidence calibration read (build_guidance) queries labeled
    # outcomes for a policy. Index the labeled rows by policy for that
    # Beta-posterior count. Predicate is `outcome_category IS NOT NULL`
    # (IMMUTABLE).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_policy_rule_resolutions_labeled_policy
            ON coord.policy_rule_resolutions (policy_id, outcome_category)
            WHERE outcome_category IS NOT NULL
        """
    )


def downgrade() -> None:
    """Reverse the Phase-3 additions. coord.policy_rule_resolutions itself
    (owned by coord_policy_rules_rename) survives; only the Phase-3 columns
    and indexes are removed."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_policy_rule_resolutions_labeled_policy"
    )
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_policy_rule_resolutions_unlabeled_device"
    )
    op.execute(
        """
        ALTER TABLE coord.policy_rule_resolutions
            DROP COLUMN IF EXISTS outcome_labeled_at,
            DROP COLUMN IF EXISTS requester_device_id
        """
    )
