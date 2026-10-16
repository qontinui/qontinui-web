"""The production shape ``coordconv_01`` converges, and proof it is faithful.

Plan ``2026-10-15-coord-schema-is-authored-in-a-different-repo-than-coord``,
Phase 6 ("Before 6.1"), converges production's ``coord`` schema to this alembic
chain in one revision of ten steps, one object each (``coordconv_01``). Its
tests need a database in PRODUCTION'S shape, and CI has no production. This
module builds one: each ``seed_*`` function below turns a fresh database at
``image_assets_01`` into production's shape for one object, exactly as Phase 0
measured it (coord finding ``35ca1c85``; re-measured read-only 2026-10-15).

A fixture of this kind is itself unverified code: a seeder that builds the wrong
shape would make every convergence test pass for the wrong reason. So the test
here pins the seeders to the measurement. Applied to a fresh database, they must
change the catalog by EXACTLY the measured drift and by nothing else, and both
sides of that difference are spelled out below as literals, copied from the
production and chain catalog reads.

The other ``test_coordconv_*`` modules (one per step, and ``_11`` for the
revision as a whole) import the substrate from here: the seeders, the catalog
reader, template databases (one alembic build per module, then a ``CREATE
DATABASE ... TEMPLATE`` clone per scenario), and a way to run the revision's
steps in-process, which the retry tests use to fail it at a chosen step. Substrate
comes from ``_alembic_harness``; these tests skip when no test Postgres is
reachable, and a skip proves nothing: set ``QONTINUI_TEST_PG_DSN`` (or
``QONTINUI_TEST_PG``) to run them.
"""

from __future__ import annotations

import atexit
import contextlib
import dataclasses
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine, make_url

from alembic import op
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    load_revision_module,
    run_alembic,
)

#: The alembic revision production and the chain were compared at.
MEASURED_AT_REVISION = "image_assets_01"

#: The revision under test, and the parent it is pinned to. Re-point the parent
#: here together with the revision's ``down_revision``.
REVISION_ID = "coordconv_01"
PARENT_REVISION_ID = "coordrls_01"
REVISION_FILENAME = "coordconv_01_production_converges_to_the_chain.py"

# ---------------------------------------------------------------------------
# The measured drift, as ``kind<TAB>object<TAB>definition`` catalog lines
# (``catalog_lines`` below renders the same format, under search_path =
# pg_catalog, as the Phase 0 comparison did). Live-column ORDER is not here:
# the plan's D4 takes it out of the equality.
# ---------------------------------------------------------------------------

#: Lines production has and a fresh database at ``image_assets_01`` does not.
PRODUCTION_ONLY_LINES = frozenset(
    {
        "column\tcoord.devices.metadata\tjsonb|t|'{}'::jsonb|||",
        "column\tcoord.memories.memory_id\tuuid|t||||",
        "index\tcoord.idx_memories_name_version\t"
        "CREATE INDEX idx_memories_name_version ON coord.memories "
        "USING btree (name, version DESC)|t",
        "index\tcoord.idx_memories_type\t"
        "CREATE INDEX idx_memories_type ON coord.memories "
        "USING btree (type) WHERE (NOT is_tombstone)|t",
        "index\tcoord.idx_memories_written_at\t"
        "CREATE INDEX idx_memories_written_at ON coord.memories "
        "USING btree (written_at DESC)|t",
        "index\tcoord.idx_agent_questions_agent\t"
        "CREATE INDEX idx_agent_questions_agent ON coord.agent_questions "
        "USING btree (agent_id, created_at DESC)|t",
        "index\tcoord.idx_agent_questions_session\t"
        "CREATE INDEX idx_agent_questions_session ON coord.agent_questions "
        "USING btree (agent_session_id, created_at DESC) "
        "WHERE (agent_session_id IS NOT NULL)|t",
        "constraint\tcoord.primary_trees.primary_trees_tenant_id_fkey\t"
        "f|FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
        "ON DELETE SET NULL NOT VALID|f",
    }
)

#: Lines a fresh database at ``image_assets_01`` has and production does not.
CHAIN_ONLY_LINES = frozenset(
    {
        "constraint\tcoord.devices.devices_tenant_id_fkey\t"
        "f|FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
        "ON DELETE RESTRICT|t",
        "column\tcoord.memories.memory_id\tuuid|t|gen_random_uuid()|||",
        "index\tcoord.idx_agent_questions_session\t"
        "CREATE INDEX idx_agent_questions_session ON coord.agent_questions "
        "USING btree (agent_session_id) WHERE (agent_session_id IS NOT NULL)|t",
        "constraint\tcoord.primary_trees.primary_trees_tenant_id_fkey\t"
        "f|FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) "
        "ON DELETE SET NULL|t",
    }
)

# ---------------------------------------------------------------------------
# Catalog reader: one line per object, the Phase 0 query (lane 4's catalog.sql)
# without its column-order class.
# ---------------------------------------------------------------------------

_CATALOG = text(
    """
    WITH ns AS (
      SELECT oid, nspname FROM pg_namespace WHERE nspname = ANY(:schemas)
    ), rel AS (
      SELECT c.oid, n.nspname, c.relname, c.relkind, c.relpersistence, c.reloptions,
             c.relreplident, c.relrowsecurity, c.relforcerowsecurity, c.relacl,
             c.relispartition
      FROM pg_class c JOIN ns n ON n.oid = c.relnamespace
    )
    SELECT 'table', nspname||'.'||relname,
           concat_ws('|', relkind, relpersistence,
                     coalesce(array_to_string(reloptions, ','), ''), relreplident,
                     relrowsecurity, relforcerowsecurity, coalesce(relacl::text, ''),
                     relispartition, coalesce(pg_get_partkeydef(oid), ''))
    FROM rel WHERE relkind IN ('r', 'p')
    UNION ALL
    SELECT 'column', r.nspname||'.'||r.relname||'.'||a.attname,
           concat_ws('|', format_type(a.atttypid, a.atttypmod), a.attnotnull,
                     coalesce(pg_get_expr(d.adbin, d.adrelid), ''), a.attidentity,
                     a.attgenerated,
                     CASE WHEN a.attcollation <> t.typcollation
                          THEN coalesce(co.collname, '') ELSE '' END)
    FROM rel r JOIN pg_attribute a ON a.attrelid = r.oid
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_collation co ON co.oid = a.attcollation
    WHERE r.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'constraint', r.nspname||'.'||r.relname||'.'||cn.conname,
           concat_ws('|', cn.contype, pg_get_constraintdef(cn.oid), cn.convalidated)
    FROM rel r JOIN pg_constraint cn ON cn.conrelid = r.oid
    UNION ALL
    SELECT 'index', r.nspname||'.'||ic.relname,
           concat_ws('|', pg_get_indexdef(i.indexrelid), i.indisvalid)
    FROM rel r JOIN pg_index i ON i.indrelid = r.oid
    JOIN pg_class ic ON ic.oid = i.indexrelid
    UNION ALL
    SELECT 'view', nspname||'.'||relname, concat_ws('|', relkind, pg_get_viewdef(oid, true))
    FROM rel WHERE relkind IN ('v', 'm')
    UNION ALL
    SELECT 'sequence', r.nspname||'.'||r.relname,
           concat_ws('|', s.seqtypid::regtype::text, s.seqstart, s.seqincrement,
                     s.seqmax, s.seqmin, s.seqcache, s.seqcycle)
    FROM rel r JOIN pg_sequence s ON s.seqrelid = r.oid
    UNION ALL
    SELECT 'function', n.nspname||'.'||p.oid::regprocedure::text,
           md5(pg_get_functiondef(p.oid))
    FROM pg_proc p JOIN ns n ON n.oid = p.pronamespace
    UNION ALL
    SELECT 'trigger', r.nspname||'.'||r.relname||'.'||tg.tgname, pg_get_triggerdef(tg.oid)
    FROM rel r JOIN pg_trigger tg ON tg.tgrelid = r.oid WHERE NOT tg.tgisinternal
    UNION ALL
    SELECT 'policy', r.nspname||'.'||r.relname||'.'||po.polname,
           concat_ws('|', po.polcmd, po.polpermissive,
                     coalesce(pg_get_expr(po.polqual, po.polrelid), ''),
                     coalesce(pg_get_expr(po.polwithcheck, po.polrelid), ''),
                     po.polroles::text)
    FROM rel r JOIN pg_policy po ON po.polrelid = r.oid
    """
)


def catalog_lines(engine: Engine, schemas: tuple[str, ...] = ("coord",)) -> set[str]:
    """Every object of ``schemas`` as ``kind<TAB>object<TAB>definition``.

    Read under ``search_path = pg_catalog`` so every deparsed name is
    schema-qualified, as in the Phase 0 comparison.
    """
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL search_path TO pg_catalog"))
        rows = conn.execute(_CATALOG, {"schemas": list(schemas)}).fetchall()
    return {f"{kind}\t{key}\t{definition}" for kind, key, definition in rows}


# ---------------------------------------------------------------------------
# Databases: one alembic build per module, a template clone per scenario.
# ---------------------------------------------------------------------------


def admin_url_or_skip() -> str:
    """The test Postgres admin URL; skips the calling test when none is reachable."""
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def revision_path(filename: str = REVISION_FILENAME) -> Path:
    return backend_root() / "alembic" / "versions" / filename


def upgrade(url: str) -> None:
    run_alembic(backend_root(), url, "upgrade", REVISION_ID)


def upgrade_refused(url: str) -> str:
    """Run an upgrade that must FAIL; return its stderr for the reason."""
    return run_alembic(
        backend_root(), url, "upgrade", REVISION_ID, expect_success=False
    ).stderr


def downgrade(url: str) -> None:
    run_alembic(backend_root(), url, "downgrade", PARENT_REVISION_ID)


def downgrade_refused(url: str) -> str:
    """Run a downgrade that must FAIL; return its stderr for the reason."""
    return run_alembic(
        backend_root(), url, "downgrade", PARENT_REVISION_ID, expect_success=False
    ).stderr


def rerun(url: str) -> None:
    """Apply the revision a second time: stamp back to the parent, upgrade again."""
    run_alembic(backend_root(), url, "stamp", PARENT_REVISION_ID)
    run_alembic(backend_root(), url, "upgrade", REVISION_ID)


def revision_module(tag: str) -> ModuleType:
    """A fresh import of the revision file, safe to modify in one test."""
    return load_revision_module(
        revision_path(), f"coordconv_01_{tag}_{uuid.uuid4().hex[:8]}"
    )


@contextlib.contextmanager
def migration_operations(url: str) -> Iterator[None]:
    """``op`` bound to ``url`` as alembic binds it, for calling the revision directly."""
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                yield
    finally:
        engine.dispose()


def run_in_revision(url: str, call: Callable[[], None]) -> None:
    """Call one of the revision's functions in-process, in an autocommit block,
    as ``upgrade()`` and ``downgrade()`` call them."""
    with migration_operations(url), op.get_context().autocommit_block():
        call()


def run_step(url: str, number: int) -> None:
    """Run one step of the revision, alone, in its own autocommit block."""
    module = revision_module(f"step{number}")
    (step,) = (s for s in module.STEPS if s.number == number)
    run_in_revision(url, step.apply)


#: ``downgrade()``'s undos, in the order it runs them.
UNDO_ORDER = (
    "_undo_10_primary_trees_key_cascades",
    "_undo_09_primary_trees_orphans_and_validation",
    "_undo_08_idx_agent_questions_session",
    "_undo_07_idx_agent_questions_agent",
    "_undo_01_devices_metadata",
)


def downgrade_failing_at(url: str, undo: str) -> None:
    """Run the revision's ``downgrade()`` with ``undo`` failing as it starts.

    The undos before it run and commit; nothing touches ``alembic_version``,
    which stays at the revision, as after a downgrade that failed part-way.
    """
    module = revision_module(f"undo{undo[6:8]}")
    assert callable(vars(module)[undo]), undo

    def injected() -> None:
        raise RuntimeError(f"injected failure at {undo}")

    vars(module)[undo] = injected
    with (
        migration_operations(url),
        pytest.raises(RuntimeError, match=f"injected failure at {undo}"),
    ):
        module.downgrade()


def upgrade_failing_at(url: str, number: int) -> None:
    """Run the revision's ``upgrade()`` with step ``number`` failing as it starts.

    Steps before it run and commit, as they would ahead of a real failure (a
    lock timeout, a dropped connection). Nothing stamps ``alembic_version``, so
    the database is left exactly where a failed deploy leaves production.
    """
    module = revision_module(f"fail{number}")

    def injected() -> None:
        raise RuntimeError(f"injected failure at step {number}")

    vars(module)["STEPS"] = tuple(
        dataclasses.replace(s, apply=injected) if s.number == number else s
        for s in module.STEPS
    )
    with (
        migration_operations(url),
        pytest.raises(RuntimeError, match=f"injected failure at step {number}"),
    ):
        module.upgrade()


def object_lines(lines: set[str], *objects: str) -> set[str]:
    """The catalog lines of ``objects`` (a table's lines include its columns and
    constraints; an index is its own object)."""
    return {
        line
        for line in lines
        if any(
            line.split("\t")[1] == o or line.split("\t")[1].startswith(o + ".")
            for o in objects
        )
    }


def _drop_database(admin: Engine, name: str) -> None:
    with admin.connect() as conn:
        conn.execute(
            text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = :name AND pid <> pg_backend_pid()"
            ),
            {"name": name},
        )
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))


_TEMPLATES: dict[str, str] = {}


def _drop_quietly(admin_url: str, name: str) -> None:
    with contextlib.suppress(Exception):
        admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        try:
            _drop_database(admin, name)
        finally:
            admin.dispose()


def shared_template(revision: str) -> str:
    """A database migrated to ``revision``, built once per test process.

    Every ``test_coordconv_*`` module clones it (``clone_of``) instead of
    running the whole chain itself; nothing connects to it except to clone it,
    which ``CREATE DATABASE ... TEMPLATE`` requires. It is dropped when the
    process exits.
    """
    if revision in _TEMPLATES:
        return _TEMPLATES[revision]
    admin_url = admin_url_or_skip()
    name = f"coordconv_tpl_{uuid.uuid4().hex[:12]}"
    base, _, _ = admin_url.rpartition("/")
    url = f"{base}/{name}"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        admin.dispose()
    atexit.register(_drop_quietly, admin_url, name)
    run_alembic(backend_root(), url, "upgrade", revision)
    _TEMPLATES[revision] = url
    return url


@contextlib.contextmanager
def clone_of(template_url: str, prefix: str) -> Iterator[tuple[Engine, str]]:
    """A throwaway copy of ``template_url``, as ``(engine, url)``; dropped after."""
    admin_url = admin_database_url()
    template = make_url(template_url).database
    name = f"{prefix}_{uuid.uuid4().hex[:12]}"
    base, _, _ = admin_url.rpartition("/")
    url = f"{base}/{name}"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    engine: Engine | None = None
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}" TEMPLATE "{template}"'))
        engine = create_engine(url)
        yield engine, url
    finally:
        if engine is not None:
            with contextlib.suppress(Exception):
                engine.dispose()
        with contextlib.suppress(Exception):
            _drop_database(admin, name)
        admin.dispose()


# ---------------------------------------------------------------------------
# Seeders: production's shape, one object each, on a database at or after
# image_assets_01 where that object is still in its chain shape.
# ---------------------------------------------------------------------------


def seed_devices_metadata(conn: Connection) -> None:
    """Production's self-heal column, absent from the chain."""
    conn.execute(
        text(
            "ALTER TABLE coord.devices "
            "ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb"
        )
    )


def seed_devices_without_tenant_key(conn: Connection) -> None:
    """Production has no ``devices_tenant_id_fkey``."""
    conn.execute(
        text("ALTER TABLE coord.devices DROP CONSTRAINT devices_tenant_id_fkey")
    )


def seed_memory_id_without_default(conn: Connection) -> None:
    """Production's ``memory_id`` has no default."""
    conn.execute(text("ALTER TABLE coord.memories ALTER COLUMN memory_id DROP DEFAULT"))


def seed_idx_memories_name_version(conn: Connection) -> None:
    conn.execute(
        text(
            "CREATE INDEX idx_memories_name_version "
            "ON coord.memories USING btree (name, version DESC)"
        )
    )


def seed_idx_memories_type(conn: Connection) -> None:
    conn.execute(
        text(
            "CREATE INDEX idx_memories_type "
            "ON coord.memories USING btree (type) WHERE (NOT is_tombstone)"
        )
    )


def seed_idx_memories_written_at(conn: Connection) -> None:
    conn.execute(
        text(
            "CREATE INDEX idx_memories_written_at "
            "ON coord.memories USING btree (written_at DESC)"
        )
    )


def seed_production_only_memories_indexes(conn: Connection) -> None:
    """The three self-heal indexes on ``coord.memories``."""
    seed_idx_memories_name_version(conn)
    seed_idx_memories_type(conn)
    seed_idx_memories_written_at(conn)


def seed_idx_agent_questions_agent(conn: Connection) -> None:
    """Production's self-heal index on ``coord.agent_questions``."""
    conn.execute(
        text(
            "CREATE INDEX idx_agent_questions_agent "
            "ON coord.agent_questions USING btree (agent_id, created_at DESC)"
        )
    )


def seed_wide_idx_agent_questions_session(conn: Connection) -> None:
    """Production's wider ``idx_agent_questions_session``."""
    conn.execute(text("DROP INDEX coord.idx_agent_questions_session"))
    conn.execute(
        text(
            "CREATE INDEX idx_agent_questions_session ON coord.agent_questions "
            "USING btree (agent_session_id, created_at DESC) "
            "WHERE (agent_session_id IS NOT NULL)"
        )
    )


def seed_primary_trees_key_not_valid(conn: Connection) -> None:
    """Production's ``primary_trees_tenant_id_fkey``: same action, ``NOT VALID``.

    Rows a test wants orphaned must be inserted BEFORE this runs, or between a
    drop and this re-add: a ``NOT VALID`` key still checks every new row.
    """
    conn.execute(
        text(
            "ALTER TABLE coord.primary_trees "
            "DROP CONSTRAINT primary_trees_tenant_id_fkey"
        )
    )
    conn.execute(
        text(
            "ALTER TABLE coord.primary_trees ADD CONSTRAINT "
            "primary_trees_tenant_id_fkey FOREIGN KEY (tenant_id) "
            "REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL NOT VALID"
        )
    )


ALL_SEEDERS = (
    seed_devices_metadata,
    seed_devices_without_tenant_key,
    seed_memory_id_without_default,
    seed_production_only_memories_indexes,
    seed_idx_agent_questions_agent,
    seed_wide_idx_agent_questions_session,
    seed_primary_trees_key_not_valid,
)


def seed_production_shape(engine: Engine) -> None:
    """Every measured drift at once: production at ``image_assets_01``."""
    with engine.begin() as conn:
        for seed in ALL_SEEDERS:
            seed(conn)


# ---------------------------------------------------------------------------
# Rows. Every helper returns the ids it made, so assertions can scope by them.
# ---------------------------------------------------------------------------


def insert_tenant(conn: Connection) -> uuid.UUID:
    tag = uuid.uuid4().hex[:12]
    return conn.execute(
        text(
            "INSERT INTO coord.tenants (slug, display_name) "
            "VALUES (:slug, :name) RETURNING tenant_id"
        ),
        {"slug": f"coordconv-{tag}", "name": f"coordconv {tag}"},
    ).scalar_one()


def insert_device(conn: Connection, tenant_id: uuid.UUID) -> uuid.UUID:
    device_id = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO coord.devices (device_id, name, hostname, tenant_id) "
            "VALUES (:d, :name, :host, :t)"
        ),
        {"d": device_id, "name": "coordconv", "host": "coordconv-host", "t": tenant_id},
    )
    return device_id


def insert_primary_tree(
    conn: Connection, device_id: uuid.UUID, tenant_id: uuid.UUID, repo: str
) -> None:
    conn.execute(
        text(
            "INSERT INTO coord.primary_trees "
            "(device_id, repo, branch, head_sha, dirty, tenant_id, dirty_files) "
            "VALUES (:d, :repo, 'main', :sha, true, :t, ARRAY['a.py'])"
        ),
        {"d": device_id, "repo": repo, "sha": uuid.uuid4().hex, "t": tenant_id},
    )


def seed_orphaned_primary_trees(
    conn: Connection, device_id: uuid.UUID, repos: list[str]
) -> uuid.UUID:
    """Production's tenant key on ``primary_trees`` (``NOT VALID``) plus orphans.

    Inserts one row per repo naming a tenant that does not exist, which only a
    database without a checked key admits, then re-adds the key ``NOT VALID``
    exactly as production has it. Returns the missing tenant's id.
    """
    missing = uuid.uuid4()
    conn.execute(
        text(
            "ALTER TABLE coord.primary_trees "
            "DROP CONSTRAINT primary_trees_tenant_id_fkey"
        )
    )
    for repo in repos:
        insert_primary_tree(conn, device_id, missing, repo)
    conn.execute(
        text(
            "ALTER TABLE coord.primary_trees ADD CONSTRAINT "
            "primary_trees_tenant_id_fkey FOREIGN KEY (tenant_id) "
            "REFERENCES coord.tenants(tenant_id) ON DELETE SET NULL NOT VALID"
        )
    )
    return missing


def primary_tree_rows(engine: Engine, device_id: uuid.UUID) -> dict[str, dict]:
    """``repo -> to_jsonb(row)`` for one device's rows."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT p.repo, to_jsonb(p) FROM coord.primary_trees p "
                "WHERE p.device_id = :d"
            ),
            {"d": device_id},
        ).fetchall()
    return {str(repo): data for repo, data in rows}


def scalar_at(engine: Engine, sql: str, **params: object) -> object:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar_one()


# ---------------------------------------------------------------------------
# The proof that the seeders are production's shape.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def measured_template() -> str:
    return shared_template(MEASURED_AT_REVISION)


def test_the_measured_drift_is_disjoint_and_names_nine_objects() -> None:
    """The literals above are the nine objects of finding 35ca1c85, no more."""
    objects = {line.split("\t")[1] for line in PRODUCTION_ONLY_LINES | CHAIN_ONLY_LINES}
    assert objects == {
        "coord.devices.metadata",
        "coord.devices.devices_tenant_id_fkey",
        "coord.memories.memory_id",
        "coord.idx_memories_name_version",
        "coord.idx_memories_type",
        "coord.idx_memories_written_at",
        "coord.idx_agent_questions_agent",
        "coord.idx_agent_questions_session",
        "coord.primary_trees.primary_trees_tenant_id_fkey",
    }
    assert not PRODUCTION_ONLY_LINES & CHAIN_ONLY_LINES


def test_seeders_reproduce_exactly_the_measured_drift(measured_template: str) -> None:
    """Fresh -> seeded differs by the measured drift and by nothing else."""
    with clone_of(measured_template, "coordconv_00_shape") as (engine, _):
        fresh = catalog_lines(engine, ("coord", "web"))
        assert sum(1 for line in fresh if line.startswith("table\tcoord.")) > 250, (
            "the catalog reader saw almost no coord tables; it read nothing useful"
        )
        seed_production_shape(engine)
        seeded = catalog_lines(engine, ("coord", "web"))
    assert seeded - fresh == PRODUCTION_ONLY_LINES
    assert fresh - seeded == CHAIN_ONLY_LINES
