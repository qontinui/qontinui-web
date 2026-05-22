"""Pair code model — short-lived, single-use codes for runner paste-pairing.

Phase 2a.1 of plan
``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``.

A **pair code** is a 6-character single-use credential the operator mints
from the dashboard and types into the runner's Settings UI. The runner
posts it to ``POST /api/v1/devices/pair-codes/{code}/redeem`` (an
**unauthenticated** endpoint — that's the point, the runner has no JWT
yet) and gets back the same ``PairCompleteResponse`` shape that the
existing ``pair-cli`` flow returns.

This is a distinct security class from
``RunnerToken`` (long-lived bearer tokens) — pair codes:

* Expire after 5 minutes (vs. unbounded for tokens).
* Are single-use (``redeemed_at`` is set on first successful redeem; any
  subsequent attempt 409s).
* Use a 32-char unambiguous alphabet (~30 bits of entropy for 6 chars)
  so an operator can read + retype without confusing 0/O or 1/I.
* Are tenant-scoped at mint time: the issuing operator's tenant is
  burned into the row, so the device JWT minted on redeem is correctly
  scoped without trusting the runner-side payload.

The redeem endpoint enforces single-use at the DB level via a
``FOR UPDATE`` row lock — see ``crud.pair_code_crud`` and
``app.api.v1.endpoints.pair_codes`` for the redeem implementation.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PairCode(Base):
    """Single-use 5-minute TTL pair code (``auth.pair_codes``).

    Schema-side guarantees:

    * ``code`` is the primary key — uniqueness is enforced.
    * ``expires_at`` is indexed for the periodic sweep query.
    * ``redeemed_at IS NULL`` is the consume invariant the redeem path
      enforces inside a row-locking SELECT.
    """

    __tablename__ = "pair_codes"
    __table_args__ = {"schema": "auth"}

    # ---- Identity ---------------------------------------------------------
    code: Mapped[str] = mapped_column(
        String(6),
        primary_key=True,
        comment=(
            "Uppercase 6-char code from the 32-char unambiguous alphabet (no 0/O/1/I)."
        ),
    )

    # ---- Tenant + issuer ---------------------------------------------------
    tenant_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=False,
        index=True,
        comment=(
            "Tenant the resulting device JWT will scope to — burned in at "
            "mint time from the issuing operator's resolved tenant."
        ),
    )
    issued_by_user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="Operator who minted this code.",
    )

    # ---- Lifecycle ---------------------------------------------------------
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now() + INTERVAL '5 minutes'"),
        index=True,
        comment="UTC; default 5 minutes after mint.",
    )

    # ---- Redemption (NULL until redeemed) ----------------------------------
    redeemed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Set on first successful redeem; single-use thereafter.",
    )
    redeemed_by_device_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        comment="Device that redeemed this code (UUID claimed by the runner).",
    )

    def __repr__(self) -> str:
        """Return repr; ``code`` is intentionally truncated."""
        return (
            f"<PairCode(code={self.code[:2]}…, tenant_id={self.tenant_id}, "
            f"redeemed={self.redeemed_at is not None})>"
        )
