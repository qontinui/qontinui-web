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
``QONTINUI_TEST_PG=host:port`` — the same override ``conftest.py`` honours.
"""

from __future__ import annotations

import contextlib
import importlib.util
import os
import re
import subprocess
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine


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


def run_alembic(cwd: Path, db_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    """Run alembic against ``db_url`` and return the completed process.

    Deliberately NOT ``check=True``: with ``capture_output=True`` a
    ``CalledProcessError`` reports only the exit status, stranding alembic's
    traceback in the captured streams. A migration test that fails only in CI is
    exactly where that traceback is needed, so the failure is raised as an
    assertion carrying both streams instead.

    The URL is passed both ways (``-x db_url=`` and ``DATABASE_URL``) so the
    call does not depend on which side ``alembic/env.py`` reads.

    ``sys.executable``, not a bare ``"python"``: the child must be the SAME
    interpreter running the tests, or it is a different set of installed
    packages. Under ``poetry run`` (CI) the two coincide and the distinction is
    invisible; on a dev box they need not, and the bare name resolves to
    whatever ``python.exe`` the OS finds first. Two things made that hard to
    diagnose, so both are written down:

    * The error was *"No module named alembic.__main__"*, not the
      *"No module named alembic"* an interpreter without alembic should give.
      ``cwd`` is ``backend/``, so ``sys.path[0]`` is ``backend/`` and
      ``backend/alembic/`` — which has no ``__init__.py`` — is picked up as a
      NAMESPACE package. The import succeeds against the migration directory
      and only ``__main__`` is missing, which reads like a broken alembic
      install rather than the wrong interpreter.
    * Putting the virtualenv's ``Scripts`` dir first on ``PATH`` does not fix
      it. Windows resolves an un-pathed executable against the calling
      process's own search order, not the ``env=`` passed here, so the child is
      chosen before our ``env`` is consulted. ``sys.executable`` is absolute
      and sidesteps the lookup entirely.

    A migration test that skips locally proves nothing; one that dies on the
    wrong interpreter proves less.
    """
    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", "-x", f"db_url={db_url}", *args],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, (
        f"alembic {' '.join(args)} failed with exit {proc.returncode}\n"
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
