"""Schema + round-trip test for the ``coord_subprojects_03_lineage_vocabulary`` revision.

Phase 1 of plan
``2026-11-16-subproject-lineage-recovers-orphaned-continuations-rehomes-orphans-titles-from-evidence``
(D3) widens ``coord.subproject_members.joined_via`` with ``anchor`` and
``work_evidence``, and adds ``subproject_members.via_detail jsonb`` and
``subprojects.title_basis text`` with its own CHECK.

What is asserted, and the mutation each assertion catches
==========================================================

Source-level (never skip):

* the pinned parent equals ``down_revision`` (re-point one without the other);
* the widened ``joined_via`` IN list is EXACTLY the old list plus the two new
  words, and the old list is exactly ``coord_subprojects_01``'s (drop a word,
  or let the two revisions' vocabularies drift);
* the ``title_basis`` CHECK admits NULL and exactly the five bases (add or drop
  a basis; drop the ``IS NULL`` arm);
* each table is changed by ONE ALTER, under the 3 s lock bound, and the new
  columns carry no NOT NULL / DEFAULT (split the ALTER; add ``DEFAULT
  'derived'``, which would claim a basis no one recorded);
* upgrade writes no rows; downgrade refuses on a new word BEFORE narrowing, and
  narrows to exactly the old list and drops exactly the two columns;
* every ``op.execute`` is a static literal with no ``%`` (an f-string; a
  ``RAISE`` placeholder).

Live (skip without a reachable Postgres; a skip proves nothing — set
``DATABASE_URL`` to an admin URL of a test Postgres):

* after upgrade both columns exist, nullable, no default, carrying the
  revision's COMMENT; the CHECKs admit every word and refuse an unknown one;
* a stamp-back re-run of upgrade succeeds and leaves one constraint of each name;
* down refuses while a row uses ``anchor``; with none it narrows (``anchor`` is
  refused again), drops both columns and keeps every pre-existing row.
"""

from __future__ import annotations

import ast
import re
import uuid
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    collapsed_upper,
    column_comment,
    column_info,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    recorded_sql,
    run_alembic,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. MUST equal the revision's own
# down_revision (the first test enforces it); re-point BOTH together.
_REVISION_ID = "coord_subprojects_03_lineage_vocabulary"
_PARENT_REVISION_ID = "cirscope_01_ci_runner_scope_listings"
_REVISION_FILENAME = "coord_subprojects_03_lineage_vocabulary.py"
_CREATE_FILENAME = "coord_subprojects_01_create.py"

_OLD_JOINED_VIA: tuple[str, ...] = (
    "root",
    "parent",
    "gate_continuation",
    "work_unit_dispatch",
    "spawn",
    "declared",
    "operator_move",
    "auto_attach",
    "followup_edge",
    "split",
    "backfill",
    "merge",
)
_NEW_JOINED_VIA: tuple[str, ...] = ("anchor", "work_evidence")
_TITLE_BASES: tuple[str, ...] = (
    "intent",
    "unit_plan",
    "pr_title",
    "session_name",
    "derived",
)

# (table, column, information_schema.data_type)
_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("subproject_members", "via_detail", "jsonb"),
    ("subprojects", "title_basis", "text"),
)


def _versions() -> Path:
    return backend_root() / "alembic" / "versions"


def _source() -> str:
    return (_versions() / _REVISION_FILENAME).read_text(encoding="utf-8")


def _module() -> ModuleType:
    return load_revision_module(
        _versions() / _REVISION_FILENAME, f"_rev_{_REVISION_ID}"
    )


def _recorded(monkeypatch: pytest.MonkeyPatch, step: str) -> list[str]:
    return [collapsed_upper(s) for s in recorded_sql(_module(), step, monkeypatch)]


def _in_list(sql: str, column: str) -> tuple[str, ...]:
    """The words of ``<column> IN (...)`` in collapsed-upper ``sql``."""
    match = re.search(rf"{column.upper()} IN \(([^)]*)\)", sql)
    assert match, f"no {column} IN list in: {sql}"
    return tuple(w.strip().strip("'").lower() for w in match.group(1).split(","))


def _alters(statements: list[str], table: str) -> list[str]:
    return [
        s for s in statements if s.startswith(f"ALTER TABLE COORD.{table.upper()} ")
    ]


# ---------------------------------------------------------------------------
# Source-level guards — no database needed, so they never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "the revision was re-pointed onto a new chain head and "
        "`_PARENT_REVISION_ID` was not updated with it"
    )
    assert f"Revises: {_PARENT_REVISION_ID}" in _source()


def test_the_old_vocabulary_is_exactly_the_create_revisions() -> None:
    """The narrowed list a downgrade restores must be what _01 created."""
    create = collapsed_upper(
        (_versions() / _CREATE_FILENAME).read_text(encoding="utf-8")
    )
    assert _in_list(create, "joined_via") == _OLD_JOINED_VIA
    module = _module()
    assert tuple(module._JOINED_VIA_BEFORE) == _OLD_JOINED_VIA
    assert tuple(module._JOINED_VIA_ADDED) == _NEW_JOINED_VIA
    assert tuple(module._TITLE_BASES) == _TITLE_BASES


def test_upgrade_widens_joined_via_by_exactly_the_two_words(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    alters = _alters(_recorded(monkeypatch, "upgrade"), "subproject_members")
    assert len(alters) == 1, "one ALTER, so the table never carries a subset"
    alter = alters[0]
    assert _in_list(alter, "joined_via") == _OLD_JOINED_VIA + _NEW_JOINED_VIA
    drop = alter.index("DROP CONSTRAINT IF EXISTS CK_SUBPROJECT_MEMBERS_JOINED_VIA")
    add = alter.index("ADD CONSTRAINT CK_SUBPROJECT_MEMBERS_JOINED_VIA CHECK")
    assert drop < add, "the old CHECK is dropped before the widened one is added"
    assert "NOT VALID" not in alter


def test_upgrade_adds_title_basis_with_a_null_admitting_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    alters = _alters(_recorded(monkeypatch, "upgrade"), "subprojects")
    assert len(alters) == 1
    alter = alters[0]
    assert "ADD COLUMN IF NOT EXISTS TITLE_BASIS TEXT," in alter
    assert "DROP CONSTRAINT IF EXISTS CK_SUBPROJECTS_TITLE_BASIS" in alter
    assert (
        "ADD CONSTRAINT CK_SUBPROJECTS_TITLE_BASIS CHECK ( TITLE_BASIS IS NULL OR"
        in alter
    )
    assert _in_list(alter, "title_basis") == _TITLE_BASES


def test_the_new_columns_carry_no_default_and_no_not_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """NULL is load-bearing: 'not recorded', never a fabricated basis."""
    statements = _recorded(monkeypatch, "upgrade")
    for table, column, _ in _COLUMNS:
        (alter,) = _alters(statements, table)
        # The bare type must be followed directly by the comma that ends the
        # ADD clause: any NOT NULL / DEFAULT / REFERENCES / UNIQUE between the
        # type and the comma makes this pattern miss.
        clause = re.search(rf"ADD COLUMN IF NOT EXISTS {column.upper()} (\w+),", alter)
        assert clause, f"{column}: ADD clause carries a modifier or is missing"


def test_upgrade_is_lock_bounded_and_writes_no_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = _recorded(monkeypatch, "upgrade")
    assert statements[0] == "SET LOCAL LOCK_TIMEOUT = '3S'"
    # One lock request for both tables, parent first, before any ALTER.
    assert statements[1] == (
        "LOCK TABLE COORD.SUBPROJECTS, COORD.SUBPROJECT_MEMBERS IN ACCESS EXCLUSIVE MODE"
    )
    for sql in statements:
        if sql.startswith("COMMENT ON"):
            continue
        assert not re.search(r"\b(UPDATE|INSERT|DELETE|COPY|DROP TABLE)\b", sql), sql


def test_every_new_column_carries_a_comment_stating_what_null_means() -> None:
    source = _source()
    for table, column, _ in _COLUMNS:
        body = comment_body_from_source(source, f"coord.{table}.{column}")
        assert "NULL" in body, f"{column}'s comment must state what NULL means"


def test_downgrade_refuses_first_then_narrows_and_drops_both_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = _recorded(monkeypatch, "downgrade")
    guard = next(i for i, s in enumerate(statements) if s.startswith("DO $$"))
    assert "JOINED_VIA IN ('ANCHOR', 'WORK_EVIDENCE')" in statements[guard]
    assert "RAISE EXCEPTION" in statements[guard]
    lock = statements.index(
        "LOCK TABLE COORD.SUBPROJECTS, COORD.SUBPROJECT_MEMBERS IN ACCESS EXCLUSIVE MODE"
    )
    assert lock < guard, "lock BEFORE the refusal check (no insert in between)"

    (members,) = _alters(statements, "subproject_members")
    (subprojects,) = _alters(statements, "subprojects")
    assert guard < statements.index(members), "refuse BEFORE narrowing"
    assert _in_list(members, "joined_via") == _OLD_JOINED_VIA
    assert "DROP COLUMN IF EXISTS VIA_DETAIL" in members
    assert "DROP COLUMN IF EXISTS TITLE_BASIS" in subprojects
    joined = " ".join(statements)
    assert joined.count("DROP COLUMN") == 2
    assert "DROP TABLE" not in joined
    assert not re.search(r"\b(UPDATE|DELETE)\b", joined), (
        "the downgrade never rewrites a member's joined_via"
    )


def test_every_op_execute_is_a_static_literal_with_no_percent() -> None:
    """coord's migration classifier reads only static literals; a ``%`` would
    have to survive SQLAlchemy's pyformat escaping."""
    tree = ast.parse(_source())
    calls = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "execute"
        and isinstance(n.func.value, ast.Name)
        and n.func.value.id == "op"
    ]
    assert calls
    for call in calls:
        assert len(call.args) == 1 and not call.keywords
        arg = call.args[0]
        assert isinstance(arg, ast.Constant) and isinstance(arg.value, str)
        assert "%" not in arg.value
        assert not re.search(r"(?<!:):[A-Za-z_]", arg.value), arg.value


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set DATABASE_URL")
    return url


def _new_subproject(engine: Engine, title_basis: str | None = None) -> str:
    with engine.begin() as conn:
        return str(
            conn.execute(
                text(
                    """
                    INSERT INTO coord.subprojects
                        (tenant_id, slug, title, origin, title_basis)
                    VALUES (gen_random_uuid(), :slug, 't', 'operator_prompt', :b)
                    RETURNING id
                    """
                ),
                {"slug": f"s-{uuid.uuid4().hex[:12]}", "b": title_basis},
            ).scalar_one()
        )


def _new_member(engine: Engine, subproject: str, joined_via: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.subproject_members
                    (tenant_id, subproject_id, member_kind, agent_session_id,
                     joined_via, via_ref, via_detail)
                SELECT tenant_id, id, 'session', gen_random_uuid(), :j,
                       'qontinui/qontinui-web#1', '{"rule": "test"}'::jsonb
                  FROM coord.subprojects WHERE id = CAST(:s AS uuid)
                """
            ),
            {"s": subproject, "j": joined_via},
        )


def _new_subproject_old_shape(engine: Engine) -> str:
    """A subproject written before this revision (no title_basis column yet)."""
    with engine.begin() as conn:
        return str(
            conn.execute(
                text(
                    """
                    INSERT INTO coord.subprojects (tenant_id, slug, title, origin)
                    VALUES (gen_random_uuid(), :slug, 't', 'operator_prompt')
                    RETURNING id
                    """
                ),
                {"slug": f"s-{uuid.uuid4().hex[:12]}"},
            ).scalar_one()
        )


def _new_member_old_shape(engine: Engine, subproject: str, word: str) -> None:
    """A member insert that names no via_detail (valid before and after)."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.subproject_members
                    (tenant_id, subproject_id, member_kind, agent_session_id,
                     joined_via)
                SELECT tenant_id, id, 'session', gen_random_uuid(), :j
                  FROM coord.subprojects WHERE id = CAST(:s AS uuid)
                """
            ),
            {"s": subproject, "j": word},
        )


def _constraint_count(engine: Engine, name: str) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT count(*) FROM pg_constraint WHERE conname = :c"),
                {"c": name},
            ).scalar_one()
        )


def _assert_columns_present(engine: Engine) -> None:
    source = _source()
    for table, column, pg_type in _COLUMNS:
        info = column_info(engine, table, column)
        assert info is not None, f"{column} missing after upgrade"
        data_type, is_nullable, default = info
        assert data_type == pg_type
        assert is_nullable == "YES"
        assert default is None
        assert column_comment(engine, table, column) == comment_body_from_source(
            source, f"coord.{table}.{column}"
        )


def test_live_columns_and_both_checks() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "subp03") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)

        subproject = _new_subproject(engine)
        for word in _OLD_JOINED_VIA + _NEW_JOINED_VIA:
            _new_member(engine, subproject, word)
        with pytest.raises(Exception, match="ck_subproject_members_joined_via"):
            _new_member(engine, subproject, "guessed")

        for basis in (None, *_TITLE_BASES):
            _new_subproject(engine, basis)
        with pytest.raises(Exception, match="ck_subprojects_title_basis"):
            _new_subproject(engine, "operator")


def test_live_rerun_leaves_one_constraint_of_each_name() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "subp03s") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _constraint_count(engine, "ck_subproject_members_joined_via") == 1
        assert _constraint_count(engine, "ck_subprojects_title_basis") == 1
        _assert_columns_present(engine)


def test_live_downgrade_refuses_on_a_new_word_then_narrows_and_keeps_rows() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "subp03d") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        kept = _new_subproject_old_shape(engine)
        _new_member_old_shape(engine, kept, "root")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        anchored = _new_subproject(engine, "pr_title")
        _new_member(engine, anchored, "anchor")

        refused = run_alembic(
            backend_root(),
            db_url,
            "downgrade",
            _PARENT_REVISION_ID,
            expect_success=False,
        )
        assert refused.returncode != 0
        assert "refusing to downgrade" in refused.stderr + refused.stdout
        _assert_columns_present(engine)

        with engine.begin() as conn:
            conn.execute(
                text(
                    "DELETE FROM coord.subproject_members "
                    "WHERE subproject_id = CAST(:s AS uuid)"
                ),
                {"s": anchored},
            )
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for table, column, _ in _COLUMNS:
            assert column_info(engine, table, column) is None, f"{column} survived"
        with pytest.raises(Exception, match="ck_subproject_members_joined_via"):
            _new_member_old_shape(engine, kept, "anchor")
        with engine.connect() as conn:
            members = conn.execute(
                text(
                    "SELECT count(*) FROM coord.subproject_members "
                    "WHERE subproject_id = CAST(:s AS uuid)"
                ),
                {"s": kept},
            ).scalar_one()
        assert members == 1, "the downgrade destroyed a pre-existing member row"
