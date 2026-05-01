"""Spec API — qontinui-web Phase B5a of UI Bridge redesign Section 3.

Per-app HTTP surface for the IR-based spec system, mounted at `/spec/...`
on the qontinui-web FastAPI backend (port 8000). Mirrors the runner's
Rust Spec API at `qontinui-runner/src-tauri/src/spec_api/` so consumers
(`/update-spec`, runner spec drift / verify, error monitor curator,
spec experimentation, AI session) see a consistent surface across both
apps.

Surface (every empty/error response carries a ``reason`` field):

- ``GET  /spec/health``           Smoke test — confirms the router is mounted.
- ``GET  /spec/get?path=<rel>``   Raw file contents under the specs root.
- ``GET  /spec/page/{id}``        Bundled-page projection (legacy shape).
- ``GET  /spec/graph``            Cross-page graph (state/transition IDs).
- ``POST /spec/query``            Find* queries (group/effect/references).
- ``POST /spec/derive``           Derived data (e.g. incomingTransitions).
- ``GET  /spec/diff?since=...``   Pages changed since a given watermark
                                  (NOT IMPLEMENTED — git introspection out
                                  of scope for B5; honors contract with
                                  ``ok: false, reason: not-implemented-yet``).
- ``POST /spec/author``           Write IR JSON + regenerate projection.
- ``GET  /spec/subscribe``        SSE stream of ``spec.changed`` events.

Storage layout (under ``QONTINUI_SPECS_ROOT`` or
``qontinui-web/frontend/specs/`` by default):

    <root>/
      pages/<id>/state-machine.derived.json   IR document
      pages/<id>/spec.uibridge.json           Bundled-page projection (generated)
      pages/<id>/notes.md                     Optional human notes

Configuration via env var ``QONTINUI_SPECS_ROOT``. When unset, the
server resolves a path relative to this file at
``../../../frontend/specs/`` (relative to ``app/api/spec_api.py``,
landing on ``qontinui-web/frontend/specs/``).

Authorization is dev-only — matches the runner's model. Production
hardening (auth + sandboxing) happens in a later section per the
Section 3 plan.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import structlog
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from app.services.ui_bridge_ir.projection import (
    project_ir_to_bundled_page,
    project_to_pretty_json,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Storage root resolution
# ---------------------------------------------------------------------------


def _default_specs_root() -> Path:
    """Resolve the default specs root relative to this module.

    ``app/api/spec_api.py`` -> ``../../../frontend/specs`` lands on
    ``qontinui-web/frontend/specs``. Test code overrides this via the
    ``QONTINUI_SPECS_ROOT`` env var.
    """
    here = Path(__file__).resolve()
    # app/api/spec_api.py -> app/api -> app -> backend -> qontinui-web
    return here.parent.parent.parent.parent / "frontend" / "specs"


def resolve_specs_root() -> Path:
    """Return the configured specs storage root.

    1. ``QONTINUI_SPECS_ROOT`` env var if set.
    2. ``qontinui-web/frontend/specs/`` (relative to this file).
    """
    override = os.environ.get("QONTINUI_SPECS_ROOT")
    if override:
        return Path(override)
    return _default_specs_root()


def _page_dir(root: Path, page_id: str) -> Path:
    return root / "pages" / page_id


def _ir_path(root: Path, page_id: str) -> Path:
    return _page_dir(root, page_id) / "state-machine.derived.json"


def _projection_path(root: Path, page_id: str) -> Path:
    return _page_dir(root, page_id) / "spec.uibridge.json"


def _notes_path(root: Path, page_id: str) -> Path:
    return _page_dir(root, page_id) / "notes.md"


def _list_page_ids(root: Path) -> list[str]:
    pages_dir = root / "pages"
    if not pages_dir.exists():
        return []
    ids = [
        entry.name
        for entry in pages_dir.iterdir()
        if entry.is_dir()
    ]
    ids.sort()
    return ids


def _read_ir(root: Path, page_id: str) -> dict[str, Any] | None:
    path = _ir_path(root, page_id)
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        result: dict[str, Any] = json.load(f)
        return result


def _read_notes(root: Path, page_id: str) -> str | None:
    path = _notes_path(root, page_id)
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    return text or None


def _atomic_write_text(target: Path, contents: str) -> None:
    """Write a text file atomically via temp + rename."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    try:
        with tmp.open("w", encoding="utf-8") as f:
            f.write(contents)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, target)
    except Exception:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        raise


def _read_within_root(root: Path, rel: str) -> tuple[bytes | None, str]:
    """Read a file at ``rel`` inside ``root`` with traversal protection.

    Returns ``(bytes, "")`` on success; ``(None, reason)`` on failure
    where reason is one of ``root-missing`` / ``path-outside-root`` /
    ``file-not-found``.
    """
    try:
        root_canon = root.resolve(strict=True)
    except (OSError, RuntimeError):
        return None, "specs-root-missing"
    candidate = (root_canon / rel)
    try:
        candidate_canon = candidate.resolve(strict=True)
    except (OSError, RuntimeError):
        return None, "file-not-found"
    # Ensure resolved candidate stays within root.
    try:
        candidate_canon.relative_to(root_canon)
    except ValueError:
        return None, "path-outside-root"
    if not candidate_canon.is_file():
        return None, "file-not-found"
    return candidate_canon.read_bytes(), ""


# ---------------------------------------------------------------------------
# Event broadcaster (in-process, like the runner's tokio broadcast)
# ---------------------------------------------------------------------------


class _SpecEventBus:
    """Single-process broadcaster for ``spec.changed`` events.

    Every ``GET /spec/subscribe`` connection appends a fresh
    ``asyncio.Queue`` to ``self._listeners`` and pulls events as they
    arrive. ``emit()`` is non-blocking — full queues drop events
    silently (slow consumers don't stall writers).
    """

    def __init__(self, capacity: int = 256) -> None:
        self._capacity = capacity
        self._listeners: list[asyncio.Queue[dict[str, Any]]] = []
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(
            maxsize=self._capacity
        )
        async with self._lock:
            self._listeners.append(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            try:
                self._listeners.remove(q)
            except ValueError:
                pass

    def emit(self, event: dict[str, Any]) -> None:
        # Snapshot under no-lock (safe — list ops are atomic enough; we
        # only need a stable iterator).
        for q in list(self._listeners):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Drop the event for this slow listener; mirrors the
                # runner's ``Lag`` handling.
                logger.debug(
                    "spec_event_dropped_for_slow_listener",
                    listener_qsize=q.qsize(),
                )


_event_bus = _SpecEventBus()


def _now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class SpecError(BaseModel):
    ok: bool = False
    reason: str
    detail: dict[str, Any] | None = None


class EmptyOk(BaseModel):
    ok: bool = True
    reason: str


def _err(
    reason: str,
    *,
    status_code: int = 400,
    detail: dict[str, Any] | None = None,
) -> JSONResponse:
    payload: dict[str, Any] = {"ok": False, "reason": reason}
    if detail is not None:
        payload["detail"] = detail
    return JSONResponse(status_code=status_code, content=payload)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/health")
async def get_health() -> dict[str, Any]:
    """Smoke endpoint — confirms the spec_api router is mounted."""
    return {"ok": True, "reason": "spec-api-mounted"}


@router.get("/get")
async def get_file(path: str | None = Query(default=None)) -> Response:
    """Return raw file contents at ``path`` inside the specs root."""
    if not path:
        return _err("missing-path-query-param", status_code=400)
    root = resolve_specs_root()
    bytes_, reason = _read_within_root(root, path)
    if bytes_ is None:
        if reason == "path-outside-root":
            return _err(
                "path-outside-root",
                status_code=403,
                detail={"path": path},
            )
        if reason == "specs-root-missing":
            return _err(
                "specs-root-missing",
                status_code=500,
                detail={"root": str(root)},
            )
        # file-not-found
        return _err("file-not-found", status_code=404, detail={"path": path})
    return Response(content=bytes_, media_type="application/octet-stream")


@router.get("/page/{page_id}")
async def get_page(page_id: str) -> Response:
    """Return the bundled-page projection for ``page_id``.

    Reads the IR document and projects on the fly. Falls back to the
    on-disk ``spec.uibridge.json`` if present and IR is missing — that
    way pages migrated by tools that only produced a projection still
    serve.
    """
    root = resolve_specs_root()
    doc = _read_ir(root, page_id)
    if doc is not None:
        notes = _read_notes(root, page_id)
        projection = project_ir_to_bundled_page(doc, notes)
        return JSONResponse(content=projection)

    # No IR — try a hand-authored projection file.
    proj_path = _projection_path(root, page_id)
    if proj_path.exists():
        with proj_path.open("r", encoding="utf-8") as f:
            return JSONResponse(content=json.load(f))

    return _err(
        "page-not-found", status_code=404, detail={"id": page_id}
    )


@router.get("/graph")
async def get_graph() -> dict[str, Any]:
    """List every page with its state and transition IDs."""
    root = resolve_specs_root()
    ids = _list_page_ids(root)
    if not ids:
        return {
            "ok": True,
            "pages": [],
            "reason": "no-pages-registered",
        }
    pages: list[dict[str, Any]] = []
    for page_id in ids:
        try:
            doc = _read_ir(root, page_id)
        except (OSError, json.JSONDecodeError) as e:
            pages.append(
                {
                    "id": page_id,
                    "stateIds": [],
                    "transitionIds": [],
                    "reason": "ir-read-failed",
                    "error": str(e),
                }
            )
            continue
        if doc is None:
            pages.append(
                {
                    "id": page_id,
                    "stateIds": [],
                    "transitionIds": [],
                    "reason": "no-ir-document",
                }
            )
            continue
        pages.append(
            {
                "id": doc.get("id", page_id),
                "stateIds": [
                    s.get("id", "") for s in (doc.get("states") or [])
                ],
                "transitionIds": [
                    t.get("id", "") for t in (doc.get("transitions") or [])
                ],
            }
        )
    return {"ok": True, "pages": pages}


# ---------------------------------------------------------------------------
# POST /spec/query
# ---------------------------------------------------------------------------


class QueryBody(BaseModel):
    kind: str
    # Either ``group`` / ``effect`` / ``stateId`` named fields per query
    # kind, or a generic ``value`` fallback (matches the runner). We
    # accept any of them and pick the right field per kind.
    group: str | None = None
    effect: str | None = None
    stateId: str | None = None
    value: str | None = None


def _query_value(body: QueryBody) -> str | None:
    return body.group or body.effect or body.stateId or body.value


def _all_irs(root: Path) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    for page_id in _list_page_ids(root):
        try:
            doc = _read_ir(root, page_id)
        except (OSError, json.JSONDecodeError):
            continue
        if doc is not None:
            docs.append(doc)
    return docs


@router.post("/query")
async def post_query(body: QueryBody) -> JSONResponse:
    """Run a find* query against all IR documents."""
    root = resolve_specs_root()
    docs = _all_irs(root)
    needle = _query_value(body)

    if body.kind == "findStatesByGroup":
        if needle is None:
            return _err("missing-query-value", status_code=400)
        matches: list[dict[str, Any]] = []
        for doc in docs:
            for s in doc.get("states") or []:
                if s.get("group") == needle:
                    matches.append(
                        {
                            "pageId": doc.get("id"),
                            "stateId": s.get("id"),
                            "name": s.get("name"),
                        }
                    )
        reason = "matched-by-group" if matches else "no-matches"
        return JSONResponse(
            content={"ok": True, "matches": matches, "reason": reason}
        )

    if body.kind == "findTransitionsByEffect":
        if needle is None:
            return _err("missing-query-value", status_code=400)
        matches = []
        for doc in docs:
            for t in doc.get("transitions") or []:
                if t.get("effect") == needle:
                    matches.append(
                        {
                            "pageId": doc.get("id"),
                            "transitionId": t.get("id"),
                            "name": t.get("name"),
                        }
                    )
        reason = "matched-by-effect" if matches else "no-matches"
        return JSONResponse(
            content={"ok": True, "matches": matches, "reason": reason}
        )

    if body.kind == "findStatesReferencing":
        if needle is None:
            return _err("missing-query-value", status_code=400)
        matches = []
        for doc in docs:
            for t in doc.get("transitions") or []:
                referenced = (
                    needle in (t.get("fromStates") or [])
                    or needle in (t.get("activateStates") or [])
                    or needle in (t.get("exitStates") or [])
                )
                if referenced:
                    matches.append(
                        {
                            "pageId": doc.get("id"),
                            "transitionId": t.get("id"),
                            "stateId": needle,
                        }
                    )
        reason = "matched-references" if matches else "no-matches"
        return JSONResponse(
            content={"ok": True, "matches": matches, "reason": reason}
        )

    return _err(
        "query-kind-unsupported",
        status_code=400,
        detail={"kind": body.kind},
    )


# ---------------------------------------------------------------------------
# POST /spec/derive
# ---------------------------------------------------------------------------


class DeriveBody(BaseModel):
    pageId: str
    derivation: str


@router.post("/derive")
async def post_derive(body: DeriveBody) -> JSONResponse:
    """Compute a derived view for a page without persisting it."""
    root = resolve_specs_root()
    doc = _read_ir(root, body.pageId)
    if doc is None:
        return _err(
            "page-not-found",
            status_code=404,
            detail={"pageId": body.pageId},
        )

    if body.derivation == "incomingTransitions":
        # state-id -> [transition-id, ...] activating it
        by_state: dict[str, list[str]] = {}
        for t in doc.get("transitions") or []:
            for activated in t.get("activateStates") or []:
                by_state.setdefault(activated, []).append(t.get("id", ""))
        result = [
            {
                "stateId": s.get("id"),
                "incomingTransitions": by_state.get(s.get("id", ""), []),
            }
            for s in (doc.get("states") or [])
        ]
        return JSONResponse(
            content={
                "ok": True,
                "pageId": body.pageId,
                "derivation": body.derivation,
                "result": result,
            }
        )

    return _err(
        "unknown-derivation",
        status_code=400,
        detail={"derivation": body.derivation},
    )


# ---------------------------------------------------------------------------
# GET /spec/diff
# ---------------------------------------------------------------------------


@router.get("/diff")
async def get_diff(since: str | None = Query(default=None)) -> JSONResponse:
    """Return pages changed since ``since`` (sha or ISO timestamp).

    Not implemented in Phase B5 — git introspection is out of scope.
    Honors the contract by returning a structured ``not-implemented-yet``
    reason so callers can branch on it without parsing free-form errors.
    """
    return JSONResponse(
        status_code=501,
        content={
            "ok": False,
            "reason": "not-implemented-yet",
            "detail": {"since": since, "phase": "B5"},
        },
    )


# ---------------------------------------------------------------------------
# POST /spec/author
# ---------------------------------------------------------------------------


@router.post("/author")
async def post_author(request: Request) -> JSONResponse:
    """Accept an IR document, validate it, write IR + projection.

    Validation is intentionally minimal (matches the runner): version
    must be ``"1.0"``, ``id`` must be non-empty, ``states`` must be a
    list. Schema-shape errors get a structured reason so callers can
    decide whether to retry or surface to the human.
    """
    try:
        doc = await request.json()
    except json.JSONDecodeError as e:
        return _err(
            "invalid-json", status_code=400, detail={"error": str(e)}
        )

    if not isinstance(doc, dict):
        return _err("ir-not-an-object", status_code=400)

    page_id = doc.get("id")
    if not isinstance(page_id, str) or page_id.strip() == "":
        return _err("missing-document-id", status_code=400)

    version = doc.get("version")
    if version != "1.0":
        return _err(
            "unsupported-version",
            status_code=400,
            detail={"got": version, "expected": "1.0"},
        )

    if not isinstance(doc.get("states"), list):
        return _err("states-not-a-list", status_code=400)

    root = resolve_specs_root()
    try:
        root.mkdir(parents=True, exist_ok=True)
        # Write IR (pretty + trailing newline, matching the runner).
        ir_text = (
            json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
        )
        _atomic_write_text(_ir_path(root, page_id), ir_text)
        # Regenerate projection.
        notes = _read_notes(root, page_id)
        projection_text = project_to_pretty_json(doc, notes)
        _atomic_write_text(_projection_path(root, page_id), projection_text)
    except OSError as e:
        return _err(
            "write-failed", status_code=500, detail={"error": str(e)}
        )

    _event_bus.emit(
        {
            "pageId": page_id,
            "kind": "ir-and-projection",
            "atMs": _now_ms(),
        }
    )

    return JSONResponse(
        content={
            "ok": True,
            "pageId": page_id,
            "projectionPath": str(_projection_path(root, page_id)),
        }
    )


# ---------------------------------------------------------------------------
# GET /spec/subscribe
# ---------------------------------------------------------------------------


async def _sse_stream(
    queue: asyncio.Queue[dict[str, Any]],
    request: Request,
) -> AsyncIterator[str]:
    """Yield SSE-formatted events from ``queue`` until the client leaves.

    Sends a periodic comment as a keep-alive (matches the runner's 30s
    cadence) so proxies don't time out the stream. Disconnect handling
    relies on Starlette cancelling the generator when the client
    closes — we don't await ``request.is_disconnected()`` (which blocks
    until the receive channel produces a message and would deadlock the
    queue.get loop here).
    """
    keepalive_interval = 30.0
    # Emit an immediate connected comment so the ASGI transport flushes
    # response headers + first body chunk to the client. Without this,
    # some ASGI clients (httpx ASGITransport, certain reverse proxies)
    # block on `aiter_*` until the first body chunk arrives.
    yield ": connected\n\n"
    try:
        while True:
            try:
                event = await asyncio.wait_for(
                    queue.get(), timeout=keepalive_interval
                )
            except TimeoutError:
                # SSE comment line — keep-alive heartbeat.
                yield ": keep-alive\n\n"
                continue
            payload = json.dumps(event, ensure_ascii=False)
            yield f"event: spec.changed\ndata: {payload}\n\n"
    except asyncio.CancelledError:
        # Client disconnected — Starlette cancels the generator when
        # the response is closed.
        pass
    finally:
        await _event_bus.unsubscribe(queue)


@router.get("/subscribe")
async def get_subscribe(request: Request) -> StreamingResponse:
    """SSE stream of ``spec.changed`` events."""
    queue = await _event_bus.subscribe()
    return StreamingResponse(
        _sse_stream(queue, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


