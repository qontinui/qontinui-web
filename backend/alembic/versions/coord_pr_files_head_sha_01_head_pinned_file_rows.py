"""coord.pr_files: head_sha, so a PR's file rows can be pinned to the head they describe.

Revision ID: coord_pr_files_head_sha_01
Revises: coord_wu_authored_at_02
Create Date: 2026-09-25

Phase 1 of plan
``qontinui-dev-notes/plans/2026-09-25-coord-pr-files-is-keyed-by-pr-not-by-head-so-the-secrets-hold-infers-head-freshness.md``.
Additive, nullable, no backfill.

What this adds
==========================================================================

One nullable column on ``coord.pr_files``, and nothing else::

    ALTER TABLE coord.pr_files ADD COLUMN IF NOT EXISTS head_sha TEXT

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

NO INDEX — and the next reader should not add one back
==========================================================================

Phase 3's read is ``WHERE repo = $1 AND pr_number = $2 AND head_sha = $3``, and
the obvious reflex is a ``(repo, pr_number, head_sha)`` index to serve it. This
revision deliberately does NOT create one. **Do not add it without a measurement
that says it is needed.**

The existing ``idx_pr_files_repo_pr (repo, pr_number)`` already narrows that read
to at most ``HYDRATION_FILES_PAGE_CAP`` = 100 rows, and ``head_sha`` is then
filtered in the heap over those hundred rows. A third key column would save a
fraction of a hundred heap checks on a query that runs once per absent-proposal
sweep. That is not a speedup anyone can measure.

**That 100-row cap is a consequence of coord's current WRITE behaviour, not a
property of this table — so it is the thing to re-check before trusting this
paragraph.** ``persist_hydrated`` reconciles rather than accumulates: having
upserted the ``files(first: 100)`` page it runs ``DELETE FROM coord.pr_files
WHERE repo = $1 AND pr_number = $2 AND NOT (path = ANY($3))``
(``qontinui-coord crates/coord/src/pr_merge/mod.rs``), so a PR holds one head's
worth of rows and no more. Phase 2 of this plan is precisely the change that
starts writing ``head_sha``, and a head-pinned table invites RETAINING prior
heads' rows. If Phase 2 — or anything after it — stops pruning, rows per PR
become unbounded and the argument above lapses silently, because the reasoning
lives in this file while the change happens in another repo. Whoever makes that
change owns re-deciding the index.

What it would cost is concrete. ``CREATE INDEX`` without ``CONCURRENTLY`` takes a
write-blocking ``SHARE`` lock for a full table scan, which is not acceptable on a
table every hydration tick rewrites. ``CONCURRENTLY`` cannot run inside a
transaction, so it needs ``op.get_context().autocommit_block()``; a killed
concurrent build then leaves an **INVALID** index that ``IF NOT EXISTS`` would
silently keep, so a correct revision must also look the index up in ``pg_index``
and ``DROP INDEX CONCURRENTLY`` it before rebuilding. That ``DROP`` on the upgrade
path is what coord's migration classifier rejects unconditionally
(``crates/coord/src/pr_merge/migration_classifier.rs``, which rejects any
statement beginning ``DROP``; ``downgrade()`` is excluded from classification,
``upgrade()`` is not) — and the ``migrations`` escalate block that produces is
``clearable_by: classifier``, so no agent evidence can clear it and an operator
has to. An unmeasurable speedup is not worth an operator in the loop, nor the
autocommit block's implicit COMMIT, nor the INVALID-index repair path.

If measurement ever justifies the index, add it in its own revision. A revision
that only creates an index classifies on its own merits, and gets to make the
concurrency and repair trade-offs where they are the whole subject rather than a
rider on a column.

Locking
==========================================================================

``ADD COLUMN ... NULL`` with no default is a catalog-only change in Postgres —
no table rewrite — but it still takes a brief ACCESS EXCLUSIVE lock, and a
QUEUED ACCESS EXCLUSIVE request blocks every reader and writer arriving behind
it. ``coord.pr_files`` is written by every hydration tick, so the ALTER bounds
its wait with ``SET LOCAL lock_timeout = '3s'`` (the convention of
``coord_alerts_claim_01`` and ``coord_agent_questions_audience``): failing fast
is a retry, stalling is an outage. RESETTING it afterwards is REQUIRED —
``env.py`` runs every revision of one ``alembic upgrade`` in a single
transaction (one ``context.begin_transaction()``, no
``transaction_per_migration``), so an uncleared ``SET LOCAL`` would leak into
every later revision.

The reset is spelled ``SET LOCAL lock_timeout = DEFAULT``, NOT ``RESET
lock_timeout``. **The decisive reason is coord's migration classifier**, which
admits only ``SET LOCAL lock_timeout|statement_timeout = <value>`` and rejects
``RESET`` by name (``classify_set_statement``, pinned as a test case) — so the
``RESET`` spelling the precedents use is one avoidable Reject. The precedents
predate that arm (it landed 2026-09-20, after them); do not copy them here.

The scope difference is real but small, and is stated exactly rather than
overclaimed: ``= DEFAULT`` restores the CONFIGURED default, not whatever value
the session held before — so inside the run it masks a deployer-set
``lock_timeout`` just as ``RESET`` would (coord's classifier says so in the same
module). What it does NOT do is outlive the transaction: ``RESET`` is
session-scoped and persists, ``SET LOCAL`` ends at COMMIT. With ``NullPool`` and
one transaction per run that difference is close to nil, which is why the
classifier, not the scoping, is the reason to prefer this spelling.

Expected classification: AutoSafe
==========================================================================

``upgrade()`` contains no ``DROP``, no ``CREATE INDEX``, no autocommit block and
no non-additive statement — only a guarded ``ADD COLUMN`` of a nullable column
with no default, bracketed by the two ``SET LOCAL lock_timeout`` forms the
classifier admits. It is therefore expected to classify **AutoSafe** and to need
no escalate clearance at all. That is the whole reason there is no index here.

Downgrade drops the column. The head pinning is lost, which is the correct
reversal of an additive revision — every row reverts to the UNKNOWN it holds
today, and coord's hold stays fail-closed. The file rows themselves survive, and
so does ``idx_pr_files_repo_pr``, which this revision never touches in either
direction.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pr_files_head_sha_01"
down_revision: str | Sequence[str] | None = "coord_wu_authored_at_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable head_sha column. Idempotent, additive, no index."""
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
    # revision that lands after this one. `SET LOCAL ... = DEFAULT` rather than
    # `RESET` because coord's migration classifier rejects `RESET` by name, and
    # because SET LOCAL ends at COMMIT while RESET persists in the session.
    # See the module docstring for what `= DEFAULT` does and does not restore.
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the head_sha column. The file rows survive."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.pr_files
            DROP COLUMN IF EXISTS head_sha
        """
    )
    # Same reset, same reasons as in upgrade(): `SET LOCAL ... = DEFAULT`,
    # never `RESET`.
    op.execute("SET LOCAL lock_timeout = DEFAULT")
