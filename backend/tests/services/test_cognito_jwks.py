"""Tests for ``app.services.cognito_jwks`` — Cognito user-pool JWT verifier.

Strategy mirrors ``tests/services/test_coord_jwks.py``: mint an RS256
JWT in-process with a fresh RSA keypair, serialize the public side into
a Cognito-shaped JWKS, stub ``CognitoJWKSClient._fetch_jwks`` to return
it, then exercise ``verify_token``. No live Cognito / network required.

Covers the four verification gates: signature, issuer, audience
(``aud`` for ID tokens / ``client_id`` for access tokens), and expiry,
plus the kid-miss forced-refresh path and the process-lifetime cache.
"""

from __future__ import annotations

import time
from typing import Any

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.services.cognito_jwks import (
    _MAX_KID_CHARS,
    CognitoJWKSClient,
    CognitoTokenInvalidError,
)

_ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_rgTB9dbZ1"
_WEB_CLIENT = "q6ns1a8bokf2np1mj8v8arl31"
_RUNNER_CLIENT = "67f2a1a0cmgileob23lniud5t7"
_KID = "cognito-rsa-test-1"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _rsa_keypair(kid: str = _KID) -> tuple[rsa.RSAPrivateKey, dict[str, Any]]:
    """Mint an RSA keypair + return (private, Cognito-shaped JWK-public)."""
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    # PyJWK can serialize a public key to a JWK dict via algorithm helpers.
    from jwt.algorithms import RSAAlgorithm

    jwk_json = RSAAlgorithm.to_jwk(private.public_key())
    import json

    jwk = json.loads(jwk_json)
    jwk.update({"kid": kid, "use": "sig", "alg": "RS256"})
    return private, jwk


def _mint(
    private: rsa.RSAPrivateKey,
    claims: dict[str, Any],
    *,
    kid: str = _KID,
) -> str:
    headers = {"typ": "JWT"}
    if kid is not None:
        headers["kid"] = kid
    return pyjwt.encode(claims, private, algorithm="RS256", headers=headers)


def _id_token_claims(*, exp_in: int = 3600, aud: str = _WEB_CLIENT) -> dict[str, Any]:
    now = int(time.time())
    return {
        "iss": _ISSUER,
        "sub": "11111111-2222-3333-4444-555555555555",
        "aud": aud,
        "token_use": "id",
        "email": "user@example.com",
        "email_verified": True,
        "iat": now,
        "exp": now + exp_in,
    }


def _access_token_claims(
    *, exp_in: int = 3600, client_id: str = _WEB_CLIENT
) -> dict[str, Any]:
    now = int(time.time())
    return {
        "iss": _ISSUER,
        "sub": "11111111-2222-3333-4444-555555555555",
        "client_id": client_id,
        "token_use": "access",
        "iat": now,
        "exp": now + exp_in,
    }


class _FakeClient(CognitoJWKSClient):
    """Bypass the HTTP fetch — use a pre-baked JWKS in-process."""

    def __init__(self, jwks: dict[str, Any], **kw: Any) -> None:
        super().__init__(
            issuer=_ISSUER,
            allowed_audiences=[_WEB_CLIENT, _RUNNER_CLIENT],
            **kw,
        )
        self._baked = jwks
        self.fetch_count = 0

    async def _fetch_jwks(self) -> dict[str, Any]:
        self.fetch_count += 1
        return self._baked


# ---------------------------------------------------------------------------
# Success paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verify_id_token_succeeds() -> None:
    private, jwk = _rsa_keypair()
    client = _FakeClient({"keys": [jwk]})

    claims = await client.verify_token(_mint(private, _id_token_claims()))

    assert claims["iss"] == _ISSUER
    assert claims["aud"] == _WEB_CLIENT
    assert claims["email"] == "user@example.com"


@pytest.mark.asyncio
async def test_verify_access_token_uses_client_id_audience() -> None:
    """Access tokens carry the app-client id in ``client_id`` (no ``aud``)."""
    private, jwk = _rsa_keypair()
    client = _FakeClient({"keys": [jwk]})

    claims = await client.verify_token(_mint(private, _access_token_claims()))

    assert claims["client_id"] == _WEB_CLIENT
    assert "aud" not in claims


@pytest.mark.asyncio
async def test_verify_accepts_secondary_audience() -> None:
    """A token for the runner app-client (in the allowed set) is accepted."""
    private, jwk = _rsa_keypair()
    client = _FakeClient({"keys": [jwk]})

    claims = await client.verify_token(
        _mint(private, _id_token_claims(aud=_RUNNER_CLIENT))
    )
    assert claims["aud"] == _RUNNER_CLIENT


# ---------------------------------------------------------------------------
# Failure paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verify_wrong_audience_rejected() -> None:
    private, jwk = _rsa_keypair()
    client = _FakeClient({"keys": [jwk]})

    token = _mint(private, _id_token_claims(aud="some-other-client"))
    with pytest.raises(CognitoTokenInvalidError) as exc:
        await client.verify_token(token)
    assert "audience" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_verify_wrong_issuer_rejected() -> None:
    private, jwk = _rsa_keypair()
    client = _FakeClient({"keys": [jwk]})

    claims = _id_token_claims()
    claims["iss"] = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OTHER"
    with pytest.raises(CognitoTokenInvalidError):
        await client.verify_token(_mint(private, claims))


@pytest.mark.asyncio
async def test_verify_expired_token_rejected() -> None:
    private, jwk = _rsa_keypair()
    client = _FakeClient({"keys": [jwk]})

    now = int(time.time())
    claims = _id_token_claims()
    claims["iat"] = now - 3600
    claims["exp"] = now - 600  # 10 min ago, outside leeway
    with pytest.raises(CognitoTokenInvalidError) as exc:
        await client.verify_token(_mint(private, claims))
    assert "expired" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_verify_wrong_signature_rejected() -> None:
    """Token signed by a key NOT in the JWKS is rejected."""
    minter, _ = _rsa_keypair()
    _, jwk_in_set = _rsa_keypair(kid=_KID)  # same kid, different key
    client = _FakeClient({"keys": [jwk_in_set]})

    with pytest.raises(CognitoTokenInvalidError) as exc:
        await client.verify_token(_mint(minter, _id_token_claims()))
    assert "verification failed" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_verify_missing_kid_rejected() -> None:
    private, jwk = _rsa_keypair()
    client = _FakeClient({"keys": [jwk]})

    token = pyjwt.encode(
        _id_token_claims(), private, algorithm="RS256", headers={"typ": "JWT"}
    )
    with pytest.raises(CognitoTokenInvalidError) as exc:
        await client.verify_token(token)
    assert "kid" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_verify_malformed_token_rejected() -> None:
    private, jwk = _rsa_keypair()
    client = _FakeClient({"keys": [jwk]})
    with pytest.raises(CognitoTokenInvalidError):
        await client.verify_token("not-a-jwt")


# ---------------------------------------------------------------------------
# JWKS cache discipline
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jwks_cached_for_process_lifetime() -> None:
    """Multiple verifies fetch the JWKS exactly once (no TTL refetch)."""
    private, jwk = _rsa_keypair()
    client = _FakeClient({"keys": [jwk]})

    token = _mint(private, _id_token_claims())
    await client.verify_token(token)
    await client.verify_token(token)
    await client.verify_token(token)

    assert client.fetch_count == 1


@pytest.mark.asyncio
async def test_kid_miss_forces_one_refresh() -> None:
    """A token whose kid is absent triggers a single forced re-fetch.

    Simulates Cognito key rotation: the cache holds an old key, the token
    is signed with a new key, and the forced refetch returns the new set.
    """
    new_private, new_jwk = _rsa_keypair(kid="rotated-key")
    _, old_jwk = _rsa_keypair(kid="old-key")

    sets = [{"keys": [old_jwk]}, {"keys": [old_jwk, new_jwk]}]

    class _RotatingClient(CognitoJWKSClient):
        def __init__(self) -> None:
            super().__init__(issuer=_ISSUER, allowed_audiences=[_WEB_CLIENT])
            self.fetch_count = 0

        async def _fetch_jwks(self) -> dict[str, Any]:
            idx = min(self.fetch_count, len(sets) - 1)
            self.fetch_count += 1
            return sets[idx]

    client = _RotatingClient()
    token = _mint(new_private, _id_token_claims(), kid="rotated-key")
    claims = await client.verify_token(token)

    assert claims["iss"] == _ISSUER
    assert client.fetch_count == 2  # cold fetch (miss) + forced refresh


@pytest.mark.asyncio
async def test_unknown_kid_after_refresh_rejected() -> None:
    """A kid still absent after the forced refresh → reject."""
    private, jwk = _rsa_keypair(kid="present")
    client = _FakeClient({"keys": [jwk]})

    token = _mint(private, _id_token_claims(), kid="never-present")
    with pytest.raises(CognitoTokenInvalidError) as exc:
        await client.verify_token(token)
    assert "never-present" in str(exc.value) or "no jwk" in str(exc.value).lower()
    # Cold fetch + one forced refresh = 2.
    assert client.fetch_count == 2


@pytest.mark.asyncio
async def test_unknown_kid_is_capped_before_it_reaches_the_message() -> None:
    """The rejection message must not carry an unbounded caller-chosen kid.

    `kid` is read from an UNVERIFIED header on a PRE-AUTH path, and the
    unknown-kid message is logged verbatim by
    ``cognito_user.verify_cognito_token_and_resolve_user`` at WARNING. Without
    a cap the caller picks both the content and the size of a log write and
    can repeat it at will — an amplifier, not merely noise.

    The sibling ``coord_jwks`` already caps at ``_MAX_KID_CHARS`` for exactly
    this reason; this pins that the Cognito door does too. Asserting on the
    message rather than on the constant is deliberate: the message is the
    thing that reaches the log, so a cap applied after formatting would still
    fail here.
    """
    private, jwk = _rsa_keypair(kid="present")
    client = _FakeClient({"keys": [jwk]})

    oversized = "A" * (_MAX_KID_CHARS * 20)
    token = _mint(private, _id_token_claims(), kid=oversized)

    with pytest.raises(CognitoTokenInvalidError) as exc:
        await client.verify_token(token)

    message = str(exc.value)
    assert oversized not in message
    # The truncated prefix is still present, so the message stays useful for
    # diagnosing a real rotation miss.
    assert "A" * _MAX_KID_CHARS in message
    assert "A" * (_MAX_KID_CHARS + 1) not in message


@pytest.mark.asyncio
async def test_forced_refetch_is_rate_limited() -> None:
    """`kid` is attacker-controlled, so a miss must not drive a fetch each time.

    It is read from an UNVERIFIED header on an unauthenticated path, so
    without a cooldown any caller could force one outbound Cognito
    round-trip per request — an amplification vector that also stalls
    every concurrent verification behind the client's lock for the
    duration of each fetch.

    Matches the throttle coord's `auth_sso::FORCED_REFRESH_COOLDOWN` and
    the sibling `coord_jwks` client already apply.
    """
    private, jwk = _rsa_keypair(kid="present")

    class _CountingClient(CognitoJWKSClient):
        def __init__(self) -> None:
            super().__init__(issuer=_ISSUER, allowed_audiences=[_WEB_CLIENT])
            self.fetch_count = 0

        async def _fetch_jwks(self) -> dict[str, Any]:
            self.fetch_count += 1
            return {"keys": [jwk]}

    client = _CountingClient()
    unknown = _mint(private, _id_token_claims(), kid="never-in-this-set")

    for _ in range(6):
        with pytest.raises(CognitoTokenInvalidError):
            await client.verify_token(unknown)

    # 1 cold fetch + exactly 1 forced refetch — not 6.
    assert client.fetch_count == 2, f"expected 2 fetches, got {client.fetch_count}"


@pytest.mark.asyncio
async def test_cooldown_does_not_block_the_cold_fetch_or_real_rotation() -> None:
    """Throttling must not disable recovery, only bound its rate.

    The cooldown is skipped entirely when there is no cache yet (a cold
    start must always fetch), and a zero window still absorbs a genuine
    key rotation on the next miss.
    """
    new_private, new_jwk = _rsa_keypair(kid="rotated-key")
    _, old_jwk = _rsa_keypair(kid="old-key")
    sets = [{"keys": [old_jwk]}, {"keys": [old_jwk, new_jwk]}]

    class _ZeroCooldownClient(CognitoJWKSClient):
        def __init__(self) -> None:
            super().__init__(issuer=_ISSUER, allowed_audiences=[_WEB_CLIENT])
            self.fetch_count = 0

        async def _fetch_jwks(self) -> dict[str, Any]:
            idx = min(self.fetch_count, len(sets) - 1)
            self.fetch_count += 1
            return sets[idx]

    client = _ZeroCooldownClient()
    # This used to pre-set ``client._forced_at = -1e9`` to force the window
    # open — a workaround for the ``0.0`` sentinel, which on a low-uptime host
    # read as "forced just now". With ``None`` meaning "never forced" the
    # first miss is unthrottled by construction, so the assertion below now
    # exercises the real path rather than one the test pre-arranged.
    token = _mint(new_private, _id_token_claims(), kid="rotated-key")

    assert (await client.verify_token(token))["iss"] == _ISSUER
    assert client.fetch_count == 2


@pytest.mark.asyncio
async def test_a_kid_miss_just_after_boot_is_not_read_as_a_recent_refetch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The "never forced yet" sentinel must not look like "forced just now".

    The cooldown is measured on ``time.monotonic``, whose origin is arbitrary
    and on both Linux and Windows sits near host boot. A ``0.0`` sentinel is
    safe only against a WALL-CLOCK stamp, where ``now - 0.0`` is ~1.8e9 and so
    outside every window; under ``monotonic`` it is legitimately a small
    number, so the FIRST kid miss on a low-uptime host read as "already
    refetched recently" and skipped the single forced re-fetch that recovers
    from a Cognito key rotation. Every such token is then rejected for an
    unknown ``kid`` — a valid credential, refused, for the whole cooldown.

    ``self._jwks is not None`` does not cover it: the cold fetch populates the
    cache without ever setting the forced stamp.

    Reverting ``_forced_at`` to ``0.0`` fails this test and passes the two
    throttle tests above; this one is therefore specific to that sentinel.

    The sibling ``coord_jwks`` client fixed the same sentinel when it moved to
    ``monotonic``. This door was already on ``monotonic``, so it had carried
    the defect from the start — which is why it needed its own pin.
    """
    new_private, new_jwk = _rsa_keypair(kid="rotated-key")
    _, old_jwk = _rsa_keypair(kid="old-key")
    sets = [{"keys": [old_jwk]}, {"keys": [old_jwk, new_jwk]}]

    class _RotatingClient(CognitoJWKSClient):
        def __init__(self) -> None:
            super().__init__(issuer=_ISSUER, allowed_audiences=[_WEB_CLIENT])
            self.fetch_count = 0

        async def _fetch_jwks(self) -> dict[str, Any]:
            idx = min(self.fetch_count, len(sets) - 1)
            self.fetch_count += 1
            return sets[idx]

    # Five seconds since boot — inside the 30s cooldown, which is the whole
    # point. Pinned rather than left to the host: on a long-uptime box
    # ``monotonic()`` is large enough that the `0.0` sentinel escapes the
    # window by luck, and the test would pass against the unfixed code.
    monkeypatch.setattr(time, "monotonic", lambda: 5.0)

    client = _RotatingClient()
    token = _mint(new_private, _id_token_claims(), kid="rotated-key")

    assert (await client.verify_token(token))["iss"] == _ISSUER, (
        "the first kid miss must force a re-fetch even moments after boot"
    )
    assert client.fetch_count == 2, (
        "cold fetch + one forced refresh; a suppressed forced refresh leaves 1"
    )
