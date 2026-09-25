"""coord.pr_files: head_sha, so a PR's file rows can be pinned to the head they describe.

Revision ID: coord_pr_files_head_sha_01
Revises: coord_wu_authored_at_02
Create Date: 2026-09-25

Phase 1 of plan
``qontinui-dev-notes/plans/2026-09-25-coord-pr-files-is-keyed-by-pr-not-by-head-so-the-secrets-hold-infers-head-freshness.md``.
Additive, nullable, no backfill.

What this adds
==========================================================================

One nullable column and one index on ``coord.pr_files``::

    ALTER TABLE coord.pr_files ADD COLUMN head_sha TEXT

    CREATE INDEX CONCURRENTLY idx_pr_files_repo_pr_head
    ON coord.pr_files (repo, pr_number, head_sha)

Why: the table's primary key is ``(repo, pr_number, path)``, so a row says
*which files this PR touches* and never *at which head*. coord's absent-proposal
secrets hold (``pr_merge::engine::absent_sweep_secrets_hold``, shipped by the
parent plan ``2026-09-13-escalate-path-block-is-agent-clearable-on-evidence``)
needs the second fact, because a file list belonging to an older head can omit a
secrets-touching file the newest push added. Lacking the column, it INFERS
head-freshness from the write order of coord's ``persist_hydrated`` — latest
``hydration`` event, every row written at or after it, re-read pin on the event
and the live head. The shipped code's own doc comment names the residual that
survives that reconstruction and the remedy: *"closing it needs ``head_sha`` on
``pr_files`` (or rows + event in one transaction)"*. This is that column.

No backfill, and that is deliberate
==========================================================================

Every existing row takes NULL, and NULL is read as UNKNOWN — not as "belongs to
the current head". The hold is fail-closed, so an UNKNOWN row list holds the PR
rather than releasing it. A guessed value (the PR's current ``head_sha`` from
``coord.repo_branches``, say) would be exactly the false confidence this column
exists to remove: the rows may genuinely predate that head, and asserting
otherwise would let the secrets hold clear on a stale list. Existing rows become
head-pinned when coord next hydrates that PR and rewrites them.

Deploy ordering
==========================================================================

Nothing reads or writes this column yet. The coord change that writes it
(Phase 2 of the plan, in ``persist_hydrated``) and the one that reads it
(Phase 3, in ``pinned_file_list``) both land AFTER this revision is at head and
DEPLOYED — served policy ``production-and-cost`` ``alembic-sole-authorship``.
That ordering matters more than usual here because ``persist_hydrated`` runs on
every hydration tick for every PR: an ``INSERT ... head_sha`` against a database
that has not taken this migration would be a hard error on coord's hottest write
path. coord already ships the mechanism for surviving the gap
(``crates/coord/src/schema_readiness.rs``); the coord PRs declare the column
there rather than assuming this revision is live.

The index, and why its key is (repo, pr_number, head_sha)
==========================================================================

Phase 3's read is ``WHERE repo = $1 AND pr_number = $2 AND head_sha = $3``, and
this index is that access path stated rather than inferred.

It is deliberately a superset of the existing ``idx_pr_files_repo_pr (repo,
pr_number)``, which stays: the DEPLOYED coord build still reads by ``(repo,
pr_number)`` alone, so dropping the shorter index in the same revision that adds
the longer one would remove the index the running code uses. Rows per PR are
capped at coord's hydration page size (``HYDRATION_FILES_PAGE_CAP`` = 100), so
the measurable speedup is small; the value is that the head-pinned read no longer
rides an index that does not mention the column it filters on. Whether to retire
``idx_pr_files_repo_pr`` is a separate revision, after Phase 3 has deployed.

Locking: ADD COLUMN in the transaction, the index outside it
==========================================================================

``ADD COLUMN ... NULL`` with no default is a catalog-only change in Postgres —
no table rewrite — but it still takes a brief ACCESS EXCLUSIVE lock, and a
QUEUED ACCESS EXCLUSIVE request blocks every reader and writer arriving behind
it. ``coord.pr_files`` is written by every hydration tick, so the ALTER bounds
its wait with ``SET LOCAL lock_timeout = '3s'`` (the convention of
``coord_alerts_claim_01`` and ``coord_agent_questions_audience``): failing fast
is a retry, stalling is an outage. ``RESET lock_timeout`` afterwards is REQUIRED
— ``env.py`` runs every revision of one ``alembic upgrade`` in a single
transaction, so an unreset ``SET LOCAL`` would leak into every later revision.

The index is built ``CONCURRENTLY`` (a plain ``CREATE INDEX`` takes a
write-blocking ``SHARE`` lock for the duration of a scan over the whole table).
``CONCURRENTLY`` cannot run inside a transaction, hence
``op.get_context().autocommit_block()`` — the ``coord_alerts_claim_01``
precedent. The ALTER runs first so the autocommit block's implicit COMMIT
publishes the column before the index build needs it.

A killed or failed CONCURRENTLY build leaves an **INVALID** index of the same
name, which the planner never uses and which ``IF NOT EXISTS`` alone would keep
— a migration reporting success while the index never serves a query. So before
the CREATE, the upgrade looks the index up in ``pg_index`` and, if it exists with
``indisvalid = false``, drops it (CONCURRENTLY) so the CREATE rebuilds it. A
re-run ends with a valid index or a loud failure.

Downgrade drops the index (CONCURRENTLY) and then the column. The head pinning is
lost, which is the correct reversal of an additive revision — every row reverts
to the UNKNOWN it holds today, and coord's hold stays fail-closed. The file rows
themselves survive.
"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pr_files_head_sha_01"
down_revision: str | Sequence[str] | None = "coord_wu_authored_at_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _index_is_invalid(index_name: str) -> bool:
    """True when ``coord.<index_name>`` exists and is INVALID (a failed build)."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT NOT i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        )
        .scalar()
    )


def upgrade() -> None:
    """Add the nullable head_sha column, then the CONCURRENT index. Idempotent."""
    # Bound the ALTER's ACCESS EXCLUSIVE wait: coord.pr_files is rewritten by
    # every hydration tick, and a queued exclusive lock blocks everyone behind it.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.pr_files
            ADD COLUMN IF NOT EXISTS head_sha TEXT
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")

    with op.get_context().autocommit_block():
        # A failed earlier CONCURRENTLY build leaves an INVALID index that
        # IF NOT EXISTS would keep. Drop it so the CREATE below rebuilds it.
        if _index_is_invalid("idx_pr_files_repo_pr_head"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_pr_files_repo_pr_head"
            )
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook parses the raw SQL inside `op.execute(...)` to prove
        # every CREATE/DROP names its schema, and an interpolated string is not
        # statically analysable.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_pr_files_repo_pr_head
            ON coord.pr_files (repo, pr_number, head_sha)
            """
        )


def downgrade() -> None:
    """Drop the index, then the head_sha column. The file rows survive."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_pr_files_repo_pr_head")

    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.pr_files
            DROP COLUMN IF EXISTS head_sha
        """
    )
    op.execute("RESET lock_timeout")
