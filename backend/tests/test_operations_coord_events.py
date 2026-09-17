"""Tests for the coord-events WS bridge.

Plan
``2026-09-13-coord-publishes-agent-jwts-on-a-redis-channel-fronted-by-an-unauthenticated-ws-firehose``
Phase 2 (qontinui-web half). One endpoint:

* ``WS /api/v1/operations/coord-events/ws?subscribe=<name>`` — bridges the
  browser to coord's now-authenticated generic ``/ws`` after minting a
  tenant-scoped service JWT, forwarding each ``{"channel","payload"}``
  frame verbatim.

Mirrors :mod:`test_operations_device_status` (minimal FastAPI app + a mocked
``websockets.connect``), because the bridge is modelled on that one. What is
different, and pinned here:

* the subscription rides the UPSTREAM QUERY STRING (``&subscribe=<name>``)
  and NO in-band subscribe message is sent — coord's generic ``/ws`` takes
  its subscription at the upgrade;
* the name is validated against a CLOSED allowlist BEFORE auth, so a
  runner-only ``device`` or a free glob never spends a coord lookup or a
  mint, and never reaches coord;
* an upstream that REFUSES the upgrade (coord 401/403) is reported with its
  HTTP status, not as "unreachable".
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest
import websockets.exceptions
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from websockets.datastructures import Headers
from websockets.http11 import Response as WsHttpResponse

_FIXTURE_TENANT_ID = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")

API_PREFIX = "/api/v1/operations"


def _fixture_identity() -> Any:
    """A `CoordIdentity` whose home tenant is `_FIXTURE_TENANT_ID`."""
    from app.services.coord_identity import CoordIdentity, CoordTenant

    return CoordIdentity(
        operator_id=uuid4(),
        home_tenant_id=_FIXTURE_TENANT_ID,
        email="ws-firehose.user@example.com",
        roles=("member",),
        tenants=(
            CoordTenant(
                tenant_id=_FIXTURE_TENANT_ID,
                slug="personal",
                roles=("member",),
            ),
        ),
        is_admin=False,
    )


def _build_test_app() -> FastAPI:
    """Minimal FastAPI app exposing the operations router."""
    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_user_async,
    )
    from app.api.v1.endpoints.operations import (
        _caller_bearer,
        _extract_caller_token,
        get_tenant_id,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "ws-firehose.user@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_current_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_async_db] = lambda: None

    async def _resolver(request: Request) -> UUID:
        _caller_bearer.set(_extract_caller_token(request))
        return _FIXTURE_TENANT_ID

    test_app.dependency_overrides[get_tenant_id] = _resolver
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


# ---------------------------------------------------------------------------
# Service helpers — no FastAPI WS roundtrip
# ---------------------------------------------------------------------------


class TestCoordEventsServiceHelpers:
    def test_allowlist_is_the_four_operator_names_and_never_device(self) -> None:
        from app.services.coord_device_status import COORD_EVENTS_SUBSCRIPTIONS

        assert COORD_EVENTS_SUBSCRIPTIONS == frozenset(
            {"strategy", "merge", "claims", "branches"}
        )
        # `device` / `device_ci` resolve to the token's own device_id claim
        # on coord's side and carry the spawn channel this plan takes off the
        # bus. A service token has no device; the bridge must never offer
        # them, whatever coord's map says.
        assert "device" not in COORD_EVENTS_SUBSCRIPTIONS
        assert "device_ci" not in COORD_EVENTS_SUBSCRIPTIONS

    def test_ws_url_translates_http_to_ws_and_carries_subscribe(self) -> None:
        from app.services.coord_device_status import build_coord_events_ws_url

        with patch("app.services.coord_device_status.settings") as mock_settings:
            mock_settings.COORD_URL = "http://localhost:9870"
            assert build_coord_events_ws_url("abc", "strategy") == (
                "ws://localhost:9870/ws?token=abc&subscribe=strategy"
            )

    def test_ws_url_translates_https_to_wss(self) -> None:
        from app.services.coord_device_status import build_coord_events_ws_url

        with patch("app.services.coord_device_status.settings") as mock_settings:
            mock_settings.COORD_URL = "https://coord.qontinui.io/"
            assert build_coord_events_ws_url("abc.def.ghi", "merge") == (
                "wss://coord.qontinui.io/ws?token=abc.def.ghi&subscribe=merge"
            )

    def test_ws_url_refuses_a_name_outside_the_allowlist(self) -> None:
        # Belt and braces under the endpoint's own check: a future call site
        # that forgets to validate still cannot hand coord a free glob or the
        # runner-only device channel.
        from app.services.coord_device_status import build_coord_events_ws_url

        with patch("app.services.coord_device_status.settings") as mock_settings:
            mock_settings.COORD_URL = "http://localhost:9870"
            for bad in ("device", "device_ci", "events.*", "", "strategy "):
                with pytest.raises(ValueError):
                    build_coord_events_ws_url("abc", bad)

    def test_families_prefix_for_globs_and_exact_for_bare_channels(self) -> None:
        from app.services.coord_device_status import (
            COORD_EVENTS_FAMILIES,
            COORD_EVENTS_SUBSCRIPTIONS,
            channel_in_family,
        )

        # The allowlist IS the family map's key set — one source.
        assert COORD_EVENTS_SUBSCRIPTIONS == frozenset(COORD_EVENTS_FAMILIES)
        assert COORD_EVENTS_FAMILIES == {
            "strategy": "events.strategy.",
            "merge": "events.merge.",
            "claims": "events.claims",
            "branches": "events.branches",
        }
        # Prefix families admit the whole glob and nothing beside it.
        assert channel_in_family("strategy", "events.strategy.mention.created.u1")
        assert channel_in_family("merge", "events.merge.proposal.updated.7")
        assert not channel_in_family("merge", "events.merge")
        assert not channel_in_family("merge", "events.merges.x")
        assert not channel_in_family("strategy", "events.merge.proposal.updated.7")
        # Exact families admit only the identical channel.
        assert channel_in_family("claims", "events.claims")
        assert not channel_in_family("claims", "events.claims.x")
        assert channel_in_family("branches", "events.branches")
        assert not channel_in_family("branches", "events.branches.main")
        # The spawn channel is in no family, whatever the subscription.
        for name in COORD_EVENTS_SUBSCRIPTIONS:
            assert not channel_in_family(name, "events.agent.spawn_requested.dev")
        assert not channel_in_family("device", "events.agent.spawn_requested.dev")

    def test_envelope_channel_reads_only_a_string_channel(self) -> None:
        from app.services.coord_device_status import envelope_channel

        assert envelope_channel('{"channel":"events.claims","payload":"{}"}') == (
            "events.claims"
        )
        assert envelope_channel("not json") is None
        assert envelope_channel("[1,2]") is None
        assert envelope_channel('{"payload":"{}"}') is None
        assert envelope_channel('{"channel":7}') is None

    def test_device_status_url_is_unchanged_by_the_shared_base(self) -> None:
        # The scheme translation was lifted into a shared helper; the
        # device-status bridge's URL must be byte-identical to before.
        from app.services.coord_device_status import build_device_status_ws_url

        with patch("app.services.coord_device_status.settings") as mock_settings:
            mock_settings.COORD_URL = "https://coord.qontinui.io"
            assert build_device_status_ws_url("abc") == (
                "wss://coord.qontinui.io/ws/device-status?token=abc"
            )


# ---------------------------------------------------------------------------
# WS bridge — FastAPI integration (mocks `websockets.connect`)
# ---------------------------------------------------------------------------


class MockUpstream:
    """A stand-in for coord's `/ws` socket.

    Yields the given frames then blocks until cancelled — a live upstream
    waiting for the next event — or, with ``end_after_frames``, ends the
    stream the way a closed coord socket does. Records anything the bridge
    sends so the "no in-band subscribe" property can be asserted.
    """

    def __init__(
        self, frames: list[str] | None = None, *, end_after_frames: bool = False
    ) -> None:
        self.sent: list[str] = []
        self._frames = list(frames or [])
        self._end_after_frames = end_after_frames
        self.closed = False

    async def send(self, message: str) -> None:
        self.sent.append(message)

    def __aiter__(self) -> MockUpstream:
        return self

    async def __anext__(self) -> str:
        if not self._frames:
            if self._end_after_frames:
                raise StopAsyncIteration
            await asyncio.sleep(3600)
        return self._frames.pop(0)

    async def close(self) -> None:
        self.closed = True


class TestCoordEventsWsBridge:
    def _patches(
        self,
        *,
        connect: Any,
        mint: Any | None = None,
        auth: Any | None = None,
        identity: Any | None = None,
    ) -> Any:
        mock_user = MagicMock()
        mock_user.id = uuid4()

        async def fake_get_user_from_ws(token: str) -> Any:
            return mock_user

        async def fake_get_identity(token: str | None) -> Any:
            return _fixture_identity()

        async def fake_mint(*, tenant_id: UUID) -> str:
            assert tenant_id == _FIXTURE_TENANT_ID
            return "fake.jwt.token"

        return (
            patch(
                "app.api.v1.endpoints.operations.get_current_user_from_ws",
                auth or fake_get_user_from_ws,
            ),
            patch(
                "app.api.v1.endpoints.operations.get_coord_identity_for_token",
                identity or fake_get_identity,
            ),
            patch(
                "app.api.v1.endpoints.operations.mint_device_status_token",
                mint or fake_mint,
            ),
            patch(
                "app.api.v1.endpoints.operations.websockets_connect",
                connect,
            ),
        )

    def test_bridge_forwards_upstream_frame_verbatim(self) -> None:
        ws_client = TestClient(_build_test_app())

        # Coord's envelope: `payload` is a JSON STRING (ws.rs), not an
        # object. The bridge must not re-encode it.
        coord_frame = json.dumps(
            {
                "channel": "events.strategy.presence.aggregate.doc-1",
                "payload": json.dumps({"doc_id": "doc-1", "count": 2}),
            }
        )
        upstream_mock = MockUpstream([coord_frame])
        seen_urls: list[str] = []

        async def fake_connect(url: str, **kwargs: Any) -> MockUpstream:
            seen_urls.append(url)
            return upstream_mock

        p1, p2, p3, p4 = self._patches(connect=fake_connect)
        with (
            p1,
            p2,
            p3,
            p4,
            patch("app.services.coord_device_status.settings") as mock_settings,
        ):
            mock_settings.COORD_URL = "https://coord.qontinui.io"
            with ws_client.websocket_connect(
                f"{API_PREFIX}/coord-events/ws?subscribe=strategy&token=session-jwt"
            ) as ws:
                received = ws.receive_text()
                assert received == coord_frame

        # The minted token AND the subscription ride the upstream query
        # string — coord's generic `/ws` takes both at the upgrade.
        assert seen_urls == [
            "wss://coord.qontinui.io/ws?token=fake.jwt.token&subscribe=strategy"
        ]
        # NO in-band subscribe message: `/ws` is not `/ws/device-status`.
        assert upstream_mock.sent == []
        # Upstream MUST be closed when the browser side disconnects.
        assert upstream_mock.closed is True

    def test_merge_subscription_is_a_name_not_a_glob(self) -> None:
        # The old browser hook subscribed `events.merge.>` — a NATS wildcard
        # that matched nothing in Redis. The bridge forwards the NAME; the
        # pattern (`events.merge.*`) is coord's to resolve.
        ws_client = TestClient(_build_test_app())
        upstream_mock = MockUpstream()
        seen_urls: list[str] = []

        async def fake_connect(url: str, **kwargs: Any) -> MockUpstream:
            seen_urls.append(url)
            return upstream_mock

        p1, p2, p3, p4 = self._patches(connect=fake_connect)
        with (
            p1,
            p2,
            p3,
            p4,
            patch("app.services.coord_device_status.settings") as mock_settings,
        ):
            mock_settings.COORD_URL = "http://localhost:9870"
            with ws_client.websocket_connect(
                f"{API_PREFIX}/coord-events/ws?subscribe=merge&token=session-jwt"
            ):
                pass

        assert seen_urls == [
            "ws://localhost:9870/ws?token=fake.jwt.token&subscribe=merge"
        ]
        assert "pattern=" not in seen_urls[0]
        assert ">" not in seen_urls[0]
        assert upstream_mock.closed is True

    @pytest.mark.parametrize(
        "subscribe",
        [
            "device",  # runner-only: resolves to the token's device_id claim
            "device_ci",  # same
            "events.*",  # the old free glob
            "events.merge.>",  # the old dead NATS wildcard
            "",  # absent
        ],
    )
    def test_unknown_subscription_is_refused_before_auth(self, subscribe: str) -> None:
        ws_client = TestClient(_build_test_app())
        auth_calls: list[str] = []
        connect_calls: list[str] = []

        async def counting_auth(token: str) -> Any:
            auth_calls.append(token)
            return MagicMock(id=uuid4())

        async def counting_connect(url: str, **kwargs: Any) -> MockUpstream:
            connect_calls.append(url)
            return MockUpstream()

        p1, p2, p3, p4 = self._patches(connect=counting_connect, auth=counting_auth)
        query = (
            f"subscribe={subscribe}&token=session-jwt"
            if subscribe
            else ("token=session-jwt")
        )
        with p1, p2, p3, p4:
            with ws_client.websocket_connect(
                f"{API_PREFIX}/coord-events/ws?{query}"
            ) as ws:
                error = json.loads(ws.receive_text())
                assert error["type"] == "error"
                assert error["error"] == "unknown_subscription"
                assert error["subscribe"] == subscribe
                assert error["allowed"] == ["branches", "claims", "merge", "strategy"]
                closed = ws.receive()
                assert closed["type"] == "websocket.close"
                assert closed["code"] == 1008

        # Refused at the door: no identity lookup, no mint, no upstream.
        assert auth_calls == []
        assert connect_calls == []

    def test_missing_token_is_refused_after_the_allowlist(self) -> None:
        ws_client = TestClient(_build_test_app())
        connect_calls: list[str] = []

        async def counting_connect(url: str, **kwargs: Any) -> MockUpstream:
            connect_calls.append(url)
            return MockUpstream()

        p1, p2, p3, p4 = self._patches(connect=counting_connect)
        with p1, p2, p3, p4:
            with ws_client.websocket_connect(
                f"{API_PREFIX}/coord-events/ws?subscribe=strategy"
            ) as ws:
                error = json.loads(ws.receive_text())
                assert error == {
                    "type": "error",
                    "error": "Missing authentication token",
                }
                closed = ws.receive()
                assert closed["type"] == "websocket.close"
                assert closed["code"] == 1008
        assert connect_calls == []

    def test_upstream_refusal_is_reported_with_its_http_status(self) -> None:
        # Coord answering the upgrade with a 403 (a name coord does not
        # map, or a principal it does not admit) is a different remediation
        # from an unreachable host; the bridge must say which.
        ws_client = TestClient(_build_test_app())

        async def refusing_connect(url: str, **kwargs: Any) -> MockUpstream:
            raise websockets.exceptions.InvalidStatus(
                WsHttpResponse(403, "Forbidden", Headers())
            )

        p1, p2, p3, p4 = self._patches(connect=refusing_connect)
        with (
            p1,
            p2,
            p3,
            p4,
            patch("app.services.coord_device_status.settings") as mock_settings,
        ):
            mock_settings.COORD_URL = "http://localhost:9870"
            with ws_client.websocket_connect(
                f"{API_PREFIX}/coord-events/ws?subscribe=claims&token=session-jwt"
            ) as ws:
                error = json.loads(ws.receive_text())
                assert error["type"] == "error"
                assert error["error"] == "Upstream coord WS refused the upgrade"
                assert error["upstream_status"] == 403
                closed = ws.receive()
                assert closed["type"] == "websocket.close"
                assert closed["code"] == 1011

    def test_upstream_unreachable_closes_1011_with_error_frame(self) -> None:
        ws_client = TestClient(_build_test_app())

        async def failing_connect(url: str, **kwargs: Any) -> MockUpstream:
            raise OSError("connection refused")

        p1, p2, p3, p4 = self._patches(connect=failing_connect)
        with (
            p1,
            p2,
            p3,
            p4,
            patch("app.services.coord_device_status.settings") as mock_settings,
        ):
            mock_settings.COORD_URL = "http://localhost:9870"
            with ws_client.websocket_connect(
                f"{API_PREFIX}/coord-events/ws?subscribe=branches&token=session-jwt"
            ) as ws:
                error = json.loads(ws.receive_text())
                assert error == {
                    "type": "error",
                    "error": "Upstream coord WS unreachable",
                }
                closed = ws.receive()
                assert closed["type"] == "websocket.close"
                assert closed["code"] == 1011

    def test_bridge_closes_upstream_on_browser_disconnect(self) -> None:
        ws_client = TestClient(_build_test_app())
        upstream_mock = MockUpstream()

        async def fake_connect(url: str, **kwargs: Any) -> MockUpstream:
            return upstream_mock

        p1, p2, p3, p4 = self._patches(connect=fake_connect)
        with (
            p1,
            p2,
            p3,
            p4,
            patch("app.services.coord_device_status.settings") as mock_settings,
        ):
            mock_settings.COORD_URL = "http://localhost:9870"
            with ws_client.websocket_connect(
                f"{API_PREFIX}/coord-events/ws?subscribe=strategy&token=session-jwt"
            ):
                # Immediate exit — TestClient closes the browser side.
                pass

        assert upstream_mock.closed is True
        assert upstream_mock.sent == []

    def test_frames_outside_the_subscription_family_are_dropped(self) -> None:
        # The upstream socket is NOT trusted to have honoured `?subscribe=`:
        # a coord that predates it PSUBSCRIBEs `events.*` and fans out the
        # whole bus, spawn-request frames (with agent JWTs) included. The
        # bridge classifies every frame by its `channel` and relays only the
        # subscription's own family.
        ws_client = TestClient(_build_test_app())
        spawn_frame = json.dumps(
            {
                "channel": "events.agent.spawn_requested.device-1",
                "payload": json.dumps({"agent_id": "a-1", "jwt": "SECRET.jwt"}),
            }
        )
        merge_frame = json.dumps(
            {"channel": "events.merge.proposal.updated.7", "payload": "{}"}
        )
        malformed = "not an envelope"
        wanted = json.dumps(
            {
                "channel": "events.strategy.mention.created.u1",
                "payload": json.dumps({"mention_id": "m-1"}),
            }
        )
        upstream_mock = MockUpstream([spawn_frame, merge_frame, malformed, wanted])

        async def fake_connect(url: str, **kwargs: Any) -> MockUpstream:
            return upstream_mock

        p1, p2, p3, p4 = self._patches(connect=fake_connect)
        with (
            p1,
            p2,
            p3,
            p4,
            patch("app.services.coord_device_status.settings") as mock_settings,
            patch("app.api.v1.endpoints.operations.logger") as mock_logger,
        ):
            mock_settings.COORD_URL = "http://localhost:9870"
            with ws_client.websocket_connect(
                f"{API_PREFIX}/coord-events/ws?subscribe=strategy&token=session-jwt"
            ) as ws:
                # The FIRST thing the browser sees is the strategy frame —
                # the three before it never crossed.
                assert ws.receive_text() == wanted

        assert upstream_mock.closed is True
        # Logged once at WARN with the channel and a count — and never the
        # payload: the whole point is that the JWT does not leave the
        # upstream socket, log lines included.
        warn_events = [c.args[0] for c in mock_logger.warning.call_args_list]
        assert warn_events.count("coord_events_ws_frame_outside_subscription") == 1
        first = next(
            c
            for c in mock_logger.warning.call_args_list
            if c.args[0] == "coord_events_ws_frame_outside_subscription"
        )
        assert first.kwargs["channel"] == "events.agent.spawn_requested.device-1"
        summary = next(
            c
            for c in mock_logger.warning.call_args_list
            if c.args[0] == "coord_events_ws_frames_dropped"
        )
        assert summary.kwargs["dropped"] == 3
        for call in mock_logger.warning.call_args_list:
            assert "SECRET.jwt" not in repr(call)

    def test_exact_family_relays_only_the_identical_channel(self) -> None:
        ws_client = TestClient(_build_test_app())
        sub_channel = json.dumps({"channel": "events.claims.x", "payload": "{}"})
        exact = json.dumps({"channel": "events.claims", "payload": "{}"})
        upstream_mock = MockUpstream([sub_channel, exact])

        async def fake_connect(url: str, **kwargs: Any) -> MockUpstream:
            return upstream_mock

        p1, p2, p3, p4 = self._patches(connect=fake_connect)
        with (
            p1,
            p2,
            p3,
            p4,
            patch("app.services.coord_device_status.settings") as mock_settings,
        ):
            mock_settings.COORD_URL = "http://localhost:9870"
            with ws_client.websocket_connect(
                f"{API_PREFIX}/coord-events/ws?subscribe=claims&token=session-jwt"
            ) as ws:
                assert ws.receive_text() == exact

    def test_upstream_drop_closes_browser_1011(self) -> None:
        # Coord ending the stream must reach the browser as 1011, so the
        # hook's backoff ladder reconnects — a clean 1000 would read as
        # "done" and leave the page without a live transport.
        ws_client = TestClient(_build_test_app())
        frame = json.dumps({"channel": "events.branches", "payload": "{}"})
        upstream_mock = MockUpstream([frame], end_after_frames=True)

        async def fake_connect(url: str, **kwargs: Any) -> MockUpstream:
            return upstream_mock

        p1, p2, p3, p4 = self._patches(connect=fake_connect)
        with (
            p1,
            p2,
            p3,
            p4,
            patch("app.services.coord_device_status.settings") as mock_settings,
        ):
            mock_settings.COORD_URL = "http://localhost:9870"
            with ws_client.websocket_connect(
                f"{API_PREFIX}/coord-events/ws?subscribe=branches&token=session-jwt"
            ) as ws:
                assert ws.receive_text() == frame
                closed = ws.receive()
                assert closed["type"] == "websocket.close"
                assert closed["code"] == 1011
                assert closed["reason"] == "Upstream coord WS closed"

        assert upstream_mock.closed is True

    def test_connect_failure_log_never_carries_the_minted_token(self) -> None:
        # `websockets.exceptions.InvalidURI.__str__` embeds the full URI —
        # `?token=<minted>` included. The log line must carry the exception
        # TYPE and the query-stripped upstream, not `str(exc)`.
        ws_client = TestClient(_build_test_app())

        async def failing_connect(url: str, **kwargs: Any) -> MockUpstream:
            raise websockets.exceptions.InvalidURI(url, "unsupported scheme")

        p1, p2, p3, p4 = self._patches(connect=failing_connect)
        with (
            p1,
            p2,
            p3,
            p4,
            patch("app.services.coord_device_status.settings") as mock_settings,
            patch("app.api.v1.endpoints.operations.logger") as mock_logger,
        ):
            mock_settings.COORD_URL = "http://localhost:9870"
            with ws_client.websocket_connect(
                f"{API_PREFIX}/coord-events/ws?subscribe=merge&token=session-jwt"
            ) as ws:
                error = json.loads(ws.receive_text())
                assert error["error"] == "Upstream coord WS unreachable"

        call = next(
            c
            for c in mock_logger.warning.call_args_list
            if c.args[0] == "coord_events_ws_upstream_connect_failed"
        )
        assert call.kwargs["error_type"] == "InvalidURI"
        assert call.kwargs["upstream"] == "ws://localhost:9870/ws"
        assert "error" not in call.kwargs
        assert "fake.jwt.token" not in repr(call)
