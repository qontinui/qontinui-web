"""Shape, behaviour and round-trip test for
``plan_library_12_followup_identity_is_the_note``.

Phase 2 of ``2026-11-08-a-plan-can-own-many-followups-from-one-source-plan``: a
follow-up is identified by the finding it records, not by the pair of artifacts
it connects. ``uq_work_artifact_edges_from_to_relation`` was ``UNIQUE (from_id,
to_id, relation)`` over every row, so one plan could own exactly one of a source
plan's follow-ups.

What is pinned, and why each matters:

* **Static, no database.** Every ``op.execute`` in ``upgrade()`` is ONE static
  literal inside the autocommit block (the shape coord's migration classifier
  admits), the builds come BEFORE the drop of the old index with the validity
  assertion between them, the predicates equal the model's constants, and the
  validity probe is the only read through the migration connection (the
  downgrade's refusal is one ``DO`` block, so it adds nothing of its own).
* **Model = migration, through PostgreSQL.** ``conftest`` builds the shared test
  database from ``Base.metadata``, not alembic, so an index the model spells
  differently would be invisible to every API test. Each guard the model
  declares is compiled by SQLAlchemy, built on a probe table, and compared with
  the migrated index by ``pg_get_indexdef`` - PostgreSQL's own normalisation, so
  a reformatting cannot fail it and a real difference (the backslash escapes of
  the trim expression above all) cannot pass it.
* **The capability and its fence.** An owner can hold any number of a source's
  follow-ups; the same finding twice under one owner is refused; and a duplicate
  ``(from_id, to_id, relation)`` is still refused for EVERY other relation, one
  at a time so a failure names the relation, read from the model's vocabulary so
  the list cannot lag it.
* **The ratchet, at ``head``.** Not "at this revision": a later revision that
  restores a unique index over exactly ``(from_id, to_id, relation)`` whose
  predicate admits an owned follow-up - the open edge-correction PR rebuilds the
  old index under the old name - fails HERE, in its own PR.
* **Existing data, a round trip, and a downgrade that refuses.** Owned
  follow-ups are seeded BEFORE the upgrade (the only thing that pins "cannot fail
  on existing data"); the downgrade by NAME restores the full index and loses no
  row; and with two owned follow-ups sharing a pair it refuses, naming the
  count, and changes nothing.
* **A failed concurrent build is neither skipped nor trusted.** ``IF NOT EXISTS``
  skips an INVALID leftover by name. The revision drops it and rebuilds, and
  asserts both new indexes valid BEFORE it drops the old one: with the leftover
  forced to survive, the upgrade refuses and the old index is still there.

Substrate is ``tests/_alembic_harness``. These tests need a live PostgreSQL and
FAIL (rather than skip) without one: a skipped migration test proves nothing.
Point it at one with ``QONTINUI_TEST_PG`` / ``QONTINUI_TEST_PG_DSN``. Marking an
index INVALID updates ``pg_index``, which takes a superuser (CI's database role
is one).
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateIndex

from app.models.work_artifact import (
    NON_FOLLOWUP_PAIR_SQL,
    NOTE_TRIM_SQL,
    OWNED_FOLLOWUP_SQL,
    SPAWNED_FOLLOWUP_RELATION,
    WORK_ARTIFACT_RELATIONS,
    WorkArtifactEdge,
)
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    upgrade_execute_calls,
)

_REVISION_ID = "plan_library_12_followup_identity_is_the_note"
_REVISION_FILENAME = f"{_REVISION_ID}.py"

_OLD_INDEX = "uq_work_artifact_edges_from_to_relation"
_PAIR_INDEX = "uq_work_artifact_edges_from_to_relation_non_followup"
_OWNED_INDEX = "uq_work_artifact_edges_owned_followup"
_OPEN_INDEX = "uq_work_artifact_edges_open_followup"

#: The three guards the model declares over ``agent.work_artifact_edges``.
_GUARDS = (_PAIR_INDEX, _OWNED_INDEX, _OPEN_INDEX)

#: Every relation whose triple stays unique in the database - the whole
#: vocabulary but the follow-up, read from the model so it cannot lag it.
_PAIR_UNIQUE_RELATIONS: tuple[str, ...] = tuple(
    relation
    for relation in WORK_ARTIFACT_RELATIONS
    if relation != SPAWNED_FOLLOWUP_RELATION
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """Parsed from the revision itself at runtime, never hardcoded - a rebase
    onto a newer head re-points ``down_revision`` and this follows it."""
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


def _squash(sql: str) -> str:
    return " ".join(sql.split())


# ───────────────────────────── static ─────────────────────────────


def test_the_parent_is_a_real_revision() -> None:
    parent = _parent_revision_id()
    versions = backend_root() / "alembic" / "versions"
    owners = [
        path.name
        for path in versions.glob("*.py")
        if re.search(
            rf'^revision[^=]*=\s*["\']{re.escape(parent)}["\']',
            path.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
    ]
    assert len(owners) == 1, (parent, owners)


def test_the_revision_id_is_unique_in_the_chain() -> None:
    versions = backend_root() / "alembic" / "versions"
    same_id = [
        path.name
        for path in versions.glob("*.py")
        if re.search(
            rf'^revision[^=]*=\s*["\']{re.escape(_REVISION_ID)}["\']',
            path.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
    ]
    assert same_id == [_REVISION_FILENAME]


def test_the_parent_is_declared_on_one_unannotated_line() -> None:
    """coord's parser is line-scoped: a wrapped ``down_revision`` yields no
    parent there, and the revision then reads as a second authored head
    (``plan_library_06_scan_root_slug_census`` records the 2026-09-16 incident)."""
    lines = [
        line
        for line in _revision_source().splitlines()
        if line.startswith("down_revision")
    ]
    assert len(lines) == 1, lines
    assert re.fullmatch(r'down_revision = "[A-Za-z0-9_]+"', lines[0]), lines[0]
    assert lines[0] == f'down_revision = "{_parent_revision_id()}"'


def test_the_docstring_names_the_parent_it_revises() -> None:
    assert f"Revises: {_parent_revision_id()}\n" in _revision_source()


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source(), filename=_REVISION_FILENAME)
    (found,) = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == name
    ]
    return found


def _is_op_execute(node: ast.Call) -> bool:
    func = node.func
    return (
        isinstance(func, ast.Attribute)
        and func.attr == "execute"
        and isinstance(func.value, ast.Name)
        and func.value.id == "op"
    )


def _events(function: str) -> list[tuple[str, str | None]]:
    """``("execute", <squashed literal>)`` for each ``op.execute`` and
    ``("require_valid", None)`` for each ``_require_valid(...)`` call in
    ``function``, in SOURCE order."""
    found: list[tuple[int, int, str, str | None]] = []
    for node in ast.walk(_function(function)):
        if not isinstance(node, ast.Call):
            continue
        if _is_op_execute(node):
            (arg,) = node.args
            assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
                f"line {node.lineno}: op.execute is not ONE static string literal"
            )
            found.append((node.lineno, node.col_offset, "execute", _squash(arg.value)))
        elif isinstance(node.func, ast.Name) and node.func.id == "_require_valid":
            found.append((node.lineno, node.col_offset, "require_valid", None))
    found.sort()
    return [(kind, sql) for _, _, kind, sql in found]


_CREATE_PAIR = (
    f"CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS {_PAIR_INDEX} "
    f"ON agent.work_artifact_edges (from_id, to_id, relation) "
    f"WHERE {NON_FOLLOWUP_PAIR_SQL}"
)
_CREATE_OWNED = (
    f"CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS {_OWNED_INDEX} "
    f"ON agent.work_artifact_edges (from_id, to_id, relation, {NOTE_TRIM_SQL}) "
    f"WHERE {OWNED_FOLLOWUP_SQL}"
)


def test_every_upgrade_execute_is_a_static_literal_in_the_autocommit_block() -> None:
    """coord's classifier admits a static literal only, and a CONCURRENTLY
    statement only inside ``autocommit_block`` (where it cannot run in the
    migration transaction). Every statement here is CONCURRENTLY."""
    calls = upgrade_execute_calls(_revision_path())
    assert calls, "upgrade() executes nothing"
    for call in calls:
        assert call.sql is not None, call
        assert "CONCURRENTLY" in call.sql, call
        assert call.in_autocommit_block, call


def test_the_builds_come_first_the_assertion_next_the_drop_last() -> None:
    """Create first, drop last: there is never a moment without a guard, and an
    assertion that fails leaves the old index in place."""
    drop_pair = f"DROP INDEX CONCURRENTLY IF EXISTS agent.{_PAIR_INDEX}"
    drop_owned = f"DROP INDEX CONCURRENTLY IF EXISTS agent.{_OWNED_INDEX}"
    drop_old = f"DROP INDEX CONCURRENTLY IF EXISTS agent.{_OLD_INDEX}"
    assert _events("upgrade") == [
        # An INVALID leftover of a new name is dropped so the build runs again
        # (``IF NOT EXISTS`` would skip it and it would then be counted on).
        ("execute", drop_pair),
        ("execute", drop_owned),
        ("execute", _CREATE_PAIR),
        ("execute", _CREATE_OWNED),
        ("require_valid", None),
        ("execute", drop_old),
    ]


def test_the_assertion_names_both_new_indexes_and_the_recovery() -> None:
    """``_require_valid(<both new names>)`` sits between the builds and the drop;
    its refusal text is the recovery an operator needs."""
    source = _revision_source()
    assert "_require_valid(_NON_FOLLOWUP_INDEX, _OWNED_INDEX)" in source
    module = load_revision_module(_revision_path(), "plan_library_12_static")
    assert module._NON_FOLLOWUP_INDEX == _PAIR_INDEX
    assert module._OWNED_INDEX == _OWNED_INDEX
    assert module._OLD_INDEX == _OLD_INDEX
    assert "DROP INDEX CONCURRENTLY agent." in source


def test_the_predicates_are_the_models() -> None:
    """The model's constants are the ONE spelling; the revision cannot import
    them (no revision imports ``app`` at module scope) or interpolate them (the
    classifier refuses an f-string), so they are pinned equal here instead - and
    the owned-note index carries ``NOTE_TRIM_SQL`` verbatim, backslash escapes
    included (a Python ``"\\t"`` would hand PostgreSQL a literal tab). Verbatim
    includes the literal's ``\\v``, which PostgreSQL 16 reads as the letter ``v``
    (18.6 reads a vertical tab): the quirk the CHECK and the open-follow-up guard
    already have, and a known server-version-dependent mismatch with
    ``NOTE_TRIM_CHARS`` (see its comment)."""
    sql = {
        kind_sql
        for kind, kind_sql in _events("upgrade")
        if kind == "execute" and kind_sql is not None
    }
    assert _CREATE_PAIR in sql
    assert _CREATE_OWNED in sql
    assert NOTE_TRIM_SQL in _squash(_CREATE_OWNED)
    assert r"E' \t\n\r\f\v'" in _CREATE_OWNED


def test_only_the_validity_probe_reads_through_the_connection() -> None:
    """The classifier rejects ``.execute`` on any receiver but ``op`` FILE-WIDE,
    ``downgrade()`` included, so this revision keeps exactly one - the probe -
    and the downgrade's refusal is a ``DO`` block rather than a second one."""
    tree = ast.parse(_revision_source(), filename=_REVISION_FILENAME)
    foreign: list[str] = []
    for fn in (n for n in tree.body if isinstance(n, ast.FunctionDef)):
        for node in ast.walk(fn):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr
                in {"execute", "exec_driver_sql", "scalar", "scalars"}
                and not _is_op_execute(node)
            ):
                foreign.append(fn.name)
    assert set(foreign) == {"_index_valid"}, foreign


def test_the_downgrade_refusal_is_one_do_block_and_is_lexically_separate() -> None:
    calls = upgrade_execute_calls(_revision_path(), function="downgrade")
    assert all(call.sql is not None for call in calls), calls
    first, *rest = calls
    assert first.sql is not None
    assert first.sql.lstrip().startswith("DO $$")
    assert "RAISE EXCEPTION" in first.sql
    assert "HAVING count(*) > 1" in first.sql
    assert "CONCURRENTLY" not in first.sql and not first.in_autocommit_block
    # Everything after the refusal builds or drops concurrently, in the block.
    assert rest and all(c.in_autocommit_block for c in rest), rest
    # The refusal's SQL is not part of the upgrade path.
    assert not any(
        "RAISE EXCEPTION" in (call.sql or "")
        for call in upgrade_execute_calls(_revision_path())
    )


# ───────────────────────────── database ─────────────────────────────


def _postgres() -> str:
    """The admin URL of a reachable test Postgres, or a LOUD failure. A skip
    here would let the whole module pass without checking anything."""
    url = admin_database_url()
    assert can_connect(url), (
        "Postgres is not reachable at the conftest URL, so the plan_library_12 "
        "migration tests cannot run (and a skipped migration test proves "
        "nothing). Set QONTINUI_TEST_PG / QONTINUI_TEST_PG_DSN."
    )
    return url


@pytest.fixture(scope="module")
def head_engine() -> Iterator[Engine]:
    """One database upgraded to ``head`` - not to this revision - for every
    test that only reads the schema or rolls its writes back."""
    with ephemeral_database(_postgres(), "planlib_followup_identity") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", "head")
        yield engine


@pytest.fixture()
def conn(head_engine: Engine) -> Iterator[Connection]:
    """A connection inside a transaction that is ALWAYS rolled back."""
    with head_engine.connect() as connection:
        outer = connection.begin()
        try:
            yield connection
        finally:
            outer.rollback()


def _index(engine: Engine, name: str) -> tuple[str, bool] | None:
    """``(pg_get_indexdef, indisvalid)`` of ``agent.<name>``, or None."""
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT pg_get_indexdef(i.indexrelid), i.indisvalid "
                "FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'agent' AND c.relname = :name"
            ),
            {"name": name},
        ).first()
    return (str(row[0]), bool(row[1])) if row is not None else None


def _index_oid(engine: Engine, name: str) -> int:
    with engine.connect() as connection:
        return int(
            connection.execute(
                text("SELECT to_regclass(:n)::oid"), {"n": f"agent.{name}"}
            ).scalar_one()
        )


def _tail(definition: str) -> str:
    """``pg_get_indexdef`` from ``USING`` on: the name and table are the only
    parts that differ between a migrated index and its probe."""
    return definition.split(" USING ", 1)[1]


def _artifact(connection: Connection, stem: str) -> str:
    artifact_id = str(uuid4())
    connection.execute(
        text(
            "INSERT INTO agent.work_artifacts (id, kind, slug, content_sha256) "
            "VALUES (:id, 'plan', :slug, 'sha')"
        ),
        {"id": artifact_id, "slug": f"{stem}-{artifact_id[:8]}"},
    )
    return artifact_id


def _edge(
    connection: Connection,
    *,
    source: str,
    owner: str | None,
    relation: str,
    note: str | None,
) -> str:
    edge_id = str(uuid4())
    connection.execute(
        text(
            "INSERT INTO agent.work_artifact_edges "
            "(id, from_id, to_id, relation, note) "
            "VALUES (:id, :source, :owner, :relation, :note)"
        ),
        {
            "id": edge_id,
            "source": source,
            "owner": owner,
            "relation": relation,
            "note": note,
        },
    )
    return edge_id


def _refused_by(connection: Connection, index: str, **edge: object) -> None:
    """The edge insert must be refused, by ``index`` and no other guard. Inside
    a savepoint so the surrounding transaction survives the refusal."""
    with pytest.raises(IntegrityError) as excinfo:
        with connection.begin_nested():
            _edge(connection, **edge)  # type: ignore[arg-type]
    assert f'"{index}"' in str(excinfo.value), (index, str(excinfo.value))


def test_the_new_indexes_exist_valid_and_the_old_one_is_gone(
    head_engine: Engine,
) -> None:
    pair = _index(head_engine, _PAIR_INDEX)
    owned = _index(head_engine, _OWNED_INDEX)
    assert pair is not None and pair[1], pair
    assert owned is not None and owned[1], owned
    assert pair[0].startswith(f"CREATE UNIQUE INDEX {_PAIR_INDEX} ON"), pair
    assert owned[0].startswith(f"CREATE UNIQUE INDEX {_OWNED_INDEX} ON"), owned
    assert "(from_id, to_id, relation) WHERE" in pair[0]
    assert "(relation <> 'spawned_followup'::text)" in pair[0]
    assert "(from_id, to_id, relation, btrim(note," in owned[0]
    assert "to_id IS NOT NULL" in owned[0] and "spawned_followup" in owned[0]
    assert _index(head_engine, _OLD_INDEX) is None
    # The open-follow-up guard is untouched and still partial on the unowned rows.
    open_guard = _index(head_engine, _OPEN_INDEX)
    assert open_guard is not None and open_guard[1]
    assert "to_id IS NULL" in open_guard[0]


def test_model_and_migration_declare_the_same_guards(head_engine: Engine) -> None:
    """Each guard in the MODEL, compiled by SQLAlchemy, built on a probe table
    and read back by ``pg_get_indexdef``, equals the migrated index."""
    modelled: dict[str, str] = {}
    with head_engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TEMP TABLE probe_edges "
                "(LIKE agent.work_artifact_edges INCLUDING DEFAULTS) ON COMMIT DROP"
            )
        )
        by_name = {index.name: index for index in WorkArtifactEdge.__table__.indexes}
        assert set(_GUARDS) <= set(by_name), sorted(by_name)
        for name in _GUARDS:
            ddl = str(CreateIndex(by_name[name]).compile(dialect=postgresql.dialect()))
            assert "agent.work_artifact_edges" in ddl and name in ddl, ddl
            ddl = ddl.replace("agent.work_artifact_edges", "probe_edges").replace(
                name, f"probe_{name}"
            )
            connection.execute(text(ddl))
            modelled[name] = connection.execute(
                text("SELECT pg_get_indexdef(to_regclass(:n))"),
                {"n": f"probe_{name}"},
            ).scalar_one()
    for name in _GUARDS:
        migrated = _index(head_engine, name)
        assert migrated is not None, name
        assert _tail(migrated[0]) == _tail(modelled[name]), name


def test_the_model_no_longer_declares_the_old_full_pair_index() -> None:
    names = {index.name for index in WorkArtifactEdge.__table__.indexes}
    assert _OLD_INDEX not in names
    assert {_PAIR_INDEX, _OWNED_INDEX, _OPEN_INDEX} <= names


def test_two_owned_followups_with_the_same_pair_and_different_notes_insert(
    conn: Connection,
) -> None:
    """The capability: one plan may own many of a source's follow-ups."""
    source, owner = _artifact(conn, "src"), _artifact(conn, "own")
    for note in ("first finding", "second finding", "third finding"):
        _edge(
            conn,
            source=source,
            owner=owner,
            relation=SPAWNED_FOLLOWUP_RELATION,
            note=note,
        )
    count = conn.execute(
        text(
            "SELECT count(*) FROM agent.work_artifact_edges "
            "WHERE from_id = :s AND to_id = :o"
        ),
        {"s": source, "o": owner},
    ).scalar_one()
    assert count == 3


def test_the_same_note_twice_under_one_owner_is_refused(conn: Connection) -> None:
    source, owner = _artifact(conn, "src"), _artifact(conn, "own")
    other_owner, other_source = _artifact(conn, "own2"), _artifact(conn, "src2")
    follow = SPAWNED_FOLLOWUP_RELATION
    _edge(conn, source=source, owner=owner, relation=follow, note="one finding")

    # The same finding padded with space, tab or newline: the guard trims with
    # the SAME SQL literal as the CHECK and the open-follow-up guard. On
    # PostgreSQL 16 that literal's \v is the letter v, so a vertical tab is NOT
    # among the characters it trims (see NOTE_TRIM_CHARS); none is used here.
    for note in ("one finding", "  one finding  ", "\tone finding\n"):
        _refused_by(
            conn,
            _OWNED_INDEX,
            source=source,
            owner=owner,
            relation=follow,
            note=note,
        )

    # Identity is (source, owner, note): another owner, another source, or an
    # OPEN copy of the same words are different rows.
    _edge(conn, source=source, owner=other_owner, relation=follow, note="one finding")
    _edge(conn, source=other_source, owner=owner, relation=follow, note="one finding")
    _edge(conn, source=source, owner=None, relation=follow, note="one finding")


def test_the_open_guard_still_refuses_the_same_unowned_note_twice(
    conn: Connection,
) -> None:
    source = _artifact(conn, "src")
    follow = SPAWNED_FOLLOWUP_RELATION
    _edge(conn, source=source, owner=None, relation=follow, note="an open finding")
    _refused_by(
        conn,
        _OPEN_INDEX,
        source=source,
        owner=None,
        relation=follow,
        note=" an open finding ",
    )


@pytest.mark.parametrize("relation", _PAIR_UNIQUE_RELATIONS)
def test_a_duplicate_triple_is_refused_for_every_other_relation(
    conn: Connection, relation: str
) -> None:
    """The narrowed index keeps the database-level uniqueness every relation
    but the follow-up had - one at a time, so a failure names the relation."""
    source, peer = _artifact(conn, "src"), _artifact(conn, "peer")
    _edge(conn, source=source, owner=peer, relation=relation, note=None)
    _refused_by(
        conn, _PAIR_INDEX, source=source, owner=peer, relation=relation, note=None
    )
    # A different peer is a different edge.
    _edge(
        conn,
        source=source,
        owner=_artifact(conn, "peer2"),
        relation=relation,
        note=None,
    )


def test_the_relations_under_test_are_the_models_vocabulary() -> None:
    assert SPAWNED_FOLLOWUP_RELATION in WORK_ARTIFACT_RELATIONS
    assert set(_PAIR_UNIQUE_RELATIONS) == set(WORK_ARTIFACT_RELATIONS) - {
        SPAWNED_FOLLOWUP_RELATION
    }
    assert len(_PAIR_UNIQUE_RELATIONS) == len(WORK_ARTIFACT_RELATIONS) - 1


def test_no_unique_index_keys_a_followup_by_its_pair_at_head(
    head_engine: Engine, conn: Connection
) -> None:
    """THE RATCHET, at ``head``. No unique index over exactly ``(from_id,
    to_id, relation)`` may admit an OWNED follow-up, and two owned follow-ups
    that share a pair must still insert. A later revision that restores the
    pair index for every row - the open edge-correction PR drops and rebuilds
    it under the OLD name - fails this in its own PR."""
    pair_keyed = conn.execute(
        text(
            """
            SELECT c.relname AS name, pg_get_expr(i.indpred, i.indrelid) AS predicate
              FROM pg_index i
              JOIN pg_class c ON c.oid = i.indexrelid
             WHERE i.indrelid = to_regclass('agent.work_artifact_edges')
               AND i.indisunique
               AND i.indnkeyatts = 3
               AND ARRAY(
                     SELECT a.attname::text
                       FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                       JOIN pg_attribute a
                         ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                      WHERE k.ord <= i.indnkeyatts
                      ORDER BY k.ord
                   ) = ARRAY['from_id', 'to_id', 'relation']
            """
        )
    ).all()
    # The narrowed index is the one such index; the check below is only as
    # strong as the query that finds it.
    assert [name for name, _ in pair_keyed] == [_PAIR_INDEX], pair_keyed

    conn.execute(
        text(
            "CREATE TEMP TABLE probe_owned "
            "(LIKE agent.work_artifact_edges INCLUDING DEFAULTS) ON COMMIT DROP"
        )
    )
    conn.execute(
        text(
            "INSERT INTO probe_owned (id, from_id, to_id, relation, note) VALUES "
            "(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), "
            "'spawned_followup', 'an owned finding')"
        )
    )
    for name, predicate in pair_keyed:
        assert predicate is not None, f"{name} is unconditional: it covers follow-ups"
        admits = conn.execute(
            text(f"SELECT EXISTS (SELECT 1 FROM probe_owned WHERE {predicate})")
        ).scalar_one()
        assert not admits, f"{name} ({predicate}) admits an owned follow-up"

    source, owner = _artifact(conn, "src"), _artifact(conn, "own")
    for note in ("a", "b"):
        _edge(
            conn,
            source=source,
            owner=owner,
            relation=SPAWNED_FOLLOWUP_RELATION,
            note=note,
        )


# ── lifecycle: existing data, the round trip, the refusing downgrade ──


def _seed(engine: Engine) -> dict[str, str]:
    """Written at the PARENT revision, where the old full index is still in
    force: one OWNED follow-up, one OPEN follow-up and one edge of every other
    relation. They prove the upgrade cannot fail on existing data."""
    ids: dict[str, str] = {}
    with engine.begin() as connection:
        source = ids["source"] = _artifact(connection, "src")
        owner = ids["owner"] = _artifact(connection, "own")
        peer = ids["peer"] = _artifact(connection, "peer")
        ids["owned"] = _edge(
            connection,
            source=source,
            owner=owner,
            relation=SPAWNED_FOLLOWUP_RELATION,
            note="an owned finding",
        )
        ids["open"] = _edge(
            connection,
            source=source,
            owner=None,
            relation=SPAWNED_FOLLOWUP_RELATION,
            note="an open finding",
        )
        for relation in _PAIR_UNIQUE_RELATIONS:
            ids[relation] = _edge(
                connection, source=source, owner=peer, relation=relation, note=None
            )
    return ids


def _edge_count(engine: Engine, ids: dict[str, str]) -> int:
    edge_ids = [v for k, v in ids.items() if k not in {"source", "owner", "peer"}]
    with engine.connect() as connection:
        return int(
            connection.execute(
                text(
                    "SELECT count(*) FROM agent.work_artifact_edges "
                    "WHERE id = ANY(CAST(:ids AS uuid[]))"
                ),
                {"ids": edge_ids},
            ).scalar_one()
        )


def test_seeded_upgrade_and_round_trip() -> None:
    root = backend_root()
    parent = _parent_revision_id()
    with ephemeral_database(_postgres(), "planlib_followup_identity_rt") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", parent)
        old = _index(engine, _OLD_INDEX)
        assert old is not None and old[1] and " WHERE " not in old[0], old
        assert _index(engine, _PAIR_INDEX) is None
        assert _index(engine, _OWNED_INDEX) is None
        ids = _seed(engine)
        seeded = _edge_count(engine, ids)
        assert seeded == 2 + len(_PAIR_UNIQUE_RELATIONS)

        # At the parent the old index refuses the second owned follow-up: the
        # defect this revision removes, shown before it is removed.
        with pytest.raises(IntegrityError) as before:
            with engine.begin() as connection:
                _edge(
                    connection,
                    source=ids["source"],
                    owner=ids["owner"],
                    relation=SPAWNED_FOLLOWUP_RELATION,
                    note="a second owned finding",
                )
        assert f'"{_OLD_INDEX}"' in str(before.value), str(before.value)

        run_alembic(root, url, "upgrade", _REVISION_ID)

        # ── shape: both new indexes VALID, the old one gone, no row lost ──
        for name in (_PAIR_INDEX, _OWNED_INDEX):
            built = _index(engine, name)
            assert built is not None and built[1], name
        assert _index(engine, _OLD_INDEX) is None
        assert _edge_count(engine, ids) == seeded

        # ── the capability, on the database that held the old index ──
        with engine.connect() as connection:
            outer = connection.begin()
            _edge(
                connection,
                source=ids["source"],
                owner=ids["owner"],
                relation=SPAWNED_FOLLOWUP_RELATION,
                note="a second owned finding",
            )
            _refused_by(
                connection,
                _OWNED_INDEX,
                source=ids["source"],
                owner=ids["owner"],
                relation=SPAWNED_FOLLOWUP_RELATION,
                note="an owned finding",
            )
            outer.rollback()

        # ── reversal, by NAME (never ``-1``) ──
        run_alembic(root, url, "downgrade", parent)
        restored = _index(engine, _OLD_INDEX)
        assert restored is not None and restored[1], restored
        assert "UNIQUE" in restored[0] and "(from_id, to_id, relation)" in restored[0]
        assert " WHERE " not in restored[0], restored
        assert _index(engine, _PAIR_INDEX) is None
        assert _index(engine, _OWNED_INDEX) is None
        assert _edge_count(engine, ids) == seeded
        with engine.connect() as connection:
            version = connection.execute(
                text("SELECT version_num FROM public.alembic_version")
            ).scalar_one()
        assert version == parent

        # ── and back up ──
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for name in (_PAIR_INDEX, _OWNED_INDEX):
            built = _index(engine, name)
            assert built is not None and built[1], name
        assert _index(engine, _OLD_INDEX) is None
        assert _edge_count(engine, ids) == seeded


def test_the_downgrade_refuses_while_two_owned_followups_share_a_pair() -> None:
    root = backend_root()
    parent = _parent_revision_id()
    with ephemeral_database(_postgres(), "planlib_followup_identity_dg") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _REVISION_ID)
        with engine.begin() as connection:
            owner = _artifact(connection, "own")
            sources = [_artifact(connection, "src"), _artifact(connection, "src2")]
            doomed: list[str] = []
            for source in sources:
                for note in ("first", "second"):
                    doomed.append(
                        _edge(
                            connection,
                            source=source,
                            owner=owner,
                            relation=SPAWNED_FOLLOWUP_RELATION,
                            note=note,
                        )
                    )

        proc = run_alembic(root, url, "downgrade", parent, expect_success=False)
        # The refusal NAMES the count (two source/owner pairs share rows) and
        # the query that finds them - it does not guess, delete or re-point.
        assert (
            "cannot restore uq_work_artifact_edges_from_to_relation: 2 "
            "(from_id, to_id, relation) group(s)" in proc.stderr
        ), proc.stderr
        assert "HAVING count(*) > 1" in proc.stderr, proc.stderr

        # ...and it changed nothing: still at this revision, the new indexes in
        # place and valid, the old one not rebuilt, every row where it was.
        with engine.connect() as connection:
            version = connection.execute(
                text("SELECT version_num FROM public.alembic_version")
            ).scalar_one()
            owned_rows = connection.execute(
                text(
                    "SELECT count(*) FROM agent.work_artifact_edges "
                    "WHERE id = ANY(CAST(:ids AS uuid[])) AND to_id = :owner"
                ),
                {"ids": doomed, "owner": owner},
            ).scalar_one()
        assert version == _REVISION_ID
        assert owned_rows == len(doomed)
        for name in (_PAIR_INDEX, _OWNED_INDEX):
            built = _index(engine, name)
            assert built is not None and built[1], name
        assert _index(engine, _OLD_INDEX) is None

        # With one row of each pair gone it succeeds: the guard counts, it does
        # not forbid the downgrade outright.
        with engine.begin() as connection:
            connection.execute(
                text(
                    "DELETE FROM agent.work_artifact_edges "
                    "WHERE id = ANY(CAST(:ids AS uuid[]))"
                ),
                {"ids": [doomed[1], doomed[3]]},
            )
        run_alembic(root, url, "downgrade", parent)
        restored = _index(engine, _OLD_INDEX)
        assert restored is not None and restored[1], restored
        assert _index(engine, _PAIR_INDEX) is None
        assert _index(engine, _OWNED_INDEX) is None


# ── a failed CONCURRENTLY build is neither skipped nor trusted ──


def _autocommit(engine: Engine) -> Connection:
    return engine.connect().execution_options(isolation_level="AUTOCOMMIT")


def _build_owned_index_then_mark_it_invalid(engine: Engine) -> None:
    """What a killed ``CREATE INDEX CONCURRENTLY`` leaves behind: the index,
    present and INVALID. Built from the revision's OWN statement."""
    (build,) = [
        sql
        for kind, sql in _events("upgrade")
        if kind == "execute"
        and sql is not None
        and sql.startswith("CREATE UNIQUE")
        and _OWNED_INDEX in sql
    ]
    with _autocommit(engine) as connection:
        is_superuser = connection.execute(
            text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
        ).scalar_one()
        assert is_superuser, (
            "marking an index INVALID updates pg_index, which takes a superuser "
            "(CI's database role is one); a skip here would prove nothing"
        )
        connection.execute(text(build))
        connection.execute(
            text(
                "UPDATE pg_index SET indisvalid = false "
                "WHERE indexrelid = to_regclass(:n)"
            ),
            {"n": f"agent.{_OWNED_INDEX}"},
        )
    state = _index(engine, _OWNED_INDEX)
    assert state is not None and not state[1], state


def _run_upgrade(engine: Engine, module) -> None:  # noqa: ANN001
    """Run ``module.upgrade()`` as alembic would: a connection that is not in a
    transaction (``autocommit_block`` commits and swaps the isolation level)."""
    with engine.connect() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()


def test_a_leftover_invalid_index_is_rebuilt_not_trusted() -> None:
    root = backend_root()
    parent = _parent_revision_id()
    with ephemeral_database(_postgres(), "planlib_followup_identity_iv") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", parent)
        _build_owned_index_then_mark_it_invalid(engine)
        leftover_oid = _index_oid(engine, _OWNED_INDEX)

        run_alembic(root, url, "upgrade", _REVISION_ID)

        rebuilt = _index(engine, _OWNED_INDEX)
        assert rebuilt is not None and rebuilt[1], "the leftover was trusted"
        assert _index_oid(engine, _OWNED_INDEX) != leftover_oid, "not rebuilt"
        pair = _index(engine, _PAIR_INDEX)
        assert pair is not None and pair[1], pair
        assert _index(engine, _OLD_INDEX) is None

        # A re-run after a COMPLETE upgrade is a no-op: valid indexes are left
        # alone (same objects), not dropped and rebuilt.
        oids = (_index_oid(engine, _PAIR_INDEX), _index_oid(engine, _OWNED_INDEX))
        run_alembic(root, url, "stamp", parent)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert (
            _index_oid(engine, _PAIR_INDEX),
            _index_oid(engine, _OWNED_INDEX),
        ) == oids


def test_the_validity_assertion_stops_the_drop_of_the_old_index(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With the leftover forced to SURVIVE (``IF NOT EXISTS`` skips it), the
    upgrade refuses before the destructive step and the old guard is intact."""
    root = backend_root()
    parent = _parent_revision_id()
    with ephemeral_database(_postgres(), "planlib_followup_identity_as") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", parent)
        _build_owned_index_then_mark_it_invalid(engine)

        module = load_revision_module(_revision_path(), "plan_library_12_assertion")
        monkeypatch.setattr(module, "_invalid_leftovers", lambda: ())
        with pytest.raises(RuntimeError) as refused:
            _run_upgrade(engine, module)

        message = str(refused.value)
        assert f"agent.{_OWNED_INDEX} is INVALID" in message, message
        assert f"DROP INDEX CONCURRENTLY agent.{_OWNED_INDEX}" in message, message
        assert "NOT been dropped" in message, message
        # The destructive step never ran: every relation is still guarded.
        old = _index(engine, _OLD_INDEX)
        assert old is not None and old[1] and " WHERE " not in old[0], old
        # The other build ran and is valid; the leftover was left as found.
        pair = _index(engine, _PAIR_INDEX)
        assert pair is not None and pair[1], pair
        leftover = _index(engine, _OWNED_INDEX)
        assert leftover is not None and not leftover[1], leftover

        # The documented recovery works: drop it, re-run the revision.
        with _autocommit(engine) as connection:
            connection.execute(text(f"DROP INDEX CONCURRENTLY agent.{_OWNED_INDEX}"))
        recovered = load_revision_module(
            _revision_path(), "plan_library_12_assertion_recovery"
        )
        _run_upgrade(engine, recovered)
        owned = _index(engine, _OWNED_INDEX)
        assert owned is not None and owned[1], owned
        assert _index(engine, _OLD_INDEX) is None
