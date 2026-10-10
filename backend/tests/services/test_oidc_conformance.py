"""OIDC conformance tests for the user-token verifier against a LOCAL issuer.

A :class:`LocalIssuer` generates its own signing keys and serves an OpenID
Connect discovery document and JWKS through an ``httpx.MockTransport`` — the
verifier's real HTTP code path runs, only the network is in-process. The
issuer is deliberately NOT Cognito-shaped (a Keycloak-style realm URL, an
``aud``-only audience, a ``groups`` claim), which is the Phase 9 arming
condition: qontinui-web accepts a token from a non-Cognito OIDC issuer.

Covered: discovery (issuer pinning, ``jwks_uri`` scheme), acceptance of a
valid token, rejection of a wrong ``aud`` / ``iss`` / expired / badly signed /
``alg``-confused token, key rotation (an unknown ``kid`` refetches), TTL
refresh, serve-stale on a failed refresh, multi-issuer routing, and the
settings that configure all of it.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import jwt as pyjwt
import pytest
from pydantic import ValidationError

from app.core.config import OIDCProviderSetting, Settings
from app.services.oidc_jwks import (
    _FAILURE_BACKOFF_S,
    DISCOVERY_PATH,
    OIDCIssuerClient,
    OIDCJWKSUnavailableError,
    OIDCProvider,
    OIDCTokenInvalidError,
    OIDCVerifier,
    build_verifier,
)
from tests._oidc_local_issuer import DEFAULT_CLIENT as _CLIENT
from tests._oidc_local_issuer import DEFAULT_ISSUER as _ISSUER
from tests._oidc_local_issuer import LocalIssuer
from tests._oidc_local_issuer import route as _route

_ISOLATED_DB = "postgresql://user:pass@localhost/isolated"


async def _settle(client: OIDCIssuerClient) -> None:
    """Wait for any background refresh the client has in flight."""
    task = client._inflight
    if task is not None:
        await asyncio.gather(task, return_exceptions=True)


def _provider(issuer: str = _ISSUER, **over: Any) -> OIDCProvider:
    fields: dict[str, Any] = {
        "issuer": issuer,
        "audiences": frozenset({_CLIENT}),
        "audience_claims": ("aud",),
        "groups_claim": "groups",
        "issuer_setting": "OIDC_PROVIDERS[0]",
        "kind": "oidc",
    }
    fields.update(over)
    return OIDCProvider(**fields)


@pytest.fixture
def issuer(monkeypatch: pytest.MonkeyPatch) -> LocalIssuer:
    local = LocalIssuer()
    local.add_rsa_key("k1")
    _route(monkeypatch, local)
    return local


def _settings(**kw: Any) -> Settings:
    return Settings(_env_file=None, DATABASE_URL=_ISOLATED_DB, **kw)


# ---------------------------------------------------------------------------
# Acceptance
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_valid_token_from_a_non_cognito_issuer_is_accepted(
    issuer: LocalIssuer,
) -> None:
    """The arming condition, end to end through the settings-built verifier."""
    verifier = build_verifier(
        _settings(
            COGNITO_USER_POOL_ID="",
            OIDC_PROVIDERS=[OIDCProviderSetting(issuer=_ISSUER, audiences=[_CLIENT])],
        )
    )
    verified = await verifier.verify_token(issuer.mint("k1"))

    assert verified.claims["sub"] == "f3c1a2b4-0000-4000-8000-000000000001"
    assert verified.provider.issuer == _ISSUER
    assert verified.provider.kind == "oidc"
    # Keys were found by discovery, not by a derived URL.
    assert issuer.requests == [f"{_ISSUER}{DISCOVERY_PATH}", issuer.jwks_uri]


@pytest.mark.asyncio
async def test_es256_keys_are_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    local = LocalIssuer()
    local.add_ec_key("ec1")
    _route(monkeypatch, local)
    claims = await OIDCIssuerClient(_provider()).verify_token(local.mint("ec1"))
    assert claims["iss"] == _ISSUER


@pytest.mark.asyncio
async def test_trailing_slash_issuer_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    """Issuers that stamp ``iss`` with a trailing slash (Auth0) are accepted."""
    local = LocalIssuer("https://tenant.example.test/")
    local.add_rsa_key("k1")
    _route(monkeypatch, local)
    verifier = OIDCVerifier(
        [OIDCIssuerClient(_provider("https://tenant.example.test/"))]
    )
    verified = await verifier.verify_token(local.mint("k1"))
    assert verified.claims["iss"] == "https://tenant.example.test/"


@pytest.mark.asyncio
async def test_metadata_is_cached_within_the_ttl(issuer: LocalIssuer) -> None:
    client = OIDCIssuerClient(_provider())
    token = issuer.mint("k1")
    for _ in range(4):
        await client.verify_token(token)
    assert issuer.discovery_hits() == 1
    assert issuer.jwks_hits() == 1
    assert client.jwks_url == issuer.jwks_uri


# ---------------------------------------------------------------------------
# Rejection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wrong_audience_is_rejected(issuer: LocalIssuer) -> None:
    client = OIDCIssuerClient(_provider())
    with pytest.raises(OIDCTokenInvalidError, match="audience"):
        await client.verify_token(issuer.mint("k1", aud="some-other-app"))


@pytest.mark.asyncio
async def test_missing_audience_is_rejected(issuer: LocalIssuer) -> None:
    client = OIDCIssuerClient(_provider())
    with pytest.raises(OIDCTokenInvalidError, match="audience"):
        await client.verify_token(issuer.mint("k1", aud=None))


@pytest.mark.asyncio
async def test_audience_in_a_list_is_accepted(issuer: LocalIssuer) -> None:
    client = OIDCIssuerClient(_provider())
    claims = await client.verify_token(issuer.mint("k1", aud=["other", _CLIENT]))
    assert _CLIENT in claims["aud"]


@pytest.mark.asyncio
async def test_unaccepted_issuer_is_rejected_by_the_verifier(
    issuer: LocalIssuer,
) -> None:
    verifier = OIDCVerifier([OIDCIssuerClient(_provider())])
    token = issuer.mint("k1", iss="https://evil.example.test/realms/acme")
    with pytest.raises(OIDCTokenInvalidError, match="not an accepted issuer"):
        await verifier.verify_token(token)
    assert issuer.requests == [], "an unaccepted issuer must not drive a fetch"


@pytest.mark.asyncio
async def test_wrong_issuer_is_rejected_by_the_client(issuer: LocalIssuer) -> None:
    """The client re-checks ``iss`` after the signature, whatever routed it."""
    client = OIDCIssuerClient(_provider())
    with pytest.raises(OIDCTokenInvalidError, match="issuer"):
        await client.verify_token(issuer.mint("k1", iss="https://other.example.test"))


@pytest.mark.asyncio
async def test_expired_token_is_rejected(issuer: LocalIssuer) -> None:
    client = OIDCIssuerClient(_provider())
    now = int(time.time())
    with pytest.raises(OIDCTokenInvalidError, match="(?i)expired"):
        await client.verify_token(issuer.mint("k1", iat=now - 3600, exp=now - 600))


@pytest.mark.asyncio
async def test_bad_signature_is_rejected(issuer: LocalIssuer) -> None:
    """A token signed by a key the issuer never published, under a published kid."""
    impostor = LocalIssuer()
    impostor.add_rsa_key("k1")  # same kid, different key
    client = OIDCIssuerClient(_provider())
    with pytest.raises(OIDCTokenInvalidError, match="verification failed"):
        await client.verify_token(impostor.mint("k1"))


@pytest.mark.asyncio
async def test_tampered_payload_is_rejected(issuer: LocalIssuer) -> None:
    client = OIDCIssuerClient(_provider())
    header, _, signature = issuer.mint("k1").split(".")
    forged_payload = pyjwt.utils.base64url_encode(
        json.dumps(issuer.claims(sub="someone-else")).encode()
    ).decode()
    with pytest.raises(OIDCTokenInvalidError):
        await client.verify_token(f"{header}.{forged_payload}.{signature}")


@pytest.mark.asyncio
async def test_hmac_alg_confusion_is_rejected(issuer: LocalIssuer) -> None:
    """An HS256 token under a published RSA kid must never verify.

    The classic confusion signs HS256 with the public key as the secret;
    PyJWT refuses to even mint that, so any HMAC secret stands in — what is
    under test is that the verifier never admits an HMAC algorithm.
    """
    client = OIDCIssuerClient(_provider())
    token = pyjwt.encode(
        issuer.claims(),
        "x" * 64,
        algorithm="HS256",
        headers={"kid": "k1"},
    )
    with pytest.raises(OIDCTokenInvalidError):
        await client.verify_token(token)


@pytest.mark.asyncio
async def test_unsigned_token_is_rejected(issuer: LocalIssuer) -> None:
    client = OIDCIssuerClient(_provider())
    token = pyjwt.encode(
        issuer.claims(), key=None, algorithm="none", headers={"kid": "k1"}
    )
    with pytest.raises(OIDCTokenInvalidError):
        await client.verify_token(token)


@pytest.mark.asyncio
async def test_token_with_no_kid_is_rejected(issuer: LocalIssuer) -> None:
    private, alg = issuer._keys["k1"]
    token = pyjwt.encode(issuer.claims(), private, algorithm=alg)
    with pytest.raises(OIDCTokenInvalidError, match="kid"):
        await OIDCIssuerClient(_provider()).verify_token(token)


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_discovery_naming_another_issuer_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """OIDC Discovery §4.3: the document's issuer MUST equal the configured one."""
    local = LocalIssuer(advertised_issuer="https://elsewhere.example.test")
    local.add_rsa_key("k1")
    _route(monkeypatch, local)
    with pytest.raises(OIDCJWKSUnavailableError, match="different issuer"):
        await OIDCIssuerClient(_provider()).verify_token(local.mint("k1"))
    assert local.jwks_hits() == 0, "no key set is fetched for a mismatched document"


@pytest.mark.asyncio
async def test_plain_http_jwks_uri_under_an_https_issuer_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    local = LocalIssuer()
    local.add_rsa_key("k1")
    local.jwks_uri = "http://idp.example.test/realms/acme/certs"
    _route(monkeypatch, local)
    with pytest.raises(OIDCJWKSUnavailableError, match="jwks_uri"):
        await OIDCIssuerClient(_provider()).verify_token(local.mint("k1"))


@pytest.mark.asyncio
async def test_cold_start_with_the_issuer_down_fails_closed(
    issuer: LocalIssuer,
) -> None:
    issuer.down = True
    with pytest.raises(OIDCJWKSUnavailableError) as excinfo:
        await OIDCIssuerClient(_provider()).verify_token(issuer.mint("k1"))
    assert excinfo.value.url == f"{_ISSUER}{DISCOVERY_PATH}"
    assert "ConnectError" in str(excinfo.value)


# ---------------------------------------------------------------------------
# Key rotation and refresh
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_kid_triggers_a_refetch_that_absorbs_rotation(
    issuer: LocalIssuer,
) -> None:
    client = OIDCIssuerClient(_provider())
    await client.verify_token(issuer.mint("k1"))
    assert issuer.jwks_hits() == 1

    issuer.rotate_to("k2")
    claims = await client.verify_token(issuer.mint("k2"))

    assert claims["iss"] == _ISSUER
    assert issuer.jwks_hits() == 2, "the unknown kid forced exactly one refetch"
    assert issuer.discovery_hits() == 2, "rotation re-reads discovery as well"

    # The retired key no longer verifies once the rotated set is cached.
    with pytest.raises(OIDCTokenInvalidError, match="no JWK"):
        await client.verify_token(issuer.mint("k1"))


@pytest.mark.asyncio
async def test_unknown_kid_refetches_are_rate_limited(issuer: LocalIssuer) -> None:
    client = OIDCIssuerClient(_provider())
    issuer.add_rsa_key("never-published", publish=False)
    for _ in range(5):
        with pytest.raises(OIDCTokenInvalidError):
            await client.verify_token(issuer.mint("never-published"))
    assert issuer.jwks_hits() == 2, "cold fetch + one forced refetch, not five"


@pytest.mark.asyncio
async def test_metadata_is_refetched_after_the_ttl(issuer: LocalIssuer) -> None:
    clock = {"now": 1000.0}
    client = OIDCIssuerClient(
        _provider(), metadata_ttl_s=300, clock=lambda: clock["now"]
    )
    token = issuer.mint("k1")

    await client.verify_token(token)
    clock["now"] += 299
    await client.verify_token(token)
    assert issuer.jwks_hits() == 1

    clock["now"] += 2
    await client.verify_token(token)
    await _settle(client)
    assert issuer.jwks_hits() == 2


@pytest.mark.asyncio
async def test_failed_ttl_refresh_keeps_serving_the_cached_keys(
    issuer: LocalIssuer,
) -> None:
    clock = {"now": 1000.0}
    client = OIDCIssuerClient(
        _provider(), metadata_ttl_s=300, clock=lambda: clock["now"]
    )
    token = issuer.mint("k1")
    await client.verify_token(token)

    issuer.down = True
    clock["now"] += 301
    claims = await client.verify_token(token)
    assert claims["iss"] == _ISSUER, "a transient outage must not log everyone out"


@pytest.mark.asyncio
async def test_concurrent_cold_start_fetches_once(issuer: LocalIssuer) -> None:
    issuer.delay = 0.1
    client = OIDCIssuerClient(_provider())
    token = issuer.mint("k1")
    results = await asyncio.gather(*(client.verify_token(token) for _ in range(20)))
    assert len(results) == 20
    assert issuer.discovery_hits() == 1
    assert issuer.jwks_hits() == 1


@pytest.mark.asyncio
async def test_stale_keys_are_served_while_one_refresh_runs(
    issuer: LocalIssuer,
) -> None:
    """Past the TTL nobody waits on the refresh: stale keys answer at once and
    one background refresh replaces them."""
    clock = {"now": 1000.0}
    client = OIDCIssuerClient(
        _provider(), metadata_ttl_s=300, clock=lambda: clock["now"]
    )
    token = issuer.mint("k1")
    await client.verify_token(token)

    issuer.delay = 0.5
    clock["now"] += 301
    started = time.perf_counter()
    results = await asyncio.gather(*(client.verify_token(token) for _ in range(10)))
    elapsed = time.perf_counter() - started
    assert all(r["iss"] == _ISSUER for r in results)
    assert elapsed < 0.3, f"a request waited on the TTL refresh ({elapsed:.2f}s)"

    await _settle(client)
    assert issuer.jwks_hits() == 2, "exactly one background refresh"
    assert issuer.discovery_hits() == 2


@pytest.mark.asyncio
async def test_outage_past_ttl_is_single_flight_and_backs_off(
    issuer: LocalIssuer,
) -> None:
    """Many requests past the TTL with the issuer down: ONE fetch attempt, no
    stall, cached keys served, and no re-dial until the back-off ends."""
    clock = {"now": 1000.0}
    client = OIDCIssuerClient(
        _provider(), metadata_ttl_s=300, clock=lambda: clock["now"]
    )
    token = issuer.mint("k1")
    await client.verify_token(token)
    fetched = len(issuer.requests)

    issuer.down = True
    issuer.delay = 0.25
    clock["now"] += 301
    started = time.perf_counter()
    results = await asyncio.gather(*(client.verify_token(token) for _ in range(20)))
    elapsed = time.perf_counter() - started
    await _settle(client)

    assert all(r["iss"] == _ISSUER for r in results)
    assert len(issuer.requests) - fetched == 1, "one shared attempt, not one each"
    assert elapsed < 0.2, f"requests waited on the failing refresh ({elapsed:.2f}s)"

    clock["now"] += 10
    for _ in range(10):
        await client.verify_token(token)
    await _settle(client)
    assert len(issuer.requests) - fetched == 1, "no re-dial inside the back-off"

    clock["now"] += _FAILURE_BACKOFF_S
    await client.verify_token(token)
    await _settle(client)
    assert len(issuer.requests) - fetched == 2, "one retry once the back-off ends"


def test_a_refresh_task_from_another_loop_is_not_awaited(issuer: LocalIssuer) -> None:
    """A slot left holding a task of a closed loop is discarded, not awaited
    (awaiting it from another loop would raise or hang)."""
    client = OIDCIssuerClient(_provider())
    other = asyncio.new_event_loop()
    orphan = other.create_task(asyncio.sleep(3600))
    orphan.cancel()
    other.run_until_complete(asyncio.gather(orphan, return_exceptions=True))
    other.close()
    client._inflight = orphan  # type: ignore[assignment]

    async def verify() -> dict[str, Any]:
        return await asyncio.wait_for(client.verify_token(issuer.mint("k1")), 2)

    assert asyncio.run(verify())["iss"] == _ISSUER


@pytest.mark.asyncio
async def test_cold_start_outage_is_single_flight_and_backs_off(
    issuer: LocalIssuer,
) -> None:
    clock = {"now": 1000.0}
    client = OIDCIssuerClient(_provider(), clock=lambda: clock["now"])
    token = issuer.mint("k1")
    issuer.down = True
    issuer.delay = 0.25

    started = time.perf_counter()
    results = await asyncio.gather(
        *(client.verify_token(token) for _ in range(20)), return_exceptions=True
    )
    elapsed = time.perf_counter() - started
    assert all(isinstance(r, OIDCJWKSUnavailableError) for r in results)
    assert len(issuer.requests) == 1
    assert elapsed < 1.5, f"requests queued behind serial fetches ({elapsed:.2f}s)"

    # Inside the back-off: fail closed at once, without dialling.
    clock["now"] += 5
    with pytest.raises(OIDCJWKSUnavailableError, match="backing off"):
        await client.verify_token(token)
    assert len(issuer.requests) == 1

    # Issuer back, back-off over: recovers.
    issuer.down = False
    issuer.delay = 0.0
    clock["now"] += _FAILURE_BACKOFF_S
    assert (await client.verify_token(token))["iss"] == _ISSUER


# ---------------------------------------------------------------------------
# Multiple issuers
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tokens_are_routed_to_their_own_issuer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a = LocalIssuer("https://a.example.test")
    b = LocalIssuer("https://b.example.test")
    a.add_rsa_key("shared-kid")
    b.add_rsa_key("shared-kid")  # same kid at both issuers, different keys
    _route(monkeypatch, a, b)
    verifier = OIDCVerifier(
        [
            OIDCIssuerClient(_provider(a.issuer)),
            OIDCIssuerClient(_provider(b.issuer, kind="cognito")),
        ]
    )

    assert (await verifier.verify_token(a.mint("shared-kid"))).provider.kind == "oidc"
    assert (
        await verifier.verify_token(b.mint("shared-kid"))
    ).provider.kind == "cognito"

    # A token CLAIMING issuer b but signed with issuer a's key is refused.
    forged = pyjwt.encode(
        a.claims(iss=b.issuer),
        a._keys["shared-kid"][0],
        algorithm="RS256",
        headers={"kid": "shared-kid"},
    )
    with pytest.raises(OIDCTokenInvalidError, match="verification failed"):
        await verifier.verify_token(forged)


def test_verifier_exposes_the_cognito_client() -> None:
    oidc = OIDCIssuerClient(_provider())
    cognito = OIDCIssuerClient(_provider("https://c.example.test", kind="cognito"))
    assert OIDCVerifier([oidc, cognito]).cognito_client is cognito
    assert OIDCVerifier([oidc]).cognito_client is None
    assert not OIDCVerifier([]).configured


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


def test_oidc_providers_parse_from_env_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "OIDC_PROVIDERS",
        json.dumps(
            [
                {
                    "issuer": "https://login.example.test/tenant/v2.0/",
                    "audiences": ["app-1", " app-2 "],
                    "groups_claim": "realm_access.roles",
                }
            ]
        ),
    )
    cfg = _settings()
    (provider,) = cfg.OIDC_PROVIDERS
    assert provider.issuer == "https://login.example.test/tenant/v2.0"
    assert provider.audiences == ["app-1", "app-2"]
    assert provider.audience_claims == ["aud"]
    assert provider.groups_claim == "realm_access.roles"


@pytest.mark.parametrize(
    "entry",
    [
        {"issuer": "https://idp.example.test", "audiences": []},
        {"issuer": "https://idp.example.test", "audiences": ["  "]},
        {"issuer": "https://idp.example.test"},
        {"issuer": "http://idp.example.test", "audiences": ["a"]},
        {"issuer": "idp.example.test", "audiences": ["a"]},
    ],
    ids=["empty-aud", "blank-aud", "no-aud", "plain-http", "not-a-url"],
)
def test_invalid_provider_entries_are_refused(entry: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        _settings(OIDC_PROVIDERS=[entry])


def test_duplicate_issuers_are_refused() -> None:
    entry = {"issuer": "https://idp.example.test", "audiences": ["a"]}
    with pytest.raises(ValidationError, match="more than once"):
        _settings(OIDC_PROVIDERS=[entry, entry])
    with pytest.raises(ValidationError, match="more than once"):
        _settings(
            COGNITO_ISSUER="https://idp.example.test",
            OIDC_PROVIDERS=[entry],
        )
    # Compared in routing form: whitespace / trailing slash do not hide it.
    with pytest.raises(ValidationError, match="more than once"):
        _settings(
            COGNITO_ISSUER="  https://idp.example.test/  ",
            OIDC_PROVIDERS=[entry],
        )


def test_a_loopback_oidc_issuer_cannot_boot_in_production() -> None:
    local = {"issuer": "http://127.0.0.1:8771", "audiences": ["a"]}
    with pytest.raises(ValidationError, match="loopback"):
        _settings(ENVIRONMENT="production", OIDC_PROVIDERS=[local])
    # Under development it is allowed, against an isolated database.
    cfg = _settings(ENVIRONMENT="development", OIDC_PROVIDERS=[local])
    assert cfg.loopback_oidc_issuers == ["http://127.0.0.1:8771"]


def test_a_loopback_oidc_issuer_refuses_the_shared_dev_database() -> None:
    local = {"issuer": "http://127.0.0.1:8771", "audiences": ["a"]}
    with pytest.raises(ValidationError, match="ISOLATED database"):
        Settings(
            _env_file=None,
            DATABASE_URL="postgresql://user:pass@localhost/qontinui_db",
            ENVIRONMENT="development",
            OIDC_PROVIDERS=[local],
        )
