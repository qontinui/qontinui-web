"""Schema + behaviour tests for revision ``coordmem_02``.

Phase 2a of plan ``2026-10-16-coord-memories-latest-view-crosses-tenants``
replaces ``coord.memories``' global ``UNIQUE (name, version)`` with
``UNIQUE (tenant_id, name, version)`` and drops ``idx_memories_name_latest``.
None of that is visible from a passing ``upgrade``, so these are the contract:

1. **The key is per tenant.** A second tenant can write a name another tenant
   holds, at the same version, using coord's upsert SQL shape; a duplicate
   version within ONE tenant is still refused. The positive control: the same
   insert at the parent raises ``unique_violation``.
2. **The catalog says so**: the constraint definition, no old key, the index
   valid, and the name index gone.
3. **The view still reads each tenant's own row** at equal versions.
4. **An INVALID leftover index is rebuilt**, not trusted: ``IF NOT EXISTS``
   alone would keep an index that enforces nothing.
5. **A retry is a no-op**, and the downgrade restores the parent's key and
   index exactly, REFUSING (with a named reason and a count) when two tenants
   share a ``(name, version)``, because the global key cannot be rebuilt then.
6. **``coordmem_01``'s view comment is pinned as a literal** (round-2 review of
   Phase 1): that revision's own identity test compares the database value with
   its module constant, so a mutation that restored the old text survived.

Substrate: one database migrated to the parent, built once per test process
(``shared_template``) and cloned per test (``clone_of``). A skip proves
nothing: set ``QONTINUI_TEST_PG_DSN`` (or ``QONTINUI_TEST_PG``) to run these.
"""

from __future__ import annotations

import re
import uuid
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    backend_root,
    declared_parent_revision_id,
    load_revision_module,
    run_alembic,
)
from tests.test_coordconv_00_production_shape import (
    clone_of,
    insert_tenant,
    shared_template,
)

# Pinned rather than "head" so a later revision cannot change what this walks.
# MUST equal the revision's own down_revision (the first test enforces it).
_REVISION_ID = "coordmem_02"
_PARENT_REVISION_ID = "pr_fix_ctx_head_sha_01"
_REVISION_FILENAME = "coordmem_02_memories_unique_per_tenant.py"

_NEW_KEY = "memories_tenant_id_name_version_key"
_OLD_KEY = "memories_name_version_key"
_NAME_INDEX = "idx_memories_name_latest"

_NEW_KEY_DEF = "UNIQUE (tenant_id, name, version)"
_OLD_KEY_DEF = "UNIQUE (name, version)"
_NAME_INDEX_DEF = (
    "CREATE INDEX idx_memories_name_latest ON coord.memories "
    "USING btree (name, version DESC)"
)

#: ``coordmem_01``'s catalog comment, spelled out here so a change to that
#: revision's ``VIEW_COMMENT`` (or a mutation restoring the old text) reds this
#: file rather than moving with the constant.
_COORDMEM_01_VIEW_COMMENT = (
    "Latest version of each memory per (tenant_id, name); a name whose latest "
    "version is a tombstone is absent. Defined by qontinui-web alembic revision "
    "coordmem_01. security_invoker: the reader's own privileges, and any "
    "row-level security later enabled on coord.memories, apply."
)

#: coord's ``post_upsert`` INSERT, per-tenant ``MAX`` subselect included.
_UPSERT = text(
    "INSERT INTO coord.memories "
    "(memory_id, name, version, content, is_tombstone, tenant_id) "
    "VALUES (gen_random_uuid(), :name, "
    "COALESCE((SELECT MAX(version) FROM coord.memories "
    "WHERE name = :name AND tenant_id = :tenant), 0) + 1, "
    ":content, false, :tenant) RETURNING version"
)


def _revision_path():
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_module(tag: str) -> ModuleType:
    return load_revision_module(
        _revision_path(), f"coordmem_02_{tag}_{uuid.uuid4().hex[:8]}"
    )


def _normalized(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


def _upgrade(url: str) -> None:
    run_alembic(backend_root(), url, "upgrade", _REVISION_ID)


def _downgrade(url: str) -> None:
    run_alembic(backend_root(), url, "downgrade", _PARENT_REVISION_ID)


# ---------------------------------------------------------------------------
# Catalog and data reads.
# ---------------------------------------------------------------------------


def _constraints(engine: Engine) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conrelid = 'coord.memories'::regclass AND contype = 'u'"
            )
        ).fetchall()
    return {str(n): str(d) for n, d in rows}


def _indexes(engine: Engine) -> dict[str, tuple[str, bool]]:
    """``{name: (definition, indisvalid)}`` for every index on the table."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT c.relname, pg_get_indexdef(i.indexrelid), i.indisvalid "
                "FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
                "WHERE i.indrelid = 'coord.memories'::regclass"
            )
        ).fetchall()
    return {str(n): (str(d), bool(v)) for n, d, v in rows}


def _key_state(engine: Engine) -> tuple[dict[str, str], dict[str, tuple[str, bool]]]:
    return _constraints(engine), _indexes(engine)


def _write(engine: Engine, tenant: uuid.UUID, name: str, content: str = "c") -> int:
    with engine.begin() as conn:
        return int(
            conn.execute(
                _UPSERT, {"name": name, "tenant": tenant, "content": content}
            ).scalar_one()
        )


def _raw_insert(engine: Engine, tenant: uuid.UUID, name: str, version: int) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.memories (name, version, content, tenant_id) "
                "VALUES (:n, :v, 'c', :t)"
            ),
            {"n": name, "v": version, "t": tenant},
        )


def _two_tenants(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    with engine.begin() as conn:
        return insert_tenant(conn), insert_tenant(conn)


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    source = _revision_path().read_text(encoding="utf-8")
    declared = declared_parent_revision_id(source, _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} but this test "
        f"pins {_PARENT_REVISION_ID!r}. Re-point both together, and the "
        f"`Revises:` header in the revision docstring with them."
    )
    assert _revision_module("id").revision == _REVISION_ID


def test_coordmem_01s_view_comment_is_pinned_as_a_literal() -> None:
    """The module constant must equal the literal, so restoring the old text
    in ``coordmem_01`` reds here even though its own test compares the database
    with the same constant."""
    module = load_revision_module(
        backend_root()
        / "alembic"
        / "versions"
        / "coordmem_01_memories_latest_per_tenant.py",
        f"coordmem_01_literal_{uuid.uuid4().hex[:8]}",
    )
    assert module.VIEW_COMMENT == _COORDMEM_01_VIEW_COMMENT


def test_the_revision_names_what_the_tests_pin() -> None:
    module = _revision_module("names")
    assert module.NEW_KEY == _NEW_KEY
    assert module.OLD_KEY == _OLD_KEY
    assert module.NAME_INDEX == _NAME_INDEX
    assert module.NEW_KEY_COLUMNS == "tenant_id, name, version"
    assert module.OLD_KEY_COLUMNS == "name, version"


# ---------------------------------------------------------------------------
# Walks: each on a clone of the parent.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(_PARENT_REVISION_ID)


def test_the_parent_has_the_global_key_and_the_name_index(parent: str) -> None:
    """Positive control for everything below: the old shape is what the
    revision is measured against."""
    with clone_of(parent, "coordmem_02_parent") as (engine, _url):
        constraints, indexes = _key_state(engine)
        assert constraints.get(_OLD_KEY) == _OLD_KEY_DEF
        assert _NEW_KEY not in constraints
        assert _NAME_INDEX in indexes


def test_the_upgrade_swaps_the_global_key_for_a_per_tenant_key(parent: str) -> None:
    with clone_of(parent, "coordmem_02_swap") as (engine, url):
        _upgrade(url)
        constraints, indexes = _key_state(engine)
        assert constraints.get(_NEW_KEY) == _NEW_KEY_DEF
        assert _OLD_KEY not in constraints
        assert _OLD_KEY not in indexes
        assert indexes[_NEW_KEY][1] is True, "the per-tenant index must be valid"


def test_the_upgrade_drops_the_redundant_name_index(parent: str) -> None:
    with clone_of(parent, "coordmem_02_idx") as (engine, url):
        assert _NAME_INDEX in _indexes(engine)
        _upgrade(url)
        assert _NAME_INDEX not in _indexes(engine)


def test_a_second_tenant_can_write_a_name_another_tenant_holds(parent: str) -> None:
    # The control: at the parent, tenant B's first write of A's name collides.
    with clone_of(parent, "coordmem_02_ctl") as (engine, _url):
        a, b = _two_tenants(engine)
        assert _write(engine, a, "shared") == 1
        with pytest.raises(IntegrityError, match="memories_name_version_key"):
            _write(engine, b, "shared")

    with clone_of(parent, "coordmem_02_two") as (engine, url):
        _upgrade(url)
        a, b = _two_tenants(engine)
        assert _write(engine, a, "shared") == 1
        assert _write(engine, a, "shared") == 2
        assert _write(engine, b, "shared") == 1, (
            "tenant B's version counter must not see tenant A's versions"
        )


def test_a_duplicate_version_within_one_tenant_is_still_refused(parent: str) -> None:
    with clone_of(parent, "coordmem_02_dup") as (engine, url):
        _upgrade(url)
        a, _b = _two_tenants(engine)
        _raw_insert(engine, a, "n", 1)
        with pytest.raises(IntegrityError, match=_NEW_KEY):
            _raw_insert(engine, a, "n", 1)


def test_two_tenants_at_the_same_version_each_read_their_own(parent: str) -> None:
    with clone_of(parent, "coordmem_02_view") as (engine, url):
        _upgrade(url)
        a, b = _two_tenants(engine)
        _write(engine, a, "shared", "A body")
        _write(engine, b, "shared", "B body")
        with engine.connect() as conn:
            reads = {
                t: conn.execute(
                    text(
                        "SELECT version, content FROM coord.memories_latest "
                        "WHERE name = 'shared' AND tenant_id = :t"
                    ),
                    {"t": t},
                ).one()
                for t in (a, b)
            }
            comment = conn.execute(
                text(
                    "SELECT obj_description('coord.memories_latest'::regclass, "
                    "'pg_class')"
                )
            ).scalar_one()
        assert (int(reads[a][0]), str(reads[a][1])) == (1, "A body")
        assert (int(reads[b][0]), str(reads[b][1])) == (1, "B body")
        # coordmem_01's comment survives this revision, literally.
        assert comment == _COORDMEM_01_VIEW_COMMENT


def test_an_invalid_leftover_index_is_rebuilt(parent: str) -> None:
    """An interrupted ``CREATE INDEX CONCURRENTLY`` leaves an INVALID index that
    ``IF NOT EXISTS`` would keep. CI's superuser marks one invalid by hand."""
    with clone_of(parent, "coordmem_02_invalid") as (engine, url):
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"CREATE UNIQUE INDEX {_NEW_KEY} ON coord.memories "
                    "(tenant_id, name, version)"
                )
            )
            conn.execute(
                text(
                    "UPDATE pg_index SET indisvalid = false "
                    f"WHERE indexrelid = 'coord.{_NEW_KEY}'::regclass"
                )
            )
        assert _indexes(engine)[_NEW_KEY][1] is False
        _upgrade(url)
        constraints, indexes = _key_state(engine)
        assert constraints.get(_NEW_KEY) == _NEW_KEY_DEF
        assert indexes[_NEW_KEY][1] is True


def test_a_retry_after_the_swap_is_a_no_op(parent: str) -> None:
    with clone_of(parent, "coordmem_02_retry") as (engine, url):
        _upgrade(url)
        first = _key_state(engine)
        run_alembic(backend_root(), url, "stamp", _PARENT_REVISION_ID)
        _upgrade(url)
        assert _key_state(engine) == first


def test_the_downgrade_restores_the_global_key_and_the_name_index_exactly(
    parent: str,
) -> None:
    with clone_of(parent, "coordmem_02_down") as (engine, url):
        a, _b = _two_tenants(engine)
        _raw_insert(engine, a, "n", 1)
        before = _key_state(engine)
        _upgrade(url)
        _downgrade(url)
        after = _key_state(engine)
        assert after[0] == before[0]
        assert after[1] == before[1]
        assert after[1][_NAME_INDEX][0] == _NAME_INDEX_DEF
        assert after[0][_OLD_KEY] == _OLD_KEY_DEF
        assert _NEW_KEY not in after[0]


def test_the_downgrade_refuses_when_two_tenants_share_a_name_and_version(
    parent: str,
) -> None:
    with clone_of(parent, "coordmem_02_refuse") as (engine, url):
        _upgrade(url)
        a, b = _two_tenants(engine)
        _write(engine, a, "shared")
        _write(engine, b, "shared")
        before = _key_state(engine)
        with pytest.raises(AssertionError) as failure:
            _downgrade(url)
        message = str(failure.value)
        assert "coordmem_02 downgrade refused" in message
        assert "1 (name, version) pair(s)" in message
        assert "duplicate key" not in message, "must be the named refusal"
        assert _key_state(engine) == before, "the refusal must change nothing"


def test_up_down_up(parent: str) -> None:
    with clone_of(parent, "coordmem_02_udu") as (engine, url):
        _upgrade(url)
        first = _key_state(engine)
        _downgrade(url)
        _upgrade(url)
        assert _key_state(engine) == first
