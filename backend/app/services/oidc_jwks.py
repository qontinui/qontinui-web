"""OpenID Connect user-token verification — Cognito and any configured issuer.

The web backend accepts user tokens from the Cognito user pool
(``COGNITO_ISSUER``) and from every issuer in ``OIDC_PROVIDERS`` (Entra ID,
Keycloak, Okta, ...). Each issuer gets one :class:`OIDCIssuerClient`; the
process-wide :data:`oidc_verifier` routes a presented token to the client for
its ``iss`` claim.

Key discovery follows OpenID Connect Discovery 1.0: the client fetches
``<issuer>/.well-known/openid-configuration``, checks that its ``issuer``
member names the configured issuer (§4.3 — a document for another issuer is
refused), and fetches the JWKS from its ``jwks_uri``. Cognito serves the same
document, so the Cognito pool goes through the same path; nothing derives a
JWKS URL by string concatenation any more.

Caching:

* The discovery document and JWKS are reused for
  ``OIDC_METADATA_CACHE_TTL_SECONDS`` and then refetched on the next
  verification.
* A ``kid`` absent from the cached set forces one refetch of both (key
  rotation), RATE-LIMITED to one per ``_FORCED_REFRESH_COOLDOWN_S``: the
  ``kid`` comes from an unverified header, so without the cooldown any caller
  could drive one outbound round-trip per request.
* A refetch that FAILS while a previously fetched JWKS is held keeps serving
  that JWKS (logged), so a transient issuer outage does not log every user
  out at each TTL boundary. A cold start with no JWKS fails closed —
  never "trust the token".

Verification gates (all must pass): asymmetric JWS signature against the JWK
selected by ``kid`` (``HS*`` and ``none`` are never accepted), ``iss`` equal
to the configured issuer, ``exp`` in the future (30 s leeway), and at least
one of the provider's ``audience_claims`` naming an allowed client.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
import jwt as pyjwt
import structlog
from jwt.exceptions import InvalidTokenError, PyJWKError, PyJWTError

from app.core.config import Settings, cognito_issuer_setting_name, settings

logger = structlog.get_logger(__name__)

# Minimum interval between FORCED (kid-miss-driven) refetches. Matches coord's
# `auth_sso::FORCED_REFRESH_COOLDOWN` and `coord_jwks._FORCED_REFRESH_COOLDOWN_S`.
_FORCED_REFRESH_COOLDOWN_S = 30

# Cap on attacker-controlled header/claim values (``kid``, unverified ``iss``)
# where they reach an exception message that is logged on a PRE-AUTH path.
# Matches `coord_jwks._MAX_KID_CHARS`.
_MAX_KID_CHARS = 64
_MAX_ISS_CHARS = 256

# Clock-skew tolerance for ``exp`` / ``nbf`` / ``iat``.
_CLOCK_SKEW_LEEWAY_S = 30

# Asymmetric algorithms only. A JWK that declares its own ``alg`` narrows this
# to that one algorithm, so a token cannot pick a different one for the key.
_ALLOWED_ALGORITHMS = (
    "RS256",
    "RS384",
    "RS512",
    "PS256",
    "PS384",
    "PS512",
    "ES256",
    "ES384",
    "ES512",
)

DISCOVERY_PATH = "/.well-known/openid-configuration"


def normalise_issuer(issuer: str) -> str:
    """The comparison form of an issuer: trimmed, without a trailing slash.

    Some issuers (Auth0) stamp ``iss`` with a trailing slash; configuration
    and routing compare the slash-less form on both sides.
    """
    return issuer.strip().rstrip("/")


class OIDCJWKSUnavailableError(RuntimeError):
    """The issuer's discovery document or JWKS could not be fetched.

    Carries the issuer, the URL actually dialled and the setting that
    configured the issuer, so the one log line a handler writes can tell a
    wrong setting from an unreachable issuer.
    """

    def __init__(
        self, message: str, *, issuer: str = "", url: str = "", issuer_setting: str = ""
    ) -> None:
        super().__init__(message)
        self.issuer = issuer
        self.url = url
        self.issuer_setting = issuer_setting


class OIDCTokenInvalidError(RuntimeError):
    """A presented token failed verification."""


@dataclass(frozen=True)
class OIDCProvider:
    """One accepted issuer and how its tokens are checked."""

    issuer: str
    audiences: frozenset[str]
    audience_claims: tuple[str, ...]
    groups_claim: str
    # Which setting configured this issuer — named in failure logs.
    issuer_setting: str
    # ``cognito`` identities live on ``auth.users.cognito_sub``; ``oidc``
    # identities on ``auth.user_oidc_identities``.
    kind: Literal["cognito", "oidc"]

    def __post_init__(self) -> None:
        object.__setattr__(self, "issuer", normalise_issuer(self.issuer))


@dataclass(frozen=True)
class VerifiedToken:
    """The verified claims of a token and the provider that vouched for them."""

    claims: dict[str, Any]
    provider: OIDCProvider = field(repr=False)


class OIDCIssuerClient:
    """Discovery + JWKS cache + token verifier for ONE issuer."""

    def __init__(
        self,
        provider: OIDCProvider,
        *,
        metadata_ttl_s: float = 3600.0,
        http_timeout_s: float = 10.0,
    ) -> None:
        self._provider = provider
        self._metadata_ttl_s = metadata_ttl_s
        self._http_timeout_s = http_timeout_s
        self._jwks_uri: str | None = None
        self._jwks: dict[str, Any] | None = None
        # ``time.monotonic`` readings; ``None`` means "never" (a ``0.0``
        # sentinel would read as recent near host boot, where monotonic's
        # origin sits — the defect ``cognito_jwks`` once carried).
        self._fetched_at: float | None = None
        self._forced_at: float | None = None
        self._lock = asyncio.Lock()

    @property
    def provider(self) -> OIDCProvider:
        return self._provider

    @property
    def issuer(self) -> str:
        return self._provider.issuer

    @property
    def discovery_url(self) -> str:
        return f"{self._provider.issuer}{DISCOVERY_PATH}"

    @property
    def jwks_url(self) -> str | None:
        """The ``jwks_uri`` discovery returned, or ``None`` before discovery."""
        return self._jwks_uri

    def _unavailable(self, message: str, url: str) -> OIDCJWKSUnavailableError:
        return OIDCJWKSUnavailableError(
            message,
            issuer=self._provider.issuer,
            url=url,
            issuer_setting=self._provider.issuer_setting,
        )

    async def _fetch_json(self, url: str, what: str) -> dict[str, Any]:
        """GET ``url`` and return its JSON object body. Raises on any failure.

        Every raise names the URL dialled and, for a transport fault, the
        concrete exception class: ``httpx`` renders many transport faults
        (``ConnectTimeout``, ``ProxyError``...) with an empty ``str()``.
        Redirects are not followed — a discovery document or key set that
        moves is a configuration change, not something to chase.
        """
        try:
            async with httpx.AsyncClient(timeout=self._http_timeout_s) as c:
                resp = await c.get(url)
        except httpx.HTTPError as exc:
            raise self._unavailable(
                f"OIDC {what} fetch failed (transport): url={url} "
                f"timeout_s={self._http_timeout_s} "
                f"error_class={type(exc).__name__} error={exc}",
                url,
            ) from exc

        if resp.status_code != 200:
            raise self._unavailable(
                f"OIDC {what} fetch failed: url={url} "
                f"HTTP {resp.status_code} {resp.text[:200]}",
                url,
            )
        try:
            body = resp.json()
        except ValueError as exc:
            raise self._unavailable(
                f"OIDC {what} response not JSON: url={url} {resp.text[:200]}", url
            ) from exc
        if not isinstance(body, dict):
            raise self._unavailable(
                f"OIDC {what} response is not a JSON object: url={url}", url
            )
        return body

    def _check_jwks_uri(self, jwks_uri: Any) -> str:
        """``jwks_uri`` must be an absolute URL no weaker than the issuer's scheme."""
        url = self.discovery_url
        if not isinstance(jwks_uri, str) or not jwks_uri:
            raise self._unavailable(
                f"OIDC discovery document has no jwks_uri: url={url}", url
            )
        parsed = urlparse(jwks_uri)
        issuer_scheme = urlparse(self._provider.issuer).scheme
        allowed = {"https"} if issuer_scheme == "https" else {"https", "http"}
        if parsed.scheme not in allowed or not parsed.hostname:
            raise self._unavailable(
                f"OIDC discovery jwks_uri {jwks_uri!r} is not an acceptable "
                f"{'/'.join(sorted(allowed))} URL: url={url}",
                url,
            )
        return jwks_uri

    async def _discover(self) -> str:
        """Fetch the discovery document and return its validated ``jwks_uri``."""
        url = self.discovery_url
        doc = await self._fetch_json(url, "discovery")
        advertised = doc.get("issuer")
        if (
            not isinstance(advertised, str)
            or normalise_issuer(advertised) != self._provider.issuer
        ):
            raise self._unavailable(
                "OIDC discovery document names a different issuer: "
                f"url={url} expected={self._provider.issuer!r} "
                f"got={str(advertised)[:_MAX_ISS_CHARS]!r}",
                url,
            )
        return self._check_jwks_uri(doc.get("jwks_uri"))

    async def _fetch_metadata(self) -> tuple[str, dict[str, Any]]:
        """Discovery then JWKS, both fetched fresh."""
        jwks_uri = await self._discover()
        jwks = await self._fetch_json(jwks_uri, "JWKS")
        if not isinstance(jwks.get("keys"), list):
            raise self._unavailable(
                f"OIDC JWKS missing 'keys' list: url={jwks_uri}", jwks_uri
            )
        return jwks_uri, jwks

    async def _get_jwks(self, *, force_refresh: bool) -> dict[str, Any]:
        """The cached JWKS, refetched when absent, past its TTL, or forced."""
        async with self._lock:
            now = time.monotonic()
            fresh = (
                self._jwks is not None
                and self._fetched_at is not None
                and (now - self._fetched_at) < self._metadata_ttl_s
            )
            if fresh and not force_refresh and self._jwks is not None:
                return self._jwks

            if force_refresh and self._jwks is not None:
                if (
                    self._forced_at is not None
                    and (now - self._forced_at) < _FORCED_REFRESH_COOLDOWN_S
                ):
                    # Already refetched recently — serve the cache; the
                    # caller's kid lookup fails as it would have.
                    return self._jwks
                self._forced_at = now

            try:
                jwks_uri, jwks = await self._fetch_metadata()
            except OIDCJWKSUnavailableError as exc:
                if self._jwks is None:
                    raise
                logger.warning(
                    "oidc_jwks_refresh_failed_serving_cached",
                    forced=force_refresh,
                    **oidc_jwks_failure_log_fields(exc),
                )
                return self._jwks

            self._jwks_uri = jwks_uri
            self._jwks = jwks
            self._fetched_at = now
            logger.info(
                "oidc_jwks_fetched",
                issuer=self._provider.issuer,
                jwks_url=jwks_uri,
                key_count=len(jwks["keys"]),
                forced=force_refresh,
            )
            return jwks

    @staticmethod
    def _find_jwk(jwks: dict[str, Any], kid: str) -> dict[str, Any] | None:
        return next(
            (
                k
                for k in jwks.get("keys", [])
                if isinstance(k, dict) and k.get("kid") == kid
            ),
            None,
        )

    async def verify_token(self, token: str) -> dict[str, Any]:
        """Verify ``token`` against this issuer and return its claims.

        Raises:
            OIDCJWKSUnavailableError: no JWKS could be obtained (cold start).
            OIDCTokenInvalidError: signature, issuer, audience, expiry or
                shape check failed.
        """
        try:
            header = pyjwt.get_unverified_header(token)
        except InvalidTokenError as exc:
            raise OIDCTokenInvalidError(f"token header malformed: {exc}") from exc

        kid = header.get("kid")
        if not kid:
            raise OIDCTokenInvalidError("token header missing 'kid'")
        kid = str(kid)[:_MAX_KID_CHARS]

        jwks = await self._get_jwks(force_refresh=False)
        jwk_dict = self._find_jwk(jwks, kid)
        if jwk_dict is None:
            jwks = await self._get_jwks(force_refresh=True)
            jwk_dict = self._find_jwk(jwks, kid)
        if jwk_dict is None:
            raise OIDCTokenInvalidError(
                f"no JWK with kid={kid!r} in the JWKS of {self._provider.issuer}"
            )

        jwk_alg = jwk_dict.get("alg")
        if jwk_alg is not None:
            if jwk_alg not in _ALLOWED_ALGORITHMS:
                raise OIDCTokenInvalidError(
                    f"JWK kid={kid!r} declares a disallowed alg {str(jwk_alg)[:16]!r}"
                )
            algorithms = [str(jwk_alg)]
        else:
            algorithms = list(_ALLOWED_ALGORITHMS)

        try:
            jwk = pyjwt.PyJWK(jwk_dict)
        except PyJWKError as exc:
            raise OIDCTokenInvalidError(f"JWK materialization failed: {exc}") from exc

        # Signature + exp (+ nbf/iat when present). ``iss`` and ``aud`` are
        # checked below: ``iss`` in its normalised form (trailing-slash
        # issuers), ``aud`` across the provider's configured claims.
        try:
            claims = pyjwt.decode(
                token,
                jwk.key,
                algorithms=algorithms,
                options={
                    "verify_aud": False,
                    "verify_iss": False,
                    "require": ["exp", "iss"],
                },
                leeway=_CLOCK_SKEW_LEEWAY_S,
            )
        except PyJWTError as exc:
            raise OIDCTokenInvalidError(f"token verification failed: {exc}") from exc
        except (TypeError, ValueError) as exc:
            # A key/alg family mismatch can surface from the crypto backend.
            raise OIDCTokenInvalidError(f"token verification failed: {exc}") from exc

        if not isinstance(claims, dict):
            raise OIDCTokenInvalidError("decoded JWT is not a JSON object")

        iss = claims.get("iss")
        if not isinstance(iss, str) or normalise_issuer(iss) != self._provider.issuer:
            raise OIDCTokenInvalidError("token issuer does not match")

        self._check_audience(claims)
        return claims

    def _check_audience(self, claims: dict[str, Any]) -> None:
        """Accept when any configured audience claim names an allowed client.

        An empty allowed set means "do not constrain" — possible only for the
        Cognito pool (``COGNITO_ALLOWED_AUDIENCES`` blank, dev); generic
        providers must configure at least one audience.
        """
        allowed = self._provider.audiences
        if not allowed:
            return
        candidates: set[str] = set()
        for name in self._provider.audience_claims:
            value = claims.get(name)
            if isinstance(value, str):
                candidates.add(value)
            elif isinstance(value, list):
                candidates.update(str(v) for v in value)
        if candidates & allowed:
            return
        raise OIDCTokenInvalidError(
            "token audience not allowed: "
            f"{'/'.join(self._provider.audience_claims)}="
            f"{sorted(candidates)[:8]} not in allowed set"
        )


class OIDCVerifier:
    """Routes a token to the :class:`OIDCIssuerClient` for its ``iss``."""

    def __init__(self, clients: list[OIDCIssuerClient]) -> None:
        self._clients = {c.issuer: c for c in clients}

    @property
    def configured(self) -> bool:
        """Whether any issuer is accepted at all."""
        return bool(self._clients)

    @property
    def clients(self) -> list[OIDCIssuerClient]:
        return list(self._clients.values())

    @property
    def cognito_client(self) -> OIDCIssuerClient | None:
        """The client for the Cognito pool, when one is configured."""
        return next(
            (c for c in self._clients.values() if c.provider.kind == "cognito"), None
        )

    def client_for_issuer(self, issuer: str) -> OIDCIssuerClient | None:
        return self._clients.get(normalise_issuer(issuer))

    async def verify_token(self, token: str) -> VerifiedToken:
        """Verify ``token`` against the issuer its ``iss`` names.

        The unverified ``iss`` only SELECTS a client; that client then
        re-checks ``iss`` against its own configured value after the
        signature verifies, so a forged ``iss`` cannot borrow another
        issuer's keys.
        """
        try:
            unverified = pyjwt.decode(token, options={"verify_signature": False})
        except InvalidTokenError as exc:
            raise OIDCTokenInvalidError(f"token malformed: {exc}") from exc
        iss = unverified.get("iss") if isinstance(unverified, dict) else None
        if not isinstance(iss, str) or not iss:
            raise OIDCTokenInvalidError("token has no 'iss' claim")
        client = self.client_for_issuer(iss)
        if client is None:
            raise OIDCTokenInvalidError(
                f"token issuer {iss[:_MAX_ISS_CHARS]!r} is not an accepted issuer"
            )
        claims = await client.verify_token(token)
        return VerifiedToken(claims=claims, provider=client.provider)


def build_providers(cfg: Settings) -> list[OIDCProvider]:
    """Every accepted issuer, from settings: the Cognito pool, then OIDC_PROVIDERS."""
    providers: list[OIDCProvider] = []
    if cfg.COGNITO_ISSUER:
        providers.append(
            OIDCProvider(
                issuer=cfg.COGNITO_ISSUER,
                audiences=frozenset(cfg.cognito_allowed_audiences_list),
                # Cognito ID tokens carry the app-client id in ``aud``;
                # access tokens carry it in ``client_id`` and have no ``aud``.
                audience_claims=("aud", "client_id"),
                groups_claim=cfg.COGNITO_GROUPS_CLAIM,
                issuer_setting=cognito_issuer_setting_name(cfg),
                kind="cognito",
            )
        )
    for index, entry in enumerate(cfg.OIDC_PROVIDERS):
        providers.append(
            OIDCProvider(
                issuer=entry.issuer,
                audiences=frozenset(entry.audiences),
                audience_claims=tuple(entry.audience_claims),
                groups_claim=entry.groups_claim,
                issuer_setting=f"OIDC_PROVIDERS[{index}]",
                kind="oidc",
            )
        )
    return providers


def build_verifier(cfg: Settings) -> OIDCVerifier:
    return OIDCVerifier(
        [
            OIDCIssuerClient(p, metadata_ttl_s=cfg.OIDC_METADATA_CACHE_TTL_SECONDS)
            for p in build_providers(cfg)
        ]
    )


# Process-wide verifier, wired from settings at import time.
oidc_verifier = build_verifier(settings)


def oidc_jwks_failure_log_fields(exc: OIDCJWKSUnavailableError) -> dict[str, Any]:
    """The structured fields every terminating JWKS-unavailable handler logs.

    The callers answer with a deliberately vague message ("temporarily
    unavailable"), so this line is the whole diagnostic surface: ``url`` is
    what was dialled, ``issuer_setting`` the knob that produced it (an
    explicit ``COGNITO_ISSUER``, the derived ``COGNITO_REGION`` +
    ``COGNITO_USER_POOL_ID`` pair, or an ``OIDC_PROVIDERS`` entry), and
    ``cause`` the transport class that separates an outage from a typo.
    """
    return {
        "error": str(exc),
        "failure": type(exc).__name__,
        "cause": type(exc.__cause__).__name__ if exc.__cause__ else None,
        "issuer": exc.issuer,
        "url": exc.url,
        "issuer_setting": exc.issuer_setting,
    }
