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
    verify_cognito_token_and_resolve_user,
)
from app.auth.identity_roles import IdentityRole
from app.core.config import settings
from app.models.user import User
from app.models.user_oidc_identity import UserOIDCIdentity
from app.services import oidc_jwks
from app.services.oidc_jwks import OIDCIssuerClient, OIDCProvider, OIDCVerifier
from tests._oidc_local_issuer import DEFAULT_CLIENT, LocalIssuer, route

_KEYCLOAK = "https://kc.example.test/realms/acme"
_OKTA = "https://acme.okta.example.test/oauth2/default"
_COGNITO = "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_LOCAL"


def _provider(issuer: str, kind: str, groups_claim: str) -> OIDCProvider:
    return OIDCProvider(
        issuer=issuer,
        audiences=frozenset({DEFAULT_CLIENT}),
        audience_claims=("aud", "client_id") if kind == "cognito" else ("aud",),
        groups_claim=groups_claim,
        issuer_setting=f"test:{kind}",
        kind=kind,  # type: ignore[arg-type]
    )


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
    verifier = OIDCVerifier(
        [
            OIDCIssuerClient(_provider(_KEYCLOAK, "oidc", "groups")),
            OIDCIssuerClient(_provider(_OKTA, "oidc", "groups")),
            OIDCIssuerClient(_provider(_COGNITO, "cognito", "cognito:groups")),
        ]
    )
    monkeypatch.setattr(oidc_jwks, "oidc_verifier", verifier)
    monkeypatch.setattr(
        settings,
        "OIDC_GROUP_ROLE_MAP",
        {
            "spec-analysts": [IdentityRole.ANALYST],
            "kb-owners": [IdentityRole.KNOWLEDGE_OWNER, IdentityRole.AUDITOR],
            "cognito-admins": [IdentityRole.ADMIN],
        },
    )
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


@pytest.mark.asyncio
async def test_a_verified_email_links_the_existing_account(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    email = f"linked-{uuid.uuid4().hex[:8]}@example.test"
    existing = await verify_cognito_token_and_resolve_user(
        issuers["cognito"].mint("k1", **_unique(email=email, groups=None)),
        async_db_session,
    )
    fields = _unique(email=email, email_verified=True)
    linked = await verify_cognito_token_and_resolve_user(
        issuers["okta"].mint("k1", **fields), async_db_session
    )
    assert linked.id == existing.id
    assert await _identity_rows(async_db_session, existing.id) == [
        (_OKTA, fields["sub"])
    ]


@pytest.mark.asyncio
async def test_an_unverified_colliding_email_is_rejected(
    issuers: dict[str, LocalIssuer], async_db_session: AsyncSession
) -> None:
    email = f"taken-{uuid.uuid4().hex[:8]}@example.test"
    await verify_cognito_token_and_resolve_user(
        issuers["cognito"].mint("k1", **_unique(email=email, groups=None)),
        async_db_session,
    )
    token = issuers["keycloak"].mint("k1", **_unique(email=email, email_verified=None))
    with pytest.raises(CognitoAuthError, match="could not be resolved"):
        await verify_cognito_token_and_resolve_user(token, async_db_session)


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
