"""The ``session`` memory partition is reachable only by coord's service token.

Plan ``2026-10-30-memory-session-scope-clamp-trusts-an-unproven-caller-session``
D6 / Phase 2. A ``scope='session'`` row is a PRIVATE partition whose only
enforcement is an exact ``scope_ref`` match, and this door cannot prove which
session a caller is. So a device-JWT principal (``actor="device"``) is
withheld it on every memory route that reads or writes a row:

* ``GET /records`` and ``POST /graph`` leave session rows out (and the graph
  walk never steps onto one);
* ``GET /records/{id}``, ``PUT``/``DELETE /records/{id}/hold`` and
  ``DELETE /records/{id}`` answer the by-id not-found 404 for one, and write
  nothing;
* ``POST /query``, ``POST /records`` and ``POST /records/{id}/supersede``
  refuse with 403 when they name ``session`` scope or supersede a session row
  — including the inheritance case, where the payload omits ``scope``;
* ``GET /stats`` facets (and ``POST /query``'s ``live_row_count``) count
  and sample no session row;
* a write or supersede whose CONTENT a live session row already holds is a
  409 naming no id — never a dedupe onto that row or an anchor merge into it.

The coord service token and an operator user keep today's behaviour, and
``tenant`` (and ``agent``) rows are unchanged for every principal.

Every route assertion runs through the real router with the principal
swapped on the shared ``MemoryClient``; SKIPS when the test PostgreSQL (or
pgvector) is unreachable, the same posture as ``test_memory_api_db``.
"""

from __future__ import annotations

import asyncio
from collections.abc import Generator
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.v1.endpoints.memory import MemoryPrincipal, withheld_scopes
from tests.conftest import TEST_DATABASE_URL
from tests.test_memory_api_db import (
    _SETUP_SQL,
    MemoryClient,
    _exec,
    _record,
    _scalar,
)

_NOT_FOUND_BY_ID = {"detail": "memory record not found in your tenant"}
_NOT_FOUND_GRAPH = {"detail": "memory record not found"}

_SESSION_REF = str(uuid4())


@pytest.fixture(scope="module")
def memory_engine() -> Generator[AsyncEngine, None, None]:
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool, echo=False)
    try:
        _exec(engine, ["SELECT 1"])
    except Exception as exc:  # pragma: no cover — infra-dependent
        asyncio.run(engine.dispose())
        pytest.skip(f"test PostgreSQL unavailable: {exc}")
    try:
        _exec(engine, ["CREATE EXTENSION IF NOT EXISTS vector"])
    except Exception as exc:  # pragma: no cover — infra-dependent
        asyncio.run(engine.dispose())
        pytest.skip(f"pgvector unavailable in test PostgreSQL: {exc}")
    _exec(engine, _SETUP_SQL)
    yield engine
    asyncio.run(engine.dispose())


@pytest.fixture()
def mc(memory_engine: AsyncEngine) -> MemoryClient:
    _exec(
        memory_engine,
        [
            "DELETE FROM coord.memory_jobs",
            "DELETE FROM coord.memory_links",
            "DELETE FROM coord.memory_records",
            "DELETE FROM coord.tenant_policies",
            "DELETE FROM coord.sessions",
        ],
    )
    return MemoryClient(memory_engine)


def _as(mc: MemoryClient, actor: str) -> MemoryClient:
    return mc.as_actor(actor)


def _write(mc: MemoryClient, content: str, **extra: Any) -> str:
    resp = mc.client.post(
        "/api/v1/memory/records", json={"records": [_record(content, **extra)]}
    )
    assert resp.status_code == 200, resp.text
    memory_id: str = resp.json()["records"][0]["memory_id"]
    return memory_id


class _Corpus:
    """One tenant row, one session row, one agent row, and a link chain
    ``tenant -> session -> beyond`` (``beyond`` is a tenant row reachable
    ONLY through the session node). Seeded as the coord service principal,
    the one this change leaves able to write a session row."""

    def __init__(self, mc: MemoryClient) -> None:
        _as(mc, "coord_service")
        self.beyond = _write(mc, "the wombat fact past the private node")
        self.session = _write(
            mc,
            "the wombat note private to one session",
            title="the private session title",
            scope="session",
            scope_ref=_SESSION_REF,
            links=[{"target_ref": self.beyond, "relation": "related"}],
        )
        self.tenant = _write(
            mc,
            "the shared wombat fact every principal sees",
            title="the shared tenant title",
            links=[{"target_ref": self.session, "relation": "related"}],
        )
        self.agent = _write(
            mc,
            "the wombat note scoped to one agent",
            scope="agent",
            scope_ref="agent-1",
        )


def _listed(mc: MemoryClient) -> dict[str, dict[str, Any]]:
    resp = mc.client.get("/api/v1/memory/records")
    assert resp.status_code == 200, resp.text
    return {r["memory_id"]: r for r in resp.json()["records"]}


def _graph(mc: MemoryClient, root: str) -> Any:
    return mc.client.post(
        "/api/v1/memory/graph", json={"root_memory_id": root, "depth": 3}
    )


def _live_rows(engine: AsyncEngine) -> int:
    return int(
        _scalar(
            engine,
            "SELECT count(*) FROM coord.memory_records "
            "WHERE superseded_by IS NULL AND is_tombstone = false",
        )
    )


def _successor_of(engine: AsyncEngine, memory_id: str) -> Any:
    return _scalar(
        engine,
        "SELECT superseded_by FROM coord.memory_records "
        "WHERE memory_id = CAST(:m AS uuid)",
        m=memory_id,
    )


# ---------------------------------------------------------------------------
# The predicate itself — fail closed on anything not admitted
# ---------------------------------------------------------------------------


class TestWithheldScopesPredicate:
    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_principals_are_withheld_nothing(self, actor: str) -> None:
        principal = MemoryPrincipal(tenant_id=uuid4(), device_id=None, actor=actor)
        assert withheld_scopes(principal) == frozenset()

    @pytest.mark.parametrize("actor", ["device", "ci", "", "COORD_SERVICE"])
    def test_every_other_actor_is_withheld_the_session_partition(
        self, actor: str
    ) -> None:
        """``device`` and any actor this module does not name — an unknown
        one is treated like a device, never like the service."""
        principal = MemoryPrincipal(tenant_id=uuid4(), device_id=None, actor=actor)
        assert withheld_scopes(principal) == frozenset({"session"})


# ---------------------------------------------------------------------------
# GET /records
# ---------------------------------------------------------------------------


class TestListRecords:
    def test_device_list_omits_session_rows_and_links_into_them(
        self, mc: MemoryClient
    ) -> None:
        corpus = _Corpus(mc)
        listed = _listed(_as(mc, "device"))
        assert set(listed) == {corpus.tenant, corpus.beyond, corpus.agent}
        assert all(r["scope"] != "session" for r in listed.values())
        # The tenant row's only outbound link targets the session row; the
        # listing must not disclose that id through the link either.
        assert listed[corpus.tenant]["links"] == []

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_list_is_unchanged(self, mc: MemoryClient, actor: str) -> None:
        corpus = _Corpus(mc)
        listed = _listed(_as(mc, actor))
        assert set(listed) == {
            corpus.tenant,
            corpus.session,
            corpus.beyond,
            corpus.agent,
        }
        assert listed[corpus.session]["scope_ref"] == _SESSION_REF
        assert [link["target_id"] for link in listed[corpus.tenant]["links"]] == [
            corpus.session
        ]

    def test_device_page_is_full_of_visible_rows(self, mc: MemoryClient) -> None:
        """Filtered in SQL, not after the LIMIT: a page of ``limit`` rows is
        ``limit`` VISIBLE rows, so a pager is never handed a short page with
        a cursor (or an empty one that ends the walk early)."""
        _as(mc, "coord_service")
        tenant_ids = [_write(mc, f"older tenant fact number {i}") for i in range(2)]
        for i in range(3):
            _write(
                mc,
                f"newer session note number {i}",
                scope="session",
                scope_ref=_SESSION_REF,
            )
        resp = _as(mc, "device").client.get("/api/v1/memory/records?limit=2")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert {r["memory_id"] for r in body["records"]} == set(tenant_ids)


# ---------------------------------------------------------------------------
# GET /records/{id}
# ---------------------------------------------------------------------------


class TestGetById:
    def test_device_by_id_on_a_session_row_is_the_not_found_404(
        self, mc: MemoryClient
    ) -> None:
        corpus = _Corpus(mc)
        resp = _as(mc, "device").client.get(f"/api/v1/memory/records/{corpus.session}")
        assert resp.status_code == 404
        # Byte-identical to an unknown id — coord matches this detail.
        assert resp.json() == _NOT_FOUND_BY_ID
        unknown = mc.client.get(f"/api/v1/memory/records/{uuid4()}")
        assert unknown.status_code == 404
        assert unknown.json() == resp.json()

    def test_device_by_id_on_tenant_and_agent_rows_is_unchanged(
        self, mc: MemoryClient
    ) -> None:
        corpus = _Corpus(mc)
        _as(mc, "device")
        for memory_id in (corpus.tenant, corpus.agent):
            resp = mc.client.get(f"/api/v1/memory/records/{memory_id}")
            assert resp.status_code == 200, resp.text
            assert resp.json()["memory_id"] == memory_id

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_by_id_on_a_session_row_is_unchanged(
        self, mc: MemoryClient, actor: str
    ) -> None:
        corpus = _Corpus(mc)
        resp = _as(mc, actor).client.get(f"/api/v1/memory/records/{corpus.session}")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["scope"] == "session"
        assert body["scope_ref"] == _SESSION_REF
        assert body["content"] == "the wombat note private to one session"


# ---------------------------------------------------------------------------
# POST /graph
# ---------------------------------------------------------------------------


class TestGraph:
    def test_device_walk_never_steps_onto_a_session_node(
        self, mc: MemoryClient
    ) -> None:
        corpus = _Corpus(mc)
        resp = _graph(_as(mc, "device"), corpus.tenant)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # Not the session node, not the edge into it, and not ``beyond``,
        # which is reachable only THROUGH it.
        assert {n["memory_id"] for n in body["nodes"]} == {corpus.tenant}
        assert body["edges"] == []

    def test_device_graph_rooted_at_a_session_row_is_the_not_found_404(
        self, mc: MemoryClient
    ) -> None:
        corpus = _Corpus(mc)
        resp = _graph(_as(mc, "device"), corpus.session)
        assert resp.status_code == 404
        assert resp.json() == _NOT_FOUND_GRAPH
        assert _graph(mc, str(uuid4())).json() == resp.json()

    def test_device_graph_rooted_at_a_tenant_row_is_unchanged(
        self, mc: MemoryClient
    ) -> None:
        corpus = _Corpus(mc)
        resp = _graph(_as(mc, "device"), corpus.beyond)
        assert resp.status_code == 200, resp.text
        assert {n["memory_id"] for n in resp.json()["nodes"]} == {corpus.beyond}

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_walk_is_unchanged(self, mc: MemoryClient, actor: str) -> None:
        corpus = _Corpus(mc)
        resp = _graph(_as(mc, actor), corpus.tenant)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert {n["memory_id"] for n in body["nodes"]} == {
            corpus.tenant,
            corpus.session,
            corpus.beyond,
        }
        assert {(e["source_id"], e["target_id"]) for e in body["edges"]} == {
            (corpus.tenant, corpus.session),
            (corpus.session, corpus.beyond),
        }


# ---------------------------------------------------------------------------
# POST /query
# ---------------------------------------------------------------------------


class TestQuery:
    @pytest.mark.parametrize("scopes", [["session"], ["tenant", "session"]])
    def test_device_query_naming_session_scope_is_refused(
        self, mc: MemoryClient, scopes: list[str]
    ) -> None:
        _Corpus(mc)
        resp = _as(mc, "device").client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "wombat note",
                "scopes": scopes,
                "scope_ref": _SESSION_REF,
            },
        )
        assert resp.status_code == 403, resp.text
        detail = resp.json()["detail"]
        assert "coord" in detail
        assert "'tenant'" in detail

    def test_device_query_over_tenant_scope_is_unchanged(
        self, mc: MemoryClient
    ) -> None:
        corpus = _Corpus(mc)
        resp = _as(mc, "device").client.post(
            "/api/v1/memory/query", json={"query_text": "wombat"}
        )
        assert resp.status_code == 200, resp.text
        assert {h["memory_id"] for h in resp.json()["hits"]} == {
            corpus.tenant,
            corpus.beyond,
        }

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_query_of_the_session_partition_is_unchanged(
        self, mc: MemoryClient, actor: str
    ) -> None:
        corpus = _Corpus(mc)
        resp = _as(mc, actor).client.post(
            "/api/v1/memory/query",
            json={
                "query_text": "wombat note private",
                "scopes": ["session"],
                "scope_ref": _SESSION_REF,
            },
        )
        assert resp.status_code == 200, resp.text
        assert [h["memory_id"] for h in resp.json()["hits"]] == [corpus.session]


# ---------------------------------------------------------------------------
# POST /records
# ---------------------------------------------------------------------------


class TestWrite:
    def test_device_write_of_a_session_record_is_refused_and_writes_nothing(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        before = _live_rows(memory_engine)
        resp = _as(mc, "device").client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    # A tenant record in the SAME batch is not written either:
                    # the refusal is per request, before anything lands.
                    _record("a shared fact riding along"),
                    _record(
                        "an injected note for a peer session",
                        scope="session",
                        scope_ref=_SESSION_REF,
                    ),
                ]
            },
        )
        assert resp.status_code == 403, resp.text
        assert _live_rows(memory_engine) == before

    def test_device_write_of_tenant_and_agent_records_is_unchanged(
        self, mc: MemoryClient
    ) -> None:
        _as(mc, "device")
        _write(mc, "a device writes a shared fact")
        _write(mc, "a device writes an agent note", scope="agent", scope_ref="a-1")

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_write_of_a_session_record_is_unchanged(
        self, mc: MemoryClient, memory_engine: AsyncEngine, actor: str
    ) -> None:
        memory_id = _write(
            _as(mc, actor),
            f"a {actor} writes a session note",
            scope="session",
            scope_ref=_SESSION_REF,
        )
        assert (
            _scalar(
                memory_engine,
                "SELECT scope FROM coord.memory_records "
                "WHERE memory_id = CAST(:m AS uuid)",
                m=memory_id,
            )
            == "session"
        )


# ---------------------------------------------------------------------------
# POST /records/{id}/supersede
# ---------------------------------------------------------------------------


class TestSupersede:
    def test_device_supersede_of_a_session_row_by_inheritance_is_refused(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        """The inheritance hole: no ``scope`` in the payload, so the successor
        would take the predecessor's ``session`` scope and ``scope_ref`` and
        land in the peer's partition."""
        corpus = _Corpus(mc)
        before = _live_rows(memory_engine)
        resp = _as(mc, "device").client.post(
            f"/api/v1/memory/records/{corpus.session}/supersede",
            json={"title": "hijack", "content": "an injected successor"},
        )
        assert resp.status_code == 403, resp.text
        assert _live_rows(memory_engine) == before
        assert _successor_of(memory_engine, corpus.session) is None

    def test_device_supersede_of_a_session_row_into_tenant_is_refused(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        """Naming a non-session scope does not make a session predecessor
        the device's to end."""
        corpus = _Corpus(mc)
        resp = _as(mc, "device").client.post(
            f"/api/v1/memory/records/{corpus.session}/supersede",
            json={
                "title": "moved",
                "content": "a successor moved out of the partition",
                "scope": "tenant",
            },
        )
        assert resp.status_code == 403, resp.text
        assert _successor_of(memory_engine, corpus.session) is None

    def test_device_supersede_naming_session_scope_is_refused(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        resp = _as(mc, "device").client.post(
            f"/api/v1/memory/records/{corpus.tenant}/supersede",
            json={
                "title": "into a partition",
                "content": "a successor written into a session partition",
                "scope": "session",
                "scope_ref": _SESSION_REF,
            },
        )
        assert resp.status_code == 403, resp.text
        assert _successor_of(memory_engine, corpus.tenant) is None

    def test_device_supersede_of_a_tenant_row_is_unchanged(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        resp = _as(mc, "device").client.post(
            f"/api/v1/memory/records/{corpus.tenant}/supersede",
            json={"title": "corrected", "content": "the corrected shared fact"},
        )
        assert resp.status_code == 200, resp.text
        new_id = resp.json()["memory_id"]
        assert str(_successor_of(memory_engine, corpus.tenant)) == new_id

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_supersede_of_a_session_row_inherits_as_before(
        self, mc: MemoryClient, memory_engine: AsyncEngine, actor: str
    ) -> None:
        corpus = _Corpus(mc)
        resp = _as(mc, actor).client.post(
            f"/api/v1/memory/records/{corpus.session}/supersede",
            json={"title": "revised", "content": f"the {actor} revised session note"},
        )
        assert resp.status_code == 200, resp.text
        new_id = resp.json()["memory_id"]
        assert str(_successor_of(memory_engine, corpus.session)) == new_id
        got = mc.client.get(f"/api/v1/memory/records/{new_id}").json()
        assert got["scope"] == "session"
        assert got["scope_ref"] == _SESSION_REF


# ---------------------------------------------------------------------------
# GET /stats — the facets describe the corpus this principal can retrieve
# ---------------------------------------------------------------------------


def _stats_facets(mc: MemoryClient) -> dict[str, Any]:
    resp = mc.client.get("/api/v1/memory/stats")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["corpus_complete"] is True, body
    facets: dict[str, Any] = body["facets"]
    return facets


class TestStats:
    def test_device_facets_exclude_session_counts_and_titles(
        self, mc: MemoryClient
    ) -> None:
        _Corpus(mc)
        facets = _stats_facets(_as(mc, "device"))
        # The bucket stays (the contract is exhaustive) and reads 0: the
        # device can retrieve no session row.
        assert facets["by_scope"]["session"] == 0
        assert facets["by_scope"]["tenant"] == 2
        assert facets["by_scope"]["agent"] == 1
        assert facets["live_row_count"] == 3
        assert sum(facets["by_scope"].values()) == facets["live_row_count"]
        assert sum(facets["by_kind"].values()) == facets["live_row_count"]
        assert "the private session title" not in facets["recent_titles"]
        assert "the shared tenant title" in facets["recent_titles"]

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_facets_are_unchanged(self, mc: MemoryClient, actor: str) -> None:
        _Corpus(mc)
        facets = _stats_facets(_as(mc, actor))
        assert facets["by_scope"]["session"] == 1
        assert facets["live_row_count"] == 4
        assert "the private session title" in facets["recent_titles"]

    def test_device_query_denominator_matches_its_facets(
        self, mc: MemoryClient
    ) -> None:
        """``live_row_count`` on ``POST /query`` is documented as the number
        ``/stats`` publishes; for a device both must drop the same rows."""
        _Corpus(mc)
        _as(mc, "device")
        resp = mc.client.post("/api/v1/memory/query", json={"query_text": "wombat"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["live_row_count"] == 3
        assert resp.json()["live_row_count"] == _stats_facets(mc)["live_row_count"]


# ---------------------------------------------------------------------------
# PUT / DELETE /records/{id}/hold and DELETE /records/{id}
# ---------------------------------------------------------------------------


def _hold_value(engine: AsyncEngine, memory_id: str) -> Any:
    return _scalar(
        engine,
        "SELECT source->>'lifecycle_hold' FROM coord.memory_records "
        "WHERE memory_id = CAST(:m AS uuid)",
        m=memory_id,
    )


def _is_tombstone(engine: AsyncEngine, memory_id: str) -> Any:
    return _scalar(
        engine,
        "SELECT is_tombstone FROM coord.memory_records "
        "WHERE memory_id = CAST(:m AS uuid)",
        m=memory_id,
    )


class TestHoldAndDelete:
    @pytest.mark.parametrize(
        ("method", "suffix"),
        [("put", "/hold"), ("delete", "/hold"), ("delete", "")],
    )
    def test_device_on_a_session_row_is_the_not_found_404_and_writes_nothing(
        self,
        mc: MemoryClient,
        memory_engine: AsyncEngine,
        method: str,
        suffix: str,
    ) -> None:
        corpus = _Corpus(mc)
        _as(mc, "device")
        call = getattr(mc.client, method)
        resp = call(f"/api/v1/memory/records/{corpus.session}{suffix}")
        assert resp.status_code == 404
        assert resp.json() == _NOT_FOUND_BY_ID
        unknown = call(f"/api/v1/memory/records/{uuid4()}{suffix}")
        assert unknown.status_code == 404
        assert unknown.json() == resp.json()
        assert _hold_value(memory_engine, corpus.session) is None
        assert _is_tombstone(memory_engine, corpus.session) is False

    def test_device_hold_and_delete_of_a_tenant_row_are_unchanged(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        _as(mc, "device")
        held = mc.client.put(f"/api/v1/memory/records/{corpus.tenant}/hold")
        assert held.status_code == 200, held.text
        assert _hold_value(memory_engine, corpus.tenant) == "true"
        released = mc.client.delete(f"/api/v1/memory/records/{corpus.tenant}/hold")
        assert released.status_code == 200, released.text
        assert _hold_value(memory_engine, corpus.tenant) == "false"
        deleted = mc.client.delete(f"/api/v1/memory/records/{corpus.tenant}")
        assert deleted.status_code == 204, deleted.text
        assert _is_tombstone(memory_engine, corpus.tenant) is True

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_hold_and_delete_of_a_session_row_are_unchanged(
        self, mc: MemoryClient, memory_engine: AsyncEngine, actor: str
    ) -> None:
        corpus = _Corpus(mc)
        _as(mc, actor)
        held = mc.client.put(f"/api/v1/memory/records/{corpus.session}/hold")
        assert held.status_code == 200, held.text
        assert _hold_value(memory_engine, corpus.session) == "true"
        deleted = mc.client.delete(f"/api/v1/memory/records/{corpus.session}")
        assert deleted.status_code == 204, deleted.text
        assert _is_tombstone(memory_engine, corpus.session) is True


# ---------------------------------------------------------------------------
# Content dedupe — never onto a withheld row
# ---------------------------------------------------------------------------

_SESSION_CONTENT = "the wombat note private to one session"
_ANCHOR = {
    "type": "blob",
    "repo": "qontinui-web",
    "path": "backend/app/services/memory_store.py",
    "sha": "c" * 40,
}


def _anchors_of(engine: AsyncEngine, memory_id: str) -> Any:
    return _scalar(
        engine,
        "SELECT anchors::text FROM coord.memory_records "
        "WHERE memory_id = CAST(:m AS uuid)",
        m=memory_id,
    )


class TestContentDedupe:
    """``uq_memory_records_tenant_content_hash_live`` is UNIQUE on
    ``(tenant_id, content_hash)`` over live rows, with no scope column, so a
    device cannot get a second live row holding a session row's content. It
    gets a 409 that names no id, with nothing written and no anchor merged."""

    @pytest.mark.parametrize("anchors", [[], [_ANCHOR]])
    def test_device_write_of_session_content_is_a_409_without_the_id(
        self, mc: MemoryClient, memory_engine: AsyncEngine, anchors: list[Any]
    ) -> None:
        corpus = _Corpus(mc)
        before_rows = _live_rows(memory_engine)
        before_anchors = _anchors_of(memory_engine, corpus.session)
        resp = _as(mc, "device").client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("a shared fact written in the same batch"),
                    _record(_SESSION_CONTENT, anchors=anchors),
                ]
            },
        )
        assert resp.status_code == 409, resp.text
        assert corpus.session not in resp.text
        assert _live_rows(memory_engine) == before_rows
        assert _anchors_of(memory_engine, corpus.session) == before_anchors

    def test_device_supersede_into_session_content_is_a_409(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        resp = _as(mc, "device").client.post(
            f"/api/v1/memory/records/{corpus.tenant}/supersede",
            json={"title": "collide", "content": _SESSION_CONTENT},
        )
        assert resp.status_code == 409, resp.text
        assert corpus.session not in resp.text
        assert _successor_of(memory_engine, corpus.tenant) is None

    def test_device_dedupe_onto_a_tenant_row_is_unchanged(
        self, mc: MemoryClient
    ) -> None:
        corpus = _Corpus(mc)
        resp = _as(mc, "device").client.post(
            "/api/v1/memory/records",
            json={"records": [_record("the shared wombat fact every principal sees")]},
        )
        assert resp.status_code == 200, resp.text
        (rec,) = resp.json()["records"]
        assert rec == {"memory_id": corpus.tenant, "deduped": True}

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_dedupe_onto_a_session_row_is_unchanged(
        self, mc: MemoryClient, memory_engine: AsyncEngine, actor: str
    ) -> None:
        corpus = _Corpus(mc)
        resp = _as(mc, actor).client.post(
            "/api/v1/memory/records",
            json={"records": [_record(_SESSION_CONTENT, anchors=[_ANCHOR])]},
        )
        assert resp.status_code == 200, resp.text
        (rec,) = resp.json()["records"]
        assert rec == {"memory_id": corpus.session, "deduped": True}
        assert "c" * 40 in _anchors_of(memory_engine, corpus.session)
