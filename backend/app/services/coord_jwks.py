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
JWTs using ``python-jose`` (already a backend dependency).

Failure mode (per plan): if JWKS is unreachable on cold start, REJECT
all WS handshakes with a clear log. Never silently fall back to
"trust the token".
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
import structlog
from jose import jwt
from jose.exceptions import JWKError, JWTError

from app.core.config import settings

logger = structlog.get_logger(__name__)

# JWKS cache TTL (1h per plan).
_JWKS_TTL_S = 3600


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
            if (
                self._jwks is not None
                and (now - self._fetched_at) < self._ttl_s
            ):
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

        try:
            # python-jose accepts the JWKS dict directly via the `key`
            # parameter; it picks the matching JWK by `kid` from the
            # token header. Algorithm allowlist mirrors coord's
            # JWT issuance (HMAC-rejecting; key-pair only).
            claims = jwt.decode(
                token,
                jwks,
                algorithms=["RS256", "ES256", "EdDSA"],
                options={"verify_aud": False},
            )
        except JWKError as exc:
            raise CoordTokenInvalidError(f"JWKS key error: {exc}") from exc
        except JWTError as exc:
            raise CoordTokenInvalidError(f"token verification failed: {exc}") from exc

        if not isinstance(claims, dict):
            raise CoordTokenInvalidError("decoded JWT is not a JSON object")

        return claims


# Process-wide singleton — wired at import time.
coord_jwks_client = CoordJWKSClient(coord_url=settings.COORD_URL)
