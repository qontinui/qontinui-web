"""Shared substrate for tests that run the real alembic chain.

Both migration tests need the same three things: a URL for the test Postgres,
a throwaway database inside it, and a way to invoke alembic against that
database. Before this module each test carried its own copy — ~60 duplicated
lines, and the copies had already drifted (one disposed its engine only on the
success path; both claimed a ``None`` return that no code path produced).

Why a throwaway database rather than the shared ``qontinui_test`` one
====================================================================

``conftest.py``'s ``test_engine`` fixture calls ``Base.metadata.create_all`` —
it does NOT run alembic, so that database's shape matches the SQLAlchemy models
rather than the revision chain. Running ``alembic upgrade`` on top of it would
either no-op (no version table) or collide with existing tables. A fresh
database is the only clean substrate, and it also lets a test walk
upgrade → downgrade → upgrade with no prior state, which is the only way to
catch a malformed ``down_revision`` or a downgrade that leaves residue.

CI provisions a Postgres service container at localhost:5432 (see
``.github/workflows/backend-ci.yml`` and ``tests/conftest.py``); locally these
tests skip unless one is reachable. Point them at a different instance with
``QONTINUI_TEST_PG=host:port``, or at a throwaway database with a full
``QONTINUI_TEST_PG_DSN`` (e.g. from ``ephemeral-db.sh start pgvector``). Both
are ``conftest.py``'s overrides: it derives ``DATABASE_URL`` from them at
import time, and [`admin_database_url`] reads that.
"""

from __future__ import annotations

import ast
import contextlib
import importlib.util
import io
import itertools
import logging
import os
import re
import subprocess
import sys
import tokenize
import traceback
import uuid
import warnings
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import TYPE_CHECKING

from alembic.config import CommandLine, Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

if TYPE_CHECKING:
    import pytest


def admin_database_url() -> str:
    """An admin URL to the test Postgres, matching ``conftest.py``'s credentials.

    Always returns a URL — reachability is a separate question, answered by
    [`can_connect`]. Async driver markers are stripped because alembic runs
    synchronously through psycopg2.
    """
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql://qontinui_user:qontinui_dev_password@localhost:5432/qontinui_test",
    )
    return url.replace("postgresql+asyncpg://", "postgresql://")


def can_connect(admin_url: str) -> bool:
    """True when the test Postgres accepts a connection — the skip predicate."""
    try:
        engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


def backend_root() -> Path:
    """Resolve the backend root (where ``alembic.ini`` lives) from this file."""
    return Path(__file__).resolve().parent.parent


# The logging shape ``alembic.ini`` declares — ``[logger_root]`` at WARN with the
# ``console`` handler, ``[logger_alembic]`` at INFO, ``[logger_sqlalchemy]``
# (qualname ``sqlalchemy.engine``) at WARN, ``[formatter_generic]``. Installed
# for the duration of an in-process call in place of ``fileConfig`` (see
# ``_alembic_ini_logging``), so the captured stderr carries the same lines a
# subprocess's stderr did — every revision logs through
# ``alembic.runtime.migration``, and the migration tests assert on those lines.
_ALEMBIC_LOG_FORMAT = "%(levelname)-5.5s [%(name)s] %(message)s"
_ALEMBIC_ROOT_LEVEL = logging.WARNING
_ALEMBIC_LOGGER_LEVELS = {"alembic": logging.INFO, "sqlalchemy.engine": logging.WARNING}


@contextlib.contextmanager
def _alembic_ini_logging(stream: io.StringIO) -> Iterator[None]:
    """Route logging to ``stream`` exactly as ``alembic.ini`` would, then restore.

    ``fileConfig`` itself cannot be used in-process: it closes every live
    handler, replaces the root logger's handlers (pytest's capture handlers
    included) and, through ``disable_existing_loggers``, sets ``disabled`` on
    every ``app.*`` logger the test process already created — permanently, so a
    later test's ``caplog`` assertion would fail for a reason nowhere near it.
    ``alembic/env.py`` skips ``fileConfig`` when the harness says so, and this
    applies the same levels and handler for the call only.
    """
    root = logging.getLogger()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter(_ALEMBIC_LOG_FORMAT))
    saved_root = (root.level, root.handlers[:])
    named = {name: logging.getLogger(name) for name in _ALEMBIC_LOGGER_LEVELS}
    saved_named = {
        name: (lg.level, lg.handlers[:], lg.propagate, lg.disabled)
        for name, lg in named.items()
    }
    root.handlers[:] = [handler]
    root.setLevel(_ALEMBIC_ROOT_LEVEL)
    for name, lg in named.items():
        lg.handlers[:] = []
        lg.setLevel(_ALEMBIC_LOGGER_LEVELS[name])
        lg.propagate = True
        lg.disabled = False
    try:
        yield
    finally:
        handler.flush()
        root.handlers[:] = saved_root[1]
        root.setLevel(saved_root[0])
        for name, lg in named.items():
            level, handlers, propagate, disabled = saved_named[name]
            lg.handlers[:] = handlers
            lg.setLevel(level)
            lg.propagate = propagate
            lg.disabled = disabled


@contextlib.contextmanager
def _isolated_process_state(cwd: Path) -> Iterator[None]:
    """Run the body in ``cwd``, then restore ``os.environ``, ``sys.path`` and cwd.

    A subprocess got all three for free. In-process, ``alembic/env.py`` reads
    ``DATABASE_URL`` from ``os.environ``, calls ``load_dotenv()`` (which ADDS any
    key in ``backend/.env`` that is not already set — on a dev box that is the
    developer's real settings) and inserts ``backend/`` into ``sys.path``; and
    ``alembic.ini``'s ``script_location`` is relative to the process cwd. None
    of that may outlive the call.
    """
    saved_env = os.environ.copy()
    saved_path = sys.path[:]
    saved_cwd = os.getcwd()
    os.chdir(cwd)
    try:
        yield
    finally:
        os.chdir(saved_cwd)
        sys.path[:] = saved_path
        for key in set(os.environ) - set(saved_env):
            del os.environ[key]
        for key, value in saved_env.items():
            if os.environ.get(key) != value:
                os.environ[key] = value


@contextlib.contextmanager
def _warnings_to(stream: io.StringIO) -> Iterator[None]:
    """Print Python warnings to ``stream`` for the call instead of raising them.

    In-process, a warning raised by alembic or a revision would otherwise land
    in pytest's warning collection — and under a ``-W error`` /
    ``filterwarnings = error`` configuration it would become an exception, so a
    deprecation alembic emits on EVERY call would turn every ``run_alembic`` into
    exit 1. Here every warning is printed to the captured stderr and the call
    carries on. That is somewhat MORE output than a child process gave: Python's
    default filters hid library DeprecationWarnings there, and the ``default``
    action shows them — deliberately, since a deprecation in the migration path
    is worth seeing in a failing test's stderr. The previous filters and hook
    are restored on exit.
    """

    def _show(
        message: Warning | str,
        category: type[Warning],
        filename: str,
        lineno: int,
        file: object = None,
        line: str | None = None,
    ) -> None:
        stream.write(warnings.formatwarning(message, category, filename, lineno, line))

    with warnings.catch_warnings():
        warnings.simplefilter("default")
        warnings.showwarning = _show
        yield


def _exit_status(code: object) -> int:
    """The status a process would have exited with for ``sys.exit(code)``."""
    if code is None:
        return 0
    if isinstance(code, int):
        return code & 0xFF
    return 1


def run_alembic(
    cwd: Path,
    db_url: str,
    *args: str,
    expect_success: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Run alembic against ``db_url`` IN-PROCESS and return a completed process.

    The return type is still ``subprocess.CompletedProcess`` — ``returncode``,
    ``stdout`` and ``stderr`` — so no caller changes. What changed is that no
    process is spawned. Backend CI makes ~285 of these calls per run, and each
    used to pay a fresh interpreter plus the ``alembic`` / ``sqlalchemy`` /
    ``app`` imports (~9 s per call in CI, plan
    ``2026-09-12-backend-ci-pays-a-model-import-on-every-alembic-invocation``).
    In-process those imports are paid once per test session.

    Faithful to the CLI on the four things that matter:

    * **argv** is parsed by alembic's own ``CommandLine`` parser and dispatched
      by its own ``run_cmd``, and the parsed namespace is passed to ``Config``
      as ``cmd_opts`` — which is what ``alembic/env.py``'s lazy model import
      keys on, so ``upgrade`` / ``downgrade`` / ``stamp`` skip the model tree
      exactly as from the command line.
    * **The URL** is passed both ways (``-x db_url=`` and ``DATABASE_URL``) so
      the call does not depend on which side ``alembic/env.py`` reads.
    * **Output** — ``sys.stdout`` / ``sys.stderr`` are captured for the call,
      ``Config(stdout=...)`` too (its default is bound at import time, so it
      would escape a redirect), and logging is routed to the captured stderr in
      the shape ``alembic.ini`` declares. Offline ``--sql`` output, revision
      log lines and ``FAILED:`` messages all land where a subprocess put them.
    * **Failure** — an exception becomes ``returncode=1`` with its full
      traceback appended to ``stderr``; ``sys.exit`` keeps its status (alembic's
      ``FAILED:`` path exits ``-1``, i.e. 255). ``KeyboardInterrupt`` and
      ``pytest.fail`` / ``pytest.skip`` propagate. Python warnings are printed to
      ``stderr`` rather than raised into pytest's warning machinery.

    Process-global state ``env.py`` touches — ``os.environ``, ``sys.path``,
    cwd, and logging — is restored after the call (see
    ``_isolated_process_state`` and ``_alembic_ini_logging``).

    Deliberately NOT raising on failure by default: the failure is raised as an
    assertion carrying both streams instead, because a migration test that
    fails only in CI is exactly where alembic's traceback is needed.

    ``expect_success=False`` INVERTS that assertion, for the migration that is
    supposed to refuse. A revision whose job is to fail closed — one that raises
    on a catalog state it must not accept — needs a test that drives it there,
    and the default assertion makes the correct outcome indistinguishable from a
    broken migration: the helper fires first and reports "alembic ... failed with
    exit 1" for a refusal the test was asking for.
    """
    argv = ["-x", f"db_url={db_url}", *args]
    out, err = io.StringIO(), io.StringIO()
    returncode = 0
    with (
        _isolated_process_state(cwd),
        contextlib.redirect_stdout(out),
        contextlib.redirect_stderr(err),
        _alembic_ini_logging(err),
        _warnings_to(err),
    ):
        os.environ["DATABASE_URL"] = db_url
        cli = CommandLine(prog="alembic")
        try:
            options = cli.parser.parse_args(argv)
            if not hasattr(options, "cmd"):
                cli.parser.error("too few arguments")
            # The same ini / pyproject.toml resolution `alembic` itself does
            # (CommandLine.main), so ALEMBIC_CONFIG and `-c` behave identically.
            toml_file, ini_file = cli._inis_from_config(options)
            config = Config(
                file_=ini_file,
                toml_file=toml_file,
                ini_section=options.name,
                cmd_opts=options,
                stdout=out,
                attributes={"configure_logger": False},
            )
            cli.run_cmd(config, options)
        except SystemExit as exc:
            returncode = _exit_status(exc.code)
            if not isinstance(exc.code, (int, type(None))):
                print(exc.code, file=err)
        except Exception:
            # Not BaseException: `pytest.fail` / `pytest.skip` (and a timeout
            # plugin's) must propagate, never be read as the migration
            # refusing — which `expect_success=False` would pass.
            traceback.print_exc(file=err)
            returncode = 1
    proc = subprocess.CompletedProcess(
        args=["alembic", *argv],
        returncode=returncode,
        stdout=out.getvalue(),
        stderr=err.getvalue(),
    )
    if expect_success:
        assert proc.returncode == 0, (
            f"alembic {' '.join(args)} failed with exit {proc.returncode}\n"
            f"--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
        )
    else:
        assert proc.returncode != 0, (
            f"alembic {' '.join(args)} unexpectedly SUCCEEDED (exit 0) when the "
            "test required it to refuse\n"
            f"--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
        )
    return proc


@contextlib.contextmanager
def ephemeral_database(
    admin_url: str, name_prefix: str
) -> Iterator[tuple[Engine, str]]:
    """Create a throwaway database, yield ``(engine, url)``, then drop it.

    Teardown runs whatever the body did: the engine is disposed first (so its
    pooled connections do not block the drop), lingering backends are
    terminated, then the database is dropped. Cleanup failures are suppressed
    rather than allowed to replace the body's own exception — a masked
    assertion error is far more expensive to debug than a leaked temp database.
    """
    db_name = f"{name_prefix}_{uuid.uuid4().hex[:12]}"
    base, _, _ = admin_url.rpartition("/")
    db_url = f"{base}/{db_name}"

    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    target_engine: Engine | None = None
    try:
        with admin_engine.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{db_name}"'))
        target_engine = create_engine(db_url)
        yield target_engine, db_url
    finally:
        if target_engine is not None:
            with contextlib.suppress(Exception):
                target_engine.dispose()
        with contextlib.suppress(Exception):
            with admin_engine.connect() as conn:
                conn.execute(
                    text(
                        """
                        SELECT pg_terminate_backend(pid)
                          FROM pg_stat_activity
                         WHERE datname = :name
                           AND pid <> pg_backend_pid()
                        """
                    ),
                    {"name": db_name},
                )
                conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}"'))
        with contextlib.suppress(Exception):
            admin_engine.dispose()


def table_exists(engine: Engine, schema: str, table: str) -> bool:
    """True when ``schema.table`` is present in ``information_schema``."""
    sql = text(
        """
        SELECT EXISTS(
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = :schema AND table_name = :table
        )
        """
    )
    with engine.connect() as conn:
        return bool(conn.execute(sql, {"schema": schema, "table": table}).scalar())


def index_exists(engine: Engine, index_name: str, schema: str = "coord") -> bool:
    """True when ``index_name`` exists in ``schema`` (``pg_indexes`` has no prefix)."""
    sql = text(
        """
        SELECT EXISTS(
            SELECT 1 FROM pg_indexes
            WHERE schemaname = :schema AND indexname = :idx
        )
        """
    )
    with engine.connect() as conn:
        return bool(conn.execute(sql, {"schema": schema, "idx": index_name}).scalar())


# --------------------------------------------------------------------------
# Catalog readers
#
# These four were copied into every migration test that needed them, which is
# the drift this module's docstring was written about. They live here now.
# `_column`/`_scalar`/`_column_comment` still exist as private copies in the
# older suites; new tests use these, and moving the remaining copies is a
# mechanical follow-up rather than a reason to keep adding new ones.
# --------------------------------------------------------------------------


def column_info(
    engine: Engine, table: str, column: str, schema: str = "coord"
) -> tuple[str, str, str | None] | None:
    """``(data_type, is_nullable, column_default)`` for the column, or None."""
    sql = text(
        """
        SELECT data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = :schema
           AND table_name = :table
           AND column_name = :column
        """
    )
    with engine.connect() as conn:
        row = conn.execute(
            sql, {"schema": schema, "table": table, "column": column}
        ).fetchone()
    return (row[0], row[1], row[2]) if row else None


def scalar(engine: Engine, sql: str, **params: object) -> object:
    """One value from a one-row query. Raises if the query returns no row."""
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar_one()


def column_comment(
    engine: Engine, table: str, column: str, schema: str = "coord"
) -> str | None:
    """``col_description`` for the column: its comment, or None.

    ``scalar_one_or_none``, not ``scalar_one``: an ABSENT column yields no row
    at all, and the caller asking "what comment does this carry" is entitled to
    ``None`` for both "no comment" and "no column". The copies this replaced
    used ``scalar_one`` under a ``str | None`` annotation, so
    ``assert column_comment(...) is None`` after a drop raised ``NoResultFound``
    instead of failing on its own terms.
    """
    with engine.connect() as conn:
        return conn.execute(  # type: ignore[return-value]
            text(
                """
                SELECT col_description(att.attrelid, att.attnum)
                  FROM pg_attribute att
                 WHERE att.attrelid = to_regclass(:schema || '.' || :table)
                   AND att.attname = :column
                   AND att.attnum > 0
                   AND NOT att.attisdropped
                """
            ),
            {"schema": schema, "table": table, "column": column},
        ).scalar_one_or_none()


def load_revision_module(path: Path, module_name: str) -> ModuleType:
    """Import a revision file directly, so its functions can be re-invoked.

    Alembic's own runner will not do this: once ``alembic_version`` names the
    revision, a second ``upgrade <rev>`` is a no-op. Loading by path is the only
    way to exercise a revision's idempotency guards.
    """
    spec = importlib.util.spec_from_file_location(module_name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _alembic_graph() -> ModuleType:
    """The head gate's own module, ``scripts/ci/_alembic_graph.py``.

    Imported lazily and by path-on-``sys.path`` because ``scripts/ci`` is not a
    package of this backend; importing it here rather than in each test keeps
    the ``sys.path`` edit in one place.
    """
    scripts_ci = str(backend_root().parent / "scripts" / "ci")
    if scripts_ci not in sys.path:
        sys.path.insert(0, scripts_ci)
    import _alembic_graph

    return _alembic_graph


def declared_parent_revision_ids(source: str) -> list[str] | None:
    """Every parent a revision file's ``down_revision`` declares, in order.

    Read through THE GATE'S OWN PARSER (``parse_source`` + ``parent_refs``), not
    a private regex, so a migration test cannot disagree with the lane that
    actually blocks about what a parent is: the text is masked (a docstring that
    discusses ``down_revision`` cannot supply one), a trailing ``# ...`` comment
    is skipped (a paren inside it cannot truncate a wrapped assignment), both
    quote styles and the formatter-wrapped ``= (\\n"x"\\n)`` form are read, and a
    merge tuple yields ALL its parents rather than its first. ``None`` when the
    source declares no ``revision = ...`` at all.
    """
    graph = _alembic_graph()
    parsed = graph.parse_source(source)
    if parsed is None:
        return None
    return graph.parent_refs(parsed[1])


def declared_parent_revision_id(source: str, label: str) -> str:
    """The ONE parent a revision file declares — refusing a merge or a root.

    ``label`` names the file in the failure message. A migration test walks
    back to this parent and asserts against the "clean" database it finds
    there, so it needs exactly one place to stop: a merge revision (a tuple)
    needs its own downgrade target chosen deliberately, never the tuple's first
    element, and a root revision has no parent to rewind to.
    """
    parents = declared_parent_revision_ids(source)
    assert parents is not None, f"{label} declares no parseable revision id"
    assert len(parents) == 1, (
        f"{label} must declare exactly ONE parent so the downgrade walk has one "
        f"place to stop; the head gate's parser read {parents!r} from its "
        f"down_revision. A merge revision (a tuple) needs its own downgrade "
        f"target chosen deliberately, not the tuple's first element."
    )
    return parents[0]


# A SQL string literal, with `''` as the escaped apostrophe.
_SQL_LITERAL = re.compile(r"'((?:[^']|'')*)'")


def comment_body_from_source(
    source: str, qualified_column: str, *, object_kind: str = "COLUMN"
) -> str:
    """The ``COMMENT ON <object_kind>`` body a revision's SOURCE emits.

    PostgreSQL concatenates adjacent string literals separated by a newline, and
    the revisions here write each comment as one such run inside a triple-quoted
    block. The doubled apostrophes are collapsed the way the SQL parser collapses
    them, so the result is what ``col_description`` will return.

    Exists so a test can compare against the ONE author of a body rather than
    holding a copy of it: two revisions restore ``pdaw_01``'s two comments, and a
    third copy in a test is the divergence such a test exists to catch.

    ``object_kind`` is ``COLUMN`` by default and ``TABLE`` for a
    ``COMMENT ON TABLE`` (``pdpub_01`` ships one, and its body carries the D1
    tenant-agnosticism contract, so it is worth reading back).

    The marker is matched whitespace-TOLERANTLY. A revision is free to wrap a
    long ``COMMENT ON COLUMN coord.<table>.<column> IS`` across two source lines
    — ``pdpub_02`` does, for the two ``prompt_document_versions`` columns — and a
    literal ``str.find`` on the one-line spelling reports that as "the source no
    longer contains this comment", which reads like a deleted comment rather
    than like a wrapped line.
    """
    marker_re = re.compile(
        r"COMMENT\s+ON\s+"
        + object_kind
        + r"\s+"
        + re.escape(qualified_column)
        + r"\s+IS"
    )
    matches = list(marker_re.finditer(source))
    assert matches, (
        f"source no longer contains a COMMENT ON {object_kind} for {qualified_column!r}"
    )
    assert len(matches) == 1, (
        f"COMMENT ON {object_kind} {qualified_column} appears {len(matches)} "
        "times; this reader would silently pick the first, which is not "
        "necessarily the one the caller meant"
    )
    marker = matches[0].group(0)
    start = matches[0].end()
    end = source.find('"""', start)
    assert end > start, f"unterminated COMMENT block for {qualified_column}"

    remainder = _SQL_LITERAL.sub("", source[start:end])
    assert not remainder.strip(), (
        "the COMMENT block holds something other than adjacent string "
        f"literals, so this reader cannot reassemble it: {remainder!r}"
    )

    parts = _SQL_LITERAL.findall(source[start:end])
    assert parts, f"no SQL string literals found after {marker!r}"
    return "".join(part.replace("''", "'") for part in parts)


@dataclass(frozen=True)
class UpgradeExecute:
    """One ``op.execute(...)`` call inside a revision's ``upgrade()``."""

    #: The call's argument, or None when it is not ONE static ``str`` literal.
    sql: str | None
    #: True when the call sits inside ``with op.get_context().autocommit_block():``.
    in_autocommit_block: bool


def _is_autocommit_block(item: ast.withitem) -> bool:
    """``op.get_context().autocommit_block()`` exactly, with no arguments."""
    call = item.context_expr
    if not (isinstance(call, ast.Call) and not call.args and not call.keywords):
        return False
    method = call.func
    if not (isinstance(method, ast.Attribute) and method.attr == "autocommit_block"):
        return False
    ctx = method.value
    return (
        isinstance(ctx, ast.Call)
        and isinstance(ctx.func, ast.Attribute)
        and ctx.func.attr == "get_context"
        and isinstance(ctx.func.value, ast.Name)
        and ctx.func.value.id == "op"
    )


def upgrade_execute_calls(
    path: Path, *, function: str = "upgrade"
) -> list[UpgradeExecute]:
    """Every ``op.execute(...)`` in ``function`` (default ``upgrade()``), via ``ast``.

    Lets a test run a revision's REAL DDL without a copy that can drift, and
    check the call shapes coord's migration classifier requires: a static
    inline literal argument (anything else is reported as ``sql=None``) and,
    for a CONCURRENTLY build, an enclosing ``autocommit_block``.

    ``function="downgrade"`` reads ``downgrade()`` the same way, for a test that
    holds the rollback path to the same shape.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    upgrades = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == function
    ]
    assert len(upgrades) == 1, f"{path.name} must define exactly one {function}()"

    calls: list[UpgradeExecute] = []

    def visit(node: ast.AST, in_block: bool) -> None:
        if isinstance(node, ast.With):
            in_block = in_block or any(_is_autocommit_block(i) for i in node.items)
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "op"
        ):
            arg = node.args[0] if len(node.args) == 1 and not node.keywords else None
            sql = (
                arg.value
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str)
                else None
            )
            calls.append(UpgradeExecute(sql=sql, in_autocommit_block=in_block))
        for child in ast.iter_child_nodes(node):
            visit(child, in_block)

    for statement in upgrades[0].body:
        visit(statement, False)
    return calls


# ---------------------------------------------------------------------------
# Recorded-SQL helpers for revisions written as static ``op.execute`` DDL.
#
# topcons_01's and kernel_gauges_01's tests each carried a private copy of
# these, and scanned for forbidden clauses only on the lines containing
# ``ADD COLUMN``, so a ``NOT NULL`` or ``DEFAULT`` on a continuation line, a
# ``NOT NULL`` split across lines, or an ``ADD CONSTRAINT`` in the same ALTER
# passed. runmem_01's test (web#2207, open when this landed, still carrying its
# own private copy) fixed the scan; this hoists that fix so every migration
# test can share it.
# ---------------------------------------------------------------------------

#: Clauses a nullable "NULL means UNKNOWN" column's ADD must never carry: each
#: either fabricates a reading or puts a second door on an input coord
#: validates app-side.
FORBIDDEN_ADD_CLAUSES: tuple[str, ...] = (
    "NOT NULL",
    "DEFAULT",
    "CHECK",
    "CONSTRAINT",
    "REFERENCES",
    "UNIQUE",
)


def recorded_sql(
    module: ModuleType, step: str, monkeypatch: pytest.MonkeyPatch
) -> list[str]:
    """Run ``module.upgrade()`` / ``downgrade()`` against a recording ``op``.

    Returns every ``op.execute`` argument, in order, as a string. Only
    ``execute`` is stubbed: a revision that reaches for any other ``op``
    method raises ``AttributeError``, which is the right failure for a test
    that relies on the DDL being static ``op.execute`` text.
    """
    executed: list[str] = []

    class _RecordingOp:
        @staticmethod
        def execute(sql: object) -> None:
            executed.append(str(sql))

    monkeypatch.setattr(module, "op", _RecordingOp)
    getattr(module, step)()
    return executed


def alter_statement(statements: list[str], schema: str, table: str, verb: str) -> str:
    """The ONE ``ALTER TABLE <schema>.<table> ... <verb> COLUMN`` statement.

    Fails (assert) on zero or on more than one, so a revision that splits its
    ADD across two ALTERs is caught rather than half-read.
    """
    head = re.compile(rf"^\s*ALTER TABLE {re.escape(schema)}\.{re.escape(table)}\s")
    found = [
        sql for sql in statements if head.match(sql) and f"{verb} COLUMN" in sql.upper()
    ]
    assert len(found) == 1, (
        f"expected one {verb} statement for {schema}.{table}, got {len(found)}"
    )
    return found[0]


def collapsed_upper(sql: str) -> str:
    """``sql`` upper-cased with every whitespace run collapsed to one space."""
    return " ".join(sql.upper().split())


def forbidden_add_clauses(
    statement: str, clauses: tuple[str, ...] = FORBIDDEN_ADD_CLAUSES
) -> list[str]:
    """The forbidden clauses present ANYWHERE in ``statement``.

    Reads the WHOLE statement, whitespace-collapsed, so a clause on a
    continuation line or split across lines is found; matches on word
    boundaries, so a column NAMED ``default_x`` or ``checked_at`` is not.
    """
    text_ = collapsed_upper(statement)
    return [
        clause
        for clause in clauses
        if re.search(rf"(?<![\w]){re.escape(clause)}(?![\w])", text_)
    ]


def backfill_statements(statements: list[str]) -> list[str]:
    """Every recorded statement that may write rows.

    Any statement other than a ``COMMENT ON`` (whose body is prose) that
    mentions ``UPDATE``, ``INSERT`` or ``COPY`` as a word — so a
    ``WITH ... UPDATE`` or a ``DO`` block is caught, not only a statement that
    starts with the verb.
    """
    return [
        sql
        for sql in statements
        if not re.match(r"\s*COMMENT\s+ON\b", sql, re.I)
        and re.search(r"\b(UPDATE|INSERT|COPY)\b", sql, re.I)
    ]


def drop_statements(statements: list[str]) -> list[str]:
    """Every recorded statement, other than a ``COMMENT ON``, naming ``DROP``.

    Case-insensitive and word-bounded; comment prose is skipped, so a column
    comment that mentions dropping something is not a false positive.
    """
    return [
        sql
        for sql in statements
        if not re.match(r"\s*COMMENT\s+ON\b", sql, re.I)
        and re.search(r"\bDROP\b", sql, re.I)
    ]


def assert_nullable_add_only(statements: list[str], schema: str, table: str) -> None:
    """The recorded ``upgrade()`` is ONE nullable ADD on ``schema.table``, then
    only ``COMMENT ON COLUMN`` statements: no forbidden clause anywhere in the
    ADD, no DROP, no backfill.

    Static (no database), so it runs where the DB walks skip. For a revision
    that also emits a lock bound, compose the parts by hand instead.
    """
    add = alter_statement(statements, schema, table, "ADD")
    found = forbidden_add_clauses(add)
    assert not found, f"the ADD carries {found}; NULL is load-bearing"
    assert not drop_statements(statements), drop_statements(statements)
    assert not backfill_statements(statements), (
        "the revision backfills; rows written before it must keep NULL"
    )
    # Pin the shape so a second ALTER the finder's anchor does not match
    # (``ALTER TABLE ONLY``, another table, a ``SET DEFAULT``) cannot slip past.
    others = [sql for sql in statements if sql is not add]
    assert all(sql.lstrip().startswith("COMMENT ON COLUMN") for sql in others), others


# ---------------------------------------------------------------------------
# Reading a revision's statement shape, its offline render, and what coord's
# alembic re-point (its E6 clause) would call destructive.
#
# Revision-agnostic, so migration tests share one copy instead of each carrying
# its own. tests/test_alembic_harness_revision_scans.py pins them.
# ---------------------------------------------------------------------------


def collapsed(sql: str) -> str:
    """``sql`` with every whitespace run collapsed to one space, case kept."""
    return " ".join(sql.split())


#: How [`statement_shape`] renders an ``autocommit_block``: entering one COMMITs
#: the open transaction, leaving it BEGINs the next.
ENTER_AUTOCOMMIT = "<enter autocommit_block: COMMIT>"
LEAVE_AUTOCOMMIT = "<leave autocommit_block: BEGIN>"


def statement_shape(fn: ast.FunctionDef) -> tuple[str, ...]:
    """``fn``'s body as it runs: each ``op.execute`` literal, whitespace-
    collapsed, and each ``with op.get_context().autocommit_block():`` as
    ``ENTER_AUTOCOMMIT``, the statements inside it, then ``LEAVE_AUTOCOMMIT``.

    A docstring and ``pass`` are skipped. ANY other statement fails: an
    ``op.alter_column``, an ``op.execute`` of a non-literal, a helper call. So a
    golden comparison against this shape cannot be passed by a statement that
    [`upgrade_execute_calls`], which reads ``op.execute`` calls only, never sees.
    """
    shape: list[str] = []

    def visit(body: list[ast.stmt]) -> None:
        for stmt in body:
            if isinstance(stmt, ast.Pass):
                continue
            if isinstance(stmt, ast.With):
                assert all(_is_autocommit_block(item) for item in stmt.items), (
                    ast.unparse(stmt)
                )
                shape.append(ENTER_AUTOCOMMIT)
                visit(stmt.body)
                shape.append(LEAVE_AUTOCOMMIT)
                continue
            assert isinstance(stmt, ast.Expr), ast.unparse(stmt)
            call = stmt.value
            if isinstance(call, ast.Constant) and isinstance(call.value, str):
                continue  # a docstring
            assert (
                isinstance(call, ast.Call)
                and ast.unparse(call.func) == "op.execute"
                and len(call.args) == 1
                and not call.keywords
            ), ast.unparse(stmt)
            sql = call.args[0]
            assert isinstance(sql, ast.Constant) and isinstance(sql.value, str), (
                ast.unparse(stmt)
            )
            shape.append(collapsed(sql.value))

    visit(fn.body)
    return tuple(shape)


def offline_framing(sql: str) -> list[str]:
    """The bare ``BEGIN;`` / ``COMMIT;`` lines of an offline ``--sql`` render, in
    order: the batch's own pair, plus a ``COMMIT;`` then ``BEGIN;`` for every
    ``autocommit_block`` the render passes through."""
    return [
        line.strip()
        for line in sql.splitlines()
        if line.strip() in ("BEGIN;", "COMMIT;")
    ]


def assert_in_order(text: str, markers: Iterable[str]) -> None:
    """Every marker occurs in ``text``, each after the end of the one before."""
    at = 0
    for marker in markers:
        found = text.find(marker, at)
        assert found >= 0, f"{marker!r} missing or out of order in:\n{text}"
        at = found + len(marker)


#: E6 reads a module's docstrings as code once the module names any of these,
#: since one of them could be the SQL ``upgrade()`` executes (qontinui-coord
#: ``crates/coord/src/alembic_repoint_plan.rs`` ``DOCSTRING_READERS``); so does
#: [`destructive_words_outside_downgrade`].
DOCSTRING_READERS: tuple[str, ...] = ("__doc__", "getdoc", "cleandoc", "co_consts")

#: A word BEGINNING drop / delete / truncate. Every token form E6 lists begins
#: so; [`E6_FORMS`] holds one example of each.
DESTRUCTIVE_WORD = re.compile(r"\b(?:drop|delete|truncate)", re.IGNORECASE)


def downgrade_body_lines(source: str) -> frozenset[int]:
    """The 1-based lines coord's E6 skips as a ``downgrade()`` body.

    E6's own bound (``outside_downgrade`` in qontinui-coord
    ``crates/coord/src/alembic_repoint_plan.rs``): from a column-0 ``def
    downgrade(`` or ``async def downgrade(`` line to the next column-0 line that
    is neither blank nor a ``#`` comment. So a flush-left line inside a string
    in ``downgrade()`` ENDS the skip, and that line and everything after it are
    read. Where this differs from E6 it skips less, never more: the skip starts
    only at a real top-level ``downgrade`` (E6 also starts at that text inside a
    string), and a flush-left line ends it even inside a docstring (E6 blanks
    docstrings first, so there it does not).
    """
    tree = ast.parse(source)
    lines = source.split("\n")
    skipped: set[int] = set()
    for node in tree.body:
        if (
            isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
            and node.name == "downgrade"
        ):
            skipped.add(node.lineno)
            for number in range(node.lineno + 1, len(lines) + 1):
                line = lines[number - 1]
                if line[:1] and not line[0].isspace() and not line.startswith("#"):
                    break
                skipped.add(number)
    return frozenset(skipped)


def _carried_text(node: ast.AST, docstrings: set[int]) -> list[str]:
    """The text ``node`` itself carries: a literal's value, or its names."""
    if isinstance(node, ast.Constant):
        if id(node) in docstrings:
            return []
        if isinstance(node.value, bytes):
            return [node.value.decode("latin-1")]
        return [node.value] if isinstance(node.value, str) else []
    # Every str a non-literal node holds is a name (``ast.parse`` keeps no type
    # comments): a Name's id, an attribute, an imported name, alias or module,
    # a def / class / argument / keyword name, a global, a match capture.
    texts: list[str] = []
    for field in node._fields:
        value = getattr(node, field, None)
        for item in value if isinstance(value, list) else [value]:
            if isinstance(item, str):
                texts.append(item)
    return texts


def _blanked_by_e6(source: str, lines: list[str], stmt: ast.Expr) -> bool:
    """Whether E6 blanks the string statement ``stmt`` as prose.

    E6's lexer (``python_code_text`` in qontinui-coord
    ``crates/coord/src/alembic_repoint_plan.rs``) blanks a string-literal
    statement only at bracket depth 0, right after a statement boundary, with
    nothing after it but a newline or a comment, and never across a backslash
    continuation. So it reads a docstring as CODE when the docstring is
    parenthesised, follows the ``:`` of a one-line ``def``, is followed by a
    ``;``, or has literals a backslash joins; the AST calls each of those a
    docstring all the same.
    """
    value = stmt.value
    end_lineno = stmt.end_lineno or stmt.lineno
    first = lines[stmt.lineno - 1].encode()
    last = lines[end_lineno - 1].encode()
    if (stmt.lineno, stmt.col_offset) != (value.lineno, value.col_offset):
        return False  # parenthesised: the statement opens before its literal
    if first[: stmt.col_offset].strip():
        return False  # not first on its line: after a ``:`` or a ``;``
    after = last[stmt.end_col_offset or 0 :].strip()
    if after and not after.startswith(b"#"):
        return False  # a ``;`` (or anything but a comment) follows it
    segment = ast.get_source_segment(source, stmt) or ""
    try:
        literals = [
            token
            for token in tokenize.generate_tokens(io.StringIO(segment).readline)
            if token.type == tokenize.STRING
        ]
    except (tokenize.TokenError, SyntaxError):
        return False
    # Adjacent literals on one line are one E6 statement; across a backslash
    # continuation they are not.
    return all(a.end[0] == b.start[0] for a, b in itertools.pairwise(literals))


def destructive_words_outside_downgrade(source: str) -> list[str]:
    """What coord's alembic re-point (its E6 clause) could refuse in a revision's
    ``source``, read more strictly than E6 reads it, as ``line N: <text>``.

    The rule: any word BEGINNING ``drop`` / ``delete`` / ``truncate``, in a name
    (so a bare ``drop_table(...)``, ``sa.schema.DropTable(...)`` or
    ``sa.delete(...)`` is caught) or in a string or bytes literal that is not a
    docstring E6 also blanks (so is a token spelled inside a ``COMMENT ON``
    body). Every token form E6 lists begins so.

    The region: every line outside [`downgrade_body_lines`], E6's own bound read
    at least as widely. ``#`` comments never reach the AST. A docstring is
    prose only where E6 blanks it too (see [`_blanked_by_e6`]), and none is
    once the module names one of [`DOCSTRING_READERS`], as in E6.

    One named exception, where E6 reads MORE than this scan: when E6's lexer
    cannot lex the module, E6 scans the raw region text, docstrings and ``#``
    comments included. On source Python accepts, that is a module with an f- or
    t-string quoting inside a replacement field (``f"{row['id']}"``), which
    E6's ``format_fields_balance`` refuses to guess the end of. This scan still
    skips prose there, so a caller that needs the guarantee keeps such
    f-strings out of the revision, as
    ``test_coord_session_liveness_01_migration`` checks.
    """
    tree = ast.parse(source)
    lines = source.split("\n")
    docstrings: set[int] = set()
    if not any(reader in source for reader in DOCSTRING_READERS):
        for holder in ast.walk(tree):
            if not isinstance(
                holder,
                ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef,
            ):
                continue
            head = holder.body[0] if holder.body else None
            if (
                isinstance(head, ast.Expr)
                and isinstance(head.value, ast.Constant)
                and isinstance(head.value.value, str)
                and _blanked_by_e6(source, lines, head)
            ):
                docstrings.add(id(head.value))
    skipped = downgrade_body_lines(source)
    found: list[str] = []
    for node in ast.walk(tree):
        first = getattr(node, "lineno", None)
        if isinstance(first, int):
            last = getattr(node, "end_lineno", None) or first
            if all(number in skipped for number in range(first, last + 1)):
                continue
        for text_ in _carried_text(node, docstrings):
            if DESTRUCTIVE_WORD.search(text_):
                found.append(f"line {first}: {text_!r}")
    return found


#: One example of each token form coord's E6 refuses (``DESTRUCTIVE_TOKENS`` in
#: qontinui-coord ``crates/coord/src/alembic_repoint_plan.rs``), as one line of
#: ``upgrade()``.
E6_FORMS: tuple[str, ...] = (
    'op.drop_table("t", schema="coord")',
    'batch_op.drop_column("c")',
    'drop_table("t")',
    "sa.schema.DropTable(t)",
    "DropIndex(ix)",
    'op.execute("DROP MATERIALIZED VIEW coord.v")',
    'op.execute("DROP TABLE coord.t")',
    'op.execute("ALTER TABLE coord.t ALTER COLUMN c DROP DEFAULT")',
    'op.execute("TRUNCATE coord.t")',
    'op.execute("DELETE FROM coord.t")',
    "op.execute(sa.delete(t))",
    "t.delete()",
)


def synthetic_revision(
    upgrade_line: str = "pass",
    *,
    module_line: str = "",
    downgrade_body: str = '    op.drop_table("t", schema="coord")\n',
) -> str:
    """A revision with ``upgrade_line`` as one line of ``upgrade()``, whose prose
    (both docstrings, a ``#`` comment) and default ``downgrade()`` body spell
    destructive SQL that E6 does not read."""
    return (
        '"""DROP TABLE coord.t, in the module docstring."""\n'
        "from alembic import op\n"
        f"{module_line}\n"
        "\n"
        "def upgrade() -> None:\n"
        '    """DELETE FROM coord.t, in a function docstring."""\n'
        "    # TRUNCATE coord.t, in a comment.\n"
        f"    {upgrade_line}\n"
        "\n"
        "\n"
        "def downgrade() -> None:\n"
        f"{downgrade_body}"
    )
