"""An identity a user holds at a generic OpenID Connect issuer.

Cognito identities live on ``auth.users.cognito_sub``. Every OTHER accepted
issuer (``OIDC_PROVIDERS``) records its identities here, keyed by
``(issuer, subject)``: an OIDC ``sub`` is only unique WITHIN its issuer
(OIDC Core 1.0 §2), so a subject must never be looked up without the issuer
that minted it — otherwise an issuer the deployment trusts for one population
could mint a token whose ``sub`` resolves to another issuer's user.
"""

import uuid
from datetime import UTC, datetime

from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserOIDCIdentity(Base):
    """One ``(issuer, subject)`` pair resolved to one ``auth.users`` row."""

    __tablename__ = "user_oidc_identities"
    __table_args__ = (
        UniqueConstraint(
            "issuer", "subject", name="uq_user_oidc_identities_issuer_subject"
        ),
        {"schema": "auth"},
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey(
            "auth.users.id",
            ondelete="CASCADE",
            name="fk_user_oidc_identities_user_id",
        ),
        nullable=False,
        index=True,
    )
    # Normalised issuer (no trailing slash) exactly as the verifier routes it.
    issuer: Mapped[str] = mapped_column(String(2048), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
