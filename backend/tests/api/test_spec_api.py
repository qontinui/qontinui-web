"""Tests for the Spec API (`app/api/spec_api.py`).

Phase B5a of UI Bridge redesign Section 3. Mirrors the runner's Rust
test suite at `qontinui-runner/src-tauri/src/spec_api/tests.rs`.

The tests run against an isolated temporary specs root so they don't
collide with the real ``qontinui-web/frontend/specs/`` tree on the
developer's machine. We point the spec_api router at it via the
``QONTINUI_SPECS_ROOT`` env var.

Authentication is intentionally out of scope for Phase B5 (matches the
runner's dev-only model), so the tests don't bother with a JWT.
"""

from __future__ import annotations

import json
import os
import shutil
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REAL_SPECS_ROOT = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "frontend"
    / "specs"
)


@pytest.fixture
def specs_root(tmp_path: Path) -> Generator[Path, None, None]:
    """Create an isolated specs root by copying the real one.

    The 19 migrated pages on the ``feat/section-3-phase-a`` branch are
    real fixtures; tests assert against them. Copying keeps the tests
    hermetic — author/round-trip tests can mutate freely.
    """
    root = tmp_path / "specs"
    if REAL_SPECS_ROOT.exists():
        shutil.copytree(REAL_SPECS_ROOT, root)
    else:
        (root / "pages").mkdir(parents=True, exist_ok=True)
    prev = os.environ.get("QONTINUI_SPECS_ROOT")
    os.environ["QONTINUI_SPECS_ROOT"] = str(root)
    try:
        yield root
    finally:
        if prev is None:
            os.environ.pop("QONTINUI_SPECS_ROOT", None)
        else:
            os.environ["QONTINUI_SPECS_ROOT"] = prev


@pytest.fixture
def client(specs_root: Path) -> Generator[TestClient, None, None]:  # noqa: ARG001
    """Test client mounted on a minimal FastAPI app.

    We don't use ``app.main.app`` here because its startup hooks
    require Postgres/Redis. The Spec API has zero database
    dependencies, so a fresh FastAPI instance is all we need — and it
    keeps the test surface small and deterministic.
    """
    from fastapi import FastAPI

    from app.api.spec_api import router as spec_api_router

    test_app = FastAPI()
    test_app.include_router(spec_api_router, prefix="/spec")
    with TestClient(test_app) as c:
        yield c


# ---------------------------------------------------------------------------
# Smoke
# ---------------------------------------------------------------------------


def test_spec_health(client: TestClient) -> None:
    """Health endpoint confirms the router is mounted."""
    resp = client.get("/spec/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"ok": True, "reason": "spec-api-mounted"}


# ---------------------------------------------------------------------------
# /spec/page/{id}
# ---------------------------------------------------------------------------


def test_spec_page_get_existing(client: TestClient) -> None:
    """Fetching a known migrated page returns the legacy projection."""
    resp = client.get("/spec/page/settings-ai-ai-settings")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Top-level legacy spec shape
    assert body["version"] == "1.0.0"
    assert "groups" in body
    assert "stateMachine" in body
    assert "metadata" in body
    assert isinstance(body["groups"], list)
    assert len(body["groups"]) > 0
    # Every group has id/name/assertions
    for group in body["groups"]:
        assert "id" in group and isinstance(group["id"], str)
        assert "assertions" in group and isinstance(group["assertions"], list)
        assert len(group["assertions"]) > 0
    # metadata.component must be the page id (no doc.metadata.purpose
    # in the real fixture, so it falls back to id)
    assert body["metadata"]["component"] == "settings-ai-ai-settings"


def test_spec_page_get_missing(client: TestClient) -> None:
    """Unknown page returns 404 with reason: page-not-found."""
    resp = client.get("/spec/page/this-page-does-not-exist")
    assert resp.status_code == 404
    body = resp.json()
    assert body["ok"] is False
    assert body["reason"] == "page-not-found"
    assert body["detail"]["id"] == "this-page-does-not-exist"


# ---------------------------------------------------------------------------
# /spec/graph
# ---------------------------------------------------------------------------


def test_spec_graph_lists_all_19_pages(client: TestClient) -> None:
    """Graph endpoint summarizes every migrated page."""
    resp = client.get("/spec/graph")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert isinstance(body["pages"], list)
    # 19 pages migrated on feat/section-3-phase-a
    assert len(body["pages"]) == 19
    # Every entry has id + stateIds + transitionIds
    for page in body["pages"]:
        assert "id" in page
        assert isinstance(page.get("stateIds"), list)
        assert isinstance(page.get("transitionIds"), list)


# ---------------------------------------------------------------------------
# /spec/author round-trip
# ---------------------------------------------------------------------------


def test_spec_author_round_trip(client: TestClient, specs_root: Path) -> None:
    """POST a small IR; assert IR + projection are written and round-trip."""
    page_id = "test-author-roundtrip"
    ir = {
        "version": "1.0",
        "id": page_id,
        "name": "Round Trip Test Page",
        "description": "A small IR doc for round-trip testing.",
        "states": [
            {
                "id": "state-a",
                "name": "State A",
                "requiredElements": [
                    {"role": "button", "text": "Save"}
                ],
            }
        ],
        "transitions": [],
    }

    resp = client.post("/spec/author", json=ir)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["pageId"] == page_id
    assert body["projectionPath"].endswith("spec.uibridge.json")

    # IR file written
    ir_file = specs_root / "pages" / page_id / "state-machine.derived.json"
    assert ir_file.exists()
    written = json.loads(ir_file.read_text(encoding="utf-8"))
    assert written["id"] == page_id

    # Projection file written
    proj_file = specs_root / "pages" / page_id / "spec.uibridge.json"
    assert proj_file.exists()

    # GET /spec/page/{id} reads the projection and matches
    resp2 = client.get(f"/spec/page/{page_id}")
    assert resp2.status_code == 200
    projection = resp2.json()
    assert projection["version"] == "1.0.0"
    # The IR has one state with one required element -> one group
    # with one assertion targeting the Save button.
    assert len(projection["groups"]) == 1
    group = projection["groups"][0]
    assert group["id"] == "state-a"
    assert len(group["assertions"]) == 1
    target_criteria = group["assertions"][0]["target"]["criteria"]
    assert target_criteria == {"role": "button", "textContent": "Save"}


def test_spec_author_rejects_invalid_version(client: TestClient) -> None:
    """Author endpoint rejects unsupported schema versions."""
    resp = client.post(
        "/spec/author",
        json={
            "version": "0.9",
            "id": "bad-version",
            "name": "Bad Version Page",
            "states": [],
            "transitions": [],
        },
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["ok"] is False
    assert body["reason"] == "unsupported-version"


def test_spec_author_rejects_empty_id(client: TestClient) -> None:
    """Author endpoint rejects empty page IDs."""
    resp = client.post(
        "/spec/author",
        json={
            "version": "1.0",
            "id": "",
            "name": "Empty ID",
            "states": [],
            "transitions": [],
        },
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["reason"] == "missing-document-id"


# ---------------------------------------------------------------------------
# /spec/get path-traversal protection
# ---------------------------------------------------------------------------


def test_path_traversal_blocked(client: TestClient) -> None:
    """``/spec/get?path=../../...`` must NOT escape the specs root."""
    resp = client.get("/spec/get", params={"path": "../../../etc/passwd"})
    # Either 403 (resolved + caught) or 404 (resolution failed) — both
    # are fine; the mandate is "no escape".
    assert resp.status_code in (400, 403, 404), resp.text
    body = resp.json()
    assert body["ok"] is False
    assert body["reason"] in {
        "path-outside-root",
        "file-not-found",
        "missing-path-query-param",
    }


def test_get_missing_path_query_param(client: TestClient) -> None:
    """Missing ``?path=`` returns 400 with reason."""
    resp = client.get("/spec/get")
    assert resp.status_code == 400
    body = resp.json()
    assert body["reason"] == "missing-path-query-param"


def test_get_serves_real_file(client: TestClient) -> None:
    """A valid relative path serves bytes."""
    rel = "pages/settings-ai-ai-settings/state-machine.derived.json"
    resp = client.get("/spec/get", params={"path": rel})
    assert resp.status_code == 200, resp.text
    # Content-Type is octet-stream (caller decides parsing)
    assert resp.headers["content-type"].startswith("application/octet-stream")
    payload = json.loads(resp.content.decode("utf-8"))
    assert payload["id"] == "settings-ai-ai-settings"


# ---------------------------------------------------------------------------
# /spec/query
# ---------------------------------------------------------------------------


def test_spec_query_unsupported_kind(client: TestClient) -> None:
    """Unknown query kind returns reason: query-kind-unsupported."""
    resp = client.post(
        "/spec/query",
        json={"kind": "totallyUnknown", "value": "x"},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["reason"] == "query-kind-unsupported"


def test_spec_query_no_matches(client: TestClient) -> None:
    """find* with no matches returns ok with reason: no-matches."""
    resp = client.post(
        "/spec/query",
        json={"kind": "findStatesByGroup", "group": "no-such-group"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["matches"] == []
    assert body["reason"] == "no-matches"


# ---------------------------------------------------------------------------
# /spec/derive
# ---------------------------------------------------------------------------


def test_spec_derive_incoming_transitions(client: TestClient) -> None:
    """Derive endpoint returns incomingTransitions for a real page."""
    resp = client.post(
        "/spec/derive",
        json={
            "pageId": "settings-ai-ai-settings",
            "derivation": "incomingTransitions",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["pageId"] == "settings-ai-ai-settings"
    assert body["derivation"] == "incomingTransitions"
    assert isinstance(body["result"], list)
    # The settings-ai page has no transitions -> every state has empty
    # incomingTransitions.
    for entry in body["result"]:
        assert entry["incomingTransitions"] == []


def test_spec_derive_unknown(client: TestClient) -> None:
    """Unknown derivation returns reason: unknown-derivation."""
    resp = client.post(
        "/spec/derive",
        json={
            "pageId": "settings-ai-ai-settings",
            "derivation": "doesNotExist",
        },
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["reason"] == "unknown-derivation"


# ---------------------------------------------------------------------------
# /spec/diff (deferred per Phase B5 plan)
# ---------------------------------------------------------------------------


def test_spec_diff_not_implemented(client: TestClient) -> None:
    """Diff endpoint defers git introspection per Phase B5."""
    resp = client.get("/spec/diff", params={"since": "2026-04-01"})
    assert resp.status_code == 501
    body = resp.json()
    assert body["reason"] == "not-implemented-yet"


# ---------------------------------------------------------------------------
# /spec/subscribe SSE
# ---------------------------------------------------------------------------


def test_subscribe_emits_event_after_author(specs_root: Path) -> None:  # noqa: ARG001
    """SSE stream receives a ``spec.changed`` event after author writes.

    Runs the FastAPI app under uvicorn on an ephemeral port in a
    background thread, then connects with a real ``httpx.AsyncClient``
    over TCP. ``ASGITransport`` buffers SSE bodies until response close
    in some httpx versions, so it isn't a reliable substrate for this
    test — a real socket is.
    """
    import asyncio as _asyncio
    import socket
    import threading

    import httpx
    import uvicorn
    from fastapi import FastAPI

    from app.api.spec_api import router as spec_api_router

    test_app = FastAPI()
    test_app.include_router(spec_api_router, prefix="/spec")

    # Pick a free port.
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()

    config = uvicorn.Config(
        test_app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
        loop="asyncio",
    )
    server = uvicorn.Server(config)

    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    page_id = "test-subscribe-event"
    ir_payload = {
        "version": "1.0",
        "id": page_id,
        "name": "Subscribe Test",
        "states": [],
        "transitions": [],
    }

    async def run() -> list[str]:
        # Wait for uvicorn to come up.
        async with httpx.AsyncClient(
            base_url=f"http://127.0.0.1:{port}", timeout=10.0
        ) as ac:
            for _ in range(50):
                try:
                    h = await ac.get("/spec/health")
                    if h.status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                await _asyncio.sleep(0.1)
            else:
                raise RuntimeError("uvicorn never came up")

            received: list[str] = []
            posted = _asyncio.Event()

            async def post_after_delay() -> None:
                await _asyncio.sleep(0.5)
                resp = await ac.post("/spec/author", json=ir_payload)
                assert resp.status_code == 200, resp.text
                posted.set()

            poster = _asyncio.create_task(post_after_delay())

            async with ac.stream("GET", "/spec/subscribe") as resp:
                assert resp.status_code == 200
                lines_iter = resp.aiter_lines()
                done = False
                while not done:
                    try:
                        line = await _asyncio.wait_for(
                            lines_iter.__anext__(), timeout=8.0
                        )
                    except (TimeoutError, StopAsyncIteration):
                        break
                    received.append(line)
                    if line.startswith("data:") and page_id in line:
                        done = True
                    if len(received) > 50:
                        break

            await poster
            assert posted.is_set()
            return received

    try:
        received = _asyncio.run(run())
    finally:
        server.should_exit = True
        server_thread.join(timeout=5)

    assert any(
        line.startswith("event:") and "spec.changed" in line
        for line in received
    ), f"no spec.changed event received; got {received[:10]}"
    assert any(
        line.startswith("data:") and page_id in line for line in received
    ), f"event payload didn't mention pageId={page_id}; got {received[:10]}"
