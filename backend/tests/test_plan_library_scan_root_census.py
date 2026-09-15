"""The plan-stem census on ``/api/v1/plan-library/scan-roots``.

Phase 1 (web half) of
``2026-09-15-captured-vs-authored-coverage-is-a-set-difference``.

What is asserted here
---------------------
0. **A report with NO ``censuses`` still succeeds, and stores UNKNOWN.** This
   is the whole fleet at the time this landed, and it is the acceptance
   property the phase is judged on: the census is accepted before anything
   sends it precisely because ``extra="forbid"`` turns an unknown key into a
   422 that refuses the WHOLE report, forever, for a device whose body comes
   from its configuration.
1. **A census is stored whole**, per source, with its digest lifted out.
2. **The withheld-set heartbeat.** ``slugs: null`` with a digest that MATCHES
   what is stored keeps the stored stems and refreshes the rest of the census;
   a digest that does NOT match **clears the stems to UNKNOWN** rather than
   vouching for a set the device no longer claims. Both directions, because
   the asymmetry is the integrity property.
3. **Whole-snapshot discipline.** A source a later report omits goes NULL; an
   out-of-order report changes no census at all.
4. **The floor.** A truncated census is accepted, stores ``truncated: true``,
   and digests the PREFIX IT SENT — it is a floor in the sense
   ``counts_are_floors`` already means on this report, and no second word is
   minted for it.
5. **Validation**, each a 422 for the reason named: an unknown key inside a
   census, more than two censuses, two censuses of one source, a census on
   ``not_scanning``, over-cap or over-long stems, non-strict types, a missing
   digest, a digest that disagrees with its stems, duplicate stems, and both
   truncation-coherence errors.
6. **All three spellings of "no census" are one state** — key omitted, ``[]``,
   and an explicit ``null``. The last is the runner's stated wire discipline
   for this struct, so refusing it would mute a conforming device forever.
7. **The documented sort is ENFORCED.** ``slugs`` is stored sorted, because the
   digest is over the sorted form and so could never catch the drift.
8. **The census JSON is DEFERRED** on ``list_observations``, which rides every
   plan-library list page and renders no stem.

Layering matches ``tests/test_plan_library_scan_roots.py``.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plan_scan_root import PlanScanRootObservation
from app.schemas.plan_library_scan_roots import (
    SLUG_CENSUS_MAX,
    ScanRootReport,
    slug_census_digest,
)

API_PREFIX = "/api/v1/plan-library"
SCAN_ROOTS = f"{API_PREFIX}/scan-roots"

pytestmark = pytest.mark.asyncio

DEVICE_A = UUID("0c0c0c0c-0000-4000-8000-00000000000c")
TOKEN_A = "census-device-a-jwt"

TREE_STEMS = ["2026-09-01-alpha", "2026-09-02-beta", "2026-09-03-gamma"]
REF_STEMS = [*TREE_STEMS, "2026-09-04-delta"]


# ---------------------------------------------------------------------------
# Bodies
# ---------------------------------------------------------------------------


def _census(source: str, slugs: list[str] | None, **overrides: Any) -> dict[str, Any]:
    """A coherent census. ``slugs`` may be withheld; ``digest`` then stands alone."""
    stems = slugs if slugs is not None else overrides.pop("_digest_over", [])
    body: dict[str, Any] = {
        "source": source,
        "ref_sha": "a" * 40 if source == "ref" else None,
        "count": len(stems),
        "digest": slug_census_digest(stems),
        "slugs": sorted(slugs) if slugs is not None else None,
        "truncated": False,
    }
    body.update(overrides)
    return body


def _reading(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "state": "measured",
        "plans_dir": "/home/op/qontinui-dev-notes/plans",
        "repo_root": "/home/op/qontinui-dev-notes",
        "source_repo": "qontinui-dev-notes/plans",
        "default_ref": "origin/main",
        "ref_sha": "a" * 40,
        "head_sha": "b" * 40,
        "behind": 254,
        "ahead": 0,
        "ref_age_secs": 220,
        "counts_are_floors": False,
        "detail": None,
        "observed_at": datetime.now(UTC).isoformat(),
    }
    body.update(overrides)
    return body


def _with_censuses(**overrides: Any) -> dict[str, Any]:
    return _reading(
        censuses=[_census("ref", REF_STEMS), _census("work_tree", TREE_STEMS)],
        **overrides,
    )


# ---------------------------------------------------------------------------
# Fixtures — the scan-roots router alone, Cognito pinned off, DB overridden.
# ---------------------------------------------------------------------------


async def _make_user(db: AsyncSession, stem: str):
    from app.models.user import User

    user = User(
        email=f"{stem}_{uuid4().hex[:8]}@example.com",
        username=f"{stem}_{uuid4().hex[:8]}",
        full_name="Scan Root Census Test User",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_personal_org(db: AsyncSession, user):
    from app.models.organization import Organization

    org = Organization(
        name=f"Personal {uuid4().hex[:6]}",
        slug=f"personal-{uuid4().hex[:10]}",
        owner_id=user.id,
        settings={"is_personal": True},
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


@pytest_asyncio.fixture()
async def owner(async_db_session: AsyncSession):
    user = await _make_user(async_db_session, "census_owner")
    org = await _make_personal_org(async_db_session, user)
    return user, org


@pytest.fixture()
def stub_device_jwt(monkeypatch, owner):
    from app.api import deps

    user, _org = owner

    async def _fake_verify(token: str):
        if token != TOKEN_A:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired device token.",
            )
        return {"device_id": str(DEVICE_A), "user_id": str(user.id)}, user

    monkeypatch.setattr(deps, "_verify_device_jwt", _fake_verify)


@pytest_asyncio.fixture()
async def app_no_cognito(async_db_session: AsyncSession, stub_device_jwt):
    from app.api.deps import current_active_user_optional, get_async_db
    from app.api.v1.endpoints.plan_library_scan_roots import router

    app = FastAPI()
    app.dependency_overrides[current_active_user_optional] = lambda: None

    async def _db_override():
        yield async_db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(router, prefix=API_PREFIX)
    return app


def _client(app: FastAPI, token: str | None = TOKEN_A) -> httpx.AsyncClient:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers=headers,
    )


async def _row(db: AsyncSession) -> PlanScanRootObservation:
    result = await db.execute(
        select(PlanScanRootObservation)
        .where(PlanScanRootObservation.device_id == DEVICE_A)
        .execution_options(populate_existing=True)
    )
    return result.scalars().one()


# ===========================================================================
# 0. The current fleet sends no census, and must keep succeeding
# ===========================================================================


class TestNoCensusIsTheCurrentFleet:
    async def test_a_report_with_no_censuses_still_succeeds(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """Every runner alive when this landed sends no census. If this ever
        fails, the whole fleet's scan-root reporting is a 422 — and because the
        body is built from the device's configuration, a permanent one."""
        async with _client(app_no_cognito) as client:
            first = await client.post(SCAN_ROOTS, json=_reading())
            second = await client.post(SCAN_ROOTS, json=_reading(behind=3))

        assert first.status_code == 201, first.text
        assert second.status_code == 200, second.text
        row = await _row(async_db_session)
        # UNKNOWN, not an empty side.
        assert row.ref_census is None
        assert row.work_tree_census is None
        assert row.ref_census_digest is None
        assert row.work_tree_census_digest is None
        assert row.census_ref_sha is None
        assert row.census_observed_at is None

    def test_the_field_is_optional_on_the_schema_itself(self) -> None:
        assert ScanRootReport(**_reading()).censuses == []

    def test_all_three_spellings_of_no_census_are_one_state(self) -> None:
        """Key omitted, ``[]``, and an explicit ``null`` — one stored state.

        The third is not a convenience. The runner's own ``ScanRootReport``
        struct doc states the discipline for this exact wire — *"Every optional
        field serializes as an explicit ``null`` rather than being omitted"* —
        and all TEN of its optional fields are ``Option<T>`` with no
        ``skip_serializing_if`` (the struct has 13 fields; ``state``,
        ``counts_are_floors`` and ``observed_at`` are not optional). A Phase 2 author who follows the spec ships
        ``Option<Vec<PlanSlugCensus>>`` = ``None`` on every idle cycle, so a
        422 here would silence that device on every idle cycle, FOREVER: the
        report body is built from its configuration, so it never recovers.
        That is the exact permanent mute the deploy-ordering gate exists to
        prevent, in the one field the gate was built for.
        """
        assert ScanRootReport(**_reading(censuses=None)).censuses == []
        assert ScanRootReport(**_reading(censuses=[])).censuses == []
        assert ScanRootReport(**_reading()).censuses == []

    async def test_an_explicit_null_census_list_is_accepted_over_the_wire(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """The same, end to end, because ``extra="forbid"`` makes every
        rejection on this route a permanent mute rather than a retryable
        error."""
        async with _client(app_no_cognito) as client:
            first = await client.post(SCAN_ROOTS, json=_reading(censuses=None))
            second = await client.post(
                SCAN_ROOTS, json=_reading(behind=3, censuses=None)
            )
        assert first.status_code == 201, first.text
        assert second.status_code == 200, second.text
        row = await _row(async_db_session)
        # Null is "no census", which is UNKNOWN — not an empty side.
        assert (row.ref_census, row.work_tree_census) == (None, None)
        assert row.census_observed_at is None

    async def test_an_explicit_null_clears_a_stored_census(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """``null`` is the same whole-snapshot state as ``[]`` — an idle cycle
        after a scanning one leaves UNKNOWN, never the previous cycle's set."""
        async with _client(app_no_cognito) as client:
            await client.post(SCAN_ROOTS, json=_with_censuses())
            resp = await client.post(SCAN_ROOTS, json=_reading(censuses=None))
        assert resp.status_code == 200, resp.text
        row = await _row(async_db_session)
        assert (row.ref_census, row.work_tree_census) == (None, None)
        assert (row.ref_census_digest, row.work_tree_census_digest) == (None, None)


# ===========================================================================
# 1. A census is stored whole
# ===========================================================================


class TestCensusIsStored:
    async def test_both_censuses_land_in_their_own_columns(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        async with _client(app_no_cognito) as client:
            resp = await client.post(SCAN_ROOTS, json=_with_censuses())
        assert resp.status_code == 201, resp.text

        row = await _row(async_db_session)
        assert row.ref_census["slugs"] == sorted(REF_STEMS)
        assert row.ref_census["count"] == len(REF_STEMS)
        assert row.ref_census["source"] == "ref"
        assert row.work_tree_census["slugs"] == sorted(TREE_STEMS)
        assert row.ref_census_digest == slug_census_digest(REF_STEMS)
        assert row.work_tree_census_digest == slug_census_digest(TREE_STEMS)
        assert row.census_ref_sha == "a" * 40
        assert row.census_observed_at is not None

    async def test_one_side_alone_leaves_the_other_unknown(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """``resolve_scan_source`` can return no ref at all; the ref census is
        then ABSENT, and absent is UNKNOWN rather than an empty ref."""
        async with _client(app_no_cognito) as client:
            resp = await client.post(
                SCAN_ROOTS, json=_reading(censuses=[_census("work_tree", TREE_STEMS)])
            )
        assert resp.status_code == 201, resp.text
        row = await _row(async_db_session)
        assert row.work_tree_census is not None
        assert row.ref_census is None
        assert row.census_ref_sha is None


# ===========================================================================
# 2. The withheld-set heartbeat, both directions
# ===========================================================================


class TestWithheldSetResolution:
    async def test_a_matching_digest_keeps_the_stored_stems(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """~1826 stems is ~100 KB on a per-cycle heartbeat, so the device sends
        them only when the digest moves. An unchanged report must not cost the
        stored set."""
        async with _client(app_no_cognito) as client:
            await client.post(SCAN_ROOTS, json=_with_censuses())
            resp = await client.post(
                SCAN_ROOTS,
                json=_reading(
                    censuses=[
                        _census(
                            "ref",
                            None,
                            _digest_over=REF_STEMS,
                            count=len(REF_STEMS),
                            ref_sha="c" * 40,
                        ),
                        _census(
                            "work_tree",
                            None,
                            _digest_over=TREE_STEMS,
                            count=len(TREE_STEMS),
                        ),
                    ]
                ),
            )
        assert resp.status_code == 200, resp.text

        row = await _row(async_db_session)
        assert row.ref_census["slugs"] == sorted(REF_STEMS), (
            "a withheld set whose digest matches must be carried forward"
        )
        assert row.work_tree_census["slugs"] == sorted(TREE_STEMS)
        # The rest of the census is THIS cycle's reading, not the old one.
        assert row.ref_census["ref_sha"] == "c" * 40
        assert row.census_ref_sha == "c" * 40

    async def test_a_mismatched_digest_clears_the_stems_to_unknown(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """The device is asserting a set this server has never seen. Keeping
        the old stems would publish a set difference against stems nobody
        claims — the exact false reading this plan removes."""
        moved = [*REF_STEMS, "2026-09-05-epsilon"]
        async with _client(app_no_cognito) as client:
            await client.post(SCAN_ROOTS, json=_with_censuses())
            resp = await client.post(
                SCAN_ROOTS,
                json=_reading(
                    censuses=[
                        _census("ref", None, _digest_over=moved, count=len(moved)),
                        _census(
                            "work_tree",
                            None,
                            _digest_over=TREE_STEMS,
                            count=len(TREE_STEMS),
                        ),
                    ]
                ),
            )
        assert resp.status_code == 200, resp.text

        row = await _row(async_db_session)
        assert row.ref_census["slugs"] is None, (
            "an unvouched-for set is cleared to UNKNOWN, never kept"
        )
        assert row.ref_census_digest == slug_census_digest(moved)
        assert row.ref_census["count"] == len(moved)
        # The other source is untouched by its neighbour's mismatch.
        assert row.work_tree_census["slugs"] == sorted(TREE_STEMS)

    async def test_stems_return_on_the_next_report_that_carries_them(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        moved = [*REF_STEMS, "2026-09-05-epsilon"]
        async with _client(app_no_cognito) as client:
            await client.post(SCAN_ROOTS, json=_with_censuses())
            await client.post(
                SCAN_ROOTS,
                json=_reading(
                    censuses=[
                        _census("ref", None, _digest_over=moved, count=len(moved))
                    ]
                ),
            )
            await client.post(
                SCAN_ROOTS, json=_reading(censuses=[_census("ref", moved)])
            )

        row = await _row(async_db_session)
        assert row.ref_census["slugs"] == sorted(moved)

    async def test_a_withheld_set_with_nothing_stored_is_unknown_not_empty(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        async with _client(app_no_cognito) as client:
            resp = await client.post(
                SCAN_ROOTS,
                json=_reading(
                    censuses=[
                        _census(
                            "ref", None, _digest_over=REF_STEMS, count=len(REF_STEMS)
                        )
                    ]
                ),
            )
        assert resp.status_code == 201, resp.text
        row = await _row(async_db_session)
        assert row.ref_census["slugs"] is None


# ===========================================================================
# 3. Whole-snapshot discipline
# ===========================================================================


class TestSnapshotDiscipline:
    async def test_a_source_the_report_omits_goes_unknown(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        async with _client(app_no_cognito) as client:
            await client.post(SCAN_ROOTS, json=_with_censuses())
            await client.post(
                SCAN_ROOTS, json=_reading(censuses=[_census("work_tree", TREE_STEMS)])
            )
        row = await _row(async_db_session)
        assert row.ref_census is None
        assert row.ref_census_digest is None
        assert row.work_tree_census is not None

    async def test_an_idle_cycle_reporting_no_census_clears_both(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """An enumeration that did not run is UNKNOWN, never a zero — and a
        stale set left behind from an earlier cycle would read as current."""
        async with _client(app_no_cognito) as client:
            await client.post(SCAN_ROOTS, json=_with_censuses())
            await client.post(SCAN_ROOTS, json=_reading())
        row = await _row(async_db_session)
        assert (row.ref_census, row.work_tree_census) == (None, None)
        assert row.census_observed_at is None

    async def test_an_out_of_order_report_changes_no_census(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        late = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
        async with _client(app_no_cognito) as client:
            await client.post(SCAN_ROOTS, json=_with_censuses())
            resp = await client.post(
                SCAN_ROOTS, json=_reading(observed_at=late, censuses=[])
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["applied"] is False
        row = await _row(async_db_session)
        assert row.ref_census["slugs"] == sorted(REF_STEMS)
        assert row.work_tree_census["slugs"] == sorted(TREE_STEMS)


# ===========================================================================
# 4. Truncation is a FLOOR — the word the fleet already has
# ===========================================================================


class TestTruncationFloor:
    async def test_a_truncated_census_is_stored_as_a_floor(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        sent = sorted(REF_STEMS)[:2]
        async with _client(app_no_cognito) as client:
            resp = await client.post(
                SCAN_ROOTS,
                json=_reading(
                    censuses=[
                        _census(
                            "ref",
                            sent,
                            count=len(REF_STEMS),
                            truncated=True,
                            digest=slug_census_digest(sent),
                        )
                    ]
                ),
            )
        assert resp.status_code == 201, resp.text
        row = await _row(async_db_session)
        assert row.ref_census["truncated"] is True
        assert row.ref_census["slugs"] == sent
        # ``count`` is the exact enumeration; it is the SET that is the floor.
        assert row.ref_census["count"] == len(REF_STEMS)
        assert row.ref_census_digest == slug_census_digest(sent)

    def test_the_digest_covers_the_prefix_that_was_sent(self) -> None:
        """A truncated census digests what it transmitted, so this server can
        verify what it stored rather than take the device's word for it."""
        sent = sorted(REF_STEMS)[:2]
        census = _census(
            "ref", sent, count=99, truncated=True, digest=slug_census_digest(sent)
        )
        assert ScanRootReport(**_reading(censuses=[census])).censuses[0].truncated

    def test_an_untruncated_census_must_send_every_stem_it_counted(self) -> None:
        bad = _census("ref", REF_STEMS, count=len(REF_STEMS) + 1)
        with pytest.raises(ValidationError, match="must send every stem it counted"):
            ScanRootReport(**_reading(censuses=[bad]))

    def test_a_truncation_that_did_not_happen_is_refused(self) -> None:
        bad = _census("ref", REF_STEMS, truncated=True)
        with pytest.raises(ValidationError, match="truncation that did not happen"):
            ScanRootReport(**_reading(censuses=[bad]))


# ===========================================================================
# 5. Validation — each 422 for the reason named
# ===========================================================================


class TestCensusValidation:
    def test_the_digest_is_verified_against_the_stems(self) -> None:
        bad = _census("ref", REF_STEMS, digest="0" * 64)
        with pytest.raises(ValidationError, match="does not match the stems sent"):
            ScanRootReport(**_reading(censuses=[bad]))

    def test_a_digest_is_required_even_when_the_stems_are_withheld(self) -> None:
        bad = _census("ref", None, _digest_over=REF_STEMS, count=4)
        bad.pop("digest")
        with pytest.raises(ValidationError, match="digest"):
            ScanRootReport(**_reading(censuses=[bad]))

    def test_a_non_sha256_digest_is_refused(self) -> None:
        bad = _census("ref", None, _digest_over=REF_STEMS, count=4, digest="Z" * 64)
        with pytest.raises(ValidationError, match="64 lowercase hex"):
            ScanRootReport(**_reading(censuses=[bad]))

    def test_an_unknown_key_inside_a_census_is_refused(self) -> None:
        bad = _census("ref", REF_STEMS)
        bad["scanned_at"] = "2026-09-15T00:00:00Z"
        with pytest.raises(ValidationError, match="scanned_at"):
            ScanRootReport(**_reading(censuses=[bad]))

    def test_two_censuses_of_one_source_are_refused(self) -> None:
        with pytest.raises(ValidationError, match="at most one census per source"):
            ScanRootReport(
                **_reading(
                    censuses=[_census("ref", REF_STEMS), _census("ref", TREE_STEMS)]
                )
            )

    def test_more_than_two_censuses_are_refused(self) -> None:
        with pytest.raises(ValidationError):
            ScanRootReport(
                **_reading(
                    censuses=[
                        _census("ref", REF_STEMS),
                        _census("work_tree", TREE_STEMS),
                        _census("ref", TREE_STEMS),
                    ]
                )
            )

    def test_not_scanning_may_carry_no_census(self) -> None:
        """Nothing is scanned at all, so a census there is a count nobody took.

        Scope, stated precisely because the claim this docstring used to make
        was false: this covers the ``not_scanning`` STATE ONLY. It is **not**
        the web-side backstop for the runner's three idle arms.
        ``report_while_idle`` posts the CACHED ``ScanDivergence``, and only the
        plans-dir-cleared arm (``trigger.rs:2614``) yields ``not_scanning``;
        the publishes-nothing arm (``:2668``) and the scan-task-FAILED arm
        (``:2697``) post the last reading, normally ``state: "measured"`` — so
        this rule does not reach the arm the plan calls the one that matters
        most, where the enumeration did not happen at all.

        It is also a NEW cross-field rejection, not in Phase 1's spec, and
        every new rejection on this route is a permanent-mute hazard. Phase 2
        must therefore know the rule rather than discover it as a 422: a
        ``not_scanning`` report must carry ``censuses: []``.
        """
        with pytest.raises(ValidationError, match="carries no census"):
            ScanRootReport(
                **_reading(
                    state="not_scanning",
                    behind=None,
                    ahead=None,
                    ref_age_secs=None,
                    censuses=[_census("work_tree", TREE_STEMS)],
                )
            )

    def test_over_the_cap_is_refused_rather_than_silently_trimmed(self) -> None:
        stems = [f"2026-01-01-plan-{n:06d}" for n in range(SLUG_CENSUS_MAX + 1)]
        bad = _census("ref", stems)
        with pytest.raises(ValidationError):
            ScanRootReport(**_reading(censuses=[bad]))

    def test_a_stem_the_write_door_would_accept_is_not_refused_here(self) -> None:
        """The bound is the door a stem actually has to pass.

        ``agent.work_artifacts.slug`` is ``Text`` — unbounded — and
        ``WorkArtifactUpsert.slug`` caps it at 512; the 255 this schema used to
        carry is ``work_unit_slug``'s bound, a DIFFERENT column. A 256-512
        character stem is a legal artifact slug, and refusing it would 422 the
        WHOLE report, permanently, for any device whose stem list comes from a
        directory listing.
        """
        for length in (256, 512):
            stem = "x" * length
            census = _census("ref", [stem])
            parsed = ScanRootReport(**_reading(censuses=[census]))
            assert parsed.censuses[0].slugs == [stem]

    def test_an_over_long_stem_is_refused(self) -> None:
        """Past the write door's own 512 the stem could never become an
        artifact, so accepting it would store a member of no set."""
        bad = _census("ref", ["x" * 513])
        with pytest.raises(ValidationError):
            ScanRootReport(**_reading(censuses=[bad]))

    def test_an_empty_stem_is_refused(self) -> None:
        bad = _census("ref", [""])
        with pytest.raises(ValidationError):
            ScanRootReport(**_reading(censuses=[bad]))

    def test_duplicate_stems_are_refused(self) -> None:
        bad = _census("ref", ["a-plan", "a-plan"], count=2)
        bad["digest"] = slug_census_digest(["a-plan", "a-plan"])
        with pytest.raises(ValidationError, match="a census is a SET of stems"):
            ScanRootReport(**_reading(censuses=[bad]))

    def test_a_stringly_typed_count_is_refused(self) -> None:
        bad = _census("ref", REF_STEMS, count=str(len(REF_STEMS)))
        with pytest.raises(ValidationError):
            ScanRootReport(**_reading(censuses=[bad]))

    def test_a_stringly_typed_truncated_is_refused(self) -> None:
        bad = _census("ref", REF_STEMS, truncated="false")
        with pytest.raises(ValidationError):
            ScanRootReport(**_reading(censuses=[bad]))

    def test_an_unknown_source_is_refused(self) -> None:
        bad = _census("ref", REF_STEMS)
        bad["source"] = "index"
        with pytest.raises(ValidationError):
            ScanRootReport(**_reading(censuses=[bad]))

    async def test_a_refused_census_writes_nothing(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        bad = _census("ref", REF_STEMS, digest="0" * 64)
        async with _client(app_no_cognito) as client:
            resp = await client.post(SCAN_ROOTS, json=_reading(censuses=[bad]))
        assert resp.status_code == 422, resp.text
        result = await async_db_session.execute(
            select(PlanScanRootObservation).where(
                PlanScanRootObservation.device_id == DEVICE_A
            )
        )
        assert result.scalars().all() == []


# ===========================================================================
# The digest definition itself — a cross-repo wire contract
# ===========================================================================


class TestDigestDefinition:
    def test_it_is_sha256_over_the_sorted_newline_joined_stems(self) -> None:
        """Pinned by construction, not by the implementation: the runner half
        computes this in Rust and both must agree byte for byte."""
        stems = ["gamma", "alpha", "beta"]
        expected = hashlib.sha256(b"alpha\nbeta\ngamma").hexdigest()
        assert slug_census_digest(stems) == expected

    def test_order_does_not_change_it(self) -> None:
        assert slug_census_digest(REF_STEMS) == slug_census_digest(REF_STEMS[::-1])

    def test_the_empty_set_has_a_digest_of_its_own(self) -> None:
        """A side that really holds no plans is a reading, not a silence."""
        assert slug_census_digest([]) == hashlib.sha256(b"").hexdigest()


# ===========================================================================
# The documented sort is ENFORCED, not merely asserted
# ===========================================================================


class TestStemsAreSortedAsStored:
    def test_an_unsorted_list_is_normalized_rather_than_stored_unsorted(
        self,
    ) -> None:
        """``slugs`` documents itself "sorted" and the digest is taken over
        ``sorted()``, so an unsorted list with a CORRECT digest passed every
        check and was stored in whatever order it arrived — the one invariant
        this module stated and did not enforce, on a cross-repo contract
        field."""
        unsorted = ["c-gamma", "a-alpha", "b-beta"]
        census = _census("ref", None, _digest_over=unsorted)
        census["slugs"] = unsorted
        census["count"] = len(unsorted)
        parsed = ScanRootReport(**_reading(censuses=[census]))
        assert parsed.censuses[0].slugs == sorted(unsorted)

    async def test_the_stored_stems_are_sorted(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        unsorted = ["c-gamma", "a-alpha", "b-beta"]
        census = _census("ref", None, _digest_over=unsorted)
        census["slugs"] = unsorted
        census["count"] = len(unsorted)
        async with _client(app_no_cognito) as client:
            resp = await client.post(SCAN_ROOTS, json=_reading(censuses=[census]))
        assert resp.status_code == 201, resp.text
        row = await _row(async_db_session)
        assert row.ref_census["slugs"] == sorted(unsorted)


# ===========================================================================
# The census JSON is DEFERRED on the list read that rides every page
# ===========================================================================


class TestCensusJsonIsNotDraggedOntoEveryListPage:
    async def test_list_observations_defers_both_census_columns(
        self, async_db_session: AsyncSession
    ) -> None:
        """``list_observations`` is not only the scan-roots route's.

        ``_load_corpus_health`` calls it, and that block rides EVERY
        ``GET /plan-library`` list page and ``/plan-library/candidates``, while
        ``plan_scan_root_health.render_row`` renders no stem — so every stored
        stem was detoasted, transferred, decoded and discarded on every page.
        Measured: 1837 stems ≈ 103.6 KB per census, ≈ 208 KB per device for
        both. At the measured average stem length (53.9 chars) the realistic
        ceiling is ≈ 0.27 MB per census; the schema's WORST case is
        5000 × 512, ≈ 2.46 MB. It is also the exact
        cost the coverage design decision refused to pay ("an anti-join over
        ~1800 slugs on every list request"), arriving by another route.

        ⚠️ Phase 3's coverage read must UNDEFER them. Touching a deferred
        attribute on a row loaded through an ``AsyncSession`` raises
        ``sqlalchemy.exc.MissingGreenlet``, not an extra SELECT.
        """
        from sqlalchemy import inspect as sa_inspect

        from app.crud.plan_scan_root import list_observations

        async_db_session.add(
            PlanScanRootObservation(
                organization_id=None,
                device_id=DEVICE_A,
                state="measured",
                plans_dir="/p/plans",
                repo_root="/p",
                source_repo="p/plans",
                default_ref="origin/main",
                ref_sha="a" * 40,
                head_sha="b" * 40,
                behind=1,
                ahead=0,
                ref_age_secs=10,
                counts_are_floors=False,
                detail=None,
                observed_at=datetime.now(UTC),
                received_at=datetime.now(UTC),
                last_report_applied=True,
                last_report_observed_at=datetime.now(UTC),
                ref_census={"source": "ref", "slugs": sorted(REF_STEMS)},
                ref_census_digest=slug_census_digest(REF_STEMS),
                work_tree_census={"source": "work_tree", "slugs": sorted(TREE_STEMS)},
                work_tree_census_digest=slug_census_digest(TREE_STEMS),
            )
        )
        await async_db_session.commit()
        async_db_session.expunge_all()

        rows = await list_observations(async_db_session, org_id=None)
        assert len(rows) == 1
        unloaded = sa_inspect(rows[0]).unloaded
        assert {"ref_census", "work_tree_census"} <= unloaded, (
            "both census JSON columns must be deferred on this read — it rides "
            "every plan-library list page and renders none of them"
        )
        # The small columns a reader needs to know a census EXISTS stay loaded.
        assert "ref_census_digest" not in unloaded
        assert "census_observed_at" not in unloaded
