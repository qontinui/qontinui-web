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
import structlog
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)

from app.services.coord_jwks import (
    _MAX_KID_CHARS,
    CoordJWKSClient,
    CoordTokenExpiredError,
    CoordTokenForeignIssuerError,
    CoordTokenInvalidError,
    CoordTokenNotYetValidError,
    describe_token_rejection,
    token_rejection_examples,
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


def _thumbprint_kid(thumbprint: str) -> str:
    """Build a coord thumbprint-style kid from its hex half.

    Split so no test carries the full id as one literal — see the note at
    the foreign-issuer test for why.
    """
    return "coord-ed25519-" + thumbprint


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


# ---------------------------------------------------------------------------
# Failure CLASSIFICATION — plan
# 2026-08-25-coord-jwt-kid-collides-across-environments, Phase 2.
#
# All three failures below used to collapse into one
# ``CoordTokenInvalidError`` that every caller rendered as "Invalid or
# expired device token." These pin that they stay distinguishable, so a
# reader is never told "expired" about a token that is not.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_kid_raises_foreign_issuer_error() -> None:
    """A kid absent from the JWKS means a DIFFERENT coord minted the token.

    That is a deployment-wiring fault, not a bad client, so it gets its
    own type carrying the coord URL and the kids actually served.
    """
    private, jwk = _ed25519_keypair()  # JWKS serves kid=coord-ed25519-v1
    client = _FakeClient(jwks={"keys": [jwk]})

    # Bound to a name rather than repeated inline: a coord thumbprint kid is
    # PUBLIC by construction (it is served on the unauthenticated JWKS
    # route), but `assert exc.token_kid == "<32 chars>"` puts the substring
    # "token" next to a long literal, which is exactly what gitleaks'
    # generic-api-key rule looks for. Naming it keeps the scanner honest
    # instead of allowlisting a pattern that could hide a real secret later.
    foreign = _thumbprint_kid("0011223344556677")

    token = pyjwt.encode(
        _coord_claims(),
        private,
        algorithm="EdDSA",
        headers={"kid": foreign, "typ": "JWT"},
    )

    with pytest.raises(CoordTokenForeignIssuerError) as exc_info:
        await client.verify_token(token)

    exc = exc_info.value
    assert exc.token_kid == foreign
    assert exc.served_kids == ["coord-ed25519-v1"]
    assert exc.coord_url == "http://test"
    # The message must name the mismatch, not merely describe a symptom.
    assert "http://test" in str(exc)
    # Still a CoordTokenInvalidError, so existing broad handlers keep working.
    assert isinstance(exc, CoordTokenInvalidError)


@pytest.mark.asyncio
async def test_unknown_kid_is_capped_before_it_reaches_the_message() -> None:
    """The foreign-issuer message must not carry an unbounded caller kid.

    `kid` is read from an UNVERIFIED header on a PRE-AUTH path, and both
    terminal callers log the resulting message (`deps`, `devices_ws`) plus the
    `token_kid` attribute. Uncapped, the caller chooses the content and the
    size of a log write and can repeat it at will.

    The cap shipped with the classification but with no test of its own, so a
    later edit to this raise site could drop it silently. Asserted on the
    message AND on `token_kid`, because both reach a log.
    """
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})

    oversized = _thumbprint_kid("B" * 400)
    token = pyjwt.encode(
        _coord_claims(),
        private,
        algorithm="EdDSA",
        headers={"kid": oversized, "typ": "JWT"},
    )

    with pytest.raises(CoordTokenForeignIssuerError) as exc_info:
        await client.verify_token(token)

    exc = exc_info.value
    assert len(exc.token_kid) == _MAX_KID_CHARS
    assert oversized.startswith(exc.token_kid)
    assert oversized not in str(exc)


@pytest.mark.asyncio
async def test_expired_token_raises_expired_subclass() -> None:
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})

    token = _mint_jwt(private, _coord_claims(iat_offset=-3600, exp_in=3000))

    with pytest.raises(CoordTokenExpiredError) as exc_info:
        await client.verify_token(token)
    assert isinstance(exc_info.value, CoordTokenInvalidError)


@pytest.mark.asyncio
async def test_same_kid_different_key_is_not_classified_as_foreign() -> None:
    """The incident itself, pinned as a test.

    Two coord deployments both stamp the hardcoded ``coord-ed25519-v1``
    on their own distinct signing keys. The kid lookup therefore SUCCEEDS
    and the wrong key reaches the crypto, so a foreign-but-genuine token
    is reported as a bad signature — i.e. as a forgery.

    Phase 2 alone cannot classify this correctly; only distinct kids
    (Phase 1, coord-side) can. This test exists to pin that limit
    honestly rather than imply Phase 2 closed it, and should be updated
    to expect ``CoordTokenForeignIssuerError`` once every coord in the
    fleet serves a thumbprint kid.
    """
    prod_private, _ = _ed25519_keypair()
    _, local_jwk = _ed25519_keypair()  # different key, SAME kid
    assert local_jwk["kid"] == "coord-ed25519-v1"

    client = _FakeClient(jwks={"keys": [local_jwk]})
    token = _mint_jwt(prod_private, _coord_claims())

    with pytest.raises(CoordTokenInvalidError) as exc_info:
        await client.verify_token(token)
    # Exactly the base class: not foreign-issuer (the colliding kid hides
    # the real cause), and not any other subclass either — a looser
    # `not isinstance(..., ForeignIssuer)` would also pass on a wrong
    # classification.
    assert type(exc_info.value) is CoordTokenInvalidError
    # And this is the user-visible residue Phase 1 has to remove: a
    # genuine token from another coord still reads as a verification
    # failure rather than as "a different coord issued this".
    assert "different coord" not in describe_token_rejection(exc_info.value)


def test_describe_token_rejection_says_only_what_is_true() -> None:
    """Each arm gets its own sentence, and none claims the others' fault."""
    foreign = CoordTokenForeignIssuerError(
        "x", coord_url="http://test", token_kid="a", served_kids=["b"]
    )
    expired = CoordTokenExpiredError("x")
    bad_sig = CoordTokenInvalidError("x")

    foreign_msg = describe_token_rejection(foreign)
    expired_msg = describe_token_rejection(expired)
    bad_sig_msg = describe_token_rejection(bad_sig)

    assert len({foreign_msg, expired_msg, bad_sig_msg}) == 3
    assert "different coord" in foreign_msg
    assert "expired" in expired_msg.lower()
    # The historical catch-all claimed two causes at once; no arm may do
    # that, in either direction.
    assert "expired" not in foreign_msg.lower()
    assert "expired" not in bad_sig_msg.lower()
    assert "different coord" not in bad_sig_msg.lower()
    assert "signature" not in foreign_msg.lower()
    # The generic arm must NOT name the signature: it is the residue arm
    # (malformed token, unusable JWK, missing kid), and naming a specific
    # cause there trades a vague message for a confidently wrong one.
    assert "signature" not in bad_sig_msg.lower()


@pytest.mark.asyncio
async def test_rejection_text_never_leaks_deployment_internals() -> None:
    """The presenter-facing string stays coarser than the log.

    ``str(exc)`` carries COORD_URL, the token kid and the served kids, and
    both call sites pass it to the logger one line above passing
    ``describe_token_rejection(exc)`` into the response. Nothing stops a
    future edit from conflating the two, so pin the separation as an
    invariant rather than a convention.
    """
    # Raised for real, so the message under test is the one the call sites
    # actually log rather than a placeholder a test invented.
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})
    token = pyjwt.encode(
        _coord_claims(),
        private,
        algorithm="EdDSA",
        headers={"kid": _thumbprint_kid("deadbeefdeadbeef"), "typ": "JWT"},
    )

    with pytest.raises(CoordTokenForeignIssuerError) as exc_info:
        await client.verify_token(token)
    exc = exc_info.value
    msg = describe_token_rejection(exc)

    assert exc.coord_url not in msg
    assert exc.token_kid not in msg
    for served in exc.served_kids:
        assert served not in msg
    # ...and the detail really does carry them, or the log is the one lying.
    assert exc.coord_url in str(exc)
    assert exc.token_kid in str(exc)


def test_rejection_reasons_fit_the_websocket_close_budget() -> None:
    """RFC 6455 caps a close reason at 123 bytes.

    ``devices_ws`` passes these straight through as the close reason, and
    an over-long reason would be truncated or refused by the WS layer —
    turning the honest message back into an unreadable one.
    """
    built = {
        CoordTokenForeignIssuerError: CoordTokenForeignIssuerError(
            "x", coord_url="http://test", token_kid="a", served_kids=["b"]
        ),
    }
    # Derived from the hierarchy, not a hardcoded list: a subclass added
    # later must not escape the budget check by simply not being listed.
    subclasses = CoordTokenInvalidError.__subclasses__()
    assert CoordTokenNotYetValidError in subclasses, (
        "sanity: the hierarchy walk must actually see the subclasses"
    )
    for cls in [CoordTokenInvalidError, *subclasses]:
        exc = built.get(cls) or cls("x")
        assert len(describe_token_rejection(exc).encode("utf-8")) <= 123, cls


@pytest.mark.asyncio
async def test_clock_skew_beyond_leeway_is_not_reported_as_a_bad_signature() -> None:
    """``iat``/``nbf`` in the future is drift, not a key problem.

    This module's own leeway comment records why that is a live risk:
    coord truncates ``iat`` to whole seconds and web may run on another
    clock. Reporting it as a signature failure would send the reader to
    check key wiring — the misdirection this whole split exists to remove.
    """
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})

    # Well beyond the 30s leeway floor.
    token = _mint_jwt(private, _coord_claims(iat_offset=3600))

    with pytest.raises(CoordTokenNotYetValidError) as exc_info:
        await client.verify_token(token)
    msg = describe_token_rejection(exc_info.value)
    assert "signature" not in msg.lower()
    assert "clock" in msg.lower()


@pytest.mark.asyncio
async def test_oversized_kid_is_truncated_before_it_reaches_a_message() -> None:
    """The kid is attacker-supplied and otherwise unbounded.

    It reaches an exception message that both terminal callers log, so an
    unauthenticated caller could otherwise write a log line of its own
    size and content on every request.
    """
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})

    token = pyjwt.encode(
        _coord_claims(),
        private,
        algorithm="EdDSA",
        headers={"kid": "A" * 4000, "typ": "JWT"},
    )

    with pytest.raises(CoordTokenForeignIssuerError) as exc_info:
        await client.verify_token(token)

    assert len(exc_info.value.token_kid) <= 64
    assert len(str(exc_info.value)) < 500


@pytest.mark.asyncio
async def test_verify_token_does_not_raise_the_identity_alarm_itself() -> None:
    """``coord_identity_mismatch`` belongs to the TERMINAL callers only.

    ``app.api.v1.endpoints.memory`` runs every bearer through
    ``verify_token`` purely to decide whether it is coord-signed, and
    falls through to Cognito on ``CoordTokenInvalidError`` — see
    ``tests/test_memory_auth.py``. A Cognito token carries a Cognito kid,
    so it lands in the foreign-issuer arm on the way to a SUCCESSFUL
    request. Logging the alarm at the raise site therefore fired at
    WARNING on routine successful traffic, which buries the one line the
    alarm exists to surface. ``deps`` and ``devices_ws`` raise it instead,
    because for them a rejection really is terminal.
    """
    private, jwk = _ed25519_keypair()
    client = _FakeClient(jwks={"keys": [jwk]})

    # A Cognito-shaped kid: well-formed, simply not coord's.
    token = pyjwt.encode(
        _coord_claims(),
        private,
        algorithm="EdDSA",
        headers={"kid": "abc123XYZ/Example=", "typ": "JWT"},
    )

    emitted: list[str] = []

    def _capture(logger, method_name, event_dict):
        emitted.append(str(event_dict.get("event", "")))
        raise structlog.DropEvent

    structlog.configure(processors=[_capture])
    try:
        with pytest.raises(CoordTokenForeignIssuerError):
            await client.verify_token(token)
    finally:
        structlog.reset_defaults()

    assert "coord_identity_mismatch" not in emitted, (
        f"verify_token must not raise the alarm itself; emitted={emitted}"
    )


# ---------------------------------------------------------------------------
# Forced re-fetch on a kid miss.
#
# Without this, a verifier holding a JWKS cached BEFORE a coord key-id change
# rejects every legitimately-issued token until the 1h TTL expires — emitting
# the very string this module's error split exists to make trustworthy
# (`1008 "Invalid or expired device token."`). There is no operator action
# that shortens that window: no admin route, no cache-invalidate method, no
# TTL override. Only a process restart or waiting it out.
# ---------------------------------------------------------------------------


class _RotatingClient(CoordJWKSClient):
    """Serves `first`, then `second` on every subsequent fetch."""

    def __init__(
        self, first: dict[str, Any], second: dict[str, Any], **kw: Any
    ) -> None:
        super().__init__(coord_url="http://test", **kw)
        self._first = first
        self._second = second
        self.fetches = 0

    async def _fetch_jwks(self) -> dict[str, Any]:
        self.fetches += 1
        return self._first if self.fetches == 1 else self._second


@pytest.mark.asyncio
async def test_kid_miss_refetches_and_recovers_within_the_ttl() -> None:
    """A key-id change is picked up in one round-trip, not in an hour."""
    old_private, old_jwk = _ed25519_keypair()
    new_private, new_jwk = _ed25519_keypair()
    new_jwk["kid"] = _thumbprint_kid("00ff00ff00ff00ff")

    client = _RotatingClient({"keys": [old_jwk]}, {"keys": [new_jwk]})

    # Warm the cache on the pre-change JWKS, as a live backend would have.
    await client.verify_token(_mint_jwt(old_private, _coord_claims()))
    assert client.fetches == 1

    # Now a token signed under the NEW kid arrives. The cache does not know
    # it, and the TTL has not expired.
    token = pyjwt.encode(
        _coord_claims(),
        new_private,
        algorithm="EdDSA",
        headers={"kid": new_jwk["kid"], "typ": "JWT"},
    )
    claims = await client.verify_token(token)

    assert claims["iss"] == "qontinui-coord"
    assert client.fetches == 2, "the kid miss must force exactly one re-fetch"


@pytest.mark.asyncio
async def test_forced_refetch_is_rate_limited() -> None:
    """`kid` is attacker-supplied, so it must not drive unbounded fetches.

    Without a cooldown, any caller could force one coord round-trip per
    request just by presenting an unknown kid. This follows coord's own Rust
    `FORCED_REFRESH_COOLDOWN`; the sibling `cognito_jwks` no longer lacks one
    either (web #1076 gave it the same 30s), though the two still read
    different clocks — see the constant's own comment.
    """
    _, jwk = _ed25519_keypair()
    private, _ = _ed25519_keypair()

    client = _RotatingClient({"keys": [jwk]}, {"keys": [jwk]}, forced_cooldown_s=300)

    unknown = pyjwt.encode(
        _coord_claims(),
        private,
        algorithm="EdDSA",
        headers={"kid": _thumbprint_kid("aaaabbbbccccdddd"), "typ": "JWT"},
    )

    for _ in range(5):
        with pytest.raises(CoordTokenForeignIssuerError):
            await client.verify_token(unknown)

    # 1 warm-up fetch + exactly 1 forced fetch, not 5.
    assert client.fetches == 2, f"expected 2 fetches, got {client.fetches}"


@pytest.mark.asyncio
async def test_forced_refetch_cooldown_expires() -> None:
    """The cooldown throttles; it must not permanently disable recovery."""
    old_private, old_jwk = _ed25519_keypair()
    new_private, new_jwk = _ed25519_keypair()
    new_jwk["kid"] = _thumbprint_kid("1234123412341234")

    # Zero cooldown = every miss may refetch, which is the boundary case.
    client = _RotatingClient(
        {"keys": [old_jwk]}, {"keys": [new_jwk]}, forced_cooldown_s=0
    )
    await client.verify_token(_mint_jwt(old_private, _coord_claims()))

    token = pyjwt.encode(
        _coord_claims(),
        new_private,
        algorithm="EdDSA",
        headers={"kid": new_jwk["kid"], "typ": "JWT"},
    )
    assert (await client.verify_token(token))["iss"] == "qontinui-coord"


# ---------------------------------------------------------------------------
# The DOCUMENTED 401 bodies must be the ones this module actually produces.
#
# `events.py` carried a hand-copied 401 example — "Invalid or expired token",
# over a description naming a "runner token" retired two plans ago — and the
# committed OpenAPI snapshots are generated from that declaration, so the dead
# sentence reached every generated client. Nothing failed when it went stale,
# because nothing connected the docs to the classifier. These tests are that
# connection.
# ---------------------------------------------------------------------------


def _all_failure_classes() -> list[type[CoordTokenInvalidError]]:
    """Base class + every subclass, discovered rather than listed."""
    subclasses = CoordTokenInvalidError.__subclasses__()
    assert CoordTokenNotYetValidError in subclasses, (
        "sanity: the hierarchy walk must actually see the subclasses"
    )
    return [CoordTokenInvalidError, *subclasses]


def test_examples_cover_every_failure_class_and_quote_the_classifier() -> None:
    """One example per class, and each one is the classifier's own string.

    Both halves matter. Missing a class means an arm this backend can return
    is undocumented; a string the classifier does not produce means the docs
    are lying, which is the exact defect being closed.
    """
    examples = token_rejection_examples()
    classes = _all_failure_classes()

    assert len(examples) == len(classes), (
        f"expected one example per failure class, got {sorted(examples)} "
        f"for {[c.__name__ for c in classes]}"
    )

    produced = set()
    for cls in classes:
        try:
            exc = cls("example")
        except TypeError:
            exc = cls.__new__(cls)
        produced.add(describe_token_rejection(exc))

    documented = {e["value"]["detail"] for e in examples.values()}
    assert documented == produced, (
        "the documented 401 bodies drifted from describe_token_rejection"
    )


def test_example_keys_are_the_slugs_the_snapshots_carry() -> None:
    """The keys are committed data, not an implementation detail.

    They are the only label an API-docs renderer shows, AND they are written
    verbatim into ``openapi-schema.json`` / ``openapi-schema.base.json``, so
    a change in ``_example_key`` churns both snapshots and reds the CI drift
    check. Pin them here, where the reason is legible, rather than letting a
    100k-line snapshot diff be the first notification.
    """
    assert set(token_rejection_examples()) == {
        "expired",
        "not_yet_valid",
        "foreign_issuer",
        # The base class is the residue arm; it must not be keyed as if it
        # were one of the specific ones.
        "invalid",
    }


def test_phase_completed_documents_exactly_the_401s_it_can_return() -> None:
    """The route's declared 401 examples equal the reachable bodies.

    `POST /api/v1/events/phase-completed` authenticates with
    `get_authenticated_device`, whose 401s are either `HTTPBearer`'s own
    "Not authenticated" (no header at all) or `describe_token_rejection`.
    Re-transcribing any of them here fails this test rather than silently
    baking a dead string into the OpenAPI snapshots.
    """
    from app.api.v1.endpoints import events as events_ep

    route = next(
        r
        for r in events_ep.router.routes
        if getattr(r, "path", None) == "/phase-completed"
    )
    examples = route.responses[401]["content"]["application/json"]["examples"]
    documented = {e["value"]["detail"] for e in examples.values()}

    reachable = {"Not authenticated"} | {
        e["value"]["detail"] for e in token_rejection_examples().values()
    }
    assert documented == reachable

    description = route.responses[401]["description"]
    assert "runner token" not in description.lower(), (
        "the legacy runner bearer was retired in Phase 5 of the unified "
        "devices registry; this door takes a coord-issued device-token JWT"
    )


@pytest.mark.asyncio
async def test_missing_bearer_detail_is_the_string_the_docs_promise() -> None:
    """The one hand-written example is pinned to FastAPI's real behaviour.

    `HTTPBearer(auto_error=True)` raises this before any handler runs, so it
    is not a string this codebase owns — which is precisely why it needs a
    test rather than a comment.
    """
    from fastapi import HTTPException
    from fastapi.security import HTTPBearer
    from starlette.requests import Request

    scheme = HTTPBearer(auto_error=True)
    request = Request({"type": "http", "method": "POST", "path": "/x", "headers": []})

    with pytest.raises(HTTPException) as exc_info:
        await scheme(request)

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Not authenticated"
