"""Tests for ``app.services.coord_jwks`` — coord device-JWT verifier.

These tests pin the EdDSA / Ed25519 verification path against
regression. Prior to this work the verifier used ``python-jose``, which
does not support EdDSA (no entry in ``ALGORITHMS.SUPPORTED``); coord
mints Ed25519 device-tokens so every WS handshake was closed with
``1008 POLICY_VIOLATION`` after a ``JWKError: Unable to find an
algorithm for key`` raised inside ``jwt.decode``. The PyJWT rewrite
materializes the JWK via ``PyJWK`` and decodes via ``cryptography``'s
``Ed25519PublicKey`` backend.

Test strategy: mint a JWT in-process with a fresh Ed25519 keypair,
serialize the public side into a coord-shaped JWKS, stub
``CoordJWKSClient._fetch_jwks`` to return it, then exercise
``verify_token``. No live coord required.
"""

from __future__ import annotations

import base64
import time
from typing import Any

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)

from app.services.coord_jwks import (
    CoordJWKSClient,
    CoordTokenInvalidError,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _b64url_no_pad(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _ed25519_keypair() -> tuple[Ed25519PrivateKey, dict[str, Any]]:
    """Mint an Ed25519 keypair + return (private, JWK-public).

    The JWK shape mirrors what ``qontinui-coord/src/jwt.rs::jwks_json``
    emits in production: ``kty: OKP``, ``crv: Ed25519``, ``alg: EdDSA``,
    ``use: sig``, ``kid``, base64url-no-pad ``x``.
    """
    private = Ed25519PrivateKey.generate()
    public_bytes = private.public_key().public_bytes_raw()
    jwk = {
        "kty": "OKP",
        "crv": "Ed25519",
        "use": "sig",
        "alg": "EdDSA",
        "kid": "coord-ed25519-v1",
        "x": _b64url_no_pad(public_bytes),
    }
    return private, jwk


def _mint_jwt(private: Ed25519PrivateKey, claims: dict[str, Any]) -> str:
    """Mint an Ed25519 JWT with the canonical coord header shape."""
    return pyjwt.encode(
        claims,
        private,
        algorithm="EdDSA",
        headers={"kid": "coord-ed25519-v1", "typ": "JWT"},
    )


def _coord_claims(*, exp_in: int = 14400, iat_offset: int = 0) -> dict[str, Any]:
    """Build a claim-set in the shape coord's ``issue_device`` emits."""
    now = int(time.time())
    return {
        "iss": "qontinui-coord",
        "sub": "device:c79a07d5-7e40-49b4-87fa-554c749f9644",
        "sub_type": "device",
        "device_id": "c79a07d5-7e40-49b4-87fa-554c749f9644",
        "user_id": "301df86c-3e75-49f9-a667-c15d4cd2ec4b",
        "scopes": {
            "git_push": [],
            "git_read": [],
            "merge_propose": False,
            "build_submit": False,
            "strategy_admin": False,
            "nats_subjects_pub": [],
            "nats_subjects_sub": [],
        },
        "iat": now + iat_offset,
        "exp": now + iat_offset + exp_in,
        "jti": "0192f5d4-1234-7abc-9def-fedcba987654",
    }


class _FakeClient(CoordJWKSClient):
    """Bypass the HTTP fetch — use a pre-baked JWKS in-process."""

    def __init__(self, jwks: dict[str, Any]) -> None:
        super().__init__(coord_url="http://test")
        self._baked = jwks

    async def _fetch_jwks(self) -> dict[str, Any]:
        return self._baked


# ---------------------------------------------------------------------------
# Success paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verify_eddsa_token_succeeds() -> None:
    """The canonical coord-issued EdDSA token verifies cleanly.

    Regression guard: prior to the PyJWT rewrite, this raised
    ``JWKError: Unable to find an algorithm for key`` because python-jose
    has no EdDSA support.
    """
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})

    token = _mint_jwt(private, _coord_claims())
    claims = await client.verify_token(token)

    assert claims["iss"] == "qontinui-coord"
    assert claims["device_id"] == "c79a07d5-7e40-49b4-87fa-554c749f9644"
    assert claims["user_id"] == "301df86c-3e75-49f9-a667-c15d4cd2ec4b"
    assert claims["sub"] == "device:c79a07d5-7e40-49b4-87fa-554c749f9644"


@pytest.mark.asyncio
async def test_verify_iat_in_future_within_leeway_succeeds() -> None:
    """Clock-skew tolerance: a token issued ~5s in the future is accepted.

    Coord and web may run on different clocks; coord truncates ``iat``
    to whole seconds. The verifier carries a 30s leeway floor.
    """
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})

    token = _mint_jwt(private, _coord_claims(iat_offset=5))
    claims = await client.verify_token(token)

    assert claims["iss"] == "qontinui-coord"


# ---------------------------------------------------------------------------
# Failure paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verify_expired_token_rejected() -> None:
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})

    # iat=1h ago, exp=10min ago — definitely outside leeway.
    token = _mint_jwt(private, _coord_claims(iat_offset=-3600, exp_in=3000))

    with pytest.raises(CoordTokenInvalidError) as exc_info:
        await client.verify_token(token)
    assert "expired" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_verify_wrong_signature_rejected() -> None:
    """A token signed by a key NOT in the JWKS is rejected."""
    minter_private, _ = _ed25519_keypair()
    _, jwk_in_set = _ed25519_keypair()  # different keypair in the JWKS
    client = _FakeClient(jwks={"keys": [jwk_in_set]})

    token = _mint_jwt(minter_private, _coord_claims())

    with pytest.raises(CoordTokenInvalidError) as exc_info:
        await client.verify_token(token)
    assert "verification failed" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_verify_missing_kid_rejected() -> None:
    """A token without a ``kid`` header can't be matched to a JWK."""
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})

    token = pyjwt.encode(
        _coord_claims(),
        private,
        algorithm="EdDSA",
        headers={"typ": "JWT"},  # no kid
    )

    with pytest.raises(CoordTokenInvalidError) as exc_info:
        await client.verify_token(token)
    assert "kid" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_verify_unknown_kid_rejected() -> None:
    """A token with a ``kid`` not present in the JWKS is rejected."""
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})

    token = pyjwt.encode(
        _coord_claims(),
        private,
        algorithm="EdDSA",
        headers={"kid": "different-kid", "typ": "JWT"},
    )

    with pytest.raises(CoordTokenInvalidError) as exc_info:
        await client.verify_token(token)
    assert (
        "different-kid" in str(exc_info.value)
        or "no jwk" in str(exc_info.value).lower()
    )


@pytest.mark.asyncio
async def test_verify_malformed_token_rejected() -> None:
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})

    with pytest.raises(CoordTokenInvalidError):
        await client.verify_token("not-a-jwt")


# ---------------------------------------------------------------------------
# JWKS-cache discipline
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_jwks_cached_within_ttl() -> None:
    """Multiple verifies within TTL only fetch JWKS once."""
    private, jwk = _ed25519_keypair()

    fetch_count = 0

    class _CountingClient(CoordJWKSClient):
        def __init__(self) -> None:
            super().__init__(coord_url="http://test", ttl_s=3600)

        async def _fetch_jwks(self) -> dict[str, Any]:
            nonlocal fetch_count
            fetch_count += 1
            return {"keys": [jwk]}

    client = _CountingClient()
    token = _mint_jwt(private, _coord_claims())

    await client.verify_token(token)
    await client.verify_token(token)
    await client.verify_token(token)

    assert fetch_count == 1
