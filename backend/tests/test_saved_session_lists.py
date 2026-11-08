"""Saved per-tab session lists: capture, list, get, delete, expiry and purge.

Plan ``2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days``,
Phase 2. Against real Postgres (``project.saved_session_lists`` built by the
suite's ``create_all``). Everything outside this backend is stubbed at its
boundary, never inside the code under test:

* coord's device reads (``coord_device.get_device_routing`` — the relay's
  ownership check —, ``list_devices_for_user`` and the liveness read);
* the runner, at the relay's Redis dispatch (``dispatch_and_wait``), so the
  real ``runner_relay.relay_http`` builds the envelope and decodes the reply;
* coord's work-status route, at the httpx layer, so the real
  ``coord_session_status`` client parses the answer;
* the endpoint's clock (``saved_session_lists.utc_now``).

Layers:

1. the coord work-status client on its own (per-id outcomes, chunking);
2. the capture: the stored row, every typed refusal, the relay's own 404/503
   passed through unchanged (and never read as "runner predates"), the coord
   join, the per-device trim;
3. list / get / delete and their access rule;
4. exact expiry and the purge, under a controlled clock;
5. the scheduler registration and the purge job's failure posture;
6. the real app: ``POST /api/v1/saved-session-lists`` through ``app.main``.
"""

from __future__ import annotations

import base64
import json
import sys
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.deps import current_active_user, get_async_db
from app.api.v1.endpoints import device_bridge_ws
from app.api.v1.endpoints import saved_session_lists as endpoints
from app.jobs import saved_session_lists_cleanup as cleanup
from app.middleware.error_handler import (
    http_exception_handler,
    validation_exception_handler,
)
from app.models.saved_session_list import (
    SAVED_SESSION_LIST_RETENTION,
    SAVED_SESSION_LISTS_PER_DEVICE,
    SavedSessionList,
)
from app.models.user import User
from app.schemas.saved_session_lists import SAVED_SESSION_LIST_TITLE_MAX_LENGTH
from app.services import coord_session_status, runner_relay
from app.services.runner import RunnerCommandTimeoutError

API = "/api/v1/saved-session-lists"
WORK_STATUS_PATH = "/coord/sessions/work-status"

DEVICE = UUID("5a5a5a5a-1111-4111-8111-5a5a5a5a5a5a")
OTHER_DEVICE = UUID("6b6b6b6b-2222-4222-8222-6b6b6b6b6b6b")
NOT_OWNED_DEVICE = UUID("7c7c7c7c-3333-4333-8333-7c7c7c7c7c7c")

SID_FINISHED = "0f0f0f0f-aaaa-4aaa-8aaa-0f0f0f0f0f0f"
SID_WORKING = "1e1e1e1e-bbbb-4bbb-8bbb-1e1e1e1e1e1e"
SID_FOREIGN = "2d2d2d2d-cccc-4ccc-8ccc-2d2d2d2d2d2d"

T0 = datetime(2026, 11, 8, 10, 0, 0, tzinfo=UTC)

# The runner's relay-allowlist refusal, verbatim
# (qontinui-runner relay_path_policy.rs RelayPathVerdict::NotAllowed).
RUNNER_NOT_CARRIED = (
    "this path is not carried by the HTTP relay — the relay serves a closed set "
    "of routes, and terminal creation, input and teardown go through the typed "
    "relay frames, which carry the create/attach gate"
)

pytestmark = pytest.mark.asyncio


# ===========================================================================
# Fixtures and builders
# ===========================================================================


def _session(
    terminal_id: str, claude_session_id: str | None, **overrides: Any
) -> dict[str, Any]:
    confirmed = claude_session_id is not None
    session: dict[str, Any] = {
        "terminalId": terminal_id,
        "title": f"title {terminal_id}" if confirmed else None,
        "titleWithheld": False,
        "isAlive": True,
        "spawnName": f"spawn-{terminal_id}" if confirmed else None,
        "claudeSessionId": claude_session_id,
        "accountLabel": "susanne" if confirmed else None,
        "sessionName": f"name {terminal_id}" if confirmed else None,
        "zoneIndex": 0 if confirmed else None,
        "finished": False if confirmed else None,
        "finishedAt": None,
        "finishReason": None,
    }
    session.update(overrides)
    return session


def _layout(**overrides: Any) -> dict[str, Any]:
    """A runner ``GET /terminal-layout`` body: two tabs, three terminals."""
    layout: dict[str, Any] = {
        "runner": {
            "instanceName": "primary",
            "port": 9876,
            "buildId": "build-2026-11-08",
            "deviceId": str(DEVICE),
        },
        "labelsRegistered": True,
        "capturedAt": "2026-11-08T09:59:58Z",
        "pages": [
            {
                "pageId": "page-a",
                "label": "Fleet",
                "order": 0,
                "sessions": [
                    _session(
                        "t-1",
                        SID_FINISHED,
                        finished=True,
                        finishedAt="2026-11-08T09:00:00Z",
                        finishReason="work complete",
                    ),
                    _session("t-2", SID_WORKING),
                ],
            },
            {
                "pageId": "page-b",
                "label": None,
                "order": None,
                # A plain shell: listed, every session field null.
                "sessions": [_session("t-3", None, titleWithheld=True)],
            },
        ],
    }
    layout.update(overrides)
    return layout


def _reply(status: int, body: bytes | dict[str, Any]) -> dict[str, Any]:
    raw = json.dumps(body).encode() if isinstance(body, dict) else body
    return {
        "type": "command_response",
        "status": status,
        "headers": {"content-type": "application/json", "connection": "keep-alive"},
        "body_b64": base64.b64encode(raw).decode("ascii") if raw else "",
    }


def _work_status(
    statuses: dict[str, str | None],
    *,
    unknown: Sequence[str] = (),
    bridge: bool = True,
) -> dict[str, Any]:
    """coord's ``GET /coord/sessions/work-status`` body."""
    return {
        "statuses": {
            sid: {
                "session_status": value,
                "since": None,
                "coord_session_id": str(uuid4()),
                "state": "active",
            }
            for sid, value in statuses.items()
        },
        "unknown": list(unknown),
        "invalid": [],
        "accepted": len(statuses) + len(unknown),
        "input_truncated": False,
        "sessionBridgeColumnPresent": bridge,
    }


@dataclass
class Harness:
    """The stubbed world one test runs in, and what each stub saw."""

    db: AsyncSession
    user: User
    client: httpx.AsyncClient | None = None
    now: datetime = T0
    # device -> ws_session_id; None = owned but not connected. Absent = not owned.
    owned: dict[UUID, int | None] = field(
        default_factory=lambda: {DEVICE: 41, OTHER_DEVICE: 42}
    )
    liveness: dict[str, Any] = field(
        default_factory=lambda: {
            "ws_connected_at": "2026-11-08T08:00:00+00:00",
            "last_seen_at": "2026-11-08T09:58:00+00:00",
        }
    )
    dispatch: AsyncMock = field(default_factory=AsyncMock)
    work_status: Callable[[list[str]], httpx.Response] = field(
        default=lambda ids: httpx.Response(200, json=_work_status({}, unknown=ids))
    )
    work_status_calls: list[dict[str, Any]] = field(default_factory=list)
    routing_calls: list[UUID] = field(default_factory=list)
    # Raised by coord's routing read instead of answering, when set.
    routing_error: Exception | None = None
    list_devices_calls: int = 0

    @property
    def http(self) -> httpx.AsyncClient:
        assert self.client is not None
        return self.client


def _install_world(h: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import coord_device
    from app.services import runner_websocket_manager as mgr_mod

    async def _routing(device_id, *, bearer, user_id):
        device = UUID(str(device_id))
        h.routing_calls.append(device)
        if h.routing_error is not None:
            raise h.routing_error
        if device not in h.owned:
            return None
        return {"device_id": str(device), "ws_session_id": h.owned[device]}

    async def _owned_with_bearer(device_id, *, bearer, user_id):
        return {"device_id": str(device_id), **h.liveness}

    async def _list_devices(request, user_id):
        h.list_devices_calls += 1
        return [{"device_id": str(d), "user_id": user_id} for d in h.owned]

    monkeypatch.setattr(coord_device, "get_device_routing", _routing)
    monkeypatch.setattr(
        coord_device, "get_owned_device_with_bearer", _owned_with_bearer
    )
    monkeypatch.setattr(coord_device, "list_devices_for_user", _list_devices)

    relay = MagicMock()
    relay.dispatch_and_wait = h.dispatch
    monkeypatch.setattr(runner_relay, "get_redis", AsyncMock(return_value=MagicMock()))
    monkeypatch.setattr(
        mgr_mod,
        "get_runner_websocket_manager",
        AsyncMock(return_value=SimpleNamespace(relay=relay)),
    )

    real_get = httpx.AsyncClient.get

    async def _get(self, url, *args, **kwargs):
        if WORK_STATUS_PATH not in str(url):
            return await real_get(self, url, *args, **kwargs)
        ids = kwargs["params"]["claude_code_session_ids"].split(",")
        h.work_status_calls.append({"ids": ids, "headers": kwargs.get("headers") or {}})
        return h.work_status(ids)

    monkeypatch.setattr(httpx.AsyncClient, "get", _get)
    monkeypatch.setattr(endpoints, "utc_now", lambda: h.now)


def _app(h: Harness) -> FastAPI:
    """The saved-session-lists router with the production error handlers,
    so refusals carry the body a client sees."""
    app = FastAPI()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]

    async def _db() -> AsyncIterator[AsyncSession]:
        yield h.db

    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[current_active_user] = lambda: h.user
    app.include_router(endpoints.router, prefix=API)
    return app


@pytest_asyncio.fixture()
async def h(
    async_db_session: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[Harness]:
    harness = Harness(db=async_db_session, user=test_user)
    _install_world(harness, monkeypatch)
    transport = httpx.ASGITransport(app=_app(harness))
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": "Bearer caller-token"},
    ) as client:
        harness.client = client
        yield harness


async def _rows(h: Harness, device: UUID | None = None) -> list[SavedSessionList]:
    stmt = select(SavedSessionList).order_by(SavedSessionList.captured_at)
    if device is not None:
        stmt = stmt.where(SavedSessionList.device_id == device)
    return list((await h.db.execute(stmt)).scalars().all())


async def _capture(h: Harness, body: dict[str, Any] | None = None) -> httpx.Response:
    return await h.http.post(API, json=body or {"device_id": str(DEVICE)})


def _refusal(resp: httpx.Response) -> dict[str, Any]:
    return resp.json()["refusal"]


# ===========================================================================
# Layer 1 — the coord work-status client
# ===========================================================================


def _patch_work_status_http(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[list[str]], httpx.Response | Exception],
) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    async def _get(self, url, *args, **kwargs):
        ids = kwargs["params"]["claude_code_session_ids"].split(",")
        calls.append({"url": str(url), "ids": ids, "headers": kwargs["headers"]})
        answer = handler(ids)
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(httpx.AsyncClient, "get", _get)
    return calls


class TestCoordWorkStatusClient:
    async def test_each_id_gets_its_own_answer(self, monkeypatch) -> None:
        calls = _patch_work_status_http(
            monkeypatch,
            lambda ids: httpx.Response(
                200,
                json=_work_status(
                    {SID_FINISHED: "finished", SID_WORKING: None},
                    unknown=[SID_FOREIGN],
                ),
            ),
        )
        answers = await coord_session_status.read_work_status(
            [SID_FINISHED, SID_WORKING, SID_FOREIGN, "not-a-uuid", SID_FINISHED],
            bearer="caller-token",
            user_id="u-1",
        )
        assert answers[SID_FINISHED].as_json() == {"value": "finished", "read": "ok"}
        # The row exists and its work axis is unset: an answer, not unknown.
        assert answers[SID_WORKING].as_json() == {"value": None, "read": "ok"}
        assert answers[SID_FOREIGN].as_json() == {"value": None, "read": "unknown"}
        # Not a UUID: coord would call it invalid, so it is not even sent.
        assert answers["not-a-uuid"].as_json() == {"value": None, "read": "unknown"}
        assert len(calls) == 1
        assert calls[0]["url"].endswith(WORK_STATUS_PATH)
        assert sorted(calls[0]["ids"]) == sorted(
            [SID_FINISHED, SID_WORKING, SID_FOREIGN]
        )
        assert calls[0]["headers"]["Authorization"] == "Bearer caller-token"

    async def test_ids_are_matched_in_coords_canonical_form(self, monkeypatch) -> None:
        _patch_work_status_http(
            monkeypatch,
            lambda ids: httpx.Response(
                200, json=_work_status({SID_FINISHED: "finished"})
            ),
        )
        upper = SID_FINISHED.upper()
        answers = await coord_session_status.read_work_status(
            [upper], bearer="t", user_id="u"
        )
        # Keyed by the id exactly as given, answered by coord's lowercase key.
        assert answers[upper].as_json() == {"value": "finished", "read": "ok"}

    async def test_no_bridge_column_makes_every_id_unknown(self, monkeypatch) -> None:
        _patch_work_status_http(
            monkeypatch,
            lambda ids: httpx.Response(
                200, json=_work_status({SID_FINISHED: "finished"}, bridge=False)
            ),
        )
        answers = await coord_session_status.read_work_status(
            [SID_FINISHED], bearer="t", user_id="u"
        )
        assert answers[SID_FINISHED].read == "unknown"

    @pytest.mark.parametrize(
        "answer",
        [
            httpx.ConnectError("coord down"),
            httpx.ReadTimeout("slow"),
            httpx.Response(500, json={"error": "boom"}),
            httpx.Response(401, json={"error": "unauthorized"}),
            httpx.Response(200, text="not json"),
            httpx.Response(200, json=["not", "an", "object"]),
        ],
        ids=["connect", "timeout", "5xx", "401", "non-json", "non-object"],
    )
    async def test_a_failed_read_is_failed_for_every_id(
        self, monkeypatch, answer
    ) -> None:
        _patch_work_status_http(monkeypatch, lambda ids: answer)
        answers = await coord_session_status.read_work_status(
            [SID_FINISHED, SID_WORKING], bearer="t", user_id="u"
        )
        assert {a.read for a in answers.values()} == {"failed"}
        assert {a.value for a in answers.values()} == {None}

    async def test_no_bearer_fails_without_a_call(self, monkeypatch) -> None:
        calls = _patch_work_status_http(
            monkeypatch, lambda ids: httpx.Response(200, json=_work_status({}))
        )
        answers = await coord_session_status.read_work_status(
            [SID_FINISHED], bearer=None, user_id="u"
        )
        assert answers[SID_FINISHED].read == "failed"
        assert calls == []

    async def test_more_ids_than_one_call_takes_are_chunked(self, monkeypatch) -> None:
        ids = [str(uuid4()) for _ in range(coord_session_status.MAX_IDS_PER_CALL + 1)]
        calls = _patch_work_status_http(
            monkeypatch,
            lambda chunk: httpx.Response(
                200, json=_work_status(dict.fromkeys(chunk, "finished"))
            ),
        )
        answers = await coord_session_status.read_work_status(
            ids, bearer="t", user_id="u"
        )
        assert [len(c["ids"]) for c in calls] == [
            coord_session_status.MAX_IDS_PER_CALL,
            1,
        ]
        assert {a.read for a in answers.values()} == {"ok"}
        assert len(answers) == len(ids)

    async def test_nothing_to_ask_makes_no_call(self, monkeypatch) -> None:
        calls = _patch_work_status_http(
            monkeypatch, lambda ids: httpx.Response(200, json=_work_status({}))
        )
        assert (
            await coord_session_status.read_work_status([], bearer="t", user_id="u")
            == {}
        )
        assert calls == []


# ===========================================================================
# Layer 2 — the capture
# ===========================================================================


class TestCapture:
    async def test_happy_path_stores_what_the_runner_said(self, h: Harness) -> None:
        h.dispatch.return_value = _reply(200, _layout())
        h.work_status = lambda ids: httpx.Response(
            200, json=_work_status({SID_FINISHED: "finished", SID_WORKING: None})
        )

        resp = await _capture(
            h, {"device_id": str(DEVICE), "title": "  before rebuild "}
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["device_id"] == str(DEVICE)
        assert body["title"] == "before rebuild"
        # As REPORTED by the runner (layout.runner), never caller input.
        assert body["runner_instance"] == "primary"
        assert body["runner_port"] == 9876
        assert body["runner_build_id"] == "build-2026-11-08"
        assert body["tab_count"] == 2
        assert body["session_count"] == 3
        assert body["created_by_user_id"] == str(h.user.id)
        assert body["created_by_name"] == h.user.full_name
        # Server clock, not the runner's capturedAt; retention exactly 14 days.
        captured = datetime.fromisoformat(body["captured_at"])
        expires = datetime.fromisoformat(body["expires_at"])
        assert captured == T0
        assert expires - captured == timedelta(days=14)
        assert body["layout"]["capturedAt"] == "2026-11-08T09:59:58Z"
        assert [p["pageId"] for p in body["layout"]["pages"]] == ["page-a", "page-b"]
        assert body["coord_status"] == {
            SID_FINISHED: {"value": "finished", "read": "ok"},
            SID_WORKING: {"value": None, "read": "ok"},
        }

        # One relay frame: a GET of /terminal-layout carrying none of the
        # caller's credentials.
        assert h.dispatch.await_count == 1
        sent_device, envelope = h.dispatch.await_args.args
        assert sent_device == str(DEVICE)
        assert envelope["type"] == "http_request"
        assert envelope["method"] == "GET"
        assert envelope["path"] == "terminal-layout"
        assert envelope["body_b64"] == ""
        assert envelope["headers"] == {"accept": "application/json"}
        assert h.dispatch.await_args.kwargs["require_local_connection"] is False
        # coord was asked about the two confirmed sessions only, with the
        # caller's own bearer.
        assert len(h.work_status_calls) == 1
        assert sorted(h.work_status_calls[0]["ids"]) == sorted(
            [SID_FINISHED, SID_WORKING]
        )
        assert (
            h.work_status_calls[0]["headers"]["Authorization"] == "Bearer caller-token"
        )

        [row] = await _rows(h)
        assert str(row.id) == body["id"]
        assert row.captured_at == T0
        assert row.expires_at == T0 + SAVED_SESSION_LIST_RETENTION
        assert row.created_by_user_id == h.user.id
        stored = dict(row.layout)
        assert stored.pop("coordStatus") == body["coord_status"]
        assert stored == _layout()

    async def test_a_field_the_schema_does_not_know_is_accepted_and_kept(
        self, h: Harness
    ) -> None:
        layout = _layout(futureTopLevel={"x": 1})
        layout["pages"][0]["sessions"][0]["futureSessionField"] = "kept"
        h.dispatch.return_value = _reply(200, layout)

        resp = await _capture(h)

        assert resp.status_code == 201, resp.text
        [row] = await _rows(h)
        assert row.layout["futureTopLevel"] == {"x": 1}
        assert row.layout["pages"][0]["sessions"][0]["futureSessionField"] == "kept"
        # Served through the generated model, which declares neither.
        assert "futureTopLevel" not in resp.json()["layout"]

    @pytest.mark.parametrize(
        "mutate",
        [
            lambda body: body.pop("pages"),
            # Not a value pydantic's lax mode coerces to a bool ("yes" would be).
            lambda body: body.update(labelsRegistered=[1]),
            lambda body: body["pages"][0]["sessions"][0].pop("titleWithheld"),
            lambda body: body["runner"].update(port=70000),
            # The runner serves an unzoned tile as null, never its internal -1
            # (D3), and the schema says so: a negative zone or order is refused.
            lambda body: body["pages"][0]["sessions"][0].update(zoneIndex=-1),
            lambda body: body["pages"][0].update(order=-1),
        ],
        ids=[
            "missing-pages",
            "bool-as-list",
            "missing-required-bool",
            "port-range",
            "negative-zone-index",
            "negative-order",
        ],
    )
    async def test_a_malformed_layout_is_refused_and_nothing_stored(
        self, h: Harness, mutate
    ) -> None:
        body = _layout()
        mutate(body)
        h.dispatch.return_value = _reply(200, body)

        resp = await _capture(h)

        assert resp.status_code == 502, resp.text
        refusal = _refusal(resp)
        assert refusal["discriminator"] == "runner_layout_invalid"
        assert refusal["next_action"]["kind"] == "report_defect"
        assert "TerminalLayout" in refusal["detail"]
        assert await _rows(h) == []
        assert h.work_status_calls == []

    @pytest.mark.parametrize(
        "raw", [b"not json", b"[1, 2]", b""], ids=["text", "array", "empty"]
    )
    async def test_a_body_that_is_not_a_json_object_is_invalid(
        self, h: Harness, raw
    ) -> None:
        h.dispatch.return_value = _reply(200, raw)
        resp = await _capture(h)
        assert resp.status_code == 502
        assert _refusal(resp)["discriminator"] == "runner_layout_invalid"
        assert await _rows(h) == []

    async def test_an_undecodable_reply_is_invalid(self, h: Harness) -> None:
        # Bad padding: the one base64 fault the relay's lenient decode raises on.
        h.dispatch.return_value = {"status": 200, "headers": {}, "body_b64": "abc"}
        resp = await _capture(h)
        assert resp.status_code == 502
        assert _refusal(resp)["discriminator"] == "runner_layout_invalid"

    async def test_a_body_nested_past_the_parsers_limit_is_invalid_not_a_500(
        self, h: Harness
    ) -> None:
        """json.loads recurses per nesting level, so a body nested past the
        interpreter's recursion limit raises RecursionError while parsing."""
        depth = 100_000
        raw = (
            json.dumps(_layout())[:-1] + ', "deep": ' + "[" * depth + "]" * depth + "}"
        )
        h.dispatch.return_value = _reply(200, raw.encode())

        resp = await _capture(h)

        assert resp.status_code == 502, resp.text
        refusal = _refusal(resp)
        assert refusal["discriminator"] == "runner_layout_invalid"
        assert "nests too deeply to read" in refusal["detail"]
        assert await _rows(h) == []

    async def test_a_body_nested_past_the_layout_cap_is_invalid(
        self, h: Harness
    ) -> None:
        """Parseable, but deeper than MAX_LAYOUT_DEPTH: refused before it can
        recurse when it is serialised for the insert."""
        depth = endpoints.MAX_LAYOUT_DEPTH + 50
        layout = _layout()
        nested: Any = []
        for _ in range(depth):
            nested = [nested]
        layout["deep"] = nested
        h.dispatch.return_value = _reply(200, layout)

        resp = await _capture(h)

        assert resp.status_code == 502, resp.text
        refusal = _refusal(resp)
        assert refusal["discriminator"] == "runner_layout_invalid"
        assert (
            f"nests deeper than {endpoints.MAX_LAYOUT_DEPTH} levels"
            in refusal["detail"]
        )
        assert await _rows(h) == []

    async def test_a_newer_runners_nested_field_within_the_cap_is_kept(
        self, h: Harness
    ) -> None:
        # The root object is level 1 and "deep" sits at level 2, so the
        # innermost value, "leaf", sits exactly at the cap.
        layout = _layout()
        nested: Any = ["leaf"]
        for _ in range(endpoints.MAX_LAYOUT_DEPTH - 3):
            nested = [nested]
        layout["deep"] = nested
        h.dispatch.return_value = _reply(200, layout)

        resp = await _capture(h)

        assert resp.status_code == 201, resp.text
        [row] = await _rows(h)
        assert row.layout["deep"] == nested

    @pytest.mark.parametrize(
        ("status", "body"),
        [
            (403, {"error": RUNNER_NOT_CARRIED}),
            (404, {"error": "not found"}),
            (404, b""),
        ],
        ids=["relay-allowlist-403", "route-404", "bare-404"],
    )
    async def test_a_runner_that_predates_terminal_layout_is_labelled(
        self, h: Harness, status, body
    ) -> None:
        h.dispatch.return_value = _reply(status, body)

        resp = await _capture(h)

        assert resp.status_code == 409, resp.text
        payload = resp.json()
        refusal = payload["refusal"]
        assert refusal["discriminator"] == "runner_predates_terminal_layout"
        assert refusal["code"] == "conflict"
        assert refusal["next_action"] == {"kind": "open_page", "target": "/download"}
        assert "predates saved tab lists" in refusal["detail"]
        assert payload["device_id"] == str(DEVICE)
        assert payload["runner_status"] == status
        assert resp.headers["x-qontinui-refusal-origin"] == "web"
        assert await _rows(h) == []

    async def test_another_403_is_a_runner_error_not_predates(self, h: Harness) -> None:
        h.dispatch.return_value = _reply(
            403, {"error": "relay path could not be normalised (traversal) — refused"}
        )
        resp = await _capture(h)
        assert resp.status_code == 502
        assert _refusal(resp)["discriminator"] == "runner_error"

    async def test_egress_off_names_the_switch(self, h: Harness) -> None:
        h.dispatch.return_value = _reply(
            409,
            {
                "error": "egress_off",
                "flow": "terminal_stream",
                "domain": "egress.terminal_stream",
                "message": "Terminal streaming is off for this project",
            },
        )
        resp = await _capture(h)
        assert resp.status_code == 409
        payload = resp.json()
        refusal = payload["refusal"]
        assert refusal["discriminator"] == "runner_egress_off"
        assert refusal["code"] == "permission_denied"
        assert refusal["next_action"] == {
            "kind": "set_setting",
            "target": "Terminal streaming",
        }
        assert refusal["detail"] == "Terminal streaming is off for this project"
        assert payload["flow"] == "terminal_stream"

    @pytest.mark.parametrize(
        ("status", "body"),
        [
            (500, {"error": "internal"}),
            (409, {"error": "some other conflict"}),
            (401, b"nope"),
            (302, b""),
        ],
        ids=["500", "other-409", "401", "redirect"],
    )
    async def test_any_other_non_2xx_is_a_runner_error(
        self, h: Harness, status, body
    ) -> None:
        h.dispatch.return_value = _reply(status, body)
        resp = await _capture(h)
        assert resp.status_code == 502
        refusal = _refusal(resp)
        assert refusal["discriminator"] == "runner_error"
        assert refusal["next_action"]["kind"] == "retry_later"
        assert resp.json()["runner_status"] == status
        assert await _rows(h) == []

    async def test_a_timeout_is_typed(self, h: Harness) -> None:
        h.dispatch.side_effect = RunnerCommandTimeoutError(str(DEVICE), "req", 15.0)
        resp = await _capture(h)
        assert resp.status_code == 504
        refusal = _refusal(resp)
        assert refusal["discriminator"] == "runner_relay_timeout"
        assert refusal["next_action"]["kind"] == "retry_later"
        assert (
            h.dispatch.await_args.kwargs["timeout_s"]
            == endpoints.CAPTURE_RELAY_TIMEOUT_S
        )

    async def test_a_layout_over_the_relay_cap_is_refused(self, h: Harness) -> None:
        big = b"x" * (runner_relay.RELAY_MAX_BODY_BYTES + 1)
        h.dispatch.return_value = _reply(200, big)
        resp = await _capture(h)
        assert resp.status_code == 413
        assert _refusal(resp)["discriminator"] == "runner_layout_too_large"
        assert await _rows(h) == []

    async def test_a_device_the_caller_does_not_own_is_refused_before_any_frame(
        self, h: Harness
    ) -> None:
        resp = await _capture(h, {"device_id": str(NOT_OWNED_DEVICE)})

        assert resp.status_code == 404
        body = resp.json()
        # The relay's OWN 404, passed through — never read as "runner predates".
        assert body["detail"] == "device not found or not owned by caller"
        assert body["device_id"] == str(NOT_OWNED_DEVICE)
        assert body["refusal"]["discriminator"] == "device_not_owned"
        assert body["refusal"]["next_action"] == {"kind": "pair_device"}
        h.dispatch.assert_not_awaited()
        assert await _rows(h) == []

    async def test_a_runner_not_connected_passes_the_relay_503_through(
        self, h: Harness
    ) -> None:
        h.owned[DEVICE] = None

        resp = await _capture(h)

        assert resp.status_code == 503
        body = resp.json()
        assert body["detail"] == "runner not connected"
        assert body["refusal"]["discriminator"] == "runner_not_connected"
        assert body["ws_connected_at"] == "2026-11-08T08:00:00+00:00"
        assert body["last_seen_at"] == "2026-11-08T09:58:00+00:00"
        h.dispatch.assert_not_awaited()

    async def test_a_never_registered_runner_passes_its_503_through(
        self, h: Harness
    ) -> None:
        h.owned[DEVICE] = None
        h.liveness = {"ws_connected_at": None, "last_seen_at": None}

        resp = await _capture(h)

        assert resp.status_code == 503
        refusal = _refusal(resp)
        assert refusal["discriminator"] == "runner_never_registered"
        assert refusal["next_action"] == {
            "kind": "set_setting",
            "target": runner_relay.RELAY_SETTING_TARGET,
        }

    @pytest.mark.parametrize("ws_session_id", [None, "absent"], ids=["503", "404"])
    async def test_the_pass_through_is_byte_for_byte_the_runner_proxy_body(
        self, h: Harness, ws_session_id
    ) -> None:
        """The capture and /runner-proxy render a device refusal through one
        function, so their bodies agree on every field but the per-request
        ones (the request id and the refusal's observed_at)."""
        if ws_session_id == "absent":
            device = NOT_OWNED_DEVICE
        else:
            device = DEVICE
            h.owned[DEVICE] = None

        captured = await _capture(h, {"device_id": str(device)})

        class _Req:
            method = "GET"
            headers = {"X-Qontinui-Device-Id": str(device)}
            cookies: dict[str, str] = {}
            url = SimpleNamespace(query="")
            state = SimpleNamespace()

            async def body(self) -> bytes:
                return b""

        proxied = await device_bridge_ws.runner_proxy(
            _Req(), "terminal-layout", user=SimpleNamespace(id=h.user.id)
        )

        def _normalised(payload: dict[str, Any]) -> dict[str, Any]:
            payload = dict(payload)
            payload.pop("request_id")
            payload["refusal"] = {
                k: v for k, v in payload["refusal"].items() if k != "observed_at"
            }
            return payload

        assert proxied.status_code == captured.status_code
        assert _normalised(json.loads(bytes(proxied.body))) == _normalised(
            captured.json()
        )

    async def test_unknown_request_fields_are_refused(self, h: Harness) -> None:
        resp = await h.http.post(
            API, json={"device_id": str(DEVICE), "runner_port": 9877}
        )
        assert resp.status_code == 422
        h.dispatch.assert_not_awaited()

    async def test_a_blank_title_is_stored_as_null(self, h: Harness) -> None:
        h.dispatch.return_value = _reply(200, _layout())
        resp = await _capture(h, {"device_id": str(DEVICE), "title": "   "})
        assert resp.status_code == 201
        assert resp.json()["title"] is None

    async def test_a_padded_title_is_measured_after_trimming(self, h: Harness) -> None:
        h.dispatch.return_value = _reply(200, _layout())
        longest = "x" * SAVED_SESSION_LIST_TITLE_MAX_LENGTH
        resp = await _capture(
            h, {"device_id": str(DEVICE), "title": f"   {longest}\n "}
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["title"] == longest

    async def test_a_title_too_long_after_trimming_is_refused(self, h: Harness) -> None:
        too_long = " " + "x" * (SAVED_SESSION_LIST_TITLE_MAX_LENGTH + 1) + " "
        resp = await _capture(h, {"device_id": str(DEVICE), "title": too_long})
        assert resp.status_code == 422
        h.dispatch.assert_not_awaited()

    async def test_coord_join_records_ok_and_unknown_per_id(self, h: Harness) -> None:
        layout = _layout()
        layout["pages"][1]["sessions"].append(_session("t-4", SID_FOREIGN))
        h.dispatch.return_value = _reply(200, layout)
        h.work_status = lambda ids: httpx.Response(
            200,
            json=_work_status(
                {SID_FINISHED: "finished", SID_WORKING: "working"},
                unknown=[SID_FOREIGN],
            ),
        )

        resp = await _capture(h)

        assert resp.status_code == 201, resp.text
        assert resp.json()["coord_status"] == {
            SID_FINISHED: {"value": "finished", "read": "ok"},
            SID_WORKING: {"value": "working", "read": "ok"},
            # Another tenant's session, or one coord never registered.
            SID_FOREIGN: {"value": None, "read": "unknown"},
        }

    async def test_a_failed_coord_read_is_recorded_as_failed_not_unfinished(
        self, h: Harness
    ) -> None:
        h.dispatch.return_value = _reply(200, _layout())
        h.work_status = lambda ids: httpx.Response(502, json={"error": "upstream"})

        resp = await _capture(h)

        assert resp.status_code == 201, resp.text
        assert resp.json()["coord_status"] == {
            SID_FINISHED: {"value": None, "read": "failed"},
            SID_WORKING: {"value": None, "read": "failed"},
        }
        # The runner marker is still there to fall back on.
        sessions = resp.json()["layout"]["pages"][0]["sessions"]
        assert sessions[0]["finished"] is True

    async def test_a_layout_with_no_sessions_asks_coord_nothing(
        self, h: Harness
    ) -> None:
        h.dispatch.return_value = _reply(200, _layout(pages=[]))
        resp = await _capture(h)
        assert resp.status_code == 201, resp.text
        assert resp.json()["tab_count"] == 0
        assert resp.json()["session_count"] == 0
        assert resp.json()["coord_status"] == {}
        assert h.work_status_calls == []

    async def test_the_runners_own_size_refusal_is_too_large_not_retry(
        self, h: Harness
    ) -> None:
        """The runner caps a relayed response at 8 MiB itself and answers 413
        (qontinui-runner backend_relay.rs). Retrying cannot shrink the layout,
        so it must not read as a retryable runner error."""
        h.dispatch.return_value = _reply(
            413, {"error": "response body exceeds relay size limit"}
        )
        resp = await _capture(h)
        assert resp.status_code == 413
        refusal = _refusal(resp)
        assert refusal["discriminator"] == "runner_layout_too_large"
        assert refusal["next_action"]["kind"] == "report_defect"
        assert "response body exceeds relay size limit" in refusal["detail"]
        assert resp.json()["runner_status"] == 413
        assert await _rows(h) == []

    @pytest.mark.parametrize(
        "where",
        ["value", "key", "unknown-field"],
    )
    @pytest.mark.parametrize(
        "bad",
        ["bad\x00title", "lone\ud800surrogate"],
        ids=["nul", "unpaired-surrogate"],
    )
    async def test_a_layout_postgres_cannot_store_is_refused_not_a_500(
        self, h: Harness, where: str, bad: str
    ) -> None:
        """jsonb refuses U+0000 and an unpaired surrogate (which json.loads
        produces from a lone \\ud800 escape); either would fail the insert."""
        layout = _layout()
        session = layout["pages"][0]["sessions"][0]
        if where == "value":
            session["title"] = bad
        elif where == "key":
            session[bad] = "x"
        else:
            layout["futureField"] = {"nested": [bad]}
        h.dispatch.return_value = _reply(200, layout)

        resp = await _capture(h)

        assert resp.status_code == 502, resp.text
        refusal = _refusal(resp)
        assert refusal["discriminator"] == "runner_layout_invalid"
        assert "cannot be stored" in refusal["detail"]
        assert await _rows(h) == []

    async def test_a_paired_surrogate_escape_is_an_ordinary_character(
        self, h: Harness
    ) -> None:
        layout = _layout()
        layout["pages"][0]["sessions"][0]["title"] = "\U0001f600 rocket"
        h.dispatch.return_value = _reply(200, layout)

        resp = await _capture(h)

        assert resp.status_code == 201, resp.text
        [row] = await _rows(h)
        assert row.layout["pages"][0]["sessions"][0]["title"] == "\U0001f600 rocket"

    @pytest.mark.parametrize(
        "title", ["line\nbreak", "nul\x00byte", "tab\there", "del\x7f"]
    )
    async def test_a_title_with_control_characters_is_refused(
        self, h: Harness, title: str
    ) -> None:
        resp = await h.http.post(API, json={"device_id": str(DEVICE), "title": title})
        assert resp.status_code == 422
        h.dispatch.assert_not_awaited()

    async def test_a_title_with_an_unpaired_surrogate_is_refused(
        self, h: Harness
    ) -> None:
        # Raw bytes: a client JSON encoder would refuse to encode the surrogate.
        raw = b'{"device_id": "%s", "title": "a\\ud800b"}' % str(DEVICE).encode()
        resp = await h.http.post(
            API, content=raw, headers={"content-type": "application/json"}
        )
        assert resp.status_code == 422, resp.text
        h.dispatch.assert_not_awaited()

    async def test_a_device_lookup_failure_passes_the_relay_500_through(
        self, h: Harness
    ) -> None:
        h.routing_error = RuntimeError("unexpected")

        resp = await _capture(h)

        assert resp.status_code == 500
        body = resp.json()
        assert body["detail"] == "device lookup failed"
        assert body["refusal"]["discriminator"] == "device_lookup_failed"
        assert body["refusal"]["next_action"] == {"kind": "report_defect"}
        h.dispatch.assert_not_awaited()

    async def test_a_coord_transport_fault_is_coords_gateway_error(
        self, h: Harness
    ) -> None:
        from fastapi import HTTPException

        h.routing_error = HTTPException(
            status_code=504, detail="timeout waiting for coord"
        )

        resp = await _capture(h)

        # coord_device's own gateway error, rendered verbatim: not a refusal
        # envelope of this route, and never "runner predates".
        assert resp.status_code == 504
        body = resp.json()
        assert body["message"] == "timeout waiting for coord"
        assert "refusal" not in body
        h.dispatch.assert_not_awaited()
        assert await _rows(h) == []

    async def test_the_relay_names_the_capture_as_its_caller(
        self, h: Harness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        events: list[tuple[str, dict[str, Any]]] = []

        class _Recorder:
            def __getattr__(self, _level: str):
                return lambda event, **kw: events.append((event, kw))

        monkeypatch.setattr(runner_relay, "logger", _Recorder())
        h.dispatch.return_value = _reply(200, _layout())

        assert (await _capture(h)).status_code == 201
        relay_lines = [
            kw for event, kw in events if event.startswith("runner_proxy_relay")
        ]
        assert relay_lines, events
        assert {kw["caller"] for kw in relay_lines} == {"saved_session_lists"}

    async def test_a_device_keeps_only_its_newest_lists(self, h: Harness) -> None:
        cap = SAVED_SESSION_LISTS_PER_DEVICE
        for i in range(cap):
            h.db.add(
                _stored_row(h, DEVICE, captured_at=T0 - timedelta(minutes=cap - i))
            )
        for i in range(3):
            h.db.add(
                _stored_row(
                    h, OTHER_DEVICE, captured_at=T0 - timedelta(days=1, minutes=i)
                )
            )
        await h.db.flush()
        oldest = min((await _rows(h, DEVICE)), key=lambda r: r.captured_at)

        h.dispatch.return_value = _reply(200, _layout())
        resp = await _capture(h)

        assert resp.status_code == 201, resp.text
        kept = await _rows(h, DEVICE)
        assert len(kept) == cap
        assert oldest.id not in {r.id for r in kept}
        assert UUID(resp.json()["id"]) in {r.id for r in kept}
        # Another device's lists are untouched.
        assert len(await _rows(h, OTHER_DEVICE)) == 3


def _stored_row(
    h: Harness,
    device: UUID,
    *,
    captured_at: datetime,
    creator: User | None = None,
    title: str | None = None,
) -> SavedSessionList:
    return SavedSessionList(
        id=uuid4(),
        device_id=device,
        runner_instance="primary",
        runner_port=9876,
        runner_build_id="b",
        title=title,
        created_by_user_id=(creator or h.user).id,
        captured_at=captured_at,
        expires_at=captured_at + SAVED_SESSION_LIST_RETENTION,
        tab_count=2,
        session_count=3,
        layout={
            **_layout(),
            "coordStatus": {SID_FINISHED: {"value": "finished", "read": "ok"}},
        },
    )


# ===========================================================================
# Layer 3 — list / get / delete
# ===========================================================================


@pytest_asyncio.fixture()
async def other_user(async_db_session: AsyncSession) -> User:
    user = User(
        email=f"other_{uuid4()}@example.com",
        username=f"other_{uuid4().hex[:8]}",
        full_name=None,
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


class TestReads:
    async def test_list_shows_unexpired_lists_on_owned_devices_newest_first(
        self, h: Harness, other_user: User
    ) -> None:
        newest = _stored_row(
            h, DEVICE, captured_at=T0 - timedelta(hours=1), title="new"
        )
        older = _stored_row(
            h, OTHER_DEVICE, captured_at=T0 - timedelta(days=3), creator=other_user
        )
        expired = _stored_row(h, DEVICE, captured_at=T0 - timedelta(days=15))
        foreign = _stored_row(
            h, NOT_OWNED_DEVICE, captured_at=T0 - timedelta(minutes=5)
        )
        h.db.add_all([newest, older, expired, foreign])
        await h.db.flush()

        resp = await h.http.get(API)

        assert resp.status_code == 200, resp.text
        listed = resp.json()
        assert [item["id"] for item in listed] == [str(newest.id), str(older.id)]
        first = listed[0]
        assert "layout" not in first and "coord_status" not in first
        assert first["title"] == "new"
        assert first["created_by_name"] == h.user.full_name
        assert datetime.fromisoformat(first["expires_at"]) == newest.expires_at
        # Another user created it: shown by username when there is no full name.
        assert listed[1]["created_by_user_id"] == str(other_user.id)
        assert listed[1]["created_by_name"] == other_user.username

    async def test_list_makes_one_coord_device_read_per_request(
        self, h: Harness
    ) -> None:
        h.db.add_all(
            [
                _stored_row(h, DEVICE, captured_at=T0 - timedelta(hours=1)),
                _stored_row(h, OTHER_DEVICE, captured_at=T0 - timedelta(hours=2)),
            ]
        )
        await h.db.flush()

        resp = await h.http.get(API)

        assert resp.status_code == 200 and len(resp.json()) == 2
        assert h.list_devices_calls == 1
        # The list does not fall back to one ownership read per device.
        assert h.routing_calls == []

    async def test_list_filters_by_device_and_never_widens_past_owned(
        self, h: Harness
    ) -> None:
        mine = _stored_row(h, DEVICE, captured_at=T0 - timedelta(hours=1))
        theirs = _stored_row(h, NOT_OWNED_DEVICE, captured_at=T0 - timedelta(hours=1))
        h.db.add_all([mine, theirs, _stored_row(h, OTHER_DEVICE, captured_at=T0)])
        await h.db.flush()

        only = await h.http.get(API, params={"device_id": str(DEVICE)})
        assert [i["id"] for i in only.json()] == [str(mine.id)]
        # Naming a device the caller does not own lists nothing.
        nothing = await h.http.get(API, params={"device_id": str(NOT_OWNED_DEVICE)})
        assert nothing.status_code == 200 and nothing.json() == []

    async def test_list_with_no_owned_devices_is_empty(self, h: Harness) -> None:
        h.owned.clear()
        h.db.add(_stored_row(h, DEVICE, captured_at=T0))
        await h.db.flush()
        resp = await h.http.get(API)
        assert resp.status_code == 200 and resp.json() == []

    async def test_get_serves_the_layout_and_coord_join(self, h: Harness) -> None:
        row = _stored_row(h, DEVICE, captured_at=T0 - timedelta(days=1))
        h.db.add(row)
        await h.db.flush()

        resp = await h.http.get(f"{API}/{row.id}")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == str(row.id)
        assert (
            body["layout"]["pages"][0]["sessions"][0]["claudeSessionId"] == SID_FINISHED
        )
        assert "coordStatus" not in body["layout"]
        assert body["coord_status"] == {
            SID_FINISHED: {"value": "finished", "read": "ok"}
        }
        # Access was coord's ownership-checked routing read for that device.
        assert h.routing_calls == [DEVICE]

    async def test_get_and_delete_refuse_a_device_the_caller_does_not_own(
        self, h: Harness
    ) -> None:
        row = _stored_row(h, NOT_OWNED_DEVICE, captured_at=T0)
        h.db.add(row)
        await h.db.flush()

        got = await h.http.get(f"{API}/{row.id}")
        gone = await h.http.delete(f"{API}/{row.id}")

        for resp in (got, gone):
            assert resp.status_code == 404
            assert _refusal(resp)["discriminator"] == "saved_session_list_not_found"
        assert len(await _rows(h, NOT_OWNED_DEVICE)) == 1

    async def test_get_of_a_missing_list_is_the_same_404(self, h: Harness) -> None:
        resp = await h.http.get(f"{API}/{uuid4()}")
        assert resp.status_code == 404
        assert _refusal(resp)["discriminator"] == "saved_session_list_not_found"

    async def test_delete_removes_the_list(self, h: Harness) -> None:
        row = _stored_row(h, DEVICE, captured_at=T0)
        h.db.add(row)
        await h.db.flush()

        resp = await h.http.delete(f"{API}/{row.id}")

        assert resp.status_code == 204
        assert resp.content == b""
        assert await _rows(h, DEVICE) == []
        again = await h.http.delete(f"{API}/{row.id}")
        assert again.status_code == 404


# ===========================================================================
# Layer 4 — exact expiry and the purge, under a controlled clock
# ===========================================================================


class TestExpiry:
    async def test_expiry_is_exact_and_the_purge_deletes_at_expires_at(
        self, h: Harness
    ) -> None:
        h.dispatch.return_value = _reply(200, _layout())
        created = await _capture(h)
        assert created.status_code == 201, created.text
        list_id = created.json()["id"]
        expires = T0 + timedelta(days=14)

        # One microsecond before expiry: visible everywhere.
        h.now = expires - timedelta(microseconds=1)
        assert [i["id"] for i in (await h.http.get(API)).json()] == [list_id]
        assert (await h.http.get(f"{API}/{list_id}")).status_code == 200
        early = await cleanup.delete_expired_saved_session_lists(h.db, now=h.now)
        assert (early.table_present, early.deleted) == (True, 0)

        # At expires_at: absent from every read at once, before any purge.
        h.now = expires
        assert (await h.http.get(API)).json() == []
        assert (await h.http.get(f"{API}/{list_id}")).status_code == 404
        assert (await h.http.delete(f"{API}/{list_id}")).status_code == 404
        assert len(await _rows(h, DEVICE)) == 1

        # The purge at that instant makes it actually gone.
        purge = await cleanup.delete_expired_saved_session_lists(h.db, now=h.now)
        assert (purge.table_present, purge.deleted) == (True, 1)
        assert await _rows(h, DEVICE) == []

    async def test_the_purge_leaves_unexpired_lists(self, h: Harness) -> None:
        h.db.add_all(
            [
                _stored_row(h, DEVICE, captured_at=T0 - timedelta(days=15)),
                _stored_row(h, DEVICE, captured_at=T0 - timedelta(days=13)),
            ]
        )
        await h.db.flush()
        purge = await cleanup.delete_expired_saved_session_lists(h.db, now=T0)
        assert purge.deleted == 1
        [left] = await _rows(h, DEVICE)
        assert left.captured_at == T0 - timedelta(days=13)


# ===========================================================================
# Layer 5 — the scheduler registration and the job's failure posture
# ===========================================================================


async def test_the_purge_is_scheduled_hourly_and_at_boot() -> None:
    from app.core import scheduler as scheduler_mod

    task = scheduler_mod.scheduler._tasks["saved_session_lists_cleanup"]  # noqa: SLF001
    # The registered job is THIS purge, not just some task under its name.
    assert task.coro is scheduler_mod._job_saved_session_lists_cleanup  # noqa: SLF001
    assert task.interval_seconds == 3600.0
    assert task.cron is None
    assert task.run_at_boot is True


async def test_the_storage_walk_survives_nesting_past_the_recursion_limit() -> None:
    """The walk is iterative: a structure deeper than Python's recursion limit
    is reported over the cap, never a RecursionError."""
    nested: Any = "leaf"
    for _ in range(sys.getrecursionlimit() * 5):
        nested = [nested]

    problem = endpoints._storage_problem({"deep": nested})  # noqa: SLF001

    assert problem == f"nests deeper than {endpoints.MAX_LAYOUT_DEPTH} levels"
    assert endpoints._storage_problem({"ok": [[["fine"]]]}) is None  # noqa: SLF001


async def test_a_deeply_nested_runner_error_body_is_a_runner_error_not_a_500() -> None:
    """A non-2xx runner answer whose JSON nests past the recursion limit still
    maps to the typed 502 ``runner_error``, never an escaping RecursionError."""
    deep = b"[" * 100_000 + b"]" * 100_000
    reply = runner_relay.Reply(500, {}, deep)

    refusal = endpoints._reply_refusal(reply, uuid4())  # noqa: SLF001

    assert refusal.status_code == 502
    assert endpoints._runner_error_body(deep) == {}  # noqa: SLF001


async def test_the_scheduled_job_runs_the_purge(monkeypatch) -> None:
    """The registered coroutine delegates to the purge entry point."""
    from app.core import scheduler as scheduler_mod

    called: list[str] = []

    async def _fake_cleanup() -> dict[str, Any]:
        called.append("cleanup")
        return {"table_present": True, "deleted": 0, "now": T0.isoformat()}

    monkeypatch.setattr(cleanup, "cleanup_expired_saved_session_lists", _fake_cleanup)

    result = await scheduler_mod._job_saved_session_lists_cleanup()  # noqa: SLF001

    assert called == ["cleanup"]
    assert result["table_present"] is True


async def test_an_absent_table_is_reported_absent_not_zero_deleted() -> None:
    result = MagicMock()
    result.scalar_one.return_value = False
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)

    outcome = await cleanup.delete_expired_saved_session_lists(db, now=T0)

    assert (outcome.table_present, outcome.deleted) == (False, 0)
    # Only the presence probe ran: no DELETE was attempted.
    assert db.execute.await_count == 1


async def test_the_job_reraises_so_health_records_the_failure(monkeypatch) -> None:
    class _Broken:
        async def __aenter__(self):
            raise RuntimeError("database unavailable")

        async def __aexit__(self, *exc: object) -> bool:
            return False

    monkeypatch.setattr(cleanup, "AsyncSessionLocal", lambda: _Broken())
    with pytest.raises(RuntimeError, match="database unavailable"):
        await cleanup.cleanup_expired_saved_session_lists()


async def test_the_job_commits_its_pass(monkeypatch) -> None:
    session = MagicMock()
    session.commit = AsyncMock()

    class _Session:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *exc: object) -> bool:
            return False

    async def _core(db, *, now=None):
        assert db is session
        return cleanup.SavedSessionListPurge(table_present=True, deleted=2, now=T0)

    monkeypatch.setattr(cleanup, "AsyncSessionLocal", lambda: _Session())
    monkeypatch.setattr(cleanup, "delete_expired_saved_session_lists", _core)

    result = await cleanup.cleanup_expired_saved_session_lists()

    assert result == {"table_present": True, "deleted": 2, "now": T0.isoformat()}
    session.commit.assert_awaited_once()


# ===========================================================================
# Layer 6 — the real app
# ===========================================================================


@pytest_asyncio.fixture()
async def real_app_world(
    h: Harness,
) -> AsyncIterator[tuple[FastAPI, Harness]]:
    from app.main import app

    async def _db() -> AsyncIterator[AsyncSession]:
        yield h.db

    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[current_active_user] = lambda: h.user
    try:
        yield app, h
    finally:
        app.dependency_overrides.pop(get_async_db, None)
        app.dependency_overrides.pop(current_active_user, None)


async def test_post_saved_session_lists_through_the_real_app(
    real_app_world: tuple[FastAPI, Harness],
) -> None:
    """The phase's Arming entry point: ``POST /api/v1/saved-session-lists``
    on ``app.main``'s router stack (middleware, mount prefix, error handlers),
    relayed through the real ``runner_relay`` to a stubbed runner, stored in
    Postgres, read back by the real list route."""
    app, h = real_app_world
    h.dispatch.return_value = _reply(200, _layout())
    h.work_status = lambda ids: httpx.Response(
        200, json=_work_status({SID_FINISHED: "finished"}, unknown=[SID_WORKING])
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": "Bearer caller-token"},
    ) as http:
        created = await http.post(
            "/api/v1/saved-session-lists",
            json={"device_id": str(DEVICE), "title": "real app"},
        )
        assert created.status_code == 201, created.text
        listed = await http.get("/api/v1/saved-session-lists")
        refused = await http.post(
            "/api/v1/saved-session-lists", json={"device_id": str(NOT_OWNED_DEVICE)}
        )

    body = created.json()
    assert body["title"] == "real app"
    assert body["coord_status"] == {
        SID_FINISHED: {"value": "finished", "read": "ok"},
        SID_WORKING: {"value": None, "read": "unknown"},
    }
    [row] = await _rows(h, DEVICE)
    assert str(row.id) == body["id"]
    assert row.layout["runner"]["buildId"] == "build-2026-11-08"
    assert [i["id"] for i in listed.json()] == [body["id"]]
    # The real stack's request id is the middleware's, echoed in the header.
    assert refused.status_code == 404
    assert refused.json()["request_id"] == refused.headers["x-request-id"]
    assert h.dispatch.await_count == 1


async def test_the_routes_are_mounted_on_the_real_app() -> None:
    from fastapi.routing import APIRoute

    from app.main import app

    routes = {
        (method, route.path)
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith(API)
        for method in route.methods or ()
    }
    assert routes == {
        ("POST", API),
        ("GET", API),
        ("GET", f"{API}/{{list_id}}"),
        ("DELETE", f"{API}/{{list_id}}"),
    }


async def test_the_table_exists_in_the_project_schema(
    async_db_session: AsyncSession,
) -> None:
    present = (
        await async_db_session.execute(
            select(func.to_regclass("project.saved_session_lists").is_not(None))
        )
    ).scalar_one()
    assert present is True
