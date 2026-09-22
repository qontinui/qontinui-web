"""Plan & Prompt Library — the corpus records WHICH COORD TENANT wrote a row.

Plan
``2026-09-22-the-plan-corpus-has-no-tenant-axis-so-a-multi-bound-device-cannot-scope-its-plans``,
Phases 1-3.

``agent.work_artifacts`` had no tenant axis, and every plan-library route
derives its scope from the caller's PERSONAL ORGANIZATION. A device bound to N
coord tenants and operated by one person therefore resolves to ONE
organization and ONE corpus: the tenants' plans fuse, and a shared stem under
one ``source_repo`` overwrites across them on the identity index.

What is asserted here, and why each one earns its place
-------------------------------------------------------
1. **The OPERATOR arm still works.** This is the regression the vet of the
   plan caught: the draft resolved the tenant through
   ``get_authenticated_device``, which is built on
   ``HTTPBearer(auto_error=True)`` and raises before the handler on every
   browser request that has no bearer. That spelling would have 401'd the
   operator arm of thirteen dual-auth routes, and nothing else in this suite
   would have said which change did it. Pinned FIRST for that reason.
2. **A device token WITH a tenant claim** records ``declared`` + that tenant.
3. **A device token WITHOUT one** records ``unknown`` + NULL, and is a **200**.
   Coord mints ``Claims.tenant_id`` as an ``Option``, so a tenant-less device
   token is a supported credential; ``GET /devices/me``'s 401-on-missing is
   right there (the tenant IS its answer) and wrong here, where it would turn
   a currently-working push into a hard failure.
4. **A MALFORMED claim is a 401** on both arms of the accessor. A broken
   credential silently filed as ``unknown`` would put a real tenant's plan in
   the unattributed bucket — the one outcome ``tenant_source`` exists to
   prevent, so the two absences must NOT collapse.
5. **The credential beats the body.** A device declaring some other tenant in
   its payload still records the one its JWT asserts, exactly as
   ``organization_id`` is never accepted from a body.
6. **The read filters** narrow within the caller's org and never widen it.

Layering matches ``tests/test_plan_library_device_auth.py``:
``httpx.AsyncClient`` + ``ASGITransport`` (NOT ``TestClient``) so handlers run
in the SAME asyncio loop as the shared session, and the device JWT is stubbed
at ``deps._verify_device_jwt`` — coord's JWKS is not under test, the dependency
wiring is.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

API_PREFIX = "/api/v1/plan-library"

pytestmark = pytest.mark.asyncio

DEVICE_BEARER_WITH_TENANT = "device-jwt-carrying-a-tenant"
DEVICE_BEARER_NO_TENANT = "device-jwt-with-no-tenant-claim"
DEVICE_BEARER_BAD_TENANT = "device-jwt-with-a-malformed-tenant"

TENANT_A = UUID("11111111-1111-4111-8111-111111111111")
TENANT_B = UUID("22222222-2222-4222-8222-222222222222")


def _slug(stem: str) -> str:
    return f"{stem}-{uuid4().hex[:10]}"


def _payload(**overrides: Any) -> dict:
    body = {
        "kind": "plan",
        "slug": _slug("tenantaxis"),
        "title": "Captured by the runner scan",
        "status": "VETTED",
        "body": "# a plan the scan found on disk",
    }
    body.update(overrides)
    return body


async def _make_user(db: AsyncSession, stem: str):
    from app.models.user import User

    user = User(
        email=f"{stem}_{uuid4().hex[:8]}@example.com",
        username=f"{stem}_{uuid4().hex[:8]}",
        full_name="Plan Library Tenant Axis",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_personal_org(db: AsyncSession, user):
    from app.models.organization import Organization

    org = Organization(
        name=f"Personal {uuid4().hex[:6]}",
        slug=f"personal-{uuid4().hex[:10]}",
        owner_id=user.id,
        settings={"is_personal": True},
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


def _build_app(*, db_session: AsyncSession, cognito_user=None) -> FastAPI:
    from app.api.deps import (
        current_active_user,
        current_active_user_optional,
        get_async_db,
    )
    from app.api.v1.endpoints.plan_library import router as plan_library_router

    app = FastAPI()
    app.dependency_overrides[current_active_user_optional] = lambda: cognito_user
    if cognito_user is not None:
        app.dependency_overrides[current_active_user] = lambda: cognito_user

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(plan_library_router, prefix=API_PREFIX)
    return app


@pytest_asyncio.fixture()
async def device_owner(async_db_session: AsyncSession):
    user = await _make_user(async_db_session, "tenantaxis_device")
    org = await _make_personal_org(async_db_session, user)
    return user, org


@pytest.fixture()
def stub_device_jwt(monkeypatch, device_owner):
    """Three tokens, one paired operator, three different tenant claims.

    One operator deliberately: that IS the defect's shape. Two coord tenants
    reached through one person's device resolve to one personal organization,
    so the org cannot separate them and only the claim can.
    """
    from app.api import deps

    user, _org = device_owner
    claims_by_token = {
        DEVICE_BEARER_WITH_TENANT: {
            "device_id": str(uuid4()),
            "user_id": str(user.id),
            "tenant_id": str(TENANT_A),
        },
        # No ``tenant_id`` key at all — coord's Claims.tenant_id is an Option.
        DEVICE_BEARER_NO_TENANT: {
            "device_id": str(uuid4()),
            "user_id": str(user.id),
        },
        DEVICE_BEARER_BAD_TENANT: {
            "device_id": str(uuid4()),
            "user_id": str(user.id),
            "tenant_id": "not-a-uuid",
        },
    }

    async def _fake_verify(token: str):
        claims = claims_by_token.get(token)
        if claims is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired device token.",
            )
        return (claims, user)

    monkeypatch.setattr(deps, "_verify_device_jwt", _fake_verify)


def _device_client(db_session: AsyncSession, bearer: str):
    app = _build_app(db_session=db_session, cognito_user=None)
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {bearer}"},
    )


@pytest_asyncio.fixture()
async def cognito_client(async_db_session: AsyncSession):
    """A browser operator — a cookie session with NO Authorization header."""
    user = await _make_user(async_db_session, "tenantaxis_cognito")
    org = await _make_personal_org(async_db_session, user)
    app = _build_app(db_session=async_db_session, cognito_user=user)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        client.qontinui_user = user  # type: ignore[attr-defined]
        client.qontinui_org = org  # type: ignore[attr-defined]
        yield client


# ===========================================================================
# 1. The regression the vet caught — the OPERATOR arm still answers.
# ===========================================================================


async def test_operator_arm_still_writes_with_no_bearer_at_all(cognito_client) -> None:
    """A browser POST carrying NO Authorization header is still a 201/200.

    The plan's draft took the tenant from ``get_authenticated_device``, whose
    ``HTTPBearer(auto_error=True)`` raises before the handler runs on exactly
    this request. This test is the difference between the two spellings and it
    would have failed on the draft's.
    """
    assert "authorization" not in {k.lower() for k in cognito_client.headers}

    resp = await cognito_client.post(API_PREFIX, json=_payload())

    assert resp.status_code in (200, 201), resp.text
    artifact = resp.json()["artifact"]
    # No device credential asserted a tenant, and the personal organization is
    # NEVER used as a stand-in for one.
    assert artifact["tenant_id"] is None
    assert artifact["tenant_source"] == "unknown"


async def test_operator_may_declare_a_tenant_in_the_body(cognito_client) -> None:
    resp = await cognito_client.post(API_PREFIX, json=_payload(tenant_id=str(TENANT_B)))
    assert resp.status_code in (200, 201), resp.text
    artifact = resp.json()["artifact"]
    assert artifact["tenant_id"] == str(TENANT_B)
    assert artifact["tenant_source"] == "declared"


# ===========================================================================
# 2-3. The device arm: a claim is DECLARED, its absence is UNKNOWN.
# ===========================================================================


async def test_device_with_a_tenant_claim_records_it_as_declared(
    async_db_session: AsyncSession, stub_device_jwt
) -> None:
    async with _device_client(async_db_session, DEVICE_BEARER_WITH_TENANT) as client:
        resp = await client.post(API_PREFIX, json=_payload())

    assert resp.status_code in (200, 201), resp.text
    artifact = resp.json()["artifact"]
    assert artifact["tenant_id"] == str(TENANT_A)
    assert artifact["tenant_source"] == "declared"


async def test_device_without_a_tenant_claim_is_unknown_not_a_401(
    async_db_session: AsyncSession, stub_device_jwt
) -> None:
    """The V-3 regression: a tenant-less device token still WRITES.

    ``GET /devices/me`` 401s on this same absence because the tenant is the
    answer it owes. Copying that posture here would break every push from a
    device whose token carries no tenant claim — a regression introduced by a
    change whose whole purpose is to RECORD what is known.
    """
    async with _device_client(async_db_session, DEVICE_BEARER_NO_TENANT) as client:
        resp = await client.post(API_PREFIX, json=_payload())

    assert resp.status_code in (200, 201), resp.text
    artifact = resp.json()["artifact"]
    assert artifact["tenant_id"] is None
    assert artifact["tenant_source"] == "unknown"


async def test_device_with_a_malformed_tenant_claim_is_a_401(
    async_db_session: AsyncSession, stub_device_jwt
) -> None:
    """Missing and MALFORMED must not collapse onto one another.

    A token carrying a non-UUID tenant is a BROKEN credential. Filing its row
    as ``unknown`` would put a real tenant's plan in the unattributed bucket,
    which is exactly what ``tenant_source`` exists to prevent.
    """
    async with _device_client(async_db_session, DEVICE_BEARER_BAD_TENANT) as client:
        resp = await client.post(API_PREFIX, json=_payload())

    assert resp.status_code == 401, resp.text
    assert "tenant_id" in resp.text


# ===========================================================================
# 5. The credential beats the body.
# ===========================================================================


async def test_device_payload_cannot_override_the_claimed_tenant(
    async_db_session: AsyncSession, stub_device_jwt
) -> None:
    async with _device_client(async_db_session, DEVICE_BEARER_WITH_TENANT) as client:
        resp = await client.post(API_PREFIX, json=_payload(tenant_id=str(TENANT_B)))

    assert resp.status_code in (200, 201), resp.text
    artifact = resp.json()["artifact"]
    assert artifact["tenant_id"] == str(TENANT_A), (
        "the verified claim must win over the request body, exactly as "
        "organization_id is never accepted from a body"
    )
    assert artifact["tenant_source"] == "declared"


# ===========================================================================
# 6. The read side.
# ===========================================================================


async def test_list_filters_on_tenant_and_on_tenant_source(
    async_db_session: AsyncSession, stub_device_jwt
) -> None:
    repo = f"tenantfilter/{uuid4().hex[:8]}"
    async with _device_client(async_db_session, DEVICE_BEARER_WITH_TENANT) as client:
        declared = await client.post(
            API_PREFIX, json=_payload(source_repo=repo, slug=_slug("declared"))
        )
        assert declared.status_code in (200, 201), declared.text

    async with _device_client(async_db_session, DEVICE_BEARER_NO_TENANT) as client:
        unknown = await client.post(
            API_PREFIX, json=_payload(source_repo=repo, slug=_slug("unknown"))
        )
        assert unknown.status_code in (200, 201), unknown.text

        by_tenant = await client.get(
            API_PREFIX, params={"repo": repo, "tenant_id": str(TENANT_A)}
        )
        by_source = await client.get(
            API_PREFIX, params={"repo": repo, "tenant_source": "unknown"}
        )
        unfiltered = await client.get(API_PREFIX, params={"repo": repo})

    assert by_tenant.status_code == 200, by_tenant.text
    assert [r["slug"] for r in by_tenant.json()["items"]] == [
        declared.json()["artifact"]["slug"]
    ]

    assert by_source.status_code == 200, by_source.text
    assert [r["slug"] for r in by_source.json()["items"]] == [
        unknown.json()["artifact"]["slug"]
    ]

    # An ABSENT tenant filter is not a filter for the NULL tenant. Collapsing
    # the two would make "no filter" indistinguishable from "filter for
    # absence" — this is the assertion that keeps them apart.
    assert unfiltered.json()["total"] == 2


async def test_a_second_tenant_writing_the_same_row_stamps_it_ambiguous(
    async_db_session: AsyncSession, stub_device_jwt, monkeypatch
) -> None:
    """The Phase 3 measurement — and the shape correction it rests on.

    ``uq_work_artifacts_identity`` is UNIQUE over
    ``(organization, kind, slug, source_repo)``, so two tenants' copies of one
    stem CANNOT coexist as two rows: they arrive as two writes to ONE row,
    each overwriting the last. A "group by identity, having distinct tenants"
    query — the obvious spelling, and the one the plan's draft asked for —
    can therefore never return anything, and the Phase 4 gate would have
    opened on a corpus that only LOOKED clean.

    So the collision is caught where it happens. The second tenant still wins
    the row (nothing is refused, no behaviour moves), and the row is stamped
    ``ambiguous``: the sibling store's own word for writers that do not agree.
    """
    from app.api import deps

    repo = f"contested/{uuid4().hex[:8]}"
    slug = _slug("collide")

    async with _device_client(async_db_session, DEVICE_BEARER_WITH_TENANT) as client:
        first = await client.post(
            API_PREFIX,
            json=_payload(slug=slug, source_repo=repo, body="# tenant A's plan"),
        )
    assert first.status_code in (200, 201), first.text
    assert first.json()["artifact"]["tenant_source"] == "declared"
    assert first.json()["artifact"]["tenant_id"] == str(TENANT_A)

    # The SAME operator's device, acting for a DIFFERENT coord tenant. One
    # personal organization, one identity bucket — the fusion itself.
    second_bearer = "device-jwt-for-tenant-b"
    original = deps._verify_device_jwt
    user_holder: dict = {}

    async def _verify(token: str):
        if token == second_bearer:
            claims, user = await original(DEVICE_BEARER_WITH_TENANT)
            user_holder["u"] = user
            return ({**claims, "tenant_id": str(TENANT_B)}, user)
        return await original(token)

    monkeypatch.setattr(deps, "_verify_device_jwt", _verify)

    async with _device_client(async_db_session, second_bearer) as client:
        second = await client.post(
            API_PREFIX,
            json=_payload(slug=slug, source_repo=repo, body="# tenant B's plan"),
        )

    assert second.status_code in (200, 201), second.text
    artifact = second.json()["artifact"]
    # The write is RECORDED, not arbitrated: B still wins the row, exactly as
    # B's body does. What changed is that the corpus now SAYS so.
    assert artifact["tenant_id"] == str(TENANT_B)
    assert artifact["tenant_source"] == "ambiguous"

    async with _device_client(async_db_session, DEVICE_BEARER_WITH_TENANT) as client:
        resp = await client.get(f"{API_PREFIX}/divergent")

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    contested = [r for r in payload["contested_tenants"] if r["slug"] == slug]
    assert len(contested) == 1, payload["contested_tenants"]
    assert contested[0]["source_repo"] == repo
    # Never folded into the digest-divergence key — a reader who disposed of
    # this by picking a winner would be performing the data loss.
    assert all(g["slug"] != slug for g in payload["groups"])
    # And the count that stops an empty list reading as clean is present.
    assert payload["tenant_unattributed_count"] >= 0


async def test_an_uncontested_repush_is_not_stamped_ambiguous(
    async_db_session: AsyncSession, stub_device_jwt
) -> None:
    """One tenant pushing its own row twice is not a collision.

    The flag has to be earned by DISAGREEMENT, or every ordinary re-scan
    would raise it and the measurement would be noise.
    """
    repo = f"uncontested/{uuid4().hex[:8]}"
    slug = _slug("repush")

    async with _device_client(async_db_session, DEVICE_BEARER_WITH_TENANT) as client:
        await client.post(
            API_PREFIX, json=_payload(slug=slug, source_repo=repo, body="# v1")
        )
        again = await client.post(
            API_PREFIX, json=_payload(slug=slug, source_repo=repo, body="# v2")
        )

    assert again.status_code in (200, 201), again.text
    assert again.json()["artifact"]["tenant_source"] == "declared"


async def test_an_unattributed_row_is_not_contested_by_an_attributed_one(
    async_db_session: AsyncSession, stub_device_jwt
) -> None:
    """``unknown`` -> ``declared`` is the population HEALING, not a collision.

    Every pre-existing row is ``unknown``; the first Phase 2 push stamps it.
    Reading that as a contest would flag the entire corpus the moment the
    write path shipped.
    """
    repo = f"healing/{uuid4().hex[:8]}"
    slug = _slug("heal")

    async with _device_client(async_db_session, DEVICE_BEARER_NO_TENANT) as client:
        await client.post(
            API_PREFIX, json=_payload(slug=slug, source_repo=repo, body="# v1")
        )

    async with _device_client(async_db_session, DEVICE_BEARER_WITH_TENANT) as client:
        healed = await client.post(
            API_PREFIX, json=_payload(slug=slug, source_repo=repo, body="# v2")
        )

    assert healed.status_code in (200, 201), healed.text
    artifact = healed.json()["artifact"]
    assert artifact["tenant_source"] == "declared"
    assert artifact["tenant_id"] == str(TENANT_A)
