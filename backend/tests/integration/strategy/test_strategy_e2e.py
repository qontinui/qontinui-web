"""Strategy Phase 1 — end-to-end verification harnesses.

Three harnesses (the prompt's "thread create + read" is dropped:
threads are Phase 2 and have no substrate). All gated by
`conftest.pytestmark` — skip cleanly when service deps are absent.

  1. Auth round-trip — StrategyClient mints a service JWT at coord,
     coord verifies + enforces strategy_admin + forwarded-user, docs
     return. Proves the whole Option-3 bridge end to end.
  2. Git-read cache hit — two reads of one doc in quick succession:
     the second carries `X-Strategy-Cache: hit` (zero git subprocess).
     TTL-expiry + per-key isolation are proven deterministically by
     the coord-side unit test (no 60s sleep in CI).
  3. Doc read — a known doc renders with correct content + git
     provenance (40-hex sha, non-empty author).
"""

from __future__ import annotations

import os
import re
import uuid

import httpx
import pytest
import pytest_asyncio

from app.services.strategy import StrategyClient

COORD_URL = os.getenv("COORD_URL", "http://localhost:9870").rstrip("/")
ADMIN_SECRET = os.environ["COORD_ADMIN_SECRET"]  # presence enforced by conftest
SERVICE_NAME = "qontinui-web-strategy-e2e"


@pytest_asyncio.fixture()
async def client() -> StrategyClient:
    c = StrategyClient(COORD_URL, ADMIN_SECRET, SERVICE_NAME)
    await c.startup()  # fail-fast initial mint
    yield c
    await c.shutdown()


@pytest.mark.asyncio
async def test_auth_round_trip(client: StrategyClient) -> None:
    """web mint → coord verify → strategy_admin + X-Qontinui-User-Id
    → docs list returns."""
    status, body = await client.list_docs(str(uuid.uuid4()))
    assert status == 200, body
    assert isinstance(body, dict) and "docs" in body
    assert len(body["docs"]) >= 1
    # README is always in the substrate seed.
    assert any(d["name"] == "README.md" for d in body["docs"])


@pytest.mark.asyncio
async def test_git_read_cache_hit(client: StrategyClient) -> None:
    """Two consecutive reads of the same doc: the second is served
    from cache (`X-Strategy-Cache: hit`) — zero git subprocess."""
    token = await client._ensure_token()  # noqa: SLF001 — e2e needs raw hdr
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Qontinui-User-Id": str(uuid.uuid4()),
    }
    async with httpx.AsyncClient(timeout=10.0) as h:
        r1 = await h.get(f"{COORD_URL}/strategy/docs/README.md", headers=headers)
        r2 = await h.get(f"{COORD_URL}/strategy/docs/README.md", headers=headers)
        # Different doc = different cache key (independent state).
        r3 = await h.get(
            f"{COORD_URL}/strategy/docs/business-goals.md",
            headers=headers,
        )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r2.headers.get("x-strategy-cache") == "hit", (
        "second read of same doc must be a cache hit"
    )
    assert r3.headers.get("x-strategy-cache") in {"hit", "miss"}
    # Cross-key isolation: r3 is a different doc; its body name differs.
    assert r3.json()["name"] == "business-goals.md"


@pytest.mark.asyncio
async def test_doc_read_content_and_provenance(
    client: StrategyClient,
) -> None:
    """A known doc returns correct content + git provenance."""
    status, body = await client.get_doc(str(uuid.uuid4()), "README.md")
    assert status == 200, body
    assert body["name"] == "README.md"
    assert body["title"]  # H1-derived, non-empty
    assert body["content"].strip(), "content must be non-empty"
    prov = body["provenance"]
    assert re.fullmatch(r"[0-9a-f]{40}", prov["commit_sha"]), prov
    assert prov["author"], "author must be non-empty"
    assert prov["committed_at"], "committed_at must be non-empty"


@pytest.mark.asyncio
async def test_presence_heartbeat_with_doc_name(client: StrategyClient) -> None:
    """Phase 2.4: POST /strategy/presence/heartbeat with `doc_name`
    resolves to a canonical doc_id and emits on the dual-publish bus.
    Coord echoes the resolved doc_id in the response so the frontend
    can subscribe to per-doc aggregate channels. The full delta-only
    aggregator behaviour is unit-tested coord-side; this harness just
    proves the HTTP surface + PG resolution are wired."""
    status, body = await client.heartbeat(
        str(uuid.uuid4()),
        doc_name="README.md",
    )
    assert status == 200, body
    assert isinstance(body, dict)
    assert "doc_id" in body
    assert re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        body["doc_id"],
    ), body


@pytest.mark.asyncio
async def test_presence_heartbeat_with_doc_id(client: StrategyClient) -> None:
    """Phase 2.4: caller can also send a pre-resolved doc_id. (The
    frontend uses doc_name; this path exists for tests + future
    callers that already have the UUID.)"""
    doc_id = str(uuid.uuid4())
    status, body = await client.heartbeat(str(uuid.uuid4()), doc_id=doc_id)
    assert status == 200, body
    assert body == {"doc_id": doc_id}
