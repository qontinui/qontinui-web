"""coord.pr_check_runs — add changed_at (when a check row last changed, not last written)

Revision ID: prcheckruns_changed_at_01
Revises: overview_05_page_sources
Create Date: 2026-10-30

Phase 3a of plan
``2026-10-17-coord-overdue-floor-gives-every-seat-to-newer-inputs-so-stale-pass-and-stale-ready-block-never-fire``.

The defect this serves
----------------------
coord's overdue floor ranks a PR ``NewerInputs`` when its check rows are newer
than its last decision, and it reads that from ``updated_at``. But ``updated_at``
is a WRITE stamp: every webhook redelivery and REST re-read moves it, whether or
not anything about the check changed. So a no-change re-upsert reads as a newer
input, and ``NewerInputs`` takes every seat ahead of the stale-pass and
stale-ready arms.

Why a new column, and why it has no default
-------------------------------------------
``updated_at`` keeps its meaning, because other readers rely on it as the write
stamp. ``changed_at`` is the separate CHANGE stamp that ``NewerInputs`` will key
on. coord's writer (Phase 3b) sets it on insert, and on conflict moves it only
when a decision input differs; the read becomes
``COALESCE(changed_at, updated_at)``.

It is nullable with NO default on purpose. A ``DEFAULT now()`` would stamp every
existing row at migration time and turn the whole open population into
``NewerInputs`` at once. A NULL reads as ``updated_at``, which is what the row
reads as today, so landing this revision changes no decision.

Why the view is rebuilt in the same revision
--------------------------------------------
PostgreSQL expands ``SELECT *`` at view-creation time, so a column added to the
base table afterwards is invisible through ``coord.pr_check_runs_latest`` until
the view is re-executed (``prcheckruns_base_sha_01`` hit the same trap).

The SELECT is ``prcheckruns_latest_03_conclusive_first``'s, byte-for-byte; only
the ``*`` expands further. The statement around it differs in one way, and it is
required: ``WITH (security_invoker = true)``. ``CREATE OR REPLACE VIEW`` replaces
a view's options with its own ``WITH`` clause, so re-executing
``prcheckruns_latest_03``'s statement as written would reset the option
``coordrls_01`` set and turn the view back into an owner-rights view, which
bypasses row-level security for every tenant reading it. Setting it in the same
statement leaves no moment without it.
``tests/test_coord_views_security_invoker.py`` guards this at the head.

``CREATE OR REPLACE`` rather than a drop and re-create, because it loses nothing:
``changed_at`` is APPENDED, so every existing output column keeps its position,
name and type; the view's ACL (``coordrls_01``'s grants to ``coord_tenant`` and
``coord_tenant_preflight``) survives; and readers see no gap.

Locks
-----
``env.py`` runs a deploy batch in one transaction, so in-batch an ``ACCESS
EXCLUSIVE`` lock on this table, which coord upserts on every check-run webhook,
would be held until the whole batch commits. As in ``coordrls_01`` and
``replident_01``, each step therefore runs in an ``autocommit_block`` as its own
transaction under ``SET LOCAL lock_timeout = '3s'``.

The table and the view are deliberately TWO transactions. A reader of the view
locks the view and then the table, so one transaction taking the table and then
the view can deadlock with it. Between the two commits the view simply lacks a
column that nothing reads yet: coord's read lands in Phase 3b, after this. A lock
timeout is the correct outcome when something holds either object, and re-running
is safe because every statement here is idempotent.

Merge-train classifier disposition
----------------------------------
``CREATE OR REPLACE VIEW`` has no admitted arm in coord's
``migration_classifier.rs`` (the "unrecognized CREATE statement" fail-closed
arm), so this revision is not ``AutoSafe``, and neither was
``prcheckruns_base_sha_01``. A view rebuild is the whole point of the revision,
so that is the known price rather than a defect.

Downgrade
---------
``CREATE OR REPLACE VIEW`` cannot remove a column, and the column cannot be
dropped while the view's stored projection depends on it. So the downgrade drops
the view, drops the column and re-creates the view from the same text, in one
transaction, without ``CASCADE``: a dependent added later makes it fail loudly
rather than vanish. A dropped view loses its ACL, so ``coordrls_01``'s grants are
re-issued explicitly rather than left to default privileges, which apply only
when the migrating role is the one that declared them.

``DROP COLUMN`` lives only inside ``downgrade()`` for ``coord-column-drop-guard``,
which scans the rest of the module.

Chains off the single head at authoring (``slice_tel_01``). coord re-points
``down_revision`` at land if another revision lands first.
"""

import contextlib
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "prcheckruns_changed_at_01"
down_revision: str | Sequence[str] | None = "overview_05_page_sources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ADD_COLUMN = """
    ALTER TABLE coord.pr_check_runs
        ADD COLUMN IF NOT EXISTS changed_at timestamptz NULL
"""

_COMMENT_COLUMN = """
    COMMENT ON COLUMN coord.pr_check_runs.changed_at IS
        'When this check row last CHANGED in a way a merge decision reads, as '
        'opposed to updated_at, the write stamp every redelivery and re-read '
        'moves. Set on insert and moved on conflict only when a decision input '
        'differs. NULL is a row no change has been stamped on since this column '
        'was added: read COALESCE(changed_at, updated_at). No default on purpose, '
        'because now() would stamp every existing row at migration time and make '
        'the whole open PR population read as having newer inputs at once.'
"""

# The SELECT is verbatim from prcheckruns_latest_03_conclusive_first.py. It does
# not change in either direction: the upgrade re-executes it so `*` re-expands
# over `changed_at`, the downgrade re-executes it so `*` contracts again. The WITH
# clause keeps coordrls_01's option, which CREATE OR REPLACE VIEW would otherwise
# reset (module docs).
_LATEST_VIEW_CONCLUSIVE_FIRST = """
    CREATE OR REPLACE VIEW coord.pr_check_runs_latest WITH (security_invoker = true) AS
        SELECT DISTINCT ON (repo, head_sha, name) *
        FROM coord.pr_check_runs
        ORDER BY repo, head_sha, name,
                 COALESCE(conclusion IN ('cancelled', 'stale'), FALSE) ASC,
                 started_at DESC NULLS LAST, check_id DESC
"""


def _run_in_own_transaction(*statements: str) -> None:
    """Commit ``statements`` on their own, with the lock wait bounded to 3 s."""
    op.execute("BEGIN")
    try:
        op.execute("SET LOCAL lock_timeout = '3s'")
        for statement in statements:
            op.execute(statement)
    except BaseException:
        with contextlib.suppress(Exception):
            op.execute("ROLLBACK")
        raise
    op.execute("COMMIT")


def upgrade() -> None:
    """Add ``changed_at`` and re-expand ``pr_check_runs_latest`` over it."""
    with op.get_context().autocommit_block():
        _run_in_own_transaction(_ADD_COLUMN, _COMMENT_COLUMN)
        _run_in_own_transaction(_LATEST_VIEW_CONCLUSIVE_FIRST)


def downgrade() -> None:
    """Drop ``changed_at`` and restore the view, its option and its grants."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    # The view's stored projection names changed_at, so it must go first; CREATE
    # OR REPLACE cannot narrow a view. Re-created below from the same text.
    op.execute("DROP VIEW IF EXISTS coord.pr_check_runs_latest")
    op.execute("ALTER TABLE coord.pr_check_runs DROP COLUMN IF EXISTS changed_at")
    op.execute(_LATEST_VIEW_CONCLUSIVE_FIRST)
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON coord.pr_check_runs_latest "
        "TO coord_tenant, coord_tenant_preflight"
    )
