"""Age-column indexes for coord.pr_events + policy_rule_resolutions retention.

Follow-up to ``coord_pg_overload_idx_01`` (the PG-overload fix): coord now runs
a leader-gated time-based retention sweep (``table_retention``) over the two
unbounded-growth tables. Each sweep deletes in batches keyed on
``WHERE <age_col> < now() - interval LIMIT n``. Without an index on the age
column that predicate seq-scans the whole table every sweep — reintroducing a
(milder, periodic) version of the very seq-scan cost the retention is meant to
relieve. These two indexes make both the initial backlog drain and the
steady-state "nothing to prune" check index-range scans:

- ``coord.pr_events (created_at)``            — pruned by ``created_at``  (180d default)
- ``coord.policy_rule_resolutions (resolved_at)`` — pruned by ``resolved_at`` (365d default)

Note neither table had a usable standalone age-column index: pr_events' indexes
all lead with ``repo``/``event_kind``; policy_rule_resolutions' lead with
``policy_id``/``tenant_id``/``(decision_domain)`` — none serve a global time range.

``CREATE INDEX CONCURRENTLY`` via ``autocommit_block`` (hot append-heavy tables —
a plain in-transaction build would take a write-blocking lock). Additive /
forward-only; ``upgrade`` creates ``IF NOT EXISTS``, ``downgrade`` drops
``IF EXISTS``. The coord retention sweep is correct without these (just slower),
so deploy order is not load-bearing.

Revision ID: coord_pr_events_resolutions_age_idx
Revises: coord_specq_01_speculative_ci_status
Create Date: 2026-07-01

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pr_events_resolutions_age_idx"
down_revision: str | None = "coord_specq_01_speculative_ci_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: two CONCURRENTLY age-column indexes for retention sweeps."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_events_created_at
            ON coord.pr_events (created_at)
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_policy_rule_resolutions_resolved_at
            ON coord.policy_rule_resolutions (resolved_at)
            """
        )


def downgrade() -> None:
    """Reverse the two additive indexes."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_policy_rule_resolutions_resolved_at"
        )
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_pr_events_created_at"
        )
