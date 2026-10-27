"""Schema + round-trip test for the ``coord_agent_questions_recommendation`` revision.

Phase 3 (qontinui-web half) of plan
``2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen``
adds two nullable TEXT columns to ``coord.agent_questions``. What is asserted,
because none of it is visible from a passing ``upgrade``:

1. The pinned parent equals the revision's own ``down_revision``, so this test
   rewinds exactly one edge and never replays an unrelated revision.
2. The column NAMES and TYPES are coord's interface: coord reads both columns
   BY NAME (``try_get("recommendation")``), outside its positional ``COLS``
   projection, so a renamed or retyped column breaks it while the ordinal
   cannot. ``ADD COLUMN IF NOT EXISTS`` is type-blind, so both are read back
   from the catalogue.
3. Both columns are nullable with NO default. NULL is the honest value for
   every historic row (no recommendation was ever recorded); a default would
   fabricate one and make ``shape_share`` lie.
4. Re-running ``upgrade()`` is a no-op (the idempotency guards hold), and
   down -> up leaves no residue.
5. The calls coord's migration classifier reads. It reads the file minus
   ``downgrade()``'s body as the upgrade path: ``upgrade()``, any module-level
   helper and any module-level statement. Every call there must be an
   ``op.execute`` of ONE static string literal, and together they must be
   exactly the ``SET LOCAL lock_timeout`` bound and the guarded
   ``ADD COLUMN``s, a list that classifier answers ``AutoSafe`` for. So there
   is no other ``op.*`` call, no helper call and no ``RESET`` there: the
   classifier fails every ``RESET`` closed, and env.py's ``on_version_apply``
   hook restores ``lock_timeout`` instead. ``downgrade()``'s body may call
   ``op.<method>(...)`` and nothing else, because the classifier refuses SQL
   run through any other receiver anywhere in the file. Structural, so it
   runs without a database.

Substrate for the database-backed test comes from ``_alembic_harness``: an
ephemeral database inside the test Postgres, skipped when none is reachable
(``QONTINUI_TEST_PG`` points it at a non-default host:port). A skip proves
nothing.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_REVISION_ID = "coord_agent_questions_recommendation"
_PARENT_REVISION_ID = "secrets_broker_01"
_REVISION_FILENAME = "coord_agent_questions_recommendation.py"

_TABLE = "agent_questions"
_COLUMNS = ("recommendation", "if_overturned")


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_module() -> ModuleType:
    return load_revision_module(
        _revision_path(), "_rev_coord_agent_questions_recommendation"
    )


def test_pinned_parent_is_the_revisions_down_revision() -> None:
    """A stale pin would rewind too far and replay unrelated revisions."""
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID


def _upgrade_path_and_downgrade_calls(
    path: Path,
) -> tuple[list[ast.Call], list[ast.Call]]:
    """Every call in a revision file, split the way coord's classifier splits it.

    Returns ``(upgrade_path, downgrade_body)``, each in source order. The
    upgrade path is the file minus the body of its top-level ``downgrade()``:
    the classifier cannot prove which helpers ``upgrade()`` reaches, so it reads
    module-level helpers and statements as if ``upgrade()`` ran them.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    in_downgrade = {
        id(node)
        for top in tree.body
        if isinstance(top, ast.FunctionDef) and top.name == "downgrade"
        for statement in top.body
        for node in ast.walk(statement)
    }
    calls = sorted(
        (node for node in ast.walk(tree) if isinstance(node, ast.Call)),
        key=lambda call: (call.lineno, call.col_offset),
    )
    return (
        [call for call in calls if id(call) not in in_downgrade],
        [call for call in calls if id(call) in in_downgrade],
    )


def _op_method(call: ast.Call) -> str | None:
    """``name`` for ``op.name(...)`` called on the bare name ``op``, else None."""
    func = call.func
    if (
        isinstance(func, ast.Attribute)
        and isinstance(func.value, ast.Name)
        and func.value.id == "op"
    ):
        return func.attr
    return None


def _static_sql(call: ast.Call) -> str | None:
    """The call's argument when it is ONE static ``str`` literal, else None."""
    if len(call.args) != 1 or call.keywords:
        return None
    arg = call.args[0]
    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
        return arg.value
    return None


def test_upgrade_path_is_a_shape_coords_migration_classifier_admits() -> None:
    """The calls coord's migration classifier reads: pinned on the upgrade path,
    ``op`` methods only in ``downgrade()``.

    coord lands a migration PR without an escalate-path hold only when that
    classifier (qontinui-coord ``crates/coord/src/pr_merge/migration_classifier.rs``)
    proves the upgrade path additive. It fails every ``RESET`` closed, and both
    earlier generations of this revision ended ``upgrade()`` with ``RESET
    lock_timeout``. The statement list below is the one that classifier, run at
    qontinui-coord ``d2ac748e0``, answers ``AutoSafe`` for. This pins call
    shapes; it is not a port of the classifier, which also refuses things that
    are not calls (reflection names, decorators, its lexer's own limits).
    """
    upgrade_path, downgrade_body = _upgrade_path_and_downgrade_calls(_revision_path())

    statements: list[str] = []
    for call in upgrade_path:
        where = f"line {call.lineno}: {ast.unparse(call.func)}(...)"
        assert _op_method(call) == "execute", (
            f"{where} is on the upgrade path coord's migration classifier reads "
            "(the file minus downgrade()'s body); nothing but the pinned "
            "op.execute calls may be"
        )
        sql = _static_sql(call)
        assert sql is not None, (
            f"{where} must take ONE static string literal: coord's migration "
            "classifier rejects anything dynamic"
        )
        statements.append(" ".join(sql.split()).upper())
    resets = [s for s in statements if re.match(r"RESET\b", s)]
    assert not resets, (
        f"the upgrade path must not run {resets}: coord's migration classifier fails "
        "every RESET closed, and env.py's on_version_apply hook already restores "
        "lock_timeout after each step"
    )
    assert statements == [
        "SET LOCAL LOCK_TIMEOUT = '3S'",
        "ALTER TABLE COORD.AGENT_QUESTIONS"
        " ADD COLUMN IF NOT EXISTS RECOMMENDATION TEXT,"
        " ADD COLUMN IF NOT EXISTS IF_OVERTURNED TEXT",
    ], statements

    foreign = [
        f"line {call.lineno}: {ast.unparse(call.func)}(...)"
        for call in downgrade_body
        if _op_method(call) is None
    ]
    assert not foreign, (
        f"downgrade() makes {foreign}: coord's migration classifier refuses SQL "
        "run through any receiver but op (op.get_bind().execute, conn.execute) "
        "anywhere in the file, so downgrade() calls op.<method>(...) and nothing "
        "else"
    )


def _assert_columns(engine: Engine, *, present: bool) -> None:
    for column in _COLUMNS:
        info = column_info(engine, _TABLE, column)
        if not present:
            assert info is None, f"coord.{_TABLE}.{column} exists: {info}"
            continue
        assert info is not None, f"coord.{_TABLE}.{column} is missing"
        data_type, is_nullable, column_default = info
        assert data_type == "text", f"{column}: type {data_type}"
        assert is_nullable == "YES", f"{column} must be nullable"
        assert column_default is None, f"{column} must carry no default"


@pytest.mark.skipif(
    not can_connect(admin_database_url()), reason="test Postgres not reachable"
)
def test_upgrade_adds_nullable_text_columns_and_round_trips() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "aq_rec") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_columns(engine, present=False)

        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_columns(engine, present=True)

        # Idempotency: alembic will not re-run a revision it has recorded, so
        # the stamp is rewound and the revision applied again over the columns.
        run_alembic(root, db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_columns(engine, present=True)

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns(engine, present=False)

        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_columns(engine, present=True)
