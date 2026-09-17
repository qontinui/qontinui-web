"""Captured-vs-authored coverage — the SET DIFFERENCE, and the ratio that is not.

Phase 3 of ``2026-09-15-captured-vs-authored-coverage-is-a-set-difference``.
DB-free: every case builds in-memory ``PlanScanRootObservation`` rows carrying
their stored censuses and renders them through
:func:`app.services.plan_scan_root_health.scan_roots_health`, the one builder
``GET /plan-library/scan-roots`` and ``corpus_health.scan_roots`` share. The
corpus side is handed in as a :class:`CapturedPlanCorpus`, which is what the
crud query returns, so the arithmetic is pinned without a database.

What is asserted, and why each is a separate claim
--------------------------------------------------

1. **The answer is a set difference, and it is ATTRIBUTED.**
   ``authored_not_captured`` minus ``authored_not_captured_but_invisible`` is
   the number an operator can act on: a stem that is not even in the working
   tree the body sync scans could not have been captured, so it is checkout
   freshness rather than a capture defect.
2. **NO RATIO IS EMITTED, ANYWHERE.** Asserted structurally — over the model's
   own fields and over the serialized response — rather than by naming the
   fields we happened to think of, because the defect this phase closes is a
   number nobody meant to publish.
3. **The 101.8% case is pinned.** An organization whose corpus holds plan rows
   under a DIFFERENT ``source_repo`` produces
   ``both + captured_not_authored == captured``, a non-zero
   ``out_of_scope_artifact_count`` naming exactly those rows, and an
   intersection that cannot exceed either side it was taken from. That is the
   production reading (56 plan rows against 55 authored stems = 101.8%) made
   unconstructible from what is served.
4. **UNKNOWN is first-class and never a zero.** No census, a truncated census,
   and an unnamed ``source_repo`` each read ``state: "unknown"`` with their own
   ``detail`` and EVERY number null — and the key is still emitted, because an
   omitted key reads as "no such scan source".
5. **A silent or contradicted device's census is not used**, by the same rule
   its counts are not: it establishes nothing about now.
6. **The freshest ref wins, deterministically, and the others are named.**
7. **The honesty vocabulary is carried onto the entry**, not left to be joined
   out of ``by_source_repo``.
8. **Design decision D2**: coverage is computed on the dedicated route only.
   The ``corpus_health`` rendering leaves it empty *with a stated reason*, and
   the route reads the observations through the CENSUS-LOADING crud function —
   the deferred one would raise ``MissingGreenlet`` on a stem.

Each rule was mutation-proved when written: dropping ``- visible`` from the
attribution (fails 1), emitting ``captured / authored`` as a field (fails 2),
counting every plan row as the numerator instead of the key's own (fails 3's
``captured``/``out_of_scope`` pair), serving 0 instead of null on a missing
census (fails 4), omitting a key with no census (fails 4's key list), accepting
a truncated census (fails 4's truncation case), dropping ``observation_fresh``
or ``last_report_applied`` from the usable filter (fails 5), sorting an unknown
``ref_age_secs`` as 0 (fails 6), copying the census device's ``behind`` in
place of the roll-up's ``min_behind`` (fails 7), and passing ``captured`` from
the corpus-health path (fails 8).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.crud.work_artifact import CapturedPlanCorpus
from app.models.plan_scan_root import PlanScanRootObservation
from app.schemas.plan_library_scan_roots import (
    COVERAGE_MISSING_SAMPLE_MAX,
    PlanCoverage,
    slug_census_digest,
)
from app.services.plan_scan_root_health import (
    COVERAGE_NO_OBSERVATION_DETAIL,
    COVERAGE_NOT_COMPUTED_DETAIL,
    COVERAGE_READ_FAILED_DETAIL,
    FRESH_WITHIN_SECS,
    SOURCE_REPO_UNNAMED_DETAIL,
    scan_roots_health,
    scan_roots_read_failed,
)

NOW = datetime(2026, 9, 16, 5, 0, tzinfo=UTC)
SOURCE = "qontinui-dev-notes/plans"
#: The bare-repo key a hand-``POST``ed row lands under — a DIFFERENT identity
#: from the scanner's two-component form, and the source of the 101.8%.
OTHER_SOURCE = "qontinui-dev-notes"
REF = "d455ad5cb" + "0" * 31


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _census(
    source: str,
    slugs: list[str],
    *,
    truncated: bool = False,
    count: int | None = None,
    ref_sha: str | None = None,
) -> dict[str, Any]:
    """A stored census, shaped exactly as the upsert writes one."""
    return {
        "source": source,
        "ref_sha": ref_sha if source == "ref" else None,
        "count": len(slugs) if count is None else count,
        "digest": slug_census_digest(slugs),
        "slugs": sorted(slugs),
        "truncated": truncated,
    }


def _obs(
    *,
    authored: list[str] | None = None,
    visible: list[str] | None = None,
    **overrides: Any,
) -> PlanScanRootObservation:
    """A fresh, applied ``measured`` reading carrying both stem listings."""
    fields: dict[str, Any] = {
        "device_id": uuid4(),
        "organization_id": None,
        "state": "measured",
        "detail": None,
        "plans_dir": "/w/qontinui-dev-notes/plans",
        "repo_root": "/w/qontinui-dev-notes",
        "source_repo": SOURCE,
        "default_ref": "origin/main",
        "ref_sha": REF,
        "head_sha": "0d2390c07",
        "behind": 254,
        "ahead": 0,
        "ref_age_secs": 120,
        "counts_are_floors": False,
        "observed_at": NOW,
        "received_at": NOW,
        "last_report_applied": True,
        "last_report_observed_at": NOW,
        "ref_census": None,
        "ref_census_digest": None,
        "work_tree_census": None,
        "work_tree_census_digest": None,
        "census_ref_sha": None,
        "census_observed_at": None,
    }
    if authored is not None:
        fields["ref_census"] = _census("ref", authored, ref_sha=REF)
        fields["ref_census_digest"] = fields["ref_census"]["digest"]
        fields["census_ref_sha"] = REF
        fields["census_observed_at"] = NOW
    if visible is not None:
        fields["work_tree_census"] = _census("work_tree", visible)
        fields["work_tree_census_digest"] = fields["work_tree_census"]["digest"]
        fields["census_observed_at"] = NOW
    fields.update(overrides)
    return PlanScanRootObservation(**fields)


def _corpus(
    *, under_key: list[str], total_plan_rows: int | None = None
) -> CapturedPlanCorpus:
    """The corpus side: this key's stems, and every plan row in the org."""
    return CapturedPlanCorpus(
        slugs_by_source_repo={SOURCE: frozenset(under_key)},
        plan_row_count=len(under_key) if total_plan_rows is None else total_plan_rows,
    )


def _only(
    observations: list[PlanScanRootObservation], captured: CapturedPlanCorpus
) -> PlanCoverage:
    health = scan_roots_health(observations, now=NOW, captured=captured)
    assert len(health.coverage) == 1, health.coverage
    assert health.coverage_detail is None
    return health.coverage[0]


def _stems(*names: str) -> list[str]:
    return [f"2026-09-{n}" for n in names]


# ---------------------------------------------------------------------------
# 1. The set difference, attributed
# ---------------------------------------------------------------------------


class TestTheSetDifference:
    def test_the_two_denominators_and_the_attribution(self) -> None:
        # Four plans exist at the ref. The scanned tree is behind and holds
        # only three of them. The corpus captured two.
        authored = _stems("01-alpha", "02-beta", "03-gamma", "04-delta")
        visible = _stems("01-alpha", "02-beta", "03-gamma")
        entry = _only(
            [_obs(authored=authored, visible=visible)],
            _corpus(under_key=_stems("01-alpha", "02-beta")),
        )

        assert entry.state == "measured"
        assert entry.detail is None
        assert entry.authored_at_ref is not None
        assert entry.visible_to_scanner is not None
        # Denominator 1: what EXISTS. Denominator 2: what the sync could see.
        assert (entry.authored_at_ref.count, entry.visible_to_scanner.count) == (4, 3)
        assert entry.authored_at_ref.source == "ref"
        assert entry.visible_to_scanner.source == "work_tree"
        assert entry.captured == 2
        assert entry.both == 2
        assert entry.captured_not_authored == 0
        assert entry.authored_not_captured == 2
        # gamma is in the tree and was not captured -> a real capture gap.
        # delta is not in the tree at all -> checkout freshness.
        assert entry.authored_not_captured_but_invisible == 1
        assert entry.authored_not_captured - entry.authored_not_captured_but_invisible == 1
        assert entry.missing_sample == sorted(_stems("03-gamma", "04-delta"))
        assert entry.sample_truncated is False

    def test_a_captured_stem_absent_from_the_ref_is_named_not_subtracted(self) -> None:
        """A plan deleted or renamed upstream is not a coverage defect."""
        entry = _only(
            [_obs(authored=_stems("01-alpha"), visible=_stems("01-alpha"))],
            _corpus(under_key=_stems("01-alpha", "00-retired")),
        )

        assert entry.captured == 2
        assert entry.both == 1
        assert entry.captured_not_authored == 1
        assert entry.authored_not_captured == 0
        # It is never subtracted from the authored side.
        assert entry.authored_at_ref is not None
        assert entry.authored_at_ref.count == 1

    def test_the_missing_sample_is_capped_and_says_so(self) -> None:
        authored = [f"2026-09-{i:04d}-plan" for i in range(COVERAGE_MISSING_SAMPLE_MAX + 7)]
        entry = _only(
            [_obs(authored=authored, visible=authored)],
            _corpus(under_key=[]),
        )

        assert entry.authored_not_captured == COVERAGE_MISSING_SAMPLE_MAX + 7
        assert len(entry.missing_sample) == COVERAGE_MISSING_SAMPLE_MAX
        assert entry.sample_truncated is True
        # A prefix of the SORTED difference, so two reads agree.
        assert entry.missing_sample == sorted(authored)[:COVERAGE_MISSING_SAMPLE_MAX]


# ---------------------------------------------------------------------------
# 2 & 3. No ratio, and the 101.8% regression pin
# ---------------------------------------------------------------------------


def _leaf_values(value: Any, path: str = "") -> list[tuple[str, Any]]:
    if isinstance(value, dict):
        return [p for k, v in value.items() for p in _leaf_values(v, f"{path}.{k}")]
    if isinstance(value, list):
        return [p for i, v in enumerate(value) for p in _leaf_values(v, f"{path}[{i}]")]
    return [(path, value)]


class TestNoRatioIsEmitted:
    #: Anything a reader could mistake for, or read straight off as, a
    #: percentage. Matched against field names as substrings.
    FORBIDDEN = ("ratio", "percent", "pct", "fraction", "rate", "score")

    def test_no_coverage_field_is_named_like_a_ratio(self) -> None:
        for name in PlanCoverage.model_fields:
            assert not any(word in name for word in self.FORBIDDEN), name

    def test_no_served_value_is_fractional(self) -> None:
        """Structural, not enumerated: a ratio would have to be a float."""
        entry = _only(
            [_obs(authored=_stems("01-a", "02-b", "03-c"), visible=_stems("01-a"))],
            _corpus(under_key=_stems("01-a"), total_plan_rows=9),
        )

        for path, value in _leaf_values(entry.model_dump(mode="json")):
            assert not isinstance(value, float), (path, value)

    def test_the_101_8_percent_case_cannot_be_constructed(self) -> None:
        """The production reading: 56 plan rows against 55 authored stems.

        The corpus holds 54 rows under the scanner's key and 2 under a bare
        ``qontinui-dev-notes`` key a hand-``POST`` created. Dividing the
        corpus's plan count by the authored count reads 101.8% — an impossible
        coverage, and the whole reason this block emits a set difference.
        """
        authored = [f"2026-09-{i:04d}-plan" for i in range(55)]
        captured_here = authored[:54]
        corpus = CapturedPlanCorpus(
            slugs_by_source_repo={SOURCE: frozenset(captured_here)},
            # 54 under this key + 2 under OTHER_SOURCE.
            plan_row_count=56,
        )

        entry = _only([_obs(authored=authored, visible=authored)], corpus)

        assert entry.state == "measured"
        # The numerator is THIS key's rows, never the corpus's plan count.
        assert entry.captured == 54
        assert entry.authored_at_ref is not None
        assert entry.authored_at_ref.count == 55
        # The rows a naive numerator swallowed are NAMED instead.
        assert entry.out_of_scope_artifact_count == 2
        # The acceptance identity: the captured set partitions exactly.
        assert entry.both + entry.captured_not_authored <= entry.captured
        assert entry.both + entry.captured_not_authored == entry.captured
        # And the intersection can never exceed either side it came from.
        assert entry.both <= entry.authored_at_ref.count
        assert entry.both <= entry.captured
        # One real gap, and it is not explained away by the checkout.
        assert entry.authored_not_captured == 1
        assert entry.authored_not_captured_but_invisible == 0

        # Nothing served here is the corpus's whole plan count, which is the
        # numerator that produced 56/55.
        assert corpus.plan_row_count not in (entry.captured, entry.both)
        # And every quantity that IS a subset of the authored side is bounded
        # by it, so no pairing of served numbers exceeds 100%.
        for name in (
            "both",
            "authored_not_captured",
            "authored_not_captured_but_invisible",
        ):
            assert getattr(entry, name) <= entry.authored_at_ref.count, name

    def test_an_out_of_scope_corpus_is_not_a_missing_denominator(self) -> None:
        """Every plan row under another key still leaves coverage MEASURED at 0.

        The distinction the block exists for: "the corpus holds none of THIS
        key's plans" is measured and actionable; "we cannot see what exists" is
        UNKNOWN. They must not render the same.
        """
        authored = _stems("01-a", "02-b")
        corpus = CapturedPlanCorpus(
            slugs_by_source_repo={SOURCE: frozenset()}, plan_row_count=40
        )

        entry = _only([_obs(authored=authored, visible=authored)], corpus)

        assert entry.state == "measured"
        assert entry.captured == 0
        assert entry.both == 0
        assert entry.authored_not_captured == 2
        assert entry.out_of_scope_artifact_count == 40


# ---------------------------------------------------------------------------
# 4 & 5. UNKNOWN is first-class
# ---------------------------------------------------------------------------


def _assert_establishes_nothing(entry: PlanCoverage) -> None:
    """Every number null — not one of them a zero."""
    assert entry.state == "unknown"
    assert entry.detail is not None
    assert entry.authored_at_ref is None
    assert entry.visible_to_scanner is None
    assert entry.captured is None
    assert entry.both is None
    assert entry.authored_not_captured is None
    assert entry.captured_not_authored is None
    assert entry.authored_not_captured_but_invisible is None
    assert entry.out_of_scope_artifact_count is None
    assert entry.missing_sample == []
    assert entry.sample_truncated is False


class TestUnknownIsFirstClass:
    def test_no_census_is_unknown_with_the_key_still_emitted(self) -> None:
        entry = _only([_obs()], _corpus(under_key=_stems("01-a")))

        _assert_establishes_nothing(entry)
        assert entry.detail is not None
        assert entry.detail.startswith("no_census:")
        assert entry.source_repo == SOURCE
        assert entry.device_count == 1
        assert entry.census_device_id is None
        assert entry.other_census_device_ids == []

    @pytest.mark.parametrize("missing", ["ref", "work_tree"])
    def test_one_side_alone_is_unknown(self, missing: str) -> None:
        """Without BOTH sides the gap cannot be attributed, so nothing is served.

        Serving ``authored_not_captured`` beside a null attribution field would
        read as a capture defect when it may be pure checkout freshness.
        """
        stems = _stems("01-a", "02-b")
        obs = (
            _obs(visible=stems) if missing == "ref" else _obs(authored=stems)
        )
        entry = _only([obs], _corpus(under_key=[]))

        _assert_establishes_nothing(entry)
        assert entry.detail is not None
        assert entry.detail.startswith("no_census:")

    def test_a_withheld_set_the_upsert_could_not_carry_forward_is_unknown(self) -> None:
        """``slugs: null`` inside a stored census is UNKNOWN, not an empty side."""
        withheld = _census("ref", _stems("01-a"), ref_sha=REF)
        withheld["slugs"] = None
        entry = _only(
            [_obs(visible=_stems("01-a"), ref_census=withheld)],
            _corpus(under_key=_stems("01-a")),
        )

        _assert_establishes_nothing(entry)

    def test_a_truncated_census_is_unknown_and_names_the_device(self) -> None:
        obs = _obs(authored=_stems("01-a"), visible=_stems("01-a"))
        assert obs.ref_census is not None
        obs.ref_census = {**obs.ref_census, "truncated": True, "count": 5001}

        entry = _only([obs], _corpus(under_key=_stems("01-a")))

        _assert_establishes_nothing(entry)
        assert entry.detail is not None
        assert entry.detail.startswith("census_truncated:")
        assert "ref" in entry.detail
        # The device WAS chosen and then disqualified, so a reader can see
        # which box to look at.
        assert entry.census_device_id == obs.device_id
        assert entry.observation_fresh is True

    def test_the_null_source_repo_group_is_unknown_with_its_own_detail(self) -> None:
        stems = _stems("01-a")
        unnamed = _obs(source_repo=None, authored=stems, visible=stems)

        health = scan_roots_health([unnamed], now=NOW, captured=_corpus(under_key=[]))

        assert len(health.coverage) == 1
        entry = health.coverage[0]
        _assert_establishes_nothing(entry)
        assert entry.source_repo is None
        assert entry.detail == SOURCE_REPO_UNNAMED_DETAIL

    def test_a_silent_device_s_census_is_not_used(self) -> None:
        stems = _stems("01-a", "02-b")
        silent = _obs(
            authored=stems,
            visible=stems,
            received_at=NOW - timedelta(seconds=FRESH_WITHIN_SECS + 60),
        )

        entry = _only([silent], _corpus(under_key=[]))

        _assert_establishes_nothing(entry)
        assert entry.detail is not None
        assert entry.detail.startswith("no_census:")

    def test_a_contradicted_device_s_census_is_not_used(self) -> None:
        stems = _stems("01-a", "02-b")
        superseded = _obs(
            authored=stems,
            visible=stems,
            last_report_applied=False,
            last_report_observed_at=NOW - timedelta(seconds=90),
        )

        entry = _only([superseded], _corpus(under_key=[]))

        _assert_establishes_nothing(entry)

    def test_every_reported_key_gets_an_entry_in_the_rollup_s_order(self) -> None:
        stems = _stems("01-a")
        named = _obs(authored=stems, visible=stems)
        bare = _obs(source_repo=OTHER_SOURCE)
        unnamed = _obs(source_repo=None)

        health = scan_roots_health(
            [named, bare, unnamed],
            now=NOW,
            captured=CapturedPlanCorpus(
                slugs_by_source_repo={SOURCE: frozenset(stems), OTHER_SOURCE: frozenset()},
                plan_row_count=1,
            ),
        )

        assert [c.source_repo for c in health.coverage] == [
            r.source_repo for r in health.by_source_repo
        ]
        assert [c.source_repo for c in health.coverage] == [
            OTHER_SOURCE,
            SOURCE,
            None,
        ]
        assert [c.state for c in health.coverage] == ["unknown", "measured", "unknown"]


# ---------------------------------------------------------------------------
# 6 & 7. Device choice, and the honesty vocabulary
# ---------------------------------------------------------------------------


class TestDeviceChoiceAndQualification:
    def test_the_freshest_ref_wins_and_the_others_are_named(self) -> None:
        stale_ref = _obs(
            authored=_stems("01-a", "02-b"),
            visible=_stems("01-a", "02-b"),
            ref_age_secs=9000,
        )
        fresh_ref = _obs(
            authored=_stems("01-a", "02-b", "03-c"),
            visible=_stems("01-a", "02-b", "03-c"),
            ref_age_secs=60,
        )

        entry = _only([stale_ref, fresh_ref], _corpus(under_key=_stems("01-a")))

        assert entry.census_device_id == fresh_ref.device_id
        assert entry.other_census_device_ids == [stale_ref.device_id]
        assert entry.authored_at_ref is not None
        # The chosen device's set, not the other's.
        assert entry.authored_at_ref.count == 3
        assert entry.authored_at_ref.ref_age_secs == 60

    def test_an_unknown_ref_age_sorts_last_not_as_zero(self) -> None:
        unknown_age = _obs(
            authored=_stems("01-a", "02-b"),
            visible=_stems("01-a", "02-b"),
            ref_age_secs=None,
            counts_are_floors=True,
        )
        known_age = _obs(
            authored=_stems("01-a"),
            visible=_stems("01-a"),
            ref_age_secs=3600,
        )

        entry = _only([unknown_age, known_age], _corpus(under_key=[]))

        assert entry.census_device_id == known_age.device_id
        assert entry.other_census_device_ids == [unknown_age.device_id]

    def test_the_choice_is_stable_across_reads(self) -> None:
        """A tie falls to the device id, so two reads serialize identically."""
        stems = _stems("01-a")
        a = _obs(authored=stems, visible=stems, device_id=UUID(int=1))
        b = _obs(authored=stems, visible=stems, device_id=UUID(int=2))

        forwards = _only([a, b], _corpus(under_key=[]))
        backwards = _only([b, a], _corpus(under_key=[]))

        assert forwards.census_device_id == backwards.census_device_id == UUID(int=1)

    def test_the_entry_carries_the_readings_own_honesty_vocabulary(self) -> None:
        """No second vocabulary, and no join required to read the numbers."""
        stems = _stems("01-a")
        lagging = _obs(authored=stems, visible=stems, behind=254, ref_age_secs=300)
        # A second, LESS behind device on the same ref: the roll-up's minimum
        # is its 12, not the census device's 254.
        ahead_of_it = _obs(behind=12, ref_age_secs=300)

        health = scan_roots_health(
            [lagging, ahead_of_it], now=NOW, captured=_corpus(under_key=[])
        )
        entry = health.coverage[0]
        rollup = health.by_source_repo[0]

        assert entry.census_device_id == lagging.device_id
        assert entry.min_behind == rollup.min_behind == 12
        assert entry.min_behind_is_floor == rollup.min_behind_is_floor is False
        assert entry.observation_age_secs == 0
        assert entry.observation_fresh is True
        assert entry.counts_are_floors is False
        assert entry.ref_sha == REF
        # Carried even when nothing else is: the roll-up is independent of the
        # census.
        no_census = scan_roots_health(
            [_obs(behind=7, ref_age_secs=300)], now=NOW, captured=_corpus(under_key=[])
        )
        assert no_census.coverage[0].state == "unknown"
        assert no_census.coverage[0].min_behind == 7
        assert no_census.coverage[0].observation_age_secs is None
        assert no_census.coverage[0].counts_are_floors is None


# ---------------------------------------------------------------------------
# 8. D2 — where coverage is computed, and where it deliberately is not
# ---------------------------------------------------------------------------


class TestWhereCoverageIsComputed:
    def test_the_corpus_health_rendering_leaves_it_empty_with_a_reason(self) -> None:
        stems = _stems("01-a")
        health = scan_roots_health([_obs(authored=stems, visible=stems)], now=NOW)

        assert health.coverage == []
        # Empty is a SURFACE property, and it says so rather than reading as
        # "nothing is missing".
        assert health.coverage_detail == COVERAGE_NOT_COMPUTED_DETAIL

    def test_no_observation_is_unknown_on_both_surfaces(self) -> None:
        computed = scan_roots_health([], now=NOW, captured=_corpus(under_key=[]))
        assert computed.coverage == []
        assert computed.coverage_detail == COVERAGE_NO_OBSERVATION_DETAIL

        not_computed = scan_roots_health([], now=NOW)
        assert not_computed.coverage_detail == COVERAGE_NOT_COMPUTED_DETAIL

    def test_a_failed_read_says_so_rather_than_serving_an_empty_list(self) -> None:
        failed = scan_roots_read_failed(RuntimeError("boom"))

        assert failed.coverage == []
        assert failed.coverage_detail == COVERAGE_READ_FAILED_DETAIL

    def test_an_empty_coverage_list_always_carries_a_detail(self) -> None:
        """The invariant, stated once over every way of producing the block."""
        for response in (
            scan_roots_health([], now=NOW),
            scan_roots_health([], now=NOW, captured=_corpus(under_key=[])),
            scan_roots_health([_obs()], now=NOW),
            scan_roots_read_failed(RuntimeError("boom")),
        ):
            assert (response.coverage_detail is None) == bool(response.coverage)


@pytest.mark.asyncio
class TestTheRouteReadsTheStems:
    async def test_list_scan_roots_takes_the_census_loading_read(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D2's other half: the route, and ONLY the route, loads the stems.

        ``list_observations`` defers the two census JSON columns, and touching
        a deferred attribute on the ``AsyncSession`` every caller uses raises
        ``MissingGreenlet`` rather than emitting a lazy SELECT — so the route
        must go through ``list_observations_with_censuses``. Asserted by making
        the deferred read fail: a regression that reaches for it is a test
        failure here rather than a 500 in production.
        """
        from app.api.v1.endpoints import plan_library_scan_roots as route

        stems = _stems("01-a", "02-b")
        # The route stamps ``now`` from the real clock, so the reading has to
        # be fresh against THAT rather than against this module's fixed NOW.
        live = datetime.now(UTC)
        observations = [
            _obs(
                authored=stems,
                visible=stems,
                observed_at=live,
                received_at=live,
                last_report_observed_at=live,
            )
        ]
        asked: dict[str, Any] = {}

        async def _org(_db: Any, _user: Any) -> None:
            return None

        async def _deferred(*_a: Any, **_kw: Any) -> list[PlanScanRootObservation]:
            raise AssertionError(
                "the coverage route must not use the census-DEFERRED read"
            )

        async def _loading(
            _db: Any, *, org_id: Any
        ) -> list[PlanScanRootObservation]:
            asked["org_id"] = org_id
            return observations

        async def _captured(
            _db: Any, *, org_id: Any, source_repos: Any
        ) -> CapturedPlanCorpus:
            asked["source_repos"] = list(source_repos)
            return _corpus(under_key=_stems("01-a"))

        monkeypatch.setattr(route, "_resolve_org_id", _org)
        monkeypatch.setattr(route.crud, "list_observations", _deferred)
        monkeypatch.setattr(route.crud, "list_observations_with_censuses", _loading)
        monkeypatch.setattr(route.artifact_crud, "captured_plan_corpus", _captured)

        response = await route.list_scan_roots(db=object(), current_user=object())

        # Only the NAMED sources are asked for: a null key can never be joined.
        assert asked["source_repos"] == [SOURCE]
        assert len(response.coverage) == 1
        assert response.coverage[0].state == "measured"
        assert response.coverage[0].captured == 1
        assert response.coverage[0].authored_not_captured == 1
        assert response.coverage_detail is None
