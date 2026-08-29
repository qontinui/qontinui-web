"""``ListUsers`` pagination in the two username resolvers.

Plan ``2026-08-27-members-page-delete-paths-authorization-and-blast-radius``
Phase 4, item 16.

Both resolvers used to read exactly one ``ListUsers`` page and treat it as
the whole answer. ``Limit`` on ``ListUsers`` is a **per-page** cap and
Cognito applies the ``Filter`` *after* selecting the page, so a filtered
query legitimately returns an EMPTY page carrying a ``PaginationToken`` with
the only match on a later page. The consequences were not symmetric:

* ``resolve_username_for_email`` backs the members page's add/remove, and a
  first-page miss surfaced as ``404 No user with email`` — which the UI
  renders as "they must sign up first" about somebody who already has an
  account.
* ``resolve_username_for_sub`` backs ``/api/v1/auth/identities`` for EVERY
  signed-in user, not only admins, so the same miss told an ordinary user
  their own account had no Cognito identity. That is the wider blast radius
  of the two.

Every test here would pass against the old single-page code EXCEPT the ones
whose fixture puts the match on page two — those are the regression pins.

The ambiguity contract is the other half. ``resolve_username_for_email``
raises :class:`CognitoAmbiguousEmailError` on >1 match, and "more than one"
has to mean *across the whole result set*: two matches split one-per-page
are still two matches, and a paginating implementation that judged each page
on its own would silently start picking one of them.
"""

from __future__ import annotations

from typing import Any

import pytest
from botocore.exceptions import ClientError

from app.core.config import settings
from app.services import cognito_admin
from app.services.cognito_admin import (
    CognitoAdminError,
    CognitoAmbiguousEmailError,
)


class _PagingClient:
    """boto3 stand-in whose ``list_users`` replays a scripted page sequence.

    Each scripted page is a full ``ListUsers`` response dict, so a test
    controls ``Users`` and ``PaginationToken`` independently — which is the
    only way to express "empty page, more to come", the exact shape that
    broke the old code.
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


@pytest.fixture
def paging(monkeypatch: pytest.MonkeyPatch):
    """Build a ``_PagingClient`` from a page script and install it."""

    def _install(pages: list[dict[str, Any]]) -> _PagingClient:
        client = _PagingClient(pages)
        monkeypatch.setattr(cognito_admin, "_get_client", lambda: client)
        monkeypatch.setattr(settings, "COGNITO_USER_POOL_ID", "pool-xyz")
        return client

    return _install


# ---------------------------------------------------------------------------
# resolve_username_for_email — the members-page resolver
# ---------------------------------------------------------------------------


class TestResolveEmailPaginates:
    def test_an_empty_first_page_with_a_token_is_not_the_answer(self, paging):
        """THE regression test for item 16.

        Page one comes back empty but carries a ``PaginationToken``; the user
        is on page two. The old resolver returned ``None`` here and the
        endpoint answered ``404 No user with email``.
        """
        client = paging(
            [
                {"Users": [], "PaginationToken": "page-2"},
                {"Users": [{"Username": "u1"}]},
            ]
        )

        assert cognito_admin.resolve_username_for_email("u1@example.com") == "u1"
        assert len(client.calls) == 2
        # The token from page one must be echoed back, or page two is just
        # page one again and the loop never terminates.
        assert client.calls[1]["PaginationToken"] == "page-2"
        assert "PaginationToken" not in client.calls[0]

    def test_it_follows_several_empty_pages(self, paging):
        client = paging(
            [
                {"Users": [], "PaginationToken": "p2"},
                {"Users": [], "PaginationToken": "p3"},
                {"Users": [], "PaginationToken": "p4"},
                {"Users": [{"Username": "deep"}]},
            ]
        )

        assert cognito_admin.resolve_username_for_email("deep@example.com") == "deep"
        assert len(client.calls) == 4

    def test_no_token_means_stop(self, paging):
        """A page with no ``PaginationToken`` is the last page. Asking for
        another would be an extra AWS call on every single lookup."""
        client = paging([{"Users": [{"Username": "u1"}]}])

        assert cognito_admin.resolve_username_for_email("u1@example.com") == "u1"
        assert len(client.calls) == 1

    def test_a_genuinely_absent_user_is_still_none(self, paging):
        """Pagination must not turn "absent" into "found something" —
        exhausting the pages with nothing matched is still ``None``."""
        client = paging(
            [
                {"Users": [], "PaginationToken": "p2"},
                {"Users": []},
            ]
        )

        assert cognito_admin.resolve_username_for_email("ghost@example.com") is None
        assert len(client.calls) == 2

    def test_every_page_carries_the_filter_and_the_pool(self, paging):
        client = paging(
            [
                {"Users": [], "PaginationToken": "p2"},
                {"Users": [{"Username": "u1"}]},
            ]
        )
        cognito_admin.resolve_username_for_email("u1@example.com")

        for call in client.calls:
            assert call["UserPoolId"] == "pool-xyz"
            assert call["Filter"] == 'email = "u1@example.com"'
            assert call["Limit"] == 60


class TestResolveEmailAmbiguityAcrossPages:
    def test_two_matches_split_across_pages_still_raise(self, paging):
        """The contract is "more than one user matches", not "more than one
        on a page". Judging per page would make a duplicated email resolve
        to whichever user Cognito happened to page first — silently picking
        an identity, which is the one thing this error exists to prevent."""
        client = paging(
            [
                {"Users": [{"Username": "u1"}], "PaginationToken": "p2"},
                {"Users": [{"Username": "u2"}]},
            ]
        )

        with pytest.raises(CognitoAmbiguousEmailError):
            cognito_admin.resolve_username_for_email("dupe@example.com")
        assert len(client.calls) == 2

    def test_ambiguity_stops_paging_immediately(self, paging):
        """Once a second match exists the answer is fixed, so the remaining
        pages are not fetched. Scripting only two pages proves it: a third
        call would raise from the stand-in."""
        client = paging(
            [
                {"Users": [{"Username": "u1"}], "PaginationToken": "p2"},
                {"Users": [{"Username": "u2"}], "PaginationToken": "p3"},
            ]
        )

        with pytest.raises(CognitoAmbiguousEmailError):
            cognito_admin.resolve_username_for_email("dupe@example.com")
        assert len(client.calls) == 2

    def test_one_match_across_many_pages_is_not_ambiguous(self, paging):
        paging(
            [
                {"Users": [], "PaginationToken": "p2"},
                {"Users": [{"Username": "only"}], "PaginationToken": "p3"},
                {"Users": []},
            ]
        )

        assert cognito_admin.resolve_username_for_email("one@example.com") == "only"


# ---------------------------------------------------------------------------
# resolve_username_for_sub — the wider blast radius (every signed-in user)
# ---------------------------------------------------------------------------


class TestResolveSubPaginates:
    def test_an_empty_first_page_with_a_token_is_not_the_answer(self, paging):
        """Same defect, bigger surface: this resolver backs
        ``/api/v1/auth/identities`` for every user, so the first-page miss
        told people their own account had no Cognito identity."""
        client = paging(
            [
                {"Users": [], "PaginationToken": "page-2"},
                {"Users": [{"Username": "josh@qontinui.io"}]},
            ]
        )

        assert cognito_admin.resolve_username_for_sub("sub-123") == "josh@qontinui.io"
        assert len(client.calls) == 2
        assert client.calls[1]["PaginationToken"] == "page-2"

    def test_the_first_match_wins_and_stops_paging(self, paging):
        """``sub`` is unique within a pool, so the first match IS the answer
        and there is nothing to disambiguate."""
        client = paging([{"Users": [{"Username": "u1"}], "PaginationToken": "p2"}])

        assert cognito_admin.resolve_username_for_sub("sub-123") == "u1"
        assert len(client.calls) == 1

    def test_a_genuinely_absent_sub_is_still_none(self, paging):
        paging([{"Users": [], "PaginationToken": "p2"}, {"Users": []}])
        assert cognito_admin.resolve_username_for_sub("sub-missing") is None

    def test_empty_sub_makes_no_call(self, paging):
        client = paging([])
        assert cognito_admin.resolve_username_for_sub("") is None
        assert client.calls == []

    def test_its_page_budget_is_tighter_than_the_email_resolver(self, paging):
        """This resolver runs for EVERY signed-in user, so its worst case is
        a latency budget rather than a background job — and every page is a
        call against the same admin-API quota that produces the throttle the
        endpoint now maps to 429. ``sub`` is unique and indexed, so a match
        is not buried behind a thousand non-matches; a tight cap is safe
        here in a way it would not be for an arbitrary filter."""
        assert cognito_admin._SUB_LOOKUP_MAX_PAGES < cognito_admin._LIST_USERS_MAX_PAGES
        # ...and still several times the one page it read before.
        assert cognito_admin._SUB_LOOKUP_MAX_PAGES > 1

    def test_the_sub_cap_raises_rather_than_reporting_the_user_absent(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """``identities.py`` turns a ``CognitoAdminError`` into a 502. That
        is the right answer for "I gave up": returning ``None`` would make it
        a 404 telling a signed-in user their own account has no Cognito
        identity."""

        class _Endless:
            def __init__(self) -> None:
                self.calls = 0

            def list_users(self, **kwargs: Any) -> dict[str, Any]:
                self.calls += 1
                return {"Users": [], "PaginationToken": f"p{self.calls}"}

        client = _Endless()
        monkeypatch.setattr(cognito_admin, "_get_client", lambda: client)
        monkeypatch.setattr(settings, "COGNITO_USER_POOL_ID", "pool-xyz")

        with pytest.raises(CognitoAdminError, match="did not terminate"):
            cognito_admin.resolve_username_for_sub("sub-123")
        assert client.calls == cognito_admin._SUB_LOOKUP_MAX_PAGES

    def test_a_user_row_without_a_username_does_not_end_the_search(self, paging):
        """A malformed row is not a match. Returning ``None`` on it — which
        the old code did — would report an existing user as absent."""
        paging(
            [
                {"Users": [{"Attributes": []}], "PaginationToken": "p2"},
                {"Users": [{"Username": "real"}]},
            ]
        )

        assert cognito_admin.resolve_username_for_sub("sub-123") == "real"


# ---------------------------------------------------------------------------
# Failure modes of the loop itself
# ---------------------------------------------------------------------------


class TestPaginationFailureModes:
    def test_a_boto_error_on_a_LATER_page_still_raises(self, paging):
        """A mid-pagination failure must not degrade into "no match". The
        answer is UNKNOWN, and the endpoint turns that into a 5xx — never
        into a 404 that says the user does not exist."""

        class _FailsOnSecondPage:
            def __init__(self) -> None:
                self.calls = 0

            def list_users(self, **kwargs: Any) -> dict[str, Any]:
                self.calls += 1
                if self.calls == 1:
                    return {"Users": [], "PaginationToken": "p2"}
                raise ClientError(
                    {"Error": {"Code": "InternalErrorException", "Message": "boom"}},
                    "ListUsers",
                )

        client = _FailsOnSecondPage()
        import app.services.cognito_admin as mod

        original = mod._get_client
        mod._get_client = lambda: client  # type: ignore[assignment]
        try:
            with pytest.raises(CognitoAdminError):
                cognito_admin.resolve_username_for_email("u@example.com")
        finally:
            mod._get_client = original  # type: ignore[assignment]
        assert client.calls == 2

    def test_an_endless_token_is_capped_by_raising_not_by_returning_none(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        """A pool that kept handing back a token would otherwise spin a
        worker thread forever. Hitting the cap raises: "I gave up" is
        UNKNOWN, and returning ``None`` would launder it into the confident
        claim that no such user exists."""

        class _Endless:
            def __init__(self) -> None:
                self.calls = 0

            def list_users(self, **kwargs: Any) -> dict[str, Any]:
                self.calls += 1
                return {"Users": [], "PaginationToken": f"p{self.calls}"}

        client = _Endless()
        monkeypatch.setattr(cognito_admin, "_get_client", lambda: client)
        monkeypatch.setattr(settings, "COGNITO_USER_POOL_ID", "pool-xyz")

        with pytest.raises(CognitoAdminError, match="did not terminate"):
            cognito_admin.resolve_username_for_email("u@example.com")
        assert client.calls == cognito_admin._LIST_USERS_MAX_PAGES
