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
