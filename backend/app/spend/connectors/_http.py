"""The one HTTP door every token-linked connector calls its provider through.

* Every failure becomes a :class:`CredentialRejected` with a TYPED reason, so
  the "Link account" form and the failed import run say *why* without ever
  echoing a request. Neither the reason nor the detail ever carries a header,
  a query string or a response body — a provider that reflects the credential
  back in an error body cannot leak it through here.
* Tests swap :data:`transport_factory` for an ``httpx.MockTransport``; no test
  reaches a real provider.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx

from app.spend.connectors import CredentialRejected

#: Seconds before a provider call is abandoned (connect, read, write, pool).
TIMEOUT_SECONDS = 30.0

#: Replaced in tests with a factory returning an ``httpx.MockTransport``.
transport_factory: Callable[[], httpx.AsyncBaseTransport | None] = lambda: None  # noqa: E731


def client() -> httpx.AsyncClient:
    transport = transport_factory()
    return httpx.AsyncClient(
        timeout=TIMEOUT_SECONDS,
        transport=transport,
        follow_redirects=False,
        headers={"User-Agent": "qontinui-spend-collector/1"},
    )


def _reason(status: int) -> str:
    if status == 401:
        return "unauthorized"
    if status == 403:
        return "forbidden"
    if status == 404:
        return "not_found"
    if status == 429:
        return "rate_limited"
    if 400 <= status < 500:
        return "rejected"
    return "provider_error"


async def request(
    method: str,
    url: str,
    *,
    provider: str,
    headers: dict[str, str] | None = None,
    params: Any = None,
    data: Any = None,
    auth: httpx.Auth | tuple[str, str] | None = None,
) -> httpx.Response:
    """One provider call. Returns a 2xx response; raises a typed rejection
    for anything else. ``provider`` names the provider in the detail."""
    try:
        async with client() as http:
            response = await http.request(
                method, url, headers=headers, params=params, data=data, auth=auth
            )
    except httpx.TimeoutException as exc:
        raise CredentialRejected(
            "unreachable", f"{provider} did not answer in time"
        ) from exc
    except httpx.HTTPError as exc:
        raise CredentialRejected(
            "unreachable", f"{provider} could not be reached ({type(exc).__name__})"
        ) from exc
    if not 200 <= response.status_code < 300:
        raise CredentialRejected(
            _reason(response.status_code),
            f"{provider} answered HTTP {response.status_code}",
        )
    return response


async def get_json(
    url: str,
    *,
    provider: str,
    headers: dict[str, str] | None = None,
    params: Any = None,
    auth: httpx.Auth | tuple[str, str] | None = None,
) -> Any:
    response = await request(
        "GET", url, provider=provider, headers=headers, params=params, auth=auth
    )
    try:
        return response.json()
    except ValueError as exc:
        raise CredentialRejected(
            "invalid_response", f"{provider} did not answer with JSON"
        ) from exc


def require_fields(credential: dict[str, Any], *names: str) -> list[str]:
    """The named credential fields as non-empty strings, or a typed refusal
    naming the missing FIELD (never its value)."""
    out: list[str] = []
    for name in names:
        value = credential.get(name)
        if not isinstance(value, str) or not value.strip():
            raise CredentialRejected(
                "invalid_credential", f"the credential has no {name}"
            )
        out.append(value.strip())
    return out
