"""Visibility marks, failing closed: what a caller WITHOUT a team role reads.

Plan ``2026-11-26-questions-only-another-party-can-answer-have-no-queue-no-answerer-and-no-visibility``,
Phase 5 (D5). What this file pins:

* **An unmarked document stays internal.** A caller whose roles in the active
  project hold no team role (``operator``, ``agent_supervisor``, ``admin``) is
  served only intent documents whose frontmatter says ``visibility: shared``.
  No frontmatter, no key, or a value the store does not know reads
  ``internal``. The list says ``withheld`` when it left something out — never
  how many or which — and a get of an unshared document is a 404.
* **Every other overview read is refused** with 403 ``not_shared_with_you``
  until its resource declares how outside roles read it: pages, estimates,
  the change log (which carries every write's before and after) and the
  project settings. The catalog serves the same answer as ``can_read``.
* **A team role reads everything, as before.**
* **The mark is set by a tenant admin, in place.** A ``visibility`` edit
  splices that one key into the stored frontmatter, keeps every other byte,
  creates a block for a document with none, keeps a decision record's
  provenance keys, and is refused to a member without the admin role.

These tests PROVE THE RULE with injected roles: they use the authoring
module's ``get_overview_caller`` override with roles ``("stakeholder",)``. No
production caller holding only an outside role reaches web today — web
resolves every person through coord ``/admin/coord/me``, which refuses such a
member with ``tenant_not_resolved`` — so today's exposure is measured by
``tests/test_overview_exposure_by_role.py`` (that plan's Phase 1), not here.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import pytest_asyncio

from tests.test_overview_authoring import (
    API,
    FakeCoord,
    _app,
    _client,
    api_user,  # noqa: F401 — a fixture, used by name
)

pytestmark = pytest.mark.asyncio

OUTSIDE_ROLES = ("stakeholder",)

SHARED_BODY = (
    "---\n"
    "audience: leaders\n"
    "visibility: shared\n"
    "---\n"
    "\n"
    "# Vision\n"
    "\n"
    "What we are building, for everyone on the project.\n"
)
UNMARKED_BODY = (
    "---\naudience: leaders\n---\n\n# Non-goals\n\nThe commercial position.\n"
)
NO_BLOCK_BODY = "# Open questions\n\nWho keeps the code.\n"
UNKNOWN_VALUE_BODY = (
    "---\nvisibility: public\n---\n\n# Current initiative\n\nThe margin.\n"
)
# A block whose every byte must survive a visibility edit: odd spacing, a
# comment, a nested mapping with a `visibility` key of its own, and a blank
# line between the block and the prose.
ODD_BLOCK = (
    "---\n"
    "audience:   leaders   \n"
    "# keep this comment\n"
    "nested:\n"
    "  visibility: not-the-top-level-key\n"
    "visibility: internal\n"
    "last_reviewed: 2026-09-01\n"
    "---\n"
)
ODD_BODY = ODD_BLOCK + "\n\n# Audience\n\nThe leaders.\n"
DECISION_BLOCK = (
    "---\n"
    "status: accepted\n"
    "decided_on: 2026-11-20\n"
    "decided_by: operator\n"
    "source: the operator, in session 1234, 2026-11-20\n"
    "supersedes: none\n"
    "---\n"
)
DECISION_BODY = DECISION_BLOCK + "\n# Ship on model A\n\nBecause it is reversible.\n"


@pytest.fixture()
def coord() -> FakeCoord:
    fake = FakeCoord()
    fake.seed("product_intent", "vision", SHARED_BODY)
    fake.seed("product_intent", "non-goals", UNMARKED_BODY)
    fake.seed("product_intent", "open-questions", NO_BLOCK_BODY)
    fake.seed("initiative", "current-initiative", UNKNOWN_VALUE_BODY)
    fake.seed("audience_profile", "leaders", ODD_BODY)
    fake.seed("decision_record", "ship-on-model-a", DECISION_BODY)
    return fake


@pytest_asyncio.fixture()
async def outsider(async_db_session, api_user, coord):  # noqa: F811
    """A member holding only an outside role in THIS project."""
    async with _client(_app(async_db_session, api_user, coord, OUTSIDE_ROLES)) as c:
        yield c


@pytest_asyncio.fixture()
async def admin(async_db_session, api_user, coord):  # noqa: F811
    async with _client(_app(async_db_session, api_user, coord, ("admin",))) as c:
        yield c


@pytest_asyncio.fixture()
async def operator(async_db_session, api_user, coord):  # noqa: F811
    """A Developer: coord role ``operator``, a team role without admin."""
    async with _client(_app(async_db_session, api_user, coord, ("operator",))) as c:
        yield c


def _ids(listing: dict[str, Any]) -> set[str]:
    return {item["id"] for item in listing["items"]}


def _not_shared(response: httpx.Response) -> None:
    assert response.status_code == 403, response.text
    detail = response.json()["detail"]
    assert detail["error"] == detail["code"] == "not_shared_with_you", detail


async def _set_visibility(
    client: httpx.AsyncClient, record: str, value: str, version: int = 3
) -> httpx.Response:
    return await client.patch(
        f"{API}/intent-documents/{record}",
        json={"visibility": value},
        headers={"If-Match": f'"{version}"'},
    )


class TestOutsideRoleReadsOnlyWhatIsShared:
    async def test_an_outside_role_never_reads_an_unmarked_document(
        self, outsider: httpx.AsyncClient
    ) -> None:
        """An outside role never reads an unmarked document: the list serves
        only the one marked ``visibility: shared``, and says it withheld the
        rest without naming them."""
        response = await outsider.get(f"{API}/intent-documents")
        assert response.status_code == 200, response.text
        listing = response.json()
        assert _ids(listing) == {"product_intent:vision"}
        assert listing["total"] == 1
        assert listing["withheld"] is True
        assert listing["can_edit"] is False
        assert "commercial position" not in response.text
        assert "non-goals" not in response.text

    async def test_an_outside_role_cannot_get_an_unmarked_document(
        self, outsider: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        """The same for ``get``: a 404, as for a document that does not exist,
        so the name is not confirmed either."""
        for record in (
            "product_intent:non-goals",
            "product_intent:open-questions",
            "decision_record:ship-on-model-a",
        ):
            response = await outsider.get(f"{API}/intent-documents/{record}")
            assert response.status_code == 404, (record, response.text)
            assert "commercial position" not in response.text

    async def test_an_outside_role_reads_a_document_marked_shared(
        self, outsider: httpx.AsyncClient
    ) -> None:
        response = await outsider.get(f"{API}/intent-documents/product_intent:vision")
        assert response.status_code == 200, response.text
        item = response.json()["item"]
        assert item["visibility"] == "shared"
        assert "for everyone on the project" in item["body"]
        assert response.json()["can_edit"] is False

    async def test_an_unknown_visibility_value_reads_internal(
        self, outsider: httpx.AsyncClient, admin: httpx.AsyncClient
    ) -> None:
        """``visibility: public`` is not a value the store knows: internal."""
        listing = (await outsider.get(f"{API}/intent-documents")).json()
        assert "initiative:current-initiative" not in _ids(listing)
        got = await outsider.get(
            f"{API}/intent-documents/initiative:current-initiative"
        )
        assert got.status_code == 404, got.text
        seen_by_team = await admin.get(
            f"{API}/intent-documents/initiative:current-initiative"
        )
        assert seen_by_team.json()["item"]["visibility"] == "internal"


class TestOutsideRoleIsRefusedEverythingUndeclared:
    async def test_pages_are_not_shared_with_an_outside_role(
        self, outsider: httpx.AsyncClient
    ) -> None:
        _not_shared(await outsider.get(f"{API}/pages"))

    async def test_estimates_are_not_shared_with_an_outside_role(
        self, outsider: httpx.AsyncClient
    ) -> None:
        _not_shared(await outsider.get(f"{API}/estimates"))

    async def test_the_change_log_is_not_shared_with_an_outside_role(
        self, outsider: httpx.AsyncClient, admin: httpx.AsyncClient
    ) -> None:
        """Even for intent documents, a ``marked`` resource: each row carries a
        write's before and after, which would show an unshared document."""
        edited = await admin.patch(
            f"{API}/intent-documents/product_intent:non-goals",
            json={"body": "# Non-goals\n\nA revised commercial position.\n"},
            headers={"If-Match": '"3"'},
        )
        assert edited.status_code == 200, edited.text
        response = await outsider.get(
            f"{API}/change-log", params={"resource": "intent_documents"}
        )
        _not_shared(response)
        assert "commercial position" not in response.text

    async def test_settings_are_not_shared_with_an_outside_role(
        self, outsider: httpx.AsyncClient
    ) -> None:
        _not_shared(await outsider.get(f"{API}/settings"))


class TestTeamRoleReadsEverything:
    async def test_a_team_role_reads_every_document_as_before(
        self, operator: httpx.AsyncClient, admin: httpx.AsyncClient
    ) -> None:
        for client in (operator, admin):
            listing = (await client.get(f"{API}/intent-documents")).json()
            assert _ids(listing) == {
                "product_intent:vision",
                "product_intent:non-goals",
                "product_intent:open-questions",
                "initiative:current-initiative",
                "audience_profile:leaders",
                "decision_record:ship-on-model-a",
            }
            assert listing["withheld"] is False
            got = await client.get(f"{API}/intent-documents/product_intent:non-goals")
            assert got.status_code == 200, got.text
            assert got.json()["item"]["visibility"] == "internal"
            assert (await client.get(f"{API}/pages")).status_code == 200
            assert (await client.get(f"{API}/settings")).status_code == 200

    async def test_the_catalog_serves_the_same_read_answer(
        self, outsider: httpx.AsyncClient, operator: httpx.AsyncClient
    ) -> None:
        """``can_read`` is what the read routes enforce: for an outside role,
        only the resources that declare ``outside_read="marked"``."""
        outside = (await outsider.get(f"{API}/resources")).json()["resources"]
        team = (await operator.get(f"{API}/resources")).json()["resources"]
        readable = {r["name"] for r in outside if r["can_read"]}
        assert readable == {"intent_documents"}
        assert not any(r["can_edit"] for r in outside)
        assert all(r["can_read"] for r in team)


class TestTheMarkIsSetInPlace:
    async def test_a_visibility_edit_changes_only_that_key(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        response = await _set_visibility(admin, "audience_profile:leaders", "shared")
        assert response.status_code == 200, response.text
        assert response.json()["item"]["visibility"] == "shared"
        stored = coord.docs[("audience_profile", "leaders")]["body"]
        expected_block = ODD_BLOCK.replace(
            "\nvisibility: internal\n", "\nvisibility: shared\n"
        )
        assert stored == expected_block + "\n\n# Audience\n\nThe leaders.\n"
        # The nested key of the same name is not the mark and is untouched.
        assert "  visibility: not-the-top-level-key\n" in stored

    async def test_a_visibility_edit_creates_a_block_for_a_document_with_none(
        self,
        admin: httpx.AsyncClient,
        outsider: httpx.AsyncClient,
        coord: FakeCoord,
    ) -> None:
        response = await _set_visibility(
            admin, "product_intent:open-questions", "shared"
        )
        assert response.status_code == 200, response.text
        stored = coord.docs[("product_intent", "open-questions")]["body"]
        assert stored == "---\nvisibility: shared\n---\n\n" + NO_BLOCK_BODY
        # …and the outside role now reads it.
        got = await outsider.get(
            f"{API}/intent-documents/product_intent:open-questions"
        )
        assert got.status_code == 200, got.text
        assert got.json()["item"]["body"] == NO_BLOCK_BODY

    async def test_a_decision_record_keeps_its_provenance_after_a_splice(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        response = await _set_visibility(
            admin, "decision_record:ship-on-model-a", "shared"
        )
        assert response.status_code == 200, response.text
        stored = coord.docs[("decision_record", "ship-on-model-a")]["body"]
        for line in DECISION_BLOCK.splitlines():
            assert line in stored.splitlines(), line
        # The key goes in just before the closing delimiter; nothing else moves.
        assert stored == (
            DECISION_BLOCK[: -len("---\n")]
            + "visibility: shared\n---\n"
            + DECISION_BODY[len(DECISION_BLOCK) :]
        )

    async def test_a_member_without_the_admin_role_cannot_set_visibility(
        self, operator: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        response = await _set_visibility(operator, "product_intent:non-goals", "shared")
        assert response.status_code == 403, response.text
        assert response.json()["detail"]["error"] == "not_permitted"
        assert coord.patches == []
        assert coord.docs[("product_intent", "non-goals")]["body"] == UNMARKED_BODY
