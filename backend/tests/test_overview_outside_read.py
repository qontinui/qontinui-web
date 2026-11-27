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
    _log_rows,
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


# ===========================================================================
# Review fixes: the mark is found by the YAML parser, never by a line regex
# ===========================================================================


class TestTheMarkIsReadAsYaml:
    """``visibility_of`` and ``splice_visibility`` read the block as YAML, so
    a key-shaped line inside a quoted scalar is not a key, a duplicate or an
    empty value reads internal, and a splice always leaves exactly one
    parseable ``visibility: <value>`` line."""

    async def test_a_visibility_line_inside_a_multiline_quoted_scalar_is_not_the_key(
        self,
    ) -> None:
        from app.overview.intent_documents import visibility_of

        for block in (
            "---\nsummary: 'a\nvisibility: shared # x'\n---\n",
            '---\nsummary: "a\nvisibility: shared"\nb: 1\n---\n',
        ):
            assert visibility_of(block) == "internal", block

    async def test_splicing_beside_a_multiline_quoted_scalar_keeps_it_whole(
        self,
    ) -> None:
        import yaml

        from app.overview.intent_documents import splice_visibility, visibility_of

        block = '---\nsummary: "a\nvisibility: shared"\nb: 1\n---\n'
        spliced = splice_visibility(block, "shared")
        inner = spliced.split("---\n")[1]
        assert yaml.safe_load(inner) == {
            "summary": "a visibility: shared",
            "b": 1,
            "visibility": "shared",
        }
        assert visibility_of(spliced) == "shared"

    async def test_a_duplicated_key_reads_internal_and_a_splice_leaves_one(
        self,
    ) -> None:
        from app.overview.intent_documents import splice_visibility, visibility_of

        block = "---\na: 1\nvisibility: shared\nb: 2\nvisibility: shared\n---\n"
        assert visibility_of(block) == "internal"
        spliced = splice_visibility(block, "shared")
        assert spliced == "---\na: 1\nvisibility: shared\nb: 2\n---\n"
        assert visibility_of(spliced) == "shared"

    async def test_an_empty_value_and_its_children_are_replaced_by_one_line(
        self,
    ) -> None:
        import yaml

        from app.overview.intent_documents import splice_visibility, visibility_of

        for block in (
            "---\nvisibility:\nb: 2\n---\n",
            "---\na: 1\nvisibility:\n  nested: x\n  more: y\nb: 2\n---\n",
        ):
            assert visibility_of(block) == "internal", block
            spliced = splice_visibility(block, "shared")
            assert "visibility: shared\n" in spliced
            assert "nested" not in spliced
            loaded = yaml.safe_load(spliced.split("---\n")[1])
            assert isinstance(loaded, dict) and loaded["visibility"] == "shared"
            assert loaded["b"] == 2

    async def test_crlf_and_a_missing_trailing_newline_are_kept(self) -> None:
        from app.overview.intent_documents import (
            splice_visibility,
            splice_visibility_into_body,
        )

        assert (
            splice_visibility("---\r\na: 1\r\n---\r\n", "shared")
            == "---\r\na: 1\r\nvisibility: shared\r\n---\r\n"
        )
        assert (
            splice_visibility("---\na: 1\n---", "shared")
            == "---\na: 1\nvisibility: shared\n---"
        )
        # A new block follows the body's own line endings and OPENS the body:
        # coord reads frontmatter only when the first line is exactly `---`,
        # so a leading BOM is dropped.
        created = splice_visibility_into_body("\ufeff# T\r\n\r\nx\r\n", "shared")
        assert created.startswith("---")
        assert created == "---\r\nvisibility: shared\r\n---\r\n\r\n# T\r\n\r\nx\r\n"

    async def test_a_block_that_does_not_parse_reads_internal_and_is_not_spliced(
        self,
    ) -> None:
        from app.overview.intent_documents import (
            FrontmatterNotEditable,
            splice_visibility,
            visibility_of,
        )

        for block in (
            "---\na: 'unclosed\nvisibility: shared\n---\n",
            "---\n[visibility, shared]\n---\n",
            "---\n{visibility: shared}\n---\n",
        ):
            if "{" not in block:
                assert visibility_of(block) == "internal", block
            with pytest.raises(FrontmatterNotEditable):
                splice_visibility(block, "shared")


CRLF_BODY = "---\r\naudience: leaders\r\n---\r\n\r\n# Vision\r\n\r\nText.\r\n"
UNPARSEABLE_BODY = "---\naudience: 'unclosed\n---\n\n# Broken\n\nText.\n"


@pytest.fixture()
def coord_more(coord: FakeCoord) -> FakeCoord:
    coord.seed("success_metric", "crlf", CRLF_BODY)
    coord.seed("success_metric", "broken", UNPARSEABLE_BODY)
    return coord


class TestTheMarkThroughTheApi:
    async def test_a_crlf_document_keeps_its_line_endings(
        self, admin: httpx.AsyncClient, coord_more: FakeCoord
    ) -> None:
        response = await _set_visibility(admin, "success_metric:crlf", "shared")
        assert response.status_code == 200, response.text
        assert coord_more.docs[("success_metric", "crlf")]["body"] == (
            "---\r\naudience: leaders\r\nvisibility: shared\r\n---\r\n"
            "\r\n# Vision\r\n\r\nText.\r\n"
        )

    async def test_an_unparseable_block_is_a_422_and_nothing_is_written(
        self, admin: httpx.AsyncClient, coord_more: FakeCoord
    ) -> None:
        response = await _set_visibility(admin, "success_metric:broken", "shared")
        assert response.status_code == 422, response.text
        assert "frontmatter_not_editable" in response.text
        assert coord_more.patches == []

    async def test_body_and_visibility_in_one_patch(
        self, admin: httpx.AsyncClient, coord: FakeCoord
    ) -> None:
        response = await admin.patch(
            f"{API}/intent-documents/product_intent:non-goals",
            json={"body": "# Non-goals\n\nRewritten.\n", "visibility": "shared"},
            headers={"If-Match": '"3"'},
        )
        assert response.status_code == 200, response.text
        assert len(coord.patches) == 1
        assert coord.docs[("product_intent", "non-goals")]["body"] == (
            "---\naudience: leaders\nvisibility: shared\n---\n\n"
            "# Non-goals\n\nRewritten.\n"
        )
        assert response.json()["item"]["visibility"] == "shared"

    async def test_shared_can_be_set_back_to_internal(
        self,
        admin: httpx.AsyncClient,
        outsider: httpx.AsyncClient,
        coord: FakeCoord,
    ) -> None:
        response = await _set_visibility(admin, "product_intent:vision", "internal")
        assert response.status_code == 200, response.text
        assert coord.docs[("product_intent", "vision")]["body"] == SHARED_BODY.replace(
            "visibility: shared", "visibility: internal"
        )
        got = await outsider.get(f"{API}/intent-documents/product_intent:vision")
        assert got.status_code == 404, got.text

    async def test_an_unshared_404_is_the_same_as_a_missing_one(
        self, outsider: httpx.AsyncClient
    ) -> None:
        unshared = await outsider.get(
            f"{API}/intent-documents/product_intent:non-goals"
        )
        missing = await outsider.get(f"{API}/intent-documents/product_intent:nope")
        assert unshared.status_code == missing.status_code == 404
        assert unshared.json() == missing.json()

    async def test_the_withheld_answer_does_not_depend_on_the_kind_asked_for(
        self, outsider: httpx.AsyncClient
    ) -> None:
        """``withheld`` is one answer for the tenant. Asking for a kind that
        is EMPTY here (success_metric, domain_spec) must still say withheld:
        per-kind, it would read false there and true elsewhere, and the
        difference would tell which kinds hold unshared documents."""
        for kind in (
            "product_intent",
            "initiative",
            "decision_record",
            "success_metric",
            "domain_spec",
        ):
            listing = (
                await outsider.get(f"{API}/intent-documents", params={"kind": kind})
            ).json()
            assert listing["withheld"] is True, kind
            assert all(item["kind"] == kind for item in listing["items"]), kind

    async def test_an_outside_role_is_refused_a_files_bytes_and_an_estimates_rollup(
        self, outsider: httpx.AsyncClient
    ) -> None:
        any_id = "00000000-0000-4000-8000-000000000001"
        _not_shared(await outsider.get(f"{API}/files/{any_id}/content"))
        _not_shared(await outsider.get(f"{API}/estimates/{any_id}/rollup"))

    async def test_an_owner_is_a_team_role(
        self,
        async_db_session,
        api_user,  # noqa: F811 — the imported fixture, by name
        coord: FakeCoord,
    ) -> None:
        """Coord counts ``owner`` as admin-class; web agrees."""
        async with _client(_app(async_db_session, api_user, coord, ("owner",))) as c:
            listing = (await c.get(f"{API}/intent-documents")).json()
            assert listing["withheld"] is False
            assert len(listing["items"]) == 6
            assert (await c.get(f"{API}/pages")).status_code == 200
            assert (await c.get(f"{API}/settings")).status_code == 200


# ===========================================================================
# Round-2 review fixes
# ===========================================================================

#: Flow nesting deep enough to exhaust PyYAML's recursive composer, small
#: enough to pass the size bound — so only the RecursionError guard holds it.
DEEP_BLOCK = "---\nx: " + "[" * 2000 + "]" * 2000 + "\n---\n"
DEEP_BODY = DEEP_BLOCK + "\n# Deep\n\nText.\n"
ALIAS_BODY = "---\na: &s shared\nvisibility: *s\nb: 1\n---\n\n# Alias\n\nText.\n"
CRLF_NO_BLOCK_BODY = "# Plain\r\n\r\nText.\r\n"
PROSE = "\n# Doc\n\nText.\n"
#: Past the size bound: never handed to the parser.
HUGE_BLOCK = "---\nvisibility: shared\n" + "x: 1\n" * 4000 + "---\n"
#: A visibility key the one-line splice cannot change and removal cannot drop
#: without breaking an alias: indented with its own anchor, and anchored then
#: reused by a later key.
ANCHORED_BLOCKS = (
    "---\n  visibility: &s shared\n  b: *s\n---\n",
    "---\nvisibility: &v shared\nb: *v\n---\n",
)


@pytest.fixture()
def coord_round2(coord: FakeCoord) -> FakeCoord:
    coord.seed("domain_spec", "deep", DEEP_BODY)
    coord.seed("audience_profile", "alias", ALIAS_BODY)
    coord.seed("audience_profile", "anchored-indented", ANCHORED_BLOCKS[0] + PROSE)
    coord.seed("audience_profile", "anchored-reused", ANCHORED_BLOCKS[1] + PROSE)
    coord.seed("domain_spec", "huge", HUGE_BLOCK + PROSE)
    coord.seed("product_intent", "crlf-plain", CRLF_NO_BLOCK_BODY)
    return coord


class TestRoundTwo:
    async def test_deeply_nested_frontmatter_reads_internal_and_is_not_spliced(
        self,
    ) -> None:
        from app.overview.intent_documents import (
            FrontmatterNotEditable,
            splice_visibility,
            visibility_of,
        )

        assert visibility_of(DEEP_BLOCK) == "internal"
        with pytest.raises(FrontmatterNotEditable):
            splice_visibility(DEEP_BLOCK, "shared")
        # Past the size bound: internal, without asking the parser.
        huge = "---\nvisibility: shared\n" + "x: 1\n" * 4000 + "---\n"
        assert visibility_of(huge) == "internal"

    async def test_a_deeply_nested_document_does_not_break_the_list(
        self,
        outsider: httpx.AsyncClient,
        admin: httpx.AsyncClient,
        coord_round2: FakeCoord,
    ) -> None:
        for client in (outsider, admin):
            response = await client.get(f"{API}/intent-documents")
            assert response.status_code == 200, response.text
        team_ids = _ids((await admin.get(f"{API}/intent-documents")).json())
        assert "domain_spec:deep" in team_ids
        got = await outsider.get(f"{API}/intent-documents/domain_spec:deep")
        assert got.status_code == 404, got.text
        refused = await _set_visibility(admin, "domain_spec:deep", "shared")
        assert refused.status_code == 422, refused.text

    async def test_a_document_shared_through_an_alias_can_be_unshared(
        self,
        outsider: httpx.AsyncClient,
        admin: httpx.AsyncClient,
        coord_round2: FakeCoord,
    ) -> None:
        seen = await outsider.get(f"{API}/intent-documents/audience_profile:alias")
        assert seen.status_code == 200, seen.text
        response = await _set_visibility(admin, "audience_profile:alias", "internal")
        assert response.status_code == 200, response.text
        assert coord_round2.docs[("audience_profile", "alias")]["body"] == (
            "---\na: &s shared\nvisibility: internal\nb: 1\n---\n\n# Alias\n\nText.\n"
        )
        gone = await outsider.get(f"{API}/intent-documents/audience_profile:alias")
        assert gone.status_code == 404, gone.text

    async def test_unsharing_an_indented_mapping_removes_the_key(self) -> None:
        """The one line does not fit an indented mapping; removing the key
        does, and the block still parses."""
        from app.overview.intent_documents import (
            _parses,
            splice_visibility,
            visibility_of,
        )

        block = "---\n  a: 1\n  visibility: shared\n---\n"
        assert visibility_of(block) == "shared"
        spliced = splice_visibility(block, "internal")
        assert spliced == "---\n  a: 1\n---\n"
        assert _parses(spliced)

    async def test_a_key_that_cannot_be_edited_is_refused_never_doubled(
        self,
    ) -> None:
        from app.overview.intent_documents import (
            FrontmatterNotEditable,
            splice_visibility,
            visibility_of,
        )

        for block in ANCHORED_BLOCKS:
            assert visibility_of(block) == "shared", block
            for value in ("internal", "shared"):
                with pytest.raises(FrontmatterNotEditable, match="by hand"):
                    splice_visibility(block, value)  # type: ignore[arg-type]

    async def test_an_anchored_key_is_a_422_with_nothing_written(
        self, admin: httpx.AsyncClient, coord_round2: FakeCoord
    ) -> None:
        for name in ("anchored-indented", "anchored-reused"):
            stored = coord_round2.docs[("audience_profile", name)]["body"]
            response = await _set_visibility(
                admin, f"audience_profile:{name}", "internal"
            )
            assert response.status_code == 422, (name, response.text)
            assert "frontmatter_not_editable" in response.text
            assert coord_round2.docs[("audience_profile", name)]["body"] == stored
        assert coord_round2.patches == []

    async def test_an_unreadable_block_refuses_either_value(
        self, admin: httpx.AsyncClient, coord_round2: FakeCoord
    ) -> None:
        """Too large or too deep reads internal, and a write of EITHER value is
        a 422 — never a silent no-op that looks like it landed."""
        for name in ("deep", "huge"):
            for value in ("internal", "shared"):
                response = await _set_visibility(admin, f"domain_spec:{name}", value)
                assert response.status_code == 422, (name, value, response.text)
                assert "too large or deeply nested" in response.text
        assert coord_round2.patches == []

    async def test_an_internal_write_on_an_internal_document_is_a_no_op(
        self,
        admin: httpx.AsyncClient,
        coord: FakeCoord,
        async_db_session,
    ) -> None:
        response = await _set_visibility(admin, "product_intent:non-goals", "internal")
        assert response.status_code == 200, response.text
        assert response.json()["item"]["version"] == 3
        assert coord.patches == []
        assert coord.docs[("product_intent", "non-goals")]["body"] == UNMARKED_BODY
        assert await _log_rows(async_db_session, "intent_documents") == []

    async def test_comments_and_blank_lines_after_a_nested_value_are_kept(
        self,
    ) -> None:
        from app.overview.intent_documents import splice_visibility

        block = "---\nvisibility:\n  a: 1\n# about b\n\nb: 2\n---\n"
        assert (
            splice_visibility(block, "shared")
            == "---\nvisibility: shared\n# about b\n\nb: 2\n---\n"
        )
        scalar = "---\nvisibility: |\n  shared\n# c\nb: 2\n---\n"
        assert (
            splice_visibility(scalar, "internal")
            == "---\nvisibility: internal\n# c\nb: 2\n---\n"
        )

    async def test_body_and_visibility_on_a_crlf_document_without_a_block(
        self, admin: httpx.AsyncClient, coord_round2: FakeCoord
    ) -> None:
        """The created block takes the stored body's CRLF, and opens the body:
        the prose's BOM is dropped, never moved in front of the fence."""
        response = await admin.patch(
            f"{API}/intent-documents/product_intent:crlf-plain",
            json={"body": "\ufeff# Plain\r\n\r\nNew.\r\n", "visibility": "shared"},
            headers={"If-Match": '"3"'},
        )
        assert response.status_code == 200, response.text
        stored = coord_round2.docs[("product_intent", "crlf-plain")]["body"]
        assert stored.startswith("---")
        assert stored == (
            "---\r\nvisibility: shared\r\n---\r\n\r\n# Plain\r\n\r\nNew.\r\n"
        )
