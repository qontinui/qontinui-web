"""completion_reports — typed completion-report payload columns on coord.tasks.

Revision ID: cr01a2b3c4d5
Revises: section_5b_01_ui_bridge_causal_columns
Create Date: 2026-05-04

Phase 1 of the productivity-coordinator-completion-reports plan
(D:/qontinui-root/plans/productivity-coordinator-completion-reports.md §2).

Adds three columns to ``coord.tasks``:

- ``completion_report`` (jsonb, nullable) — typed payload that flows along
  resolved dependency edges. Schema is the Rust ``CompletionReport`` struct
  in ``database/pg/completion_reports.rs`` (camelCase per serde rename).
- ``completion_source`` (text, nullable) — enum tag identifying who wrote
  the report. Validated server-side; values include
  ``session-self-report``, ``reviewer-attestation``, ``github-merge``,
  ``ci-pipeline``, ``manual-user-fire``, ``legacy-pre-completion-reports``.
- ``assignment_brief_extras`` (jsonb, nullable) — Phase 2 transient stash
  for per-assignment upstream report aggregations. Introduced here so the
  Phase 2 migration chain doesn't churn the same table.

Adds a CHECK constraint ``tasks_done_requires_report`` enforcing that any
row whose status is ``done`` must have non-null completion_report and
completion_source. Existing ``done`` rows are backfilled with a placeholder
report tagged ``legacy-pre-completion-reports`` before the constraint
applies.

Adds two partial indexes:

- ``idx_tasks_completion_source`` (btree on ``completion_source``) for
  dashboard reporting queries that filter by source.
- ``idx_tasks_completion_report_gin`` (GIN ``jsonb_path_ops`` on
  ``completion_report``) for Coordinator-side containment queries against
  the JSONB structure (e.g. "any upstream with non-empty breaking_changes",
  "any blocking follow-up"). ``jsonb_path_ops`` is preferred over the
  default ``jsonb_ops`` because the queried operators are containment (@>)
  and key-path lookups, not top-level key existence (?, ?&, ?|).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cr01a2b3c4d5"
down_revision: str = "section_5b_01_ui_bridge_causal_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Placeholder report applied to legacy `done` rows so the CHECK constraint
# can be added retroactively without rejecting them. CamelCase keys match
# the Rust serde rename for `CompletionReport`.
_LEGACY_PLACEHOLDER_REPORT_JSON = (
    '{"summaryMd": "Legacy completion (pre-2026-05-04 — no structured report).", '
    '"deliverables": [], "breakingChanges": [], "followUps": [], "artifacts": {}}'
)


def upgrade() -> None:
    # 1. completion_report (jsonb, nullable).
    op.add_column(
        "tasks",
        sa.Column("completion_report", postgresql.JSONB(), nullable=True),
        schema="coord",
    )

    # 2. completion_source (text, nullable). Validated at the application
    #    layer (CompletionSource enum); a CHECK on a text column would
    #    add migration churn every time a new source lands.
    op.add_column(
        "tasks",
        sa.Column("completion_source", sa.Text(), nullable=True),
        schema="coord",
    )

    # 3. assignment_brief_extras (jsonb, nullable) — Phase 2 transient stash
    #    introduced here to avoid churning the migration chain in Phase 2.
    op.add_column(
        "tasks",
        sa.Column("assignment_brief_extras", postgresql.JSONB(), nullable=True),
        schema="coord",
    )

    # 4. Backfill legacy `done` rows BEFORE adding the CHECK constraint, so
    #    pre-existing terminal-state rows don't get rejected.
    op.execute(
        sa.text(
            f"""
            UPDATE coord.tasks
               SET completion_report = '{_LEGACY_PLACEHOLDER_REPORT_JSON}'::jsonb,
                   completion_source = 'legacy-pre-completion-reports'
             WHERE status = 'done'
               AND completion_report IS NULL
            """
        )
    )

    # 5. CHECK constraint enforcing report-and-done semantics for future rows.
    op.create_check_constraint(
        "tasks_done_requires_report",
        "tasks",
        "status != 'done' OR (completion_report IS NOT NULL AND completion_source IS NOT NULL)",
        schema="coord",
    )

    # 6. Indexes — use op.execute for the GIN one because alembic
    #    op.create_index does not natively expose `jsonb_path_ops` on the
    #    expression; the WHERE clauses make both indexes partial so empty
    #    rows don't pay storage.
    op.execute(
        "CREATE INDEX idx_tasks_completion_source "
        "ON coord.tasks(completion_source) "
        "WHERE completion_source IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX idx_tasks_completion_report_gin "
        "ON coord.tasks USING GIN (completion_report jsonb_path_ops) "
        "WHERE completion_report IS NOT NULL"
    )


def downgrade() -> None:
    # Drop in reverse order of upgrade.
    op.execute("DROP INDEX IF EXISTS coord.idx_tasks_completion_report_gin")
    op.execute("DROP INDEX IF EXISTS coord.idx_tasks_completion_source")
    op.drop_constraint(
        "tasks_done_requires_report",
        "tasks",
        schema="coord",
        type_="check",
    )
    op.drop_column("tasks", "assignment_brief_extras", schema="coord")
    op.drop_column("tasks", "completion_source", schema="coord")
    op.drop_column("tasks", "completion_report", schema="coord")
