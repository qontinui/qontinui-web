"""Shape and walk tests for the ``prcheckruns_suite_01`` revision.

Phase 3a of plan
``2026-11-16-finish-session-refuses-a-finish-whose-only-owed-pr-is-ci-pending``
(D4) adds ``coord.pr_check_runs.check_suite_id BIGINT NULL`` and rebuilds
``coord.pr_check_runs_latest`` so coord's rollup reader sees it through the view.

What can go wrong that a green ``upgrade`` does not show
========================================================

* **The column exists and the view does not carry it.** PostgreSQL freezes a
  ``SELECT *`` projection at view-creation time. Asserted through
  ``information_schema.columns`` on the VIEW, against the projection the parent
  revision serves, so a column appended by a later revision cannot make this
  test stale.
* **The rebuild turns the view back into an owner-rights view.** ``CREATE OR
  REPLACE VIEW`` resets the ``security_invoker`` option ``coordrls_01`` set; the
  precedent revision this one copies predates that option. Asserted after the
  upgrade AND after the downgrade's re-create.
* **The rebuild changes the tiebreak.** The module constant is compared
  byte-for-byte with ``prcheckruns_latest_03``'s, and the served row is asserted
  on seeded data (a newer ``cancelled`` must NOT outrank an older ``success``).
* **The downgrade loses the view's grants.** ``DROP VIEW`` discards its ACL, and
  a re-create carries only what ``ALTER DEFAULT PRIVILEGES`` hands a new object.
  The walk asserts the restored ACL equals the parent's, and a second walk
  edits the ACL away from the defaults first, so a restore that only got the
  defaults right cannot pass.
* **The downgrade hands the view to the migrating role.** A re-create is owned
  by whoever runs it. A walk gives the view a non-migrator owner first and
  asserts the downgrade gives it back.
* **The upgrade deadlocks with a rollup read.** A reader locks the view, then
  the table; the upgrade must take them in that order too. A walk holds the
  table, starts the migration, starts a view reader behind it, releases, and
  asserts neither side was chosen as a deadlock victim (``40P01``). Each step
  waits on ``pg_locks`` showing the expected waiter, never on a sleep.
* **A DROP lands in the upgrade path.** Pinned by AST, as the
  ``coord-column-drop-guard`` gate requires.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. A skip proves nothing.
"""

from __future__ import annotations

import ast
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

# Pinned explicitly rather than "head" so a later revision landing on top cannot
# silently change what this test walks. `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision` — the first test enforces it. If the head moves
# before landing, re-point BOTH together.
_REVISION_ID = "prcheckruns_suite_01"
_PARENT_REVISION_ID = "coord_claude_acct_usage_05"
_REVISION_FILENAME = "prcheckruns_suite_01_check_suite_id_column.py"

# The revision whose view text this one re-executes: the ONE author of the
# conclusive-first SELECT.
_VIEW_AUTHOR_FILENAME = "prcheckruns_latest_03_conclusive_first.py"

_TABLE = "pr_check_runs"
_VIEW = "pr_check_runs_latest"
_COLUMN = "check_suite_id"
_QUALIFIED_COLUMN = "coord.pr_check_runs.check_suite_id"

_REPO = "qontinui/probe"
_HEAD = "0123456789abcdef0123456789abcdef01234567"
_T0 = datetime(2026, 11, 16, 1, 0, tzinfo=UTC)
# check_run 132651515896's check_suite.id on qontinui-coord#4159 (coord finding
# c58cd00f-7651-4dde-bd3d-d69fcc59f291): above 2^31, so the type must be BIGINT.
_SUITE_ID = 118211762840


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _versions_dir():
    return backend_root() / "alembic" / "versions"


def _revision_source() -> str:
    return (_versions_dir() / _REVISION_FILENAME).read_text(encoding="utf-8")


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    declared = declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} "
        f"but this test pins {_PARENT_REVISION_ID!r}. Re-point both together."
    )


def test_the_chain_has_one_head_and_this_revision_is_on_it() -> None:
    script = ScriptDirectory.from_config(Config(str(backend_root() / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1, f"alembic has {len(heads)} heads: {sorted(heads)}"
    walked = [rev.revision for rev in script.walk_revisions("base", heads[0])]
    assert _REVISION_ID in walked, (
        f"{_REVISION_ID} is not an ancestor of the single head {heads[0]}"
    )


def test_the_view_text_is_prcheckruns_latest_03s_verbatim() -> None:
    """The upgrade changes the projection by RE-EXPANSION of ``*`` and the
    downgrade restores it by executing the same text; both hold only while this
    constant is byte-identical to the one that defined the tiebreak."""
    under_test = load_revision_module(
        _versions_dir() / _REVISION_FILENAME, "_prcheckruns_suite_01_under_test"
    )
    author = load_revision_module(
        _versions_dir() / _VIEW_AUTHOR_FILENAME, "_prcheckruns_latest_03_author_suite"
    )
    assert (
        under_test._LATEST_VIEW_CONCLUSIVE_FIRST == author._LATEST_VIEW_CONCLUSIVE_FIRST
    ), "the view text drifted from prcheckruns_latest_03"


def test_every_drop_lives_inside_downgrade() -> None:
    """The ``coord-column-drop-guard`` scans everything BUT the downgrade path."""
    source = _revision_source()
    tree = ast.parse(source)
    downgrade = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "downgrade"
    )
    downgrade_range = range(downgrade.lineno, downgrade.end_lineno + 1)  # type: ignore[arg-type]
    drops_outside: list[int] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
            continue
        if re.search(r"\bDROP\b", node.value) is None:
            continue
        if node.lineno == 1:  # the module docstring is prose
            continue
        if node.lineno not in downgrade_range:
            drops_outside.append(node.lineno)
    assert not drops_outside, (
        f"DROP string literal(s) outside downgrade() at line(s) {drops_outside}: "
        "the upgrade path must drop nothing"
    )


# ---------------------------------------------------------------------------
# Catalog and data reads.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ViewState:
    owner: str
    security_invoker: bool
    acl: str
    columns: tuple[str, ...]


def _view_state(engine: Engine) -> ViewState:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT pg_get_userbyid(c.relowner),
                       coalesce(
                         (SELECT o.option_value::boolean
                            FROM pg_options_to_table(c.reloptions) o
                           WHERE o.option_name = 'security_invoker'),
                         false),
                       coalesce(c.relacl::text, '')
                  FROM pg_class c
                 WHERE c.oid = 'coord.pr_check_runs_latest'::regclass
                """
            )
        ).one()
        columns = conn.execute(
            text(
                """
                SELECT column_name
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :view
                 ORDER BY ordinal_position
                """
            ),
            {"view": _VIEW},
        ).fetchall()
    return ViewState(
        owner=str(row[0]),
        security_invoker=bool(row[1]),
        acl=str(row[2]),
        columns=tuple(r[0] for r in columns),
    )


def _view_oid(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT 'coord.pr_check_runs_latest'::regclass::oid::bigint")
            ).scalar_one()
        )


def _seed_cancelled_corpse_over_older_success(engine: Engine) -> None:
    """A newer ``cancelled`` attempt and an older ``success`` for one name."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_check_runs
                    (repo, head_sha, check_id, name, status, conclusion, started_at)
                VALUES
                    (:repo, :head, 2, 'Backend CI', 'completed', 'cancelled', :t1),
                    (:repo, :head, 1, 'Backend CI', 'completed', 'success',   :t0)
                """
            ),
            {"repo": _REPO, "head": _HEAD, "t0": _T0, "t1": _T0 + timedelta(hours=1)},
        )


def _served(engine: Engine) -> tuple:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT check_id, conclusion
                  FROM coord.pr_check_runs_latest
                 WHERE repo = :repo AND head_sha = :head
                """
            ),
            {"repo": _REPO, "head": _HEAD},
        ).fetchall()
    assert len(rows) == 1, (
        f"the view served {len(rows)} rows for one (repo, head, name)"
    )
    return tuple(rows[0])


# ---------------------------------------------------------------------------
# Walks — need the test Postgres.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def test_upgrade_adds_the_column_and_keeps_the_view_invoker_rights(
    _admin_url: str,
) -> None:
    """BIGINT NULL, commented from the revision's own text, visible through the
    view (appended last), and the view keeps its oid, owner, grants and
    ``security_invoker``."""
    with ephemeral_database(_admin_url, "prcheckruns_suite_01_up") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        parent = _view_state(engine)
        parent_oid = _view_oid(engine)
        assert parent.security_invoker, "the parent's view is not security_invoker"
        assert _COLUMN not in parent.columns

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert column_info(engine, _TABLE, _COLUMN) == ("bigint", "YES", None), (
            "check_suite_id must be BIGINT NULL with no default — NULL is the "
            "UNKNOWN readers fail closed on"
        )
        assert column_comment(engine, _TABLE, _COLUMN) == comment_body_from_source(
            _revision_source(), _QUALIFIED_COLUMN
        )
        after = _view_state(engine)
        assert after.columns == (*parent.columns, _COLUMN), (
            "the view must re-expand `*` over check_suite_id, appended LAST so "
            "CREATE OR REPLACE is legal and every reader's projection is unchanged"
        )
        assert after.security_invoker, (
            "CREATE OR REPLACE VIEW reset security_invoker and the revision did not "
            "set it again: the view now runs with its owner's rights"
        )
        assert (after.owner, after.acl) == (parent.owner, parent.acl)
        assert _view_oid(engine) == parent_oid, (
            "the upgrade must replace, not re-create"
        )

        _seed_cancelled_corpse_over_older_success(engine)
        assert _served(engine) == (1, "success"), (
            "the rebuilt view lost the conclusive-first tiebreak"
        )
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.pr_check_runs SET check_suite_id = :suite "
                    "WHERE repo = :repo AND check_id = 1"
                ),
                {"suite": _SUITE_ID, "repo": _REPO},
            )
        with engine.connect() as conn:
            served_suite = conn.execute(
                text(
                    "SELECT check_suite_id FROM coord.pr_check_runs_latest "
                    "WHERE repo = :repo"
                ),
                {"repo": _REPO},
            ).scalar_one()
        assert served_suite == _SUITE_ID


def test_up_down_up_restores_the_parent_view_exactly(_admin_url: str) -> None:
    """Downgrade narrows the view to the parent's projection, drops the column,
    keeps the rows, the tiebreak, ``security_invoker``, owner and grants;
    re-upgrade brings the column back."""
    with ephemeral_database(_admin_url, "prcheckruns_suite_01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        parent = _view_state(engine)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_cancelled_corpse_over_older_success(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) is None, (
            "downgrade() left check_suite_id on coord.pr_check_runs"
        )
        assert _view_state(engine) == parent, (
            "downgrade() did not restore the parent's view exactly "
            "(projection, owner, grants, security_invoker)"
        )
        assert _served(engine) == (1, "success"), (
            "the restored view lost the conclusive-first tiebreak"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        again = _view_state(engine)
        assert again.columns == (*parent.columns, _COLUMN)
        assert again.security_invoker
        assert again.acl == parent.acl
        assert _served(engine) == (1, "success")


def test_downgrade_restores_a_non_default_acl_exactly(_admin_url: str) -> None:
    """The restore replays the RECORDED grants, not the defaults.

    The ACL is moved away from what ``ALTER DEFAULT PRIVILEGES`` would hand a new
    view — one privilege revoked from every grantee the defaults name, one extra
    role granted — so a downgrade that merely re-created the view would carry the
    defaults back and fail here.
    """
    role = f"suite01_probe_{uuid.uuid4().hex[:8]}"
    with ephemeral_database(_admin_url, "prcheckruns_suite_01_acl") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with engine.begin() as conn:
            conn.execute(text(f"CREATE ROLE {role} NOLOGIN"))
        try:
            with engine.begin() as conn:
                grantees = (
                    conn.execute(
                        text(
                            """
                        SELECT DISTINCT pg_get_userbyid(a.grantee)
                          FROM pg_class c, aclexplode(c.relacl) a
                         WHERE c.oid = 'coord.pr_check_runs_latest'::regclass
                           AND a.grantee <> c.relowner
                        """
                        )
                    )
                    .scalars()
                    .all()
                )
                assert grantees, "the view carries no non-owner grant to perturb"
                for grantee in grantees:
                    conn.execute(
                        text(
                            f'REVOKE INSERT ON coord.pr_check_runs_latest FROM "{grantee}"'
                        )
                    )
                conn.execute(
                    text(
                        f"GRANT SELECT ON coord.pr_check_runs_latest TO {role} "
                        "WITH GRANT OPTION"
                    )
                )
            edited = _view_state(engine)

            run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
            restored = _view_state(engine)
            assert restored.acl == edited.acl, (
                f"downgrade() restored ACL {restored.acl!r}, recorded {edited.acl!r}"
            )
            assert restored.security_invoker
        finally:
            with engine.begin() as conn:
                conn.execute(text(f"DROP OWNED BY {role}"))
                conn.execute(text(f"DROP ROLE IF EXISTS {role}"))


def test_upgrade_is_idempotent(_admin_url: str) -> None:
    """``ADD COLUMN IF NOT EXISTS`` + ``CREATE OR REPLACE VIEW`` + the option set:
    re-running ``upgrade()`` over a migrated schema is a no-op, not an error."""
    with ephemeral_database(_admin_url, "prcheckruns_suite_01_id") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        first = _view_state(engine)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert column_info(engine, _TABLE, _COLUMN) == ("bigint", "YES", None)
        assert _view_state(engine) == first


def test_downgrade_gives_the_view_back_to_a_non_migrator_owner(
    _admin_url: str,
) -> None:
    """DROP + CREATE leaves the migrating role owning the view; the downgrade
    restores the recorded owner, and the recorded grants with it."""
    role = f"suite01_owner_{uuid.uuid4().hex[:8]}"
    with ephemeral_database(_admin_url, "prcheckruns_suite_01_own") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with engine.begin() as conn:
            conn.execute(text(f"CREATE ROLE {role} NOLOGIN"))
        try:
            with engine.begin() as conn:
                conn.execute(
                    text(f"ALTER VIEW coord.pr_check_runs_latest OWNER TO {role}")
                )
            recorded = _view_state(engine)
            assert recorded.owner == role

            run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
            restored = _view_state(engine)
            assert restored.owner == role, (
                f"downgrade() left the view owned by {restored.owner!r}, "
                f"recorded {role!r}"
            )
            assert restored.acl == recorded.acl, (
                f"downgrade() restored ACL {restored.acl!r}, recorded {recorded.acl!r}"
            )
            assert restored.security_invoker
        finally:
            with engine.begin() as conn:
                conn.execute(text(f"DROP OWNED BY {role}"))
                conn.execute(text(f"DROP ROLE IF EXISTS {role}"))


_LOCK_WAIT_DEADLINE_SECS = 120.0


def _wait_for(
    predicate: Callable[[], bool], what: str, *alive: Callable[[], bool]
) -> None:
    """Poll ``predicate`` until true; fail early if any ``alive`` check goes false."""
    deadline = time.monotonic() + _LOCK_WAIT_DEADLINE_SECS
    while time.monotonic() < deadline:
        if predicate():
            return
        for check in alive:
            assert check(), f"a participant ended before {what}"
        time.sleep(0.05)
    raise AssertionError(f"timed out waiting for {what}")


class _MigrationEnded(Exception):
    """The migration subprocess exited while the test was still sequencing."""

    def __init__(self, returncode: int, output: str) -> None:
        super().__init__(f"the migration exited {returncode}")
        self.returncode = returncode
        self.output = output


def _wait_while_migration_runs(
    proc: subprocess.Popen[str],
    predicate: Callable[[], bool],
    what: str,
    *alive: Callable[[], bool],
) -> None:
    """``_wait_for``, raising ``_MigrationEnded`` with the migration's own
    output when it exited early, so the caller can tell a ``55P03`` lock
    timeout from a ``40P01`` deadlock."""
    try:
        _wait_for(predicate, what, *alive)
    except AssertionError:
        if proc.poll() is None:
            raise
        output, _ = proc.communicate()
        raise _MigrationEnded(proc.returncode, output) from None


def _ungranted_locks(engine: Engine, pid: int | None = None) -> list[tuple]:
    """Ungranted relation locks in this database: ``(pid, relation, mode)``."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT l.pid, l.relation::regclass::text, l.mode
                  FROM pg_locks l
                 WHERE NOT l.granted
                   AND l.locktype = 'relation'
                   AND l.database = (SELECT oid FROM pg_database
                                      WHERE datname = current_database())
                   AND (CAST(:pid AS integer) IS NULL OR l.pid = :pid)
                """
            ),
            {"pid": pid},
        ).fetchall()
    return [tuple(r) for r in rows]


@dataclass
class LockOrderAttempt:
    returncode: int | None
    output: str
    reader_outcome: dict[str, object]

    def is_deadlock(self) -> bool:
        reader_error = repr(self.reader_outcome.get("error", ""))
        return (
            "40P01" in self.output
            or "deadlock" in self.output.lower()
            or "DeadlockDetected" in reader_error
        )

    def is_lock_timeout(self) -> bool:
        return (
            "55P03" in self.output
            or "LockNotAvailable" in self.output
            or "lock timeout" in self.output.lower()
        )


def _lock_order_attempt(engine: Engine, db_url: str) -> LockOrderAttempt:
    """One run of the interleaving; the database must be at the parent.

    1. A holds AccessShare on the TABLE (an in-flight reader of the table).
    2. The migration starts and waits on its table lock behind A.
    3. B reads the VIEW and waits behind the migration.
    4. A releases.
    """
    holder = engine.connect()
    reader_conn = engine.connect()
    holder_tx = holder.begin()
    migration: subprocess.Popen[str] | None = None
    reader: threading.Thread | None = None
    reader_outcome: dict[str, object] = {}
    reader_pid: int | None = None
    returncode: int | None = None
    output = ""
    try:
        holder.execute(text("SELECT count(*) FROM coord.pr_check_runs")).scalar_one()

        # Everything the reader needs before it reads is done BEFORE the
        # migration starts, so the window between the migration queueing on
        # the table and the holder's commit holds only a thread start and two
        # pg_locks polls, inside the migration's 3 s lock_timeout.
        reader_pid = int(
            reader_conn.execute(text("SELECT pg_backend_pid()")).scalar_one()
        )
        reader_conn.execute(text("SET statement_timeout = '60s'"))

        migration = subprocess.Popen(
            [sys.executable, "-m", "alembic", "upgrade", _REVISION_ID],
            cwd=backend_root(),
            env={**os.environ, "DATABASE_URL": db_url},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        proc = migration
        _wait_while_migration_runs(
            proc,
            lambda: any(
                rel == "coord.pr_check_runs" and mode == "AccessExclusiveLock"
                for _, rel, mode in _ungranted_locks(engine)
            ),
            "the migration to wait on coord.pr_check_runs",
            lambda: proc.poll() is None,
        )

        def read_view() -> None:
            try:
                reader_outcome["rows"] = reader_conn.execute(
                    text(
                        "SELECT count(*) FROM coord.pr_check_runs_latest "
                        "WHERE repo = :repo"
                    ),
                    {"repo": _REPO},
                ).scalar_one()
            except Exception as exc:  # recorded and classified by the caller
                reader_outcome["error"] = exc
            finally:
                reader_conn.close()

        reader = threading.Thread(target=read_view, daemon=True)
        reader.start()
        thread = reader
        _wait_while_migration_runs(
            proc,
            lambda: bool(_ungranted_locks(engine, reader_pid)),
            "the view reader to queue behind the migration",
            lambda: proc.poll() is None,
            thread.is_alive,
        )

        holder_tx.commit()

        output, _ = migration.communicate(timeout=_LOCK_WAIT_DEADLINE_SECS)
        returncode = migration.returncode
        reader.join(timeout=_LOCK_WAIT_DEADLINE_SECS)
        assert not reader.is_alive(), "the view reader never finished"
    except _MigrationEnded as ended:
        returncode, output = ended.returncode, ended.output
    finally:
        if reader is not None and reader.is_alive() and reader_pid is not None:
            # The reader may still be blocked in execute(); closing its
            # connection from this thread would race it. Cancel its query from
            # another connection, then wait for the thread to return.
            with engine.connect() as admin:
                admin.execute(
                    text("SELECT pg_cancel_backend(:pid)"), {"pid": reader_pid}
                )
            reader.join(timeout=_LOCK_WAIT_DEADLINE_SECS)
        if reader is None or not reader.is_alive():
            reader_conn.close()  # idempotent; the reader thread closes it too
        if holder_tx.is_active:
            holder_tx.rollback()
        holder.close()
        if migration is not None and migration.poll() is None:
            migration.kill()
            migration.communicate()
    return LockOrderAttempt(returncode, output, reader_outcome)


def test_upgrade_does_not_deadlock_with_a_concurrent_view_reader(
    _admin_url: str,
) -> None:
    """The lock-order interleaving, made deterministic with ``pg_locks``.

    With view-then-table locking, the reader waits on the view the migration
    already holds and runs after it. With table-then-view, the reader held the
    view and waited for the table while the migration held the table and waited
    for the view: ``40P01``, one side aborted.

    A ``55P03`` is a different failure: the migration's 3 s ``lock_timeout``
    expired while the test was sequencing (a loaded box), which says nothing
    about lock order. The walk is retried once on that; it fails on a deadlock
    at any attempt, and on a second lock timeout, with distinct messages.
    """
    with ephemeral_database(_admin_url, "prcheckruns_suite_01_lk") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)

        attempt = _lock_order_attempt(engine, db_url)
        if attempt.is_lock_timeout() and not attempt.is_deadlock():
            # The failed migration rolled back whole; the database is still at
            # the parent, which a retry needs.
            assert column_info(engine, _TABLE, _COLUMN) is None
            attempt = _lock_order_attempt(engine, db_url)

        assert not attempt.is_deadlock(), (
            "40P01: the migration deadlocked with a concurrent view reader "
            "(lock-order defect). Migration output:\n"
            f"{attempt.output}\nreader: {attempt.reader_outcome!r}"
        )
        assert not attempt.is_lock_timeout(), (
            "55P03 on two attempts: the migration's 3 s lock_timeout expired "
            "while the test sequenced its waits (a timing failure, not a "
            f"lock-order one). Migration output:\n{attempt.output}"
        )
        assert attempt.returncode == 0, (
            f"the migration failed (exit {attempt.returncode}):\n{attempt.output}"
        )
        assert "error" not in attempt.reader_outcome, (
            f"the view reader failed: {attempt.reader_outcome['error']!r}"
        )
        assert attempt.reader_outcome.get("rows") == 0
        assert column_info(engine, _TABLE, _COLUMN) == ("bigint", "YES", None)
