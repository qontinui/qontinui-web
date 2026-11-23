"""An upstream's 429, passed through, still names its lane.

Many routes here proxy coord (or a runner) and pass its status through
verbatim. Before this module a coord 429 — the self-service tenant cap, say —
left as a bare 429: no ``X-RateLimit-Lane``, no ``X-RateLimit-Key-Kind``, no
``Retry-After``, so a client could not tell it from this backend's own limits.
Plan ``2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429``,
Phase 2.

Every builder that takes its status from an upstream answer goes through
:func:`upstream_http_exception` / :func:`upstream_json_response` (or passes
``headers=upstream_refusal_headers(...)``). On a 429 they attach
``refusal_headers("<upstream>:<route template>", "upstream",
retry_after=<the upstream's Retry-After>)``; on any other status, nothing.
``test_every_upstream_status_pass_through_goes_through_the_helper`` enforces it.

The route template is the route THIS backend was serving when the upstream
refused. The proxy helpers are called deep inside a route and never hold the
request, so :class:`RouteScopeMiddleware` keeps the request's ASGI scope in a
context variable: the router writes the matched ``route`` into that same scope
dict before the endpoint runs, so :func:`current_route_template` reads the
template from anywhere in the request. Outside a routed request it is
``unknown``.
"""

from __future__ import annotations

from collections.abc import Mapping, MutableMapping
from contextvars import ContextVar
from typing import Any, Protocol

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.middleware.rate_limit import refusal_headers

_request_scope: ContextVar[MutableMapping[str, Any] | None] = ContextVar(
    "upstream_refusal_request_scope", default=None
)


class RouteScopeMiddleware:
    """Holds the current HTTP request's ASGI scope for
    :func:`current_route_template`. Pure ASGI: it neither reads nor changes the
    request or the response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        token = _request_scope.set(scope)
        try:
            await self.app(scope, receive, send)
        finally:
            _request_scope.reset(token)


def current_route_template() -> str:
    """The TEMPLATE of the route this request matched (``/items/{item_id}``),
    never the concrete path, which can carry an id. ``unknown`` outside a
    routed request."""
    scope = _request_scope.get()
    template = getattr(scope.get("route") if scope else None, "path", None)
    return template if isinstance(template, str) and template else "unknown"


class UpstreamAnswer(Protocol):
    """What the helpers read from an upstream's answer — an
    ``httpx.Response`` (or a streamed one) in practice."""

    @property
    def status_code(self) -> int: ...

    @property
    def headers(self) -> Mapping[str, str]: ...


def upstream_refusal_headers(upstream: str, answer: UpstreamAnswer) -> dict[str, str]:
    """The refusal headers for an upstream's answer: on a 429, the lane
    ``<upstream>:<route template>``, key kind ``upstream`` and the upstream's
    own ``Retry-After`` when it sent a usable one; otherwise nothing. The
    answer's headers are read only on a 429."""
    if answer.status_code != 429:
        return {}
    retry_after = answer.headers.get("retry-after")
    return refusal_headers(
        f"{upstream}:{current_route_template()}",
        "upstream",
        retry_after=(
            retry_after.strip()
            if isinstance(retry_after, str) and retry_after.strip()
            else None
        ),
    )


def _merged(
    upstream: str, answer: UpstreamAnswer, headers: Mapping[str, str] | None
) -> dict[str, str] | None:
    merged = {**(headers or {}), **upstream_refusal_headers(upstream, answer)}
    return merged or None


def upstream_http_exception(
    answer: UpstreamAnswer,
    *,
    upstream: str,
    detail: Any,
    headers: Mapping[str, str] | None = None,
) -> HTTPException:
    """An ``HTTPException`` carrying an upstream answer's status and, on a 429,
    its lane (:func:`upstream_refusal_headers`)."""
    status = answer.status_code
    return HTTPException(
        status_code=status,
        detail=detail,
        headers=_merged(upstream, answer, headers),
    )


def upstream_json_response(
    answer: UpstreamAnswer,
    *,
    upstream: str,
    content: Any,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    """A ``JSONResponse`` carrying an upstream answer's status and, on a 429,
    its lane (:func:`upstream_refusal_headers`)."""
    status = answer.status_code
    return JSONResponse(
        content=content,
        status_code=status,
        headers=_merged(upstream, answer, headers),
    )
