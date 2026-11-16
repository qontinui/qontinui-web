"""coord.session_census placement columns — the runner page a session lives on

Revision ID: coord_session_census_02
Revises: coord_fleet_focus_01
Create Date: 2026-11-16

Phase 2 (qontinui-web half) of plan
``2026-11-16-runner-page-name-reaches-the-coord-session-identity-card``
(decisions D2 and D3).

What this adds
==============

Five nullable columns on ``coord.session_census``, describing WHERE in the
runner a session is hosted:

* ``terminal_id``        — the runner terminal the session's pane belongs to.
* ``page_id``            — the runner page (tab) that terminal sits on.
* ``page_name``          — that page's operator-authored label, normalized.
* ``page_name_withheld`` — true when coord refused to store the label because
  it looked like a secret (``page_name`` is then NULL).
* ``page_window``        — the runner window the page is shown in (main or a
  popped-out window).

Plan Phase 3 (coord, not yet landed) is the first reader: coord's session
identity card (``coord_resolve_session``, ``GET /coord/agent-sessions/:id``)
and the census read will serve these as ``runner_page``, so an agent on another machine can say "the session on page
<name>, machine <name>" instead of quoting a bare session UUID.

Why the census, not a second store (D2)
=======================================

``coord.session_census`` (``coord_session_census_01``) already is the
per-device snapshot keyed by Claude ``session_id``: each runner post replaces
that device's rows wholesale in one transaction, and the census carries its own
freshness rule (older than 3x the post interval reads ``unknown``). Placement is
another fact about the same session row at the same moment, so it rides the
same post. A separate placement table would be a second snapshot of one truth,
with its own ordering and staleness to keep consistent.

Every column is NULLABLE with no default, deliberately: rows the runner does
not host (``runner_hosted = false``) have no placement, and a runner build that
predates the producer change posts none. NULL means "not reported", never
"no page" — the card turns it into a stated ``runner_page_unknown_reason``
rather than a default. ``page_name_withheld`` is likewise NULL (not false) on a
row whose placement was never reported.

Deploy order and the read (D3)
==============================

alembic is the sole author of ``coord.*`` schema
(``[policy: production-and-cost/alembic-sole-authorship]``), so this revision
lands FIRST. The contract Phase 3 implements: coord reads these columns PER
QUERY and degrades a missing column or relation
(``pg_error::is_missing_schema_object``) to ``runner_page: null`` with
``runner_page_unknown_reason: "columns_absent"``, with no boot gate on them, so
a coord build that lands ahead of this migration fails open.

The privacy rule
================

The census column list is a privacy contract (``coord_session_census_01``):
NO transcript content, NO environment values, NO credentials. These columns
keep it. ``page_name`` is operator-authored label text, not session content;
coord's Phase 3 ingest normalizes it before storing (control characters and bidi overrides
stripped, trimmed, length-capped) and stores a name that looks secret-shaped as
``page_name = NULL, page_name_withheld = true`` — the value itself is never
stored and never logged. The migration test pins the exact column set, so
widening it again is a reviewed act.

Idempotency: raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` /
``DROP COLUMN IF EXISTS`` — the house convention for ``coord.*`` column adds
(``coord_wusod_01``). All five columns are added in ONE ``ALTER TABLE``, so the
table's lock is taken once; a nullable column with no default is a catalog-only
change. The lock is held until alembic's batch transaction commits
(``alembic/env.py`` runs a whole ``upgrade`` in one transaction), so on its own
this revision is brief, but it holds the lock behind any later revision in the
same batch. Every runner census post
rewrites this table, so the ALTER first sets ``SET LOCAL lock_timeout`` (the
house style named in ``alembic/env.py``): a queued ACCESS EXCLUSIVE request
behind a long reader would otherwise stall every census post and read behind
it. A timeout fails the migration loudly instead, and it is safe to re-run.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_session_census_02"
down_revision: str | Sequence[str] | None = "coord_fleet_focus_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the five nullable placement columns. Idempotent."""
    # No CREATE SCHEMA: the table this ALTERs is coord_session_census_01's,
    # so the schema exists whenever this revision can run at all.
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        """
        ALTER TABLE coord.session_census
            ADD COLUMN IF NOT EXISTS terminal_id        TEXT NULL,
            ADD COLUMN IF NOT EXISTS page_id            TEXT NULL,
            ADD COLUMN IF NOT EXISTS page_name          TEXT NULL,
            ADD COLUMN IF NOT EXISTS page_name_withheld BOOLEAN NULL,
            ADD COLUMN IF NOT EXISTS page_window        TEXT NULL
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_census.page_name IS
            'Operator-authored label of the runner page hosting this session, '
            'normalized by coord (control and bidi characters stripped, '
            'trimmed, length-capped). NULL when not reported or withheld. '
            'Label text only, never session content.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_census.page_name_withheld IS
            'True when coord refused to store the page label because it looked '
            'secret-shaped (page_name is then NULL). NULL when placement was '
            'never reported.'
        """
    )


def downgrade() -> None:
    """Drop the five placement columns. No index or constraint to reverse."""
    # The same hot table as upgrade(): bound the lock wait the same way.
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        """
        ALTER TABLE coord.session_census
            DROP COLUMN IF EXISTS page_window,
            DROP COLUMN IF EXISTS page_name_withheld,
            DROP COLUMN IF EXISTS page_name,
            DROP COLUMN IF EXISTS page_id,
            DROP COLUMN IF EXISTS terminal_id
        """
    )
