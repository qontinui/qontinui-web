"""Database access for the Project Overview settings.

The project's settings (currency, working-day assumptions, ``editing_roles``)
are served by the hand-written ``/overview/settings`` routes in
``app/api/v1/endpoints/overview.py``. The estimate is a resource on the
authoring contract and keeps its database access in its own store,
``app.overview.estimates``.

**Every function that resolves a row takes ``tenant_id`` and filters on it.**
There is no row-level security, no tenant-scoped session and no FK to lean on,
so a lookup that forgets the predicate is a cross-tenant read.

Nothing in this module touches a ``coord.*`` table. The tenant is resolved
over coord's HTTP API by the endpoint layer and arrives here as a plain UUID.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import OverviewSettings


class VersionConflict(Exception):
    """A write was built on a copy the server has moved past.

    Carries the CURRENT version so the endpoint can tell the caller what to
    re-read, rather than only that it failed.
    """

    def __init__(self, current_version: int) -> None:
        super().__init__(f"version is now {current_version}")
        self.current_version = current_version


#: The settings a project has before anybody saves any. Served as-is (with
#: ``is_default: true``) rather than 404 or ``{}``, so "nobody has set this"
#: is distinguishable from "this is set to the default".
DEFAULT_SETTINGS = {
    "base_currency": "USD",
    "fx_rates": {},
    "labour_billing": "unbilled",
    "hours_per_day": Decimal("8"),
    "working_day_factor": Decimal("1.0"),
    "first_value_date": None,
    "editing_roles": ["admin"],
    "version": 0,
}


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


async def get_settings(db: AsyncSession, *, tenant_id: UUID) -> OverviewSettings | None:
    return await db.get(OverviewSettings, tenant_id)


def default_settings_row(tenant_id: UUID) -> OverviewSettings:
    """An UNSAVED settings row carrying the documented defaults.

    Used by the rollup so a project that has never opened the settings page
    still gets an honest working-day factor rather than a crash — and by the
    read endpoint, which marks it ``is_default``.
    """
    return OverviewSettings(tenant_id=tenant_id, **DEFAULT_SETTINGS)


async def upsert_settings(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    actor: str | None,
    base_currency: str,
    fx_rates: dict[str, Any],
    labour_billing: str,
    hours_per_day: Decimal,
    working_day_factor: Decimal,
    first_value_date: date | None,
    expected_version: int | None,
    editing_roles: Sequence[str] | None = None,
) -> OverviewSettings:
    # Locked AND refreshed, so the version comparison below and the write it
    # guards cannot interleave with a concurrent save. The refresh matters as
    # much as the lock: the request has usually read this row already (the
    # permission check does), and without `populate_existing` the session
    # hands back that cached copy — the lock is taken, but the version it
    # compares is the one read BEFORE it.
    row = await db.get(
        OverviewSettings, tenant_id, with_for_update=True, populate_existing=True
    )
    if row is None:
        if expected_version not in (None, 0):
            raise VersionConflict(0)
        row = OverviewSettings(tenant_id=tenant_id, created_by=actor, version=0)
        db.add(row)
    elif expected_version is not None and expected_version != row.version:
        raise VersionConflict(row.version)

    row.base_currency = base_currency
    row.fx_rates = fx_rates
    row.labour_billing = labour_billing
    row.hours_per_day = hours_per_day
    row.working_day_factor = working_day_factor
    row.first_value_date = first_value_date
    if editing_roles is not None:
        row.editing_roles = list(editing_roles)
    elif row.editing_roles is None:
        row.editing_roles = ["admin"]
    row.updated_by = actor
    row.updated_at = _now()
    row.version = (row.version or 0) + 1
    await db.flush()
    await db.refresh(row)
    return row
