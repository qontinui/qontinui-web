"""design_refs capture_job.browser — launched vs operator-attached capture

Revision ID: design_refs_jobs_01
Revises: coord_policy_outcome_counts_02
Create Date: 2026-11-16

Phase 1b-i of plan
``2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query``.
Hand-authored — never ``alembic revision --autogenerate`` (served policy
``production-and-cost`` ``alembic-sole-authorship``). Product data in the
``design_refs`` schema; no ``coord.*`` relation is touched.

``design_refs_01`` already carries the rest of the Phase 1b store (the
``capture_job`` queue with its lease, ``review_state`` / ``quality`` on every
curated record, the append-only ``correction`` log). What it lacks is the
plan's ``capture_job.browser`` (``launched`` | ``attached``): the worker
captures in a browser it launches, or attaches over CDP to the operator's own
Chrome for sites a headless browser cannot get into. The column is NOT NULL
with a ``launched`` default, so existing rows are valid unchanged.
"""

from __future__ import annotations

from alembic import op

revision: str = "design_refs_jobs_01"
down_revision: str = "coord_policy_outcome_counts_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE design_refs.capture_job "
        "ADD COLUMN IF NOT EXISTS browser varchar(16) NOT NULL DEFAULT 'launched'"
    )
    # Guarded like the column add above, so a re-run (or a database that
    # already carries the constraint) does not fail on a duplicate name.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint c
                  JOIN pg_class t ON t.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'design_refs'
                   AND t.relname = 'capture_job'
                   AND c.conname = 'ck_capture_job_browser'
            ) THEN
                ALTER TABLE design_refs.capture_job
                    ADD CONSTRAINT ck_capture_job_browser
                    CHECK (browser IN ('launched', 'attached'));
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE design_refs.capture_job DROP CONSTRAINT IF EXISTS ck_capture_job_browser"
    )
    op.execute("ALTER TABLE design_refs.capture_job DROP COLUMN IF EXISTS browser")
