"""Schema + behaviour tests for revision ``coordmem_01``.

Phase 1 of plan ``2026-10-16-coord-memories-latest-view-crosses-tenants``
re-defines ``coord.memories_latest`` as the latest version per
``(tenant_id, name)``, absent when that version is a tombstone. None of that is
visible from a passing ``upgrade``, so these are the contract:

1. **Each tenant reads its own memory.** A name held by two tenants returns each
   tenant's own latest version, in every reader shape (coord's ``get_one`` and
   ``get_list``, web's bridge reading the whole view).
2. **A tombstone retracts its own tenant's name, and only that.** A name whose
   latest version is a tombstone is absent, a restore after it brings the name
   back, and another tenant's tombstone does not hide a live memory.
3. **The view keeps its identity.** OID, owner, ACL (every privilege
   ``coordrls_01`` granted the tenant roles, asserted one at a time),
   ``security_invoker`` and the 11-column list are unchanged.
4. **The downgrade restores the parent's object exactly**: ``pg_get_viewdef``
   byte-equal, the same options, ACL, owner and OID, and no comment.
   ``Migration Reversal Tested`` compares a schema-only dump, which carries no
   privileges, owner or OID; this file owns those.
5. **A retry is a no-op**, and up -> down -> up returns the per-tenant view.

The fixture enumerates names with one version (``all_tomb``), two (``shared``,
``a_only``, ``cross_tomb``) and three (``restored``); a tombstone as the only,
the last and a middle version; and a tenant with no row for a name another
tenant holds. ``test_the_fixture_discriminates_at_the_parent`` is the positive
control: at the parent the per-tenant expectation is NOT met, which is what
lets the tests after it fail on the old definition.

Substrate: one database migrated to the parent, built once per test process
(``shared_template``) and cloned per test (``clone_of``), as the
``test_coordconv_*`` modules do. A skip proves nothing: set
``QONTINUI_TEST_PG_DSN`` (or ``QONTINUI_TEST_PG``) to run these.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

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
_REVISION_ID = "coordmem_01"
_PARENT_REVISION_ID = "coordconv_01"
_REVISION_FILENAME = "coordmem_01_memories_latest_per_tenant.py"

_ROLES = ("coord_tenant", "coord_tenant_preflight")
_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE")

#: ``pg_get_viewdef('coord.memories_latest'::regclass, true)`` read in
#: production 2026-10-16T00:44Z (read-only), the parent's definition.
_PRODUCTION_VIEWDEF = (
    " SELECT DISTINCT ON (name) memory_id,\n"
    "    name,\n"
    "    version,\n"
    "    content,\n"
    "    description,\n"
    "    type,\n"
    "    written_by_agent,\n"
    "    written_by_device,\n"
    "    written_at,\n"
    "    is_tombstone,\n"
    "    tenant_id\n"
    "   FROM coord.memories\n"
    "  WHERE NOT is_tombstone\n"
    "  ORDER BY name, version DESC;"
)

#: ``coord_tenant_scope_columns``' definition, spelled out here so a change to
#: the revision's ``PREVIOUS_SELECT`` reds the test rather than moving with it.
_PREVIOUS_SELECT_LITERAL = (
    "SELECT DISTINCT ON (name) memory_id, name, version, content, description, "
    "type, written_by_agent, written_by_device, written_at, is_tombstone, "
    "tenant_id FROM coord.memories WHERE NOT is_tombstone ORDER BY name, version DESC"
)

#: The view's columns: name and type, in order.
_COLUMNS = [
    ("memory_id", "uuid"),
    ("name", "text"),
    ("version", "bigint"),
    ("content", "text"),
    ("description", "text"),
    ("type", "text"),
    ("written_by_agent", "uuid"),
    ("written_by_device", "uuid"),
    ("written_at", "timestamp with time zone"),
    ("is_tombstone", "boolean"),
    ("tenant_id", "uuid"),
]

#: (name, version, content, is_tombstone, tenant) — tenant "A" or "B".
_FIXTURE = (
    ("shared", 1, "A shared v1", False, "A"),
    ("shared", 2, "B shared v2", False, "B"),
    ("a_only", 1, "A a_only v1", False, "A"),
    ("a_only", 2, "", True, "A"),
    ("restored", 1, "A restored v1", False, "A"),
    ("restored", 2, "", True, "A"),
    ("restored", 3, "A restored v3", False, "A"),
    ("cross_tomb", 1, "A cross_tomb v1", False, "A"),
    ("cross_tomb", 2, "", True, "B"),
    ("all_tomb", 1, "", True, "A"),
)

#: What each tenant must read at the revision: {name: version}.
_EXPECTED = {
    "A": {"shared": 1, "restored": 3, "cross_tomb": 1},
    "B": {"shared": 2},
}


def _revision_path():
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_module(tag: str) -> ModuleType:
    return load_revision_module(
        _revision_path(), f"coordmem_01_{tag}_{uuid.uuid4().hex[:8]}"
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


@dataclass(frozen=True)
class ViewState:
    oid: int
    owner: str
    options: str
    acl: str
    comment: str | None
    definition_pretty: str
    definition: str


def _view_state(engine: Engine) -> ViewState:
    """The view's catalog row. ``search_path`` is pinned so the deparser
    qualifies ``coord.memories`` exactly as production rendered it."""
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL search_path TO pg_catalog"))
        row = conn.execute(
            text(
                """
                SELECT c.oid::bigint, pg_get_userbyid(c.relowner),
                       coalesce(array_to_string(c.reloptions, ','), ''),
                       coalesce(c.relacl::text, ''),
                       obj_description(c.oid, 'pg_class'),
                       pg_get_viewdef(c.oid, true), pg_get_viewdef(c.oid)
                  FROM pg_class c
                 WHERE c.oid = 'coord.memories_latest'::regclass
                """
            )
        ).one()
    return ViewState(
        oid=int(row[0]),
        owner=str(row[1]),
        options=str(row[2]),
        acl=str(row[3]),
        comment=row[4],
        definition_pretty=str(row[5]),
        definition=str(row[6]),
    )


def _security_invoker(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT coalesce(
                             (SELECT o.option_value::boolean
                                FROM pg_options_to_table(c.reloptions) o
                               WHERE o.option_name = 'security_invoker'),
                             false)
                      FROM pg_class c
                     WHERE c.oid = 'coord.memories_latest'::regclass
                    """
                )
            ).scalar_one()
        )


def _seed(engine: Engine) -> dict[str, uuid.UUID]:
    """Two tenants and the fixture's rows; returns {"A": id, "B": id}."""
    with engine.begin() as conn:
        tenants = {"A": insert_tenant(conn), "B": insert_tenant(conn)}
        for name, version, content, tombstone, tenant in _FIXTURE:
            conn.execute(
                text(
                    "INSERT INTO coord.memories "
                    "(name, version, content, is_tombstone, tenant_id) "
                    "VALUES (:name, :version, :content, :tombstone, :tenant)"
                ),
                {
                    "name": name,
                    "version": version,
                    "content": content,
                    "tombstone": tombstone,
                    "tenant": tenants[tenant],
                },
            )
    return tenants


def _tenant_reads(
    engine: Engine, tenants: dict[str, uuid.UUID]
) -> dict[str, dict[str, int]]:
    """coord ``get_list``'s shape: the view filtered on ``tenant_id``."""
    out: dict[str, dict[str, int]] = {}
    with engine.connect() as conn:
        for label, tenant in tenants.items():
            rows = conn.execute(
                text(
                    "SELECT name, version FROM coord.memories_latest "
                    "WHERE tenant_id = :t"
                ),
                {"t": tenant},
            ).fetchall()
            out[label] = {str(r[0]): int(r[1]) for r in rows}
    return out


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


def test_the_revision_restores_the_previous_definition_verbatim() -> None:
    module = _revision_module("previous")
    assert _normalized(module.PREVIOUS_SELECT) == _PREVIOUS_SELECT_LITERAL
    assert module.VIEW == "coord.memories_latest"
    assert [name for name, _type in _COLUMNS] == list(module.COLUMNS)


_OFFLINE_URL = "postgresql://nobody:nothing@127.0.0.1:1/coordmem_01_offline"


def test_each_direction_replaces_the_view_in_its_own_bounded_transaction() -> None:
    """The replace holds its ``AccessExclusiveLock`` for one short transaction.

    ``alembic/env.py`` runs a deploy batch in ONE transaction, so a lock taken
    inside it would last until the whole batch commits. Rendered offline
    (``--sql``, no database), an ``autocommit_block`` is a bare ``COMMIT;``
    before its statements and a ``BEGIN;`` after. The re-definition must sit in
    that gap as its own ``BEGIN; SET LOCAL lock_timeout = '3s'; ...; COMMIT;``,
    in both directions, so a reader holding the view fails the run fast instead
    of queueing every other reader behind the lock.
    """
    module = _revision_module("offline")
    comments = {
        "upgrade": "'" + module.VIEW_COMMENT.replace("'", "''") + "'",
        "downgrade": "NULL",
    }
    for direction, (start, end) in (
        ("upgrade", (_PARENT_REVISION_ID, _REVISION_ID)),
        ("downgrade", (_REVISION_ID, _PARENT_REVISION_ID)),
    ):
        sql = run_alembic(
            backend_root(), _OFFLINE_URL, direction, f"{start}:{end}", "--sql"
        ).stdout
        lines = [line.strip() for line in sql.splitlines() if line.strip()]
        opening = (
            "BEGIN; SET LOCAL lock_timeout = '3s'; CREATE OR REPLACE VIEW "
            "coord.memories_latest WITH (security_invoker = true) AS"
        )
        starts = [i for i, line in enumerate(lines) if line.startswith(opening)]
        assert len(starts) == 1, f"{direction}: no single `{opening}` in:\n{sql}"
        at = starts[0]
        # The autocommit block's batch commit comes right before it ...
        assert lines[at - 1] == "COMMIT;", f"{direction}: preceded by {lines[at - 1]!r}"
        # ... and the statement closes its own transaction, comment included,
        # before the block's BEGIN reopens the batch.
        closing = (
            f"; COMMENT ON VIEW coord.memories_latest IS {comments[direction]}; COMMIT;"
        )
        ends = [i for i in range(at, len(lines)) if lines[i] == closing]
        assert ends, f"{direction}: no `{closing}` after the replace in:\n{sql}"
        assert lines[ends[0] + 1] == "BEGIN;", (
            f"{direction}: followed by {lines[ends[0] + 1]!r}"
        )


# ---------------------------------------------------------------------------
# One seeded clone at the parent, then upgraded: the read-only tests share it.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Walk:
    engine: Engine
    tenants: dict[str, uuid.UUID]
    parent_state: ViewState
    parent_reads: dict[str, dict[str, int]]


@pytest.fixture(scope="module")
def parent() -> str:
    return shared_template(_PARENT_REVISION_ID)


@pytest.fixture(scope="module")
def walk(parent: str) -> Iterator[Walk]:
    with clone_of(parent, "coordmem_01_walk") as (engine, url):
        tenants = _seed(engine)
        parent_state = _view_state(engine)
        parent_reads = _tenant_reads(engine, tenants)
        _upgrade(url)
        yield Walk(engine, tenants, parent_state, parent_reads)


def test_the_parent_view_is_production_s_measured_definition(walk: Walk) -> None:
    assert walk.parent_state.definition_pretty == _PRODUCTION_VIEWDEF


def test_the_fixture_discriminates_at_the_parent(walk: Walk) -> None:
    """Positive control: the parent's view does NOT meet the expectation."""
    assert walk.parent_reads != _EXPECTED
    # The two defects, named: tenant B's higher version of `shared` hides
    # tenant A's, and A's deleted `a_only` resurfaces at its live version 1.
    assert "shared" not in walk.parent_reads["A"]
    assert walk.parent_reads["A"].get("a_only") == 1


def test_each_tenant_reads_its_own_latest_version_of_a_shared_name(walk: Walk) -> None:
    a, b = walk.tenants["A"], walk.tenants["B"]
    with walk.engine.connect() as conn:
        # coord get_one's shape.
        one = conn.execute(
            text(
                "SELECT version, content FROM coord.memories_latest "
                "WHERE name = :n AND tenant_id = :t"
            ),
            {"n": "shared", "t": a},
        ).one()
        # web list_bridge_source_keys' shape: the whole view.
        whole = conn.execute(
            text(
                "SELECT tenant_id, name, version FROM coord.memories_latest "
                "WHERE tenant_id IS NOT NULL"
            )
        ).fetchall()
    assert (int(one[0]), str(one[1])) == (1, "A shared v1")
    assert _tenant_reads(walk.engine, walk.tenants)["A"]["shared"] == 1
    assert _tenant_reads(walk.engine, walk.tenants)["B"]["shared"] == 2
    assert sorted((str(r[0]), str(r[1]), int(r[2])) for r in whole) == sorted(
        [
            (str(a), "shared", 1),
            (str(b), "shared", 2),
            (str(a), "restored", 3),
            (str(a), "cross_tomb", 1),
        ]
    )


def test_a_name_whose_latest_version_is_a_tombstone_is_absent(walk: Walk) -> None:
    reads = _tenant_reads(walk.engine, walk.tenants)
    assert "a_only" not in reads["A"]
    assert "all_tomb" not in reads["A"]
    assert reads == _EXPECTED


def test_a_restore_after_a_tombstone_brings_the_name_back(walk: Walk) -> None:
    assert _tenant_reads(walk.engine, walk.tenants)["A"]["restored"] == 3


def test_another_tenants_tombstone_does_not_hide_a_live_memory(walk: Walk) -> None:
    reads = _tenant_reads(walk.engine, walk.tenants)
    assert reads["A"]["cross_tomb"] == 1
    assert "cross_tomb" not in reads["B"]


def test_the_view_keeps_its_oid_owner_grants_options_and_columns(walk: Walk) -> None:
    module = _revision_module("comment")
    state = _view_state(walk.engine)
    assert state.oid == walk.parent_state.oid
    assert state.owner == walk.parent_state.owner
    assert state.acl == walk.parent_state.acl
    assert state.comment == module.VIEW_COMMENT
    assert _security_invoker(walk.engine), state.options
    with walk.engine.connect() as conn:
        columns = conn.execute(
            text(
                """
                SELECT attname, format_type(atttypid, atttypmod)
                  FROM pg_attribute
                 WHERE attrelid = 'coord.memories_latest'::regclass
                   AND attnum > 0 AND NOT attisdropped
                 ORDER BY attnum
                """
            )
        ).fetchall()
        # One privilege per call: a comma list answers true when ANY is held.
        missing = [
            f"{role} {privilege}"
            for role in _ROLES
            for privilege in _PRIVILEGES
            if not conn.execute(
                text("SELECT has_table_privilege(:r, 'coord.memories_latest', :p)"),
                {"r": role, "p": privilege},
            ).scalar_one()
        ]
    assert [(str(n), str(t)) for n, t in columns] == _COLUMNS
    assert missing == []


# ---------------------------------------------------------------------------
# Walks that move the revision: each on a clone of its own.
# ---------------------------------------------------------------------------


def test_the_downgrade_restores_the_previous_view_exactly(parent: str) -> None:
    with clone_of(parent, "coordmem_01_down") as (engine, url):
        tenants = _seed(engine)
        before = _view_state(engine)
        reads_before = _tenant_reads(engine, tenants)
        _upgrade(url)
        _downgrade(url)
        after = _view_state(engine)
        assert after.definition_pretty == before.definition_pretty
        assert after.definition == before.definition
        assert after.options == before.options
        assert after.acl == before.acl
        assert after.owner == before.owner
        assert after.oid == before.oid
        assert after.comment is None
        assert _tenant_reads(engine, tenants) == reads_before


def test_a_retry_after_the_view_committed_is_a_no_op(parent: str) -> None:
    """The view commits inside the revision's autocommit block before
    ``alembic_version`` moves, so a migrator retry re-runs the upgrade on an
    already re-defined view. It must change nothing."""
    with clone_of(parent, "coordmem_01_retry") as (engine, url):
        _upgrade(url)
        first = _view_state(engine)
        run_alembic(backend_root(), url, "stamp", _PARENT_REVISION_ID)
        _upgrade(url)
        assert _view_state(engine) == first


def test_up_down_up_returns_the_per_tenant_view(parent: str) -> None:
    with clone_of(parent, "coordmem_01_udu") as (engine, url):
        tenants = _seed(engine)
        _upgrade(url)
        first = _view_state(engine)
        _downgrade(url)
        _upgrade(url)
        assert _view_state(engine) == first
        assert _tenant_reads(engine, tenants) == _EXPECTED
