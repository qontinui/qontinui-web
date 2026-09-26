"""Funnel telemetry event types: ingested (201), but never a push and never in the feed.

Plan ``2026-09-22-new-project-initiation-pr-f-doctor-step-and-funnel-telemetry``
Phase 1. The seven ``new_project_*`` workflow event types are TELEMETRY: the
runner posts them through the ordinary ``POST /api/v1/events/workflow`` door,
but they must not

* send a phone push (``dispatch_push_for_event`` has no allowlist and would
  otherwise fall through to a generic "Workflow Event" notification), nor
* appear in ``GET /api/v1/events`` / ``GET /api/v1/events/unseen`` — the
  mobile feed and the unread badge.

Both gates consume ONE predicate, ``is_telemetry``. These tests assert the
PROPERTY end to end (a real ingest, the real background dispatcher, the real
list queries) rather than membership of a list, and each carries a
non-telemetry control so a harness that could never observe a push or a feed
row cannot pass vacuously.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, Generator
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import (
    DeviceTokenContext,
    get_async_db,
    get_authenticated_device,
    get_current_active_user_async,
)
from app.api.v1.endpoints.events import router
from app.middleware.rate_limit import user_limiter
from app.models.user import User
from app.models.workflow_event import (
    TELEMETRY_EVENT_TYPES,
    WorkflowEvent,
    WorkflowEventType,
    is_telemetry,
)
from app.services import push_notifications

API_PREFIX = "/api/v1/events"

FUNNEL_TYPES = [
    "new_project_started",
    "new_project_name_ok",
    "new_project_repo_created",
    "new_project_pushed",
    "new_project_enrolled",
    "new_project_finished",
    "new_project_live",
]

# A user-facing type: it MUST push and MUST appear in the feed. The control.
CONTROL_TYPE = WorkflowEventType.RUN_COMPLETED.value


@pytest.fixture(autouse=True)
def _fresh_rate_limit_bucket() -> Generator[None, None, None]:
    user_limiter.reset()
    yield
    user_limiter.reset()


def _event_body(event_type: str, **extra: Any) -> dict[str, Any]:
    return {
        "event_type": event_type,
        "device_id": "device-telemetry-test",
        "runner_name": "test-runner",
        "run_id": "flow-1234",
        "summary": f"{event_type} summary",
        "payload": {"ok": True},
        "timestamp": datetime.now(UTC).isoformat(),
        **extra,
    }


# ---------------------------------------------------------------------------
# The predicate itself
# ---------------------------------------------------------------------------


class TestPredicate:
    def test_every_funnel_type_is_a_valid_event_type_and_telemetry(self) -> None:
        valid = {e.value for e in WorkflowEventType}
        for event_type in FUNNEL_TYPES:
            assert event_type in valid
            assert is_telemetry(event_type)

    def test_no_pre_existing_user_facing_type_is_telemetry(self) -> None:
        """The predicate must not silently mute a notification type."""
        for event_type in WorkflowEventType:
            if event_type.value.startswith("new_project_"):
                continue
            assert not is_telemetry(event_type.value), event_type

    def test_accepts_the_enum_member_as_well_as_the_string(self) -> None:
        assert is_telemetry(WorkflowEventType.NEW_PROJECT_LIVE)
        assert TELEMETRY_EVENT_TYPES == frozenset(FUNNEL_TYPES)


# ---------------------------------------------------------------------------
# Push dispatch — no DB needed; the token lookup is the observable
# ---------------------------------------------------------------------------


def _unsaved_event(event_type: str) -> WorkflowEvent:
    return WorkflowEvent(
        id=uuid4(),
        user_id=uuid4(),
        event_type=event_type,
        device_id="device-telemetry-test",
        runner_name="test-runner",
        run_id="flow-1234",
        summary="s",
        timestamp=datetime.now(UTC),
    )


class TestPushDispatch:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("event_type", FUNNEL_TYPES)
    async def test_telemetry_returns_before_the_token_lookup(
        self, event_type: str
    ) -> None:
        tokens = AsyncMock(return_value=["ExponentPushToken[abc]"])
        send = AsyncMock()
        with (
            patch.object(push_notifications, "get_user_push_tokens", tokens),
            patch.object(push_notifications, "send_push_notifications", send),
        ):
            await push_notifications.dispatch_push_for_event(
                AsyncMock(), _unsaved_event(event_type)
            )
        tokens.assert_not_awaited()
        send.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_control_type_still_pushes(self) -> None:
        tokens = AsyncMock(return_value=["ExponentPushToken[abc]"])
        send = AsyncMock()
        with (
            patch.object(push_notifications, "get_user_push_tokens", tokens),
            patch.object(push_notifications, "send_push_notifications", send),
        ):
            await push_notifications.dispatch_push_for_event(
                AsyncMock(), _unsaved_event(CONTROL_TYPE)
            )
        tokens.assert_awaited_once()
        send.assert_awaited_once()


# ---------------------------------------------------------------------------
# End to end over the events router (DB-backed)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def maker(test_engine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture
async def user(maker: async_sessionmaker[AsyncSession]) -> AsyncGenerator[User, None]:
    async with maker() as session:
        u = User(
            email=f"telemetry_{uuid4()}@example.com",
            username=f"telemetry_{uuid4().hex[:8]}",
            full_name="Telemetry Test",
            is_active=True,
            is_verified=True,
        )
        session.add(u)
        await session.commit()
        await session.refresh(u)
    yield u
    async with maker() as session:
        await session.execute(
            delete(WorkflowEvent).where(WorkflowEvent.user_id == u.id)
        )
        await session.execute(delete(User).where(User.id == u.id))
        await session.commit()


@pytest.fixture
def send_push() -> Generator[AsyncMock, None, None]:
    """The terminal push call, with a token present so a push WOULD be sent."""
    send = AsyncMock()
    with (
        patch.object(
            push_notifications,
            "get_user_push_tokens",
            AsyncMock(return_value=["ExponentPushToken[abc]"]),
        ),
        patch.object(push_notifications, "send_push_notifications", send),
    ):
        yield send


@pytest.fixture
def client(
    maker: async_sessionmaker[AsyncSession], user: User
) -> Generator[TestClient, None, None]:
    async def _get_db() -> AsyncGenerator[AsyncSession, None]:
        async with maker() as session:
            yield session

    device_ctx = DeviceTokenContext(claims={"sub": "device-telemetry-test"}, user=user)

    app = FastAPI()
    app.include_router(router, prefix=API_PREFIX)
    app.dependency_overrides[get_async_db] = _get_db
    app.dependency_overrides[get_authenticated_device] = lambda: device_ctx
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    # The ingest route's background push dispatcher opens its own session;
    # point it at the test engine so the REAL dispatch path runs.
    with patch("app.api.v1.endpoints.events.AsyncSessionLocal", maker):
        yield TestClient(app)


def _types(resp_json: list[dict[str, Any]]) -> list[str]:
    return [row["event_type"] for row in resp_json]


class TestIngestAndFeed:
    @pytest.mark.parametrize("event_type", FUNNEL_TYPES)
    def test_funnel_type_ingests_201_and_queues_no_push(
        self, client: TestClient, send_push: AsyncMock, event_type: str
    ) -> None:
        resp = client.post(f"{API_PREFIX}/workflow", json=_event_body(event_type))
        # The ingest route's success status is 201 Created.
        assert resp.status_code == 201, resp.text
        # TestClient runs background tasks before returning, so the real
        # dispatcher has already had its chance to push.
        send_push.assert_not_awaited()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("event_type", FUNNEL_TYPES)
    async def test_funnel_type_is_stored(
        self,
        client: TestClient,
        send_push: AsyncMock,
        maker: async_sessionmaker[AsyncSession],
        user: User,
        event_type: str,
    ) -> None:
        """Suppression is from push and feed ONLY: the row must be persisted.

        Without this, a future "drop telemetry at ingest" change would pass
        every other test here while silently losing the funnel data.
        """
        run_id = f"flow-{uuid4()}"
        resp = client.post(
            f"{API_PREFIX}/workflow", json=_event_body(event_type, run_id=run_id)
        )
        assert resp.status_code == 201, resp.text

        async with maker() as session:
            rows = (
                (
                    await session.execute(
                        select(WorkflowEvent).where(
                            WorkflowEvent.user_id == user.id,
                            WorkflowEvent.run_id == run_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert len(rows) == 1
        assert rows[0].event_type == event_type
        assert rows[0].run_id == run_id
        assert str(rows[0].id) == resp.json()["id"]
        assert rows[0].payload == {"ok": True}

    def test_control_type_does_push_through_the_same_harness(
        self, client: TestClient, send_push: AsyncMock
    ) -> None:
        resp = client.post(f"{API_PREFIX}/workflow", json=_event_body(CONTROL_TYPE))
        assert resp.status_code == 201, resp.text
        send_push.assert_awaited_once()

    def test_unknown_type_still_400s(
        self, client: TestClient, send_push: AsyncMock
    ) -> None:
        resp = client.post(
            f"{API_PREFIX}/workflow", json=_event_body("new_project_bogus")
        )
        assert resp.status_code == 400, resp.text
        send_push.assert_not_awaited()

    def test_funnel_types_are_absent_from_list_and_unseen(
        self, client: TestClient, send_push: AsyncMock
    ) -> None:
        before_unseen = client.get(f"{API_PREFIX}/unseen")
        assert before_unseen.status_code == 200, before_unseen.text
        badge_before = len(before_unseen.json())

        for event_type in FUNNEL_TYPES:
            r = client.post(f"{API_PREFIX}/workflow", json=_event_body(event_type))
            assert r.status_code == 201, r.text

        # The badge does not move for telemetry.
        after_funnel = client.get(f"{API_PREFIX}/unseen")
        assert after_funnel.status_code == 200, after_funnel.text
        assert len(after_funnel.json()) == badge_before

        r = client.post(f"{API_PREFIX}/workflow", json=_event_body(CONTROL_TYPE))
        assert r.status_code == 201, r.text

        listed = client.get(API_PREFIX)
        assert listed.status_code == 200, listed.text
        assert _types(listed.json()) == [CONTROL_TYPE]

        unseen = client.get(f"{API_PREFIX}/unseen")
        assert unseen.status_code == 200, unseen.text
        assert _types(unseen.json()) == [CONTROL_TYPE]
        assert len(unseen.json()) == badge_before + 1

        # Asking for a funnel type by name does not smuggle it back in.
        for event_type in FUNNEL_TYPES:
            by_type = client.get(API_PREFIX, params={"event_type": event_type})
            assert by_type.status_code == 200, by_type.text
            assert by_type.json() == []
