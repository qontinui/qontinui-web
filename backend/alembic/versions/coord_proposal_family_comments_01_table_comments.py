"""coord proposal family — COMMENT ON TABLE names which member each table is

Revision ID: coord_proposal_family_comments_01
Revises: coord_iops_idx_01
Create Date: 2026-09-26

Phase 3 of plan
``2026-09-12-proposal-is-a-family-noun-pin-the-incumbent-qualify-the-newcomers``.

"proposal" is a family noun in coord: a request an actor submits for
adjudication. Five members exist (merge, policy, policy-rule, rollback,
work-plan). The UNQUALIFIED word means a merge proposal — the incumbent, with
persisted and external spellings (``proposal_id``, the ``merge_propose`` JWT
scope, ``pr_merge_*_proposal_*`` alert kinds) that are not renamed. New code
always qualifies every other member. The glossary lives in
qontinui-claude-config ``knowledge-base/qontinui-specific/coord-merge-train.md``
under "The word *proposal*".

This revision is comment-only: it puts that rule on the family's tables
themselves, so a reader of the schema (psql ``\\d+``, a schema-object query)
learns which member a table is without the glossary. A COMMENT is DDL, and
alembic is the sole author of ``coord.*`` DDL, hence a revision rather than a
coord-side statement.

Tables and the revisions that create them on this tree:

* ``coord.merge_proposals``, ``coord.merge_proposal_repos`` —
  ``coord_phase_3_01_merge_proposals`` (``op.create_table``, no ``comment=``).
* ``coord.prompt_document_proposals`` — ``prompt_doc_proposals_01`` (raw DDL,
  no COMMENT).
* ``coord.policy_rule_proposals`` — ``policy_rule_proposals_01`` (raw DDL, no
  COMMENT).
* ``coord.work_plans`` — ``coord_singleauthored_08_work_plans`` (raw DDL, no
  COMMENT). ``POST /coord/work-plans/propose`` inserts its rows with
  ``status='proposed'``.

None of the five carried a table comment before this revision, and no later
revision renames, drops or comments one, so ``downgrade()`` restores ``NULL``.

The rollback member has no table of its own: coord rebuilds a rollback proposal
from ``coord.deploy_verifications``, which is not a proposal store and is left
uncommented.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_proposal_family_comments_01"
down_revision: str | None = "coord_iops_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Attach the proposal-family comment to each member table."""
    op.execute(
        """
        COMMENT ON TABLE coord.merge_proposals IS
            'Family: proposal (merge member). The unqualified word proposal means a merge proposal; new code always qualifies every other member (policy_proposal, policy_rule_proposal, rollback_proposal, work_plan_proposal). See qontinui-claude-config knowledge-base/qontinui-specific/coord-merge-train.md, section The word proposal.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.merge_proposal_repos IS
            'Family: proposal (merge member; one row per repo of a coord.merge_proposals row). The unqualified word proposal means a merge proposal; new code always qualifies every other member. See qontinui-claude-config knowledge-base/qontinui-specific/coord-merge-train.md, section The word proposal.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.prompt_document_proposals IS
            'Family: proposal (policy member, spelled policy_proposal: an edit to a coord prompt document). Not the bare word proposal, which means a merge proposal; not a policy-row graduation, which is policy_rule_proposal (coord.policy_rule_proposals). See qontinui-claude-config knowledge-base/qontinui-specific/coord-merge-train.md, section The word proposal.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.policy_rule_proposals IS
            'Family: proposal (policy-rule member, spelled policy_rule_proposal: a coord.policy_rules autonomy graduation). Always spelled in full, never shortened to policy_proposal (coord.prompt_document_proposals) or to the bare word proposal, which means a merge proposal. See qontinui-claude-config knowledge-base/qontinui-specific/coord-merge-train.md, section The word proposal.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.work_plans IS
            'Family: proposal (work-plan member, spelled work_plan_proposal; rows start status=proposed via POST /coord/work-plans/propose). Not the bare word proposal, which means a merge proposal. See qontinui-claude-config knowledge-base/qontinui-specific/coord-merge-train.md, section The word proposal.'
        """
    )


def downgrade() -> None:
    """Restore the prior state: none of the five tables had a comment."""
    op.execute("COMMENT ON TABLE coord.work_plans IS NULL")
    op.execute("COMMENT ON TABLE coord.policy_rule_proposals IS NULL")
    op.execute("COMMENT ON TABLE coord.prompt_document_proposals IS NULL")
    op.execute("COMMENT ON TABLE coord.merge_proposal_repos IS NULL")
    op.execute("COMMENT ON TABLE coord.merge_proposals IS NULL")
