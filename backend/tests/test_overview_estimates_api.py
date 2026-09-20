"""Project Overview — the estimate baseline, end to end against real Postgres.

Phase 2 of ``2026-09-19-project-overview-for-business-leaders``.

Layers, mirroring ``tests/test_plan_library_api.py``:

* **Layer 0** — the ``overview`` schema binding itself. These are the first
  ORM models bound to that schema, so "the tables landed in ``overview`` and
  not in ``public``" is asserted rather than assumed.
* **Layer 1** — the rollup as a pure function, including the fixture estimate
  the plan asks for: the reference delivery plan's SHAPE (six phases, twelve
  roles, three tiers, holidays, a working-day factor) with synthetic numbers
  and its own stated totals, which the rollup has to reproduce.
* **Layer 2** — full HTTP through ``ASGITransport``, covering tenant
  isolation, the admin gate on every write, and optimistic concurrency.

The tenant DEPENDENCIES are overridden at the route boundary (a member app
and an admin app), because resolving a real one would need a live coord.
The dependency's own logic — "the ACTIVE tenant, membership-validated" — is
tested separately in ``TestTenantResolution`` against a stubbed identity, so
neither half is taken on trust.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import overview_estimate as crud
from app.models.overview import Estimate
from app.schemas.overview import EstimateContentWrite
from app.services.overview_rollup import (
    compute_rollup,
    stringify_decimals,
    working_days,
)

API = "/api/v1/overview"

pytestmark = pytest.mark.asyncio

TENANT_A = UUID("aaaaaaaa-0000-4000-8000-000000000001")
TENANT_B = UUID("bbbbbbbb-0000-4000-8000-000000000002")


# ===========================================================================
# The fixture estimate — the reference delivery plan's SHAPE
# ===========================================================================
#
# Six phases with codes, a gate sentence each; twelve roles (ten delivery,
# two client-side and unpriced); three price tiers; a holiday; a working-day
# factor of 0.9. Every number is synthetic. What makes it a test rather than
# a re-run of the implementation is that the plan states its OWN totals
# below, computed by hand, and the rollup has to reproduce them.

_PHASE_SHAPE: list[tuple[str, str, str, str, str]] = [
    # (code, name, start, end, gate sentence)
    ("A0", "Mobilisation", "2026-01-05", "2026-01-30", "Environments reachable"),
    ("A1", "Discovery", "2026-02-02", "2026-03-13", "Requirements signed off"),
    ("A2", "Build one", "2026-03-16", "2026-05-29", "Pilot runs end to end"),
    ("A3", "Build two", "2026-06-01", "2026-07-31", "All sites migrated"),
    ("A4", "Pilot", "2026-08-03", "2026-09-11", "Two weeks without a rollback"),
    ("A5", "Handover", "2026-09-14", "2026-10-09", "Support team runs it alone"),
]

#: ``(code, name, day rate in whole EUR or None, client_side)``
_ROLE_SHAPE: list[tuple[str, str, int | None, bool]] = [
    ("DL", "Delivery lead", 900, False),
    ("AR", "Architect", 1100, False),
    ("BE", "Backend engineer", 750, False),
    ("FE", "Frontend engineer", 720, False),
    ("DA", "Data engineer", 800, False),
    ("QA", "Test engineer", 620, False),
    ("SE", "Security engineer", 950, False),
    ("PO", "Product owner", 700, False),
    ("UX", "Designer", 680, False),
    ("OP", "Platform engineer", 780, False),
    ("CS", "Client sponsor", None, True),
    ("CO", "Client operations", None, True),
]

_TIER_SHAPE: list[tuple[str, str, bool]] = [
    ("Low", "0.9", False),
    ("Midpoint", "1.0", True),
    ("High", "1.25", False),
]


def _fixture_content() -> dict[str, Any]:
    """The estimate's content graph as the content endpoint takes it."""
    roles = [
        {
            "code": code,
            "name": name,
            "responsibility": f"{name} responsibilities",
            "day_rate_micros": rate * 1_000_000 if rate is not None else None,
            "currency": "EUR" if rate is not None else None,
            "client_side": client_side,
        }
        for code, name, rate, client_side in _ROLE_SHAPE
    ]

    # Two tasks per phase; each task splits its days across three roles. The
    # split is deterministic so the stated totals below can be computed by
    # hand from the same arithmetic a reader would do.
    delivery_roles = [r[0] for r in _ROLE_SHAPE if not r[3]]
    phases = []
    for index, (code, name, start, end, gate) in enumerate(_PHASE_SHAPE):
        tasks = []
        for task_index in range(2):
            picks = [
                delivery_roles[(index * 2 + task_index + offset) % len(delivery_roles)]
                for offset in range(3)
            ]
            tasks.append(
                {
                    "number": f"{index + 1}.{task_index + 1}",
                    "title": f"{name} task {task_index + 1}",
                    "requirement_refs": f"R{index + 1}",
                    "is_critical": code == "A4",
                    "status": "planned",
                    "efforts": [
                        {"role_code": picks[0], "planned_person_days": "10.00"},
                        {"role_code": picks[1], "planned_person_days": "6.50"},
                        {"role_code": picks[2], "planned_person_days": "3.50"},
                    ],
                }
            )
        phases.append(
            {
                "code": code,
                "name": name,
                "planned_start": start,
                "planned_end": end,
                "gate_criteria": gate,
                "tasks": tasks,
            }
        )

    allocations = [
        {"phase_code": code, "role_code": role_code, "fte": fte}
        for code, role_code, fte in [
            ("A0", "DL", "0.5"),
            ("A0", "AR", "0.5"),
            ("A1", "DL", "0.5"),
            ("A1", "AR", "1.0"),
            ("A1", "PO", "0.5"),
            ("A2", "DL", "1.0"),
            ("A2", "BE", "2.0"),
            ("A2", "FE", "1.5"),
            ("A3", "DL", "1.0"),
            ("A3", "BE", "2.0"),
            ("A3", "DA", "1.0"),
            ("A4", "DL", "0.5"),
            ("A4", "QA", "1.0"),
            ("A5", "DL", "0.5"),
        ]
    ]

    return {
        "roles": roles,
        "phases": phases,
        "allocations": allocations,
        "price_tiers": [
            {"name": name, "multiplier": multiplier, "is_primary": primary}
            for name, multiplier, primary in _TIER_SHAPE
        ],
        "cost_lines": [
            {
                "kind": "build_non_labour",
                "label": "Licences",
                "basis": "12 seats for a year",
                "low_micros": 18_000_000_000,
                "high_micros": 24_000_000_000,
                "currency": "EUR",
            },
            {
                "kind": "run_annual",
                "label": "Managed hosting",
                "basis": "vendor quote",
                "low_micros": 30_000_000_000,
                "high_micros": 36_000_000_000,
                "currency": "EUR",
                "run_model": "managed service",
            },
        ],
        "calendar_breaks": [
            {
                "label": "Easter",
                "start_date": "2026-04-03",
                "end_date": "2026-04-06",
            }
        ],
    }


#: Totals this fixture STATES about itself, computed by hand from the shape
#: above. The rollup reproducing them is the whole point of the fixture.
#:
#: Effort: 6 phases × 2 tasks × (10 + 6.5 + 3.5) person-days = 240.00, all of
#: it on delivery roles (the two client-side roles get no task effort).
STATED_TOTAL_PERSON_DAYS = Decimal("240.00")
STATED_CLIENT_SIDE_PERSON_DAYS = Decimal("0.00")
#: Peak team size is A2 (1.0 + 2.0 + 1.5 FTE) — read off the allocation table,
#: never off the person-days.
STATED_PEAK_FTE = Decimal("4.500")
STATED_PEAK_PHASE = "A2"


def _expected_midpoint_fee_micros() -> int:
    """The midpoint-tier labour fee, recomputed the long way round.

    Deliberately NOT a call into the rollup: it walks the same fixture shape
    with plain Python arithmetic, so a defect in the rollup's aggregation
    shows up as a disagreement rather than as two copies of the same bug.
    """
    rates = {code: rate for code, _n, rate, _c in _ROLE_SHAPE}
    delivery_roles = [r[0] for r in _ROLE_SHAPE if not r[3]]
    total = 0
    for index in range(len(_PHASE_SHAPE)):
        for task_index in range(2):
            picks = [
                delivery_roles[(index * 2 + task_index + offset) % len(delivery_roles)]
                for offset in range(3)
            ]
            for role_code, days in zip(
                picks, [Decimal("10.00"), Decimal("6.50"), Decimal("3.50")], strict=True
            ):
                rate = rates[role_code]
                assert rate is not None
                total += int(days * rate * 1_000_000)
    return total


# ===========================================================================
# Harness
# ===========================================================================


def _build_app(*, db_session: AsyncSession, user, tenant_id: UUID, is_admin: bool):
    """Mount the overview router with db, auth and tenant deps overridden.

    The two tenant dependencies are overridden separately, and the admin one
    raises 403 for a non-admin — which is exactly the shape
    ``require_coord_tenant_admin`` produces against a coord that reports an
    operator without ``admin`` in the effective tenant.
    """
    from app.api.deps import current_active_user, get_async_db
    from app.api.v1.endpoints.operations import require_coord_tenant_admin_target
    from app.api.v1.endpoints.overview import get_overview_tenant_id
    from app.api.v1.endpoints.overview import router as overview_router

    app = FastAPI()
    app.dependency_overrides[current_active_user] = lambda: user

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.dependency_overrides[get_overview_tenant_id] = lambda: tenant_id

    def _admin_dep():
        if not is_admin:
            raise HTTPException(status_code=403, detail="not_coord_tenant_admin")
        return tenant_id

    app.dependency_overrides[require_coord_tenant_admin_target] = _admin_dep
    app.include_router(overview_router, prefix=API)
    return app


@pytest_asyncio.fixture()
async def api_user(async_db_session: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"overview_{uuid4().hex[:8]}@example.com",
        username=f"overview_{uuid4().hex[:8]}",
        full_name="Overview Tester",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest_asyncio.fixture()
async def admin_a(async_db_session: AsyncSession, api_user):
    """Tenant admin of project A."""
    app = _build_app(
        db_session=async_db_session, user=api_user, tenant_id=TENANT_A, is_admin=True
    )
    async with _client(app) as c:
        yield c


@pytest_asyncio.fixture()
async def member_a(async_db_session: AsyncSession, api_user):
    """A plain member (coord ``operator``) of project A — read-only."""
    app = _build_app(
        db_session=async_db_session, user=api_user, tenant_id=TENANT_A, is_admin=False
    )
    async with _client(app) as c:
        yield c


@pytest_asyncio.fixture()
async def admin_b(async_db_session: AsyncSession, api_user):
    """Tenant admin of a DIFFERENT project."""
    app = _build_app(
        db_session=async_db_session, user=api_user, tenant_id=TENANT_B, is_admin=True
    )
    async with _client(app) as c:
        yield c


async def _create_estimate(client: httpx.AsyncClient, **overrides) -> dict:
    body = {"name": "Estimate v0.1", "purpose": "comparison", "is_baseline": True}
    body.update(overrides)
    response = await client.post(f"{API}/estimates", json=body)
    assert response.status_code == 201, response.text
    return response.json()


# ===========================================================================
# Layer 0 — the schema binding
# ===========================================================================


class TestOverviewSchemaBinding:
    async def test_tables_land_in_the_overview_schema(
        self, async_db_session: AsyncSession
    ) -> None:
        rows = (
            (
                await async_db_session.execute(
                    text(
                        """
                        SELECT table_name
                          FROM information_schema.tables
                         WHERE table_schema = 'overview'
                         ORDER BY table_name
                        """
                    )
                )
            )
            .scalars()
            .all()
        )
        assert set(rows) >= {
            "calendar_breaks",
            "cost_lines",
            "estimates",
            "phase_allocations",
            "phase_tasks",
            "phases",
            "price_tiers",
            "roles",
            "settings",
            "task_efforts",
        }

    async def test_the_models_carry_every_check_the_migration_does(self) -> None:
        """The test database is built by ``Base.metadata.create_all``, not by
        alembic (``conftest.py``'s ``test_engine``). So a CHECK that lives
        only in the migration is enforced in production and enforced NOWHERE
        in the suite — every test here would pass against a database that
        cannot reject what production rejects, and the drift would be
        invisible until deploy.

        This compares the two sets by NAME, which is what makes the model
        docstrings' repeated "Enforced by ``ck_overview_…``" claims true of
        the database these tests actually run against.
        """
        import re
        from pathlib import Path

        from sqlalchemy import CheckConstraint

        from app.db.base import Base

        in_models = {
            constraint.name
            for name, table in Base.metadata.tables.items()
            if name.startswith("overview.")
            for constraint in table.constraints
            if isinstance(constraint, CheckConstraint) and constraint.name
        }
        migration = Path(
            "alembic/versions/overview_01_estimate_baseline.py"
        ).read_text()
        in_migration = set(re.findall(r"CONSTRAINT (ck_overview_\w+)", migration))

        assert in_migration, "the migration's CHECK names could not be read"
        assert in_models == in_migration, (
            "model and migration CHECK constraints have drifted — "
            f"model only: {sorted(in_models - in_migration)}; "
            f"migration only: {sorted(in_migration - in_models)}"
        )

    async def test_a_check_constraint_really_bites_in_the_test_database(
        self, async_db_session: AsyncSession
    ) -> None:
        """Names agreeing is necessary, not sufficient — this proves one of
        them is actually live in the schema the suite runs against."""
        from sqlalchemy.exc import IntegrityError

        from app.models.overview import Estimate, EstimateRole

        estimate = Estimate(
            tenant_id=TENANT_A, name="Check bites", purpose="budget", version=1
        )
        async_db_session.add(estimate)
        await async_db_session.flush()
        # A rate with no currency: an amount whose unit nobody recorded.
        async_db_session.add(
            EstimateRole(
                tenant_id=TENANT_A,
                estimate_id=estimate.id,
                code="BE",
                name="Backend",
                day_rate_micros=750_000_000,
                currency=None,
            )
        )
        with pytest.raises(IntegrityError):
            await async_db_session.flush()
        await async_db_session.rollback()


# ===========================================================================
# Layer 1 — derived values
# ===========================================================================


class TestWorkingDays:
    """Working days: business days, minus holidays, times the factor."""

    async def test_business_days_exclude_weekends(self) -> None:
        # Mon 2026-01-05 .. Fri 2026-01-30 is four full working weeks.
        assert working_days(
            date(2026, 1, 5), date(2026, 1, 30), [], Decimal("1.0")
        ) == Decimal("20.00")

    async def test_a_break_removes_only_its_business_days(self) -> None:
        from app.models.overview import CalendarBreak

        # Fri 2026-01-09 .. Mon 2026-01-12 spans a weekend: two business days.
        brk = CalendarBreak(
            label="Shutdown", start_date=date(2026, 1, 9), end_date=date(2026, 1, 12)
        )
        assert working_days(
            date(2026, 1, 5), date(2026, 1, 30), [brk], Decimal("1.0")
        ) == Decimal("18.00")

    async def test_overlapping_breaks_are_counted_once(self) -> None:
        from app.models.overview import CalendarBreak

        a = CalendarBreak(
            label="A", start_date=date(2026, 1, 12), end_date=date(2026, 1, 14)
        )
        b = CalendarBreak(
            label="B", start_date=date(2026, 1, 13), end_date=date(2026, 1, 15)
        )
        # Mon-Thu 12..15 is four business days, not the six a naive sum gives.
        assert working_days(
            date(2026, 1, 5), date(2026, 1, 30), [a, b], Decimal("1.0")
        ) == Decimal("16.00")

    async def test_a_century_long_phase_is_counted_not_walked(self) -> None:
        """A DATE column accepts year 1 to year 9999, so a mistyped year must
        not put a multi-million-iteration loop inside a read any tenant member
        can issue. 1000 years is ~365243 days; the count is arithmetic, so
        this returns immediately."""
        days = working_days(date(1000, 1, 1), date(1999, 12, 31), [], Decimal("1.0"))
        assert days > Decimal("200000")

    async def test_the_working_day_factor_applies_last(self) -> None:
        assert working_days(
            date(2026, 1, 5), date(2026, 1, 30), [], Decimal("0.9")
        ) == Decimal("18.00")


class TestRollupArithmetic:
    """The rollup over the fixture estimate, against its own stated totals."""

    @pytest_asyncio.fixture()
    async def rollup(self, admin_a: httpx.AsyncClient) -> dict:
        estimate = await _create_estimate(admin_a, purpose="comparison")
        settings = await admin_a.put(
            f"{API}/settings",
            json={
                "base_currency": "EUR",
                "labour_billing": "unbilled",
                "hours_per_day": "8",
                "working_day_factor": "0.9",
            },
        )
        assert settings.status_code == 200, settings.text
        patched = await admin_a.patch(
            f"{API}/estimates/{estimate['id']}",
            json={"contingency_pct": "10"},
        )
        assert patched.status_code == 200, patched.text
        saved = await admin_a.put(
            f"{API}/estimates/{estimate['id']}/content", json=_fixture_content()
        )
        assert saved.status_code == 200, saved.text
        response = await admin_a.get(f"{API}/estimates/{estimate['id']}/rollup")
        assert response.status_code == 200, response.text
        return response.json()

    async def test_person_days_match_the_stated_total(self, rollup: dict) -> None:
        assert Decimal(rollup["effort"]["total_person_days"]) == (
            STATED_TOTAL_PERSON_DAYS
        )
        assert Decimal(rollup["effort"]["client_side_person_days"]) == (
            STATED_CLIENT_SIDE_PERSON_DAYS
        )

    async def test_task_days_sum_to_phase_days_sum_to_the_estimate(
        self, rollup: dict
    ) -> None:
        phase_days = sum(Decimal(p["person_days"]) for p in rollup["phases"])
        assert phase_days == Decimal(rollup["effort"]["total_person_days"])
        role_days = sum(Decimal(r["person_days"]) for r in rollup["roles"])
        assert role_days == Decimal(rollup["effort"]["total_person_days"])

    async def test_phase_fees_sum_to_the_tier_total_in_both_directions(
        self, rollup: dict
    ) -> None:
        """Task → phase → estimate AND role → estimate, exactly.

        This is the double-count guard: the two sums are over the same
        per-effort integers, so any drift between them is a real defect
        rather than rounding.
        """
        for tier in rollup["money"]["tiers"]:
            key = tier["id"] or ""
            phase_total = sum(p["fees_micros"][key] for p in rollup["phases"])
            assert phase_total == tier["labour_micros"], tier["name"]
            role_total = sum(
                r["fees_micros"][key] for r in rollup["roles"] if r["fees_micros"]
            )
            assert role_total == tier["labour_micros"], tier["name"]

    async def test_the_midpoint_tier_matches_the_hand_computed_fee(
        self, rollup: dict
    ) -> None:
        midpoint = next(t for t in rollup["money"]["tiers"] if t["name"] == "Midpoint")
        assert midpoint["labour_micros"] == _expected_midpoint_fee_micros()
        assert midpoint["is_primary"] is True

    async def test_tiers_are_ratios_of_the_primary(self, rollup: dict) -> None:
        by_name = {t["name"]: t for t in rollup["money"]["tiers"]}
        mid = by_name["Midpoint"]["labour_micros"]
        # Each effort row is rounded independently, so a tier is the ratio to
        # within the number of rows, not to the micro.
        assert abs(by_name["Low"]["labour_micros"] - int(mid * Decimal("0.9"))) < 100
        assert abs(by_name["High"]["labour_micros"] - int(mid * Decimal("1.25"))) < 100

    async def test_contingency_is_a_percentage_of_the_labour_fee(
        self, rollup: dict
    ) -> None:
        assert rollup["money"]["contingency_basis"] == "labour_fees"
        for tier in rollup["money"]["tiers"]:
            expected = int(
                (
                    Decimal(tier["labour_micros"]) * Decimal("10") / Decimal(100)
                ).to_integral_value()
            )
            assert abs(tier["contingency_micros"] - expected) <= 1

    async def test_the_grand_total_adds_labour_contingency_and_non_labour(
        self, rollup: dict
    ) -> None:
        build = rollup["money"]["build_non_labour"]
        for tier in rollup["money"]["tiers"]:
            base = tier["labour_micros"] + tier["contingency_micros"]
            assert tier["total_low_micros"] == base + build["low_micros"]
            assert tier["total_high_micros"] == base + build["high_micros"]

    async def test_the_fte_matrix_is_served_flat_for_the_team_page(
        self, rollup: dict
    ) -> None:
        """The heat table needs the cells, not just the column totals — and
        every cell comes from `phase_allocations`, never from person-days."""
        cells = {
            (a["phase_code"], a["role_code"]): a["fte"] for a in rollup["allocations"]
        }
        assert len(cells) == 14
        assert Decimal(cells[("A2", "BE")]) == Decimal("2.000")
        # A role with task effort but no allocation has no cell at all.
        assert ("A0", "QA") not in cells
        for phase in rollup["phases"]:
            column = sum(
                Decimal(a["fte"])
                for a in rollup["allocations"]
                if a["phase_code"] == phase["code"]
            )
            assert column == Decimal(phase["allocated_fte"])

    async def test_team_size_comes_from_the_allocation_matrix_alone(
        self, rollup: dict
    ) -> None:
        assert rollup["team"]["peak_phase_code"] == STATED_PEAK_PHASE
        assert Decimal(rollup["team"]["peak_fte"]) == STATED_PEAK_FTE
        # The average is duration-weighted, so it sits between the smallest
        # and largest allocated phase rather than equalling either.
        average = Decimal(rollup["team"]["average_fte"])
        assert Decimal("0.5") < average < STATED_PEAK_FTE

    async def test_working_weeks_honour_the_break_and_the_factor(
        self, rollup: dict
    ) -> None:
        """A2 spans Easter, so it loses working days its calendar span does
        not show — and every phase is scaled by the 0.9 factor."""
        a2 = next(p for p in rollup["phases"] if p["code"] == "A2")
        # 2026-03-16..2026-05-29 is 55 business days. The Easter break runs
        # Fri 2026-04-03 to Mon 2026-04-06, which is FOUR calendar days but
        # only TWO working ones — the distinction this assertion exists for.
        # 53 × 0.9 = 47.70 working days = 9.54 working weeks.
        assert Decimal(a2["working_days"]) == Decimal("47.70")
        assert Decimal(a2["working_weeks"]) == Decimal("9.54")
        a1 = next(p for p in rollup["phases"] if p["code"] == "A1")
        # 2026-02-02..2026-03-13 is 30 business days, no break: 27.0 days.
        assert Decimal(a1["working_days"]) == Decimal("27.00")

    async def test_every_decimal_is_a_string_not_a_float(self, rollup: dict) -> None:
        """Money is an integer count of micros; every other derived decimal
        is a string. Neither may ever arrive as a float."""
        floats: list[str] = []

        def walk(node: Any, path: str) -> None:
            if isinstance(node, float):
                floats.append(path)
            elif isinstance(node, dict):
                for k, v in node.items():
                    walk(v, f"{path}.{k}")
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    walk(v, f"{path}[{i}]")

        walk(rollup, "rollup")
        assert floats == []
        assert isinstance(rollup["effort"]["total_person_days"], str)
        assert isinstance(rollup["money"]["tiers"][0]["labour_micros"], int)


class TestRollupHonesty:
    """Unknown is never zero."""

    async def test_an_estimate_with_no_phases_says_so_rather_than_zero(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        estimate = await _create_estimate(admin_a, name="Empty")
        response = await admin_a.get(f"{API}/estimates/{estimate['id']}/rollup")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["schedule"]["planned_start"] is None
        assert body["schedule"]["working_weeks"] is None
        reasons = {u["reason"] for u in body["unavailable"]}
        assert "no_phases" in reasons
        assert "no_allocations" in reasons

    async def test_a_role_without_a_rate_is_named_not_priced_at_zero(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        estimate = await _create_estimate(admin_a, name="Partly priced")
        content = {
            "roles": [
                {
                    "code": "BE",
                    "name": "Backend",
                    "day_rate_micros": 750_000_000,
                    "currency": "EUR",
                },
                {"code": "XX", "name": "Unpriced role"},
            ],
            "phases": [
                {
                    "code": "P1",
                    "name": "One",
                    "planned_start": "2026-01-05",
                    "planned_end": "2026-01-16",
                    "tasks": [
                        {
                            "number": "1",
                            "title": "Work",
                            "efforts": [
                                {"role_code": "BE", "planned_person_days": "4"},
                                {"role_code": "XX", "planned_person_days": "6"},
                            ],
                        }
                    ],
                }
            ],
        }
        saved = await admin_a.put(
            f"{API}/estimates/{estimate['id']}/content", json=content
        )
        assert saved.status_code == 200, saved.text
        body = (await admin_a.get(f"{API}/estimates/{estimate['id']}/rollup")).json()
        unpriced = next(r for r in body["roles"] if r["code"] == "XX")
        assert unpriced["fee_micros"] is None
        assert Decimal(unpriced["person_days"]) == Decimal("6.00")
        reasons = {u["reason"] for u in body["unavailable"]}
        assert "role_has_no_rate" in reasons

    async def test_mixed_currencies_have_no_total(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        estimate = await _create_estimate(admin_a, name="Mixed")
        content = {
            "roles": [
                {
                    "code": "BE",
                    "name": "Backend",
                    "day_rate_micros": 750_000_000,
                    "currency": "EUR",
                },
                {
                    "code": "FE",
                    "name": "Frontend",
                    "day_rate_micros": 800_000_000,
                    "currency": "USD",
                },
            ],
            "phases": [
                {
                    "code": "P1",
                    "name": "One",
                    "tasks": [
                        {
                            "number": "1",
                            "title": "Work",
                            "efforts": [
                                {"role_code": "BE", "planned_person_days": "4"},
                                {"role_code": "FE", "planned_person_days": "4"},
                            ],
                        }
                    ],
                }
            ],
        }
        saved = await admin_a.put(
            f"{API}/estimates/{estimate['id']}/content", json=content
        )
        assert saved.status_code == 200, saved.text
        body = (await admin_a.get(f"{API}/estimates/{estimate['id']}/rollup")).json()
        assert body["money"]["currency"] is None
        assert body["money"]["tiers"][0]["labour_micros"] is None
        assert "mixed_currencies" in {u["reason"] for u in body["unavailable"]}

    async def test_mixed_currency_build_items_withdraw_the_grand_total(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        """A total that silently leaves a known cost out is worse than no
        total. Both the non-labour band AND the grand total go, and both say
        why."""
        estimate = await _create_estimate(admin_a, name="Mixed build")
        content = {
            "roles": [
                {
                    "code": "BE",
                    "name": "Backend",
                    "day_rate_micros": 1_000_000_000,
                    "currency": "EUR",
                }
            ],
            "phases": [
                {
                    "code": "P1",
                    "name": "One",
                    "tasks": [
                        {
                            "number": "1",
                            "title": "Work",
                            "efforts": [
                                {"role_code": "BE", "planned_person_days": "10"}
                            ],
                        }
                    ],
                }
            ],
            "cost_lines": [
                {
                    "kind": "build_non_labour",
                    "label": "Licences",
                    "low_micros": 5_000_000_000,
                    "high_micros": 5_000_000_000,
                    "currency": "EUR",
                },
                {
                    "kind": "build_non_labour",
                    "label": "Hardware",
                    "low_micros": 3_000_000_000,
                    "high_micros": 3_000_000_000,
                    "currency": "USD",
                },
            ],
        }
        assert (
            await admin_a.put(f"{API}/estimates/{estimate['id']}/content", json=content)
        ).status_code == 200
        body = (await admin_a.get(f"{API}/estimates/{estimate['id']}/rollup")).json()

        # The labour fee is still known and still correct.
        tier = body["money"]["tiers"][0]
        assert tier["labour_micros"] == 10_000_000_000
        # The total is WITHDRAWN, not quietly served without the 8,000.
        assert tier["total_low_micros"] is None
        assert tier["total_high_micros"] is None
        assert body["money"]["totals_currency"] is None
        reasons = {(u["figure"], u["reason"]) for u in body["unavailable"]}
        assert ("build_non_labour", "mixed_currencies") in reasons
        assert ("grand_total", "mixed_currencies") in reasons

    async def test_a_cost_line_with_only_an_upper_figure_is_not_dropped(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        """`low=None, high=4000, EUR` is a legal row — the CHECK only ties
        amounts to a currency. It has no lower bound, so it cannot join a low
        total; it must not be silently excluded from one either."""
        estimate = await _create_estimate(admin_a, name="Upper only")
        content = {
            "roles": [
                {
                    "code": "BE",
                    "name": "Backend",
                    "day_rate_micros": 1_000_000_000,
                    "currency": "EUR",
                }
            ],
            "phases": [
                {
                    "code": "P1",
                    "name": "One",
                    "tasks": [
                        {
                            "number": "1",
                            "title": "Work",
                            "efforts": [
                                {"role_code": "BE", "planned_person_days": "10"}
                            ],
                        }
                    ],
                }
            ],
            "cost_lines": [
                {
                    "kind": "build_non_labour",
                    "label": "Licences",
                    "high_micros": 4_000_000_000,
                    "currency": "EUR",
                }
            ],
        }
        assert (
            await admin_a.put(f"{API}/estimates/{estimate['id']}/content", json=content)
        ).status_code == 200
        body = (await admin_a.get(f"{API}/estimates/{estimate['id']}/rollup")).json()

        assert body["money"]["build_non_labour"]["low_micros"] is None
        # The line is still SERVED, so the page can list it...
        assert [
            line["label"] for line in body["money"]["build_non_labour"]["lines"]
        ] == ["Licences"]
        # ...and there is no total for it to sit under unexplained.
        assert body["money"]["tiers"][0]["total_low_micros"] is None
        reasons = {u["reason"] for u in body["unavailable"]}
        assert "cost_line_without_a_low_amount" in reasons

    async def test_an_estimate_with_no_priced_role_says_so(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        """No fee is not a fee of zero, and it is not an unexplained blank
        either."""
        estimate = await _create_estimate(admin_a, name="All client side")
        content = {
            "roles": [{"code": "CS", "name": "Client sponsor", "client_side": True}],
            "phases": [
                {
                    "code": "P1",
                    "name": "One",
                    "tasks": [
                        {
                            "number": "1",
                            "title": "Work",
                            "efforts": [
                                {"role_code": "CS", "planned_person_days": "5"}
                            ],
                        }
                    ],
                }
            ],
        }
        assert (
            await admin_a.put(f"{API}/estimates/{estimate['id']}/content", json=content)
        ).status_code == 200
        body = (await admin_a.get(f"{API}/estimates/{estimate['id']}/rollup")).json()
        assert body["money"]["tiers"][0]["labour_micros"] is None
        assert Decimal(body["effort"]["client_side_person_days"]) == Decimal("5.00")
        reasons = {u["reason"] for u in body["unavailable"]}
        assert "estimate_has_no_priced_role" in reasons

    async def test_a_break_at_the_end_of_time_does_not_500(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        """`DATE` accepts 9999-12-31, and merging two breaks that both clip to
        it used to compute `date.max + 1 day` — an OverflowError, which
        reaches the client as a 500 on a route every tenant member can read."""
        estimate = await _create_estimate(admin_a, name="End of time")
        content = {
            "phases": [
                {
                    "code": "P1",
                    "name": "One",
                    "planned_start": "9999-01-01",
                    "planned_end": "9999-12-31",
                }
            ],
            "calendar_breaks": [
                {
                    "label": "A",
                    "start_date": "9999-01-01",
                    "end_date": "9999-12-31",
                },
                {
                    "label": "B",
                    "start_date": "9999-06-01",
                    "end_date": "9999-12-31",
                },
            ],
        }
        assert (
            await admin_a.put(f"{API}/estimates/{estimate['id']}/content", json=content)
        ).status_code == 200
        response = await admin_a.get(f"{API}/estimates/{estimate['id']}/rollup")
        assert response.status_code == 200, response.text
        phase = response.json()["phases"][0]
        # Every working day of the phase is inside a break.
        assert Decimal(phase["working_days"]) == Decimal("0.00")

    async def test_a_stated_working_week_count_is_reported_beside_the_derived_one(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        estimate = await _create_estimate(admin_a, name="Stated")
        content = {
            "phases": [
                {
                    "code": "P1",
                    "name": "One",
                    "planned_start": "2026-01-05",
                    "planned_end": "2026-01-30",
                    "stated_working_weeks": "3.5",
                }
            ]
        }
        assert (
            await admin_a.put(f"{API}/estimates/{estimate['id']}/content", json=content)
        ).status_code == 200
        body = (await admin_a.get(f"{API}/estimates/{estimate['id']}/rollup")).json()
        phase = body["phases"][0]
        assert Decimal(phase["working_weeks"]) == Decimal("4.00")
        assert Decimal(phase["stated_working_weeks"]) == Decimal("3.50")
        assert phase["working_weeks_matches_stated"] is False


# ===========================================================================
# Layer 2 — HTTP: tenancy, the admin gate, concurrency
# ===========================================================================


class TestSettings:
    async def test_unsaved_settings_read_as_the_defaults_not_as_absent(
        self, member_a: httpx.AsyncClient
    ) -> None:
        response = await member_a.get(f"{API}/settings")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["is_default"] is True
        assert body["labour_billing"] == "unbilled"
        assert body["base_currency"] == "USD"

    async def test_a_member_cannot_write_settings(
        self, member_a: httpx.AsyncClient
    ) -> None:
        response = await member_a.put(f"{API}/settings", json={"base_currency": "EUR"})
        assert response.status_code == 403

    async def test_an_admin_writes_them_and_the_version_moves(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        first = await admin_a.put(
            f"{API}/settings",
            json={"base_currency": "eur", "labour_billing": "day_rates"},
        )
        assert first.status_code == 200, first.text
        assert first.json()["base_currency"] == "EUR"
        assert first.json()["is_default"] is False
        version = first.json()["version"]
        second = await admin_a.put(
            f"{API}/settings",
            json={"base_currency": "EUR", "expected_version": version},
        )
        assert second.status_code == 200
        assert second.json()["version"] == version + 1

    async def test_a_stale_version_is_refused_with_the_current_one(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        await admin_a.put(f"{API}/settings", json={"base_currency": "EUR"})
        response = await admin_a.put(
            f"{API}/settings", json={"base_currency": "USD", "expected_version": 99}
        )
        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["error"] == "version_conflict"
        assert detail["current_version"] >= 1

    async def test_a_factor_above_one_is_refused(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        response = await admin_a.put(
            f"{API}/settings", json={"working_day_factor": "1.5"}
        )
        assert response.status_code == 422


class TestEstimateCrud:
    async def test_a_member_can_read_but_not_write(
        self, admin_a: httpx.AsyncClient, member_a: httpx.AsyncClient
    ) -> None:
        created = await _create_estimate(admin_a)
        listed = await member_a.get(f"{API}/estimates")
        assert listed.status_code == 200
        assert [e["id"] for e in listed.json()["estimates"]] == [created["id"]]

        assert (
            await member_a.post(
                f"{API}/estimates", json={"name": "x", "purpose": "budget"}
            )
        ).status_code == 403
        assert (
            await member_a.patch(f"{API}/estimates/{created['id']}", json={"name": "y"})
        ).status_code == 403
        assert (
            await member_a.put(
                f"{API}/estimates/{created['id']}/content", json={"roles": []}
            )
        ).status_code == 403
        assert (
            await member_a.delete(f"{API}/estimates/{created['id']}")
        ).status_code == 403

    async def test_only_one_estimate_is_the_baseline(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        first = await _create_estimate(admin_a, name="v0.1", is_baseline=True)
        second = await _create_estimate(admin_a, name="v0.2", is_baseline=True)
        listed = (await admin_a.get(f"{API}/estimates")).json()["estimates"]
        baselines = [e["id"] for e in listed if e["is_baseline"]]
        assert baselines == [second["id"]]
        assert first["id"] not in baselines
        # And the baseline is listed first, which is how the Team page picks it.
        assert listed[0]["id"] == second["id"]

    async def test_patch_leaves_absent_fields_alone(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        created = await _create_estimate(admin_a, notes="keep me")
        patched = await admin_a.patch(
            f"{API}/estimates/{created['id']}", json={"status": "approved"}
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["notes"] == "keep me"
        assert patched.json()["status"] == "approved"

    async def test_delete_takes_the_content_with_it(
        self, admin_a: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        created = await _create_estimate(admin_a)
        assert (
            await admin_a.put(
                f"{API}/estimates/{created['id']}/content", json=_fixture_content()
            )
        ).status_code == 200
        assert (
            await admin_a.delete(f"{API}/estimates/{created['id']}")
        ).status_code == 204
        remaining = await async_db_session.execute(
            text("SELECT count(*) FROM overview.phases WHERE estimate_id = :id"),
            {"id": UUID(created["id"])},
        )
        assert remaining.scalar_one() == 0

    async def test_clearing_a_required_field_is_a_422_not_a_500(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        """Every field on the PATCH body is typed `X | None` so ABSENT can be
        told from null — which means an explicit null looks exactly like a
        value on the way in. For a NOT NULL column that would reach Postgres
        and come back as a 500."""
        created = await _create_estimate(admin_a)
        for field in ("name", "purpose", "status", "is_baseline", "notes"):
            response = await admin_a.patch(
                f"{API}/estimates/{created['id']}", json={field: None}
            )
            assert response.status_code == 422, f"{field}: {response.text}"
        # The nullable ones still clear.
        cleared = await admin_a.patch(
            f"{API}/estimates/{created['id']}",
            json={"accuracy_note": None, "contingency_pct": None},
        )
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["accuracy_note"] is None

    async def test_an_unknown_purpose_is_a_422_not_a_500(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        response = await admin_a.post(
            f"{API}/estimates", json={"name": "x", "purpose": "guesswork"}
        )
        assert response.status_code == 422


class TestTenantIsolation:
    """Project A's estimate is invisible to project B — and an id from the
    other project reads as 404, because existence is itself information."""

    async def test_another_project_cannot_list_read_or_write_it(
        self, admin_a: httpx.AsyncClient, admin_b: httpx.AsyncClient
    ) -> None:
        created = await _create_estimate(admin_a, name="A's estimate")

        listed = await admin_b.get(f"{API}/estimates")
        assert listed.status_code == 200
        assert listed.json()["estimates"] == []

        for response in (
            await admin_b.get(f"{API}/estimates/{created['id']}"),
            await admin_b.get(f"{API}/estimates/{created['id']}/rollup"),
            await admin_b.patch(
                f"{API}/estimates/{created['id']}", json={"name": "mine now"}
            ),
            await admin_b.put(
                f"{API}/estimates/{created['id']}/content", json={"roles": []}
            ),
            await admin_b.delete(f"{API}/estimates/{created['id']}"),
        ):
            assert response.status_code == 404, response.text

        # And A still has it, unchanged.
        still = await admin_a.get(f"{API}/estimates/{created['id']}")
        assert still.status_code == 200
        assert still.json()["estimate"]["name"] == "A's estimate"

    async def test_settings_are_per_project(
        self, admin_a: httpx.AsyncClient, admin_b: httpx.AsyncClient
    ) -> None:
        assert (
            await admin_a.put(f"{API}/settings", json={"base_currency": "EUR"})
        ).status_code == 200
        b_settings = (await admin_b.get(f"{API}/settings")).json()
        assert b_settings["is_default"] is True
        assert b_settings["base_currency"] == "USD"

    async def test_each_project_may_hold_its_own_baseline(
        self, admin_a: httpx.AsyncClient, admin_b: httpx.AsyncClient
    ) -> None:
        """The one-baseline rule is per tenant, not global — the partial
        unique index is over ``(tenant_id)``, so B's baseline must not
        collide with A's."""
        await _create_estimate(admin_a, name="A baseline", is_baseline=True)
        b = await _create_estimate(admin_b, name="B baseline", is_baseline=True)
        assert b["is_baseline"] is True


class TestContentReplace:
    async def test_the_graph_round_trips(self, admin_a: httpx.AsyncClient) -> None:
        estimate = await _create_estimate(admin_a)
        saved = await admin_a.put(
            f"{API}/estimates/{estimate['id']}/content", json=_fixture_content()
        )
        assert saved.status_code == 200, saved.text
        body = saved.json()
        assert [p["code"] for p in body["phases"]] == [p[0] for p in _PHASE_SHAPE]
        assert [r["code"] for r in body["roles"]] == [r[0] for r in _ROLE_SHAPE]
        assert len(body["allocations"]) == 14
        assert len(body["calendar_breaks"]) == 1
        # Efforts name their role by CODE as well as id.
        first_task = body["phases"][0]["tasks"][0]
        assert all(e["role_code"] for e in first_task["efforts"])

    async def test_replacing_twice_does_not_accumulate(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        estimate = await _create_estimate(admin_a)
        for _ in range(2):
            response = await admin_a.put(
                f"{API}/estimates/{estimate['id']}/content", json=_fixture_content()
            )
            assert response.status_code == 200, response.text
        body = response.json()
        assert len(body["phases"]) == len(_PHASE_SHAPE)
        assert len(body["roles"]) == len(_ROLE_SHAPE)

    async def test_an_effort_naming_an_unknown_role_is_refused_whole(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        estimate = await _create_estimate(admin_a)
        assert (
            await admin_a.put(
                f"{API}/estimates/{estimate['id']}/content", json=_fixture_content()
            )
        ).status_code == 200
        bad = _fixture_content()
        bad["phases"][0]["tasks"][0]["efforts"][0]["role_code"] = "NOPE"
        response = await admin_a.put(
            f"{API}/estimates/{estimate['id']}/content", json=bad
        )
        assert response.status_code == 422, response.text
        # The earlier content survives: a rejected import lands nothing.
        current = (await admin_a.get(f"{API}/estimates/{estimate['id']}")).json()
        assert len(current["phases"]) == len(_PHASE_SHAPE)

    async def test_two_primary_tiers_are_refused(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        estimate = await _create_estimate(admin_a)
        content = _fixture_content()
        for tier in content["price_tiers"]:
            tier["is_primary"] = True
        response = await admin_a.put(
            f"{API}/estimates/{estimate['id']}/content", json=content
        )
        assert response.status_code == 422

    async def test_a_rate_without_a_currency_is_refused(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        estimate = await _create_estimate(admin_a)
        response = await admin_a.put(
            f"{API}/estimates/{estimate['id']}/content",
            json={"roles": [{"code": "BE", "name": "B", "day_rate_micros": 1}]},
        )
        assert response.status_code == 422

    async def test_a_stale_expected_version_is_refused(
        self, admin_a: httpx.AsyncClient
    ) -> None:
        estimate = await _create_estimate(admin_a)
        content = _fixture_content()
        content["expected_version"] = estimate["version"]
        assert (
            await admin_a.put(f"{API}/estimates/{estimate['id']}/content", json=content)
        ).status_code == 200
        # The same payload again, still claiming the old version.
        response = await admin_a.put(
            f"{API}/estimates/{estimate['id']}/content", json=content
        )
        assert response.status_code == 409
        assert response.json()["detail"]["current_version"] == estimate["version"] + 1


class TestTenantResolution:
    """The read dependency's own logic, against a stubbed coord identity."""

    async def test_it_returns_the_active_tenant_not_the_home_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.api.v1.endpoints import overview as overview_ep
        from app.services.coord_identity import CoordIdentity, CoordTenant

        identity = CoordIdentity(
            operator_id=uuid4(),
            home_tenant_id=TENANT_A,
            email="someone@example.com",
            roles=("operator",),
            tenants=(
                CoordTenant(tenant_id=TENANT_A, slug="a", roles=("admin",)),
                CoordTenant(tenant_id=TENANT_B, slug="b", roles=("operator",)),
            ),
            is_admin=True,
        )

        async def _identity(_request):
            return identity

        monkeypatch.setattr(overview_ep, "get_coord_identity", _identity)

        resolved = await overview_ep.get_overview_tenant_id(
            _FakeRequest({"X-Qontinui-Active-Tenant": str(TENANT_B)})
        )
        assert resolved == TENANT_B

    async def test_a_tenant_the_operator_does_not_belong_to_degrades_to_home(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Never widens: an unknown selection falls back to home rather than
        serving a project the operator is not a member of."""
        from app.api.v1.endpoints import overview as overview_ep
        from app.services.coord_identity import CoordIdentity, CoordTenant

        identity = CoordIdentity(
            operator_id=uuid4(),
            home_tenant_id=TENANT_A,
            email="someone@example.com",
            roles=("operator",),
            tenants=(CoordTenant(tenant_id=TENANT_A, slug="a", roles=("operator",)),),
            is_admin=False,
        )

        async def _identity(_request):
            return identity

        monkeypatch.setattr(overview_ep, "get_coord_identity", _identity)
        resolved = await overview_ep.get_overview_tenant_id(
            _FakeRequest({"X-Qontinui-Active-Tenant": str(uuid4())})
        )
        assert resolved == TENANT_A

    async def test_an_unresolvable_tenant_is_403_not_a_silent_empty_project(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.api.v1.endpoints import overview as overview_ep
        from app.services.coord_identity import CoordIdentity

        identity = CoordIdentity(
            operator_id=None,
            home_tenant_id=None,
            email=None,
            roles=(),
            tenants=(),
            is_admin=False,
        )

        async def _identity(_request):
            return identity

        monkeypatch.setattr(overview_ep, "get_coord_identity", _identity)
        with pytest.raises(HTTPException) as excinfo:
            await overview_ep.get_overview_tenant_id(_FakeRequest({}))
        assert excinfo.value.status_code == 403


class _FakeRequest:
    """The two things ``get_overview_tenant_id`` reads off a request."""

    def __init__(self, headers: dict[str, str]) -> None:
        self.headers = headers
        self.cookies: dict[str, str] = {}


# ===========================================================================
# The rollup as a pure function — no HTTP, no session
# ===========================================================================


class TestRollupIsPure:
    async def test_it_runs_off_loaded_rows_with_no_session(
        self, admin_a: httpx.AsyncClient, async_db_session: AsyncSession
    ) -> None:
        estimate = await _create_estimate(admin_a)
        assert (
            await admin_a.put(
                f"{API}/estimates/{estimate['id']}/content", json=_fixture_content()
            )
        ).status_code == 200
        loaded = await crud.load_estimate_graph(
            async_db_session, tenant_id=TENANT_A, estimate_id=UUID(estimate["id"])
        )
        assert isinstance(loaded, Estimate)
        settings = crud.default_settings_row(TENANT_A)
        moment = datetime(2026, 9, 20, tzinfo=UTC)
        first = compute_rollup(loaded, settings, generated_at=moment)
        second = compute_rollup(loaded, settings, generated_at=moment)
        assert stringify_decimals(first) == stringify_decimals(second)


class TestContentSchemaValidation:
    """Referential integrity is a 422 from the schema, not an IntegrityError
    500 from Postgres."""

    async def test_duplicate_role_codes(self) -> None:
        with pytest.raises(ValueError, match="two roles share a code"):
            EstimateContentWrite.model_validate(
                {
                    "roles": [
                        {"code": "BE", "name": "One"},
                        {"code": "BE", "name": "Two"},
                    ]
                }
            )

    async def test_allocation_naming_an_unknown_phase(self) -> None:
        with pytest.raises(ValueError, match="which is not in this estimate"):
            EstimateContentWrite.model_validate(
                {
                    "roles": [{"code": "BE", "name": "One"}],
                    "allocations": [
                        {"phase_code": "ZZ", "role_code": "BE", "fte": "1"}
                    ],
                }
            )

    async def test_a_task_end_before_its_start(self) -> None:
        with pytest.raises(ValueError, match="planned_end is before planned_start"):
            EstimateContentWrite.model_validate(
                {
                    "roles": [],
                    "phases": [
                        {
                            "code": "P1",
                            "name": "One",
                            "tasks": [
                                {
                                    "number": "1",
                                    "title": "t",
                                    "planned_start": "2026-02-01",
                                    "planned_end": "2026-01-01",
                                }
                            ],
                        }
                    ],
                }
            )
