"""Coord JWKS fetcher + device-token JWT verification.

Phase 5 of the Unified Devices Registry plan
(``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
retires the runner-token (``qontinui_runner_<random>`` + Argon2)
authentication scheme. The new ``WS /api/v1/devices/ws`` endpoint
authenticates with a coord-issued device-token JWT that the runner
obtained via the OAuth-loopback pairing flow (``POST
/coord/devices/pair-complete``).

This module fetches coord's JWKS (``GET {coord_device_base()}/coord/auth/jwks``
-- the DEVICE-identity coord, which is ``COORD_DEVICE_URL`` when set and
``COORD_URL`` otherwise)
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
import re
import time
from typing import Any

import httpx
import jwt as pyjwt
import structlog
from jwt.exceptions import (
    ExpiredSignatureError,
    ImmatureSignatureError,
    InvalidTokenError,
    PyJWKError,
    PyJWTError,
)

from app.core.config import coord_device_base

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

# Cap on the attacker-controlled ``kid`` where it reaches an exception
# message (which callers log). Real coord kids are ~28 chars
# (``coord-ed25519-`` plus a 16-hex thumbprint); Cognito's are ~44.
_MAX_KID_CHARS = 64

# Minimum interval between FORCED (kid-miss-driven) JWKS re-fetches.
#
# A kid miss triggers a live re-fetch so a key-id change is picked up in
# seconds instead of at the next TTL expiry. But `kid` is attacker-supplied,
# so an unbounded stream of unknown-kid bearers would otherwise let anyone
# drive one coord round-trip per request. The cooldown collapses that to at
# most one forced fetch per window, at the cost of at most one window of
# kid-miss rejections in the pathological single-key-swap case.
#
# 30s mirrors coord's own `auth_sso::FORCED_REFRESH_COOLDOWN`, which exists
# for exactly this reason. The sibling `cognito_jwks` no longer lacks a
# cooldown — web #1076 gave it this same 30s — so keep the two in step if
# this number moves. They are NOT yet equivalent, though: that door measures
# the window on `time.monotonic` and this one still measures it on the wall
# clock, so only one of them is immune to a clock step. Closing that is its
# own row on plan `2026-08-25-coord-jwt-kid-collides-across-environments`.
_FORCED_REFRESH_COOLDOWN_S = 30


class CoordJWKSUnavailableError(RuntimeError):
    """Raised when coord's JWKS cannot be fetched (cold-start failure)."""


class CoordTokenInvalidError(RuntimeError):
    """Raised when a presented device-token JWT fails verification.

    Base class for the two more specific failures below, so any caller
    that only cares about "did this token verify" keeps working
    unchanged while callers that can act on the distinction may catch
    the subclasses first.
    """


class CoordTokenExpiredError(CoordTokenInvalidError):
    """The token verified against a known key but its ``exp`` has passed.

    The client's remedy is to re-mint. Distinguished from a signature
    failure so an operator reading the rejection is not sent to check
    key wiring for what is simply a stale token.
    """


class CoordTokenNotYetValidError(CoordTokenInvalidError):
    """The token verified against a known key but is not valid YET.

    ``nbf`` / ``iat`` sit beyond ``_CLOCK_SKEW_LEEWAY_S`` in the future.
    This module's own leeway comment records why that is a live risk
    rather than a theoretical one: coord truncates ``iat`` to whole
    seconds and web may run on a different clock. The remedy is to fix
    clock drift, so it must not be reported as a bad signature — that
    would send the reader to check key wiring, the exact misdirection
    this split exists to remove.
    """


class CoordTokenForeignIssuerError(CoordTokenInvalidError):
    """No key in the configured coord's JWKS carries the token's ``kid``.

    Called out separately because the historical failure was the
    opposite — coord stamped one hardcoded ``kid`` on every deployment's
    distinct signing key, so the lookup matched, the wrong key reached
    the crypto, and a foreign-but-genuine token was reported as a bad
    signature (i.e. as a forgery). See plan
    ``2026-08-25-coord-jwt-kid-collides-across-environments``.

    **Not inherently a fault.** For a caller that treats a rejection as
    terminal (``deps``, ``devices_ws``) this arm means the token was
    minted by a different coord than ``coord_device_base()`` points at —
    a deployment-wiring bug worth an alarm. But ``memory`` verifies every
    bearer here purely to decide whether it is coord-signed at all, and a
    Cognito token legitimately lands in this arm on the way to a
    SUCCESSFUL request. So this class carries the facts (``coord_url`` /
    ``served_kids``) and the terminal callers decide whether to raise the
    alarm — logging at the raise site would fire on routine successful
    traffic and bury the one line that matters.
    """

    def __init__(
        self, message: str, *, coord_url: str, token_kid: str, served_kids: list[str]
    ) -> None:
        super().__init__(message)
        self.coord_url = coord_url
        self.token_kid = token_kid
        self.served_kids = served_kids


def describe_token_rejection(exc: CoordTokenInvalidError) -> str:
    """Short, honest, presenter-facing reason for a rejected device token.

    Every caller used to render the single string ``"Invalid or expired
    device token."`` for all three failures below. When the real fault was
    a cross-coord ``kid`` collision that sentence was false in both of its
    terms, and it sent readers to check pairing state and token TTL —
    neither of which was wrong. Each arm now says only what is true.

    Kept under the RFC 6455 close-reason budget (123 bytes) so a WebSocket
    caller can pass the result straight through as a close reason.
    """
    if isinstance(exc, CoordTokenForeignIssuerError):
        return "Device token was issued by a different coord than this backend verifies against."
    if isinstance(exc, CoordTokenExpiredError):
        return "Device token has expired."
    if isinstance(exc, CoordTokenNotYetValidError):
        return "Device token is not valid yet — check clock drift."
    # Deliberately does NOT name the signature. This arm is the residue:
    # a malformed token, an unusable JWK, a missing kid, a non-integer
    # exp. Claiming "the signature is invalid" for those would trade a
    # vague message for a confidently wrong one, which is the failure
    # this whole function exists to stop.
    return "Device token failed verification."


def _example_key(cls: type[CoordTokenInvalidError]) -> str:
    """``CoordTokenNotYetValidError`` -> ``not_yet_valid``.

    Purely mechanical, so a class added later gets a sensible key without
    anyone maintaining a name table alongside the hierarchy.
    """
    name = cls.__name__.removeprefix("CoordToken").removesuffix("Error")
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def token_rejection_examples() -> dict[str, dict[str, Any]]:
    """OpenAPI ``examples`` for the 401 bodies a device-token door returns.

    DERIVED from :func:`describe_token_rejection` by walking the exception
    hierarchy — never transcribed from it. A transcription is exactly what
    went stale: ``events.py`` documented ``"Invalid or expired token"`` for
    ``POST /api/v1/events/phase-completed`` long after this module stopped
    emitting that sentence, and because the committed OpenAPI snapshots are
    generated from that declaration, the dead string reached every client
    generated from them. Deriving means the docs cannot say a thing this
    function does not.

    Walking ``__subclasses__()`` (as the budget test in
    ``tests/services/test_coord_jwks.py`` already does) also means a failure
    class added later is documented the moment it exists, rather than when
    somebody remembers to come back here. Keep every subclass defined in THIS
    module: ``__subclasses__()`` only sees classes already imported, and this
    runs at ``events`` import time, so a subclass living elsewhere would make
    the committed OpenAPI snapshot depend on import order.
    """
    examples: dict[str, dict[str, Any]] = {}
    for cls in [CoordTokenInvalidError, *CoordTokenInvalidError.__subclasses__()]:
        try:
            exc = cls("example")
        except TypeError:
            # A subclass whose ``__init__`` demands more than a message
            # (``CoordTokenForeignIssuerError`` does). This leans on
            # ``describe_token_rejection`` being a pure type-to-constant
            # dispatch: it never reads instance state, so an uninitialised
            # instance answers identically and this helper does not have to
            # know each signature. If that function ever starts reading an
            # attribute, this construction has to change with it — it will
            # say so by raising at import, not by returning something wrong.
            exc = cls.__new__(cls)
        # No ``summary``: the key already labels the arm, and sourcing one
        # from a docstring would make every prose edit churn the committed
        # OpenAPI snapshots — a second drift surface, which is the thing
        # this helper exists to close.
        examples[_example_key(cls)] = {
            "value": {"detail": describe_token_rejection(exc)}
        }
    return examples


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
        forced_cooldown_s: float = _FORCED_REFRESH_COOLDOWN_S,
    ) -> None:
        self._coord_url = coord_url.rstrip("/")
        self._ttl_s = ttl_s
        self._http_timeout_s = http_timeout_s
        self._forced_cooldown_s = forced_cooldown_s
        self._jwks: dict[str, Any] | None = None
        self._fetched_at: float = 0.0
        self._forced_at: float = 0.0
        self._lock = asyncio.Lock()

    @property
    def coord_url(self) -> str:
        """The coord base URL this client resolved at construction time.

        Exposed so a rejection handler can name the URL it actually dialled.
        A wrong/unset ``COORD_DEVICE_URL`` and a genuinely unreachable coord
        produce the same operator-facing message otherwise, and the first is
        a config fix while the second is an outage.
        """
        return self._coord_url

    async def _fetch_jwks(self) -> dict[str, Any]:
        """Fetch coord's JWKS over HTTP. Raises on any failure.

        Every raise names the resolved URL AND, for a transport fault, the
        underlying exception's concrete class. ``httpx.HTTPError`` covers
        ``ConnectTimeout``, ``ReadTimeout``, ``ConnectError``,
        ``ProxyError``… — states with completely different remedies that
        ``str(exc)`` frequently renders as the empty string.
        """
        url = f"{self._coord_url}/coord/auth/jwks"
        try:
            async with httpx.AsyncClient(timeout=self._http_timeout_s) as c:
                resp = await c.get(url)
        except httpx.HTTPError as exc:
            raise CoordJWKSUnavailableError(
                f"coord JWKS fetch failed (transport): url={url} "
                f"timeout_s={self._http_timeout_s} "
                f"error_class={type(exc).__name__} error={exc}"
            ) from exc

        if resp.status_code != 200:
            raise CoordJWKSUnavailableError(
                f"coord JWKS fetch failed: url={url} "
                f"HTTP {resp.status_code} {resp.text[:200]}"
            )

        try:
            body = resp.json()
        except ValueError as exc:
            raise CoordJWKSUnavailableError(
                f"coord JWKS response not JSON: url={url} {resp.text[:200]}"
            ) from exc

        if not isinstance(body, dict) or "keys" not in body:
            raise CoordJWKSUnavailableError(
                f"coord JWKS missing 'keys' field: url={url} {body!r}"
            )

        return body

    async def get_jwks(self, *, force_refresh: bool = False) -> dict[str, Any]:
        """Return the cached JWKS, refetching when expired, absent, or forced.

        ``force_refresh`` is the kid-miss path: the presented token names a
        key this cache has never seen, which is exactly what a coord key-id
        change looks like from here. Without it, a verifier holding a cache
        from before the change rejects every legitimately-issued token until
        the TTL expires — up to an hour of ``1008 "Invalid or expired device
        token."``, textually indistinguishable from the incident this module's
        error split exists to diagnose. Rate-limited by
        ``_FORCED_REFRESH_COOLDOWN_S``; when the cooldown is in force the
        cached copy is served and the caller's lookup fails as it would have.
        """
        async with self._lock:
            now = time.time()
            if force_refresh:
                if self._jwks is not None and (now - self._forced_at) < (
                    self._forced_cooldown_s
                ):
                    # Already refetched recently: serve the cache rather than
                    # letting a stream of unknown kids drive one coord
                    # round-trip per request.
                    return self._jwks
                self._forced_at = now
            elif self._jwks is not None and (now - self._fetched_at) < self._ttl_s:
                return self._jwks

            jwks = await self._fetch_jwks()
            self._jwks = jwks
            self._fetched_at = now
            logger.info(
                "coord_jwks_fetched",
                coord_url=self._coord_url,
                forced=force_refresh,
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
        # The kid is attacker-supplied (read from an UNVERIFIED header) and
        # otherwise unbounded, and it flows into an exception message that
        # callers log. Coerce and cap it so a caller cannot turn a rejection
        # into a log-write amplifier with content of its own choosing.
        kid = str(kid)[:_MAX_KID_CHARS]

        jwk_dict = next(
            (k for k in jwks.get("keys", []) if k.get("kid") == kid),
            None,
        )
        if jwk_dict is None:
            # A kid we have never seen is what a coord key-id change looks
            # like from here, so re-fetch ONCE and re-check before declaring
            # the token foreign. Without this, a cache populated before the
            # change rejects every legitimate token until the TTL expires.
            jwks = await self.get_jwks(force_refresh=True)
            jwk_dict = next(
                (k for k in jwks.get("keys", []) if k.get("kid") == kid),
                None,
            )

        if jwk_dict is None:
            served = [str(k.get("kid")) for k in jwks.get("keys", []) if k.get("kid")]
            raise CoordTokenForeignIssuerError(
                f"no JWK with kid={kid!r} in the JWKS served by "
                f"{self._coord_url} (it serves {served!r}) — the token was "
                f"minted by a different coord than this backend verifies "
                f"against",
                coord_url=self._coord_url,
                token_kid=kid,
                served_kids=served,
            )

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
        except ImmatureSignatureError as exc:
            # nbf/iat beyond the leeway. The signature DID verify, so this
            # is clock drift, not a key problem.
            raise CoordTokenNotYetValidError(f"token not yet valid: {exc}") from exc
        except ExpiredSignatureError as exc:
            # Verified against a key we know — it is simply stale. Kept
            # distinct from the signature arm so "expired" is only ever
            # claimed when the token really did expire.
            raise CoordTokenExpiredError(f"token expired: {exc}") from exc
        except PyJWTError as exc:
            raise CoordTokenInvalidError(f"token verification failed: {exc}") from exc

        if not isinstance(claims, dict):
            raise CoordTokenInvalidError("decoded JWT is not a JSON object")

        return claims


# Process-wide singleton — wired at import time.
coord_jwks_client = CoordJWKSClient(coord_url=coord_device_base())
