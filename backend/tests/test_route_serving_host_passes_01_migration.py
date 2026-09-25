"""Behaviour test for the ``route_serving_host_passes_01`` revision.

The revision adds ``coord.route_serving_observations.method`` (nullable, no
default) and creates ``coord.route_serving_host_passes`` (one row per host per
observer pass, ``UNIQUE (host, observed_at)``).

Always run, with no database:

* the ``_PARENT_REVISION_ID`` pin and the one-line ``down_revision`` spelling
  coord's line-scoped graph parser needs;
* the upgrade path, as coord's migration classifier sees it, carries no
  ``INDEX`` token, no ``DROP``, no autocommit block and no DML, and keeps both
  ``IF NOT EXISTS`` guards. Those are NECESSARY conditions for the AutoSafe
  classification the revision claims. An index added "helpfully" with
  ``op.create_index`` would make coord Reject it, and that block needs an
  operator to clear.

Against an ephemeral Postgres (skipped when none is reachable):

1. neither object exists at the parent;
2. after upgrade the column is nullable text with no default, and a row that
   predates the upgrade reads NULL (the method was never observed, so none is
   invented);
3. the per-pass table exists, a second row for the same ``(host,
   observed_at)`` is refused, and the reuse read of the plan's Phase 2 returns
   the newest pass for one host only;
4. ``carves`` defaults to an empty JSON array;
5. downgrade removes both, keeps the observation rows, and a second upgrade
   re-applies cleanly.
"""

from __future__ import annotations

import ast
import re
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    run_alembic,
    table_exists,
)

_REVISION_ID = "route_serving_host_passes_01"
_PARENT_REVISION_ID = "coord_pr_files_head_sha_01"
_REVISION_FILENAME = "route_serving_host_passes_01_method_and_host_passes.py"

_HOST = "api.qontinui.io"
_OTHER_HOST = "coord.qontinui.io"

# The Phase 2 reuse read: exactly the newest pass of one host.
_LATEST_PASS_SQL = """
    SELECT observed_at, drift_class FROM coord.route_serving_host_passes
     WHERE host = :host
       AND observed_at = (
           SELECT max(observed_at) FROM coord.route_serving_host_passes
            WHERE host = :host)
"""


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def _classifier_surface() -> str:
    """The module minus ``downgrade()``, with docstrings and comments blanked.

    Same slicing as ``test_coord_pr_files_head_sha_01_migration``: coord's
    classifier judges the whole module except the body of ``downgrade()``, so
    module-level helpers are included; docstrings are located with ``ast`` so
    the triple-quoted SQL literals survive.
    """
    src = _revision_source()
    lines = src.splitlines(keepends=True)
    for node in ast.walk(ast.parse(src)):
        if not isinstance(
            node, ast.Module | ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef
        ):
            continue
        if not node.body:
            continue
        first = node.body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
            and first.end_lineno is not None
        ):
            for i in range(first.lineno - 1, first.end_lineno):
                lines[i] = "\n"
    blanked = "".join(lines)
    surface = re.split(r"^def downgrade\(", blanked, maxsplit=1, flags=re.MULTILINE)[0]
    return re.sub(r"#[^\n]*", "", surface)


def _sql_statements(surface: str) -> str:
    """The SQL of the upgrade path, without the COMMENT ON prose bodies.

    A comment body is documentation stored in the catalog; the keyword scans
    below must read the DDL, not the words used to describe it.
    """
    return re.sub(r"COMMENT ON .*? IS\s+'[^']*'", "", surface, flags=re.DOTALL)


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins {_PARENT_REVISION_ID!r}. Re-point both together."
    )


def test_the_down_revision_is_on_one_line() -> None:
    """coord parses ``down_revision`` line by line (``enrichment.rs``)."""
    assert re.search(
        r'^down_revision[^=\n]*=\s*["\'][^"\'\n]+["\']\s*$',
        _revision_source(),
        re.MULTILINE,
    ), "down_revision must be a single-line string literal for coord's parser"


def test_the_upgrade_path_is_classifier_safe() -> None:
    """No index build, no DROP, no autocommit block, no DML; guards intact."""
    surface = _classifier_surface().upper()
    sql = _sql_statements(surface)
    assert "INDEX" not in surface, (
        "the upgrade path must create no index (raw CREATE INDEX, "
        "op.create_index or sa.Index): coord's classifier rejects a "
        "non-concurrent build outright. The read index is the UNIQUE "
        "constraint declared inside CREATE TABLE; see the revision docstring."
    )
    assert "DROP" not in sql, "a DROP on the upgrade path makes coord Reject it"
    assert "AUTOCOMMIT_BLOCK" not in surface, "no autocommit block is needed"
    for dml in ("UPDATE ", "INSERT ", "DELETE "):
        assert dml not in sql, f"the upgrade path must not run DML ({dml.strip()})"
    assert "ADD COLUMN IF NOT EXISTS METHOD TEXT" in re.sub(r"\s+", " ", sql), (
        "method must be added nullable, with no default, behind IF NOT EXISTS"
    )
    assert "CREATE TABLE IF NOT EXISTS COORD.ROUTE_SERVING_HOST_PASSES" in sql
    assert "UNIQUE (HOST, OBSERVED_AT)" in re.sub(r"\s+", " ", sql), (
        "the (host, observed_at) key is the Phase 2 reuse read's index"
    )


def test_every_sql_string_is_a_static_literal() -> None:
    """coord's classifier rejects an execute call it cannot read as a literal."""
    tree = ast.parse(_revision_source())
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
        ):
            assert len(node.args) == 1, "one SQL argument per execute call"
            arg = node.args[0]
            assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
                f"execute on line {node.lineno} is not a static string literal"
            )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, bring up a backend Postgres before running this test."
    ),
)
def test_route_serving_host_passes_01_up_down_up() -> None:
    root = backend_root()
    t0 = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)

    with ephemeral_database(admin_database_url(), "route_serving_passes_test") as (
        engine,
        url,
    ):
        # 1. Parent: neither object exists. Seed an observation row so the
        #    column add runs against a non-empty table.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "route_serving_observations", "method") is None
        assert not table_exists(engine, "coord", "route_serving_host_passes")
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.route_serving_observations
                        (host, route_path, drift_class, provenance)
                    VALUES (:host, '/api/v1/legacy', 'ok', 'test')
                    """
                ),
                {"host": _HOST},
            )

        # 2. Upgrade: a nullable text column with no default; the legacy row
        #    reads NULL, never a guessed method.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert column_info(engine, "route_serving_observations", "method") == (
            "text",
            "YES",
            None,
        )
        with engine.connect() as conn:
            legacy = conn.execute(
                text(
                    "SELECT method FROM coord.route_serving_observations "
                    "WHERE host = :host AND route_path = '/api/v1/legacy'"
                ),
                {"host": _HOST},
            ).scalar_one()
        assert legacy is None, "a pre-existing row has no observed method"

        # 3. The per-pass table: one row per host per pass, and the reuse read
        #    picks the newest pass of the asked host only.
        insert_pass = text(
            """
            INSERT INTO coord.route_serving_host_passes
                (host, observed_at, strategy, drift_class, coverage,
                 credibility, provenance)
            VALUES (:host, :at, 'openapi', :drift, 1.0, 0.9, 'test')
            """
        )
        with engine.begin() as conn:
            conn.execute(insert_pass, {"host": _HOST, "at": t0, "drift": "ok"})
            conn.execute(
                insert_pass,
                {"host": _HOST, "at": t0 + timedelta(minutes=5), "drift": "unknown"},
            )
            conn.execute(
                insert_pass,
                {
                    "host": _OTHER_HOST,
                    "at": t0 + timedelta(minutes=10),
                    "drift": "route_missing",
                },
            )
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(insert_pass, {"host": _HOST, "at": t0, "drift": "ok"})

        with engine.connect() as conn:
            latest = conn.execute(text(_LATEST_PASS_SQL), {"host": _HOST}).all()
            carves = conn.execute(
                text(
                    "SELECT carves FROM coord.route_serving_host_passes "
                    "WHERE host = :host AND observed_at = :at"
                ),
                {"host": _HOST, "at": t0},
            ).scalar_one()
        assert [(row[0], row[1]) for row in latest] == [
            (t0 + timedelta(minutes=5), "unknown")
        ], "the reuse read must return the asked host's newest pass, and only it"
        assert carves == [], "carves defaults to an empty JSON array"

        # 4. Downgrade: both objects gone, the observation row kept.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "route_serving_observations", "method") is None
        assert not table_exists(engine, "coord", "route_serving_host_passes")
        with engine.connect() as conn:
            kept = conn.execute(
                text(
                    "SELECT count(*) FROM coord.route_serving_observations "
                    "WHERE host = :host AND route_path = '/api/v1/legacy'"
                ),
                {"host": _HOST},
            ).scalar_one()
        assert kept == 1, "downgrade must keep the observation rows"

        # 5. Re-upgrade is clean.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", "route_serving_host_passes")
