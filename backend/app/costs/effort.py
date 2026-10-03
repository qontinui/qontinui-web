"""The ``costs/effort-entries`` resource: logged time, on the authoring
contract (plan ``2026-09-20-overview-authoring-layer`` Phase 5).

Permission rule ``member_self`` (business-leaders plan, open question 1:
"admins only, except optional effort logging, which any member may do for
themselves"):

* any member of the project may log, edit and delete THEIR OWN time — an
  entry whose ``person_user_id`` is theirs;
* whoever ``editing_roles`` admits may write anybody's;
* anything else is ``403 not_your_entry``. Every read serves ``editable`` per
  entry from the same rule, so the UI offers an edit only where the API will
  take it.

Rate snapshot: under ``labour_billing = day_rates`` an entry is priced when it
is logged — the baseline estimate's role (by ``role_code``), its day rate and
currency, and the project's hours per day are copied onto it, so a later rate
edit never rewrites history. A role the baseline does not price is ``422
role_not_priced``. Changing an entry's role re-prices it; an entry logged
before day rates applied is priced on its next edit. Under any other setting
the snapshot is empty and no cost derives from the entry.

A person's day holds at most 24 hours across all their entries (``422
day_over_24h``); the check runs under a per-person-day advisory lock, so two
concurrent saves cannot both pass it.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

import structlog
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.costs.entries import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
from app.costs.integrity import refusal_for
from app.costs.labour import entry_cost_micros, person_key
from app.crud import overview_settings
from app.models.overview import (
    MAX_HOURS_PER_DAY,
    EffortEntry,
    Estimate,
    EstimateRole,
    OverviewSettings,
    Phase,
)
from app.models.user import User
from app.overview.permissions import OverviewAccess, PermissionRule
from app.overview.precision import numeric
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
    StoreRefused,
)
from app.schemas.overview import _WriteModel

logger = structlog.get_logger(__name__)

Hours = Annotated[Decimal, numeric(5, 2, gt=0, le=MAX_HOURS_PER_DAY)]

#: The ``member_self`` rule's name in the registry, used for the per-record
#: ownership decision.
RULE: PermissionRule = "member_self"


class EffortEntryRead(BaseModel):
    id: str
    work_date: date
    person: str
    person_user_id: str | None
    hours: Decimal
    role_code: str | None
    phase_id: str | None
    task_number: str | None
    note: str
    #: The day rate this entry was priced at (``day_rates`` only), in
    #: ``rate_currency``, with the hours that made a day then. All three are
    #: ``null`` together: the entry carries no cost.
    rate_micros_used: int | None
    rate_currency: str | None
    hours_per_day_used: Decimal | None
    #: ``hours ÷ hours_per_day_used × rate_micros_used`` in ``rate_currency``;
    #: ``null`` when the entry carries no rate.
    cost_micros: int | None
    #: Whether the CALLER may edit or delete this entry — their own, or they
    #: may edit anybody's. The API enforces the same answer.
    editable: bool
    version: int
    created_at: datetime
    updated_at: datetime
    created_by: str | None
    updated_by: str | None


class EffortEntryCreate(_WriteModel):
    model_config = ConfigDict(extra="forbid")

    work_date: date
    hours: Hours
    #: Who did the work. Defaults to the caller.
    person: str | None = Field(default=None, min_length=1, max_length=200)
    #: The qontinui user who did it. Defaults to the caller; only an editor
    #: may name someone else.
    person_user_id: UUID | None = None
    #: The estimate role the time was worked as (its code, e.g. ``BE``).
    #: Required under ``day_rates``, where it prices the entry.
    role_code: str | None = Field(default=None, min_length=1, max_length=50)
    phase_id: UUID | None = None
    task_number: str | None = Field(default=None, min_length=1, max_length=50)
    note: str = Field(default="", max_length=2000)


class EffortEntryUpdate(_WriteModel):
    """Partial: a field left out is unchanged; ``null`` clears a nullable one."""

    model_config = ConfigDict(extra="forbid")

    work_date: date | None = None
    hours: Hours | None = None
    person: str | None = Field(default=None, min_length=1, max_length=200)
    person_user_id: UUID | None = None
    role_code: str | None = Field(default=None, min_length=1, max_length=50)
    phase_id: UUID | None = None
    task_number: str | None = Field(default=None, min_length=1, max_length=50)
    note: str | None = Field(default=None, max_length=2000)


def _owned(row: EffortEntry, access: OverviewAccess) -> bool:
    return access.user_id is not None and row.person_user_id == access.user_id


def editable_by(row: EffortEntry, access: OverviewAccess) -> bool:
    return access.can_edit_others(RULE) or (
        access.can_edit(RULE) and _owned(row, access)
    )


def _read(row: EffortEntry, access: OverviewAccess) -> EffortEntryRead:
    priced = row.rate_micros_used is not None and row.hours_per_day_used is not None
    return EffortEntryRead(
        id=str(row.id),
        work_date=row.work_date,
        person=row.person,
        person_user_id=str(row.person_user_id) if row.person_user_id else None,
        hours=Decimal(row.hours),
        role_code=row.role_code,
        phase_id=str(row.phase_id) if row.phase_id else None,
        task_number=row.task_number,
        note=row.note,
        rate_micros_used=row.rate_micros_used,
        rate_currency=row.rate_currency,
        hours_per_day_used=row.hours_per_day_used,
        cost_micros=(
            entry_cost_micros(
                Decimal(row.hours),
                int(row.rate_micros_used),  # type: ignore[arg-type]
                Decimal(row.hours_per_day_used),  # type: ignore[arg-type]
            )
            if priced
            else None
        ),
        editable=editable_by(row, access),
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
        created_by=row.created_by,
        updated_by=row.updated_by,
    )


def _not_yours() -> StoreRefused:
    return StoreRefused(
        403,
        "not_your_entry",
        "You can log and change your own time only; this entry is someone else's.",
    )


def _parse_id(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise RecordNotFound(value) from exc


async def project_member_by_subject(tenant_id: UUID, subject: str) -> bool | None:
    """Whether the coord operator with Cognito subject ``subject`` is a member
    of the ACTIVE project — or ``None`` when coord does not answer.

    Matched on the SUBJECT, never the e-mail: ``coord.operators`` is unique
    on ``(sso_provider, sso_subject)`` while its e-mail is neither unique nor
    stable (a user may rename themselves), so an e-mail match could name the
    wrong person (coord ``routes_phase3.rs::get_operators_list``; the same
    match ``app.services.coord_operator_activation`` makes). The
    ``?sso_subject=`` filter is ANDed with membership coord-side, so at most
    this one member comes back.

    Coord serves this list to a project ADMIN only (``require_role("admin")``)
    and offers no member-readable "is X a member" door, so it is read with the
    caller's own bearer; a refusal or an unreachable coord is ``None`` —
    UNKNOWN, never assumed either way."""
    from app.api.v1.endpoints.operations import (
        ACTIVE_TENANT_HEADER,
        _proxy_coord_get,
    )

    try:
        body = await _proxy_coord_get(
            "/admin/coord/operators",
            params={"sso_subject": subject},
            tenant_id=tenant_id,
            headers={ACTIVE_TENANT_HEADER: str(tenant_id)},
        )
    except Exception:  # noqa: BLE001 — any refusal is "cannot tell"
        logger.info("effort_member_lookup_unavailable", tenant_id=str(tenant_id))
        return None
    operators = body.get("operators") if isinstance(body, dict) else None
    if not isinstance(operators, list):
        return None
    return any(
        isinstance(op, dict) and str(op.get("sso_subject") or "").strip() == subject
        for op in operators
    )


#: Why someone other than a project admin cannot name another member by
#: account — the coord door that answers it is admin-only.
NAME_BY_PERSON = (
    "only a project admin can name another member by account (coord answers "
    "membership to admins only); name them in `person` instead"
)


class EffortEntryStore:
    async def _settings(self, ctx: StoreContext) -> OverviewSettings:
        row = await overview_settings.get_settings(
            db=ctx.db, tenant_id=ctx.access.tenant_id
        )
        return row or overview_settings.default_settings_row(ctx.access.tenant_id)

    async def _load(
        self, ctx: StoreContext, record_id: str, *, lock: bool = False
    ) -> EffortEntry:
        stmt = select(EffortEntry).where(
            EffortEntry.id == _parse_id(record_id),
            EffortEntry.tenant_id == ctx.access.tenant_id,
        )
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        row = (await ctx.db.execute(stmt)).scalars().first()
        if row is None:
            raise RecordNotFound(record_id)
        return row

    async def _check_phase(self, ctx: StoreContext, phase_id: UUID | None) -> None:
        if phase_id is None:
            return
        found = await ctx.db.scalar(
            select(Phase.id).where(
                Phase.id == phase_id, Phase.tenant_id == ctx.access.tenant_id
            )
        )
        if found is None:
            raise StoreRefused(
                422, "unknown_phase", "There is no such phase in this project."
            )

    async def _price(
        self, ctx: StoreContext, row: EffortEntry, settings: OverviewSettings
    ) -> None:
        """Snapshot what the entry costs at its role's rate today.

        Under ``day_rates`` the price is required: no role, or a role the
        baseline does not price, is refused. Under any other setting this runs
        only when the entry's ROLE changes: the old snapshot no longer
        describes it, so it is replaced by the new role's rate where the
        baseline has one and cleared where it does not — never refused, since
        nothing is billed by it now."""
        strict = settings.labour_billing == "day_rates"
        if row.role_code is None and not strict:
            self._clear_price(row)
            return
        if row.role_code is None:
            raise StoreRefused(
                422,
                "role_required",
                "Labour is billed by day rate on this project, so a time entry "
                "names the role it was worked as (role_code) to be priced.",
            )
        role = (
            (
                await ctx.db.execute(
                    select(EstimateRole)
                    .join(Estimate, Estimate.id == EstimateRole.estimate_id)
                    .where(
                        Estimate.tenant_id == ctx.access.tenant_id,
                        Estimate.is_baseline.is_(True),
                        EstimateRole.code == row.role_code,
                    )
                )
            )
            .scalars()
            .first()
        )
        if (
            role is None
            or role.client_side
            or role.day_rate_micros is None
            or role.currency is None
        ):
            if not strict:
                self._clear_price(row)
                return
            where = (
                "the baseline estimate has no such role"
                if role is None
                else "the baseline estimate gives that role no day rate"
            )
            raise StoreRefused(
                422,
                "role_not_priced",
                f"Role {row.role_code!r} cannot price this time: {where}. Labour "
                "is billed by day rate on this project.",
            )
        row.rate_micros_used = role.day_rate_micros
        row.rate_currency = role.currency
        row.hours_per_day_used = Decimal(settings.hours_per_day)

    @staticmethod
    def _clear_price(row: EffortEntry) -> None:
        row.rate_micros_used = None
        row.rate_currency = None
        row.hours_per_day_used = None

    async def _check_person(self, ctx: StoreContext, user_id: UUID) -> None:
        """Time logged FOR someone else names a member of this project,
        matched by account subject. Runs BEFORE any row lock is taken: it may
        call coord."""
        user = await ctx.db.get(User, user_id)
        if user is None:
            raise StoreRefused(
                422, "unknown_person", "There is no such user to log time for."
            )
        if not ctx.access.can_edit("project_admin"):
            raise StoreRefused(
                422,
                "membership_unverified",
                f"Whether that user is a member cannot be checked: {NAME_BY_PERSON}.",
            )
        subject = (user.cognito_sub or "").strip()
        if not subject:
            raise StoreRefused(
                422,
                "membership_unverified",
                "That user has no sign-in account coord can match, so their "
                "membership cannot be checked; name them in `person` instead.",
            )
        member = await project_member_by_subject(ctx.access.tenant_id, subject)
        if member is None:
            raise StoreRefused(
                422,
                "membership_unverified",
                "Whether that user is a member of this project cannot be checked "
                "right now (coord did not answer); name them in `person` instead.",
            )
        if not member:
            raise StoreRefused(
                422, "not_a_member", "That user is not a member of this project."
            )

    async def _display_name(self, ctx: StoreContext) -> str | None:
        """The caller as people know them: their name, else their e-mail."""
        if ctx.access.user_id is None:
            return ctx.access.actor
        user = await ctx.db.get(User, ctx.access.user_id)
        if user is not None and (user.full_name or "").strip():
            return str(user.full_name).strip()
        return ctx.access.actor

    async def _flush(self, ctx: StoreContext, add: Any = None) -> None:
        try:
            async with ctx.db.begin_nested():
                if add is not None:
                    ctx.db.add(add)
                await ctx.db.flush()
        except IntegrityError as exc:
            raise refusal_for(exc) from exc

    async def _check_day(self, ctx: StoreContext, row: EffortEntry) -> None:
        """At most 24 hours per person per day, across all their entries."""
        key = person_key(row.person_user_id, row.person)
        await ctx.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": f"effort:{ctx.access.tenant_id}:{key}:{row.work_date.isoformat()}"},
        )
        stmt = select(func.coalesce(func.sum(EffortEntry.hours), 0)).where(
            EffortEntry.tenant_id == ctx.access.tenant_id,
            EffortEntry.work_date == row.work_date,
        )
        if row.person_user_id is not None:
            stmt = stmt.where(EffortEntry.person_user_id == row.person_user_id)
        else:
            stmt = stmt.where(
                EffortEntry.person_user_id.is_(None),
                func.lower(
                    func.regexp_replace(func.trim(EffortEntry.person), r"\s+", " ", "g")
                )
                == " ".join(row.person.split()).lower(),
            )
        if row.id is not None:
            stmt = stmt.where(EffortEntry.id != row.id)
        others = Decimal((await ctx.db.execute(stmt)).scalar_one())
        if others + Decimal(row.hours) > MAX_HOURS_PER_DAY:
            raise StoreRefused(
                422,
                "day_over_24h",
                f"{row.person} already has {others} hours on "
                f"{row.work_date.isoformat()}; a day holds at most "
                f"{MAX_HOURS_PER_DAY}.",
            )

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        stmt = select(EffortEntry).where(EffortEntry.tenant_id == ctx.access.tenant_id)
        try:
            for raw in filters.get("from", []):
                stmt = stmt.where(EffortEntry.work_date >= date.fromisoformat(raw))
            for raw in filters.get("to", []):
                stmt = stmt.where(EffortEntry.work_date <= date.fromisoformat(raw))
            for raw in filters.get("phase_id", []):
                stmt = stmt.where(
                    EffortEntry.phase_id.is_(None)
                    if raw == "none"
                    else EffortEntry.phase_id == UUID(raw)
                )
            for raw in filters.get("person_user_id", []):
                stmt = stmt.where(EffortEntry.person_user_id == UUID(raw))
            limits = [int(raw) for raw in filters.get("limit", [])]
        except ValueError as exc:
            raise StoreRefused(
                422,
                "bad_filter",
                "from/to are dates (YYYY-MM-DD); phase_id and person_user_id "
                "are ids (phase_id may be 'none'); limit is a number.",
            ) from exc
        limit = (
            min(max(limits[-1], 1), MAX_LIST_LIMIT) if limits else DEFAULT_LIST_LIMIT
        )
        if "true" in filters.get("mine", []):
            stmt = stmt.where(EffortEntry.person_user_id == ctx.access.user_id)
        rows = (
            await ctx.db.execute(
                stmt.order_by(
                    EffortEntry.work_date.desc(),
                    EffortEntry.created_at.desc(),
                    EffortEntry.id,
                ).limit(limit + 1)
            )
        ).scalars()
        found = rows.all()
        items: list[BaseModel] = [_read(r, ctx.access) for r in found[:limit]]
        degraded = None
        if len(found) > limit:
            degraded = (
                f"truncated: only the newest {limit} entries are listed; narrow "
                "with from/to/person_user_id, raise limit (at most "
                f"{MAX_LIST_LIMIT}), or page through GET /costs/ledger"
            )
        return ListResult(items=items, degraded=degraded)

    async def get(self, ctx: StoreContext, record_id: str) -> BaseModel:
        return _read(await self._load(ctx, record_id), ctx.access)

    async def create(self, ctx: StoreContext, payload: BaseModel) -> BaseModel:
        assert isinstance(payload, EffortEntryCreate)
        access = ctx.access
        others = access.can_edit_others(RULE)
        user_id = payload.person_user_id or (
            access.user_id if payload.person is None or not others else None
        )
        if not others and (access.user_id is None or user_id != access.user_id):
            raise _not_yours()
        if user_id is not None and user_id != access.user_id:
            await self._check_person(ctx, user_id)
        person = payload.person or (
            await self._display_name(ctx) if user_id == access.user_id else None
        )
        if person is None:
            raise StoreRefused(
                422,
                "person_required",
                "Name the person whose time this is (person).",
            )
        await self._check_phase(ctx, payload.phase_id)
        row = EffortEntry(
            tenant_id=access.tenant_id,
            work_date=payload.work_date,
            person=person,
            person_user_id=user_id,
            hours=payload.hours,
            role_code=payload.role_code,
            phase_id=payload.phase_id,
            task_number=payload.task_number,
            note=payload.note,
            version=1,
            created_by=access.actor,
            updated_by=access.actor,
        )
        settings = await self._settings(ctx)
        if settings.labour_billing == "day_rates":
            await self._price(ctx, row, settings)
        await self._check_day(ctx, row)
        await self._flush(ctx, add=row)
        await ctx.db.refresh(row)
        return _read(row, access)

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: BaseModel,
        expected_version: int,
    ) -> tuple[BaseModel, BaseModel]:
        access = ctx.access
        named = payload.model_dump(exclude_unset=True).get("person_user_id")
        checked: UUID | None = None
        if named is not None and named != access.user_id:
            # The membership check may call coord: never under the row lock.
            current = await self._load(ctx, record_id)
            if not editable_by(current, access):
                raise _not_yours()
            if not access.can_edit_others(RULE):
                raise _not_yours()
            if current.person_user_id != named:
                await self._check_person(ctx, named)
                checked = named
        row = await self._load(ctx, record_id, lock=True)
        before = _read(row, access)
        if not editable_by(row, access):
            raise _not_yours()
        if row.version != expected_version:
            raise StaleVersion(before)
        changes: dict[str, Any] = payload.model_dump(exclude_unset=True)
        for required in ("work_date", "hours", "person"):
            if required in changes and changes[required] is None:
                raise StoreRefused(
                    422, "required_field", f"{required} cannot be cleared."
                )
        if "note" in changes and changes["note"] is None:
            changes["note"] = ""
        changes = {k: v for k, v in changes.items() if getattr(row, k) != v}
        if (
            "person_user_id" in changes
            and not access.can_edit_others(RULE)
            and changes["person_user_id"] != access.user_id
        ):
            raise _not_yours()
        if (
            changes.get("person_user_id") is not None
            and changes["person_user_id"] != access.user_id
            and changes["person_user_id"] != checked
        ):
            # Only reachable when the row moved between the unlocked read and
            # the lock; refuse rather than call coord under the lock.
            raise StaleVersion(before)
        settings = await self._settings(ctx)
        role_after = changes.get("role_code", row.role_code)
        # A changed role always re-prices. Under day rates an entry with no
        # price is priced on its next edit — when it names a role: a legacy
        # role-less entry can still have its note fixed.
        reprice = "role_code" in changes or (
            settings.labour_billing == "day_rates"
            and row.rate_micros_used is None
            and role_after is not None
        )
        if not changes and not reprice:
            return before, before
        if "phase_id" in changes:
            await self._check_phase(ctx, changes["phase_id"])
        # The price and the day cap are checks on the NEW values, so they run
        # on the row with the changes applied — with autoflush off (their
        # lookups must not write the half-checked row) and every attribute
        # put back if one refuses, so a refusal leaves nothing behind.
        touched = set(changes) | {
            "rate_micros_used",
            "rate_currency",
            "hours_per_day_used",
        }
        original = {key: getattr(row, key) for key in touched}
        with ctx.db.no_autoflush:
            try:
                for key, value in changes.items():
                    setattr(row, key, value)
                if reprice:
                    await self._price(ctx, row, settings)
                if _read(row, access) == before:
                    # Nothing moved — e.g. a re-price that found the same rate.
                    return before, before
                if {"hours", "work_date", "person", "person_user_id"} & set(changes):
                    await self._check_day(ctx, row)
            except StoreRefused:
                for key, value in original.items():
                    setattr(row, key, value)
                raise
        row.version += 1
        row.updated_by = access.actor
        await self._flush(ctx)
        await ctx.db.refresh(row)
        return before, _read(row, access)

    async def delete(
        self, ctx: StoreContext, record_id: str, expected_version: int
    ) -> BaseModel:
        row = await self._load(ctx, record_id, lock=True)
        before = _read(row, ctx.access)
        if not editable_by(row, ctx.access):
            raise _not_yours()
        if row.version != expected_version:
            raise StaleVersion(before)
        await ctx.db.delete(row)
        await ctx.db.flush()
        return before


def effort_entry_store() -> EffortEntryStore:
    return EffortEntryStore()
