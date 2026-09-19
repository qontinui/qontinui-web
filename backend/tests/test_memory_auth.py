"""Unit tests for the memory API's tenant principal resolution.

``get_memory_tenant`` (app/api/v1/endpoints/memory.py) accepts three
credential shapes — device JWT, coord service token, Cognito operator —
and is fail-closed: 401 with no credential, 403 when the credential is
valid but resolves to no tenant. Tenant NEVER comes from the request.

All coord/JWKS/Cognito interactions are mocked — no network, no DB.
"""

from __future__ import annotations

from collections.abc import Iterable
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ValidationError

from app.api.v1.endpoints import memory as memory_ep
from app.schemas.memory import MemoryQueryRequest, MemoryRecordIn, SupersedeRequest
from app.services.coord_jwks import (
    CoordJWKSUnavailableError,
    CoordTokenExpiredError,
    CoordTokenForeignIssuerError,
    CoordTokenInvalidError,
    CoordTokenNotYetValidError,
)


def _creds(token: str = "some-bearer") -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _user(user_id: UUID) -> MagicMock:
    """A stand-in for the ``auth.users`` row ``_verify_device_jwt`` resolves.

    ``.id`` has to be a real UUID: the device arm now reads it onto the
    principal, and a bare ``MagicMock()`` would let an assertion on
    ``principal.user_id`` pass against an attribute that is itself a mock.
    """
    user = MagicMock()
    user.id = user_id
    return user


class _FakeReferenceTables:
    """Stands in for ``auth.users`` / ``coord.devices`` inside a fake session.

    ``_existing_provenance`` resolves the coord-service arm's two ASSERTED
    ids against the tables their FKs point at, so this module — which is
    deliberately DB-free — needs a substrate for them. The fake answers the
    one query that function issues, honouring membership, so the real
    function (its SQL parameters, its NULL handling, its degradation
    branches and its logging) is what runs.
    """

    def __init__(self, users: set[UUID], devices: set[UUID]) -> None:
        self._users = users
        self._devices = devices

    async def execute(self, _stmt: object, params: dict[str, Any]) -> MagicMock:
        def _hit(raw: str | None, known: set[UUID]) -> UUID | None:
            if raw is None:
                return None
            value = UUID(raw)
            return value if value in known else None

        row = SimpleNamespace(
            user_id=_hit(params["user_id"], self._users),
            device_id=_hit(params["device_id"], self._devices),
        )
        result = MagicMock()
        result.one.return_value = row
        return result

    async def __aenter__(self) -> _FakeReferenceTables:
        return self

    async def __aexit__(self, *_exc: object) -> bool:
        return False


def _reference_tables(
    monkeypatch: pytest.MonkeyPatch,
    *,
    users: Iterable[UUID] = (),
    devices: Iterable[UUID] = (),
) -> None:
    """Make exactly ``users``/``devices`` exist for the provenance lookup."""
    known_users, known_devices = set(users), set(devices)
    monkeypatch.setattr(
        "app.db.session.AsyncSessionLocal",
        lambda: _FakeReferenceTables(known_users, known_devices),
    )


def _mock_verify(monkeypatch: pytest.MonkeyPatch, result) -> AsyncMock:
    mock = (
        AsyncMock(side_effect=result)
        if isinstance(result, Exception)
        else AsyncMock(return_value=result)
    )
    monkeypatch.setattr(memory_ep.coord_jwks_client, "verify_token", mock)
    return mock


@pytest.mark.asyncio
async def test_no_credential_no_user_is_401() -> None:
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=None
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_coord_service_token_resolves_tenant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = uuid4()
    device_id = uuid4()
    _mock_verify(
        monkeypatch,
        {
            "token_kind": "coord_service",
            "sub": "coord-memory-proxy",
            "tenant_id": str(tenant_id),
            "device_id": str(device_id),
        },
    )
    # The service arm resolves its asserted ids against their FK targets;
    # this one names a device that exists, so it survives.
    _reference_tables(monkeypatch, devices=[device_id])
    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=None, credentials=_creds()
    )
    assert principal.tenant_id == tenant_id
    assert principal.device_id == device_id
    assert principal.actor == "coord_service"


@pytest.mark.asyncio
async def test_coord_service_token_wrong_subject_is_401(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_verify(
        monkeypatch,
        {
            "token_kind": "coord_service",
            "sub": "someone-else",
            "tenant_id": str(uuid4()),
        },
    )
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=_creds()
        )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_coord_service_token_without_tenant_is_403(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_verify(
        monkeypatch,
        {"token_kind": "coord_service", "sub": "coord-memory-proxy"},
    )
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=_creds()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_device_token_resolves_device_tenant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = uuid4()
    device_id = uuid4()
    device_claims = {
        "user_id": str(uuid4()),
        "device_id": str(device_id),
        "tenant_id": str(tenant_id),
    }
    # A coord-signed token that is NOT a service token routes to the
    # canonical device verification from app.api.deps.
    _mock_verify(monkeypatch, device_claims)
    monkeypatch.setattr(
        memory_ep,
        "_verify_device_jwt",
        AsyncMock(return_value=(device_claims, _user(UUID(device_claims["user_id"])))),
    )
    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=None, credentials=_creds()
    )
    assert principal.tenant_id == tenant_id
    assert principal.device_id == device_id
    assert principal.actor == "device"


@pytest.mark.asyncio
async def test_device_token_without_tenant_claim_is_403(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    device_claims = {"user_id": str(uuid4()), "device_id": str(uuid4())}
    _mock_verify(monkeypatch, device_claims)
    monkeypatch.setattr(
        memory_ep,
        "_verify_device_jwt",
        AsyncMock(return_value=(device_claims, _user(UUID(device_claims["user_id"])))),
    )
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=_creds()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_jwks_unavailable_is_503(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_verify(monkeypatch, CoordJWKSUnavailableError("cold start"))
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=_creds()
        )
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_operator_user_resolves_home_tenant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = uuid4()
    # Bearer is a Cognito token — coord JWKS rejects it, we fall through
    # to the operator path.
    _mock_verify(monkeypatch, CoordTokenInvalidError("not coord-signed"))
    identity = MagicMock()
    identity.home_tenant_id = tenant_id
    monkeypatch.setattr(
        memory_ep, "get_coord_identity", AsyncMock(return_value=identity)
    )
    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=MagicMock(), credentials=_creds()
    )
    assert principal.tenant_id == tenant_id
    assert principal.device_id is None
    assert principal.actor == "operator"


@pytest.mark.asyncio
async def test_operator_without_home_tenant_is_403(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_verify(monkeypatch, CoordTokenInvalidError("not coord-signed"))
    identity = MagicMock()
    identity.home_tenant_id = None
    monkeypatch.setattr(
        memory_ep, "get_coord_identity", AsyncMock(return_value=identity)
    )
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=MagicMock(), credentials=_creds()
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_unverifiable_bearer_and_no_user_is_401(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_verify(monkeypatch, CoordTokenInvalidError("garbage"))
    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=_creds()
        )
    assert exc.value.status_code == 401


# ---------------------------------------------------------------------------
# WHICH coord failures fall through to Cognito, and which stop here.
#
# The fall-through is a PROBE: `get_memory_tenant` runs every bearer through
# the coord verifier purely to ask "is this coord-signed?", so a Cognito
# bearer necessarily fails it on the way to a SUCCESSFUL request. That makes
# swallowing the failure correct for the arms that prove nothing.
#
# It is NOT correct for the two arms reached only after the signature
# verified against a key this coord serves. Those prove the bearer IS
# coord-signed, so falling through reports a stale device JWT as the generic
# "Authentication required." — the same misdiagnosis the error split in
# `coord_jwks` exists to remove, just relocated one layer up.
#
# Each test below pins the SIDE of that line, and the two stopping tests pass
# `user=MagicMock()` deliberately: with an operator user present the
# fall-through path would otherwise SUCCEED, so a regression that reinstates
# it fails these tests loudly instead of silently downgrading a device
# caller to an operator principal.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_expired_coord_token_is_401_naming_expiry_not_fallthrough(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An expired device JWT must say so, not fall through to Cognito.

    `CoordTokenExpiredError` is raised only after PyJWT verified the
    signature against a JWK this coord published, so the bearer is provably
    coord-signed and cannot also be a Cognito token. The presenter's remedy
    is to re-mint, which "Authentication required." does not convey.
    """
    _mock_verify(monkeypatch, CoordTokenExpiredError("token expired: ..."))
    identity = MagicMock()
    identity.home_tenant_id = uuid4()
    monkeypatch.setattr(
        memory_ep, "get_coord_identity", AsyncMock(return_value=identity)
    )

    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=MagicMock(), credentials=_creds()
        )

    assert exc.value.status_code == 401
    assert exc.value.detail == "Device token has expired."


@pytest.mark.asyncio
async def test_not_yet_valid_coord_token_is_401_naming_clock_drift(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A not-yet-valid device JWT must point at clock drift.

    Same proof as the expired arm — the signature verified — but a different
    remedy, so it must not be collapsed into the expired message either.
    """
    _mock_verify(monkeypatch, CoordTokenNotYetValidError("token not yet valid: ..."))
    identity = MagicMock()
    identity.home_tenant_id = uuid4()
    monkeypatch.setattr(
        memory_ep, "get_coord_identity", AsyncMock(return_value=identity)
    )

    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=MagicMock(), credentials=_creds()
        )

    assert exc.value.status_code == 401
    assert "clock drift" in exc.value.detail


@pytest.mark.asyncio
async def test_foreign_issuer_still_falls_through_to_the_operator_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The foreign-issuer arm MUST keep falling through.

    This is the regression guard on the narrowness of the two tests above.
    A Cognito bearer carries a Cognito `kid`, which is absent from coord's
    JWKS, so EVERY successful operator request lands in this arm first.
    Promoting it to a hard 401 alongside the expired/not-yet-valid arms
    would 401 the entire dashboard.
    """
    tenant_id = uuid4()
    _mock_verify(
        monkeypatch,
        CoordTokenForeignIssuerError(
            "no JWK with kid=...",
            coord_url="http://localhost:9870",
            token_kid="cognito-rsa-key-id",
            served_kids=["coord-ed25519-v1"],
        ),
    )
    identity = MagicMock()
    identity.home_tenant_id = tenant_id
    monkeypatch.setattr(
        memory_ep, "get_coord_identity", AsyncMock(return_value=identity)
    )

    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=MagicMock(), credentials=_creds()
    )

    assert principal.tenant_id == tenant_id
    assert principal.actor == "operator"


# ---------------------------------------------------------------------------
# Every failure class must be CONSCIOUSLY classified at this door.
#
# The handler above enumerates `(CoordTokenExpiredError,
# CoordTokenNotYetValidError)` by hand. That list is correct today and has no
# way to notice tomorrow: a fourth `CoordTokenInvalidError` subclass that also
# proves the bearer is coord-signed would silently fall through to Cognito and
# be answered "Authentication required." — reinstating exactly the defect this
# door was just fixed for, with no test failing.
#
# So the walk is over the HIERARCHY and the expectation table lives here. A new
# subclass fails this test until someone states which side of the line it is
# on, which is a judgement (does reaching this arm prove coord signed it?) that
# cannot be derived mechanically — but the PROMPT for it can be.
# ---------------------------------------------------------------------------

_STOPS_HERE = "stops"
_FALLS_THROUGH = "falls_through"

# What each class means at THIS door, and why.
_CLASSIFICATION = {
    # Reached before any signature check proved anything — a Cognito bearer
    # lands here on the way to a successful request.
    CoordTokenInvalidError: _FALLS_THROUGH,
    # Same: a Cognito `kid` is absent from coord's JWKS by construction.
    CoordTokenForeignIssuerError: _FALLS_THROUGH,
    # Reached only AFTER the signature verified against a coord-served key,
    # so the bearer is provably coord-signed and cannot also be Cognito.
    CoordTokenExpiredError: _STOPS_HERE,
    CoordTokenNotYetValidError: _STOPS_HERE,
}


def _instance(cls: type[CoordTokenInvalidError]) -> CoordTokenInvalidError:
    if cls is CoordTokenForeignIssuerError:
        return CoordTokenForeignIssuerError(
            "no JWK with kid=...",
            coord_url="http://localhost:9870",
            token_kid="cognito-rsa-key-id",
            served_kids=["coord-ed25519-v1"],
        )
    return cls("example")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "cls",
    [CoordTokenInvalidError, *CoordTokenInvalidError.__subclasses__()],
    ids=lambda c: c.__name__,
)
async def test_every_failure_class_is_classified_at_the_memory_door(
    cls: type, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Each class either stops with its reason named, or probes on to Cognito.

    A failure on the membership assertion below means a new failure class
    exists and nobody decided what the memory door should do with it. Decide,
    add the row, and wire the handler if it belongs on the stopping side.
    """
    assert cls in _CLASSIFICATION, (
        f"{cls.__name__} is a CoordTokenInvalidError subclass that "
        f"get_memory_tenant has never been told how to treat. Does reaching "
        f"this arm PROVE the bearer was coord-signed? If yes it must stop "
        f"here (add it to the handler); if no it must fall through so a "
        f"Cognito bearer still gets its turn."
    )

    tenant_id = uuid4()
    _mock_verify(monkeypatch, _instance(cls))
    identity = MagicMock()
    identity.home_tenant_id = tenant_id
    monkeypatch.setattr(
        memory_ep, "get_coord_identity", AsyncMock(return_value=identity)
    )

    if _CLASSIFICATION[cls] is _STOPS_HERE:
        with pytest.raises(HTTPException) as exc:
            await memory_ep.get_memory_tenant(
                request=MagicMock(), user=MagicMock(), credentials=_creds()
            )
        assert exc.value.status_code == 401
        # The whole point: the reason is NAMED, not flattened into the
        # generic no-credential message at the bottom of the function.
        assert exc.value.detail != "Authentication required."
    else:
        principal = await memory_ep.get_memory_tenant(
            request=MagicMock(), user=MagicMock(), credentials=_creds()
        )
        assert principal.actor == "operator"
        assert principal.tenant_id == tenant_id


# ---------------------------------------------------------------------------
# PROVENANCE FACETS — `MemoryPrincipal.user_id`
#
# Plan `2026-08-06-user-and-device-facets-on-memories-and-findings`, Phase 2
# (web half). SECURITY SURFACE: `user_id` is the key of the one read path
# that can return a row from a tenant other than the caller's
# (`applies_at='user'`, §6), so where it comes from is the security-critical
# line of the whole plan. It is resolved HERE, from a verified credential,
# and nowhere else.
#
# The tests below pin three things that are easy to break and silent when
# broken:
#
#   1. the device arm actually CARRIES the user it already resolves (it used
#      to bind it to `_device_user` and throw it away);
#   2. a coord-service token with no `user_id` claim is FAIL-SOFT — `None`,
#      never a 401. coord does not mint that claim yet, so a strict read here
#      would 401 every proxied memory write in the fleet. "A memory that
#      fails to save is worse than one that is coarsely scoped" (§4.1);
#   3. a coord-service token that DOES carry the claim yields it, which is
#      what coord's deferred half will start sending.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_device_principal_carries_the_resolved_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The device arm stops discarding the user `_verify_device_jwt` resolved.

    This is the one arm on which the facet resolves today, and the user is
    free: `_verify_device_jwt` has already 401'd a token with no `user_id`
    claim, a malformed one, an unknown user or an inactive one, so by the
    time the principal is built the value is fully verified.
    """
    user_id = uuid4()
    device_claims = {
        "user_id": str(user_id),
        "device_id": str(uuid4()),
        "tenant_id": str(uuid4()),
    }
    _mock_verify(monkeypatch, device_claims)
    monkeypatch.setattr(
        memory_ep,
        "_verify_device_jwt",
        AsyncMock(return_value=(device_claims, _user(user_id))),
    )

    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=None, credentials=_creds()
    )

    assert principal.actor == "device"
    assert principal.user_id == user_id


@pytest.mark.asyncio
async def test_coord_service_token_without_user_claim_is_fail_soft(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No `user_id` claim → `user_id is None`, and NOT a 401.

    This is today's live shape: coord's `MemoryProxyClaims` carries
    `{sub, token_kind, tenant_id, device_id, iat, exp}` and no user, so
    every proxied write lands here. Turning the absence into a rejection
    would take out `coord_memory_record` fleet-wide for a facet that is
    nice to have.
    """
    tenant_id, device_id = uuid4(), uuid4()
    _mock_verify(
        monkeypatch,
        {
            "token_kind": "coord_service",
            "sub": "coord-memory-proxy",
            "tenant_id": str(tenant_id),
            "device_id": str(device_id),
        },
    )
    _reference_tables(monkeypatch, devices=[device_id])

    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=None, credentials=_creds()
    )

    assert principal.actor == "coord_service"
    assert principal.tenant_id == tenant_id
    assert principal.user_id is None


@pytest.mark.asyncio
async def test_coord_service_token_with_user_claim_carries_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A `user_id` CLAIM is honoured — the deferred coord half's wire shape.

    Once coord mints `user_id` into `MemoryProxyClaims`, this is the arm
    that starts resolving. It reads the VERIFIED claim, the same way
    `tenant_id` and `device_id` already do; nothing here reads the body.
    """
    user_id, device_id = uuid4(), uuid4()
    _mock_verify(
        monkeypatch,
        {
            "token_kind": "coord_service",
            "sub": "coord-memory-proxy",
            "tenant_id": str(uuid4()),
            "device_id": str(device_id),
            "user_id": str(user_id),
        },
    )
    _reference_tables(monkeypatch, users=[user_id], devices=[device_id])

    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=None, credentials=_creds()
    )

    assert principal.user_id == user_id


@pytest.mark.asyncio
async def test_coord_service_user_that_does_not_exist_degrades_to_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A claimed `user_id` with no `auth.users` row is NULL, not a 500.

    `coord.memory_records.user_id REFERENCES auth.users(id)`, so a dangling
    id does not land a NULL — it raises `ForeignKeyViolation` and takes the
    whole write to a 500. On this arm the id is an unverified ASSERTION by
    coord, and coord carries its own operator-id keyspace, so "coord starts
    minting user_id and it is the wrong kind of id" would break every
    proxied memory write in the fleet at once.

    Shape is checked by `_claim_uuid`; EXISTENCE is checked here. The
    degradation is the plan's own rule: never reject a write for missing
    provenance (§4.1 item 3).
    """
    device_id = uuid4()
    _mock_verify(
        monkeypatch,
        {
            "token_kind": "coord_service",
            "sub": "coord-memory-proxy",
            "tenant_id": str(uuid4()),
            "device_id": str(device_id),
            # Well-formed, and names nobody.
            "user_id": str(uuid4()),
        },
    )
    _reference_tables(monkeypatch, users=[], devices=[device_id])

    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=None, credentials=_creds()
    )

    assert principal.user_id is None
    # The facet that DID resolve is unaffected — degrade one, not both.
    assert principal.device_id == device_id


@pytest.mark.asyncio
async def test_coord_service_device_that_does_not_exist_degrades_to_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same for `device_id` — `coord.devices` is the FK target there.

    Lower risk than the user column (device retirement is a soft
    `reaped_at`, not a DELETE) but the same failure shape, and one lookup
    covers both columns.
    """
    user_id = uuid4()
    _mock_verify(
        monkeypatch,
        {
            "token_kind": "coord_service",
            "sub": "coord-memory-proxy",
            "tenant_id": str(uuid4()),
            "device_id": str(uuid4()),
            "user_id": str(user_id),
        },
    )
    _reference_tables(monkeypatch, users=[user_id], devices=[])

    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=None, credentials=_creds()
    )

    assert principal.device_id is None
    assert principal.user_id == user_id


@pytest.mark.asyncio
async def test_unresolvable_reference_tables_degrade_rather_than_raise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The lookup ITSELF failing must not fail the request either.

    The check exists to stop a provenance facet from killing a write. A
    version of it that raises when the reference tables are unreachable
    would just move the outage rather than remove it, so every failure
    degrades to unattributed.
    """

    def _explode() -> None:
        raise RuntimeError("reference tables unreachable")

    _mock_verify(
        monkeypatch,
        {
            "token_kind": "coord_service",
            "sub": "coord-memory-proxy",
            "tenant_id": str(uuid4()),
            "device_id": str(uuid4()),
            "user_id": str(uuid4()),
        },
    )
    monkeypatch.setattr("app.db.session.AsyncSessionLocal", _explode)

    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=None, credentials=_creds()
    )

    assert principal.actor == "coord_service"
    assert principal.user_id is None
    assert principal.device_id is None


@pytest.mark.asyncio
async def test_device_arm_does_not_pay_for_the_existence_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The check is scoped to the one arm whose ids are assertions.

    On the device arm `_verify_device_jwt` has ALREADY read the
    `auth.users` row, so re-reading it would buy nothing and cost a round
    trip on the fleet's hot path. Pinned as a test because "make it
    uniform" is a plausible-looking future edit that would quietly double
    the per-request DB work of every runner memory call.
    """
    user_id, device_id = uuid4(), uuid4()
    device_claims = {
        "user_id": str(user_id),
        "device_id": str(device_id),
        "tenant_id": str(uuid4()),
    }
    _mock_verify(monkeypatch, device_claims)
    monkeypatch.setattr(
        memory_ep,
        "_verify_device_jwt",
        AsyncMock(return_value=(device_claims, _user(user_id))),
    )
    # Nothing exists in the reference tables. If the device arm consulted
    # them, both facets would come back None.
    _reference_tables(monkeypatch, users=[], devices=[])

    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=None, credentials=_creds()
    )

    assert principal.user_id == user_id
    assert principal.device_id == device_id


@pytest.mark.asyncio
async def test_coord_service_token_with_malformed_user_claim_is_401(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A present-but-unparseable `user_id` is a 401, not a silent None.

    Fail-SOFT is about ABSENCE. A claim that is there and malformed is a
    broken minter, and `_claim_uuid` already treats `device_id` that way;
    swallowing it would attribute the record to nobody while reporting
    success.
    """
    _mock_verify(
        monkeypatch,
        {
            "token_kind": "coord_service",
            "sub": "coord-memory-proxy",
            "tenant_id": str(uuid4()),
            "user_id": "not-a-uuid",
        },
    )

    with pytest.raises(HTTPException) as exc:
        await memory_ep.get_memory_tenant(
            request=MagicMock(), user=None, credentials=_creds()
        )

    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_operator_principal_carries_the_authenticated_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The operator arm attributes to the `auth.users` row it authenticated.

    Deliberately `user.id` and not `identity.operator_id`: `user_id` FKs to
    `auth.users(id)`, and coord's operator id is a different keyspace.
    """
    user_id = uuid4()
    _mock_verify(monkeypatch, CoordTokenInvalidError("not coord-signed"))
    identity = MagicMock()
    identity.home_tenant_id = uuid4()
    monkeypatch.setattr(
        memory_ep, "get_coord_identity", AsyncMock(return_value=identity)
    )

    principal = await memory_ep.get_memory_tenant(
        request=MagicMock(), user=_user(user_id), credentials=_creds()
    )

    assert principal.actor == "operator"
    assert principal.user_id == user_id


# ---------------------------------------------------------------------------
# THE PROHIBITION — provenance arrives as a verified claim or not at all.
#
# §6 requirement 5(b): a `user_id` accepted from a request body would let any
# device write or read any human's cross-tenant memory corpus. Every request
# model on this path is `extra="forbid"`, so the refusal is STRUCTURAL —
# there is no rejection to write, only a field not to declare.
#
# These tests exist because that protection is invisible: it is the ABSENCE
# of three field declarations, which nothing stops a future author from
# adding for convenience. They fail the moment one is added, which is the
# point at which someone has to argue for it.
#
# All THREE doors are enumerated in one place, because a model left out of
# the list is a door left open and nothing else in the suite would notice:
#
#   * `MemoryRecordIn`      — the write door.
#   * `MemoryQueryRequest`  — the READ half of the same hole: a honoured
#     `user_id` would let any holder of a device token select another
#     human's user-altitude rows across every tenant that human belongs to.
#   * `SupersedeRequest`    — also record-CREATING (the successor is a new
#     row, with this caller's provenance), so it is a third write door and
#     was missing from this list until the 2026-09-19 review.
# ---------------------------------------------------------------------------

_FORBIDDEN_PROVENANCE_KEYS = ("user_id", "device_id", "applies_at")

#: Each model with a minimal body that validates without the forbidden key.
_PROVENANCE_FORBIDDING_MODELS: tuple[tuple[type[BaseModel], dict[str, Any]], ...] = (
    (MemoryRecordIn, {"title": "t", "content": "c", "kind": "fact"}),
    (MemoryQueryRequest, {"query_text": "q"}),
    (SupersedeRequest, {"title": "t", "content": "c"}),
)

_MODEL_IDS = [m.__name__ for m, _ in _PROVENANCE_FORBIDDING_MODELS]


@pytest.mark.parametrize("key", _FORBIDDEN_PROVENANCE_KEYS)
@pytest.mark.parametrize(
    ("model", "minimal_body"), _PROVENANCE_FORBIDDING_MODELS, ids=_MODEL_IDS
)
def test_request_body_cannot_declare_provenance(
    model: type[BaseModel], minimal_body: dict[str, Any], key: str
) -> None:
    """Every memory request model must 422 a provenance key, not honour it."""
    body = {
        **minimal_body,
        key: str(uuid4()) if key != "applies_at" else "fleet",
    }
    with pytest.raises(ValidationError) as exc:
        model.model_validate(body)
    assert key in str(exc.value)


def test_no_schema_on_the_memory_write_path_declares_a_provenance_field() -> None:
    """Belt and braces: the field set itself, not just one rejected body.

    A future author could re-open the hole by relaxing `extra="forbid"` on
    one model while the others keep it, or by declaring the field under
    another NAME and binding it to the wire key with an alias —
    `provenance_user: UUID = Field(alias="user_id")` sails straight past a
    check on `model_fields`, because those are field names. So the alias
    set is checked too, and a leak in EITHER is the same open door.
    """
    for model, _minimal_body in _PROVENANCE_FORBIDDING_MODELS:
        assert model.model_config.get("extra") == "forbid", model.__name__
        wire_keys = set(model.model_fields)
        for field in model.model_fields.values():
            if field.alias:
                wire_keys.add(field.alias)
            if isinstance(field.validation_alias, str):
                wire_keys.add(field.validation_alias)
        leaked = wire_keys & set(_FORBIDDEN_PROVENANCE_KEYS)
        assert not leaked, (
            f"{model.__name__} accepts {sorted(leaked)} (as a field name or "
            f"an alias). Provenance is resolved server-side from a verified "
            f"credential (get_memory_tenant -> MemoryPrincipal) and must "
            f"never be accepted from a request body — plan "
            f"2026-08-06-user-and-device-facets-on-memories-and-findings "
            f"§6 requirement 1. A body-supplied user_id lets any device "
            f"read or write any human's cross-tenant memory corpus."
        )
