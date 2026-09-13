"""The per-scan-source roll-up behind ``corpus_health.scan_roots``.

Plan ``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``,
Revised Phase 2 (the ``CorpusHealth`` fold-in). DB-free: every case builds
in-memory ``PlanScanRootObservation`` rows and renders them through
:func:`app.services.plan_scan_root_health.scan_roots_health`, the one builder
``GET /plan-library/scan-roots``, the list page and ``/candidates`` share. The
HTTP half — that the block rides on both routes, is org-scoped, and degrades
on a failed read — is in ``test_plan_library_api.py`` and
``test_plan_library_candidates.py``.

What is asserted, and why each is a separate claim:

1. **The minimum is taken over VERDICTS.** A device that went quiet, whose
   latest report was contradicted, or that reported a 0-behind floor has
   ``state: "unknown"`` and contributes no number.
2. **The minimum is exact only against ONE fresh ref.** Every device must have
   counted against the same ``ref_sha``, and someone must have fetched it
   fresh; otherwise ``min_behind`` is a floor.
3. **A device is named least-behind or lagging only when the readings prove
   it.** Counts against different refs do not order devices — the review
   counterexample: exactly 3 behind a five-hour-old ref can be 13 behind the
   ref another device is exactly 5 behind. Placement needs one shared ref, and
   on one shared ref it holds whatever the floor flags say. The four id lists
   partition the devices.
4. **No measured verdict is UNKNOWN, never 0.** ``min_behind`` and
   ``min_behind_is_floor`` are ``null`` and the detail says why.
5. **The freshness window is inclusive**: a reading exactly 2700 s old is
   fresh, 2701 s is not.
6. **Grouping** is per ``source_repo``, named sources in order, ``null`` last.

Each rule was mutation-proved when written: minimum over ``reported_state``
(fails 1), ``shared_ref`` forced true (fails 2 and 3's different-ref cases),
the floor flag ignoring the shared ref (fails 2's different-ref case),
``min_behind_is_floor`` hard-coded ``False`` (fails 2's nobody-fetched-fresh
case), and ``<`` for ``<=`` on the window (fails 5).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.models.plan_scan_root import PlanScanRootObservation
from app.schemas.plan_library_scan_roots import ScanRootSourceRollup
from app.services.plan_scan_root_health import (
    FRESH_WITHIN_SECS,
    NO_OBSERVATION_DETAIL,
    render_row,
    scan_roots_health,
    scan_roots_read_failed,
)

NOW = datetime(2026, 9, 12, 5, 0, tzinfo=UTC)
SOURCE = "qontinui-dev-notes/plans"
REF = "d455ad5cb" + "0" * 31


def _obs(**overrides: object) -> PlanScanRootObservation:
    """A fresh, applied, exact ``measured`` reading against ``REF``."""
    fields: dict[str, object] = {
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
    }
    fields.update(overrides)
    return PlanScanRootObservation(**fields)


def _floor(behind: int, **overrides: object) -> PlanScanRootObservation:
    """A ``measured`` reading against a ref of unknown age: "at least N"."""
    return _obs(behind=behind, ref_age_secs=None, counts_are_floors=True, **overrides)


def _stale(**overrides: object) -> PlanScanRootObservation:
    """Not heard from past the freshness window: verdict ``unknown``."""
    return _obs(
        received_at=NOW - timedelta(seconds=FRESH_WITHIN_SECS + 60), **overrides
    )


def _unmeasured(state: str = "not_a_git_work_tree", **overrides: object):
    return _obs(
        state=state,
        detail="the plans dir is not inside a git work tree",
        behind=None,
        ahead=None,
        ref_age_secs=None,
        counts_are_floors=False,
        **overrides,
    )


def _only_rollup(*observations: PlanScanRootObservation) -> ScanRootSourceRollup:
    health = scan_roots_health(list(observations), now=NOW)
    assert len(health.by_source_repo) == 1, health.by_source_repo
    rollup = health.by_source_repo[0]
    _assert_partition(rollup)
    return rollup


def _assert_partition(rollup: ScanRootSourceRollup) -> None:
    """Every device in exactly one of the four lists — none dropped, none twice."""
    lists = (
        rollup.least_behind_device_ids,
        rollup.lagging_device_ids,
        rollup.lag_unknown_device_ids,
        rollup.unmeasured_device_ids,
    )
    placed = [device for ids in lists for device in ids]
    assert len(placed) == len(set(placed)) == rollup.device_count, lists
    assert rollup.device_count - len(rollup.unmeasured_device_ids) == (
        rollup.measured_count
    )


def _ids(*observations: PlanScanRootObservation) -> list[UUID]:
    return sorted((o.device_id for o in observations), key=str)


class TestEmptyAndFailed:
    def test_no_rows_is_unknown_with_no_rollup(self) -> None:
        health = scan_roots_health([], now=NOW)
        assert health.state == "unknown"
        assert health.detail == NO_OBSERVATION_DETAIL
        assert health.rows == []
        # Empty exactly when ``rows`` is — and then the top-level verdict is
        # what says "unknown", so an empty roll-up is never read as "no drift".
        assert health.by_source_repo == []

    def test_a_failed_read_is_unknown_and_names_only_the_error_class(self) -> None:
        health = scan_roots_read_failed(
            RuntimeError("SELECT secret_column FROM somewhere WHERE token='x'")
        )
        assert health.state == "unknown"
        assert health.detail is not None
        assert health.detail.startswith("read_failed:")
        assert "RuntimeError" in health.detail
        # The message can carry SQL and parameters; it never reaches the page.
        assert "secret_column" not in health.detail
        assert (health.count, health.rows, health.by_source_repo) == (0, [], [])


class TestFreshnessWindow:
    def test_exactly_the_window_is_still_fresh(self) -> None:
        row = render_row(
            _obs(received_at=NOW - timedelta(seconds=FRESH_WITHIN_SECS)), now=NOW
        )
        assert row.observation_fresh is True
        assert row.state == "measured"

    def test_one_second_past_the_window_is_unknown(self) -> None:
        row = render_row(
            _obs(received_at=NOW - timedelta(seconds=FRESH_WITHIN_SECS + 1)), now=NOW
        )
        assert row.observation_fresh is False
        assert row.state == "unknown"
        assert row.detail is not None
        assert row.detail.startswith("observation_stale:")


class TestMinimumIsOverVerdicts:
    def test_a_stale_feeder_cannot_lower_the_minimum(self) -> None:
        current = _obs(behind=254)
        # Reported 3 behind — hours ago. It may be arbitrarily far behind now.
        silent = _stale(behind=3)

        rollup = _only_rollup(current, silent)

        assert rollup.state == "measured"
        assert rollup.min_behind == 254
        assert rollup.least_behind_device_ids == [current.device_id]
        assert rollup.unmeasured_device_ids == [silent.device_id]
        assert (rollup.device_count, rollup.measured_count) == (2, 1)

    def test_a_contradicted_reading_cannot_lower_the_minimum(self) -> None:
        current = _obs(behind=40)
        superseded = _obs(
            behind=0,
            last_report_applied=False,
            last_report_observed_at=NOW - timedelta(hours=6),
        )

        rollup = _only_rollup(current, superseded)

        assert rollup.min_behind == 40
        assert rollup.unmeasured_device_ids == [superseded.device_id]

    def test_a_zero_behind_floor_cannot_become_the_minimum(self) -> None:
        """The false zero this whole plan exists to remove, one level up."""
        current = _obs(behind=12)
        zero_floor = _floor(0)

        rollup = _only_rollup(current, zero_floor)

        assert rollup.min_behind == 12
        assert rollup.unmeasured_device_ids == [zero_floor.device_id]


class TestExactOnlyAgainstOneFreshRef:
    def test_one_shared_ref_that_someone_fetched_fresh_is_exact(self) -> None:
        """The floor device counted against the very commit another device
        just fetched, so its "at least 7" is exactly 7 behind the tip."""
        rollup = _only_rollup(_floor(7), _obs(behind=30))
        assert rollup.min_behind == 7
        assert rollup.min_behind_is_floor is False

    def test_one_shared_ref_nobody_fetched_fresh_is_a_floor(self) -> None:
        # One ref of unknown age, one the runner judged older than 6 h.
        rollup = _only_rollup(
            _floor(7), _obs(behind=30, ref_age_secs=90_000, counts_are_floors=True)
        )
        assert rollup.min_behind == 7
        assert rollup.min_behind_is_floor is True

    def test_exact_readings_on_different_refs_make_the_minimum_a_floor(self) -> None:
        rollup = _only_rollup(
            _obs(behind=3, ref_sha="a" * 40), _obs(behind=5, ref_sha="b" * 40)
        )
        assert rollup.min_behind == 3
        assert rollup.min_behind_is_floor is True

    def test_an_unknown_ref_makes_the_minimum_a_floor(self) -> None:
        rollup = _only_rollup(_obs(behind=3, ref_sha=None), _obs(behind=5))
        assert rollup.min_behind_is_floor is True


class TestOnlyProvenStandingIsNamed:
    def test_one_shared_ref_places_every_device(self) -> None:
        leader = _obs(behind=2)
        tied = _obs(behind=2)
        lagging = _obs(behind=254)

        rollup = _only_rollup(leader, tied, lagging)

        assert rollup.min_behind == 2
        assert rollup.least_behind_device_ids == _ids(leader, tied)
        assert rollup.lagging_device_ids == [lagging.device_id]
        assert rollup.lag_unknown_device_ids == []

    def test_on_one_shared_ref_a_floor_flag_does_not_block_placement(self) -> None:
        """Both counted against the same commit: 5 behind it IS ahead of 9."""
        floor = _floor(5)
        exact = _obs(behind=9)

        rollup = _only_rollup(floor, exact)

        assert rollup.least_behind_device_ids == [floor.device_id]
        assert rollup.lagging_device_ids == [exact.device_id]
        assert rollup.lag_unknown_device_ids == []

    def test_counts_against_different_refs_place_nobody(self) -> None:
        """The review counterexample. A's ref is five hours old and A is 3
        behind it; B fetched a ref 10 commits newer and is 5 behind that — so
        B is AHEAD of A, which is 13 behind B's ref. Comparing 3 with 5 would
        name A least behind and B lagging: both false."""
        a = _obs(behind=3, ref_sha="a" * 40, ref_age_secs=18_000)
        b = _obs(behind=5, ref_sha="b" * 40)

        rollup = _only_rollup(a, b)

        assert rollup.least_behind_device_ids == []
        assert rollup.lagging_device_ids == []
        assert rollup.lag_unknown_device_ids == _ids(a, b)

    def test_an_unknown_ref_places_nobody(self) -> None:
        unknown_ref = _obs(behind=2, ref_sha=None)
        known = _obs(behind=9)

        rollup = _only_rollup(unknown_ref, known)

        assert (rollup.least_behind_device_ids, rollup.lagging_device_ids) == ([], [])
        assert rollup.lag_unknown_device_ids == _ids(unknown_ref, known)


class TestNoMeasuredVerdictIsUnknown:
    def test_only_silent_and_unmeasured_devices(self) -> None:
        silent = _stale(behind=0)
        not_git = _unmeasured()

        rollup = _only_rollup(silent, not_git)

        assert rollup.state == "unknown"
        assert rollup.detail is not None
        assert rollup.detail.startswith("no_measured_reading:")
        # NOT ESTABLISHED, never a zero and never a guessed floor flag.
        assert rollup.min_behind is None
        assert rollup.min_behind_is_floor is None
        assert rollup.least_behind_device_ids == []
        assert rollup.lagging_device_ids == []
        assert rollup.lag_unknown_device_ids == []
        assert rollup.unmeasured_device_ids == _ids(silent, not_git)
        assert (rollup.device_count, rollup.measured_count) == (2, 0)

    def test_a_measured_rollup_carries_no_detail(self) -> None:
        assert _only_rollup(_obs()).detail is None


class TestGrouping:
    def test_one_rollup_per_source_named_first_null_last(self) -> None:
        dev_notes = _obs(source_repo="qontinui-dev-notes/plans", behind=4)
        other = _obs(source_repo="acme-notes/plans", behind=0)
        unnamed = _unmeasured(state="not_scanning", source_repo=None)

        health = scan_roots_health([dev_notes, unnamed, other], now=NOW)

        assert [r.source_repo for r in health.by_source_repo] == [
            "acme-notes/plans",
            "qontinui-dev-notes/plans",
            None,
        ]
        acme, notes, none = health.by_source_repo
        # One source's current feeder says nothing about another source.
        assert (acme.min_behind, notes.min_behind) == (0, 4)
        assert none.state == "unknown"
        assert none.unmeasured_device_ids == [unnamed.device_id]
        assert health.count == 3
        assert sum(r.device_count for r in health.by_source_repo) == health.count
