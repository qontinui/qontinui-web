"""The ``agent`` memory partition is clamped to the verified device at this door.

Plan ``2026-11-04-web-memory-agent-scope-accepts-any-device-scope-ref`` Phase 1.
A ``scope='agent'`` row is a PRIVATE per-device partition whose only
enforcement is an exact ``scope_ref`` match, and the partition key is the
device id — which is not secret. So a device-JWT principal (``actor="device"``)
reaches only the agent rows keyed on its OWN verified ``device_id``:

* ``GET /records``, ``POST /graph`` and ``GET /stats`` leave another device's
  agent rows out (and the graph walk never steps onto one);
* ``GET /records/{id}``, ``PUT``/``DELETE /records/{id}/hold`` and
  ``DELETE /records/{id}`` answer the by-id not-found 404 for one, and write
  nothing; ``POST /records/{id}/supersede`` answers one as a predecessor the
  same way;
* ``POST /query``, ``POST /records`` and ``POST /records/{id}/supersede``
  refuse a FOREIGN agent ``scope_ref`` with 403 ``memory_agent_scope_foreign``
  and resolve an OMITTED one to the caller's own device id;
* a write whose content another device's agent row already holds is a 409
  naming no id; a link to such a row drops; a job targeting one is never
  handed to the device;
* a principal with no device id owns no agent partition: it sees no agent
  row (a NULL-ref one included) and may write none;
* synthesis never clusters an agent row, and reindex never puts two
  partitions' rows in one embedding job.

The coord service token and an operator user see every device's agent rows,
and ``tenant`` rows are unchanged for every principal.

Device A is the shared ``MemoryClient``'s fixture device; device B is a second
device principal in the same tenant (its FK provenance degrades through
``_write_degrading_dangling_provenance``, which is expected). Every route
assertion runs through the real router; SKIPS when the test PostgreSQL (or
pgvector) is unreachable, the same posture as ``test_memory_api_db``.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Generator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.v1.endpoints.memory import (
    MemoryPrincipal,
    _require_agent_scope_ref,
    _resolve_agent_scope_ref,
    scope_visibility,
)
from app.core.refusal import NextActionKind, RefusalCode, RefusalHTTPException
from app.jobs.memory_lifecycle import reindex_once
from app.services import memory_store as store
from tests.conftest import TEST_DATABASE_URL
from tests.test_memory_api_db import (
    _FIXTURE_DEVICE_ID,
    _FIXTURE_USER_ID,
    _SETUP_SQL,
    MemoryClient,
    _exec,
    _record,
    _scalar,
)
from tests.test_memory_session_partition_db import (
    _ANCHOR,
    _anchors_of,
    _graph,
    _hold_value,
    _is_tombstone,
    _job_status,
    _link_rows,
    _listed,
    _live_rows,
    _result_for,
    _run,
    _seed_job,
    _seed_row,
    _successor_of,
    _write,
)

_NOT_FOUND_BY_ID = {"detail": "memory record not found in your tenant"}

_DEVICE_B_ID = UUID("33333333-3333-4333-8333-333333333333")
_A_REF = str(_FIXTURE_DEVICE_ID)
_B_REF = str(_DEVICE_B_ID)
# A device id with hex LETTERS: A's and B's ids are all digits, so their
# upper-cased forms are identical and could not exercise case handling.
_DEVICE_C_ID = UUID("abcdef00-0000-4000-8000-0000000000ab")
_C_REF = str(_DEVICE_C_ID)

_A_CONTENT = "the heron note private to device A"
_B_CONTENT = "the heron note private to device B"
_B_TITLE = "the device B agent title"


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


def _principal(
    mc: MemoryClient, *, actor: str = "device", device_id: UUID | None
) -> MemoryPrincipal:
    return MemoryPrincipal(
        tenant_id=mc.tenant_id,
        device_id=device_id,
        actor=actor,
        user_id=_FIXTURE_USER_ID,
    )


def _as_a(mc: MemoryClient) -> MemoryClient:
    return mc.as_principal(_principal(mc, device_id=_FIXTURE_DEVICE_ID))


def _as_b(mc: MemoryClient) -> MemoryClient:
    return mc.as_principal(_principal(mc, device_id=_DEVICE_B_ID))


def _as_c(mc: MemoryClient) -> MemoryClient:
    return mc.as_principal(_principal(mc, device_id=_DEVICE_C_ID))


def _as_no_device(mc: MemoryClient) -> MemoryClient:
    return mc.as_principal(_principal(mc, device_id=None))


def _as_admitted(mc: MemoryClient, actor: str) -> MemoryClient:
    return mc.as_principal(_principal(mc, actor=actor, device_id=_FIXTURE_DEVICE_ID))


class _Corpus:
    """Device A's agent row, device B's agent row, and a tenant row linking to
    both. A and B each write their OWN row through the door (an omitted ref
    resolves to the writer's device id); the tenant row is written by the coord
    service, the principal that may link into any partition."""

    def __init__(self, mc: MemoryClient) -> None:
        self.a = _write(
            _as_a(mc), _A_CONTENT, title="the device A agent title", scope="agent"
        )
        self.b = _write(_as_b(mc), _B_CONTENT, title=_B_TITLE, scope="agent")
        self.tenant = _write(
            _as_admitted(mc, "coord_service"),
            "the shared heron fact every principal sees",
            title="the shared heron title",
            links=[
                {"target_ref": self.a, "relation": "related"},
                {"target_ref": self.b, "relation": "related"},
            ],
        )
        _as_a(mc)


def _scope_ref_of(engine: AsyncEngine, memory_id: str) -> Any:
    return _scalar(
        engine,
        "SELECT scope_ref FROM coord.memory_records WHERE memory_id = CAST(:m AS uuid)",
        m=memory_id,
    )


def _query(mc: MemoryClient, **body: Any) -> Any:
    return mc.client.post(
        "/api/v1/memory/query", json={"query_text": "heron note", **body}
    )


def _facets(mc: MemoryClient) -> dict[str, Any]:
    resp = mc.client.get("/api/v1/memory/stats")
    assert resp.status_code == 200, resp.text
    facets: dict[str, Any] = resp.json()["facets"]
    return facets


def _assert_agent_foreign_403(resp: Any) -> None:
    assert resp.status_code == 403, resp.text
    assert "private per-device partition" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# The predicate and the refusal envelope
# ---------------------------------------------------------------------------


class TestScopeVisibility:
    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_principals_are_not_clamped(self, actor: str) -> None:
        visibility = scope_visibility(
            MemoryPrincipal(tenant_id=uuid4(), device_id=_DEVICE_B_ID, actor=actor)
        )
        assert visibility == store.UNRESTRICTED
        assert not visibility.hides("agent", _A_REF)

    @pytest.mark.parametrize("actor", ["device", "ci", "", "OPERATOR"])
    def test_every_other_actor_is_clamped_to_its_lower_cased_device(
        self, actor: str
    ) -> None:
        device = UUID("ABCDEF00-0000-4000-8000-000000000000")
        visibility = scope_visibility(
            MemoryPrincipal(tenant_id=uuid4(), device_id=device, actor=actor)
        )
        assert visibility.clamp_agent is True
        assert visibility.own_agent_ref == str(device).lower()
        assert visibility.exclude_scopes == frozenset({"session"})
        assert not visibility.hides("agent", str(device).upper())
        assert visibility.hides("agent", _B_REF)
        assert visibility.hides("agent", None)
        assert not visibility.hides("tenant", None)

    def test_a_principal_with_no_device_owns_no_agent_partition(self) -> None:
        visibility = scope_visibility(
            MemoryPrincipal(tenant_id=uuid4(), device_id=None, actor="device")
        )
        assert visibility.clamp_agent is True
        assert visibility.own_agent_ref is None
        assert visibility.hides("agent", None)
        assert visibility.hides("agent", _A_REF)

    def test_a_foreign_agent_ref_is_a_typed_permission_refusal(self) -> None:
        principal = MemoryPrincipal(
            tenant_id=uuid4(), device_id=_FIXTURE_DEVICE_ID, actor="device"
        )
        with pytest.raises(RefusalHTTPException) as caught:
            _resolve_agent_scope_ref(
                principal, scope_visibility(principal), "agent", _B_REF
            )
        exc = caught.value
        assert exc.status_code == 403
        assert exc.refusal.code is RefusalCode.permission_denied
        assert exc.refusal.next_action.kind is NextActionKind.fix_request
        assert exc.refusal.discriminator == "memory_agent_scope_foreign"
        assert _A_REF in str(exc.detail)

    def test_no_device_agent_ref_is_the_same_refusal(self) -> None:
        principal = MemoryPrincipal(tenant_id=uuid4(), device_id=None, actor="device")
        with pytest.raises(RefusalHTTPException) as caught:
            _resolve_agent_scope_ref(
                principal, scope_visibility(principal), "agent", None
            )
        assert caught.value.refusal.discriminator == "memory_agent_scope_foreign"

    def test_omitted_and_own_refs_resolve_to_the_canonical_own_ref(self) -> None:
        principal = MemoryPrincipal(
            tenant_id=uuid4(), device_id=_DEVICE_C_ID, actor="device"
        )
        visibility = scope_visibility(principal)
        for given in (None, _C_REF, _C_REF.upper()):
            assert (
                _resolve_agent_scope_ref(principal, visibility, "agent", given)
                == _C_REF
            )
        # Non-agent scopes pass through untouched.
        assert _resolve_agent_scope_ref(principal, visibility, "tenant", "x") == "x"


# ---------------------------------------------------------------------------
# Device A's OWN agent partition — every route reaches it
# ---------------------------------------------------------------------------


class TestOwnAgentPartition:
    def test_an_omitted_ref_is_written_into_the_callers_own_partition(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        assert _scope_ref_of(memory_engine, corpus.a) == _A_REF
        assert _scope_ref_of(memory_engine, corpus.b) == _B_REF

    def test_own_row_is_listed_by_id_and_in_the_graph(self, mc: MemoryClient) -> None:
        corpus = _Corpus(mc)
        listed = _listed(mc)
        assert corpus.a in listed
        assert [link["target_id"] for link in listed[corpus.tenant]["links"]] == [
            corpus.a
        ]
        by_id = mc.client.get(f"/api/v1/memory/records/{corpus.a}")
        assert by_id.status_code == 200, by_id.text
        assert by_id.json()["scope_ref"] == _A_REF
        graph = _graph(mc, corpus.tenant)
        assert graph.status_code == 200, graph.text
        assert {n["memory_id"] for n in graph.json()["nodes"]} == {
            corpus.tenant,
            corpus.a,
        }
        assert _graph(mc, corpus.a).status_code == 200

    def test_query_with_no_ref_resolves_to_the_callers_own(
        self, mc: MemoryClient
    ) -> None:
        corpus = _Corpus(mc)
        resp = _query(mc, scopes=["agent"])
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [h["memory_id"] for h in body["hits"]] == [corpus.a]
        assert body["query_echo"]["scope_ref"] == _A_REF

    def test_query_naming_its_own_ref_returns_its_row(self, mc: MemoryClient) -> None:
        corpus = _Corpus(mc)
        resp = _query(mc, scopes=["tenant", "agent"], scope_ref=_A_REF)
        assert resp.status_code == 200, resp.text
        assert corpus.a in {h["memory_id"] for h in resp.json()["hits"]}
        assert corpus.b not in resp.text

    def test_own_row_can_be_superseded_held_and_deleted(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        held = mc.client.put(f"/api/v1/memory/records/{corpus.a}/hold")
        assert held.status_code == 200, held.text
        assert _hold_value(memory_engine, corpus.a) == "true"
        released = mc.client.delete(f"/api/v1/memory/records/{corpus.a}/hold")
        assert released.status_code == 200, released.text
        resp = mc.client.post(
            f"/api/v1/memory/records/{corpus.a}/supersede",
            json={"title": "revised", "content": "the revised device A heron note"},
        )
        assert resp.status_code == 200, resp.text
        new_id = resp.json()["memory_id"]
        assert str(_successor_of(memory_engine, corpus.a)) == new_id
        assert _scope_ref_of(memory_engine, new_id) == _A_REF
        deleted = mc.client.delete(f"/api/v1/memory/records/{new_id}")
        assert deleted.status_code == 204, deleted.text
        assert _is_tombstone(memory_engine, new_id) is True

    def test_supersede_of_a_tenant_row_into_agent_with_no_ref_lands_in_its_own(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        """The NULL-ref hole: ``scope='agent'`` with no ``scope_ref`` on a
        tenant predecessor would inherit its NULL ref."""
        corpus = _Corpus(mc)
        resp = mc.client.post(
            f"/api/v1/memory/records/{corpus.tenant}/supersede",
            json={"title": "moved", "content": "moved into my agent", "scope": "agent"},
        )
        assert resp.status_code == 200, resp.text
        assert _scope_ref_of(memory_engine, resp.json()["memory_id"]) == _A_REF


# ---------------------------------------------------------------------------
# Device B's agent row, as seen by device A
# ---------------------------------------------------------------------------


class TestForeignAgentRowIsHidden:
    def test_list_omits_it_and_links_into_it(self, mc: MemoryClient) -> None:
        corpus = _Corpus(mc)
        listed = _listed(mc)
        assert corpus.b not in listed
        assert set(listed) == {corpus.a, corpus.tenant}
        assert corpus.b not in str(listed[corpus.tenant]["links"])

    def test_by_id_is_the_unknown_id_404(self, mc: MemoryClient) -> None:
        corpus = _Corpus(mc)
        resp = mc.client.get(f"/api/v1/memory/records/{corpus.b}")
        assert resp.status_code == 404
        assert resp.json() == _NOT_FOUND_BY_ID
        unknown = mc.client.get(f"/api/v1/memory/records/{uuid4()}")
        assert unknown.status_code == 404
        assert unknown.json() == resp.json()

    def test_graph_root_is_the_unknown_id_404_and_the_walk_skips_it(
        self, mc: MemoryClient
    ) -> None:
        corpus = _Corpus(mc)
        root = _graph(mc, corpus.b)
        assert root.status_code == 404
        assert root.json() == _NOT_FOUND_BY_ID
        assert _graph(mc, str(uuid4())).json() == root.json()
        walk = _graph(mc, corpus.tenant).json()
        assert corpus.b not in {n["memory_id"] for n in walk["nodes"]}
        assert corpus.b not in {e["target_id"] for e in walk["edges"]}

    @pytest.mark.parametrize(
        ("method", "suffix"),
        [("put", "/hold"), ("delete", "/hold"), ("delete", "")],
    )
    def test_hold_and_delete_are_the_404_and_write_nothing(
        self,
        mc: MemoryClient,
        memory_engine: AsyncEngine,
        method: str,
        suffix: str,
    ) -> None:
        corpus = _Corpus(mc)
        call = getattr(mc.client, method)
        resp = call(f"/api/v1/memory/records/{corpus.b}{suffix}")
        assert resp.status_code == 404
        assert resp.json() == _NOT_FOUND_BY_ID
        assert _hold_value(memory_engine, corpus.b) is None
        assert _is_tombstone(memory_engine, corpus.b) is False

    def test_by_id_never_names_a_successor_in_its_partition(
        self, mc: MemoryClient
    ) -> None:
        _as_b(mc)
        old = _write(mc, "a tenant fact device B moves into its partition")
        resp = mc.client.post(
            f"/api/v1/memory/records/{old}/supersede",
            json={"title": "mine", "content": "now private to B", "scope": "agent"},
        )
        assert resp.status_code == 200, resp.text
        new = resp.json()["memory_id"]
        body = _as_a(mc).client.get(f"/api/v1/memory/records/{old}").json()
        assert body["state"] == "superseded"
        assert body["superseded_by"] is None
        assert new not in str(body)

    def test_stats_count_only_the_callers_own_agent_rows(
        self, mc: MemoryClient
    ) -> None:
        _Corpus(mc)
        facets = _facets(mc)
        assert facets["by_scope"]["agent"] == 1
        assert facets["by_scope"]["tenant"] == 1
        assert facets["live_row_count"] == 2
        assert _B_TITLE not in facets["recent_titles"]
        query = _query(mc)
        assert query.json()["live_row_count"] == facets["live_row_count"]


class TestForeignAgentRefIsRefused:
    @pytest.mark.parametrize("scopes", [["agent"], ["tenant", "agent"]])
    def test_query_naming_it_is_a_403(
        self, mc: MemoryClient, scopes: list[str]
    ) -> None:
        _Corpus(mc)
        _assert_agent_foreign_403(_query(mc, scopes=scopes, scope_ref=_B_REF))

    def test_write_naming_it_is_a_403_and_writes_nothing(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        _Corpus(mc)
        before = _live_rows(memory_engine)
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("a shared fact riding along"),
                    _record(
                        "an injected note for device B",
                        scope="agent",
                        scope_ref=_B_REF,
                    ),
                ]
            },
        )
        _assert_agent_foreign_403(resp)
        assert _live_rows(memory_engine) == before

    def test_supersede_of_its_row_is_the_unknown_id_404(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        for body in (
            {"title": "hijack", "content": "an injected successor"},
            {"title": "moved", "content": "moved out of B", "scope": "tenant"},
        ):
            resp = mc.client.post(
                f"/api/v1/memory/records/{corpus.b}/supersede", json=body
            )
            assert resp.status_code == 404, resp.text
            assert resp.json() == _NOT_FOUND_BY_ID
        assert _successor_of(memory_engine, corpus.b) is None

    def test_supersede_of_its_own_row_naming_it_with_scope_omitted_is_a_403(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        """The inheritance hole: ``scope`` omitted inherits ``agent`` from the
        caller's own row while the payload names another device's ref."""
        corpus = _Corpus(mc)
        before = _live_rows(memory_engine)
        resp = mc.client.post(
            f"/api/v1/memory/records/{corpus.a}/supersede",
            json={
                "title": "smuggled",
                "content": "a successor planted in device B",
                "scope_ref": _B_REF,
            },
        )
        _assert_agent_foreign_403(resp)
        assert _successor_of(memory_engine, corpus.a) is None
        assert _live_rows(memory_engine) == before

    def test_supersede_of_a_tenant_row_into_it_is_a_403(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        resp = mc.client.post(
            f"/api/v1/memory/records/{corpus.tenant}/supersede",
            json={
                "title": "smuggled",
                "content": "a tenant fact pushed into device B",
                "scope": "agent",
                "scope_ref": _B_REF,
            },
        )
        _assert_agent_foreign_403(resp)
        assert _successor_of(memory_engine, corpus.tenant) is None


class TestForeignAgentRowSideChannels:
    @pytest.mark.parametrize("ref_form", ["memory_id", "content_hash", "title"])
    def test_a_link_to_it_drops(
        self, mc: MemoryClient, memory_engine: AsyncEngine, ref_form: str
    ) -> None:
        corpus = _Corpus(mc)
        target_ref = {
            "memory_id": corpus.b,
            "content_hash": hashlib.sha256(_B_CONTENT.encode()).hexdigest(),
            "title": _B_TITLE,
        }[ref_form]
        before = _link_rows(memory_engine)
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record(
                        "a device A fact that tries to link device B's row",
                        links=[{"target_ref": target_ref, "relation": "related"}],
                    )
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["dropped_links_count"] == 1
        assert _link_rows(memory_engine) == before

    @pytest.mark.parametrize("anchors", [[], [_ANCHOR]])
    def test_writing_its_content_is_a_409_without_the_id(
        self, mc: MemoryClient, memory_engine: AsyncEngine, anchors: list[Any]
    ) -> None:
        corpus = _Corpus(mc)
        before_rows = _live_rows(memory_engine)
        before_anchors = _anchors_of(memory_engine, corpus.b)
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record(_B_CONTENT, anchors=anchors)]},
        )
        assert resp.status_code == 409, resp.text
        assert corpus.b not in resp.text
        assert _live_rows(memory_engine) == before_rows
        assert _anchors_of(memory_engine, corpus.b) == before_anchors

    def test_superseding_into_its_content_is_a_409(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        resp = mc.client.post(
            f"/api/v1/memory/records/{corpus.tenant}/supersede",
            json={"title": "collide", "content": _B_CONTENT},
        )
        assert resp.status_code == 409, resp.text
        assert corpus.b not in resp.text
        assert _successor_of(memory_engine, corpus.tenant) is None

    @pytest.mark.parametrize("kind", ["embedding", "synthesis"])
    def test_a_job_targeting_it_is_never_claimed(
        self, mc: MemoryClient, memory_engine: AsyncEngine, kind: str
    ) -> None:
        corpus = _Corpus(mc)
        foreign = _seed_job(
            memory_engine, mc.tenant_id, kind, [corpus.tenant, corpus.b]
        )
        resp = mc.client.post(
            "/api/v1/memory/jobs/claim", json={"limit": 4, "kinds": [kind]}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["jobs"] == []
        assert _job_status(memory_engine, foreign) == "pending"
        # Positive control: device B, whose row it is, claims it.
        claimed = _as_b(mc).client.post(
            "/api/v1/memory/jobs/claim", json={"limit": 4, "kinds": [kind]}
        )
        assert [j["job_id"] for j in claimed.json()["jobs"]] == [foreign]

    def test_a_job_targeting_its_own_row_is_claimed(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        own = _seed_job(memory_engine, mc.tenant_id, "embedding", [corpus.a])
        resp = mc.client.post(
            "/api/v1/memory/jobs/claim", json={"limit": 4, "kinds": ["embedding"]}
        )
        assert [j["job_id"] for j in resp.json()["jobs"]] == [own]

    def test_a_result_onto_its_job_is_the_unknown_job_404(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        job_id = _seed_job(memory_engine, mc.tenant_id, "embedding", [corpus.b])
        claimed = _as_b(mc).client.post(
            "/api/v1/memory/jobs/claim", json={"limit": 4, "kinds": ["embedding"]}
        )
        assert [j["job_id"] for j in claimed.json()["jobs"]] == [job_id]
        resp = _as_a(mc).client.post(
            f"/api/v1/memory/jobs/{job_id}/result", json=_result_for("embedding", 1)
        )
        assert resp.status_code == 404, resp.text
        assert _job_status(memory_engine, job_id) == "claimed"


# ---------------------------------------------------------------------------
# Letter case, a principal with no device, and the admitted principals
# ---------------------------------------------------------------------------


class TestUpperCasedOwnRef:
    """Device C's id carries hex LETTERS, so its upper-cased form really
    differs (the fixture devices' ids are all digits, where it would not)."""

    def test_the_lettered_device_id_differs_when_upper_cased(self) -> None:
        assert _C_REF.upper() != _C_REF

    def test_a_row_keyed_on_the_upper_cased_own_ref_is_the_callers(
        self, mc: MemoryClient
    ) -> None:
        upper = _write(
            _as_admitted(mc, "coord_service"),
            "a heron note keyed on the upper-cased device id",
            scope="agent",
            scope_ref=_C_REF.upper(),
        )
        _as_c(mc)
        assert upper in _listed(mc)
        assert mc.client.get(f"/api/v1/memory/records/{upper}").status_code == 200
        # ...and the query door finds it too: the device's query ref resolves
        # to its LOWER-cased id, so the retrieval arms must match the agent
        # arm case-insensitively, as the visibility predicate does.
        for ref in (None, _C_REF, _C_REF.upper()):
            body = {"scopes": ["agent"]} | ({"scope_ref": ref} if ref else {})
            resp = _query(mc, **body)
            assert resp.status_code == 200, resp.text
            assert [h["memory_id"] for h in resp.json()["hits"]] == [upper]

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_query_matches_the_agent_ref_case_insensitively(
        self, mc: MemoryClient, actor: str
    ) -> None:
        """An admitted principal's ref is passed through verbatim; the agent
        arm's ``lower()`` on both sides widens its match on letter case only."""
        own = _write(_as_c(mc), "a heron note device C owns", scope="agent")
        _as_admitted(mc, actor)
        for ref in (_C_REF, _C_REF.upper()):
            resp = _query(mc, scopes=["agent"], scope_ref=ref)
            assert resp.status_code == 200, resp.text
            assert [h["memory_id"] for h in resp.json()["hits"]] == [own]
        # Case is the ONLY widening: another device's ref still misses.
        resp = _query(mc, scopes=["agent"], scope_ref=_B_REF)
        assert resp.json()["hits"] == []

    def test_writing_and_querying_the_upper_cased_own_ref_is_admitted(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        _as_c(mc)
        memory_id = _write(
            mc,
            "a heron note written upper-cased",
            scope="agent",
            scope_ref=_C_REF.upper(),
        )
        # Stored under the canonical lower-cased ref.
        assert _scope_ref_of(memory_engine, memory_id) == _C_REF
        resp = _query(mc, scopes=["agent"], scope_ref=_C_REF.upper())
        assert resp.status_code == 200, resp.text
        assert resp.json()["query_echo"]["scope_ref"] == _C_REF
        assert [h["memory_id"] for h in resp.json()["hits"]] == [memory_id]


class TestAgentScopeRefIsRequired:
    """A NULL or blank agent ``scope_ref`` is refused for EVERY principal on
    write and on the supersede resolved pair: such a row is visible to no
    device, and its reindex job (partition ``agent:``) is claimable by none.
    Mirrors coord's ``(None, None)`` arm of ``clamp_private_scope_ref``."""

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    @pytest.mark.parametrize("ref", [None, "", "   "])
    def test_admitted_agent_write_with_no_ref_is_a_422_and_writes_nothing(
        self,
        mc: MemoryClient,
        memory_engine: AsyncEngine,
        actor: str,
        ref: str | None,
    ) -> None:
        _as_admitted(mc, actor)
        before = _live_rows(memory_engine)
        extra = {} if ref is None else {"scope_ref": ref}
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    _record("a shared fact riding along"),
                    _record("an agent note with no owner", scope="agent", **extra),
                ]
            },
        )
        assert resp.status_code == 422, resp.text
        assert "requires a non-empty scope_ref" in resp.json()["detail"]
        assert _live_rows(memory_engine) == before

    def test_a_device_omitting_the_ref_still_writes_into_its_own(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        memory_id = _write(_as_a(mc), "a device A note with no ref", scope="agent")
        assert _scope_ref_of(memory_engine, memory_id) == _A_REF

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_supersede_into_agent_with_no_ref_is_a_422(
        self, mc: MemoryClient, memory_engine: AsyncEngine, actor: str
    ) -> None:
        """The resolved pair: a tenant predecessor's NULL ref is inherited."""
        corpus = _Corpus(mc)
        resp = _as_admitted(mc, actor).client.post(
            f"/api/v1/memory/records/{corpus.tenant}/supersede",
            json={"title": "moved", "content": "moved into nobody", "scope": "agent"},
        )
        assert resp.status_code == 422, resp.text
        assert _successor_of(memory_engine, corpus.tenant) is None
        named = mc.client.post(
            f"/api/v1/memory/records/{corpus.tenant}/supersede",
            json={
                "title": "moved",
                "content": "moved into device B",
                "scope": "agent",
                "scope_ref": _B_REF,
            },
        )
        assert named.status_code == 200, named.text

    def test_the_refusal_is_typed(self) -> None:
        with pytest.raises(RefusalHTTPException) as caught:
            _require_agent_scope_ref("agent", None)
        exc = caught.value
        assert exc.status_code == 422
        assert exc.refusal.code is RefusalCode.invalid_request
        assert exc.refusal.discriminator == "memory_agent_scope_ref_required"
        _require_agent_scope_ref("tenant", None)
        _require_agent_scope_ref("agent", _A_REF)


class TestPrincipalWithNoDevice:
    def test_it_sees_no_agent_row_including_a_null_ref_one(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        corpus = _Corpus(mc)
        null_ref = str(
            _seed_row(memory_engine, mc.tenant_id, scope="agent", scope_ref=None)
        )
        _as_no_device(mc)
        listed = _listed(mc)
        assert set(listed) == {corpus.tenant}
        for memory_id in (corpus.a, corpus.b, null_ref):
            resp = mc.client.get(f"/api/v1/memory/records/{memory_id}")
            assert resp.status_code == 404
            assert resp.json() == _NOT_FOUND_BY_ID
        assert _facets(mc)["by_scope"]["agent"] == 0

    def test_its_agent_write_and_query_are_403(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        _as_no_device(mc)
        before = _live_rows(memory_engine)
        resp = mc.client.post(
            "/api/v1/memory/records",
            json={"records": [_record("an agent note with no owner", scope="agent")]},
        )
        assert resp.status_code == 403, resp.text
        assert _live_rows(memory_engine) == before
        assert _query(mc, scopes=["agent"]).status_code == 403

    def test_a_device_never_sees_a_null_ref_agent_row(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        null_ref = str(
            _seed_row(memory_engine, mc.tenant_id, scope="agent", scope_ref=None)
        )
        _as_a(mc)
        assert null_ref not in _listed(mc)
        assert mc.client.get(f"/api/v1/memory/records/{null_ref}").status_code == 404


class TestAdmittedPrincipalsAreUnchanged:
    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_principals_reach_every_devices_agent_rows(
        self, mc: MemoryClient, actor: str
    ) -> None:
        corpus = _Corpus(mc)
        _as_admitted(mc, actor)
        assert set(_listed(mc)) == {corpus.a, corpus.b, corpus.tenant}
        for memory_id in (corpus.a, corpus.b):
            resp = mc.client.get(f"/api/v1/memory/records/{memory_id}")
            assert resp.status_code == 200, resp.text
        for ref, expected in ((_A_REF, corpus.a), (_B_REF, corpus.b)):
            resp = _query(mc, scopes=["agent"], scope_ref=ref)
            assert resp.status_code == 200, resp.text
            assert [h["memory_id"] for h in resp.json()["hits"]] == [expected]
        assert _facets(mc)["by_scope"]["agent"] == 2
        walk = _graph(mc, corpus.tenant).json()
        assert {n["memory_id"] for n in walk["nodes"]} == {
            corpus.tenant,
            corpus.a,
            corpus.b,
        }

    @pytest.mark.parametrize("actor", ["coord_service", "operator"])
    def test_admitted_principals_may_name_any_agent_ref(
        self, mc: MemoryClient, memory_engine: AsyncEngine, actor: str
    ) -> None:
        memory_id = _write(
            _as_admitted(mc, actor),
            f"a {actor} writes into device B's partition",
            scope="agent",
            scope_ref=_B_REF,
        )
        assert _scope_ref_of(memory_engine, memory_id) == _B_REF


# ---------------------------------------------------------------------------
# Server-side jobs never mix partitions
# ---------------------------------------------------------------------------


class TestLifecycleSelectors:
    def test_synthesis_never_clusters_an_agent_row(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        tenant = mc.tenant_id
        shared = _seed_row(memory_engine, tenant, scope="tenant", scope_ref=None)
        private = _seed_row(memory_engine, tenant, scope="agent", scope_ref=_A_REF)
        candidates = _run(
            memory_engine,
            lambda s: store.fetch_cluster_candidates(
                s, tenant, now=datetime.now(UTC), limit=1000
            ),
        )
        ids = {c["memory_id"] for c in candidates}
        assert shared in ids
        assert private not in ids

    def test_reindex_jobs_never_mix_two_partitions(
        self, mc: MemoryClient, memory_engine: AsyncEngine
    ) -> None:
        tenant = mc.tenant_id
        partition_of: dict[UUID, Any] = {}
        for scope, ref in (
            ("tenant", None),
            ("tenant", None),
            ("agent", _C_REF),
            ("agent", _C_REF.upper()),
            ("agent", _B_REF),
            ("agent", None),
        ):
            memory_id = _seed_row(
                memory_engine, tenant, scope=scope, scope_ref=ref, vector_of=None
            )
            partition_of[memory_id] = (
                ("agent", ref.lower() if ref else None) if scope == "agent" else None
            )
        _run(memory_engine, lambda s: reindex_once(s))

        async def _jobs() -> list[list[UUID]]:
            async with memory_engine.connect() as conn:
                rows = await conn.execute(
                    text(
                        "SELECT target_ids FROM coord.memory_jobs"
                        " WHERE tenant_id = :t AND kind = 'embedding'"
                    ),
                    {"t": tenant},
                )
                return [list(r.target_ids) for r in rows]

        jobs = asyncio.run(_jobs())
        targeted = [UUID(str(t)) for job in jobs for t in job]
        # Positive control: every seeded row was enqueued, exactly once.
        assert sorted(targeted) == sorted(partition_of)
        for job in jobs:
            assert len({partition_of[UUID(str(t))] for t in job}) == 1, job
        # Device C's two rows (one upper-cased) share one job.
        assert len(jobs) == 4
