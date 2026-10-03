"""A Google OAuth access token from a service-account key, over plain REST.

The JWT-bearer grant (RFC 7523): sign a short assertion with the key's RS256
private key (PyJWT, already a dependency) and exchange it at Google's token
endpoint. No Google client library is needed for two GETs.

The token endpoint is PINNED to ``https://oauth2.googleapis.com/token`` — the
key file's own ``token_uri`` is not followed, so a crafted key cannot point the
server at another host. Errors are typed and never carry the key.
"""

from __future__ import annotations

import json
import time
from typing import Any

import jwt

from app.spend.connectors import CredentialRejected, _http

TOKEN_URL = "https://oauth2.googleapis.com/token"


def service_account(credential: dict[str, Any]) -> dict[str, Any]:
    """The parsed key from ``service_account_json`` (a JSON string or object)."""
    raw = credential.get("service_account_json")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError as exc:
            raise CredentialRejected(
                "invalid_credential", "service_account_json is not JSON"
            ) from exc
    if not isinstance(raw, dict):
        raise CredentialRejected(
            "invalid_credential", "the credential has no service_account_json"
        )
    if raw.get("type") not in (None, "service_account"):
        raise CredentialRejected(
            "invalid_credential", "service_account_json is not a service-account key"
        )
    for name in ("client_email", "private_key"):
        if not isinstance(raw.get(name), str) or not raw[name]:
            raise CredentialRejected(
                "invalid_credential", f"service_account_json has no {name}"
            )
    return raw


async def access_token(
    credential: dict[str, Any], *, scope: str, subject: str | None = None
) -> str:
    """Exchange a signed assertion for an access token. ``subject`` is the
    user a domain-wide-delegated key impersonates (Workspace admin APIs)."""
    key = service_account(credential)
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": key["client_email"],
        "scope": scope,
        "aud": TOKEN_URL,
        "iat": now,
        "exp": now + 3600,
    }
    if subject:
        claims["sub"] = subject
    try:
        assertion = jwt.encode(claims, key["private_key"], algorithm="RS256")
    except Exception as exc:  # noqa: BLE001 — a bad key is a typed refusal
        raise CredentialRejected(
            "invalid_credential", "the service-account private key cannot sign"
        ) from exc
    response = await _http.request(
        "POST",
        TOKEN_URL,
        provider="Google OAuth",
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        },
    )
    try:
        token = response.json().get("access_token")
    except (ValueError, AttributeError) as exc:
        raise CredentialRejected(
            "invalid_response", "Google OAuth did not answer with JSON"
        ) from exc
    if not isinstance(token, str) or not token:
        raise CredentialRejected("invalid_response", "Google OAuth issued no token")
    return token
