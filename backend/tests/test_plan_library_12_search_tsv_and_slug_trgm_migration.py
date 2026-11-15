"""Round-trip, shape and plan test for ``plan_library_12_search_tsv_and_slug_trgm``.

Phase 1 of ``2026-11-09-plan-library-full-text-search-seq-scans-past-its-read-timeout``.
``GET /plan-library?q=`` took 20-32 s on prod because no plan used the old
expression index and every plan that left it re-parsed every body. The revision
stores the vector and gives each ``q`` arm its own GIN index. What is worth
pinning:

* the generated column's expression is ``SEARCH_TSVECTOR_SQL`` (the migration
  copies it verbatim; the model declares the column with the constant);
* the predicate :func:`app.crud.work_artifact._search_predicate` BUILDS — not a
  hand-written string — is served by ``ix_work_artifacts_search_tsv`` for the
  full-text arm and by ``ix_work_artifacts_slug_trgm`` for the slug arm, read
  back out of ``EXPLAIN`` with ``enable_seqscan`` off (the pattern of
  ``test_session_artifacts_model.py``'s
  ``test_the_search_index_is_actually_used_by_the_constant_predicate``). If
  either arm stops naming its index this fails;
* the stored vector follows the row through an ORM insert and a body update,
  and the ORM never names it: the column is on the Table but excluded from
  the mapper, so no INSERT, UPDATE, ``RETURNING`` or SELECT the ORM emits
  carries it (``deferred=True`` alone still let ``eager_defaults`` put it in
  ``INSERT … RETURNING``), while ``create_all`` still builds it, nullable as
  the migration's is;
* the old expression index is dropped INSIDE the transaction before the
  rewrite (so the rewrite does not rebuild it under ACCESS EXCLUSIVE), and a
  re-run over an INVALID index a failed concurrent build left behind fails
  loudly instead of stamping the revision;
* the round trip removes and restores the column and both indexes, and the
  downgrade puts the old expression index back.

Substrate is ``tests/_alembic_harness``. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG`` / ``QONTINUI_TEST_PG_DSN``.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterator

import pytest
from sqlalchemy import event, inspect, select, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.crud.work_artifact import _search_predicate
from app.models.work_artifact import SEARCH_TSVECTOR_SQL, WorkArtifact
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
    upgrade_execute_calls,
)

_REVISION_ID = "plan_library_12_search_tsv_and_slug_trgm"
_REVISION_FILENAME = "plan_library_12_search_tsv_and_slug_trgm.py"
_TSV_INDEX = "ix_work_artifacts_search_tsv"
_TRGM_INDEX = "ix_work_artifacts_slug_trgm"
_OLD_INDEX = "ix_work_artifacts_search"


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def _parent_revision_id() -> str:
    """The revision's declared ``down_revision``, read from the file itself.

    Never a pinned literal: coord re-points ``down_revision`` at land time when
    another revision lands first, and a pinned copy here would then send the
    round trip and the re-run test to the wrong revision.
    """
    parent = declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
    assert isinstance(parent, str) and parent, "down_revision must be one revision id"
    return parent


def _normalized_sql(sql: str) -> str:
    """Collapse whitespace (and the padding inside parentheses) for comparison.

    Never touches the space inside the ``' '`` separator literal.
    """
    collapsed = re.sub(r"\s+", " ", sql).strip()
    return re.sub(r"\(\s+", "(", re.sub(r"\s+\)", ")", collapsed))


def _compiled(q: str) -> str:
    """The SQL of a select filtered by the crud's own predicate, binds inlined."""
    stmt = select(WorkArtifact.id).where(_search_predicate(q))
    return str(
        stmt.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_down_revision_names_an_existing_revision() -> None:
    parent = _parent_revision_id()
    versions = backend_root() / "alembic" / "versions"
    assert any(
        re.search(
            rf"^revision(?::\s*str)?\s*=\s*['\"]{re.escape(parent)}['\"]",
            f.read_text(encoding="utf-8"),
            re.M,
        )
        for f in versions.glob("*.py")
        if f.name != _REVISION_FILENAME
    ), f"down_revision {parent!r} names no revision in alembic/versions"


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


def test_the_generated_column_and_the_restored_index_spell_the_constant() -> None:
    """The migration copies ``SEARCH_TSVECTOR_SQL``; a drift is silent otherwise.

    Twice: the upgrade's ``GENERATED ALWAYS AS (…)`` and the downgrade's
    recreated expression index.
    """
    source = _normalized_sql(_revision_source())
    constant = _normalized_sql(SEARCH_TSVECTOR_SQL)
    assert f"GENERATED ALWAYS AS ({constant}) STORED" in source
    assert f"USING gin ({constant})" in source


def test_the_ddl_is_idempotent_and_concurrent() -> None:
    # The code only: the module docstring quotes some of these statements.
    source = _revision_source().partition("\nrevision: str =")[2]
    # Two builds in upgrade(), the old index's rebuild in downgrade().
    assert source.count("CREATE INDEX CONCURRENTLY IF NOT EXISTS") == 3
    # Only downgrade() drops concurrently; upgrade() drops the old index
    # inside the transaction (next test).
    assert source.count("DROP INDEX CONCURRENTLY IF EXISTS") == 2
    assert "CREATE EXTENSION IF NOT EXISTS pg_trgm" in source
    assert "ADD COLUMN IF NOT EXISTS search_tsv tsvector" in source
    assert "DROP COLUMN IF EXISTS search_tsv" in source


def _upgrade_calls() -> list[tuple[str, bool]]:
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    calls = upgrade_execute_calls(path)
    assert all(c.sql is not None for c in calls), "every op.execute is one literal"
    return [(_normalized_sql(c.sql or ""), c.in_autocommit_block) for c in calls]


def test_the_old_index_is_dropped_in_the_transaction_before_the_rewrite() -> None:
    """The rewrite rebuilds every index still on the table, under ACCESS EXCLUSIVE.

    So the old expression index must be gone before the ``ALTER``, dropped in
    the same transaction (after the lock bound), not ``CONCURRENTLY`` after it.
    """
    calls = _upgrade_calls()
    statements = [sql for sql, _ in calls]
    drop = statements.index("DROP INDEX IF EXISTS agent.ix_work_artifacts_search")
    lock = statements.index("SET LOCAL lock_timeout = '5s'")
    alter = next(i for i, sql in enumerate(statements) if sql.startswith("ALTER TABLE"))
    assert lock < drop < alter, statements
    assert not calls[drop][1], "the drop must run in the migration transaction"
    assert not calls[alter][1]
    assert not any(
        "ix_work_artifacts_search " in sql or sql.endswith("ix_work_artifacts_search")
        for sql in statements[alter:]
    ), "nothing after the rewrite touches the old index"


def test_an_invalid_index_guard_follows_the_concurrent_builds() -> None:
    calls = _upgrade_calls()
    builds = [
        i for i, (sql, _) in enumerate(calls) if "CREATE INDEX CONCURRENTLY" in sql
    ]
    assert len(builds) == 2
    guard_sql, guard_in_block = calls[-1]
    assert guard_in_block
    assert builds[-1] < len(calls) - 1
    assert guard_sql.startswith("DO $$")
    assert "NOT i.indisvalid" in guard_sql
    assert "n.nspname = 'agent'" in guard_sql
    for name in (_TSV_INDEX, _TRGM_INDEX):
        assert f"'{name}'" in guard_sql
    assert "RAISE EXCEPTION" in guard_sql
    # The advice, split across two literals for the schema-arg gate.
    assert "run DROP ' 'INDEX CONCURRENTLY %" in guard_sql


def test_the_column_is_on_the_table_but_not_on_the_mapper() -> None:
    column = WorkArtifact.__table__.c.search_tsv
    assert column.computed is not None
    assert str(column.computed.sqltext) == SEARCH_TSVECTOR_SQL
    assert column.computed.persisted is True
    # Nullable, matching the migration's ADD COLUMN (is_nullable = YES).
    assert column.nullable is True
    assert "search_tsv" not in inspect(WorkArtifact).attrs.keys()
    assert column not in inspect(WorkArtifact).columns.values()


def test_an_orm_insert_never_names_the_vector() -> None:
    """Neither the column list nor ``RETURNING`` of the ORM's INSERT names it.

    Compiled from the mapper's own insert, so no database is needed; the DB
    test below checks the statements actually emitted.
    """
    from sqlalchemy import insert

    sql = str(
        insert(WorkArtifact)
        .values(kind="plan", slug="s", content_sha256="x")
        .returning(*inspect(WorkArtifact).columns)
        .compile(dialect=postgresql.dialect())
    )
    assert "search_tsv" not in sql, sql


def test_the_model_declares_both_new_indexes_and_not_the_old_one() -> None:
    indexes = {i.name: i for i in WorkArtifact.__table__.indexes}
    assert _OLD_INDEX not in indexes

    tsv = indexes[_TSV_INDEX]
    assert tsv.dialect_options["postgresql"]["using"] == "gin"
    assert [c.name for c in tsv.columns] == ["search_tsv"]

    trgm = indexes[_TRGM_INDEX]
    assert trgm.dialect_options["postgresql"]["using"] == "gin"
    assert [c.name for c in trgm.columns] == ["slug"]
    assert trgm.dialect_options["postgresql"]["ops"] == {"slug": "gin_trgm_ops"}


def test_the_predicate_reads_the_stored_column_and_never_parses_a_body() -> None:
    sql = _compiled("postgres")
    assert "work_artifacts.search_tsv @@ plainto_tsquery('english'::regconfig" in sql
    assert "to_tsvector" not in sql
    assert "ILIKE" in sql

    full_text_only = _compiled("postgres/")
    assert "search_tsv @@" in full_text_only
    assert "ILIKE" not in full_text_only


# ---------------------------------------------------------------------------
# The database walk.
# ---------------------------------------------------------------------------

_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:<port> "
        "before running this test."
    ),
)


def _index(engine: Engine, name: str) -> tuple[str, bool] | None:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT pg_get_indexdef(i.indexrelid), i.indisvalid "
                "FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'agent' AND c.relname = :name"
            ),
            {"name": name},
        ).first()
    return (str(row[0]), bool(row[1])) if row is not None else None


def _search_tsv_generation(engine: Engine) -> str | None:
    """The column's generation expression as PostgreSQL stores it, or None."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT attgenerated, pg_get_expr(d.adbin, d.adrelid) "
                "FROM pg_attribute a "
                "LEFT JOIN pg_attrdef d "
                "  ON d.adrelid = a.attrelid AND d.adnum = a.attnum "
                "WHERE a.attrelid = 'agent.work_artifacts'::regclass "
                "  AND a.attname = 'search_tsv' AND NOT a.attisdropped"
            )
        ).first()
    if row is None:
        return None
    assert row[0] == "s", f"search_tsv is not a STORED generated column: {row[0]!r}"
    return str(row[1])


@_PG_SKIP
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_searchtsv") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        generation = _search_tsv_generation(engine)
        assert generation is not None and "to_tsvector" in generation, generation
        tsv = _index(engine, _TSV_INDEX)
        assert tsv is not None and tsv[1], tsv
        assert "USING gin (search_tsv)" in tsv[0], tsv[0]
        trgm = _index(engine, _TRGM_INDEX)
        assert trgm is not None and trgm[1], trgm
        assert re.search(r"USING gin \(slug (\w+\.)?gin_trgm_ops\)", trgm[0]), trgm[0]
        assert _index(engine, _OLD_INDEX) is None

        run_alembic(root, db_url, "downgrade", _parent_revision_id())
        assert _search_tsv_generation(engine) is None
        assert _index(engine, _TSV_INDEX) is None
        assert _index(engine, _TRGM_INDEX) is None
        old = _index(engine, _OLD_INDEX)
        assert old is not None and old[1], old
        assert "to_tsvector" in old[0], old[0]

        run_alembic(root, db_url, "upgrade", "head")
        assert _search_tsv_generation(engine) is not None
        assert _index(engine, _TSV_INDEX) is not None
        assert _index(engine, _TRGM_INDEX) is not None
        assert _index(engine, _OLD_INDEX) is None


@pytest.fixture(scope="module")
def head_engine() -> Iterator[Engine]:
    """One ephemeral database at alembic head, shared by the tests below."""
    if not can_connect(admin_database_url()):
        pytest.skip("Postgres not reachable at the conftest URL")
    with ephemeral_database(admin_database_url(), "planlib_searchtsv_head") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", "head")
        yield engine


def _artifact(slug: str, title: str, body: str) -> WorkArtifact:
    return WorkArtifact(
        organization_id=None,
        kind="plan",
        slug=slug,
        title=title,
        body=body,
        content_sha256=hashlib.sha256(body.encode()).hexdigest(),
        source_repo="qontinui-dev-notes/plans",
    )


def _explain(engine: Engine, q: str) -> str:
    """``EXPLAIN`` of the crud's own predicate, compiled by the live dialect.

    The live dialect, not a bare one: it knows ``standard_conforming_strings``
    is on, so the ``ESCAPE`` literal renders as the app sends it. The values
    travel as driver parameters, which psycopg2 inlines client-side, so the
    planner sees the constants a custom plan sees.
    """
    stmt = select(WorkArtifact.id).where(_search_predicate(q))
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL enable_seqscan = off"))
        compiled = stmt.compile(dialect=conn.dialect)
        rows = conn.exec_driver_sql(f"EXPLAIN {compiled}", compiled.params)
        return "\n".join(r[0] for r in rows)


@_PG_SKIP
def test_both_arms_of_the_built_predicate_are_index_served(
    head_engine: Engine,
) -> None:
    """The planner must name each arm's index for the predicate the crud builds."""
    with Session(head_engine) as session:
        session.add_all(
            _artifact(
                f"2026-11-{n % 28 + 1:02d}-widget-number-{n}",
                f"widget plan {n}",
                f"implement widget {n} with the alembic migration and tests",
            )
            for n in range(400)
        )
        session.add(
            _artifact(
                "2026-11-09-postgres-search-plan",
                "postgres search",
                "store the postgres vector",
            )
        )
        session.commit()
    with head_engine.begin() as conn:
        # The planner will not consider an index on a table it believes is tiny
        # and has never analysed.
        conn.execute(text("ANALYZE agent.work_artifacts"))

    # (a) full text only: a trailing ``/`` empties the slug needle, and a
    # 2-character word is below the needle's floor.
    for q in ("postgres/", "pg"):
        sql = _compiled(q)
        assert "ILIKE" not in sql, sql
        plan = _explain(head_engine, q)
        assert _TSV_INDEX in plan, plan

    # (b) both arms: a BitmapOr over the two GIN indexes.
    sql = _compiled("postgres")
    assert "ILIKE" in sql, sql
    plan = _explain(head_engine, "postgres")
    assert _TSV_INDEX in plan, plan
    assert _TRGM_INDEX in plan, plan
    assert "to_tsvector" not in plan, plan

    # And the predicate matches through the indexes, not just plans them.
    with head_engine.connect() as conn:
        slugs = {
            r[0]
            for r in conn.execute(
                select(WorkArtifact.slug).where(_search_predicate("postgres"))
            )
        }
    assert slugs == {"2026-11-09-postgres-search-plan"}


@_PG_SKIP
def test_a_rerun_over_an_invalid_index_fails_loudly() -> None:
    """A failed concurrent build leaves an INVALID index ``IF NOT EXISTS`` skips.

    The retry this guards: the ``ALTER`` committed (the autocommit block
    commits on entry), then a concurrent build failed, so alembic never stamped
    the revision. The re-run's ``ADD COLUMN IF NOT EXISTS`` is a no-op (no
    rewrite, so nothing reindexes the leftover) and ``CREATE INDEX … IF NOT
    EXISTS`` skips it. Reproduced as: head, mark one new index invalid, stamp
    back to the parent, upgrade again. The upgrade must refuse, naming the
    index, and leave the revision unstamped.

    ``indisvalid`` is flipped in the catalog because a real failed GIN build is
    hard to provoke deterministically; that needs a superuser, which the CI
    service role and the local throwaway containers are.
    """
    admin_url = admin_database_url()
    root = backend_root()
    with ephemeral_database(admin_url, "planlib_invalidguard") as (engine, db_url):
        with engine.connect() as conn:
            superuser = conn.execute(
                text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
            ).scalar()
        if not superuser:
            pytest.skip("marking an index invalid needs a superuser test role")

        run_alembic(root, db_url, "upgrade", "head")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE pg_index SET indisvalid = false "
                    f"WHERE indexrelid = 'agent.{_TRGM_INDEX}'::regclass"
                )
            )
        invalid = _index(engine, _TRGM_INDEX)
        assert invalid is not None and not invalid[1], invalid
        run_alembic(root, db_url, "stamp", _parent_revision_id())

        result = run_alembic(root, db_url, "upgrade", "head", expect_success=False)
        assert result.returncode != 0
        assert f"agent.{_TRGM_INDEX} exists but is INVALID" in result.stderr, (
            result.stderr[-2000:]
        )
        assert (
            f"run DROP INDEX CONCURRENTLY agent.{_TRGM_INDEX}, and re-run"
            in result.stderr
        ), result.stderr[-2000:]
        with engine.connect() as conn:
            version = conn.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar()
        assert version == _parent_revision_id()

        # The remedy the error names works.
        with engine.execution_options(isolation_level="AUTOCOMMIT").connect() as conn:
            conn.execute(text(f"DROP INDEX CONCURRENTLY agent.{_TRGM_INDEX}"))
        run_alembic(root, db_url, "upgrade", "head")
        rebuilt = _index(engine, _TRGM_INDEX)
        assert rebuilt is not None and rebuilt[1], rebuilt


@_PG_SKIP
def test_create_all_builds_the_column_nullable_and_both_indexes() -> None:
    """The conftest substrate is ``create_all``, not alembic — it must agree."""
    with ephemeral_database(admin_database_url(), "planlib_createall") as (
        engine,
        _db_url,
    ):
        with engine.begin() as conn:
            conn.execute(text("CREATE SCHEMA IF NOT EXISTS agent"))
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        WorkArtifact.__table__.create(engine)

        assert _search_tsv_generation(engine) is not None
        with engine.connect() as conn:
            nullable = conn.execute(
                text(
                    "SELECT is_nullable FROM information_schema.columns "
                    "WHERE table_schema = 'agent' AND table_name = "
                    "'work_artifacts' AND column_name = 'search_tsv'"
                )
            ).scalar()
        assert nullable == "YES"
        assert _index(engine, _TSV_INDEX) is not None
        assert _index(engine, _TRGM_INDEX) is not None


@_PG_SKIP
def test_the_stored_vector_follows_an_orm_insert_and_a_body_update(
    head_engine: Engine,
) -> None:
    emitted: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001, ARG001
        emitted.append(statement)

    event.listen(head_engine, "before_cursor_execute", record)

    def matches(q: str) -> set[str]:
        with head_engine.connect() as conn:
            return {
                r[0]
                for r in conn.execute(
                    select(WorkArtifact.slug).where(
                        WorkArtifact.slug.like("2026-11-09-tracking-%"),
                        _search_predicate(q),
                    )
                )
            }

    with Session(head_engine) as session:
        row = _artifact(
            "2026-11-09-tracking-row", "tracking row", "the body says aardvark"
        )
        session.add(row)
        session.commit()
        row_id = row.id

    assert matches("aardvark/") == {"2026-11-09-tracking-row"}
    assert matches("zeppelin/") == set()

    with Session(head_engine) as session:
        loaded = session.get(WorkArtifact, row_id)
        assert loaded is not None
        assert "search_tsv" not in inspect(loaded).dict
        loaded.body = "the body now says zeppelin"
        loaded.content_sha256 = hashlib.sha256(loaded.body.encode()).hexdigest()
        session.commit()
    event.remove(head_engine, "before_cursor_execute", record)

    # Every statement the ORM emitted — the INSERT (and its RETURNING), the
    # load, the UPDATE — leaves the vector alone. (The ``matches`` probes are
    # this test's own searches, which name it on purpose.)
    orm = [
        sql
        for sql in emitted
        if "plainto_tsquery" not in sql
        and re.match(r"\s*(INSERT|UPDATE|SELECT)\b", sql)
        and "work_artifacts" in sql
    ]
    assert any(sql.lstrip().startswith("INSERT") for sql in orm), emitted
    assert any(sql.lstrip().startswith("UPDATE") for sql in orm), emitted
    assert not [sql for sql in orm if "search_tsv" in sql], orm

    assert matches("zeppelin/") == {"2026-11-09-tracking-row"}
    assert matches("aardvark/") == set()
    # The title is in the vector too.
    assert matches("tracking/") == {"2026-11-09-tracking-row"}
