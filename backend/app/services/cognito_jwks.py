"""AWS Cognito JWKS fetcher + user-token JWT verification.

Phase 1 of the unified-Cognito-identity plan. The web backend must
accept AWS Cognito user-pool JWTs as a valid session *in addition to*
the existing FastAPI-Users local HS256 JWT (dual-accept). This module
is the Cognito half: it fetches the pool JWKS once, caches it for the
process lifetime, lazily refreshes on a ``kid``-miss (covers Cognito
signing-key rotation without a restart), and verifies a presented token.

Design mirrors ``app/services/coord_jwks.py`` (coord device-token
verifier) and ``qontinui-coord/src/auth_sso.rs`` ``JwksCache`` /
``verify_token``: process-wide singleton, RwLock-equivalent async lock,
fetch-on-cold-start, force-refresh on key-not-found.

Verification gates (all must pass):

1. RS256 JWS signature against the JWK in the pool JWKS matching the
   token header ``kid``.
2. ``iss`` equals the configured pool issuer
   (``https://cognito-idp.<region>.amazonaws.com/<pool_id>``).
3. ``aud`` OR ``client_id`` is in the configured allowed-audience set.
   Cognito **ID tokens** carry the app-client id in ``aud``; Cognito
   **access tokens** carry it in ``client_id`` (and have no ``aud``).
   A token is accepted if *either* claim is in the allowed set.
4. ``exp`` is in the future (with a small clock-skew leeway).

We use ``PyJWT`` (with its ``cryptography`` backend) rather than
``python-jose`` to stay consistent with ``coord_jwks.py`` (the other
JWKS verifier in this codebase) and because ``PyJWK`` materializes a
Cognito RSA JWK directly. Both libs are already backend deps; we reuse
the one the sibling verifier uses.

Failure-mode discipline (per the coord verifier precedent): if the JWKS
is unreachable on cold start, REJECT — never silently fall back to
"trust the token".
"""

from __future__ import annotations

import asyncio
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

# Clock-skew tolerance for ``exp`` / ``iat`` validation. Web and Cognito
# run on different clocks; standard distributed-JWT practice is 30-60s.
# 30s matches the coord verifier's floor.
_CLOCK_SKEW_LEEWAY_S = 30

# Cognito signs user-pool tokens with RS256 exclusively. We pin the
# algorithm allowlist to RS256 (asymmetric, pool-key-pair) so a token
# cannot smuggle in an HMAC ("alg confusion") attack against the JWK.
_ALLOWED_ALGORITHMS = ["RS256"]


class CognitoJWKSUnavailableError(RuntimeError):
    """Raised when the Cognito pool JWKS cannot be fetched (cold-start)."""


class CognitoTokenInvalidError(RuntimeError):
    """Raised when a presented Cognito JWT fails verification."""


class CognitoJWKSClient:
    """Thread-safe JWKS fetcher + cached verifier for Cognito user-pool JWTs.

    Lifetime: process-wide singleton (see module-level
    ``cognito_jwks_client`` below). The first verification after process
    start triggers the fetch; subsequent verifications reuse the cache
    for the process lifetime. A ``kid`` not present in the cached set
    forces a single re-fetch (absorbs Cognito key rotation), then the
    token is rejected if the key is still absent.
    """

    def __init__(
        self,
        *,
        issuer: str,
        allowed_audiences: list[str],
        jwks_url: str | None = None,
        http_timeout_s: float = 10.0,
    ) -> None:
        self._issuer = issuer.rstrip("/")
        self._allowed_audiences = set(allowed_audiences)
        self._jwks_url = jwks_url or f"{self._issuer}/.well-known/jwks.json"
        self._http_timeout_s = http_timeout_s
        self._jwks: dict[str, Any] | None = None
        self._lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        """Whether the issuer is configured (Cognito accept enabled)."""
        return bool(self._issuer)

    @property
    def issuer(self) -> str:
        return self._issuer

    async def _fetch_jwks(self) -> dict[str, Any]:
        """Fetch the pool JWKS over HTTP. Raises on any failure."""
        try:
            async with httpx.AsyncClient(timeout=self._http_timeout_s) as c:
                resp = await c.get(self._jwks_url)
        except httpx.HTTPError as exc:
            raise CognitoJWKSUnavailableError(
                f"Cognito JWKS fetch failed (transport): {exc}"
            ) from exc

        if resp.status_code != 200:
            raise CognitoJWKSUnavailableError(
                f"Cognito JWKS fetch failed: HTTP {resp.status_code} "
                f"{resp.text[:200]}"
            )

        try:
            body = resp.json()
        except ValueError as exc:
            raise CognitoJWKSUnavailableError(
                f"Cognito JWKS response not JSON: {resp.text[:200]}"
            ) from exc

        if not isinstance(body, dict) or "keys" not in body:
            raise CognitoJWKSUnavailableError(
                f"Cognito JWKS missing 'keys' field: {body!r}"
            )

        return body

    async def _get_jwks(self, *, force_refresh: bool) -> dict[str, Any]:
        """Return the cached JWKS, (re)fetching when absent or forced.

        Unlike a TTL cache, the Cognito set is cached for the process
        lifetime; the only refetch trigger is a ``kid``-miss (handled by
        the caller passing ``force_refresh=True``).
        """
        async with self._lock:
            if self._jwks is not None and not force_refresh:
                return self._jwks

            jwks = await self._fetch_jwks()
            self._jwks = jwks
            logger.info(
                "cognito_jwks_fetched",
                jwks_url=self._jwks_url,
                key_count=len(jwks.get("keys", [])),
                forced=force_refresh,
            )
            return jwks

    def _find_jwk(self, jwks: dict[str, Any], kid: str) -> dict[str, Any] | None:
        return next(
            (k for k in jwks.get("keys", []) if k.get("kid") == kid),
            None,
        )

    async def verify_token(self, token: str) -> dict[str, Any]:
        """Verify a Cognito user-pool JWT and return its decoded claims.

        Raises:
            CognitoJWKSUnavailableError: JWKS could not be fetched on
                cold start.
            CognitoTokenInvalidError: Token failed signature / claim
                validation (bad signature, expired, wrong issuer/audience,
                unknown ``kid``, malformed, etc.).
        """
        if not self.configured:
            raise CognitoTokenInvalidError("Cognito issuer not configured")

        # Parse the header to pick the JWK by ``kid``. Signature-unverified;
        # the ``kid`` is only used for key lookup and ``decode`` below
        # re-validates the algorithm against the allowlist before any crypto.
        try:
            header = pyjwt.get_unverified_header(token)
        except InvalidTokenError as exc:
            raise CognitoTokenInvalidError(
                f"token header malformed: {exc}"
            ) from exc

        kid = header.get("kid")
        if not kid:
            raise CognitoTokenInvalidError("token header missing 'kid'")

        # First pass against the cached set; on a kid-miss, force one
        # refresh to absorb Cognito signing-key rotation.
        try:
            jwks = await self._get_jwks(force_refresh=False)
            jwk_dict = self._find_jwk(jwks, kid)
            if jwk_dict is None:
                jwks = await self._get_jwks(force_refresh=True)
                jwk_dict = self._find_jwk(jwks, kid)
        except CognitoJWKSUnavailableError:
            raise
        except Exception as exc:  # defensive
            raise CognitoJWKSUnavailableError(str(exc)) from exc

        if jwk_dict is None:
            raise CognitoTokenInvalidError(
                f"no JWK with kid={kid!r} in Cognito JWKS"
            )

        try:
            jwk = pyjwt.PyJWK(jwk_dict)
        except PyJWKError as exc:
            raise CognitoTokenInvalidError(
                f"JWK materialization failed: {exc}"
            ) from exc

        # Verify signature + iss + exp. Audience is checked manually below
        # because Cognito splits the app-client id across ``aud`` (ID
        # tokens) and ``client_id`` (access tokens); PyJWT's built-in
        # ``aud`` check only inspects ``aud``.
        try:
            claims = pyjwt.decode(
                token,
                jwk.key,
                algorithms=_ALLOWED_ALGORITHMS,
                issuer=self._issuer,
                options={"verify_aud": False, "require": ["exp", "iss"]},
                leeway=_CLOCK_SKEW_LEEWAY_S,
            )
        except PyJWTError as exc:
            raise CognitoTokenInvalidError(
                f"token verification failed: {exc}"
            ) from exc

        if not isinstance(claims, dict):
            raise CognitoTokenInvalidError("decoded JWT is not a JSON object")

        self._check_audience(claims)
        return claims

    def _check_audience(self, claims: dict[str, Any]) -> None:
        """Accept the token if ``aud`` OR ``client_id`` is allowed.

        An empty allowed-audience set means "do not constrain audience"
        (dev / single-client deployments); production always configures
        the set. ``aud`` may be a string or a list per RFC 7519.
        """
        if not self._allowed_audiences:
            return

        candidates: set[str] = set()
        aud = claims.get("aud")
        if isinstance(aud, str):
            candidates.add(aud)
        elif isinstance(aud, list):
            candidates.update(str(a) for a in aud)
        client_id = claims.get("client_id")
        if isinstance(client_id, str):
            candidates.add(client_id)

        if candidates & self._allowed_audiences:
            return

        raise CognitoTokenInvalidError(
            "token audience not allowed: "
            f"aud/client_id={sorted(candidates)} not in allowed set"
        )


def _build_default_client() -> CognitoJWKSClient:
    """Wire the process-wide client from settings."""
    return CognitoJWKSClient(
        issuer=settings.COGNITO_ISSUER,
        allowed_audiences=settings.cognito_allowed_audiences_list,
    )


# Process-wide singleton — wired at import time. Re-created lazily only
# in tests via the constructor.
cognito_jwks_client = _build_default_client()
