"""Is a GitHub repository PUBLIC? — answered fail-closed, with a rate budget.

Phase 1 of plan ``2026-10-09-factory-built-product-portfolio-and-launch-kit``
(D3: "private repo names are excluded by construction"). coord lists only repos
it POSITIVELY knows are public in a build record's ``product.repos``; this is
web's independent confirmation before a record is frozen for the public page,
and again on a schedule while it stays published.

The read is ``GET /repos/{owner}/{name}``, and the verdict never rests on WHO
asked: a repo is public only when GitHub answers 200 with ``"private":
false`` AND the ``full_name`` it returns is the name that was asked about.
So a credential that CAN see a private repo still yields NOT_PUBLIC for it.

Credentials: anonymous by default (60 requests/hour per egress IP, SHARED with
every other anonymous GitHub read this backend makes — ``releases.py``,
``auth/identities.py``). When ``settings.GITHUB_VISIBILITY_TOKEN`` is set
(5000/hour) it is sent as a bearer. **That token is an operator resource**: a
fine-grained PAT or app token granted NO repository access, provisioned in
the deployment's secrets; it raises the rate limit, nothing else, and a
private repo still answers 404 (or ``"private": true``) to it.

Three answers, never two (served policy ``verification-and-evidence``
``silent-empty-is-unknown``):

* :attr:`Visibility.PUBLIC` — 200, ``"private": false``, matching
  ``full_name``;
* :attr:`Visibility.NOT_PUBLIC` — 404; 451 (unavailable for legal reasons);
  a 403 whose body identifies a BLOCKED repository (a ``block`` object, or
  "Repository access blocked");
  a redirect (301/302/307/308 — GitHub answers a RENAMED or transferred repo
  with a redirect, which ``httpx`` does not follow, so a moved repo's old name
  is refused rather than left unanswered); or 200 with ``"private"`` not
  ``false`` or a different ``full_name``;
* :attr:`Visibility.UNKNOWN` — a transport error (``transport_error``), a
  rate limit (``rate_limited``: every 429, and every 403 that is not a
  blocked repository — primary and secondary limits alike), a 5xx or other
  status, an unparseable body.

A 401 with the operator token set means the token is dead: logged at ERROR,
retried anonymously, flagged ``credential_error``.

The caller refuses on anything but ``PUBLIC``. Same ``httpx.AsyncClient`` +
explicit timeout convention as the two modules above.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime
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
#: Statuses that are a definite "not publishable under this name".
_NOT_PUBLIC_STATUSES: Final = frozenset({301, 302, 307, 308, 404, 451})


def _client_factory() -> httpx.AsyncClient:
    """The client production asks with: explicit timeout, no redirects.

    Module-level so a test can swap in an ``httpx.MockTransport`` and still
    drive the production ``client=None`` branch of :func:`check_repo`.
    """
    return httpx.AsyncClient(timeout=_TIMEOUT)


#: After the operator token is rejected, skip it for this long (per process),
#: so a dead token costs one extra request per window, not one per repo.
TOKEN_REJECTED_BACKOFF_SECONDS: Final = 600.0
_token_rejected_at: float | None = None


def _token() -> str | None:
    from app.core.config import settings

    token = settings.GITHUB_VISIBILITY_TOKEN or None
    if (
        token
        and _token_rejected_at is not None
        and time.monotonic() - _token_rejected_at < TOKEN_REJECTED_BACKOFF_SECONDS
    ):
        return None
    return token


def _headers(token: str | None) -> dict[str, str]:
    headers = dict(_HEADERS)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


class Visibility(Enum):
    PUBLIC = "public"
    NOT_PUBLIC = "not_public"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class VisibilityAnswer:
    """One GitHub read: the verdict plus GitHub's rate-limit signal."""

    visibility: Visibility
    #: ``X-RateLimit-Remaining`` as GitHub sent it; ``None`` when absent.
    rate_limit_remaining: int | None = None
    #: ``X-RateLimit-Reset`` (when the window refills); ``None`` when absent.
    rate_limit_reset: datetime | None = None
    #: True on a 403/429 — the caller must stop asking this window.
    rate_limited: bool = False
    #: True when no HTTP answer arrived at all (connect error, timeout…).
    transport_error: bool = False
    #: True when the operator token was REJECTED (401) — the answer above is
    #: from an anonymous retry, and the token needs replacing.
    credential_error: bool = False
    #: HTTP requests this answer cost (2 when a rejected token was retried).
    http_requests: int = 1


def _int_header(resp: httpx.Response, name: str) -> int | None:
    raw = resp.headers.get(name) or ""
    return int(raw) if raw.isdigit() else None


async def _get(
    url: str, token: str | None, client: httpx.AsyncClient | None
) -> httpx.Response:
    if client is not None:
        return await client.get(url, headers=_headers(token))
    async with _client_factory() as owned:
        return await owned.get(url, headers=_headers(token))


def _is_blocked(resp: httpx.Response) -> bool:
    """A 403 for a repository GitHub has BLOCKED (TOS, DMCA): a JSON body with
    a ``block`` object, or the message "Repository access blocked". That is a
    definite "not publishable" — the ONLY 403 that is."""
    if resp.status_code != 403:
        return False
    try:
        body = resp.json()
    except ValueError:
        return False
    if not isinstance(body, dict):
        return False
    message = body.get("message")
    return isinstance(body.get("block"), dict) or (
        isinstance(message, str) and "repository access blocked" in message.lower()
    )


def _is_rate_limit(resp: httpx.Response) -> bool:
    """Every 429, and every 403 that is NOT a blocked repository.

    GitHub's 403s are mostly rate limits, and not all of them say so in the
    headers: a SECONDARY rate limit arrives with budget remaining and no
    ``Retry-After``, only a message. Reading such a 403 as "not public" would
    retract every page the tick touched, so a 403 is a rate limit unless its
    body positively identifies a blocked repository (:func:`_is_blocked`).
    Fail-closed in the other direction too: a blocked repo misread as a rate
    limit would only stop the tick, never publish anything.
    """
    if resp.status_code == 429:
        return True
    return resp.status_code == 403 and not _is_blocked(resp)


async def check_repo(
    repo: str, *, client: httpx.AsyncClient | None = None
) -> VisibilityAnswer:
    """Ask GitHub whether ``owner/name`` is public (see the module docstring).

    A 401 while the operator token is set means the TOKEN is dead (expired or
    revoked), not that the repo is anything: it is logged at ERROR and the
    same read is retried anonymously, and the answer carries
    ``credential_error`` so the caller can report it. The token is then
    skipped for :data:`TOKEN_REJECTED_BACKOFF_SECONDS` in this process.
    """
    global _token_rejected_at
    url = f"{GITHUB_API}/repos/{repo}"
    token = _token()
    credential_error = False
    requests = 1
    try:
        resp = await _get(url, token, client)
        if resp.status_code == 401 and token:
            _token_rejected_at = time.monotonic()
            requests = 2
            logger.error(
                "github_visibility_token_rejected",
                note=(
                    "GITHUB_VISIBILITY_TOKEN was rejected (401); falling back "
                    "to anonymous reads. The operator must replace the token."
                ),
            )
            credential_error = True
            resp = await _get(url, None, client)
    except httpx.HTTPError as exc:
        logger.warning("github_visibility_unreachable", exc_type=type(exc).__name__)
        return VisibilityAnswer(
            Visibility.UNKNOWN,
            transport_error=True,
            credential_error=credential_error,
            http_requests=requests,
        )

    remaining = _int_header(resp, "x-ratelimit-remaining")
    reset_epoch = _int_header(resp, "x-ratelimit-reset")
    reset = datetime.fromtimestamp(reset_epoch, UTC) if reset_epoch else None

    def answer(visibility: Visibility, **flags: bool) -> VisibilityAnswer:
        return VisibilityAnswer(
            visibility,
            remaining,
            reset,
            credential_error=credential_error,
            http_requests=requests,
            **flags,
        )

    if _is_rate_limit(resp):
        logger.warning("github_visibility_rate_limited", status=resp.status_code)
        return answer(Visibility.UNKNOWN, rate_limited=True)
    if resp.status_code in _NOT_PUBLIC_STATUSES or _is_blocked(resp):
        return answer(Visibility.NOT_PUBLIC)
    if resp.status_code != 200:
        logger.warning("github_visibility_unanswered", status=resp.status_code)
        return answer(Visibility.UNKNOWN)
    try:
        body = resp.json()
    except ValueError:
        return answer(Visibility.UNKNOWN)
    if not isinstance(body, dict):
        return answer(Visibility.UNKNOWN)
    full_name = body.get("full_name")
    if (
        body.get("private") is not False
        or not isinstance(full_name, str)
        or full_name.lower() != repo.lower()
    ):
        return answer(Visibility.NOT_PUBLIC)
    return answer(Visibility.PUBLIC)
