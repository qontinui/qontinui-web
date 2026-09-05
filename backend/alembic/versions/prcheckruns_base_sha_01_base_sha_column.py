"""coord.pr_check_runs — add base_sha (the default-branch tip a check run was built against)

Revision ID: prcheckruns_base_sha_01
Revises: coord_agent_questions_audience_backfill
Create Date: 2026-09-05

Phase 1b of plan
``2026-09-05-a-red-pr-is-classified-before-coord-looks-at-behind-so-a-stale-base-is-never-refreshed``.

The defect this serves
----------------------
coord's CI tier classifies a PR as ``ci-not-green`` from the check-run rollup
alone, and that tier short-circuits before the BEHIND tier ever runs — so a PR
whose red was produced against a since-fixed ``main`` is never refreshed, and a
transient red on ``main`` fossilises on every PR built while it was red. Coord
cannot tell that red from a genuine one because it has NO notion of the base a
check run was measured against: ``coord.pr_check_runs`` carries ``head_sha`` and
``head_branch`` and nothing about the base.

Why the base must be a COLUMN, stamped at creation
--------------------------------------------------
The tested base cannot be recovered after the fact. Measured 2026-09-05:
GitHub's ``workflow_run.pull_requests[0].base.sha`` and
``check_run.pull_requests[0].base.sha`` are the base branch's CURRENT tip at
read time, not the tip the run was built against — a run created on 2026-09-02
while ``main`` was at ``62ffe43e`` reads today's tip through either. So the
base is captured when coord FIRST observes the run and never overwritten by a
later delivery or a REST re-read. The write contract, for coord's writer
(plan Phase 1c, ``pr_state::ingest_check_run``)::

    stamp on first observation; COALESCE(existing, incoming) on upsert;
    never overwrite a non-NULL value.

``NULL`` means UNKNOWN — a row written before this landed, or a run whose base
coord could not establish (an empty ``pull_requests`` array on a fork PR, a
push race). Readers treat NULL as fail-closed UNKNOWN (the PR stays plain
``ci-not-green``), never as "the current tip". Staleness itself
(``git rev-list --count <base_sha>..<main tip>``) is computed at read time and
is deliberately NOT stored here.

Why this revision lands before any coord read
---------------------------------------------
Served policy ``production-and-cost`` ``alembic-sole-authorship``: alembic is
the sole author of ``coord.*`` DDL, and a coord read of a new column lands
AFTER its migration — they deploy independently, and a missing column on an
existing table is not caught at boot (the 2026-07-13 ``default_source``
incident: ten days of ``42703`` on every policy load). Coord stages its read
behind the ``schema_read_contract`` ``KNOWN_MISSING`` waiver until the pinned
migrator carries this revision.

Why the view is rebuilt in the same revision
--------------------------------------------
PostgreSQL expands ``SELECT *`` at view-creation time and stores the resolved
column list, so a column added to the base table afterwards is INVISIBLE
through ``coord.pr_check_runs_latest`` until the view is re-executed
(``prcheckruns_headbranch_02_latest_view`` verified this on PG and exists only
to close that trap for ``head_branch``). The rollup reader
(``pr_merge/github_checks.rs``) goes through the view — verdict readers use
the view, repair paths use the table — so without the rebuild the column would
exist and the one reader that needs it would ``42703``.

Shape
-----
* ``ALTER TABLE ... ADD COLUMN IF NOT EXISTS base_sha TEXT`` — nullable, no
  default, no index (the view's readers look up by ``(repo, head_sha)``, which
  ``idx_pr_check_runs_head_sha`` already covers; ``base_sha`` is projected, not
  filtered). Additive, no rewrite.
* ``COMMENT ON COLUMN`` carries the write contract into the catalog, where a
  reader of ``\\d+`` sees it beside the type.
* ``CREATE OR REPLACE VIEW coord.pr_check_runs_latest`` with the SELECT
  ``prcheckruns_latest_03_conclusive_first`` defined — same ``DISTINCT ON``,
  same conclusive-first tiebreak, same ``SELECT *`` — re-executed so ``*``
  re-expands over the new column. ``CREATE OR REPLACE`` is legal because
  ``base_sha`` is APPENDED: every existing output column keeps its position,
  name and type, and one column joins at the end. No drop, no reader downtime;
  a coord binary's SQL is byte-identical before and after.

Idempotent: re-applying re-adds nothing, re-comments the same text and
rebuilds the same view. ``SET LOCAL lock_timeout`` bounds the ACCESS EXCLUSIVE
wait so a queued DDL request cannot stall coord's check-run upserts behind one
slow in-flight read.

Downgrade
---------
``CREATE OR REPLACE VIEW`` cannot REMOVE a column from a view, and the column
cannot be dropped while the view's stored projection depends on it. So the
downgrade drops the view, drops the column, and re-creates the view from the
``prcheckruns_latest_03_conclusive_first`` text verbatim (kept here as
``_LATEST_VIEW_CONCLUSIVE_FIRST`` — the same text the upgrade executes, since
the upgrade changes the projection by re-expansion, not by editing the SELECT).
The view is absent for the instant between the two statements of the same
transaction; a downgrade is not a zero-downtime path and does not claim to be.

The ``DROP COLUMN`` lives inside ``downgrade()`` and nowhere else on purpose:
the ``coord-column-drop-guard`` CI gate scans the whole module MINUS the
``downgrade()`` body for ``coord.*`` drops, and this revision's upgrade path
drops nothing.

Chains off the single head on ``origin/main`` at authoring
(``coord_agent_questions_audience_backfill``, counted with
``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``). If another revision
lands first, this one re-points its ``down_revision`` — never ``alembic merge``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "prcheckruns_base_sha_01"
down_revision: str | Sequence[str] | None = "coord_agent_questions_audience_backfill"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Verbatim from prcheckruns_latest_03_conclusive_first.py. The SELECT does not
# change in either direction: the upgrade re-executes it so `*` re-expands over
# `base_sha`; the downgrade re-executes it after the column is gone so `*`
# contracts again. One constant, so the two cannot drift from each other or
# from the revision that defined the tiebreak.
_LATEST_VIEW_CONCLUSIVE_FIRST = """
    CREATE OR REPLACE VIEW coord.pr_check_runs_latest AS
        SELECT DISTINCT ON (repo, head_sha, name) *
        FROM coord.pr_check_runs
        ORDER BY repo, head_sha, name,
                 COALESCE(conclusion IN ('cancelled', 'stale'), FALSE) ASC,
                 started_at DESC NULLS LAST, check_id DESC
"""


def upgrade() -> None:
    """Add ``base_sha`` and re-expand ``pr_check_runs_latest`` over it."""
    # Bound the DDL's lock wait: a queued ACCESS EXCLUSIVE request blocks every
    # reader that arrives behind it, so fail fast instead of stalling coord's
    # check-run upserts and rollup reads behind one slow in-flight query.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.pr_check_runs
            ADD COLUMN IF NOT EXISTS base_sha TEXT NULL
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_check_runs.base_sha IS
            'The default-branch tip this check run was built against, stamped '
            'once when coord first observes the run and never overwritten '
            '(COALESCE on upsert): GitHub''s pull_requests[].base.sha reads the '
            'CURRENT base tip, so the tested base is unrecoverable after the '
            'fact. NULL is UNKNOWN (a row written before this column existed, '
            'or a run whose base could not be established) and readers fail '
            'closed on it. Base staleness is computed at read time, not stored.'
        """
    )
    op.execute(_LATEST_VIEW_CONCLUSIVE_FIRST)


def downgrade() -> None:
    """Drop ``base_sha`` and restore the ``prcheckruns_latest_03`` view exactly."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    # The view's stored projection names base_sha, so it must go first; CREATE
    # OR REPLACE cannot narrow a view. Re-created below from the same text.
    op.execute("DROP VIEW IF EXISTS coord.pr_check_runs_latest")
    op.execute("ALTER TABLE coord.pr_check_runs DROP COLUMN IF EXISTS base_sha")
    op.execute(_LATEST_VIEW_CONCLUSIVE_FIRST)
