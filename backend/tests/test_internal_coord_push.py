"""Tests for ``POST /api/v1/internal/coord-push`` and the result-returning sender.

Plan ``2026-10-12-operator-action-items-pushed-to-the-phone`` Phase 3. What
must hold, each with the mutation that turns it red:

* the shared secret is the only gate: unset -> 401, wrong -> 401, absent
  header -> 401, right -> 200 (dropping the empty-secret check, or comparing
  with ``==`` on an empty configured value, fails);
* the body is ``extra="forbid"`` and bounded (1-50 users, title <= 200,
  title <= 200 chars / 600 bytes, body <= 1000 bytes, data <= 1024 bytes of
  UTF-8 JSON, priority high|default), and carries no ``category`` /
  ``channel_id`` (plan D7);
* no active tokens -> ``devices: 0`` and Expo is never called;
* a ticket mix is counted positionally: ``ok`` -> accepted, errors -> failed,
  and ONLY the ``DeviceNotRegistered`` token is deactivated;
* a network error / non-200 marks every message failed with a reason.

No live Expo and no DB: Expo is an ``httpx.MockTransport``, the session a fake.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql.dml import Update

from app.api.deps import get_async_db
from app.api.v1.endpoints import internal
from app.core.config import settings
from app.services import push_notifications

SECRET = "s3cret-coord-web"
URL = "/api/v1/internal/coord-push"


class _Rows:
    def __init__(self, rows: list[tuple[UUID, str]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[UUID, str]]:
        return self._rows


class _UpdateResult:
    def __init__(self, rowcount: int) -> None:
        self.rowcount = rowcount


class FakeSession:
    """Answers the token SELECT from ``devices`` and records every UPDATE."""

    def __init__(
        self, devices: list[tuple[UUID, str]], *, update_raises: bool = False
    ) -> None:
        self.devices = devices
        self.update_raises = update_raises
        self.selects: list[Any] = []
        self.updates: list[Any] = []
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, stmt: Any) -> Any:
        if isinstance(stmt, Update):
            self.updates.append(stmt)
            if self.update_raises:
                raise RuntimeError("deadlock detected")
            params = stmt.compile(dialect=postgresql.dialect()).params
            tokens = next(v for v in params.values() if isinstance(v, list))
            return _UpdateResult(len(tokens))
        self.selects.append(stmt)
        return _Rows(self.devices)

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


def _deactivated_tokens(session: FakeSession) -> list[str]:
    assert len(session.updates) == 1
    params = session.updates[0].compile(dialect=postgresql.dialect()).params
    assert params.get("is_active") is False
    return next(v for v in params.values() if isinstance(v, list))


@pytest.fixture
def expo(monkeypatch: pytest.MonkeyPatch):
    """Route the sender's ``httpx.AsyncClient`` to a scripted Expo."""
    state: dict[str, Any] = {"handler": None, "requests": []}

    def handler(request: httpx.Request) -> httpx.Response:
        state["requests"].append(json.loads(request.content))
        return state["handler"](request)

    real_client = httpx.AsyncClient

    class _Httpx:
        AsyncClient = staticmethod(
            lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)
        )

    monkeypatch.setattr(push_notifications, "httpx", _Httpx)
    return state


def _app(session: FakeSession) -> FastAPI:
    app = FastAPI()
    app.include_router(internal.router, prefix="/api/v1/internal")

    async def _db():
        yield session

    app.dependency_overrides[get_async_db] = _db
    return app


def _body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "user_ids": [str(uuid4())],
        "title": "Route High and Medium plans to Opus",
        "body": "web#1780 is deployed.",
        "data": {"url": "qontinui://coord/actions/x", "type": "operator_action_item"},
        "priority": "high",
        "collapse_id": "operator-action-x",
    }
    body.update(overrides)
    return body


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "COORD_WEB_SERVICE_SECRET", SECRET)


class TestSecret:
    def test_unset_secret_refuses_even_an_empty_header(self, monkeypatch, expo):
        monkeypatch.setattr(settings, "COORD_WEB_SERVICE_SECRET", "")
        client = TestClient(_app(FakeSession([])))
        assert client.post(URL, json=_body()).status_code == 401
        resp = client.post(URL, json=_body(), headers={"X-Coord-Service-Secret": ""})
        assert resp.status_code == 401
        assert expo["requests"] == []

    def test_wrong_secret_is_401(self, configured, expo):
        resp = TestClient(_app(FakeSession([]))).post(
            URL, json=_body(), headers={"X-Coord-Service-Secret": "nope"}
        )
        assert resp.status_code == 401
        assert expo["requests"] == []

    def test_missing_header_is_401(self, configured):
        assert (
            TestClient(_app(FakeSession([]))).post(URL, json=_body()).status_code == 401
        )

    def test_right_secret_is_200(self, configured):
        resp = TestClient(_app(FakeSession([]))).post(
            URL, json=_body(), headers={"X-Coord-Service-Secret": SECRET}
        )
        assert resp.status_code == 200


class TestBodyValidation:
    @pytest.mark.parametrize(
        "overrides",
        [
            {"user_ids": []},
            {"user_ids": [str(uuid4()) for _ in range(51)]},
            {"user_ids": ["not-a-uuid"]},
            {"title": ""},
            {"title": "x" * 201},
            {"body": "x" * 1001},
            {"data": {"blob": "x" * 1100}},
            # Byte bounds, not character bounds: 4-byte characters.
            {"title": "\U0001f600" * 151},
            {"body": "\U0001f600" * 251},
            {"data": {"blob": "\U0001f600" * 256}},
            {"priority": "urgent"},
            {"data": "not-an-object"},
            {"category": "operator_action"},
            {"channel_id": "operator-actions"},
        ],
    )
    def test_rejects(self, configured, expo, overrides):
        resp = TestClient(_app(FakeSession([]))).post(
            URL,
            json=_body(**overrides),
            headers={"X-Coord-Service-Secret": SECRET},
        )
        assert resp.status_code == 422, overrides
        assert expo["requests"] == []

    def test_accepts_the_bounds(self, configured):
        resp = TestClient(_app(FakeSession([]))).post(
            URL,
            json=_body(
                user_ids=[str(uuid4()) for _ in range(50)],
                title="x" * 200,
                body="x" * 1000,
                data={"blob": "x" * 1000},
                priority="default",
                collapse_id=None,
            ),
            headers={"X-Coord-Service-Secret": SECRET},
        )
        assert resp.status_code == 200


class TestByteBounds:
    def test_non_ascii_is_measured_in_utf8_not_escaped_json(self, configured):
        # 300 two-byte characters: 600 UTF-8 bytes of JSON, but 1800+ bytes
        # if measured as \\uXXXX escapes. It must be accepted.
        resp = TestClient(_app(FakeSession([]))).post(
            URL,
            json=_body(
                title="\u00e9" * 200,
                body="\u00e9" * 500,
                data={"t": "\u00e9" * 300},
            ),
            headers={"X-Coord-Service-Secret": SECRET},
        )
        assert resp.status_code == 200, resp.text


class TestDelivery:
    def test_no_tokens_is_devices_zero_and_expo_untouched(self, configured, expo):
        resp = TestClient(_app(FakeSession([]))).post(
            URL, json=_body(), headers={"X-Coord-Service-Secret": SECRET}
        )
        assert resp.json() == {
            "users": 0,
            "devices": 0,
            "accepted": 0,
            "failed": 0,
            "deactivated": 0,
            "errors": [],
        }
        assert expo["requests"] == []

    def test_ticket_mix_counts_and_deactivates_only_the_dead_token(
        self, configured, expo
    ):
        u1, u2 = uuid4(), uuid4()
        session = FakeSession(
            [
                (u1, "ExponentPushToken[a]"),
                (u1, "ExponentPushToken[b]"),
                (u2, "ExponentPushToken[c]"),
            ]
        )
        expo["handler"] = lambda _req: httpx.Response(
            200,
            json={
                "data": [
                    {"status": "ok", "id": "t1"},
                    {
                        "status": "error",
                        "message": "not a registered device",
                        "details": {"error": "DeviceNotRegistered"},
                    },
                    {
                        "status": "error",
                        "message": "rate exceeded",
                        "details": {"error": "MessageRateExceeded"},
                    },
                ]
            },
        )
        resp = TestClient(_app(session)).post(
            URL,
            json=_body(user_ids=[str(u1), str(u2), str(u1)]),
            headers={"X-Coord-Service-Secret": SECRET},
        )
        assert resp.status_code == 200
        assert resp.json() == {
            "users": 2,
            "devices": 3,
            "accepted": 1,
            "failed": 2,
            "deactivated": 1,
            "errors": ["not a registered device", "rate exceeded"],
        }
        assert _deactivated_tokens(session) == ["ExponentPushToken[b]"]
        assert session.commits == 1

        sent = expo["requests"][0]
        assert [m["to"] for m in sent] == [
            "ExponentPushToken[a]",
            "ExponentPushToken[b]",
            "ExponentPushToken[c]",
        ]
        # D7: no channel, no category on the wire.
        for message in sent:
            assert "channelId" not in message
            assert "categoryId" not in message
            assert message["priority"] == "high"
            assert message["_collapseId"] == "operator-action-x"
            assert message["data"]["type"] == "operator_action_item"

    def test_non_200_marks_everything_failed(self, configured, expo):
        expo["handler"] = lambda _req: httpx.Response(503, text="upstream down")
        session = FakeSession([(uuid4(), "ExponentPushToken[a]")])
        resp = TestClient(_app(session)).post(
            URL, json=_body(), headers={"X-Coord-Service-Secret": SECRET}
        )
        body = resp.json()
        assert resp.status_code == 200
        assert (body["devices"], body["accepted"], body["failed"]) == (1, 0, 1)
        assert body["errors"] and "503" in body["errors"][0]
        assert session.updates == []

    def test_network_error_marks_everything_failed(self, configured, expo):
        def boom(_req: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route")

        expo["handler"] = boom
        session = FakeSession([(uuid4(), "t1"), (uuid4(), "t2")])
        resp = TestClient(_app(session)).post(
            URL, json=_body(), headers={"X-Coord-Service-Secret": SECRET}
        )
        body = resp.json()
        assert (body["accepted"], body["failed"]) == (0, 2)
        assert "ConnectError" in body["errors"][0]


class TestDeactivationFailure:
    def test_failed_update_is_rolled_back_and_the_counts_still_return(
        self, configured, expo
    ):
        session = FakeSession([(uuid4(), "t-dead")], update_raises=True)
        expo["handler"] = lambda _req: httpx.Response(
            200,
            json={
                "data": [
                    {"status": "error", "details": {"error": "DeviceNotRegistered"}}
                ]
            },
        )
        resp = TestClient(_app(session)).post(
            URL, json=_body(), headers={"X-Coord-Service-Secret": SECRET}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert (body["failed"], body["deactivated"]) == (1, 0)
        assert any("deactivation failed" in e for e in body["errors"])
        assert session.rollbacks == 1
        assert session.commits == 0


class TestSenderDirect:
    @pytest.mark.asyncio
    async def test_more_than_100_tokens_are_chunked_and_summed(self, expo):
        tokens = [f"t{i}" for i in range(250)]

        def handler(request: httpx.Request) -> httpx.Response:
            sent = json.loads(request.content)
            assert len(sent) <= 100
            # Positional within the chunk: kill exactly token t150.
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"status": "error", "details": {"error": "DeviceNotRegistered"}}
                        if m["to"] == "t150"
                        else {"status": "ok"}
                        for m in sent
                    ]
                },
            )

        expo["handler"] = handler
        session = FakeSession([])
        result = await push_notifications.send_push_notifications_with_result(
            tokens,
            "t",
            "b",
            db=session,  # type: ignore[arg-type]
        )
        assert [len(r) for r in expo["requests"]] == [100, 100, 50]
        assert (result.devices, result.accepted, result.failed) == (250, 249, 1)
        assert _deactivated_tokens(session) == ["t150"]

    @pytest.mark.asyncio
    async def test_one_failed_chunk_fails_only_its_own_messages(self, expo):
        calls = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            if calls["n"] == 2:
                return httpx.Response(502, text="bad gateway")
            sent = json.loads(request.content)
            return httpx.Response(200, json={"data": [{"status": "ok"} for _ in sent]})

        expo["handler"] = handler
        result = await push_notifications.send_push_notifications_with_result(
            [f"t{i}" for i in range(150)], "t", "b"
        )
        assert (result.accepted, result.failed) == (100, 50)
        assert "502" in result.errors[0]

    @pytest.mark.asyncio
    async def test_errors_are_capped_at_three(self, expo):
        expo["handler"] = lambda _req: httpx.Response(
            200,
            json={"data": [{"status": "error", "message": f"e{i}"} for i in range(5)]},
        )
        result = await push_notifications.send_push_notifications_with_result(
            [f"t{i}" for i in range(5)], "t", "b"
        )
        assert (result.accepted, result.failed) == (0, 5)
        assert result.errors == ["e0", "e1", "e2"]

    @pytest.mark.asyncio
    async def test_without_a_session_nothing_is_deactivated(self, expo):
        expo["handler"] = lambda _req: httpx.Response(
            200,
            json={
                "data": [
                    {"status": "error", "details": {"error": "DeviceNotRegistered"}}
                ]
            },
        )
        result = await push_notifications.send_push_notifications_with_result(
            ["t1"], "t", "b"
        )
        assert (result.failed, result.deactivated) == (1, 0)

    @pytest.mark.asyncio
    async def test_short_ticket_list_counts_the_rest_failed(self, expo):
        expo["handler"] = lambda _req: httpx.Response(
            200, json={"data": [{"status": "ok"}]}
        )
        result = await push_notifications.send_push_notifications_with_result(
            ["t1", "t2"], "t", "b"
        )
        assert (result.accepted, result.failed) == (1, 1)

    @pytest.mark.asyncio
    async def test_fire_and_forget_wrapper_returns_none_and_never_raises(self, expo):
        def boom(_req: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("slow")

        expo["handler"] = boom
        assert (
            await push_notifications.send_push_notifications(["t1"], "t", "b") is None
        )
