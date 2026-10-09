"""Build-record GitHub visibility re-check: per-slug cursor + the rate budget.

Revision ID: brs_03_build_record_visibility_check
Revises: brs_02_build_record_unpublish
Create Date: 2026-10-09

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``.

The scheduled task ``build_record_visibility_recheck``
(``app/jobs/build_record_reconcile.py``) re-asks GitHub whether every repo on
each LIVE public page is still public, and retracts a page whose repo went
private. GitHub reads are rate-limited (60/hour anonymous per egress IP), so
each tick spends a hard budget of calls, counted in repos.

Four columns on ``web.build_record_public_slugs`` hold the per-slug cursor:

* ``last_visibility_attempt_at`` — when the re-check last FINISHED with this
  slug, whatever the outcome (a complete answer, or giving up on an
  unanswerable repo). The tick orders by it, NULL first, so a slug GitHub
  cannot answer moves behind the others instead of wedging the head of the
  queue. Not set when the tick itself stopped (transport error, rate limit)
  or ran out of budget mid-slug — those are not the slug's fault.
* ``last_visibility_check_at`` — when every repo last got a definite answer.
* ``visibility_check_offset`` — repos (sorted) already answered in the current
  pass, so a slug wider than one tick's budget resumes instead of restarting.
* ``visibility_unknown_attempts`` — consecutive give-ups; at 6 the page is
  retracted (a repo that stays unanswerable is not KNOWN public).

And one singleton row, ``web.github_rate_budget``, holds the last
``X-RateLimit-Remaining`` / ``X-RateLimit-Reset`` GitHub reported to either the
publish route or the re-check. Publish refuses while the budget is at or below
its reserve and the window has not reset, so the re-check cannot spend the
calls a publish needs. A singleton table with ``CHECK (id)`` follows this
repo's own precedents (``project.scheduler_settings`` ``CHECK (id = 1)``,
``coordinator_leader_singleton`` ``CHECK (id = TRUE)``); there is no generic
key/value settings table to put it in.

Why the database and not process memory, for both: the backend redeploys more
often than hourly and runs more than one replica. An in-memory cursor would
restart after every deploy and differ per replica, and an in-memory budget
would be invisible to the replica serving the next publish.

Additive only. Hand-authored, never ``--autogenerate``d.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "brs_03_build_record_visibility_check"
down_revision: str | Sequence[str] | None = "brs_02_build_record_unpublish"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SLUGS = "build_record_public_slugs"


def upgrade() -> None:
    """Add the four cursor columns and the rate-budget singleton."""
    op.add_column(
        _SLUGS,
        sa.Column(
            "last_visibility_attempt_at", sa.DateTime(timezone=True), nullable=True
        ),
        schema="web",
    )
    op.add_column(
        _SLUGS,
        sa.Column(
            "last_visibility_check_at", sa.DateTime(timezone=True), nullable=True
        ),
        schema="web",
    )
    op.add_column(
        _SLUGS,
        sa.Column(
            "visibility_check_offset",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        schema="web",
    )
    op.add_column(
        _SLUGS,
        sa.Column(
            "visibility_unknown_attempts",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        schema="web",
    )
    op.create_table(
        "github_rate_budget",
        sa.Column("id", sa.Boolean(), primary_key=True, server_default=sa.text("true")),
        sa.Column("remaining", sa.Integer(), nullable=True),
        sa.Column("reset_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("id", name="ck_github_rate_budget_singleton"),
        schema="web",
    )


def downgrade() -> None:
    """Drop the singleton and the cursor columns."""
    op.drop_table("github_rate_budget", schema="web")
    for column in (
        "visibility_unknown_attempts",
        "visibility_check_offset",
        "last_visibility_check_at",
        "last_visibility_attempt_at",
    ):
        op.drop_column(_SLUGS, column, schema="web")
