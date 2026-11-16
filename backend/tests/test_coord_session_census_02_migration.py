"""Schema + round-trip test for the ``coord_session_census_02`` revision.

Phase 2 of plan ``2026-11-16-runner-page-name-reaches-the-coord-session-identity-card``
adds five nullable placement columns to ``coord.session_census``. Pins:

1. **The column contract, EXACTLY** — after this revision the table's column
   set is ``coord_session_census_01``'s set plus these five, no more. The census
   column list is a cross-repo contract (coord's ingest and read are written
   against it) and a privacy contract (no transcript content, no environment
   values, no credentials), so widening it must be a reviewed edit of a test.
   The ``_01`` set is imported from that revision's own test, so the two cannot
   drift apart.
2. **Nullable with no DEFAULT.** NULL means "placement not reported"; a default
   would fabricate a page (or a ``page_name_withheld = false`` verdict) into
   every row a runner without the producer change posts.
3. **Up -> down -> up leaves no residue and keeps pre-existing rows.**
4. **The two label columns carry their ``COMMENT``.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing: point it
at a live instance with ``DATABASE_URL``.
"""

from __future__ import annotations

import ast
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    alter_statement,
    assert_nullable_add_only,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    recorded_sql,
    run_alembic,
    table_exists,
)
from tests.test_coord_session_census_01_migration import (
    _EXPECTED_SESSION_COLUMNS as _CENSUS_01_SESSION_COLUMNS,
)
from tests.test_coord_session_census_01_migration import _FORBIDDEN_NAME

_REVISION_ID = "coord_session_census_02"
_REVISION_FILENAME = "coord_session_census_02.py"
_CENSUS_01_REVISION_ID = "coord_session_census_01"

_TABLE = "session_census"
_QUALIFIED = f"coord.{_TABLE}"


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime.

    Never hardcode the parent: coord re-points ``down_revision`` at land when a
    peer revision lands first, and a pinned constant would then upgrade to a
    revision that is no longer this one's parent.
    """
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

# (column, information_schema.data_type, DDL spelling) — the five placement
# columns, in the order the revision adds them.
_PLACEMENT: tuple[tuple[str, str, str], ...] = (
    ("terminal_id", "text", "TEXT"),
    ("page_id", "text", "TEXT"),
    ("page_name", "text", "TEXT"),
    ("page_name_withheld", "boolean", "BOOLEAN"),
    ("page_window", "text", "TEXT"),
)

_EXPECTED_SESSION_COLUMNS: dict[str, tuple[str, str]] = {
    **_CENSUS_01_SESSION_COLUMNS,
    **{name: (pg_type, "YES") for name, pg_type, _ in _PLACEMENT},
}

_COMMENTED = ("page_name", "page_name_withheld")

_DEVICE = uuid.UUID("3b1f6c2e-8d4a-4e7b-b9c0-5a2d7e9f1c63")
_SESSION = "c2a9e7d1-5f3b-4a8e-9d6c-1b4f7e2a8c05"
_OBSERVED = datetime(2026, 11, 16, 9, 0, tzinfo=UTC)


def _revision_module():
    return load_revision_module(_revision_path(), f"_rev_{_REVISION_ID}")


def _expected_comment(column: str) -> str:
    return comment_body_from_source(_revision_source(), f"{_QUALIFIED}.{column}")


# ---------------------------------------------------------------------------
# Source-level guards — no database needed, so they never skip.
# ---------------------------------------------------------------------------


def test_the_revision_chains_after_census_01() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID


def test_no_placement_column_is_content_or_credential_named() -> None:
    """The census privacy rule, applied to the widened set."""
    forbidden = sorted(
        c for c in _EXPECTED_SESSION_COLUMNS if _FORBIDDEN_NAME.search(c)
    )
    assert forbidden == [], f"content/credential-named column(s) {forbidden}"


def test_upgrade_is_one_nullable_add_then_comments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Nullable, no DEFAULT / CHECK / constraint, no DROP, no backfill — static."""
    assert_nullable_add_only(
        recorded_sql(_revision_module(), "upgrade", monkeypatch), "coord", _TABLE
    )


def test_the_static_add_and_drop_cover_exactly_the_five_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _revision_module()
    add = " ".join(
        alter_statement(
            recorded_sql(module, "upgrade", monkeypatch), "coord", _TABLE, "ADD"
        ).split()
    )
    drops = " ".join("\n".join(recorded_sql(module, "downgrade", monkeypatch)).split())
    assert f"ALTER TABLE {_QUALIFIED}" in drops, (
        "downgrade() must ALTER the qualified table; an unqualified name would "
        "hit whatever `search_path` happens to be"
    )
    for name, _, ddl_type in _PLACEMENT:
        assert f"ADD COLUMN IF NOT EXISTS {name} {ddl_type}" in add
        assert f"DROP COLUMN IF EXISTS {name}" in drops
    assert add.count("ADD COLUMN") == len(_PLACEMENT)
    assert drops.count("DROP COLUMN") == len(_PLACEMENT)


def test_the_label_columns_carry_comments_stating_null() -> None:
    for name in _COMMENTED:
        assert "NULL" in _expected_comment(name), (
            f"{name}'s comment must state what NULL means"
        )


def test_every_op_execute_takes_a_static_string_literal() -> None:
    """coord's migration classifier rejects a dynamic ``op.execute`` argument."""
    tree = ast.parse(_revision_source())
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "execute"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls
    for call in calls:
        assert len(call.args) == 1 and not call.keywords
        arg = call.args[0]
        assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
            f"op.execute at line {call.lineno} is not a static string literal"
        )


def test_no_drop_column_text_outside_downgrade() -> None:
    """The column-drop guard scans everything but ``downgrade()``."""
    tree = ast.parse(_revision_source())
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "downgrade":
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # the module docstring is prose
        for literal in (
            n.value
            for n in ast.walk(node)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
        ):
            assert not re.search(r"\bDROP\s+COLUMN\b", literal, re.I)


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _columns(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _assert_placement_present(engine: Engine) -> None:
    assert _columns(engine) == _EXPECTED_SESSION_COLUMNS, (
        "coord.session_census' column set moved. It is a cross-repo contract "
        "and a privacy contract: no transcript content, no environment "
        "values, no credentials."
    )
    for name, _, _ in _PLACEMENT:
        info = column_info(engine, _TABLE, name)
        assert info is not None and info[2] is None, (
            f"{name} carries a DEFAULT; NULL must mean 'placement not reported'"
        )
    for name in _COMMENTED:
        assert column_comment(engine, _TABLE, name) == _expected_comment(name)


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set DATABASE_URL")
    return url


def test_up_down_up_leaves_no_residue_and_keeps_census_rows() -> None:
    admin_url = _admin_url_or_skip()
    root = backend_root()
    with ephemeral_database(admin_url, "sesscensus02") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", _PARENT_REVISION_ID)
        assert _columns(engine) == _CENSUS_01_SESSION_COLUMNS
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.session_census_device
                        (device_id, observed_at, row_count, account_homes)
                    VALUES (:device, :observed, 1, 1)
                    """
                ),
                {"device": _DEVICE, "observed": _OBSERVED},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.session_census
                        (device_id, session_id, pid, pid_alive)
                    VALUES (:device, :session, 100, true)
                    """
                ),
                {"device": _DEVICE, "session": _SESSION},
            )

        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_placement_present(engine)
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT terminal_id, page_id, page_name, page_name_withheld,
                           page_window
                      FROM coord.session_census
                     WHERE device_id = :device AND session_id = :session
                    """
                ),
                {"device": _DEVICE, "session": _SESSION},
            ).one()
        assert tuple(row) == (None, None, None, None, None), (
            "a row posted before placement existed must read NULL (not "
            "reported), never a fabricated page or withheld verdict"
        )

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        assert _columns(engine) == _CENSUS_01_SESSION_COLUMNS
        with engine.connect() as conn:
            survived = conn.execute(
                text("SELECT count(*) FROM coord.session_census WHERE device_id = :d"),
                {"d": _DEVICE},
            ).scalar_one()
        assert survived == 1, "downgrade destroyed a pre-existing census row"

        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_placement_present(engine)


def test_census_01_is_still_this_revisions_ancestor() -> None:
    """The ``_01`` column set imported above is the right base only while
    ``coord_session_census_01`` precedes this revision in the chain."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(Config(str(backend_root() / "alembic.ini")))
    ancestors = {rev.revision for rev in script.iterate_revisions(_REVISION_ID, "base")}
    assert _CENSUS_01_REVISION_ID in ancestors
