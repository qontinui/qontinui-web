"""``resolve_identity_for_email`` — the email → (Username, sub) resolver.

Plan ``2026-09-15-simplify-tenant-member-add-by-email`` Phase 1.

``POST /operations/coord/tenant-members`` takes an email and a role and
nothing else, so the server has to produce the Cognito ``sub`` that coord
stores as ``sso_subject``. In this pool ``Username`` is NOT the ``sub`` (see
``resolve_username_for_sub``'s docstring), so the existing
``resolve_username_for_email`` cannot supply it.

Two properties are pinned here and they pull in opposite directions:

* **The ``sub`` costs no extra AWS call.** ``ListUsers`` already returns each
  user's ``Attributes``, so the answer is in the page data the resolver has
  already paid for. A second ``AdminGetUser`` round-trip per lookup would be
  a real cost on a route an admin drives interactively — and against the
  same admin-API quota whose throttle the endpoint layer maps to 429.
* **None of the existing paging or ambiguity behaviour moves.** Both
  resolvers now share one core, so a regression in either is a regression in
  both. The first-page-only bug this file's sibling
  (``tests/test_cognito_admin_pagination.py``) was written for reported real,
  signed-up users as "they must sign up first"; the ambiguity check is what
  stops a duplicated email silently handing tenant access to whichever human
  Cognito happened to page first.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.core.config import settings
from app.services import cognito_admin
from app.services.cognito_admin import (
    CognitoAdminError,
    CognitoAmbiguousEmailError,
)


class _PagingClient:
    """boto3 stand-in replaying a scripted ``ListUsers`` page sequence.

    Each scripted page is a full response dict so a test controls ``Users``
    and ``PaginationToken`` independently — the only way to express "empty
    page, more to come".
    """

    def __init__(self, pages: list[dict[str, Any]]) -> None:
        self._pages = pages
        self.calls: list[dict[str, Any]] = []

    def list_users(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        index = len(self.calls) - 1
        if index >= len(self._pages):
            raise AssertionError(
                f"list_users called {len(self.calls)} times but only "
                f"{len(self._pages)} pages were scripted"
            )
        return self._pages[index]

    def admin_get_user(self, **kwargs: Any) -> dict[str, Any]:
        raise AssertionError(
            "AdminGetUser must not be called — the sub is already in the "
            "ListUsers page data"
        )


@pytest.fixture
def paging(monkeypatch: pytest.MonkeyPatch):
    """Build a ``_PagingClient`` from a page script and install it."""

    def _install(pages: list[dict[str, Any]]) -> _PagingClient:
        client = _PagingClient(pages)
        monkeypatch.setattr(cognito_admin, "_get_client", lambda: client)
        monkeypatch.setattr(settings, "COGNITO_USER_POOL_ID", "pool-xyz")
        return client

    return _install


def _user(username: str, sub: str | None = None, email: str | None = None):
    """A ``ListUsers`` entry in the shape AWS actually returns it."""
    attributes: list[dict[str, str]] = []
    if sub is not None:
        attributes.append({"Name": "sub", "Value": sub})
    if email is not None:
        attributes.append({"Name": "email", "Value": email})
    return {"Username": username, "Attributes": attributes, "Enabled": True}


class TestItReturnsTheSub:
    def test_it_returns_both_halves_from_one_listusers_page(self, paging):
        client = paging([{"Users": [_user("josh", sub="s-1", email="j@x.io")]}])

        identity = cognito_admin.resolve_identity_for_email("j@x.io")

        assert identity is not None
        assert identity.username == "josh"
        assert identity.sub == "s-1"
        # ONE AWS call. `_PagingClient.admin_get_user` asserts on the second
        # round-trip, but the call count is the direct statement of it.
        assert len(client.calls) == 1

    def test_username_and_sub_are_not_the_same_value(self, paging):
        """The whole reason this resolver exists. A pool where the two
        coincide would let the caller use ``resolve_username_for_email`` and
        this function would be dead code; this pool is not that pool."""
        paging([{"Users": [_user("josh@qontinui.io", sub="9f3c-opaque")]}])

        identity = cognito_admin.resolve_identity_for_email("j@x.io")

        assert identity is not None
        assert identity.username != identity.sub
        assert identity.sub == "9f3c-opaque"

    def test_it_is_a_named_tuple_so_both_halves_are_addressable(self, paging):
        paging([{"Users": [_user("u1", sub="s-1")]}])

        identity = cognito_admin.resolve_identity_for_email("u1@x.io")

        assert identity == cognito_admin.CognitoIdentity(username="u1", sub="s-1")

    def test_other_attributes_do_not_confuse_the_sub(self, paging):
        """``sub`` is read by name out of the attribute list, not by
        position — an attribute order AWS never promised must not decide
        which opaque string becomes a tenant grant."""
        paging(
            [
                {
                    "Users": [
                        {
                            "Username": "u1",
                            "Attributes": [
                                {"Name": "email_verified", "Value": "true"},
                                {"Name": "custom:tenant", "Value": "decoy"},
                                {"Name": "sub", "Value": "the-real-sub"},
                                {"Name": "email", "Value": "u1@x.io"},
                            ],
                        }
                    ]
                }
            ]
        )

        identity = cognito_admin.resolve_identity_for_email("u1@x.io")

        assert identity is not None
        assert identity.sub == "the-real-sub"


class TestItStillPagesFully:
    def test_an_empty_first_page_with_a_token_is_not_the_answer(self, paging):
        """THE regression pin, inherited. The old single-page read returned
        ``None`` here, which the endpoint reported as "no such user" about
        somebody who had signed up."""
        client = paging(
            [
                {"Users": [], "PaginationToken": "page-2"},
                {"Users": [_user("deep", sub="s-deep")]},
            ]
        )

        identity = cognito_admin.resolve_identity_for_email("deep@x.io")

        assert identity is not None
        assert identity.sub == "s-deep"
        assert len(client.calls) == 2
        assert client.calls[1]["PaginationToken"] == "page-2"
        assert "PaginationToken" not in client.calls[0]

    def test_it_follows_several_empty_pages(self, paging):
        client = paging(
            [
                {"Users": [], "PaginationToken": "p2"},
                {"Users": [], "PaginationToken": "p3"},
                {"Users": [], "PaginationToken": "p4"},
                {"Users": [_user("deep", sub="s-deep")]},
            ]
        )

        assert cognito_admin.resolve_identity_for_email("deep@x.io") is not None
        assert len(client.calls) == 4

    def test_a_genuinely_absent_user_is_none(self, paging):
        client = paging(
            [
                {"Users": [], "PaginationToken": "p2"},
                {"Users": []},
            ]
        )

        assert cognito_admin.resolve_identity_for_email("ghost@x.io") is None
        assert len(client.calls) == 2

    def test_every_page_carries_the_filter_and_the_pool(self, paging):
        client = paging(
            [
                {"Users": [], "PaginationToken": "p2"},
                {"Users": [_user("u1", sub="s-1")]},
            ]
        )
        cognito_admin.resolve_identity_for_email("u1@example.com")

        for call in client.calls:
            assert call["UserPoolId"] == "pool-xyz"
            assert call["Filter"] == 'email = "u1@example.com"'

    def test_an_empty_email_makes_no_call(self, paging):
        client = paging([])
        assert cognito_admin.resolve_identity_for_email("") is None
        assert client.calls == []

    def test_an_embedded_quote_is_stripped_from_the_filter(self, paging):
        """Same filter-hygiene rule as the username resolver: a ``"`` would
        break the ``attribute = "value"`` grammar."""
        client = paging([{"Users": []}])

        cognito_admin.resolve_identity_for_email('a"b@x.io')

        assert client.calls[0]["Filter"] == 'email = "ab@x.io"'


class TestItStillRaisesOnAmbiguity:
    def test_two_matches_on_one_page_raise(self, paging):
        paging(
            [{"Users": [_user("u1", sub="s-1"), _user("u2", sub="s-2")]}],
        )

        with pytest.raises(CognitoAmbiguousEmailError):
            cognito_admin.resolve_identity_for_email("dupe@x.io")

    def test_two_matches_split_across_pages_still_raise(self, paging):
        """Ambiguity is decided over the WHOLE result set. Judging per page
        would silently pick whichever identity Cognito paged first — and on
        this route that identity is the one that gets tenant access."""
        client = paging(
            [
                {"Users": [_user("u1", sub="s-1")], "PaginationToken": "p2"},
                {"Users": [_user("u2", sub="s-2")]},
            ]
        )

        with pytest.raises(CognitoAmbiguousEmailError):
            cognito_admin.resolve_identity_for_email("dupe@x.io")
        assert len(client.calls) == 2

    def test_ambiguity_stops_paging_immediately(self, paging):
        """Only two pages are scripted; a third call raises from the
        stand-in. Once a second match exists the answer is fixed."""
        client = paging(
            [
                {"Users": [_user("u1", sub="s-1")], "PaginationToken": "p2"},
                {"Users": [_user("u2", sub="s-2")], "PaginationToken": "p3"},
            ]
        )

        with pytest.raises(CognitoAmbiguousEmailError):
            cognito_admin.resolve_identity_for_email("dupe@x.io")
        assert len(client.calls) == 2


class TestMalformedPoolRows:
    def test_a_user_with_no_sub_raises_rather_than_reading_as_absent(self, paging):
        """A pool row without its own primary key is a broken upstream. The
        one answer that must NOT come back is ``None``: the route turns that
        into ``invite_required``, telling an admin their colleague has no
        account when the pool just returned them."""
        paging([{"Users": [{"Username": "u1", "Attributes": []}]}])

        with pytest.raises(CognitoAdminError, match="no 'sub' attribute"):
            cognito_admin.resolve_identity_for_email("u1@x.io")

    def test_an_empty_sub_value_is_treated_as_missing(self, paging):
        paging([{"Users": [_user("u1", sub="")]}])

        with pytest.raises(CognitoAdminError, match="no 'sub' attribute"):
            cognito_admin.resolve_identity_for_email("u1@x.io")

    def test_a_row_without_a_username_is_none(self, paging):
        paging([{"Users": [{"Attributes": [{"Name": "sub", "Value": "s-1"}]}]}])

        assert cognito_admin.resolve_identity_for_email("u1@x.io") is None

    def test_a_missing_attributes_key_does_not_crash(self, paging):
        paging([{"Users": [{"Username": "u1"}]}])

        with pytest.raises(CognitoAdminError, match="no 'sub' attribute"):
            cognito_admin.resolve_identity_for_email("u1@x.io")


class TestTheTwoResolversAgree:
    """Both go through ``_resolve_single_user_for_email``, so neither can
    drift from the other's paging or ambiguity rules."""

    def test_they_pick_the_same_user(self, paging):
        page = [{"Users": [], "PaginationToken": "p2"}, {"Users": [_user("u1", "s-1")]}]
        paging(list(page))
        username = cognito_admin.resolve_username_for_email("u1@x.io")
        paging(list(page))
        identity = cognito_admin.resolve_identity_for_email("u1@x.io")

        assert identity is not None
        assert identity.username == username

    def test_the_username_resolver_still_ignores_a_missing_sub(self, paging):
        """A sub-less row is fatal for the identity resolver and irrelevant
        to the username one — the group-membership routes that call it never
        touch the sub, and failing them on it would be a new outage."""
        paging([{"Users": [{"Username": "u1", "Attributes": []}]}])

        assert cognito_admin.resolve_username_for_email("u1@x.io") == "u1"
