"""What each role reads through qontinui-web, measured door by door.

Phase 1 of plan
``2026-11-26-questions-only-another-party-can-answer-have-no-queue-no-answerer-and-no-visibility``:
an access matrix of seven doors x three members of one tenant, so that any
change inside qontinui-web to who reads what at these doors turns a named test
red and the matrix moves only on purpose. No behaviour is changed here. The
outside-role cells stub coord's identity answer as a 403, so they measure web's
handling of that answer; a change in COORD that started admitting such a member
would not turn them red (that is coord's own Phase 2 test suite).

**Scope: qontinui-web only.** Coord serves the same documents and answers the
same questions at its own operator doors (``GET /coord/prompt-documents``,
``POST /coord/agent-questions/:id/respond``), and today it does NOT refuse a
member who holds only an outside role there (coord finding
``b925b55d-f3a8-45cb-ae97-07fe59345552``). That half is the plan's Phase 2, in
qontinui-coord; nothing in this module can see it.

**The three members.**

* an Administrator — coord roles ``["admin"]`` in the tenant;
* a Developer — ``["operator"]`` (the members page's "Developer" tier);
* a member holding only an outside role (``helper`` today, ``stakeholder``
  once the plan's Phases 10-11 land). Coord's ``GET /admin/coord/me`` requires
  ``operator`` or a role above it (``admin`` ranks above ``operator``) in the
  active tenant and answers such a member 403, which web
  maps to 403 ``tenant_not_resolved`` inside ``coord_identity._fetch_identity``.

**Resolved the real way.** Unlike ``test_overview_authoring.py``, nothing here
overrides ``get_overview_caller`` or ``get_tenant_id``: that override skips the
identity call, so a matrix built on it would measure the test, not production.
Only the signed-in person (``current_active_user[_optional]``) is stood in for,
a bearer is sent, and coord is stubbed at the TRANSPORT with
``_patch_transport`` from ``test_operations_tenant_gate.py`` — one
``httpx.AsyncClient`` patch that answers ``/admin/coord/me`` per member and
every other coord path with a chosen payload, so ``_fetch_identity`` and the
console's coord proxy both run for real. The intent documents come from
``FakeCoord`` (``test_overview_authoring.py``) behind the real
``IntentDocumentStore``; pages, estimates and the change log are real rows in
the test database.

**What the matrix says today.** A team role (Administrator or Developer) reads
everything at every door, by design: a Developer is a member of the
operator's team. The only thing that keeps a person outside the team off a
team role is the rule that such a person is never given one (plan D8). The
outside-role member is refused 403 ``tenant_not_resolved`` at every door; the
intent-document and console cells also assert that no store read or coord call
beyond the identity check was made.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from tests.test_operations_tenant_gate import _me_payload, _patch_transport
from tests.test_overview_authoring import FakeCoord

pytestmark = pytest.mark.asyncio

OVERVIEW = "/api/v1/overview"
OPERATIONS = "/api/v1/operations"

#: The tenant ``_me_payload`` makes every member's home (and active) project.
TENANT = UUID("11111111-1111-1111-1111-111111111111")

QID = "00000000-0000-0000-0000-00000000e0a1"

#: Bodies the matrix asserts on. Placeholder text only: no tenant's real
#: positions belong in a test.
DECISION_BODY = "# Who keeps the work\n\nINTERNAL-POSITION-MARKER: a settled answer.\n"
OPEN_QUESTIONS_BODY = (
    "# Open questions\n\nQ1. INTERNAL-POSITION-MARKER: a question for another party.\n"
)
PROMPT_DOC = {
    "kind": "product_intent",
    "name": "open-questions",
    "current_version": 4,
    "body": OPEN_QUESTIONS_BODY,
}
ORDINARY_ROW = {
    "question_id": QID,
    "question": "Which default should the build run on?",
    "effect_kind": "none",
}

#: Why an outside-role member is refused here, and what closes the rest.
_OUTSIDE_RULE = (
    "web refuses an outside role before any handler runs; coord's own doors "
    "are the plan's Phase 2, the stakeholder role its Phase 11"
)


@dataclass(frozen=True)
class Member:
    """One member of :data:`TENANT`, as coord's ``/admin/coord/me`` sees them."""

    name: str
    roles: tuple[str, ...]
    #: ``/admin/coord/me``'s status for this member: 200, or 403 for a member
    #: holding no ``operator`` role in the active tenant.
    me_status: int


ADMIN = Member("administrator", ("admin",), 200)
DEVELOPER = Member("developer", ("operator",), 200)
OUTSIDE = Member("outside_role", ("helper",), 403)


# ===========================================================================
# Harness
# ===========================================================================


@pytest_asyncio.fixture()
async def web_user(async_db_session: AsyncSession):
    from uuid import uuid4

    from app.models.user import User

    user = User(
        email=f"exposure_{uuid4().hex[:8]}@example.com",
        username=f"exposure_{uuid4().hex[:8]}",
        full_name="Exposure Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


@pytest.fixture()
def coord() -> FakeCoord:
    fake = FakeCoord()
    fake.seed("decision_record", "who-keeps-the-work", DECISION_BODY)
    fake.seed("product_intent", "open-questions", OPEN_QUESTIONS_BODY)
    return fake


@dataclass
class Harness:
    """One app, real caller resolution, coord answered per member."""

    client: httpx.AsyncClient

    async def call(
        self,
        member: Member,
        method: str,
        url: str,
        *,
        proxy_payload: Any = None,
        **kwargs: Any,
    ) -> tuple[httpx.Response, MagicMock]:
        """Send one request as ``member``; return the answer and the coord
        stub, whose ``post`` calls show what was forwarded."""
        patcher, coord_client = _patch_transport(
            me_status=member.me_status,
            me_payload=_me_payload(home_roles=member.roles),
            proxy_payload=proxy_payload,
        )
        headers = {
            "Authorization": "Bearer cognito-test-token",
            "X-Overview-Source": "ui",
            **kwargs.pop("headers", {}),
        }
        with patcher:
            response = await self.client.request(method, url, headers=headers, **kwargs)
        return response, coord_client


@pytest_asyncio.fixture()
async def harness(
    async_db_session: AsyncSession, web_user: Any, coord: FakeCoord
) -> AsyncIterator[Harness]:
    from app.api.deps import (
        current_active_user,
        current_active_user_optional,
        get_async_db,
    )
    from app.api.v1.endpoints.operations import router as operations_router
    from app.api.v1.endpoints.overview import router as overview_router
    from app.overview.intent_documents import IntentDocumentStore, intent_document_store
    from app.overview.router import router as authoring_router

    app = FastAPI()
    # The signed-in person only. `get_overview_caller` and `get_tenant_id` are
    # deliberately NOT overridden: they resolve through coord /admin/coord/me.
    app.dependency_overrides[current_active_user] = app.dependency_overrides[
        current_active_user_optional
    ] = lambda: web_user

    async def _db():
        yield async_db_session

    app.dependency_overrides[get_async_db] = _db
    app.dependency_overrides[intent_document_store] = lambda: IntentDocumentStore(coord)
    app.include_router(overview_router, prefix=OVERVIEW)
    app.include_router(authoring_router, prefix=OVERVIEW)
    app.include_router(operations_router, prefix=OPERATIONS)
    # Built BEFORE any transport patch, so the test client is a real client.
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield Harness(client)


def _assert_refused(response: httpx.Response) -> None:
    assert response.status_code == 403, response.text
    assert response.json() == {"detail": "tenant_not_resolved"}


async def _seed_page(h: Harness) -> dict[str, Any]:
    response, _ = await h.call(
        ADMIN,
        "POST",
        f"{OVERVIEW}/pages",
        json={
            "kind": "document",
            "title": "Exposure briefing",
            "body_md": "# Briefing\n\nINTERNAL-POSITION-MARKER\n",
        },
    )
    assert response.status_code == 201, response.text
    item: dict[str, Any] = response.json()["item"]
    return item


async def _seed_estimate(h: Harness) -> dict[str, Any]:
    response, _ = await h.call(
        ADMIN,
        "POST",
        f"{OVERVIEW}/estimates",
        json={"name": "Exposure estimate", "purpose": "budget"},
    )
    assert response.status_code == 201, response.text
    item: dict[str, Any] = response.json()["item"]
    return item


async def _seed_intent_edit(h: Harness) -> None:
    response, _ = await h.call(
        ADMIN,
        "PATCH",
        f"{OVERVIEW}/intent-documents/product_intent:open-questions",
        json={"body": OPEN_QUESTIONS_BODY + "\nQ2. INTERNAL-POSITION-MARKER: added.\n"},
        headers={"If-Match": '"3"'},
    )
    assert response.status_code == 200, response.text


# ===========================================================================
# Overview door 1 — decision records (GET /intent-documents?kind=decision_record)
# ===========================================================================


class TestDecisionRecordDoor:
    async def _read(self, h: Harness, member: Member) -> httpx.Response:
        response, _ = await h.call(
            member,
            "GET",
            f"{OVERVIEW}/intent-documents",
            params={"kind": "decision_record"},
        )
        return response

    def _assert_served(self, response: httpx.Response) -> None:
        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert [i["name"] for i in items] == ["who-keeps-the-work"]
        assert "INTERNAL-POSITION-MARKER" in items[0]["body"]

    async def test_exposure_decision_records_administrator(
        self, harness: Harness
    ) -> None:
        """INTENDED: an Administrator reads every settled decision, body included."""
        self._assert_served(await self._read(harness, ADMIN))

    async def test_exposure_decision_records_developer(self, harness: Harness) -> None:
        """INTENDED, by design: a team role reads everything. A Developer reads
        every decision record, commercial ones included; only the rule that a
        person outside the team is never given a team role (plan D8) keeps an
        outside person off this answer."""
        self._assert_served(await self._read(harness, DEVELOPER))

    async def test_exposure_decision_records_outside_role(
        self, harness: Harness, coord: FakeCoord
    ) -> None:
        """INTENDED: refused before the store runs (see _OUTSIDE_RULE)."""
        _assert_refused(await self._read(harness, OUTSIDE))
        assert coord.gets == [], "the store ran for a refused caller"


# ===========================================================================
# Overview door 2 — product intent (GET /intent-documents?kind=product_intent)
# ===========================================================================


class TestProductIntentDoor:
    async def _read(self, h: Harness, member: Member) -> httpx.Response:
        response, _ = await h.call(
            member,
            "GET",
            f"{OVERVIEW}/intent-documents",
            params={"kind": "product_intent"},
        )
        return response

    def _assert_served(self, response: httpx.Response) -> None:
        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert [i["name"] for i in items] == ["open-questions"]
        assert "INTERNAL-POSITION-MARKER" in items[0]["body"]

    async def test_exposure_product_intent_administrator(
        self, harness: Harness
    ) -> None:
        """INTENDED: an Administrator reads the open-questions body."""
        self._assert_served(await self._read(harness, ADMIN))

    async def test_exposure_product_intent_developer(self, harness: Harness) -> None:
        """INTENDED, by design: a Developer reads the open-questions body, every
        party's questions and the operator's remarks in it. Kept off outside
        people only by never giving them a team role (plan D8)."""
        self._assert_served(await self._read(harness, DEVELOPER))

    async def test_exposure_product_intent_outside_role(
        self, harness: Harness, coord: FakeCoord
    ) -> None:
        """INTENDED: refused before the store runs (see _OUTSIDE_RULE)."""
        _assert_refused(await self._read(harness, OUTSIDE))
        assert coord.gets == [], "the store ran for a refused caller"


# ===========================================================================
# Overview door 3 — pages (GET /pages)
# ===========================================================================


class TestPagesDoor:
    async def _read(self, h: Harness, member: Member) -> httpx.Response:
        response, _ = await h.call(
            member, "GET", f"{OVERVIEW}/pages", params={"kind": "document"}
        )
        return response

    def _assert_served(self, response: httpx.Response, page: dict[str, Any]) -> None:
        assert response.status_code == 200, response.text
        assert page["id"] in [i["id"] for i in response.json()["items"]]

    async def test_exposure_pages_administrator(self, harness: Harness) -> None:
        """INTENDED: an Administrator lists the project's published pages."""
        page = await _seed_page(harness)
        self._assert_served(await self._read(harness, ADMIN), page)

    async def test_exposure_pages_developer(self, harness: Harness) -> None:
        """INTENDED, by design: a Developer lists every published page, a
        legal briefing included if one is published. Kept off outside people
        only by never giving them a team role (plan D8)."""
        page = await _seed_page(harness)
        self._assert_served(await self._read(harness, DEVELOPER), page)

    async def test_exposure_pages_outside_role(self, harness: Harness) -> None:
        """INTENDED: refused (see _OUTSIDE_RULE)."""
        await _seed_page(harness)
        _assert_refused(await self._read(harness, OUTSIDE))


# ===========================================================================
# Overview door 4 — estimates (GET /estimates)
# ===========================================================================


class TestEstimatesDoor:
    async def _read(self, h: Harness, member: Member) -> httpx.Response:
        response, _ = await h.call(member, "GET", f"{OVERVIEW}/estimates")
        return response

    def _assert_served(self, response: httpx.Response, est: dict[str, Any]) -> None:
        assert response.status_code == 200, response.text
        assert est["id"] in [i["id"] for i in response.json()["items"]]

    async def test_exposure_estimates_administrator(self, harness: Harness) -> None:
        """INTENDED: an Administrator reads the project's estimates."""
        est = await _seed_estimate(harness)
        self._assert_served(await self._read(harness, ADMIN), est)

    async def test_exposure_estimates_developer(self, harness: Harness) -> None:
        """INTENDED, by design: a Developer reads every estimate, prices
        included. Kept off outside people only by never giving them a team
        role (plan D8)."""
        est = await _seed_estimate(harness)
        self._assert_served(await self._read(harness, DEVELOPER), est)

    async def test_exposure_estimates_outside_role(self, harness: Harness) -> None:
        """INTENDED: refused (see _OUTSIDE_RULE)."""
        await _seed_estimate(harness)
        _assert_refused(await self._read(harness, OUTSIDE))


# ===========================================================================
# Overview door 5 — the change log (GET /change-log?resource=intent_documents)
# ===========================================================================


class TestChangeLogDoor:
    async def _read(self, h: Harness, member: Member) -> httpx.Response:
        response, _ = await h.call(
            member,
            "GET",
            f"{OVERVIEW}/change-log",
            params={
                "resource": "intent_documents",
                "record_id": "product_intent:open-questions",
            },
        )
        return response

    def _assert_served(self, response: httpx.Response) -> None:
        assert response.status_code == 200, response.text
        entries = response.json()["entries"]
        assert entries, "the seeded edit left no change-log row"
        latest = entries[0]
        # The rows carry the before AND after values, so the log is a second
        # way to read a document's text.
        assert "INTERNAL-POSITION-MARKER" in str(latest["before"])
        assert "Q2. INTERNAL-POSITION-MARKER: added." in str(latest["after"])

    async def test_exposure_change_log_administrator(self, harness: Harness) -> None:
        """INTENDED: an Administrator reads the edit history, with values."""
        await _seed_intent_edit(harness)
        self._assert_served(await self._read(harness, ADMIN))

    async def test_exposure_change_log_developer(self, harness: Harness) -> None:
        """INTENDED, by design: a Developer reads every edit's before and
        after text. Kept off outside people only by never giving them a team
        role (plan D8)."""
        await _seed_intent_edit(harness)
        self._assert_served(await self._read(harness, DEVELOPER))

    async def test_exposure_change_log_outside_role(self, harness: Harness) -> None:
        """INTENDED: refused (see _OUTSIDE_RULE)."""
        await _seed_intent_edit(harness)
        _assert_refused(await self._read(harness, OUTSIDE))


# ===========================================================================
# Console door 1 — GET /operations/coord/prompt-documents/{kind}/{name}
# ===========================================================================


class TestConsolePromptDocumentDoor:
    URL = f"{OPERATIONS}/coord/prompt-documents/product_intent/open-questions"

    async def _read(
        self, h: Harness, member: Member
    ) -> tuple[httpx.Response, MagicMock]:
        return await h.call(member, "GET", self.URL, proxy_payload=PROMPT_DOC)

    def _assert_served(self, response: httpx.Response, stub: MagicMock) -> None:
        assert response.status_code == 200, response.text
        assert response.json()["body"] == OPEN_QUESTIONS_BODY
        proxied = [c.args[0] for c in stub.get.call_args_list]
        assert any(
            u.endswith("/coord/prompt-documents/product_intent/open-questions")
            for u in proxied
        )

    async def test_exposure_console_prompt_document_administrator(
        self, harness: Harness
    ) -> None:
        """INTENDED: an Administrator reads any prompt document's body."""
        self._assert_served(*await self._read(harness, ADMIN))

    async def test_exposure_console_prompt_document_developer(
        self, harness: Harness
    ) -> None:
        """INTENDED, by design ("Any authenticated tenant member"): a Developer
        reads any prompt document's body, policy and intent alike. Kept off
        outside people only by never giving them a team role (plan D8)."""
        self._assert_served(*await self._read(harness, DEVELOPER))

    async def test_exposure_console_prompt_document_outside_role(
        self, harness: Harness
    ) -> None:
        """INTENDED at web: refused, and nothing is proxied to coord. Coord's
        own ``GET /coord/prompt-documents`` does NOT refuse this member today
        (finding b925b55d) — the plan's Phase 2."""
        response, stub = await self._read(harness, OUTSIDE)
        _assert_refused(response)
        proxied = [c.args[0] for c in stub.get.call_args_list]
        assert proxied, "the identity call did not go through the stubbed transport"
        assert all(u.endswith("/admin/coord/me") for u in proxied), proxied


# ===========================================================================
# Console door 2 — POST /operations/agent-questions/{id}/respond (ordinary row)
# ===========================================================================


class TestConsoleRespondDoor:
    URL = f"{OPERATIONS}/agent-questions/{QID}/respond"
    BODY = {
        "response": "default A",
        "responded_by_operator": "typed-by-client@example.com",
    }

    async def _answer(
        self, h: Harness, member: Member
    ) -> tuple[httpx.Response, MagicMock]:
        return await h.call(
            member, "POST", self.URL, json=self.BODY, proxy_payload=ORDINARY_ROW
        )

    def _assert_forwarded(self, response: httpx.Response, stub: MagicMock) -> None:
        assert response.status_code == 200, response.text
        assert stub.post.call_count == 1
        assert stub.post.call_args.args[0].endswith(
            f"/coord/agent-questions/{QID}/respond"
        )
        # An ordinary row forwards the CLIENT's body unchanged, its claimed
        # responder included: web does not stamp who answered.
        assert stub.post.call_args.kwargs["json"] == self.BODY

    async def test_exposure_console_respond_administrator(
        self, harness: Harness
    ) -> None:
        """INTENDED: an Administrator answers an ordinary agent question."""
        self._assert_forwarded(*await self._answer(harness, ADMIN))

    async def test_exposure_console_respond_developer(self, harness: Harness) -> None:
        """INTENDED, by design: a Developer answers any ordinary question, and
        the ``responded_by_operator`` the client typed is forwarded unchanged.
        Kept off outside people only by never giving them a team role (plan
        D8); an attributable answerer is the amended 09-19 Phase 6."""
        self._assert_forwarded(*await self._answer(harness, DEVELOPER))

    async def test_exposure_console_respond_outside_role(
        self, harness: Harness
    ) -> None:
        """INTENDED at web: refused, the row is not read and nothing is
        answered. Coord's own ``POST /coord/agent-questions/:id/respond`` does
        NOT refuse this member today (finding b925b55d) — the plan's Phase 2."""
        response, stub = await self._answer(harness, OUTSIDE)
        _assert_refused(response)
        assert stub.post.call_count == 0
        proxied = [c.args[0] for c in stub.get.call_args_list]
        assert proxied, "the identity call did not go through the stubbed transport"
        assert all(u.endswith("/admin/coord/me") for u in proxied), proxied
