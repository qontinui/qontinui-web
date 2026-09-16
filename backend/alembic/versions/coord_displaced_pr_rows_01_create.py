"""coord.displaced_pr_rows — per-PR archive of repo_branches rows a rebind displaced

Revision ID: coord_displaced_pr_rows_01
Revises: coord_prepaid_balances_01
Create Date: 2026-09-14

Phase 1a of plan
``2026-09-13-coord-ff-lands-a-pr-it-never-mirrors-so-its-citation-can-never-be-observed``.

Creates ``coord.displaced_pr_rows``: one row per ``(repo, pr_number)``, holding
the last-known ``coord.repo_branches`` row of a PR whose ``(repo, branch)`` key
was taken by a LATER PR, plus coord's first observations of PRs that were
displaced before this table existed.

## Why this exists

``coord.repo_branches`` is ``PRIMARY KEY (repo, branch)``
(``coordinator_phase_a_01_coord_tables``). ``pr_number`` is a nullable column
with no uniqueness, so one branch row can describe exactly one PR. When a
second PR is opened from a branch that already produced one, coord's webhook
upsert (``UPSERT_PULL_REQUEST_SQL`` in ``qontinui-coord``
``crates/coord/src/data/repo_branches.rs``) rebinds that row to the new
``pr_number`` and takes ``pr_state`` and ``close_cause`` from the incoming PR.
The earlier PR's record, including the land stamp coord itself wrote when it
fast-forward-landed that PR, stops existing.

The realizations read joins citations to ``repo_branches`` on
``(repo, pr_number)``. After a rebind, the earlier PR matches no row, its
citation reads ``observed: false`` / ``pr_never_observed``, and that UNKNOWN
blocks its work unit from ``shipped`` permanently. The plan measured three live
units pinned this way (``a9b549fa``, ``4ddd8047``, ``feed3b66``) while their
code sat on ``origin/main``.

Changing the ``repo_branches`` key was rejected: over fifty
``ON CONFLICT (repo, branch)`` sites in coord depend on it. The fix is a
per-PR table beside it, written at the one moment information is about to be
lost.

## How coord uses it (Phases 1b-1e and 2, in qontinui-coord)

* **Writers.** A shared data-modifying CTE runs in the same statement as every
  rebinding upsert. When the stored row has a ``pr_number`` that differs from
  the incoming one, it copies that row here with ``source = 'rebind'`` and
  ``displaced_by_pr_number`` set to the incoming PR, ``ON CONFLICT (repo,
  pr_number) DO UPDATE``. The refresh door writes ``source =
  'first_observation'`` rows, with ``displaced_by_pr_number`` NULL, for PRs
  displaced before the CTE shipped. The land-seam UPDATEs fall through to this
  table when the live table matched zero rows.
* **Readers.** Prefer the live ``repo_branches`` row for a ``(repo,
  pr_number)``; fall back to this table only when no live row carries that PR.
  A PR that re-takes its branch later owns the live row again, and its archive
  row is then stale by design. Readers must not prefer it.

## Column shape

The eight carried columns (``branch``, ``base_branch``, ``head_sha``,
``pr_state``, ``close_cause``, ``merge_commit_sha``, ``merged_at``,
``touched_files``) use the SAME types as the same-named columns on
``coord.repo_branches``: ``TEXT``, ``TIMESTAMPTZ`` for ``merged_at`` and
``TEXT[]`` for ``touched_files``. They are the columns the citation reader
consumes, so the fallback read is a column-for-column UNION with the live
table.

All eight are NULLABLE with no default, unlike several of their
``repo_branches`` counterparts. A first observation sourced from a coord land
event alone has no head ref, so ``branch`` cannot be required. A NULL here
means NOT RECORDED, never an empty or default value: a ``DEFAULT
'{}'::text[]`` on ``touched_files`` would claim a PR touched no files, and a
``DEFAULT 'open'`` on ``pr_state`` would claim a landed PR is open.

``source`` carries a CHECK constraint on its two values. That is a deliberate
difference from ``ptbe_01_primary_tree_branch_events``, whose free-form
``terminal_outcome`` carries none. That column holds a vocabulary coord may
widen without a schema change. ``source`` names which WRITER produced the row,
readers branch on it, and a third value means a third writer, which should
arrive with its own migration. The cost is stated so a later reader can
weigh it: adding a source value needs a qontinui-web revision to land first.

## No tenant column (deliberate)

``coord.repo_branches`` has no ``tenant_id`` and its key is ``(repo,
branch)``. This table archives rows OF that table, so it is tenant-agnostic in
exactly the same way and keyed on the same ``repo`` value. Adding a tenant
column here would put a scope on the archive that its source row does not
have, and nothing could fill it.

## No trigger, and last_refreshed_at is the writer's job

The house has no ``CREATE TRIGGER`` anywhere in its revision chain
(``pdtier_01_prompt_document_agent_write_tier``). ``displaced_at`` and
``last_refreshed_at`` both default to ``now()``, which covers the INSERT arm
only. An ``ON CONFLICT ... DO UPDATE`` that omits ``last_refreshed_at`` freezes
it at first insert, so every writer must set it explicitly on update.
``displaced_at`` records when the row was FIRST archived and should not move on
refresh.

## No secondary index

The primary key is the lookup the reader makes: ``(repo, pr_number)``, the same
join key the realizations read uses. No planned reader filters on
``displaced_by_pr_number`` or ``displaced_at``. An index added without its
reader is cost with no query behind it.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors zero ``coord.*`` DDL. The coord change that
writes and reads this table is downstream, so this migration must be applied
in production BEFORE that coord binary ships. The plan also gates coord's read
on ``schema_readiness``, so a coord deployed ahead of this revision keeps
serving the legacy join instead of failing.

## Head choice

``down_revision`` is ``coord_prepaid_balances_01``, the repo's **single** head
when this revision was authored (``scripts/ci/count_alembic_heads.py`` reported
``HEAD_COUNT=1``). If main moves underneath it before it lands, re-point
``down_revision`` and the ``Revises:`` header at the new single head. Do not
add an ``alembic merge``: this repo keeps strict single-head discipline.

## Merge-train classifier disposition

coord's migration classifier (``qontinui-coord``
``crates/coord/src/pr_merge/migration_classifier.rs``) is expected to classify
this revision Reject, for two reasons that are both part of its contract:

* ``COMMENT ON`` is not a statement form it recognises, so it fails closed;
* it scans ``downgrade()`` too, and rejects the ``DROP TABLE`` there.

Every SQL string is a static literal, so the classifier can read every
statement. It is not rejected for being dynamic. The landed precedents
``coord_prepaid_balances_01`` and ``drr_01`` classify Reject the same way.

## Safety

``CREATE TABLE IF NOT EXISTS``, and every ``COMMENT ON`` is re-runnable, so a
partial apply re-runs cleanly. No existing table is touched or rewritten.
``downgrade()`` is ``DROP TABLE IF EXISTS``, and the comments go with the
table. Both directions are pure SQL execution with no bind or inspection, so
they work under ``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_displaced_pr_rows_01"
down_revision: str | Sequence[str] | None = "coord_prepaid_balances_01"  # fmt: skip
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The fmt skip marker above is NO LONGER load-bearing, and is kept only because
# removing it would be a no-op edit to a landed revision. DOWN_RE in
# scripts/ci/_alembic_graph.py used to read one line at a time, so the
# parenthesised form ruff format produces for an over-88-column assignment
# parsed as NO parent. That limit was closed, so the gate now reads the wrapped
# form and a re-point onto a longer head id is safe either way.
#
# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Create coord.displaced_pr_rows and document it in the catalogue."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.displaced_pr_rows (
            repo                    TEXT NOT NULL,
            pr_number               INTEGER NOT NULL,
            branch                  TEXT,
            base_branch             TEXT,
            head_sha                TEXT,
            pr_state                TEXT,
            close_cause             TEXT,
            merge_commit_sha        TEXT,
            merged_at               TIMESTAMPTZ,
            touched_files           TEXT[],
            source                  TEXT NOT NULL,
            displaced_by_pr_number  INTEGER,
            displaced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_refreshed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT displaced_pr_rows_pkey PRIMARY KEY (repo, pr_number),
            CONSTRAINT displaced_pr_rows_source_check
                CHECK (source IN ('rebind', 'first_observation'))
        )
        """
    )

    # The comments carry what the names cannot: the reader precedence, and that
    # writers own last_refreshed_at. psql describe output is where a human meets
    # this schema; the module docstring ships nowhere they will see it.
    op.execute(
        """
        COMMENT ON TABLE coord.displaced_pr_rows IS
            'Last-known coord.repo_branches row of a PR whose (repo, branch) key was taken by a later PR, plus first observations of such PRs. Keyed per PR because repo_branches is keyed per branch and a rebind otherwise destroys the earlier PR record. Readers prefer a live repo_branches row for the same (repo, pr_number) and fall back here. Writers set last_refreshed_at explicitly on every update: there is no trigger.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.displaced_pr_rows.repo IS
            'Same value as coord.repo_branches.repo for the displaced row.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.displaced_pr_rows.pr_number IS
            'The displaced PR. With repo, the key: one row per PR, never per branch.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.displaced_pr_rows.branch IS
            'Head branch the PR was on. NULL when unknown, as for a first observation sourced from a coord land event alone.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.displaced_pr_rows.source IS
            'Which writer produced the row. rebind: copied from repo_branches in the statement that rebound its branch key to another PR. first_observation: the first record of a PR displaced before rebind archiving existed.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.displaced_pr_rows.displaced_by_pr_number IS
            'The PR that took the (repo, branch) key. NULL for a first_observation row.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.displaced_pr_rows.displaced_at IS
            'When the row was first archived. Not moved on refresh.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.displaced_pr_rows.last_refreshed_at IS
            'When a writer last wrote this row. The default covers INSERT only; every ON CONFLICT DO UPDATE must set it explicitly.'
        """
    )


def downgrade() -> None:
    """Drop coord.displaced_pr_rows. Its comments and constraints go with it."""
    op.execute("DROP TABLE IF EXISTS coord.displaced_pr_rows")
