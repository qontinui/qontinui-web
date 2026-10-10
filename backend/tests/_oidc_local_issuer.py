"""A local, in-process OpenID provider for verifier tests.

Generates its own signing keys and serves a discovery document and JWKS
through an ``httpx.MockTransport``, so the verifier's real HTTP code path runs
with no network. Shared by the conformance tests and the DB-backed
user-resolution tests.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx
import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from app.services import oidc_jwks
from app.services.oidc_jwks import DISCOVERY_PATH

DEFAULT_ISSUER = "https://idp.example.test/realms/acme"
DEFAULT_CLIENT = "qontinui-web"

_RealAsyncClient = httpx.AsyncClient


class LocalIssuer:
    """An in-process OpenID provider: keys, discovery, JWKS, token minting."""

    def __init__(
        self, issuer: str = DEFAULT_ISSUER, *, advertised_issuer: str | None = None
    ):
        self.issuer = issuer
        self.advertised_issuer = advertised_issuer or issuer
        self.jwks_uri = f"{issuer.rstrip('/')}/protocol/openid-connect/certs"
        self._keys: dict[str, tuple[Any, str]] = {}
        self.published: list[str] = []
        self.requests: list[str] = []
        self.down = False

    # -- keys -------------------------------------------------------------
    def add_rsa_key(self, kid: str, *, publish: bool = True) -> None:
        self._keys[kid] = (
            rsa.generate_private_key(public_exponent=65537, key_size=2048),
            "RS256",
        )
        if publish:
            self.published.append(kid)

    def add_ec_key(self, kid: str) -> None:
        self._keys[kid] = (ec.generate_private_key(ec.SECP256R1()), "ES256")
        self.published.append(kid)

    def rotate_to(self, kid: str) -> None:
        """Publish ``kid`` and retire every other key — a real rotation."""
        self.add_rsa_key(kid, publish=False)
        self.published = [kid]

    def _jwk(self, kid: str) -> dict[str, Any]:
        private, alg = self._keys[kid]
        algo = RSAAlgorithm if alg.startswith("RS") else ECAlgorithm
        jwk = json.loads(algo.to_jwk(private.public_key()))
        jwk.update({"kid": kid, "alg": alg, "use": "sig"})
        return jwk

    # -- HTTP -------------------------------------------------------------
    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append(url)
        if self.down:
            raise httpx.ConnectError("issuer unreachable", request=request)
        if url == f"{self.issuer.rstrip('/')}{DISCOVERY_PATH}":
            return httpx.Response(
                200,
                json={
                    "issuer": self.advertised_issuer,
                    "jwks_uri": self.jwks_uri,
                    "authorization_endpoint": f"{self.issuer}/auth",
                    "token_endpoint": f"{self.issuer}/token",
                    "response_types_supported": ["code"],
                    "subject_types_supported": ["public"],
                    "id_token_signing_alg_values_supported": ["RS256", "ES256"],
                },
            )
        if url == self.jwks_uri:
            return httpx.Response(
                200, json={"keys": [self._jwk(k) for k in self.published]}
            )
        return httpx.Response(404, text="not found")

    def discovery_hits(self) -> int:
        return sum(1 for u in self.requests if u.endswith(DISCOVERY_PATH))

    def jwks_hits(self) -> int:
        return sum(1 for u in self.requests if u == self.jwks_uri)

    # -- tokens -----------------------------------------------------------
    def claims(self, **over: Any) -> dict[str, Any]:
        now = int(time.time())
        base: dict[str, Any] = {
            "iss": self.issuer,
            "sub": "f3c1a2b4-0000-4000-8000-000000000001",
            "aud": DEFAULT_CLIENT,
            "iat": now,
            "exp": now + 600,
            "email": "analyst@example.test",
            "email_verified": True,
            "groups": ["spec-analysts"],
        }
        base.update(over)
        return {k: v for k, v in base.items() if v is not None}

    def mint(self, kid: str, **over: Any) -> str:
        private, alg = self._keys[kid]
        return pyjwt.encode(
            self.claims(**over), private, algorithm=alg, headers={"kid": kid}
        )


def route(monkeypatch: pytest.MonkeyPatch, *issuers: LocalIssuer) -> None:
    """Send the verifier's HTTP to the local issuers (by URL prefix)."""

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        for issuer in issuers:
            if url.startswith(issuer.issuer.rstrip("/")):
                return issuer.handler(request)
        return httpx.Response(404, text="unknown host")

    def factory(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        return _RealAsyncClient(*args, transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(oidc_jwks.httpx, "AsyncClient", factory)
