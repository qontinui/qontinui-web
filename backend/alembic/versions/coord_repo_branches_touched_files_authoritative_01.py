"""coord.repo_branches.touched_files_authoritative_at — the citation re-enrich skip stamp

Revision ID: coord_repo_branches_touched_files_authoritative_01
Revises: coord_ci_job_observations_02
Create Date: 2026-09-15

Phase 1 of plan
``2026-09-10-citation-reenrich-is-unrunnable-and-plan-pr-is-unclassifiable``.

coord authors zero ``coord.*`` DDL (``[policy: alembic-sole-authorship]``), so
the column coord's citation re-enrich pass will stamp lands here, and this
revision must be applied before coord reads it.

What it is for
==============

coord's citation re-enrich pass (``citation_reenrich.rs``) re-hydrates
``touched_files`` on PR rows whose citations are document-eligible, so the
read-time ``document_citation`` classifier stops treating a plan-document PR as
delivery. Its selection has no skip rule: an unclassifiable row (``'{}'``) or a
genuine code PR (``false``) is re-selected — and for a TERMINAL PR re-read from
GitHub's PR-files API — on every call. Phase 2 of the plan schedules the pass,
which is only viable with a durable skip rule.

Semantics
=========

``NULL`` means "not authoritatively hydrated" — the state every existing row
starts in, so this revision needs no backfill. A non-NULL value is the instant
the pass set ``touched_files`` on a TERMINAL (merged/closed) PR row from
GitHub's PR-files API, which is immutable once the PR is terminal — including
the ``'{}'`` outcomes (>=100 files, a 404, an empty list). The pass never
re-selects a stamped row.

Why a new column and not ``last_refreshed_at``
==============================================

``last_refreshed_at`` has many writers in coord's ``data/repo_branches.rs``
(push, PR-event and rebind paths all stamp it), so it cannot carry "this file
list came from the authoritative source". A dedicated column has exactly one
writer. Deliberately a timestamp rather than a boolean: it answers "when".

Locking
=======

Nullable with no default, so the ADD is catalogue-only and rewrites no row.
That has always been true of a nullable ``ADD COLUMN`` with no default; what
PostgreSQL 11 added was the fast path for a non-volatile ``DEFAULT``, which
this revision deliberately does not use.

No rewrite is not no lock. The ``ALTER`` still takes ``ACCESS EXCLUSIVE`` on
``coord.repo_branches``, which coord upserts on every ``push`` and
``pull_request`` webhook (``data/repo_branches.rs`` ``PUSH_HEAD_UPSERT_SQL``,
``ingest_pull_request``), and Phase 2's scheduled pass runs an unindexed
full-table aggregate over the same table every tick. A queued ACCESS EXCLUSIVE
request blocks every reader and writer arriving behind it for as long as the
one in-flight transaction ahead of it runs, so both directions bound the wait
with ``SET LOCAL lock_timeout = '3s'`` and restore the default afterwards --
env.py runs the batch in ONE transaction, so an unrestored ``SET LOCAL`` would
leak into the next revision in the same upgrade. A blocked apply then fails
fast and is retried, instead of queueing in front of coord's ingest with no
bound and no failure.

Copy the bracket from ``coord_ci_job_observations_01`` (this revision's
great-grandparent, three ``down_revision`` hops back through
``coord_ci_job_observations_02`` and ``coord_ci_runner_quarantines_01``), which
states the guard and restores the default in both directions. Do NOT copy it
from ``prcheckruns_base_sha_01``: that revision applies the same shape to the
equally hot ``coord.pr_check_runs``, but it sets the bound WITHOUT restoring it
-- as do 14 of the 18 revisions in this tree that carry a bracket at all. On
the single-transaction batch above, every one of those caps the lock wait of
whatever DDL follows it in the same upgrade.

Merge-train classifier disposition
==================================

The lock bracket makes this revision's ``upgrade()`` unclassifiable, and that
is the known price of the guard rather than a defect. coord's classifier
selects on CHANGED files, not added-only (``pr_merge/engine.rs``
``select_migration_disposition_files``), and ``SET ...`` matches no branch of
``classify_sql_statement``, so it falls through to the fail-closed arm
(``migration_classifier.rs``) and any ``auto_if_provably_safe`` escalate policy
covering this glob returns Blocked instead of clearing. 17 landed revisions
already pay this. ``downgrade()`` is not scanned at all.

No index: every query that reads the stamp in coord either aggregates it
(``bool_or``/``bool_and`` inside ``citation_reenrich::select_candidate_groups_sql``
and its twin ``citation_population_metrics::reenrich_candidates_sql``, where
``owes_stamp`` is an aggregate OUTPUT filtered afterwards and so cannot be
served by an index at all) or merely projects it. The one query that does
filter on it directly, ``citation_population_metrics::UNCLASSIFIABLE_SQL``,
runs inside the same 120 s memoized recompute as the candidates query, which
already scans the table wholesale -- so an index would add write amplification
to a table upserted on every webhook and save nothing.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
#
# This id is 50 characters, and that turned out to be load-bearing for the
# readers rather than for alembic. A child spelling its parent the way the
# alembic template does -- `down_revision: str | Sequence[str] | None = "<id>"`
# -- is 96 columns with this id in it, past the repo's 88-column ruff budget,
# so `ruff format` wraps the value in parentheses. No GATE here does that:
# `[tool.ruff] exclude` lists `alembic`, and both enforcement lanes honour it
# (backend-ci runs `ruff format --check .`, and the pre-commit hook's entry
# carries `--force-exclude`). What still rewraps is a direct
# `ruff format <file>`, which does not apply `exclude` to a named path. Two
# parsers then read the wrapped form as NO parent: this repo's head gate
# (widened to accept it in
# #1370, `scripts/ci/_alembic_graph.py`), and coord's, which derives the graph
# from its mirror and was line-scoped -- on 2026-09-16 that made this revision
# parentless, put a second authored head in coord's count and blocked three
# coord deploys on `deploy-coord.yml`'s drift gate while alembic itself read a
# healthy single head. The sole child, `plan_library_06_scan_root_slug_census`,
# therefore keeps its `down_revision` un-annotated on one line, and its comment
# says that holds "until a coord build carrying [the parser fix] is SERVING".
#
# MEASURED 2026-09-20, re-runnable: `coord_query_release_state` -> ecs
# `qontinui-staging/coord` gives the serving sha, then
# `git -C qontinui-coord merge-base --is-ancestor <fix> <serving>`. That
# condition is MET. The serving coord `6f2c7c44ed1d` carries qontinui-coord
# `8e167261e` ("read a down_revision that spans lines"),
# so the wrapped spelling no longer blocks a deploy. The one-line spelling is
# kept anyway -- re-wrapping an applied revision buys nothing -- but a future
# author is bound by the 88-column arithmetic, not by that expired condition.
revision: str = "coord_repo_branches_touched_files_authoritative_01"
down_revision: str | Sequence[str] | None = "coord_ci_job_observations_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable skip stamp and its comment."""
    # Bound the DDL's lock wait: the ADD rewrites nothing but still takes
    # ACCESS EXCLUSIVE on a table coord's webhook ingest writes continuously,
    # and a queued request for it blocks every reader behind it. Fail fast
    # instead of stalling ingest behind one slow in-flight query.
    op.execute("SET LOCAL lock_timeout = '3s'")

    # `IF NOT EXISTS` matches on NAME only; acceptable because no revision in
    # this chain spells `touched_files_authoritative_at`.
    op.execute(
        """
        ALTER TABLE coord.repo_branches
            ADD COLUMN IF NOT EXISTS touched_files_authoritative_at TIMESTAMPTZ
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.repo_branches.touched_files_authoritative_at IS
            'Set by coord''s citation re-enrich pass when touched_files on a '
            'TERMINAL PR row was hydrated from GitHub''s PR-files API; a '
            'stamped row is never re-selected.'
        """
    )

    # env.py runs the whole batch in one transaction, so leaving this set would
    # silently impose a 3 s ceiling on the next revision's DDL too.
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the column — a CATALOGUE inverse, not a data one.

    The comment goes with the column, so the catalogue returns exactly to its
    prior shape and ``up -> down -> up`` leaves no residue. The DATA does not
    come back: the stamp IS the skip ledger, so dropping it re-arms one
    Background GitHub PR-files read for every terminal cited PR in the fleet --
    the exact cost the column exists to prevent, and the reason the pass was
    unrunnable on a schedule before it. Structural residue-freedom is therefore
    not a statement that this round trip is cheap.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.repo_branches
            DROP COLUMN IF EXISTS touched_files_authoritative_at
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")
