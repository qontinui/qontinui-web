"""Coord JWKS fetcher + device-token JWT verification.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
retires the runner-token (``qontinui_runner_<random>`` + Argon2)
authentication scheme. The new ``WS /api/v1/devices/ws`` endpoint
authenticates with a coord-issued device-token JWT that the runner
obtained via the OAuth-loopback pairing flow (``POST
/coord/devices/pair-complete``).

This module fetches coord's JWKS (``GET {COORD_URL}/coord/auth/jwks``)
on demand, caches it for 1 hour, and verifies presented device-token
JWTs using ``PyJWT`` (with the ``cryptography`` backend, required for
the ``EdDSA`` / Ed25519 algorithm coord uses to sign).

We use PyJWT instead of ``python-jose`` because the latter does not
support ``EdDSA`` (see ``python-jose`` ``ALGORITHMS.SUPPORTED`` — no
``EdDSA`` entry; surfaced as ``JWKError: Unable to find an algorithm
for key`` against any coord-minted token). PyJWT 2.x supports the
``OKP`` key type + ``EdDSA`` algorithm natively via ``cryptography``.

Failure mode (per plan): if JWKS is unreachable on cold start, REJECT
all WS handshakes with a clear log. Never silently fall back to
"trust the token".
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
import jwt as pyjwt
import structlog
from jwt.exceptions import (
    InvalidTokenError,
    PyJWKError,
    PyJWTError,
)

from app.core.config import settings

logger = structlog.get_logger(__name__)

# JWKS cache TTL (1h per plan).
_JWKS_TTL_S = 3600

# Clock-skew tolerance for ``iat`` / ``exp`` validation. Coord and web
# may run on different machines (or in different docker containers on
# one machine, each with its own clock), and ``iat`` is truncated to
# whole seconds by coord — both factors can push a freshly-minted JWT
# into the "future" by up to ~1s from web's perspective. Standard
# JWT distributed-deployment practice is 30-60s; we pick 30s as a
# floor that covers normal NTP-drift but still rejects the obvious
# bad case (clocks hours apart).
_CLOCK_SKEW_LEEWAY_S = 30


class CoordJWKSUnavailableError(RuntimeError):
    """Raised when coord's JWKS cannot be fetched (cold-start failure)."""


class CoordTokenInvalidError(RuntimeError):
    """Raised when a presented device-token JWT fails verification."""


class CoordJWKSClient:
    """Thread-safe JWKS fetcher + cached verifier for coord-issued JWTs.

    Lifetime: process-wide singleton (see module-level
    ``coord_jwks_client`` below). The first verification request after
    process start triggers the fetch; subsequent requests within the TTL
    window reuse the cache. If the fetch fails on cold start, all
    handshakes are rejected per the plan's failure-mode discipline.
    """

    def __init__(
        self,
        coord_url: str,
        *,
        ttl_s: int = _JWKS_TTL_S,
        http_timeout_s: float = 10.0,
    ) -> None:
        self._coord_url = coord_url.rstrip("/")
        self._ttl_s = ttl_s
        self._http_timeout_s = http_timeout_s
        self._jwks: dict[str, Any] | None = None
        self._fetched_at: float = 0.0
        self._lock = asyncio.Lock()

    async def _fetch_jwks(self) -> dict[str, Any]:
        """Fetch coord's JWKS over HTTP. Raises on any failure."""
        url = f"{self._coord_url}/coord/auth/jwks"
        try:
            async with httpx.AsyncClient(timeout=self._http_timeout_s) as c:
                resp = await c.get(url)
        except httpx.HTTPError as exc:
            raise CoordJWKSUnavailableError(
                f"coord JWKS fetch failed (transport): {exc}"
            ) from exc

        if resp.status_code != 200:
            raise CoordJWKSUnavailableError(
                f"coord JWKS fetch failed: HTTP {resp.status_code} {resp.text[:200]}"
            )

        try:
            body = resp.json()
        except ValueError as exc:
            raise CoordJWKSUnavailableError(
                f"coord JWKS response not JSON: {resp.text[:200]}"
            ) from exc

        if not isinstance(body, dict) or "keys" not in body:
            raise CoordJWKSUnavailableError(
                f"coord JWKS missing 'keys' field: {body!r}"
            )

        return body

    async def get_jwks(self) -> dict[str, Any]:
        """Return the cached JWKS, refetching when expired or absent."""
        async with self._lock:
            now = time.time()
            if self._jwks is not None and (now - self._fetched_at) < self._ttl_s:
                return self._jwks

            jwks = await self._fetch_jwks()
            self._jwks = jwks
            self._fetched_at = now
            logger.info(
                "coord_jwks_fetched",
                coord_url=self._coord_url,
                key_count=len(jwks.get("keys", [])),
                ttl_s=self._ttl_s,
            )
            return jwks

    async def verify_token(self, token: str) -> dict[str, Any]:
        """Verify a coord-issued JWT and return its decoded claims.

        Raises:
            CoordJWKSUnavailableError: JWKS could not be fetched on cold
                start.
            CoordTokenInvalidError: Token failed signature / claim
                validation (bad signature, expired, malformed, etc.).
        """
        try:
            jwks = await self.get_jwks()
        except CoordJWKSUnavailableError:
            raise
        except Exception as exc:  # defensive
            raise CoordJWKSUnavailableError(str(exc)) from exc

        # Parse the header to pick the right JWK by ``kid``. This is
        # signature-unverified; we only trust the resulting ``kid`` for
        # key-lookup, and PyJWT.decode below re-validates the algorithm
        # against our allowlist before doing any crypto.
        try:
            header = pyjwt.get_unverified_header(token)
        except InvalidTokenError as exc:
            raise CoordTokenInvalidError(f"token header malformed: {exc}") from exc

        kid = header.get("kid")
        if not kid:
            raise CoordTokenInvalidError("token header missing 'kid'")

        jwk_dict = next(
            (k for k in jwks.get("keys", []) if k.get("kid") == kid),
            None,
        )
        if jwk_dict is None:
            raise CoordTokenInvalidError(f"no JWK with kid={kid!r} in coord JWKS")

        # Materialize the JWK into a key object PyJWT can use. PyJWK
        # accepts our dict shape directly (``kty``/``crv``/``x``/``alg``)
        # and routes to the right backend (``Ed25519PublicKey`` for OKP).
        try:
            jwk = pyjwt.PyJWK(jwk_dict)
        except PyJWKError as exc:
            raise CoordTokenInvalidError(f"JWK materialization failed: {exc}") from exc

        # Algorithm allowlist mirrors coord's possible signing
        # algorithms (currently only EdDSA, but we accept the broader
        # asymmetric set so a future RS256/ES256 cutover doesn't need a
        # paired web-side deploy). HMAC-family algorithms are
        # deliberately excluded — coord is a key-pair issuer.
        try:
            claims = pyjwt.decode(
                token,
                jwk.key,
                algorithms=["EdDSA", "RS256", "ES256"],
                options={"verify_aud": False},
                leeway=_CLOCK_SKEW_LEEWAY_S,
            )
        except PyJWTError as exc:
            raise CoordTokenInvalidError(f"token verification failed: {exc}") from exc

        if not isinstance(claims, dict):
            raise CoordTokenInvalidError("decoded JWT is not a JSON object")

        return claims


# Process-wide singleton — wired at import time.
coord_jwks_client = CoordJWKSClient(coord_url=settings.COORD_URL)
