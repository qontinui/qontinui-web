"""Issuer group -> role mapping (per issuer: ``group_role_map`` / ``COGNITO_GROUP_ROLE_MAP``)."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.auth.identity_roles import (
    IdentityRole,
    derive_roles,
    groups_from_claims,
    require_identity_roles,
)
from app.core.config import OIDCProviderSetting, Settings
from app.services.oidc_jwks import build_providers

_ISOLATED_DB = "postgresql://user:pass@localhost/isolated"


def test_the_role_vocabulary_is_the_seven_named_roles() -> None:
    assert {r.value for r in IdentityRole} == {
        "analyst",
        "knowledge_owner",
        "developer",
        "tester",
        "support",
        "admin",
        "auditor",
    }


@pytest.mark.parametrize(
    ("claims", "claim", "expected"),
    [
        ({"groups": ["a", "b"]}, "groups", ["a", "b"]),
        ({"groups": "solo"}, "groups", ["solo"]),
        ({"groups": ["a", 7, "", None]}, "groups", ["a"]),
        ({"groups": {"not": "a list"}}, "groups", []),
        ({}, "groups", []),
        ({"cognito:groups": ["admins"]}, "cognito:groups", ["admins"]),
        ({"realm_access": {"roles": ["dev"]}}, "realm_access.roles", ["dev"]),
        ({"realm_access": ["dev"]}, "realm_access.roles", []),
        # A literal dotted key wins over the nested walk.
        (
            {"https://x.test/groups": ["lit"], "https://x": {"test/groups": ["no"]}},
            "https://x.test/groups",
            ["lit"],
        ),
    ],
)
def test_groups_are_read_from_the_configured_claim(
    claims: dict[str, Any], claim: str, expected: list[str]
) -> None:
    assert groups_from_claims(claims, claim) == expected


def test_entra_groups_overage_yields_no_groups() -> None:
    """Past Entra's overage limit ``groups`` is absent; fail closed."""
    claims = {
        "sub": "u1",
        "_claim_names": {"groups": "src1"},
        "_claim_sources": {"src1": {"endpoint": "https://graph.example/..."}},
    }
    assert groups_from_claims(claims, "groups") == []


def test_derive_roles_unions_every_mapped_group() -> None:
    mapping = {
        "analysts": [IdentityRole.ANALYST],
        "platform": [IdentityRole.DEVELOPER, IdentityRole.TESTER],
        "it-admins": [IdentityRole.ADMIN],
    }
    roles = derive_roles(["analysts", "platform", "unmapped"], mapping)
    assert roles == {IdentityRole.ANALYST, IdentityRole.DEVELOPER, IdentityRole.TESTER}
    assert derive_roles([], mapping) == frozenset()
    assert derive_roles(["unmapped"], mapping) == frozenset()


def test_cognito_role_map_parses_from_env_json_with_shorthand(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "COGNITO_GROUP_ROLE_MAP",
        json.dumps({"kb-owners": "knowledge_owner", "ops": ["support", "auditor"]}),
    )
    cfg = Settings(_env_file=None, DATABASE_URL=_ISOLATED_DB)
    assert cfg.COGNITO_GROUP_ROLE_MAP == {
        "kb-owners": [IdentityRole.KNOWLEDGE_OWNER],
        "ops": [IdentityRole.SUPPORT, IdentityRole.AUDITOR],
    }


def test_each_provider_carries_its_own_role_map(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Group names mean nothing across issuers, so maps never mix."""
    monkeypatch.setenv("COGNITO_GROUP_ROLE_MAP", json.dumps({"admins": "admin"}))
    monkeypatch.setenv(
        "OIDC_PROVIDERS",
        json.dumps(
            [
                {
                    "issuer": "https://kc.example.test/realms/a",
                    "audiences": ["web"],
                    "group_role_map": {"admins": "auditor", "qa": ["tester"]},
                },
                {"issuer": "https://okta.example.test", "audiences": ["web"]},
            ]
        ),
    )
    cfg = Settings(
        _env_file=None,
        DATABASE_URL=_ISOLATED_DB,
        COGNITO_ISSUER="https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_X",
    )
    cognito, keycloak, okta = build_providers(cfg)
    assert dict(cognito.group_role_map) == {"admins": (IdentityRole.ADMIN,)}
    assert dict(keycloak.group_role_map) == {
        "admins": (IdentityRole.AUDITOR,),
        "qa": (IdentityRole.TESTER,),
    }
    assert dict(okta.group_role_map) == {}
    assert derive_roles(["admins"], keycloak.group_role_map) == {IdentityRole.AUDITOR}
    assert derive_roles(["admins"], okta.group_role_map) == frozenset()


def test_role_maps_refuse_an_unknown_role() -> None:
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            DATABASE_URL=_ISOLATED_DB,
            COGNITO_GROUP_ROLE_MAP={"g": ["superuser"]},
        )
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            DATABASE_URL=_ISOLATED_DB,
            OIDC_PROVIDERS=[
                {
                    "issuer": "https://kc.example.test",
                    "audiences": ["web"],
                    "group_role_map": {"g": "root"},
                }
            ],
        )


def test_defaults() -> None:
    cfg = Settings(_env_file=None, DATABASE_URL=_ISOLATED_DB)
    assert cfg.COGNITO_GROUP_ROLE_MAP == {}
    assert cfg.COGNITO_GROUPS_CLAIM == "cognito:groups"
    assert cfg.COGNITO_LINK_EXISTING_BY_EMAIL is True
    provider = OIDCProviderSetting(issuer="https://kc.example.test", audiences=["w"])
    assert provider.link_existing_by_email is False
    assert provider.group_role_map == {}


@pytest.mark.asyncio
async def test_require_identity_roles_admits_a_holder_and_refuses_others() -> None:
    dependency = require_identity_roles(IdentityRole.ADMIN, IdentityRole.AUDITOR)

    auditor = SimpleNamespace(identity_roles=frozenset({IdentityRole.AUDITOR}))
    assert await dependency(user=auditor) is auditor

    analyst = SimpleNamespace(identity_roles=frozenset({IdentityRole.ANALYST}))
    with pytest.raises(HTTPException) as excinfo:
        await dependency(user=analyst)
    assert excinfo.value.status_code == 403

    nobody = SimpleNamespace()
    with pytest.raises(HTTPException):
        await dependency(user=nobody)


def test_require_identity_roles_needs_a_role() -> None:
    with pytest.raises(ValueError):
        require_identity_roles()
