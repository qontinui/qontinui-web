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

Five columns on ``web.build_record_public_slugs`` hold the per-slug cursor:

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
* ``first_unanswered_attempt_at`` — when the CURRENT run of unanswered
  attempts began (cleared by any complete answer). The 24 h "attempted and
  unanswerable" ceiling is measured from here, not from the last answer, so a
  single blip on a page late in a long check cycle does not retract it.

And one singleton row, ``web.github_rate_budget``, holds the last
``X-RateLimit-Remaining`` / ``X-RateLimit-Reset`` GitHub reported to either the
publish route or the re-check. Publish refuses while the budget is at or below
its reserve and the window has not reset, so the re-check cannot spend the
calls a publish needs. A singleton table with ``CHECK (id)`` follows this
repo's own precedents (``project.scheduler_settings`` ``CHECK (id = 1)``,
``coordinator_leader_singleton`` ``CHECK (id = TRUE)``); there is no generic
key/value settings table to put it in.

And ``web.build_record_pending_not_public`` — (slug, repo) pairs GitHub
answered NOT_PUBLIC for but whose retraction could not take the owner row
lock in time. The next tick applies them at its very start — before the
budget check, which they do not need — so a "not public" verdict is
deferred, never dropped; unless the version it was about has since been
replaced or re-published, in which case that publish's own GitHub check
superseded it. No FK to the owner table on
purpose: inserting a child row takes a KEY SHARE lock on the parent, which
would wait on exactly the lock holder that made the deferral necessary.

Why the database and not process memory, for all of these: the backend redeploys more
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
    """Add the cursor columns, the rate-budget singleton, the pending table."""
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
    op.add_column(
        _SLUGS,
        sa.Column(
            "first_unanswered_attempt_at", sa.DateTime(timezone=True), nullable=True
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
    op.create_table(
        "build_record_pending_not_public",
        sa.Column("public_slug", sa.Text(), primary_key=True),
        sa.Column("repo", sa.Text(), primary_key=True),
        # The snapshot version the verdict was about; it is applied only if
        # that version is still the latest (and was published before
        # observed_at) — a later publish re-confirmed every repo itself.
        sa.Column("snapshot_version", sa.Integer(), nullable=False),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="web",
    )


def downgrade() -> None:
    """Drop the pending-verdict table, the singleton and the cursor columns."""
    op.drop_table("build_record_pending_not_public", schema="web")
    op.drop_table("github_rate_budget", schema="web")
    for column in (
        "first_unanswered_attempt_at",
        "visibility_unknown_attempts",
        "visibility_check_offset",
        "last_visibility_check_at",
        "last_visibility_attempt_at",
    ):
        op.drop_column(_SLUGS, column, schema="web")
