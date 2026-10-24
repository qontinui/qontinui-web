"""The presentation scope — ``web.presentation_scopes``.

Plan ``2026-10-23-console-presentation-spaces`` Phase 1 (design decision D3.3).
Mirrors alembic revision ``presentation_scope_01``; read that migration's
docstring for the design rationale.

One row per coord tenant (what the console calls a "project"): the tenant's
own answer to "what may a presentation-mode render show?". Presentation mode
renders an item's free text (a plan, PR, session or finding title) only when
every repository the item belongs to has a FIRST-PARTY owner and the text
contains none of the CONFIDENTIAL terms; anything else becomes a structured
descriptor. This row stores the tenant-authored half of those two lists:

``first_party_owners``
    The GitHub owners whose repositories are the tenant's own. ``NULL`` means
    "not configured": the read door then derives them from the owners of the
    tenant's registered repositories. An empty array is a real choice — no
    owner is first-party, so every title is withheld.
``confidential_terms``
    Words that withhold free text wherever they appear. The read door ADDS the
    viewer's other projects' names to these on every read and never stores
    them here: they are the viewer's, not the tenant's, and a row every member
    can read must not carry one admin's other memberships.
``version``
    Starts at 1 and moves by one on every write. A write names the version it
    read and is refused when the row moved, so two admins editing at once
    cannot silently drop each other's terms — a lost confidential term is a
    client's name on screen. A write also names the TENANT whose scope it read
    (``expected_tenant_id``) and is refused when the request resolves to
    another, so an edit made for one project is never saved into another's
    row: the compare-and-set binds (tenant, version).

No row means the documented defaults, never "no scope": the read door answers
with them. Scoping: ``tenant_id`` is the active coord tenant with no FK (coord's
tenants live in coord's deployment), so every query filters on it explicitly.
Nothing here reads or references a ``coord.*`` table.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Text, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

#: The most first-party owners one tenant may name. A tenant spans a handful
#: of GitHub owners; fifty is headroom, not a target. Enforced by
#: ``ck_presentation_scopes_owner_count`` and by the write schema.
MAX_FIRST_PARTY_OWNERS = 50

#: The most confidential terms one tenant may store. Each is matched against
#: every title a presentation renders, so the bound keeps that cheap.
#: Enforced by ``ck_presentation_scopes_term_count`` and by the write schema.
MAX_CONFIDENTIAL_TERMS = 200

#: The longest confidential term, in characters (the write schema's bound).
MAX_CONFIDENTIAL_TERM_LENGTH = 120

#: The largest ``version`` the column holds: it is ``INTEGER`` (int4). The
#: write schema bounds ``expected_version`` by it, so an out-of-range value is
#: a 422 rather than a driver error and a 500.
MAX_SCOPE_VERSION = 2**31 - 1


def _now() -> datetime:
    return datetime.now(UTC)


class PresentationScope(Base):
    """A tenant's stored presentation scope (see the module docstring)."""

    __tablename__ = "presentation_scopes"
    __table_args__ = (
        CheckConstraint(
            "first_party_owners IS NULL OR "
            f"cardinality(first_party_owners) <= {MAX_FIRST_PARTY_OWNERS}",
            name="ck_presentation_scopes_owner_count",
        ),
        CheckConstraint(
            f"cardinality(confidential_terms) <= {MAX_CONFIDENTIAL_TERMS}",
            name="ck_presentation_scopes_term_count",
        ),
        CheckConstraint("version >= 1", name="ck_presentation_scopes_version"),
        {"schema": "web"},
    )

    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    first_party_owners: Mapped[list[str] | None] = mapped_column(
        ARRAY(Text), nullable=True
    )
    confidential_terms: Mapped[list[str]] = mapped_column(
        ARRAY(Text),
        nullable=False,
        default=list,
        server_default=text("'{}'::text[]"),
    )
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )
    updated_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            "auth.users.id",
            ondelete="SET NULL",
            name="fk_presentation_scopes_updated_by",
        ),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )

    def __repr__(self) -> str:
        """Return repr."""
        return f"<PresentationScope(tenant={self.tenant_id}, version={self.version})>"
