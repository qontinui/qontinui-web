"""Is a GitHub repository PUBLIC? — asked anonymously, answered fail-closed.

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``
(D3: "private repo names are excluded by construction"). coord lists only repos
it POSITIVELY knows are public in a build record's ``product.repos``; this is
web's independent confirmation before a record is frozen for the public page,
so a coord that failed to filter cannot publish a private repo's name.

The question is asked WITHOUT credentials, on purpose: an authenticated
``GET /repos/{owner}/{name}`` answers 200 for a private repo the token can see,
which is exactly the case to catch. Anonymously, GitHub answers 404 for a
private repo and 200 with ``"private": false`` for a public one.

Three answers, never two (served policy ``verification-and-evidence``
``silent-empty-is-unknown``):

* :attr:`Visibility.PUBLIC` — HTTP 200 and ``"private": false``, and the
  ``full_name`` GitHub returns is the repo that was asked about (a renamed repo
  redirects; publishing the old name of a moved repo is refused too);
* :attr:`Visibility.NOT_PUBLIC` — HTTP 404, or 200 with ``"private"`` not
  ``false``;
* :attr:`Visibility.UNKNOWN` — anything else: a network error, a timeout, a
  rate limit (403/429), a 5xx, an unparseable body.

The caller refuses on anything but ``PUBLIC``. Same ``httpx.AsyncClient`` +
explicit timeout convention as ``endpoints/releases.py`` and
``endpoints/auth/identities.py``, the other anonymous GitHub reads here.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Final

import httpx
import structlog

logger = structlog.get_logger(__name__)

GITHUB_API: Final = "https://api.github.com"
_TIMEOUT: Final = httpx.Timeout(10.0, connect=5.0)
_HEADERS: Final = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "qontinui-web-build-record-visibility",
}


def _client_factory() -> httpx.AsyncClient:
    """The client production asks with: no auth headers, explicit timeout.

    Module-level so a test can swap in an ``httpx.MockTransport`` and still
    drive the production ``client=None`` branch of :func:`repo_visibility`.
    """
    return httpx.AsyncClient(timeout=_TIMEOUT)


class Visibility(Enum):
    PUBLIC = "public"
    NOT_PUBLIC = "not_public"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class VisibilityAnswer:
    """One anonymous GitHub read: the verdict plus GitHub's rate-limit signal."""

    visibility: Visibility
    #: ``X-RateLimit-Remaining`` as GitHub sent it; ``None`` when absent.
    rate_limit_remaining: int | None = None
    #: True on a 403/429 — the caller must stop asking this window.
    rate_limited: bool = False


async def check_repo(
    repo: str, *, client: httpx.AsyncClient | None = None
) -> VisibilityAnswer:
    """Anonymously ask GitHub whether ``owner/name`` is public.

    ``client`` is a seam for tests; production builds its client through
    :func:`_client_factory` (no auth headers).
    """
    url = f"{GITHUB_API}/repos/{repo}"
    try:
        if client is not None:
            resp = await client.get(url, headers=_HEADERS)
        else:
            async with _client_factory() as owned:
                resp = await owned.get(url, headers=_HEADERS)
    except httpx.HTTPError as exc:
        logger.warning("github_visibility_unreachable", exc_type=type(exc).__name__)
        return VisibilityAnswer(Visibility.UNKNOWN)

    remaining_raw = resp.headers.get("x-ratelimit-remaining")
    remaining = int(remaining_raw) if (remaining_raw or "").isdigit() else None
    if resp.status_code in (403, 429):
        logger.warning("github_visibility_rate_limited", status=resp.status_code)
        return VisibilityAnswer(Visibility.UNKNOWN, remaining, rate_limited=True)
    if resp.status_code == 404:
        return VisibilityAnswer(Visibility.NOT_PUBLIC, remaining)
    if resp.status_code != 200:
        logger.warning("github_visibility_unanswered", status=resp.status_code)
        return VisibilityAnswer(Visibility.UNKNOWN, remaining)
    try:
        body = resp.json()
    except ValueError:
        return VisibilityAnswer(Visibility.UNKNOWN, remaining)
    if not isinstance(body, dict):
        return VisibilityAnswer(Visibility.UNKNOWN, remaining)
    full_name = body.get("full_name")
    if (
        body.get("private") is not False
        or not isinstance(full_name, str)
        or full_name.lower() != repo.lower()
    ):
        return VisibilityAnswer(Visibility.NOT_PUBLIC, remaining)
    return VisibilityAnswer(Visibility.PUBLIC, remaining)


async def repo_visibility(
    repo: str, *, client: httpx.AsyncClient | None = None
) -> Visibility:
    """:func:`check_repo`'s verdict alone."""
    return (await check_repo(repo, client=client)).visibility
