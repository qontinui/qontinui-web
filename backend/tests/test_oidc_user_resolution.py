"""A token from a generic OIDC issuer, through the ONE auth path, to a User.

Drives ``verify_cognito_token_and_resolve_user`` (the path every HTTP and
WebSocket dependency uses) with tokens minted by a local issuer, against the
test database. Pins the identity-namespacing property: a ``sub`` resolves
only together with the issuer that minted it.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.cognito_user import (
    CognitoAuthError,
    IdentityConflictError,
    verify_cognito_token_and_resolve_user,
)
from app.auth.identity_roles import IdentityRole
from app.models.user import User
from app.models.user_oidc_identity import UserOIDCIdentity
from app.services import oidc_jwks
from app.services.oidc_jwks import OIDCIssuerClient, OIDCProvider, OIDCVerifier
from tests._oidc_local_issuer import DEFAULT_CLIENT, LocalIssuer, route

_KEYCLOAK = "https://kc.example.test/realms/acme"
_OKTA = "https://acme.okta.example.test/oauth2/default"
_COGNITO = "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_LOCAL"


_KEYCLOAK_ROLES = {
    "spec-analysts": (IdentityRole.ANALYST,),
    "kb-owners": (IdentityRole.KNOWLEDGE_OWNER, IdentityRole.AUDITOR),
}
_OKTA_ROLES = {"okta-analysts": (IdentityRole.ANALYST,)}
_COGNITO_ROLES = {"cognito-admins": (IdentityRole.ADMIN,)}


def _provider(
    issuer: str,
    kind: str,
    groups_claim: str,
    roles: dict[str, tuple[IdentityRole, ...]],
    link: bool,
) -> OIDCProvider:
    return OIDCProvider(
        issuer=issuer,
        audiences=frozenset({DEFAULT_CLIENT}),
        audience_claims=("aud", "client_id") if kind == "cognito" else ("aud",),
        groups_claim=groups_claim,
        issuer_setting=f"test:{kind}",
        kind=kind,  # type: ignore[arg-type]
        group_role_map=roles,
        link_existing_by_email=link,
    )


def _install_verifier(monkeypatch: pytest.MonkeyPatch, *, cognito_link: bool) -> None:
    """Keycloak: no email linking. Okta: opted in. Cognito: per argument."""
    verifier = OIDCVerifier(
        [
            OIDCIssuerClient(
                _provider(_KEYCLOAK, "oidc", "groups", _KEYCLOAK_ROLES, False)
            ),
            OIDCIssuerClient(_provider(_OKTA, "oidc", "groups", _OKTA_ROLES, True)),
            OIDCIssuerClient(
                _provider(
                    _COGNITO, "cognito", "cognito:groups", _COGNITO_ROLES, cognito_link
                )
            ),
        ]
    )
    monkeypatch.setattr(oidc_jwks, "oidc_verifier", verifier)


@pytest.fixture
def issuers(monkeypatch: pytest.MonkeyPatch) -> dict[str, LocalIssuer]:
    local = {
        "keycloak": LocalIssuer(_KEYCLOAK),
        "okta": LocalIssuer(_OKTA),
        "cognito": LocalIssuer(_COGNITO),
    }
    for issuer in local.values():
        issuer.add_rsa_key("k1")
    route(monkeypatch, *local.values())
    _install_verifier(monkeypatch, cognito_link=True)
    return local


def _unique(**over: Any) -> dict[str, Any]:
    tag = uuid.uuid4().hex[:10]
    fields: dict[str, Any] = {
        "sub": f"sub-{tag}",
        "email": f"user-{tag}@example.test",
    }
    fields.update(over)
    return fields


async def _identity_rows(session: AsyncSession, user_id: uuid.UUID) -> list[tuple]:
    rows = await session.execute(
        select(UserOIDCIdentity.issuer, UserOIDCIdentity.subject).where(
            UserOIDCIdentity.user_id == user_id
        )
    )
    return sorted(tuple(r) for r in rows.all())


@pytest.mark.asyncio
async def test_a_non_cognito_token_provisions_a_user_with_roles(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    fields = _unique(groups=["spec-analysts", "kb-owners", "unmapped"])
    token = issuers["keycloak"].mint("k1", **fields)

    user = await verify_cognito_token_and_resolve_user(token, async_db_session)

    assert user.email == fields["email"]
    assert user.cognito_sub is None, "a non-Cognito subject never lands here"
    assert user.is_verified is True
    assert user.identity_roles == {
        IdentityRole.ANALYST,
        IdentityRole.KNOWLEDGE_OWNER,
        IdentityRole.AUDITOR,
    }
    assert await _identity_rows(async_db_session, user.id) == [
        (_KEYCLOAK, fields["sub"])
    ]


@pytest.mark.asyncio
async def test_a_second_login_resolves_the_same_user(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    fields = _unique(groups=["spec-analysts"])
    first = await verify_cognito_token_and_resolve_user(
        issuers["keycloak"].mint("k1", **fields), async_db_session
    )
    # Group membership changed at the issuer: roles follow the NEW token.
    second = await verify_cognito_token_and_resolve_user(
        issuers["keycloak"].mint("k1", **{**fields, "groups": []}), async_db_session
    )

    assert second.id == first.id
    assert second.identity_roles == frozenset()
    count = await async_db_session.scalar(
        select(func.count())
        .select_from(UserOIDCIdentity)
        .where(UserOIDCIdentity.subject == fields["sub"])
    )
    assert count == 1


@pytest.mark.asyncio
async def test_the_same_sub_at_another_issuer_is_another_user(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    sub = f"shared-{uuid.uuid4().hex[:8]}"
    at_keycloak = await verify_cognito_token_and_resolve_user(
        issuers["keycloak"].mint("k1", **_unique(sub=sub)), async_db_session
    )
    at_okta = await verify_cognito_token_and_resolve_user(
        issuers["okta"].mint("k1", **_unique(sub=sub)), async_db_session
    )
    assert at_okta.id != at_keycloak.id


@pytest.mark.asyncio
async def test_a_generic_sub_never_resolves_a_cognito_user(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    sub = f"cog-{uuid.uuid4().hex[:8]}"
    cognito_user = await verify_cognito_token_and_resolve_user(
        issuers["cognito"].mint("k1", **_unique(sub=sub, groups=None)),
        async_db_session,
    )
    assert cognito_user.cognito_sub == sub

    generic_user = await verify_cognito_token_and_resolve_user(
        issuers["keycloak"].mint("k1", **_unique(sub=sub)), async_db_session
    )
    assert generic_user.id != cognito_user.id


@pytest.mark.asyncio
async def test_cognito_tokens_still_resolve_by_cognito_sub_with_roles(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    fields = _unique(groups=None, **{"cognito:groups": ["cognito-admins"]})
    user = await verify_cognito_token_and_resolve_user(
        issuers["cognito"].mint("k1", **fields), async_db_session
    )
    assert user.cognito_sub == fields["sub"]
    assert user.identity_roles == {IdentityRole.ADMIN}
    assert await _identity_rows(async_db_session, user.id) == []


async def _local_account(session: AsyncSession, email: str) -> User:
    """An account holding NO federated identity (e.g. created before SSO)."""
    user = User(
        id=uuid.uuid4(),
        email=email,
        username=f"local-{uuid.uuid4().hex[:8]}",
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_an_opted_in_issuer_links_a_local_account(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    email = f"linked-{uuid.uuid4().hex[:8]}@example.test"
    local = await _local_account(async_db_session, email)
    fields = _unique(email=email, email_verified=True)
    linked = await verify_cognito_token_and_resolve_user(
        issuers["okta"].mint("k1", **fields), async_db_session
    )
    assert linked.id == local.id
    assert await _identity_rows(async_db_session, local.id) == [(_OKTA, fields["sub"])]


@pytest.mark.asyncio
async def test_an_opted_in_issuer_never_claims_a_cognito_account(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    email = f"cog-{uuid.uuid4().hex[:8]}@example.test"
    cognito = await verify_cognito_token_and_resolve_user(
        issuers["cognito"].mint("k1", **_unique(email=email, groups=None)),
        async_db_session,
    )
    token = issuers["okta"].mint("k1", **_unique(email=email, email_verified=True))
    with pytest.raises(IdentityConflictError, match="account_has_cognito_identity"):
        await verify_cognito_token_and_resolve_user(token, async_db_session)
    assert await _identity_rows(async_db_session, cognito.id) == []


@pytest.mark.asyncio
async def test_an_opted_in_issuer_never_claims_another_issuers_account(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    email = f"kc-{uuid.uuid4().hex[:8]}@example.test"
    keycloak_fields = _unique(email=email)
    at_keycloak = await verify_cognito_token_and_resolve_user(
        issuers["keycloak"].mint("k1", **keycloak_fields), async_db_session
    )
    token = issuers["okta"].mint("k1", **_unique(email=email, email_verified=True))
    with pytest.raises(IdentityConflictError, match="account_has_oidc_identity"):
        await verify_cognito_token_and_resolve_user(token, async_db_session)
    assert await _identity_rows(async_db_session, at_keycloak.id) == [
        (_KEYCLOAK, keycloak_fields["sub"])
    ]


@pytest.mark.asyncio
async def test_the_same_issuer_under_another_sub_never_claims_the_account(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    email = f"okta-{uuid.uuid4().hex[:8]}@example.test"
    first = _unique(email=email, email_verified=True)
    owner = await verify_cognito_token_and_resolve_user(
        issuers["okta"].mint("k1", **first), async_db_session
    )
    second = _unique(email=email, email_verified=True)  # new sub, same email
    with pytest.raises(IdentityConflictError, match="account_has_oidc_identity"):
        await verify_cognito_token_and_resolve_user(
            issuers["okta"].mint("k1", **second), async_db_session
        )
    assert await _identity_rows(async_db_session, owner.id) == [(_OKTA, first["sub"])]


@pytest.mark.asyncio
async def test_cognito_never_overwrites_a_different_cognito_sub(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    email = f"pool-{uuid.uuid4().hex[:8]}@example.test"
    owner = await _cognito_account(issuers, async_db_session, email)
    original_sub = owner.cognito_sub
    with pytest.raises(IdentityConflictError, match="account_has_cognito_identity"):
        await _cognito_account(issuers, async_db_session, email)  # new sub
    await async_db_session.refresh(owner)
    assert owner.cognito_sub == original_sub


@pytest.mark.asyncio
async def test_an_email_taken_concurrently_by_another_account_is_a_409(
    issuers: dict[str, LocalIssuer],
    async_db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The insert races a DIFFERENT account for the email: no winner owns this
    identity, so the unique violation becomes a clean 409, not a 500."""
    from app.services import cognito_provision

    email = f"race-{uuid.uuid4().hex[:8]}@example.test"
    await _local_account(async_db_session, email)

    async def email_not_seen_yet(session: AsyncSession, value: str | None) -> None:
        return None  # the other account committed after our email lookup

    monkeypatch.setattr(cognito_provision, "_user_by_email", email_not_seen_yet)
    with pytest.raises(IdentityConflictError, match="account_conflict") as excinfo:
        await verify_cognito_token_and_resolve_user(
            issuers["keycloak"].mint("k1", **_unique(email=email)), async_db_session
        )
    assert excinfo.value.status_code == 409


async def _cognito_account(
    issuers: dict[str, LocalIssuer], session: AsyncSession, email: str
) -> User:
    return await verify_cognito_token_and_resolve_user(
        issuers["cognito"].mint("k1", **_unique(email=email, groups=None)), session
    )


def _email() -> str:
    return f"taken-{uuid.uuid4().hex[:8]}@example.test"


@pytest.mark.asyncio
async def test_an_issuer_not_opted_in_never_links_by_email(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    """Cross-issuer takeover: a VERIFIED email at an issuer that did not opt
    in must not attach to the existing account — refused with 409."""
    email = _email()
    existing = await _cognito_account(issuers, async_db_session, email)
    fields = _unique(email=email, email_verified=True)
    with pytest.raises(IdentityConflictError) as excinfo:
        await verify_cognito_token_and_resolve_user(
            issuers["keycloak"].mint("k1", **fields), async_db_session
        )
    assert excinfo.value.status_code == 409
    assert await _identity_rows(async_db_session, existing.id) == []


@pytest.mark.asyncio
async def test_an_unverified_colliding_email_is_rejected_even_when_opted_in(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    email = _email()
    await _cognito_account(issuers, async_db_session, email)
    token = issuers["okta"].mint("k1", **_unique(email=email, email_verified=None))
    with pytest.raises(IdentityConflictError):
        await verify_cognito_token_and_resolve_user(token, async_db_session)


@pytest.mark.asyncio
async def test_a_superuser_is_never_linked_automatically(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    email = _email()
    admin = await _cognito_account(issuers, async_db_session, email)
    admin.is_superuser = True
    await async_db_session.flush()
    token = issuers["okta"].mint("k1", **_unique(email=email, email_verified=True))
    with pytest.raises(IdentityConflictError, match="superuser"):
        await verify_cognito_token_and_resolve_user(token, async_db_session)
    assert await _identity_rows(async_db_session, admin.id) == []


@pytest.mark.asyncio
async def test_cognito_never_links_an_account_of_another_issuer(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    """The reverse direction: an account created via a generic issuer is not
    claimable by a Cognito token carrying the same verified email."""
    email = _email()
    generic = await verify_cognito_token_and_resolve_user(
        issuers["keycloak"].mint("k1", **_unique(email=email)), async_db_session
    )
    with pytest.raises(IdentityConflictError, match="account_has_oidc_identity"):
        await _cognito_account(issuers, async_db_session, email)
    await async_db_session.refresh(generic)
    assert generic.cognito_sub is None


@pytest.mark.asyncio
async def test_cognito_email_linking_can_be_switched_off(
    issuers: dict[str, LocalIssuer],
    async_db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = _email()
    local = User(
        id=uuid.uuid4(),
        email=email,
        username=f"local-{uuid.uuid4().hex[:8]}",
        is_active=True,
        is_verified=True,
        is_superuser=False,
    )
    async_db_session.add(local)
    await async_db_session.flush()

    _install_verifier(monkeypatch, cognito_link=False)
    with pytest.raises(IdentityConflictError, match="not_opted_in"):
        await _cognito_account(issuers, async_db_session, email)

    _install_verifier(monkeypatch, cognito_link=True)
    linked = await _cognito_account(issuers, async_db_session, email)
    assert linked.id == local.id


@pytest.mark.asyncio
async def test_role_maps_do_not_leak_across_issuers(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    """``kb-owners`` is mapped for Keycloak only; at Okta it means nothing."""
    at_okta = await verify_cognito_token_and_resolve_user(
        issuers["okta"].mint("k1", **_unique(groups=["kb-owners", "okta-analysts"])),
        async_db_session,
    )
    assert at_okta.identity_roles == {IdentityRole.ANALYST}


@pytest.mark.asyncio
async def test_a_concurrent_first_login_is_absorbed_generic(
    issuers: dict[str, LocalIssuer],
    async_db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two first logins race: the loser's insert hits the unique constraint,
    rolls back to its savepoint, and resolves to the winner — not a 500."""
    from app.services import cognito_provision

    fields = _unique(email=None, email_verified=None)
    token = issuers["keycloak"].mint("k1", **fields)
    winner = await verify_cognito_token_and_resolve_user(token, async_db_session)

    real = cognito_provision._user_by_oidc_identity
    calls = {"n": 0}

    async def miss_once(session: AsyncSession, issuer: str, sub: str) -> User | None:
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(session, issuer, sub)

    monkeypatch.setattr(cognito_provision, "_user_by_oidc_identity", miss_once)
    loser = await verify_cognito_token_and_resolve_user(token, async_db_session)

    assert loser.id == winner.id
    assert calls["n"] == 2, "the race path re-read after the unique violation"
    # The session is still usable after the rolled-back savepoint.
    assert await async_db_session.scalar(select(func.count()).select_from(User)) >= 1


@pytest.mark.asyncio
async def test_a_concurrent_first_login_is_absorbed_cognito(
    issuers: dict[str, LocalIssuer],
    async_db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import cognito_provision

    fields = _unique(email=None, email_verified=None, groups=None)
    token = issuers["cognito"].mint("k1", **fields)
    winner = await verify_cognito_token_and_resolve_user(token, async_db_session)

    real = cognito_provision._user_by_cognito_sub
    calls = {"n": 0}

    async def miss_once(session: AsyncSession, sub: str) -> User | None:
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(session, sub)

    monkeypatch.setattr(cognito_provision, "_user_by_cognito_sub", miss_once)
    loser = await verify_cognito_token_and_resolve_user(token, async_db_session)
    assert loser.id == winner.id
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_the_strategy_answers_409_for_a_refused_link(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import AsyncMock, MagicMock

    from fastapi import HTTPException
    from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

    from app.auth import cognito_user
    from app.auth.config import get_jwt_strategy

    monkeypatch.setattr(
        cognito_user,
        "verify_cognito_token_and_resolve_user",
        AsyncMock(side_effect=IdentityConflictError("refused")),
    )
    manager = MagicMock()
    manager.user_db = MagicMock(spec=SQLAlchemyUserDatabase)
    manager.user_db.session = MagicMock()
    with pytest.raises(HTTPException) as excinfo:
        await get_jwt_strategy().read_token("token", manager)
    assert excinfo.value.status_code == 409


@pytest.mark.asyncio
async def test_a_token_without_email_gets_a_stable_synthetic_address(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    fields = _unique(email=None, email_verified=None, sub="auth0|abc-123")
    user = await verify_cognito_token_and_resolve_user(
        issuers["okta"].mint("k1", **fields), async_db_session
    )
    assert user.email.startswith("oidc-")
    assert user.email.endswith("@no-reply.qontinui.io")
    assert "|" not in user.email
    assert user.is_verified is False
    stored = await async_db_session.scalar(select(User).where(User.id == user.id))
    assert stored is not None


@pytest.mark.asyncio
async def test_an_invalid_token_is_an_auth_error(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    token = issuers["keycloak"].mint("k1", **_unique(aud="another-app"))
    with pytest.raises(CognitoAuthError, match="Invalid token"):
        await verify_cognito_token_and_resolve_user(token, async_db_session)


@pytest.mark.asyncio
async def test_concurrent_first_links_attach_exactly_one_identity(
    issuers: dict[str, LocalIssuer],
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two first sign-ins (different subs, same verified email) race to link
    one identity-less account, in separate transactions: the row lock makes
    exactly one win and the other a 409 — never two identities on one
    account."""
    import asyncio

    from sqlalchemy import delete

    from app.services import cognito_provision

    email = f"race-link-{uuid.uuid4().hex[:8]}@example.test"
    async with AsyncSession(test_engine, expire_on_commit=False) as setup:
        local = await _local_account(setup, email)
        await setup.commit()

    real = cognito_provision._holds_oidc_identity

    async def slow_check(session: AsyncSession, user: User) -> bool:
        # Widen the window between "no identity yet" and the insert, so an
        # unlocked implementation lets BOTH transactions through.
        held = await real(session, user)
        await asyncio.sleep(0.3)
        return held

    monkeypatch.setattr(cognito_provision, "_holds_oidc_identity", slow_check)

    async def attempt(fields: dict[str, Any]) -> uuid.UUID | IdentityConflictError:
        async with AsyncSession(test_engine, expire_on_commit=False) as session:
            try:
                user = await verify_cognito_token_and_resolve_user(
                    issuers["okta"].mint("k1", **fields), session
                )
                await session.commit()
                return user.id
            except IdentityConflictError as exc:
                await session.rollback()
                return exc

    try:
        results = await asyncio.gather(
            attempt(_unique(email=email, email_verified=True)),
            attempt(_unique(email=email, email_verified=True)),
        )
        wins = [r for r in results if isinstance(r, uuid.UUID)]
        refusals = [r for r in results if isinstance(r, IdentityConflictError)]
        assert wins == [local.id]
        assert len(refusals) == 1 and refusals[0].status_code == 409

        async with AsyncSession(test_engine) as check:
            count = await check.scalar(
                select(func.count())
                .select_from(UserOIDCIdentity)
                .where(UserOIDCIdentity.user_id == local.id)
            )
        assert count == 1
    finally:
        async with AsyncSession(test_engine) as cleanup:
            await cleanup.execute(
                delete(UserOIDCIdentity).where(UserOIDCIdentity.user_id == local.id)
            )
            await cleanup.execute(delete(User).where(User.id == local.id))
            await cleanup.commit()
