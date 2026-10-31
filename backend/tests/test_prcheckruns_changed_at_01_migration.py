"""Shape and walk tests for the ``prcheckruns_changed_at_01`` revision.

Phase 3a of plan
``2026-10-17-coord-overdue-floor-gives-every-seat-to-newer-inputs-so-stale-pass-and-stale-ready-block-never-fire``
adds ``coord.pr_check_runs.changed_at`` and rebuilds
``coord.pr_check_runs_latest`` so the new column is visible through the view.

What can go wrong that a green ``upgrade`` does not show
========================================================

* **A default stamps the population.** A ``DEFAULT now()`` would mark every
  existing row changed at migration time, so every open PR would read as having
  newer inputs at once. Asserted on a row seeded BEFORE the upgrade.
* **The rebuild drops ``security_invoker``.** ``CREATE OR REPLACE VIEW`` replaces
  a view's options with its own ``WITH`` clause, and an owner-rights view bypasses
  row-level security for every tenant reading it. Asserted from the catalog in
  both directions.
* **The rebuild changes the tiebreak.** The SELECT is compared byte-for-byte with
  ``prcheckruns_latest_03``'s, and the served row is asserted on seeded data.
* **The downgrade loses the grants.** A dropped view loses its ACL. The ACL after
  the walk is compared with the ACL before it.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
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

_REVISION_ID = "prcheckruns_changed_at_01"
_REVISION_FILENAME = "prcheckruns_changed_at_01_changed_at_column.py"

# The revision whose SELECT this one re-executes. Compared against rather than
# copied, so there is one author of the conclusive-first tiebreak.
_VIEW_AUTHOR_FILENAME = "prcheckruns_latest_03_conclusive_first.py"

_TABLE = "pr_check_runs"
_VIEW = "pr_check_runs_latest"
_QUALIFIED_COLUMN = "coord.pr_check_runs.changed_at"

# The view's projection before this revision, in order.
_PRE_REVISION_VIEW_COLUMNS = (
    "repo",
    "head_sha",
    "check_id",
    "name",
    "status",
    "conclusion",
    "started_at",
    "completed_at",
    "details_url",
    "updated_at",
    "head_branch",
    "base_sha",
)

_REPO = "qontinui/probe"
_HEAD = "0123456789abcdef0123456789abcdef01234567"
_T0 = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)


def _versions_dir():
    return backend_root() / "alembic" / "versions"


def _revision_source() -> str:
    return (_versions_dir() / _REVISION_FILENAME).read_text(encoding="utf-8")


# Parsed at runtime, never pinned: coord re-points `down_revision` at land.
_PARENT_REVISION_ID = declared_parent_revision_id(
    _revision_source(), _REVISION_FILENAME
)


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_the_select_is_prcheckruns_latest_03s_verbatim() -> None:
    """Only the statement's header differs, and only by the ``WITH`` clause."""
    under_test = load_revision_module(
        _versions_dir() / _REVISION_FILENAME, "_prcheckruns_changed_at_01_under_test"
    )._LATEST_VIEW_CONCLUSIVE_FIRST
    author = load_revision_module(
        _versions_dir() / _VIEW_AUTHOR_FILENAME, "_prcheckruns_latest_03_author"
    )._LATEST_VIEW_CONCLUSIVE_FIRST

    header_under_test, _, select_under_test = under_test.partition(" AS\n")
    header_author, _, select_author = author.partition(" AS\n")

    assert select_under_test == select_author, (
        "the view's SELECT drifted from prcheckruns_latest_03"
    )
    assert header_under_test == f"{header_author} WITH (security_invoker = true)"


def test_every_drop_lives_inside_downgrade() -> None:
    """``coord-column-drop-guard`` scans the module minus ``downgrade()``."""
    tree = ast.parse(_revision_source())
    downgrade = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "downgrade"
    )
    downgrade_range = range(downgrade.lineno, downgrade.end_lineno + 1)  # type: ignore[arg-type]
    drops_outside = [
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.lineno != 1  # the module docstring is prose
        and re.search(r"\bDROP\b", node.value)
        and node.lineno not in downgrade_range
    ]
    assert not drops_outside, f"DROP outside downgrade() at lines {drops_outside}"


# ---------------------------------------------------------------------------
# Walks — need the test Postgres.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


@pytest.fixture
def at_parent(_admin_url: str) -> Iterator[tuple[Engine, str]]:
    """A database at this revision's parent, holding a pre-existing check row."""
    with ephemeral_database(_admin_url, "prcheckruns_changed_at_01") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
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
                {
                    "repo": _REPO,
                    "head": _HEAD,
                    "t0": _T0,
                    "t1": _T0 + timedelta(hours=1),
                },
            )
        yield engine, db_url


def _view_columns(engine: Engine) -> tuple[str, ...]:
    with engine.connect() as conn:
        rows = conn.execute(
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
    return tuple(r[0] for r in rows)


def _view_catalog(engine: Engine) -> tuple[list[str] | None, set[str]]:
    """The view's reloptions, and its ACL as a set (grant order is not meaning)."""
    with engine.connect() as conn:
        options, acl = conn.execute(
            text(
                """
                SELECT c.reloptions, c.relacl::text[]
                  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :view
                """
            ),
            {"view": _VIEW},
        ).one()
    return options, set(acl or ())


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
    assert len(rows) == 1, f"the view served {len(rows)} rows for one name"
    return tuple(rows[0])


def _dependents(engine: Engine) -> list[str]:
    """Objects whose rewrite rules read the view, which a DROP would refuse on."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT DISTINCT r.ev_class::regclass::text
                  FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
                 WHERE d.classid = 'pg_rewrite'::regclass
                   AND d.refclassid = 'pg_class'::regclass
                   AND d.refobjid = 'coord.pr_check_runs_latest'::regclass
                   AND r.ev_class <> 'coord.pr_check_runs_latest'::regclass
                """
            )
        ).fetchall()
    return [r[0] for r in rows]


def test_upgrade_adds_the_column_and_keeps_the_view_properties(
    at_parent: tuple[Engine, str],
) -> None:
    """Nullable with no default, visible through the view, nothing else moved."""
    engine, db_url = at_parent
    options_before, acl_before = _view_catalog(engine)
    assert options_before == ["security_invoker=true"], "the parent is not the baseline"
    assert _view_columns(engine) == _PRE_REVISION_VIEW_COLUMNS

    run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

    assert column_info(engine, _TABLE, "changed_at") == (
        "timestamp with time zone",
        "YES",
        None,
    ), "changed_at must be nullable with NO default (module docs)"
    assert column_comment(engine, _TABLE, "changed_at") == comment_body_from_source(
        _revision_source(), _QUALIFIED_COLUMN
    )
    assert _view_columns(engine) == (*_PRE_REVISION_VIEW_COLUMNS, "changed_at")
    assert _view_catalog(engine) == (options_before, acl_before), (
        "the rebuild changed the view's options or its grants"
    )
    assert _served(engine) == (1, "success"), "the rebuild lost the tiebreak"
    with engine.connect() as conn:
        stamped = conn.execute(
            text(
                "SELECT count(changed_at) FROM coord.pr_check_runs_latest "
                "WHERE repo = :repo"
            ),
            {"repo": _REPO},
        ).scalar_one()
    assert stamped == 0, "the migration stamped a row that existed before it"


def test_up_down_up_restores_the_view_exactly(at_parent: tuple[Engine, str]) -> None:
    """Downgrade restores projection, option and grants; re-upgrade restores all."""
    engine, db_url = at_parent
    catalog_before = _view_catalog(engine)

    run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
    assert _dependents(engine) == [], "the downgrade would refuse on a dependent"

    # coordrls_01's default privileges would grant the re-created view by
    # themselves here, because one role runs every revision in this database. In
    # production the migrating role may not be the one that declared them, so
    # revoke them to make the downgrade's explicit GRANT the only source of the ACL.
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER DEFAULT PRIVILEGES IN SCHEMA coord REVOKE SELECT, INSERT, "
                "UPDATE, DELETE ON TABLES FROM coord_tenant, coord_tenant_preflight"
            )
        )
        # The revoke acts on the CURRENT role's defaults. If the harness ever runs
        # this engine as a different role from alembic, it would do nothing.
        remaining = conn.execute(
            text(
                """
                SELECT count(*) FROM pg_default_acl d
                JOIN pg_namespace n ON n.oid = d.defaclnamespace
                WHERE n.nspname = 'coord' AND d.defaclobjtype = 'r'
                  AND (d.defaclacl::text LIKE '%coord_tenant=%'
                       OR d.defaclacl::text LIKE '%coord_tenant_preflight=%')
                """
            )
        ).scalar_one()
    assert remaining == 0, "the default-privilege revoke did not take effect"

    run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
    assert column_info(engine, _TABLE, "changed_at") is None
    assert _view_columns(engine) == _PRE_REVISION_VIEW_COLUMNS
    assert _view_catalog(engine) == catalog_before, (
        "the downgrade did not restore the view's security_invoker option or grants"
    )
    assert _served(engine) == (1, "success")

    run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
    assert _view_columns(engine) == (*_PRE_REVISION_VIEW_COLUMNS, "changed_at")
    assert _view_catalog(engine) == catalog_before
    assert _served(engine) == (1, "success")


def test_upgrade_is_idempotent(at_parent: tuple[Engine, str]) -> None:
    """A retry after a lock timeout re-runs every statement, so none may fail."""
    engine, db_url = at_parent
    run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
    run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
    run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
    assert column_info(engine, _TABLE, "changed_at") is not None
    assert _view_columns(engine) == (*_PRE_REVISION_VIEW_COLUMNS, "changed_at")
