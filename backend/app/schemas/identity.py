"""Pydantic v2 schemas for cross-IdP account linking.

See :mod:`app.api.v1.endpoints.auth.identities` and
:mod:`app.services.cognito_admin`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class LinkedIdentity(BaseModel):
    """One identity linked to the caller's canonical Cognito account.

    Includes the synthetic native (``provider == "Cognito"``) identity as
    well as each linked external (federated) provider.
    """

    provider: str = Field(
        description='Provider name (e.g. "Cognito", "Google", "SignInWithApple").'
    )
    provider_type: str | None = Field(
        default=None,
        description='Provider type (e.g. "Google", "SAML", "OIDC", "Cognito").',
    )
    user_id: str | None = Field(
        default=None,
        description="The provider-scoped user id (for the native identity, the "
        "pool Username).",
    )
    primary: bool = Field(
        default=False, description="Whether this is the primary identity."
    )
    email: str | None = Field(default=None, description="Email on the account.")
    email_verified: bool | None = Field(
        default=None, description="Whether the email is verified, if known."
    )


class LinkRequest(BaseModel):
    """Body for POST /identities/link.

    ``id_token`` is a fresh Cognito ID token proving the caller controls
    the federated identity to be linked into their canonical account.
    """

    id_token: str = Field(
        description="A fresh Cognito ID token for the federated identity to link."
    )


class IdentityListResponse(BaseModel):
    """Response for GET /identities and POST /identities/link."""

    identities: list[LinkedIdentity] = Field(default_factory=list)
