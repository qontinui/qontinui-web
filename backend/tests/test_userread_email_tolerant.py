"""Regression: UserRead must not 500 on a synthetic/placeholder email.

A federated identity (e.g. Google) that hides its email is provisioned with a
synthetic address (``cognito_provision``). The ``/users/me`` read path validates
the stored row against ``UserRead``. When ``UserRead.email`` was ``EmailStr``, a
synthetic address raised ``ValidationError`` -> unhandled 500 — which the browser
surfaced as a CORS / "Failed to fetch" error on the OAuth callback. ``UserRead``
now overrides ``email`` to a plain ``str``: a read schema renders stored data, it
does not re-validate it (incoming emails are still validated on
``UserCreate``/``UserUpdate``).
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.schemas.user import UserRead


def _payload(email: str) -> dict:
    now = datetime.now(UTC)
    return {
        "id": uuid4(),
        "email": email,
        "is_active": True,
        "is_superuser": False,
        "is_verified": False,
        "username": "u",
        "subscription_tier": "free",
        "created_at": now,
        "updated_at": now,
    }


@pytest.mark.parametrize(
    "email",
    [
        "real.user@example.com",
        # synthetic placeholder for an email-less federated identity (new domain)
        f"{uuid4()}@no-reply.qontinui.io",
        # legacy rows already persisted with the reserved `.local` TLD must still
        # render rather than 500 — this is the bug that locked out Google sign-in.
        f"{uuid4()}@cognito.local",
    ],
)
def test_userread_accepts_synthetic_email(email: str) -> None:
    model = UserRead.model_validate(_payload(email))
    assert model.email == email
