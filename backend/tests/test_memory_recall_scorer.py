"""Scorer correctness — asserted against hand-computed values.

Phase 1 gate of ``2026-07-29-memory-recall-efficacy-benchmark``. No
database, no pgvector, no network: this suite runs everywhere the rest of
the pure-logic memory suites run (rrf / redaction / auth / validation).

Why it exists separately from ``test_memory_recall_eval_db.py``: a harness
whose metrics are only ever exercised through the retrieval system it
judges cannot detect its own arithmetic errors — every number would look
plausible. The values below were computed by hand from the definitions in
the module docstring, so a change in the scorer that alters a metric has
to change these constants too, deliberately.
"""

from __future__ import annotations

import ast
import dataclasses
import gc
import json
import math
import os
import pickle
import re
import types
from collections.abc import Callable
from fnmatch import fnmatch
from pathlib import Path
from typing import cast, get_type_hints

import pytest

from tests.memory_recall import fixtures as fx
from tests.memory_recall import holdout as ho
from tests.memory_recall.scorer import (
    CREDIT_Z_THRESHOLD,
    LOWER_IS_BETTER_METRICS,
    CaseScore,
    SuiteScore,
    aggregate,
    correction_precedence,
    dcg_at_k,
    ndcg_at_k,
    noise_rate,
    paired_delta,
    recall_at_k,
    reciprocal_rank,
    score_case,
    token_cost,
)
from tests.memory_recall.wiring import (
    MARKER_SEMANTICS,
    MEMORY_RECALL_COMPONENTS,
    NOT_WIRED,
    WIRED,
    WiringLedger,
)

# The 5-case toy set the plan names. Rankings are hand-built so every
# metric has an exactly-known value.
TOY_RANKED = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]


class TestRecallAtK:
    def test_all_relevant_inside_k(self) -> None:
        # 2 of 2 relevant are in the top 5 -> 1.0
        assert recall_at_k(TOY_RANKED, ["a", "c"], 5) == 1.0

    def test_half_the_relevant_inside_k(self) -> None:
        # relevant {a, g}: only `a` is in the top 5 -> 1/2
        assert recall_at_k(TOY_RANKED, ["a", "g"], 5) == 0.5

    def test_nothing_relevant_retrieved(self) -> None:
        assert recall_at_k(TOY_RANKED, ["zz"], 10) == 0.0

    def test_k_wider_than_the_ranking_is_not_an_error(self) -> None:
        assert recall_at_k(["a"], ["a"], 20) == 1.0

    def test_empty_judgements_is_zero_not_a_crash(self) -> None:
        # The fixture loader rejects this, but the function stays total.
        assert recall_at_k(TOY_RANKED, [], 10) == 0.0

    def test_relevance_beyond_k_does_not_count(self) -> None:
        # `f` sits at position 6 — outside k=5, inside k=10.
        assert recall_at_k(TOY_RANKED, ["f"], 5) == 0.0
        assert recall_at_k(TOY_RANKED, ["f"], 10) == 1.0


class TestReciprocalRank:
    def test_first_position_is_one(self) -> None:
        assert reciprocal_rank(TOY_RANKED, ["a"]) == 1.0

    def test_third_position_is_one_third(self) -> None:
        assert reciprocal_rank(TOY_RANKED, ["c"]) == pytest.approx(1 / 3)

    def test_only_the_best_placed_relevant_counts(self) -> None:
        # `b` at 2 and `d` at 4 -> 1/2, not 1/2 + 1/4.
        assert reciprocal_rank(TOY_RANKED, ["b", "d"]) == 0.5

    def test_absent_is_zero(self) -> None:
        assert reciprocal_rank(TOY_RANKED, ["zz"]) == 0.0


class TestDcgAndNdcg:
    def test_dcg_single_hit_at_rank_one(self) -> None:
        # 1 / log2(2) == 1.0
        assert dcg_at_k(TOY_RANKED, ["a"], 10) == 1.0

    def test_dcg_single_hit_at_rank_two(self) -> None:
        # 1 / log2(3)
        assert dcg_at_k(TOY_RANKED, ["b"], 10) == pytest.approx(1 / math.log2(3))

    def test_dcg_sums_over_hits(self) -> None:
        expected = 1 / math.log2(2) + 1 / math.log2(4)  # ranks 1 and 3
        assert dcg_at_k(TOY_RANKED, ["a", "c"], 10) == pytest.approx(expected)

    def test_perfect_ranking_is_ndcg_one(self) -> None:
        assert ndcg_at_k(TOY_RANKED, ["a", "b"], 10) == pytest.approx(1.0)

    def test_ndcg_penalises_a_late_hit(self) -> None:
        # One relevant record at rank 3: DCG = 1/log2(4) = 0.5,
        # ideal (same record at rank 1) = 1.0 -> nDCG = 0.5.
        assert ndcg_at_k(TOY_RANKED, ["c"], 10) == pytest.approx(0.5)

    def test_ndcg_ideal_is_capped_by_k(self) -> None:
        # 3 relevant but k=2: the ideal can only hold 2 of them, so a
        # ranking with both of its top-2 relevant scores a perfect 1.0.
        assert ndcg_at_k(TOY_RANKED, ["a", "b", "j"], 2) == pytest.approx(1.0)

    def test_ndcg_with_nothing_relevant_is_zero(self) -> None:
        assert ndcg_at_k(TOY_RANKED, [], 10) == 0.0


class TestNoiseRate:
    def test_all_noise(self) -> None:
        assert noise_rate(TOY_RANKED, ["zz"], 10) == 1.0

    def test_no_noise(self) -> None:
        assert noise_rate(["a", "b"], ["a", "b"], 10) == 0.0

    def test_measured_against_what_was_returned_not_against_k(self) -> None:
        # 3 returned, 1 relevant, k=10 -> 2/3 noise. Dividing by k would
        # report 0.2 and flatter every short result set.
        assert noise_rate(["a", "b", "c"], ["a"], 10) == pytest.approx(2 / 3)

    def test_empty_ranking_is_zero(self) -> None:
        assert noise_rate([], ["a"], 10) == 0.0


class TestTokenCost:
    SIZES = {"a": 100, "b": 250, "c": 40}

    def test_sums_the_top_k_only(self) -> None:
        assert token_cost(["a", "b", "c"], self.SIZES, 2) == 350

    def test_unknown_ids_contribute_nothing(self) -> None:
        assert token_cost(["a", "unseeded:x"], self.SIZES, 10) == 100

    def test_empty_ranking_costs_nothing(self) -> None:
        assert token_cost([], self.SIZES, 10) == 0


class TestCorrectionPrecedence:
    def test_corrector_above_corrected_passes(self) -> None:
        assert correction_precedence(["new", "old"], "new", "old") is True

    def test_corrected_above_corrector_fails(self) -> None:
        assert correction_precedence(["old", "new"], "new", "old") is False

    def test_corrector_missing_fails_even_when_corrected_is_also_missing(self) -> None:
        # The important case: retrieving NEITHER must not score as a pass.
        # A naive "corrected did not outrank it" implementation would.
        assert correction_precedence(["x", "y"], "new", "old") is False

    def test_corrector_present_and_corrected_absent_passes(self) -> None:
        assert correction_precedence(["new", "x"], "new", "old") is True


class TestScoreCase:
    def test_correction_is_none_when_the_case_has_no_pair(self) -> None:
        score = score_case("c1", "general", TOY_RANKED, ["a"], {"a": 10})
        assert score.correction_precedence is None

    def test_correction_false_is_distinct_from_absent(self) -> None:
        score = score_case(
            "c2",
            "correction",
            ["old", "new"],
            ["new"],
            {"new": 10, "old": 10},
            correction=("new", "old"),
        )
        assert score.correction_precedence is False

    def test_every_metric_is_populated_from_one_ranking(self) -> None:
        score = score_case("c3", "general", TOY_RANKED, ["a", "c"], {"a": 100, "c": 40})
        assert score.recall_at_5 == 1.0
        assert score.reciprocal_rank == 1.0
        assert score.token_cost_at_10 == 140
        assert score.noise_rate_at_10 == pytest.approx(0.8)


class TestAggregate:
    @staticmethod
    def _score(case_id: str, **kw: object) -> CaseScore:
        base: dict[str, object] = {
            "case_id": case_id,
            "case_class": "general",
            "recall_at_5": 1.0,
            "recall_at_10": 1.0,
            "recall_at_20": 1.0,
            "reciprocal_rank": 1.0,
            "ndcg_at_10": 1.0,
            "noise_rate_at_10": 0.0,
            "token_cost_at_10": 100,
            "correction_precedence": None,
        }
        base.update(kw)
        return CaseScore(**base)  # type: ignore[arg-type]

    def test_empty_suite_is_all_zero_not_a_crash(self) -> None:
        suite = aggregate("fts_only", "skipped_no_embedding", [], case_count=0)
        assert suite.case_count == 0
        assert suite.missing_cases == 0
        assert suite.mrr == 0.0
        assert suite.correction_precedence_rate == 0.0

    def test_means_are_unweighted(self) -> None:
        suite = aggregate(
            "fts_only",
            "skipped_no_embedding",
            [self._score("a", recall_at_10=1.0), self._score("b", recall_at_10=0.0)],
            case_count=2,
        )
        assert suite.recall_at_10 == 0.5
        assert suite.case_count == 2
        assert suite.missing_cases == 0

    def test_token_cost_sums_rather_than_averages(self) -> None:
        suite = aggregate(
            "hybrid",
            "hybrid",
            [self._score("a"), self._score("b")],
            case_count=2,
        )
        assert suite.total_token_cost_at_10 == 200

    def test_correction_rate_counts_only_pair_cases(self) -> None:
        suite = aggregate(
            "fts_only",
            "skipped_no_embedding",
            [
                self._score("a", correction_precedence=True),
                self._score("b", correction_precedence=False),
                self._score("c"),  # no pair — must not dilute the rate
            ],
            case_count=3,
        )
        assert suite.correction_pairs == 2
        assert suite.correction_precedence_rate == 0.5

    def test_the_arm_is_carried_through_not_inferred(self) -> None:
        suite = aggregate(
            "hybrid", "skipped_migrating", [self._score("a")], case_count=1
        )
        assert suite.arm == "hybrid"
        assert suite.vector_arm == "skipped_migrating"


def _case(case_id: str, **kw: object) -> CaseScore:
    """A CaseScore with every metric pinned, so a test names only what it varies."""
    base: dict[str, object] = {
        "case_id": case_id,
        "case_class": "general",
        "recall_at_5": 0.0,
        "recall_at_10": 0.0,
        "recall_at_20": 0.0,
        "reciprocal_rank": 0.0,
        "ndcg_at_10": 0.0,
        "noise_rate_at_10": 0.0,
        "token_cost_at_10": 0,
        "correction_precedence": None,
    }
    base.update(kw)
    return CaseScore(**base)  # type: ignore[arg-type]


class TestExplicitDenominator:
    """Plan §3.3 item 3 / verification item 8 — the fair-subset trap.

    ``aggregate`` divides by the case-set size it is TOLD, never by
    ``len(scores)``. A case that fails to score therefore drags the mean
    DOWN rather than vanishing from the divisor and leaving the headline
    untouched (or, worse, raising it).
    """

    def test_missing_cases_lower_the_mean_rather_than_shrinking_the_divisor(
        self,
    ) -> None:
        scored = [_case("a", recall_at_10=1.0), _case("b", recall_at_10=1.0)]

        full = aggregate("hybrid", "hybrid", scored, case_count=2)
        short = aggregate("hybrid", "hybrid", scored, case_count=4)

        # The SAME two perfect scores. Over a 4-case set they are half a
        # result, not a perfect one.
        assert full.recall_at_10 == 1.0
        assert short.recall_at_10 == 0.5
        assert short.recall_at_10 < full.recall_at_10

    def test_the_gap_is_reported_not_absorbed(self) -> None:
        suite = aggregate(
            "hybrid", "hybrid", [_case("a", recall_at_10=1.0)], case_count=4
        )
        assert suite.case_count == 4  # the DENOMINATOR
        assert suite.missing_cases == 3
        assert suite.scored_cases == 1

    def test_every_mean_uses_the_declared_denominator(self) -> None:
        scored = [
            _case(
                "a",
                recall_at_5=1.0,
                recall_at_10=1.0,
                recall_at_20=1.0,
                reciprocal_rank=1.0,
                ndcg_at_10=1.0,
                noise_rate_at_10=1.0,
            )
        ]
        suite = aggregate("hybrid", "hybrid", scored, case_count=2)
        assert suite.recall_at_5 == 0.5
        assert suite.recall_at_10 == 0.5
        assert suite.recall_at_20 == 0.5
        assert suite.mrr == 0.5
        assert suite.ndcg_at_10 == 0.5
        assert suite.noise_rate_at_10 == 0.5

    def test_token_cost_is_a_sum_and_is_unaffected_by_missing_cases(self) -> None:
        suite = aggregate(
            "hybrid", "hybrid", [_case("a", token_cost_at_10=100)], case_count=5
        )
        assert suite.total_token_cost_at_10 == 100

    def test_a_denominator_below_the_data_is_a_hard_error(self) -> None:
        with pytest.raises(ValueError, match="smaller than"):
            aggregate("hybrid", "hybrid", [_case("a"), _case("b")], case_count=1)

    def test_a_negative_denominator_is_a_hard_error(self) -> None:
        with pytest.raises(ValueError, match="negative"):
            aggregate("hybrid", "hybrid", [], case_count=-1)

    def test_the_denominator_is_required_not_inferred(self) -> None:
        """The whole point of item 3: it cannot be omitted by accident."""
        with pytest.raises(TypeError):
            aggregate("hybrid", "hybrid", [_case("a")])  # type: ignore[call-arg]


class TestPairedDelta:
    """Plan §3.3 items 1-2 — paired comparison on the SAME cases."""

    @staticmethod
    def _arm(values: list[float]) -> list[CaseScore]:
        return [
            _case(f"case-{i}", recall_at_10=v, reciprocal_rank=v)
            for i, v in enumerate(values)
        ]

    def test_pairs_by_case_id_not_by_position(self) -> None:
        control = [
            _case("a", recall_at_10=0.0),
            _case("b", recall_at_10=1.0),
        ]
        # Same cases, reversed order, same values. Pairing by position
        # would report per-case lifts of +1.0/-1.0; pairing by id reports
        # zero, which is the truth.
        candidate = [
            _case("b", recall_at_10=1.0),
            _case("a", recall_at_10=0.0),
        ]
        result = paired_delta(control, candidate, metric="recall_at_10")
        assert result.n == 2
        assert result.mean_lift == 0.0
        assert result.sd == 0.0
        assert result.z == 0.0

    def test_a_case_missing_from_one_arm_is_a_hard_error(self) -> None:
        control = [_case("a"), _case("b")]
        candidate = [_case("a")]
        with pytest.raises(ValueError, match="identical case sets"):
            paired_delta(control, candidate, metric="recall_at_10")

    def test_an_extra_case_in_the_candidate_is_a_hard_error(self) -> None:
        with pytest.raises(ValueError, match="candidate-only"):
            paired_delta(
                [_case("a"), _case("b")],
                [_case("a"), _case("b"), _case("c")],
                metric="recall_at_10",
            )

    def test_a_repeated_case_id_is_a_hard_error(self) -> None:
        with pytest.raises(ValueError, match="more than once"):
            paired_delta(
                [_case("a"), _case("a")],
                [_case("a"), _case("a")],
                metric="recall_at_10",
            )

    def test_an_unknown_metric_is_a_hard_error(self) -> None:
        with pytest.raises(KeyError, match="unknown paired metric"):
            paired_delta([_case("a")], [_case("a")], metric="vibes")

    def test_mrr_is_an_accepted_alias_for_reciprocal_rank(self) -> None:
        control = [_case("a", reciprocal_rank=0.5), _case("b", reciprocal_rank=0.5)]
        candidate = [_case("a", reciprocal_rank=1.0), _case("b", reciprocal_rank=0.5)]
        result = paired_delta(control, candidate, metric="mrr")
        # The caller's spelling is echoed back — the report renders `mrr`.
        assert result.metric == "mrr"
        assert result.mean_lift == pytest.approx(0.25)

    def test_hand_computed_mean_lift_and_z(self) -> None:
        """Differences [.2, 0, .4, .2, .2]: mean .2, sd sqrt(.02), z sqrt(10).

        By hand: the squared deviations from the mean difference sum to
        0.08; ddof=1 so variance = 0.08/4 = 0.02 and sd = sqrt(0.02).
        se = sd/sqrt(5), and z = 0.2/se = sqrt(10) = 3.16227766...
        """
        control = self._arm([0.0, 0.4, 0.2, 0.6, 0.8])
        candidate = self._arm([0.2, 0.4, 0.6, 0.8, 1.0])
        result = paired_delta(control, candidate, metric="recall_at_10")

        assert result.n == 5
        assert result.control_mean == pytest.approx(0.4)
        assert result.candidate_mean == pytest.approx(0.6)
        assert result.mean_lift == pytest.approx(0.2)
        assert result.sd == pytest.approx(math.sqrt(0.02))
        assert result.se == pytest.approx(math.sqrt(0.02) / math.sqrt(5))
        assert result.z == pytest.approx(math.sqrt(10.0))
        assert result.z_display == "3.1623"
        assert result.promoted is True
        assert result.credited_2sigma is True
        assert result.insufficient_n is False

    def test_a_sub_two_sigma_lift_is_promoted_but_not_credited(self) -> None:
        """The +6.4pp-at-z=1.71 shape the plan cites — a legitimate outcome.

        Eight cases gain +0.12, two lose -0.16. By hand: mean lift is
        (8*0.12 - 2*0.16)/10 = 0.064; the squared deviations sum to
        8*(0.056**2) + 2*(0.224**2) = 0.12544, so variance = 0.12544/9 and
        z = 0.064 / (sd/sqrt(10)) = 12/7 = 1.714285...

        Promotion banks it. The 2-sigma credit does not. Two fields, never
        one conflated boolean.
        """
        control = [_case(f"case-{i}", recall_at_10=0.5) for i in range(10)]
        candidate = [
            _case(f"case-{i}", recall_at_10=0.5 + (0.12 if i < 8 else -0.16))
            for i in range(10)
        ]
        result = paired_delta(control, candidate, metric="recall_at_10")

        assert result.n == 10
        assert result.mean_lift == pytest.approx(0.064)
        assert result.z == pytest.approx(12 / 7)
        assert 1.5 < result.z < CREDIT_Z_THRESHOLD
        assert result.promoted is True
        assert result.credited_2sigma is False

    def test_identical_arms_give_z_zero_not_a_zero_division(self) -> None:
        control = self._arm([0.1, 0.5, 0.9])
        candidate = self._arm([0.1, 0.5, 0.9])
        result = paired_delta(control, candidate, metric="recall_at_10")

        assert result.mean_lift == 0.0
        assert result.se == 0.0
        assert result.z == 0.0
        assert result.z_is_infinite is False
        assert result.promoted is False
        assert result.credited_2sigma is False
        assert result.insufficient_n is False

    def test_a_uniform_positive_lift_gives_positive_infinity(self) -> None:
        # se == 0 with a non-zero mean is not "insignificant" — it is a
        # lift with no observed variance at all.
        control = self._arm([0.1, 0.2, 0.3])
        candidate = self._arm([0.2, 0.3, 0.4])
        result = paired_delta(control, candidate, metric="recall_at_10")

        assert result.mean_lift == pytest.approx(0.1)
        assert result.se == 0.0
        assert result.z == math.inf
        assert result.z_is_infinite is True
        assert result.z_display == "+inf"
        assert result.promoted is True
        assert result.credited_2sigma is True

    def test_a_uniform_negative_lift_gives_negative_infinity(self) -> None:
        control = self._arm([0.2, 0.3, 0.4])
        candidate = self._arm([0.1, 0.2, 0.3])
        result = paired_delta(control, candidate, metric="recall_at_10")

        assert result.z == -math.inf
        assert result.z_display == "-inf"
        assert result.promoted is False
        # A signed infinity must NOT satisfy the credit label merely for
        # being a large magnitude — the sign carries.
        assert result.credited_2sigma is False

    def test_one_case_reports_insufficient_n_rather_than_inventing_a_number(
        self,
    ) -> None:
        result = paired_delta(
            [_case("a", recall_at_10=0.2)],
            [_case("a", recall_at_10=0.9)],
            metric="recall_at_10",
        )
        assert result.n == 1
        assert result.insufficient_n is True
        assert result.mean_lift == pytest.approx(0.7)
        assert result.sd == 0.0
        assert result.se == 0.0
        assert result.z == 0.0
        assert result.z_display == "n/a"
        # The lift is real and still banks; only the label is withheld.
        assert result.promoted is True
        assert result.credited_2sigma is False

    def test_no_cases_at_all_is_insufficient_n_not_a_crash(self) -> None:
        result = paired_delta([], [], metric="recall_at_10")
        assert result.n == 0
        assert result.insufficient_n is True
        assert result.z == 0.0
        assert result.promoted is False

    def test_z_display_is_json_safe_where_z_itself_is_not(self) -> None:
        """The CI comment parses the report with a conforming JSON parser.

        ``json.dumps`` emits a bare ``Infinity`` for an infinite float,
        which ``JSON.parse`` rejects — so every path that can produce one
        needs a string rendering the report can carry instead.
        """
        uniform = paired_delta(
            self._arm([0.1, 0.2, 0.3]),
            self._arm([0.2, 0.3, 0.4]),
            metric="recall_at_10",
        )
        assert json.loads(json.dumps({"z": uniform.z_display}))["z"] == "+inf"
        with pytest.raises(ValueError):
            json.dumps({"z": uniform.z}, allow_nan=False)

    #: Four cases whose per-case noise differences are around -0.375 with a
    #: small, non-zero spread, so |z| lands far above CREDIT_Z_THRESHOLD
    #: without tripping the uniform-lift (se == 0) branch.
    _QUIET = (0.1, 0.1, 0.1, 0.2)
    _NOISY = (0.5, 0.5, 0.5, 0.5)

    @staticmethod
    def _noise(values: tuple[float, ...]) -> list[CaseScore]:
        return [
            _case(f"c{i}", noise_rate_at_10=v) for i, v in enumerate(values, start=1)
        ]

    def test_the_cost_metrics_are_flagged_as_lower_is_better(self) -> None:
        # `promoted` is deliberately literal — candidate > control — so on a
        # cost-shaped metric it reads "scored higher", which is worse. That
        # literalness is the reason the direction has to be REPORTED
        # alongside it (see the driver test below) rather than inferred.
        noisier = paired_delta(
            self._noise(self._QUIET),
            self._noise(self._NOISY),
            metric="noise_rate_at_10",
        )
        assert noisier.promoted is True
        assert noisier.metric in LOWER_IS_BETTER_METRICS

    def test_a_significant_improvement_on_a_lower_is_better_metric_is_credited(
        self,
    ) -> None:
        """Noise falls hard: z is about -15, and that is a CREDITED win.

        An unsigned ``z >= CREDIT_Z_THRESHOLD`` reads False here — it
        withholds credit from the largest improvement the harness can
        measure, on a metric the report renders with a "lower is better"
        marker beside the flag.
        """
        quieter = paired_delta(
            self._noise(self._NOISY),
            self._noise(self._QUIET),
            metric="noise_rate_at_10",
        )
        assert quieter.mean_lift < 0
        assert quieter.z <= -CREDIT_Z_THRESHOLD
        assert quieter.credited_2sigma is True
        # `promoted` stays literal and stays False: the candidate did not
        # score higher. The two flags mean different things and this is
        # exactly the case that shows it.
        assert quieter.promoted is False

    def test_a_significant_regression_on_a_lower_is_better_metric_is_not_credited(
        self,
    ) -> None:
        """The mirror, and the more dangerous half.

        An unsigned threshold labels this significant REGRESSION
        ``credited_2sigma=True`` and prints it next to ``lower_is_better``.
        """
        noisier = paired_delta(
            self._noise(self._QUIET),
            self._noise(self._NOISY),
            metric="noise_rate_at_10",
        )
        assert noisier.mean_lift > 0
        assert noisier.z >= CREDIT_Z_THRESHOLD
        assert noisier.credited_2sigma is False

    def test_a_higher_is_better_metric_keeps_the_unsigned_reading(self) -> None:
        """The flip must be confined to LOWER_IS_BETTER_METRICS."""
        better = paired_delta(
            [_case(f"c{i}", recall_at_10=v) for i, v in enumerate(self._QUIET, 1)],
            [_case(f"c{i}", recall_at_10=v) for i, v in enumerate(self._NOISY, 1)],
            metric="recall_at_10",
        )
        assert better.z >= CREDIT_Z_THRESHOLD
        assert better.credited_2sigma is True

        worse = paired_delta(
            [_case(f"c{i}", recall_at_10=v) for i, v in enumerate(self._NOISY, 1)],
            [_case(f"c{i}", recall_at_10=v) for i, v in enumerate(self._QUIET, 1)],
            metric="recall_at_10",
        )
        assert worse.z <= -CREDIT_Z_THRESHOLD
        assert worse.credited_2sigma is False

    def test_the_driver_reports_the_direction_of_every_paired_metric(self) -> None:
        """``lower_is_better`` has exactly one consumer, and nothing tested it.

        Deleting the key from ``_paired_rows`` left the whole suite green:
        the only coverage it had was a test that restated the literal
        contents of ``LOWER_IS_BETTER_METRICS``. A reader of the PR comment
        who sees ``promoted: true`` on ``noise_rate_at_10`` with no
        direction beside it reads a regression as a win, which is the
        misreading the field exists to prevent — so the field's presence in
        the rendered row is what has to be asserted.
        """
        tree = ast.parse(_driver_source())
        rows = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == "_paired_rows"
        ]
        assert len(rows) == 1, "the driver's paired-row renderer was renamed"
        pairs = {
            key.value: value
            for node in ast.walk(rows[0])
            if isinstance(node, ast.Dict)
            for key, value in zip(node.keys, node.values, strict=True)
            if isinstance(key, ast.Constant)
        }
        assert {
            "metric",
            "promoted",
            "credited_2sigma",
            "credit_z_threshold",
            "lower_is_better",
        } <= set(pairs), (
            "the driver's paired row stopped reporting a field the two "
            f"booleans cannot be read without: {sorted(pairs)}"
        )
        # Shape alone is not the property. `"lower_is_better": False`
        # hardcoded satisfies "the key is present" and reports every
        # cost metric as higher-is-better, which is the exact misreading
        # the field exists to prevent — so the VALUE has to be derived
        # from the pinned set.
        direction = ast.get_source_segment(_driver_source(), pairs["lower_is_better"])
        assert direction is not None and "LOWER_IS_BETTER_METRICS" in direction, (
            "the driver's `lower_is_better` is no longer derived from "
            f"LOWER_IS_BETTER_METRICS — it renders {direction!r}. A literal "
            "there is a direction label that cannot follow the metric set."
        )


class TestShuffleDetection:
    """Verification item 3 — a broken ranking must be visibly worse.

    A harness that cannot distinguish a deliberately destroyed ranking from
    a working one cannot detect a regression either, which would make every
    baseline it records meaningless.
    """

    def test_reversed_ranking_collapses_recall_at_5(self) -> None:
        good = recall_at_k(TOY_RANKED, ["a", "b"], 5)
        bad = recall_at_k(list(reversed(TOY_RANKED)), ["a", "b"], 5)
        assert good == 1.0
        assert bad == 0.0

    def test_reversed_ranking_collapses_ndcg(self) -> None:
        good = ndcg_at_k(TOY_RANKED, ["a"], 10)
        bad = ndcg_at_k(list(reversed(TOY_RANKED)), ["a"], 10)
        assert good == pytest.approx(1.0)
        assert bad < 0.35

    def test_reversed_ranking_flips_correction_precedence(self) -> None:
        ranking = ["new", "old"]
        assert correction_precedence(ranking, "new", "old") is True
        assert correction_precedence(list(reversed(ranking)), "new", "old") is False


class TestGoldenSetFixture:
    """The checked-in fixture must load and be self-consistent."""

    def test_the_committed_golden_set_loads(self) -> None:
        gs = fx.load_golden_set()
        assert gs.records
        assert gs.cases
        assert gs.embedding_source in fx.ACCEPTED_EMBEDDING_SOURCES

    def test_every_class_the_plan_names_is_represented(self) -> None:
        gs = fx.load_golden_set()
        classes = {c.case_class for c in gs.cases}
        # The three hard classes are the reason the set exists; a fixture
        # that quietly lost one would report a healthy-looking mean.
        assert {"correction", "vocabulary_mismatch", "recency_conflict"} <= classes

    def test_correction_cases_carry_a_pair(self) -> None:
        gs = fx.load_golden_set()
        corrections = [c for c in gs.cases if c.case_class == "correction"]
        assert corrections
        assert all(c.correction is not None for c in corrections)

    def test_content_bytes_are_positive(self) -> None:
        gs = fx.load_golden_set()
        sizes = gs.content_bytes_by_key()
        assert all(n > 0 for n in sizes.values())
        assert len(sizes) == len(gs.records)

    def test_stub_provenance_reports_no_real_vectors(self) -> None:
        gs = fx.load_golden_set()
        if gs.embedding_source == fx.STUB_EMBEDDING_SOURCE:
            assert gs.has_real_vectors is False
            assert gs.vectors_committed is False


class TestGoldenSetValidation:
    """Every rejection below would otherwise read as a retrieval regression."""

    @staticmethod
    def _write(tmp_path, manifest, records, cases) -> None:
        (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        (tmp_path / "records.json").write_text(json.dumps(records), encoding="utf-8")
        (tmp_path / "cases.json").write_text(json.dumps(cases), encoding="utf-8")

    MANIFEST = {"embedding_source": fx.STUB_EMBEDDING_SOURCE}
    RECORD = {
        "key": "r1",
        "title": "t",
        "content": "c",
        "kind": "fact",
        "importance": 0.5,
    }
    CASE = {
        "case_id": "c1",
        "query_text": "q",
        "relevant": ["r1"],
        "rationale": "because",
    }

    def test_case_naming_an_unknown_record_is_rejected(self, tmp_path) -> None:
        self._write(
            tmp_path,
            self.MANIFEST,
            [self.RECORD],
            [{**self.CASE, "relevant": ["ghost"]}],
        )
        with pytest.raises(fx.GoldenSetError, match="unknown record key"):
            fx.load_golden_set(tmp_path)

    def test_empty_relevant_is_rejected(self, tmp_path) -> None:
        self._write(
            tmp_path, self.MANIFEST, [self.RECORD], [{**self.CASE, "relevant": []}]
        )
        with pytest.raises(fx.GoldenSetError, match="relevant is empty"):
            fx.load_golden_set(tmp_path)

    def test_duplicate_record_key_is_rejected(self, tmp_path) -> None:
        self._write(tmp_path, self.MANIFEST, [self.RECORD, self.RECORD], [self.CASE])
        with pytest.raises(fx.GoldenSetError, match="duplicate record key"):
            fx.load_golden_set(tmp_path)

    def test_corrector_outside_relevant_is_rejected(self, tmp_path) -> None:
        records = [self.RECORD, {**self.RECORD, "key": "r2"}]
        case = {
            **self.CASE,
            "class": "correction",
            "relevant": ["r1"],
            "correction": {"corrector": "r2", "corrected": "r1"},
        }
        self._write(tmp_path, self.MANIFEST, records, [case])
        with pytest.raises(fx.GoldenSetError, match="is not in relevant"):
            fx.load_golden_set(tmp_path)

    def test_wrong_dimension_vector_is_rejected(self, tmp_path) -> None:
        self._write(
            tmp_path,
            self.MANIFEST,
            [{**self.RECORD, "embedding": [0.1, 0.2]}],
            [self.CASE],
        )
        with pytest.raises(fx.GoldenSetError, match="expected 384"):
            fx.load_golden_set(tmp_path)

    def test_partial_embeddings_are_rejected(self, tmp_path) -> None:
        records = [
            {**self.RECORD, "embedding": [0.0] * 384},
            {**self.RECORD, "key": "r2"},
        ]
        self._write(tmp_path, self.MANIFEST, records, [self.CASE])
        with pytest.raises(fx.GoldenSetError, match="embeddings are partial"):
            fx.load_golden_set(tmp_path)

    def test_a_fully_embedded_fixture_LOADS(self, tmp_path) -> None:
        """The passing case of the all-or-nothing check — the one that broke.

        The partial-embedding guard built its error message eagerly and
        indexed `missing[0]`, so a VALID fully-embedded fixture raised
        IndexError instead of loading. It went unnoticed because the
        committed fixture carried no vectors, leaving the whole branch
        unreached: the rejection tests above all passed while the success
        path was broken. Only committing real vectors exposed it.
        """
        records = [
            {**self.RECORD, "embedding": [0.0] * 384},
            {**self.RECORD, "key": "r2", "embedding": [0.1] * 384},
        ]
        cases = [{**self.CASE, "query_embedding": [0.2] * 384}]
        self._write(
            tmp_path,
            {"embedding_source": fx.REAL_EMBEDDING_SOURCE},
            records,
            cases,
        )
        gs = fx.load_golden_set(tmp_path)
        assert gs.vectors_committed is True
        assert gs.has_real_vectors is True
        assert len(gs.records) == 2
        assert gs.cases[0].query_embedding is not None

    def test_embedded_corpus_without_case_vectors_is_rejected(self, tmp_path) -> None:
        self._write(
            tmp_path,
            self.MANIFEST,
            [{**self.RECORD, "embedding": [0.0] * 384}],
            [self.CASE],
        )
        with pytest.raises(fx.GoldenSetError, match="no query_embedding"):
            fx.load_golden_set(tmp_path)

    def test_unknown_embedding_source_is_rejected(self, tmp_path) -> None:
        self._write(
            tmp_path,
            {"embedding_source": "hand-wavy-v9"},
            [self.RECORD],
            [self.CASE],
        )
        with pytest.raises(fx.GoldenSetError, match="embedding_source"):
            fx.load_golden_set(tmp_path)

    def test_unknown_case_class_is_rejected(self, tmp_path) -> None:
        self._write(
            tmp_path, self.MANIFEST, [self.RECORD], [{**self.CASE, "class": "vibes"}]
        )
        with pytest.raises(fx.GoldenSetError, match="class"):
            fx.load_golden_set(tmp_path)


class TestResolveKeys:
    def test_known_ids_map_to_keys_in_order(self) -> None:
        mapping = {"id-1": "alpha", "id-2": "beta"}
        assert fx.resolve_keys(["id-2", "id-1"], mapping) == ["beta", "alpha"]

    def test_unseeded_ids_are_kept_so_they_count_as_noise(self) -> None:
        # Dropping them would let a ranker return arbitrary junk for free.
        out = fx.resolve_keys(["id-1", "stranger"], {"id-1": "alpha"})
        assert out == ["alpha", "unseeded:stranger"]


# ---------------------------------------------------------------------------
# Plan 2026-08-11-coord-ambient-recall-and-efficacy-statistical-rigor, Phase 2
# ---------------------------------------------------------------------------

#: The DB harness, read as TEXT rather than imported. These tests assert a
#: property of that module's SOURCE — that no holdout number is wired into
#: the tuning path — and importing it would drag in the app, FastAPI and a
#: database URL to check something the parser can see for itself.
_DRIVER = Path(__file__).resolve().parent / "test_memory_recall_eval_db.py"

#: The workflow that renders the PR comment. The last link in the chain: a
#: number that never enters the report still cannot be shown if the comment
#: step has no way to read it.
_WORKFLOW = (
    Path(__file__).resolve().parents[2]
    / ".github"
    / "workflows"
    / "memory-recall-eval.yml"
)


def _driver_source() -> str:
    return _DRIVER.read_text(encoding="utf-8")


#: The holdout module itself. It WRITES to the sealed directory by design, so
#: the read-primitive check would flag its own ``temporary.open("w")`` — it is
#: the sealed side, not the tuning path, and is the one module excluded from
#: the cross-module scan below.
_SEALED_MODULE = Path(ho.__file__).resolve()


def _tuning_path_sources() -> dict[str, str]:
    """Every module on the TUNING side, by path, for the sealed-read check.

    The check used to parse the driver and nothing else, so the evasion was
    not even an evasion: put the read in a new module and import it. A
    ``tests/memory_recall/audit.py`` that opened ``holdout-*.json`` and
    returned the suite would have been invisible, and the driver calling it
    would have been a plain function call with no sealed token in sight.

    Scope: the driver, every ``tests.``-module it imports, and every module
    in the harness package — minus :data:`_SEALED_MODULE`, which is the
    side doing the writing.
    """
    sources = {_DRIVER.as_posix(): _driver_source()}
    candidates: set[Path] = set(_DRIVER.parent.glob("memory_recall/*.py"))

    for node in ast.walk(ast.parse(_driver_source())):
        if not isinstance(node, ast.ImportFrom):
            continue
        module = node.module or ""
        if not module.startswith("tests."):
            continue
        base = _DRIVER.parents[1] / Path(*module.split("."))
        if base.is_dir():
            candidates |= {base / f"{alias.name}.py" for alias in node.names}
        else:
            candidates.add(base.with_suffix(".py"))

    for path in candidates:
        if path.resolve() == _SEALED_MODULE or not path.is_file():
            continue
        sources[path.as_posix()] = path.read_text(encoding="utf-8")
    return sources


def _leaves(value: object) -> list[object]:
    """Every scalar in a nested report block, for leaf-TYPE assertions."""
    if isinstance(value, dict):
        return [leaf for item in value.values() for leaf in _leaves(item)]
    if isinstance(value, (list, tuple)):
        return [leaf for item in value for leaf in _leaves(item)]
    return [value]


def _displayed_exceptions(error: BaseException) -> list[BaseException]:
    """Every exception pytest RENDERS for ``error``, outermost first.

    ``--showlocals`` applies to every frame of every exception in the
    DISPLAYED CHAIN, not just to the one that escaped. Walking only
    ``error.__traceback__`` — which the frame test did until 2026-08-20 —
    therefore inspects a strict subset of what the job log prints, and the
    part it skips is exactly the part the sanitising boundary exists to
    suppress. Mutating ``raise ... from None`` to ``from error`` at
    ``holdout.py`` left the whole suite green while putting
    ``_sealed_payload``'s frame — holding ``scores`` — back on the page.

    The traversal mirrors CPython's own display rule: follow ``__cause__``
    when set (``raise X from Y``), otherwise ``__context__`` unless
    ``__suppress_context__`` (which ``from None`` sets). Cycle-guarded,
    because a hand-set ``__cause__`` can make one.
    """
    chain: list[BaseException] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(current)
        if current.__cause__ is not None:
            current = current.__cause__
        elif current.__context__ is not None and not current.__suppress_context__:
            current = current.__context__
        else:
            current = None
    return chain


#: Every call name that can pull bytes back off a filesystem. The driver may
#: not point one of these at the sealed side.
_READ_PRIMITIVES = frozenset(
    {
        "open",
        "read",
        "read_bytes",
        "read_text",
        "readlines",
        "load",
        "loads",
        "iterdir",
        "glob",
        "rglob",
        "listdir",
        "scandir",
        "walk",
    }
)

#: Callables that turn a read primitive into a differently-named one. Matching
#: reads by CALL NAME alone made every one of these invisible: ``opener =
#: functools.partial(open, sealed)`` then ``opener()`` names no primitive.
_PARTIAL_APPLIERS = frozenset({"partial", "partialmethod"})

#: What makes an expression sealed-shaped on its face. Deliberately coarse:
#: a false positive costs a rename, a false negative costs the seal.
_SEALED_TOKENS = ("holdout", "sealed")


def _is_none(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value is None


def _sealed_read_violations(source: str) -> list[str]:
    """Every read primitive in ``source`` whose expression is sealed-derived.

    Substring-matching a single call's own source segment — which is what
    this check did until 2026-08-19 — is evaded by one intermediate
    variable::

        directory = Path(os.environ[SEALED_DIR_ENV])
        scores = json.loads((directory / "holdout-hybrid.json").read_text())

    The ``read_text`` call's own segment names neither "holdout" nor
    "sealed" once the filename comes from a variable, so the old check saw
    nothing. Sealed-ness is therefore PROPAGATED here: a binding whose
    right-hand side is sealed-shaped taints its targets, run to a fixpoint
    so a chain of intermediates cannot launder it, and a tainted name
    anywhere inside a read call's expression is a violation.

    ``test_the_sealed_read_detector_catches_an_indirection`` is the positive
    control — without it this function's clean verdict over the driver
    proves nothing, since the driver contains no read primitive at all.

    **Two structural gaps, both closed on 2026-08-20** after a reviewer ran
    ten evasions against it and five walked through.

    *Taint never crossed a function boundary or a walrus.* The binding-form
    list handled ``Assign``/``AnnAssign``/``AugAssign``/``For``/``withitem``
    and nothing else, so ``def _where(): return
    Path(os.environ[SEALED_DIR_ENV])`` — the most ordinary extraction
    refactor there is, and exactly what the positive control's own two
    lines would become — left the detector silent. ``NamedExpr``,
    ``Return`` (which taints the enclosing function's NAME, so a call to it
    is sealed-shaped), parameter defaults, ``except ... as`` and ``match``
    captures are all binding forms here now.

    *Reads were matched by call NAME.* ``reader = sealed.read_text`` then
    ``reader()``, or ``functools.partial(open, sealed)`` then ``opener()``,
    are reads through a callable whose name is in no list. So a second
    fixpoint set tracks names bound to a read primitive — directly, through
    another such name, or through a partial application — and a call to one
    of those counts as a read.

    Over-approximation is the intended direction throughout (returns are
    collected with ``ast.walk``, so a nested function's return taints its
    parent's name too): a false positive costs a rename, a false negative
    costs the seal.
    """
    tree = ast.parse(source)
    tainted: set[str] = set()
    readers: set[str] = set()

    def _is_sealed(node: ast.AST | None) -> bool:
        if node is None:
            return False
        segment = (ast.get_source_segment(source, node) or "").lower()
        if any(token in segment for token in _SEALED_TOKENS):
            return True
        return any(
            isinstance(child, ast.Name) and child.id in tainted
            for child in ast.walk(node)
        )

    def _bound_names(target: ast.AST) -> set[str]:
        return {c.id for c in ast.walk(target) if isinstance(c, ast.Name)}

    def _aliases_a_read(node: ast.AST | None) -> bool:
        """``node`` evaluates to a read primitive WITHOUT calling one."""
        if isinstance(node, ast.Attribute):
            return node.attr in _READ_PRIMITIVES
        if isinstance(node, ast.Name):
            return node.id in _READ_PRIMITIVES or node.id in readers
        if isinstance(node, ast.Call):
            func = node.func
            applier = (
                func.attr
                if isinstance(func, ast.Attribute)
                else getattr(func, "id", "")
            )
            if applier in _PARTIAL_APPLIERS and node.args:
                return _aliases_a_read(node.args[0])
        return False

    functions = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]

    def _bindings() -> list[tuple[list[ast.AST | None], list[str]]]:
        """Every ``(source expressions, names they bind)`` pair in the tree."""
        pairs: list[tuple[list[ast.AST | None], list[str]]] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                pairs.append(
                    (
                        [node.value],
                        sorted(set().union(*map(_bound_names, node.targets))),
                    )
                )
            elif isinstance(node, (ast.AnnAssign, ast.AugAssign, ast.NamedExpr)):
                pairs.append(([node.value], sorted(_bound_names(node.target))))
            elif isinstance(node, (ast.For, ast.AsyncFor, ast.comprehension)):
                pairs.append(([node.iter], sorted(_bound_names(node.target))))
            elif isinstance(node, ast.withitem):
                pairs.append(
                    (
                        [node.context_expr],
                        sorted(_bound_names(node.optional_vars))
                        if node.optional_vars
                        else [],
                    )
                )
            elif isinstance(node, ast.ExceptHandler) and node.name:
                pairs.append(([node.type], [node.name]))
            elif isinstance(node, ast.Match):
                captured = {
                    capture.name
                    for capture in ast.walk(node)
                    if isinstance(capture, (ast.MatchAs, ast.MatchStar))
                    and capture.name is not None
                } | {
                    capture.rest
                    for capture in ast.walk(node)
                    if isinstance(capture, ast.MatchMapping)
                    and capture.rest is not None
                }
                pairs.append(([node.subject], sorted(captured)))
        for function in functions:
            arguments = function.args
            positional = arguments.posonlyargs + arguments.args
            defaults = arguments.defaults
            for argument, default in zip(
                positional[len(positional) - len(defaults) :], defaults, strict=True
            ):
                pairs.append(([default], [argument.arg]))
            for argument, keyword_default in zip(
                arguments.kwonlyargs, arguments.kw_defaults, strict=True
            ):
                if keyword_default is not None:
                    pairs.append(([keyword_default], [argument.arg]))
            # A function that RETURNS something sealed makes its own name
            # sealed-shaped, so `(_where() / "x.json").read_text()` is caught.
            pairs.append(
                (
                    [
                        statement.value
                        for statement in ast.walk(function)
                        if isinstance(statement, ast.Return)
                        and statement.value is not None
                    ],
                    [function.name],
                )
            )
        return pairs

    bindings = _bindings()
    while True:
        grew = False
        for values, names in bindings:
            sealed = any(_is_sealed(value) for value in values)
            reads = any(_aliases_a_read(value) for value in values)
            for name in names:
                if sealed and name not in tainted:
                    tainted.add(name)
                    grew = True
                if reads and name not in readers:
                    readers.add(name)
                    grew = True
        if not grew:
            break

    violations: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Attribute):
            name = node.func.attr
        elif isinstance(node.func, ast.Name):
            name = node.func.id
        else:
            continue
        if name not in _READ_PRIMITIVES and name not in readers:
            continue
        if _is_sealed(node):
            violations.append(ast.get_source_segment(source, node) or name)
    return violations


class TestHoldoutSplit:
    """The split must be a partition, stratified, and identical everywhere."""

    def test_train_and_holdout_partition_the_input(self) -> None:
        cases = [(f"case-{i:02d}", "only") for i in range(1, 11)]
        split = ho.split_cases(cases)
        assert split.train_set | split.holdout_set == {cid for cid, _ in cases}
        assert not (split.train_set & split.holdout_set)
        assert split.train_count + split.holdout_count == len(cases)

    def test_the_draw_is_pinned_not_merely_reproducible(self) -> None:
        """A golden vector, so a silent change to the algorithm is loud.

        ``split_cases`` being self-consistent within one process proves
        nothing — ``hash()`` is self-consistent too and still differs
        between processes. This pins the ACTUAL draw for a fixed input, so
        reordering the sort key, dropping the ``SPLIT_VERSION`` salt, or
        switching hash function fails here rather than silently redrawing a
        train/test boundary that recorded numbers depend on.
        """
        cases = [(f"case-{i:02d}", "only") for i in range(1, 11)]
        assert ho.split_cases(cases).holdout == ("case-07", "case-09")

    def test_repeated_calls_agree(self) -> None:
        cases = [(f"case-{i:02d}", "only") for i in range(1, 11)]
        assert ho.split_cases(cases) == ho.split_cases(cases)

    def test_input_order_does_not_move_a_case_across_the_boundary(self) -> None:
        """The draw is keyed on the case id, never on its position."""
        cases = [(f"case-{i:02d}", "only") for i in range(1, 11)]
        forward = ho.split_cases(cases)
        backward = ho.split_cases(list(reversed(cases)))
        assert forward.holdout_set == backward.holdout_set

    def test_stratification_keeps_every_class_on_the_train_side(self) -> None:
        cases = [(f"a-{i}", "alpha") for i in range(6)] + [
            (f"b-{i}", "beta") for i in range(6)
        ]
        split = ho.split_cases(cases)
        train_classes = {
            case_class for cid, case_class in cases if cid in split.train_set
        }
        assert train_classes == {"alpha", "beta"}

    def test_a_class_smaller_than_the_stride_is_never_sealed(self) -> None:
        """The conservative direction: a tiny class stays fully measurable."""
        cases = [(f"a-{i}", "alpha") for i in range(ho.HOLDOUT_EVERY - 1)]
        assert ho.split_cases(cases).holdout == ()

    def test_a_duplicate_case_id_is_a_hard_error(self) -> None:
        with pytest.raises(ValueError, match="more than once"):
            ho.split_cases([("dup", "alpha"), ("dup", "beta")])

    def test_the_committed_golden_set_splits_usefully(self) -> None:
        """On the real fixture: a non-empty holdout, no class emptied."""
        gs = fx.load_golden_set()
        split = ho.split_cases([(c.case_id, c.case_class) for c in gs.cases])
        assert split.holdout_count > 0, "nothing sealed — the holdout is vacuous"
        assert split.train_count > split.holdout_count
        train_classes = {c.case_class for c in gs.cases if c.case_id in split.train_set}
        assert train_classes == {c.case_class for c in gs.cases}
        # Correction pairs are the harness's highest-value assertion, and the
        # DB suite asserts they are exercised — which needs some on train.
        assert any(
            c.correction is not None for c in gs.cases if c.case_id in split.train_set
        )


class TestSealedHoldoutIsUnreachableByConstruction:
    """Verification item 7 — the tuning path CANNOT read holdout scores.

    Not "does not": every assertion here is about a structural property
    that would have to be deleted to wire a holdout number through, so a
    later change that tries fails one of these rather than passing quietly
    because nobody remembered the convention.

    What is deliberately NOT claimed: that the holdout scores are secret.
    The cases are committed and the split algorithm is published, so anyone
    can recompute them. The property is that no code path in this harness
    carries one to a gate, a verdict, the report, or the PR comment.
    """

    @staticmethod
    def _observation(case_id: str = "c1") -> ho.HoldoutObservation:
        return ho.HoldoutObservation(
            case_id=case_id,
            case_class="general",
            ranked=("alpha", "beta"),
            relevant=("alpha",),
            correction=None,
        )

    def _score(self, directory: Path, case_count: int = 1) -> None:
        ho.SealedHoldoutRunner(directory).score(
            arm="fts_only",
            vector_arm="skipped_no_embedding",
            observations=[self._observation()],
            content_bytes={"alpha": 10, "beta": 20},
            case_count=case_count,
        )

    def test_score_returns_none(self, tmp_path: Path) -> None:
        runner = ho.SealedHoldoutRunner(tmp_path)
        result = runner.score(
            arm="fts_only",
            vector_arm="skipped_no_embedding",
            observations=[self._observation()],
            content_bytes={"alpha": 10},
            case_count=1,
        )
        assert result is None

    def test_score_is_annotated_as_returning_none(self) -> None:
        """The annotation, so a return value cannot be added quietly.

        A future ``-> SuiteScore`` is the exact edit this design exists to
        stop; it fails here as well as at the call site.
        """
        hints = get_type_hints(ho.SealedHoldoutRunner.score)
        assert hints["return"] is type(None)

    def test_the_runner_has_exactly_one_public_member(self) -> None:
        runner = ho.SealedHoldoutRunner(Path("."))
        public = {name for name in dir(runner) if not name.startswith("_")}
        assert public == {"score"}, (
            f"the sealed runner grew a public member: {sorted(public)}. "
            "Anything besides `score` is a candidate reader."
        )

    def test_the_runner_cannot_stash_a_result(self, tmp_path: Path) -> None:
        """``__slots__`` is the mechanism: there is nowhere to put one."""
        runner = ho.SealedHoldoutRunner(tmp_path)
        with pytest.raises(AttributeError):
            runner.last_suite = "anything"  # type: ignore[attr-defined]

    def test_the_module_exposes_no_reader(self) -> None:
        defined = {
            name
            for name, value in vars(ho).items()
            if not name.startswith("_")
            and (isinstance(value, type) or callable(value))
            and getattr(value, "__module__", None) == ho.__name__
        }
        assert defined == ho.PUBLIC_CALLABLES, (
            "the holdout module's callable surface changed: "
            f"{sorted(defined ^ ho.PUBLIC_CALLABLES)}. A new function here is "
            "the natural place to accidentally add a way to read the scores "
            "back — if it really is write-only, add it to PUBLIC_CALLABLES "
            "deliberately."
        )

    def test_the_sealed_document_holds_the_line_it_can(self) -> None:
        """The wrapper's rendering routes, and — as loudly — its limits.

        ``repr``, ``str`` and ``__format__`` are the three ways a value
        reaches a traceback or a log line, and all three are withheld. That
        is the property the sixth bullet needs and it is asserted first.

        ``slots=True`` closes ``vars()`` and ``__dict__`` on top of it.
        It does NOT close :func:`dataclasses.asdict` (which reads
        ``fields()``), pickle, or :func:`gc.get_referents` — all three still
        return the plaintext, measured here rather than assumed, because a
        docstring that claimed them would be an overclaim someone later
        relies on. None of the three is on a traceback path.
        """
        document = ho._SealedDocument("recall_at_10=0.9375 mrr=0.5")

        for rendering in (repr(document), str(document), format(document)):
            assert "0.9375" not in rendering and "recall_at_10" not in rendering
            assert "contents withheld" in rendering

        with pytest.raises(TypeError):
            vars(document)
        with pytest.raises(AttributeError):
            document.__dict__  # noqa: B018 - the AttributeError IS the assertion
        assert type(document).__slots__ == ("_text",)

        # The honest other half. If one of these ever starts raising, that
        # is a genuine improvement — but it has to be measured, not claimed.
        assert dataclasses.asdict(document) == {"_text": "recall_at_10=0.9375 mrr=0.5"}
        assert pickle.loads(pickle.dumps(document)).text() == document.text()
        assert document.text() in gc.get_referents(document)

    def test_the_two_destinations_cannot_be_configured_to_coincide(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The module's own claim, CHECKED rather than asserted in prose.

        ``holdout.py`` says the sealed directory and the report path "never
        coincide" and then never looked at the report path. A run that
        pointed both at one place would write holdout scores exactly where
        the PR comment step reads.

        **Containment, not just equality**, and the containing case is the
        realistic one: an equality-only guard called
        ``MEMORY_RECALL_HOLDOUT_DIR=${{ github.workspace }}`` with
        ``MEMORY_RECALL_EVAL_REPORT=${{ github.workspace }}/recall-eval.json``
        clean, while every ``holdout-*.json`` landed beside the report and
        ``actions/upload-artifact`` published the workspace.
        """
        collision = tmp_path / "same-place"
        monkeypatch.setenv(ho.SEALED_DIR_ENV, str(collision))
        monkeypatch.setenv(ho.REPORT_PATH_ENV, str(collision))
        with pytest.raises(ValueError, match="never be, nor contain, the file"):
            ho.sealed_directory()

        # The report INSIDE the sealed directory — the workspace shape.
        monkeypatch.setenv(ho.REPORT_PATH_ENV, str(collision / "recall-eval.json"))
        with pytest.raises(ValueError, match="never be, nor contain, the file"):
            ho.sealed_directory()

        # ...and deeper in, since a nested artifact directory is the same
        # publication hazard one level down.
        monkeypatch.setenv(
            ho.REPORT_PATH_ENV, str(collision / "artifacts" / "recall-eval.json")
        )
        with pytest.raises(ValueError, match="never be, nor contain, the file"):
            ho.sealed_directory()

        # A sibling is fine, and has to stay fine: this is the configuration
        # CI actually uses, so a containment check that rejected it would be
        # a false positive that turns the whole guard off.
        monkeypatch.setenv(ho.REPORT_PATH_ENV, str(tmp_path / "recall-eval.json"))
        assert ho.sealed_directory() == collision

    def test_the_fallback_directory_identifies_its_run(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """``backend-ci.yml`` sets neither variable, so this is the real path.

        A fixed shared name under ``gettempdir()`` collected
        ``holdout-*.json`` from every earlier branch that ran the suite on
        the same machine, indistinguishable from this run's. Nothing reads
        them, so it was never a leak — but the sealed file's whole purpose
        is to be audited afterwards by someone who needs to know which run
        wrote it.
        """
        monkeypatch.delenv(ho.SEALED_DIR_ENV, raising=False)
        monkeypatch.delenv(ho.REPORT_PATH_ENV, raising=False)
        monkeypatch.delenv("GITHUB_RUN_ID", raising=False)

        local = ho.sealed_directory()
        assert str(os.getpid()) in local.name
        # Stable within the process: the driver calls `sealed_runner()` once
        # per arm and all three must land in ONE directory.
        assert ho.sealed_directory() == local

        monkeypatch.setenv("GITHUB_RUN_ID", "1234567890")
        in_ci = ho.sealed_directory()
        assert "1234567890" in in_ci.name
        assert in_ci != local

    def test_the_module_exposes_no_mutable_constant(self) -> None:
        """The other half of the surface pin — and the one that was missing.

        ``PUBLIC_CALLABLES`` pins callables only, on the stated grounds that
        "a ``str`` cannot return a score". True, and beside the point: a
        ``dict`` can. ``LAST_SUITE: dict = {}`` at module scope, written by
        ``score()``, passes every one of the other five mechanisms — the
        return is still ``None``, ``__slots__`` is untouched, the runner
        still has one public member, the directory is still write-only, no
        frame holds a score — and hands the holdout to anyone who imports
        the module.

        Two assertions, because the name pin alone is editable: the second
        requires every public constant to be IMMUTABLE, which a mutable
        module-scope stash cannot satisfy by being added to the set.
        """
        non_callables = {
            name: value
            for name, value in vars(ho).items()
            if not name.startswith("_")
            and not callable(value)
            and not isinstance(value, types.ModuleType)
            # `from __future__ import annotations` binds a `_Feature`.
            and getattr(type(value), "__module__", "") != "__future__"
        }
        assert set(non_callables) == ho.PUBLIC_CONSTANTS, (
            "the holdout module's constant surface changed: "
            f"{sorted(set(non_callables) ^ ho.PUBLIC_CONSTANTS)}. A module-scope "
            "container here is a place a holdout score can be stashed and read "
            "back — if it really is inert, add it to PUBLIC_CONSTANTS "
            "deliberately."
        )
        # The immutability half is asserted over EVERY module-scope value,
        # not just the public ones. Both halves above filter on
        # `not name.startswith("_")`, so `_LAST_SUITE: dict = {}` was
        # covered by neither: not in the name pin (private), not in the
        # mutability check (same filter). It is one underscore away from the
        # stash the whole test exists to stop, and `holdout.score` can write
        # to it exactly as easily.
        mutable = {
            name: value
            for name, value in vars(ho).items()
            if not callable(value)
            and not isinstance(value, types.ModuleType)
            and getattr(type(value), "__module__", "") != "__future__"
            and not isinstance(value, (str, bytes, int, float, frozenset, tuple))
            # `__builtins__`, `__spec__`, `__loader__` and friends are the
            # interpreter's, not this module's surface.
            and not (name.startswith("__") and name.endswith("__"))
        }
        assert mutable == {}, (
            f"a module-scope constant is mutable: {sorted(mutable)}. A dict, "
            "list or set at module scope is somewhere `score()` can write a "
            "suite to, which is the one thing this module has no other "
            "mechanism against — and a leading underscore exempts it from "
            "neither this check nor `score`'s reach."
        )

    def test_no_failure_renders_a_score_in_any_frame(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The interpreter's own error reporting is a sixth path out.

        ``backend/pytest.ini`` sets ``--showlocals`` unconditionally and
        ``-q`` does not cancel it, so an exception escaping ``score()``
        prints EVERY traceback frame's locals into the job log on the PR
        checks page. Every one of these failures must still raise (the seal
        may not be silent about its own breakage) — so what has to be true
        instead is that no frame on the way out is holding a score.

        **Three statements can raise, and this used to provoke only one.**
        The previous version patched ``Path.mkdir``/``Path.open``, i.e. the
        one statement that already sat behind a boundary; it was written to
        the mechanism rather than to the claim. Measured on ``6a8dc730``,
        the two it skipped rendered::

            aggregate() raises   -> frame score: {'scores': [...]}
            json.dumps() raises  -> frame score: {'scores', 'suite', 'payload'}

        — the whole holdout report, in the frame ``--showlocals`` prints.
        All five provocations below are exercised now.

        The assertion is an ALLOWLIST of permitted local NAMES per frame,
        not a denylist of score-shaped values. A denylist is what the
        previous version had, and ``means = (suite.recall_at_5, suite.mrr)``
        walks past it: the value is neither a ``SuiteScore`` nor a
        ``CaseScore``, and its repr — ``(0.0417, 0.0833)`` — names no
        metric, while the numbers print just the same. A new local in these
        frames now has to be added here deliberately.
        """
        sealed_metrics = (
            "recall_at_5",
            "recall_at_10",
            "recall_at_20",
            "reciprocal_rank",
            "ndcg_at_10",
            "noise_rate_at_10",
            "token_cost_at_10",
            "correction_precedence",
        )
        # `observations` is allowlisted below, so the reason has to be
        # stated as a check rather than left implicit. `HoldoutObservation`
        # is an INPUT — what the retrieval system returned, which the driver
        # built and passed in — and the pin here is what stops it quietly
        # growing a score field later. It is also on the traceback either
        # way: the driver's `_run_arm` holds the same list in the frame
        # directly below `score`, so hiding it inside `holdout.py` would
        # rename the leak rather than close it.
        assert [f.name for f in dataclasses.fields(ho.HoldoutObservation)] == [
            "case_id",
            "case_class",
            "ranked",
            "relevant",
            "correction",
        ], (
            "HoldoutObservation's fields changed. It is allowlisted in every "
            "frame below on the grounds that it carries a RANKING and never a "
            "score — a new field has to be shown to keep that true."
        )

        #: What each holdout frame may bind while an exception passes
        #: through it. `_sealed_payload` is deliberately ABSENT: it holds
        #: `scores` and `suite` by definition, and the property is that it
        #: never appears on any RENDERED traceback — neither the escaping
        #: exception's nor a chained one's. `error` is absent for the same
        #: reason: the handler binds it, but Python's implicit
        #: `del` at the end of an `except` block runs even as the block
        #: raises, so it is gone by the time the frame is rendered — and if
        #: a future edit keeps it alive under any name, that name is not in
        #: this set. Its `args` carry `json.dumps`'s message, which quotes
        #: the offending metric.
        permitted = {
            "score": {
                "self",
                "arm",
                "vector_arm",
                "observations",
                "content_bytes",
                "case_count",
            },
            "_sealed_document": {
                "arm",
                "vector_arm",
                "observations",
                "content_bytes",
                "case_count",
                "origin",
            },
            "_write_sealed_document": {
                "directory",
                "filename",
                "document",
                "destination",
                "temporary",
                "handle",
            },
        }

        def _explode(*args: object, **kwargs: object) -> None:
            raise OSError(30, "Read-only file system")

        def _aggregate_blows_up(*args: object, **kwargs: object) -> SuiteScore:
            # The message quotes a score on purpose: a boundary that
            # forwarded the original message would leak it.
            raise ValueError("denominator check failed, scores=[0.8125, 0.4375]")

        def _aggregate_returns_infinity(
            arm: str, vector_arm: str, scores: object, *, case_count: int
        ) -> SuiteScore:
            suite = aggregate(
                arm,
                vector_arm,
                cast("list[CaseScore]", scores),
                case_count=case_count,
            )
            return dataclasses.replace(suite, mrr=math.inf)

        # (label, how to provoke it, what must escape). The first two are
        # the cases the previous version of this test never reached.
        provocations: list[tuple[str, Callable[[], None], type[BaseException]]] = [
            (
                "a denominator below the data",
                lambda: self._score(tmp_path, case_count=0),
                ValueError,
            ),
            (
                "aggregate() raises",
                lambda: self._provoke(
                    tmp_path, monkeypatch, ho, "aggregate", _aggregate_blows_up
                ),
                ho.SealedHoldoutError,
            ),
            (
                "json.dumps() raises on a non-finite metric",
                lambda: self._provoke(
                    tmp_path, monkeypatch, ho, "aggregate", _aggregate_returns_infinity
                ),
                ho.SealedHoldoutError,
            ),
            (
                "mkdir cannot succeed (read-only mount, foreign uid)",
                lambda: self._provoke(tmp_path, monkeypatch, Path, "mkdir", _explode),
                OSError,
            ),
            (
                "the write cannot succeed (full disk)",
                lambda: self._provoke(tmp_path, monkeypatch, Path, "open", _explode),
                OSError,
            ),
        ]

        for label, provoke, expected in provocations:
            with pytest.raises(expected) as raised:
                provoke()

            chain = _displayed_exceptions(raised.value)

            # `raise ... from None` is the mechanism the whole boundary rests
            # on, and it is ONE token. Mutating it to `from error` left the
            # entire suite green while re-rendering `_sealed_payload`'s
            # frame — and its `scores` — into the job log, because
            # --showlocals covers every exception in the displayed chain and
            # this test walked only the escaping one. So where the boundary
            # is what raised, assert that it SEVERED the chain.
            if expected is ho.SealedHoldoutError:
                assert len(chain) == 1, (
                    f"{label}: the sanitising boundary re-raised WITH the "
                    f"original ({[type(e).__name__ for e in chain]}). "
                    "`raise SealedHoldoutError(...) from None` is the "
                    "mechanism: `from error` — or a bare `raise` — puts the "
                    "score-bearing frames beneath the boundary back on the "
                    "rendered page."
                )

            # Only the frames of the module under test, across EVERY
            # exception in the chain. This test's own frame legitimately
            # holds `sealed_metrics` above, and the property being asserted
            # is about `holdout.py`'s frames.
            frames = []
            for displayed in chain:
                walker = displayed.__traceback__
                while walker is not None:
                    if walker.tb_frame.f_code.co_filename == ho.__file__:
                        frames.append(walker.tb_frame)
                    walker = walker.tb_next
            assert frames, (
                f"{label}: nothing raised out of holdout.py at all — the "
                "provocation no longer reaches the code it is aimed at"
            )

            for frame in frames:
                where = frame.f_code.co_name
                assert where in permitted, (
                    f"{label}: an unexpected holdout frame {where!r} is on the "
                    "escaping traceback. Frames that compute a score must stay "
                    "behind a boundary that substitutes the exception; if this "
                    "one genuinely holds none, add it to `permitted` with its "
                    "allowed locals."
                )
                unexpected = set(frame.f_locals) - permitted[where]
                assert not unexpected, (
                    f"{label}: frame {where} binds {sorted(unexpected)} while "
                    "raising. --showlocals prints every local of every frame "
                    "into the public job log, so a new name here has to be "
                    "shown to carry no score and then allowlisted."
                )
                for name, value in frame.f_locals.items():
                    assert not isinstance(value, (SuiteScore, CaseScore)), (
                        f"{label}: frame {where} holds a score object in local "
                        f"{name!r} while raising — --showlocals renders it"
                    )
                    leaked = [m for m in sealed_metrics if m in repr(value)]
                    assert not leaked, (
                        f"{label}: frame {where} local {name!r} renders holdout "
                        f"metric(s) {leaked} into a traceback the CI log prints "
                        "in full."
                    )

            # The message is the other rendered surface, and every message in
            # the chain is printed, not just the escaping one. `json.dumps`
            # names the offending float in its own text, and a forwarded
            # `aggregate` message would carry the list it rejected.
            for displayed in chain:
                message = str(displayed)
                quoted = re.search(r"\b(0\.\d+|inf(inity)?|nan)\b", message, re.I)
                assert quoted is None, (
                    f"{label}: a message in the displayed chain quotes a holdout "
                    f"value ({quoted.group(0)!r} in {message!r}) — messages are "
                    "rendered into the job log exactly like the locals are"
                )

    def _provoke(
        self,
        directory: Path,
        monkeypatch: pytest.MonkeyPatch,
        target: object,
        attribute: str,
        replacement: object,
    ) -> None:
        """Run one sealed score with ``target.attribute`` replaced."""
        with monkeypatch.context() as patched:
            patched.setattr(target, attribute, replacement, raising=True)
            self._score(directory)

    def test_the_sealed_write_actually_happens(self, tmp_path: Path) -> None:
        """Positive control: the seal must not be vacuously satisfied.

        A runner that computed nothing would pass every assertion above.
        Reading the artifact HERE is legitimate — this test emits no report
        and gates nothing; it is the audit path the sealed file exists for.
        """
        self._score(tmp_path)
        written = list(tmp_path.glob("holdout-*.json"))
        assert len(written) == 1
        payload = json.loads(written[0].read_text(encoding="utf-8"))
        assert payload["arm"] == "fts_only"
        assert payload["case_count"] == 1
        assert payload["recall_at_10"] == 1.0
        assert [c["case_id"] for c in payload["cases"]] == ["c1"]
        assert "SEALED" in payload["_warning"]

    def test_the_holdout_keeps_its_own_denominator(self, tmp_path: Path) -> None:
        """Phase 1's explicit-denominator discipline, applied to the seal.

        One scored case out of a declared three must report a third of the
        score, not a full one over a shrunken divisor.
        """
        self._score(tmp_path, case_count=3)
        payload = json.loads(
            (tmp_path / "holdout-fts_only.json").read_text(encoding="utf-8")
        )
        assert payload["case_count"] == 3
        assert payload["missing_cases"] == 2
        assert payload["recall_at_10"] == pytest.approx(1 / 3)

    def test_the_split_report_carries_no_score(self) -> None:
        """The only holdout-derived block in the report is number-free.

        Stated TOTALLY: a leaf is a string, or an int under one of the two
        pinned count keys. The old spelling was "no float anywhere", which
        three of this harness's own metrics walk straight past — see
        :func:`~tests.memory_recall.holdout.split_report_violations`.
        """
        split = ho.split_cases([(f"case-{i:02d}", "only") for i in range(1, 11)])
        report = ho.split_report(split)
        assert ho.split_report_violations(report) == []
        assert report["holdout_cases"] == split.holdout_count
        assert report["holdout_case_ids"] == list(split.holdout)

    def test_an_int_metric_in_the_split_block_is_a_violation(self) -> None:
        """The half "no float" never covered, and the plan headlines it.

        ``SuiteScore.total_token_cost_at_10``, ``.correction_pairs`` and
        ``.correction_precedence_passes`` are ``int``. A
        ``"holdout_token_cost": 374`` grown into the split block is a
        holdout score in the emitted report, and a float-only check calls
        it clean.
        """
        clean = ho.split_report(ho.split_cases([("a", "x"), ("b", "x")]))

        leaked_int = dict(clean, holdout_token_cost=374)
        assert ho.split_report_violations(leaked_int) == ["holdout_token_cost=374"]

        leaked_float = dict(clean, holdout_recall_at_10=0.42)
        assert ho.split_report_violations(leaked_float) == ["holdout_recall_at_10=0.42"]

        # Nesting is not an escape either — the DB-side check used to walk
        # `report["split"].values()` one level deep.
        nested = dict(clean, holdout_means={"mrr": 0.31})
        assert ho.split_report_violations(nested) == ["mrr=0.31"]

        # The two pinned count keys stay legal wherever they appear, and a
        # bool is not one of them: `False` is one `+` away from `0`.
        assert ho.split_report_violations({"train_cases": 41}) == []
        assert ho.split_report_violations({"train_cases": True}) == ["train_cases=True"]

    def test_the_driver_discards_the_sealed_call(self) -> None:
        """The call's value is thrown away SYNTACTICALLY, in the parse tree.

        This is the assertion that catches the change the plan warns about:
        someone adds a return value to ``score()`` and binds it.
        ``sealed_runner().score(...)`` must remain a bare expression
        statement — the moment it becomes ``x = ...``, ``return ...`` or an
        argument to anything, this fails.
        """
        source = _driver_source()
        tree = ast.parse(source)
        bare_statements = {
            id(node.value) for node in ast.walk(tree) if isinstance(node, ast.Expr)
        }
        sealed_calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and "sealed_runner()" in (ast.get_source_segment(source, node.func) or "")
        ]
        assert sealed_calls, (
            "the driver no longer calls the sealed holdout runner at all — "
            "the holdout is not being scored, which is a silent hole rather "
            "than a seal"
        )
        for call in sealed_calls:
            assert id(call) in bare_statements, (
                "a sealed-holdout call is no longer a bare expression "
                "statement — its return value is being used. `score()` "
                "returns None by construction; binding it is the leak this "
                "design exists to prevent."
            )

    def test_the_tuning_path_never_reads_the_sealed_output(self) -> None:
        """No read primitive ANYWHERE on the tuning side is sealed-derived.

        Scoped to the driver alone until 2026-08-20, which made the check
        evadable by not evading it: a new ``tests/memory_recall/audit.py``
        that read ``holdout-*.json`` and handed the suite back would never
        have been parsed, and the driver calling it is an ordinary function
        call with no sealed token in it. Every module on the tuning side is
        scanned now — see :func:`_tuning_path_sources` for the boundary and
        why ``holdout.py`` itself is the one exclusion.
        """
        scanned = _tuning_path_sources()
        assert _DRIVER.as_posix() in scanned, "the driver dropped out of the scan"
        assert len(scanned) > 1, (
            "only the driver was scanned — the cross-module resolution broke, "
            "and a reader in a sibling module would be invisible again"
        )
        for path, source in sorted(scanned.items()):
            violations = _sealed_read_violations(source)
            assert violations == [], (
                f"{path} reads from the sealed side: {violations}. The sealed "
                "directory is not on any read path the tuning side uses, and "
                "that is the whole property."
            )

    def test_the_sealed_read_detector_catches_an_indirection(self) -> None:
        """Positive control for the check above, and it is load-bearing.

        The driver contains no read primitive at all, so a clean verdict
        from :func:`_sealed_read_violations` over it is consistent with a
        detector that finds nothing ever. What the detector has to catch is
        the cheap evasion: bind the sealed directory to a name, then read
        through the name, so no read call's own source segment mentions the
        holdout. Each snippet below is that evasion at one more remove.

        **The four original snippets were all ``Assign`` chains**, so they
        confirmed only the arm that already worked. A reviewer ran ten
        evasions on 2026-08-20 and five went through — the five added below.
        Two of them are not evasions at all but ordinary refactors:
        extracting the positive control's own two lines into ``def
        _sealed_dir(): return Path(os.environ[SEALED_DIR_ENV])`` silently
        turned the detector clean, and so did a walrus.
        """
        snippets = {
            "direct": "json.loads(Path(sealed_directory() / 'x.json').read_text())",
            "one_hop": (
                "directory = Path(os.environ[SEALED_DIR_ENV])\n"
                "payload = json.loads((directory / 'x.json').read_text())\n"
            ),
            "two_hops": (
                "directory = Path(os.environ[SEALED_DIR_ENV])\n"
                "elsewhere = directory\n"
                "payload = json.loads((elsewhere / 'x.json').read_text())\n"
            ),
            "loop": (
                "directory = Path(os.environ[SEALED_DIR_ENV])\n"
                "for path in directory.iterdir():\n"
                "    payload = json.loads(path.read_text())\n"
            ),
            # Taint has to cross a function boundary: the return value makes
            # the FUNCTION NAME sealed-shaped. The name here is deliberately
            # NEUTRAL — `_sealed_dir` would match `_SEALED_TOKENS` on its own
            # segment and this snippet would pass without the return arm
            # working at all (it did, until the mutation run caught it).
            "function_return": (
                "def _destination():\n"
                "    return Path(os.environ[SEALED_DIR_ENV])\n"
                "payload = json.loads((_destination() / 'x.json').read_text())\n"
            ),
            "walrus": (
                "if (directory := Path(os.environ[SEALED_DIR_ENV])).exists():\n"
                "    payload = json.loads((directory / 'x.json').read_text())\n"
            ),
            "parameter_default": (
                "def _read(directory=Path(os.environ[SEALED_DIR_ENV])):\n"
                "    return (directory / 'x.json').read_text()\n"
            ),
            # ...and the read primitive itself can be renamed out of the
            # match list, which no amount of taint tracking would catch.
            "bound_method_alias": (
                "target = Path(os.environ[SEALED_DIR_ENV]) / 'x.json'\n"
                "reader = target.read_text\n"
                "payload = reader()\n"
            ),
            "partial_application": (
                "target = Path(os.environ[SEALED_DIR_ENV]) / 'x.json'\n"
                "opener = functools.partial(open, target)\n"
                "handle = opener()\n"
            ),
        }
        for label, snippet in snippets.items():
            assert _sealed_read_violations(snippet), (
                f"the sealed-read detector missed the {label} evasion — it is "
                "substring-matching one call's segment again, or taint stopped "
                "at a binding form it does not know, which is the hole this "
                "control exists to keep closed"
            )

        # ...and it does not simply flag every read: the tuning path's own
        # single legitimate read (the report) must stay clean, or the check
        # above would be passing for the wrong reason.
        assert (
            _sealed_read_violations(
                "report = json.loads(Path(os.environ[REPORT_PATH_ENV]).read_text())\n"
            )
            == []
        )

    def test_the_driver_imports_no_reader(self) -> None:
        """Allowlist the holdout symbols the tuning path may even name.

        ``SEALED_DIR_ENV`` used to sit in this allowlist although the driver
        does not import it. An unused entry is not free: it licences exactly
        the binding — ``Path(os.environ[SEALED_DIR_ENV])`` — that the
        sealed-read check has to work hardest to catch.

        **``import`` and ``from ... import`` both, since 2026-08-20.** This
        walked only ``ImportFrom``, so ``import tests.memory_recall.holdout
        as ho`` bound the whole module — every symbol in it, allowlisted or
        not — and the allowlist below saw an empty set to check.
        """
        tree = ast.parse(_driver_source())
        imported: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and (node.module or "").endswith(
                "memory_recall.holdout"
            ):
                imported |= {alias.name for alias in node.names}
            elif isinstance(node, ast.Import):
                whole_module = [
                    alias.name
                    for alias in node.names
                    if alias.name.endswith("memory_recall.holdout")
                ]
                assert not whole_module, (
                    f"the driver imports {whole_module} as a whole module. That "
                    "binds every symbol in it, allowlisted or not, and makes "
                    "the allowlist below vacuous — import the names it needs."
                )
        assert imported, "the driver stopped importing the holdout module"
        assert imported <= {
            "CaseSplit",
            "HoldoutObservation",
            "sealed_runner",
            "split_cases",
            "split_report",
            "split_report_violations",
        }, f"the driver imported an unexpected holdout symbol: {sorted(imported)}"

    def test_the_holdout_leg_guards_correction_seeding(self) -> None:
        """Both legs of ``_run_arm`` get their correction pair the same way.

        The train leg has always asserted that both halves of a pair were
        actually seeded — "would score a silent precedence fail". The
        sealed leg passed ``case.correction`` straight through with no such
        check, under a comment claiming "same arm, same client, same
        integrity checks". Two of the twelve correction cases are sealed by
        the current draw, so renaming a corrector key in ``cases.json``
        without updating ``records.json`` killed the train side loudly and
        wrote a silent ``False`` into ``holdout-*.json`` forever, where
        nothing reads it.

        Asserted as "there is ONE door", not as "there are two asserts":
        the guard is the door, so a leg that bypasses it is what fails here.
        """
        tree = ast.parse(_driver_source())
        run_arm = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == "_run_arm"
        ]
        assert len(run_arm) == 1, "the driver's per-arm runner was renamed"

        def _is_guarded(node: ast.AST) -> bool:
            """The guard call, or an explicit ``None``.

            ``correction=None`` says "this case has no pair" and is the
            honest value for a leg that does not seed one — it cannot
            smuggle an unverified pair through, because there is no pair.
            Without this arm a third leg added later with a literal
            ``correction=None`` fails a check it does not breach, and the
            cheapest way to make that green is to weaken the guard.
            """
            if _is_none(node):
                return True
            return (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "_seeded_correction"
            )

        corrections = [
            keyword
            for node in ast.walk(run_arm[0])
            if isinstance(node, ast.Call)
            for keyword in node.keywords
            if keyword.arg == "correction"
        ]
        assert len(corrections) >= 2, (
            "expected a correction on both the train leg (`score_case`) and "
            f"the sealed leg (`HoldoutObservation`); found {len(corrections)}"
        )
        for keyword in corrections:
            value = keyword.value
            assert _is_guarded(value) or (
                isinstance(value, ast.Name)
                and any(
                    isinstance(assign, ast.Assign)
                    and _is_guarded(assign.value)
                    and any(
                        isinstance(t, ast.Name) and t.id == value.id
                        for t in assign.targets
                    )
                    for assign in ast.walk(run_arm[0])
                )
            ), (
                "a leg of `_run_arm` builds a correction pair without going "
                "through `_seeded_correction`. On the sealed leg that is a "
                "silent precedence fail written into a file nothing reads."
            )

        # `_is_guarded` itself, on synthetic nodes — the two real legs are
        # both `_seeded_correction(...)` calls, so the loop above exercises
        # exactly one of its three answers. An explicit `correction=None`
        # says "this case has no pair" and cannot smuggle an unverified one
        # through; a third leg added later with that literal would otherwise
        # fail a check it does not breach, and the cheapest way to make that
        # green is to weaken the guard.
        assert _is_guarded(ast.parse("None", mode="eval").body)
        assert _is_guarded(
            ast.parse("_seeded_correction(case, seeded)", mode="eval").body
        )
        assert not _is_guarded(
            ast.parse("(case.corrector_key, case.corrected_key)", mode="eval").body
        )
        assert not _is_guarded(ast.parse("case.correction", mode="eval").body)

    def test_the_workflow_path_filter_covers_every_module_the_driver_imports(
        self,
    ) -> None:
        """A change that moves the numbers must be able to TRIGGER the job.

        ``memory-recall-eval.yml`` is ``paths:``-filtered, and the filter
        listed the harness's own files but not ``test_memory_api_db.py`` —
        from which the driver imports ``_SETUP_SQL`` (the corpus DDL) and
        ``HashingStubEmbedder``, whose ``_vec`` synthesises the query vector
        for both hybrid arms. Editing ``_vec`` moves every hybrid number and
        the entire paired comparison, and until 2026-08-19 that shipped with
        no eval run and no PR comment at all.

        **``app.`` imports too, since 2026-08-20.** This checked ``tests.``
        only — and the numbers come out of ``app/``. The four ``app.``
        imports were never checked at all, and one was already unmatched:
        ``from app.api.deps import get_async_db`` resolves to
        ``backend/app/api/deps.py``, which no pattern in the filter touched.
        That the other three DO match is prefix coincidence
        (``backend/app/services/memory_*``), not something the test defended.
        The stated rationale — "a change that moves the numbers must be able
        to TRIGGER the job" — points straight at ``app/``.
        """
        workflow = _WORKFLOW.read_text(encoding="utf-8")
        patterns = [
            line.strip().lstrip("- ").strip("'\"")
            for line in workflow.split("paths:", 1)[1]
            .split("workflow_dispatch")[0]
            .splitlines()
            if line.strip().startswith("- ")
        ]
        assert patterns, "the workflow no longer has a paths filter"

        repo_root = _WORKFLOW.parents[2]
        backend = Path("backend")
        tree = ast.parse(_driver_source())
        required: set[str] = set()
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom):
                continue
            module = node.module or ""
            if module.split(".")[0] not in {"tests", "app"}:
                continue
            base = backend / Path(*module.split("."))
            if (repo_root / base).is_dir():
                required |= {
                    (base / f"{alias.name}.py").as_posix() for alias in node.names
                }
            else:
                required.add(base.with_suffix(".py").as_posix())

        assert required, "the driver stopped importing the harness modules"
        for path in sorted(required):
            assert any(fnmatch(path, pattern) for pattern in patterns), (
                f"{path} is imported by the eval driver but no `paths:` entry in "
                "memory-recall-eval.yml matches it — a change there moves the "
                "reported numbers with no eval job and no PR comment"
            )

    def test_the_comment_step_reads_only_the_report(self) -> None:
        """The last link: the PR comment has no path to the sealed file."""
        workflow = _WORKFLOW.read_text(encoding="utf-8")
        parts = workflow.split("script: |", 1)
        assert len(parts) == 2, "the workflow no longer has a github-script body"
        body = parts[1]
        assert body.count("readFileSync") == 1, (
            "the comment step reads more than one file; the only file it may "
            "read is the eval report"
        )
        assert ho.SEALED_DIR_ENV not in body
        assert "recall-holdout" not in body


class TestPerComponentWiringMarker:
    """Verification item 9 — wiring is per component, and never a zero."""

    def test_every_component_starts_not_wired(self) -> None:
        ledger = WiringLedger(MEMORY_RECALL_COMPONENTS)
        assert ledger.not_wired == MEMORY_RECALL_COMPONENTS
        assert ledger.wired == ()

    def test_only_the_code_that_ran_promotes_a_component(self) -> None:
        ledger = WiringLedger(("alpha", "beta"))
        ledger.mark_wired("alpha", "ran")
        assert ledger.status("alpha") == WIRED
        assert ledger.status("beta") == NOT_WIRED
        assert ledger.is_wired("alpha") and not ledger.is_wired("beta")

    def test_a_mixed_run_reports_per_component_not_one_verdict(self) -> None:
        """The residual §3.3 item 5 asks for, stated as an assertion.

        One arm wired and one not must be readable AS such — the report
        carries a status per component and no whole-run verdict field that
        could flatten them back into one colour.
        """
        ledger = WiringLedger(MEMORY_RECALL_COMPONENTS)
        ledger.mark_wired("fts_only", "ran")
        ledger.mark_wired("paired", "ran")
        report = ledger.as_report()

        assert report["components"]["fts_only"]["status"] == WIRED
        assert report["components"]["hybrid"]["status"] == NOT_WIRED
        assert report["components"]["sealed_holdout"]["status"] == NOT_WIRED
        assert set(report["wired"]) == {"fts_only", "paired"}
        assert set(report["not_wired"]) == {"hybrid", "hybrid_link", "sealed_holdout"}
        # No whole-run verdict key: the block is exactly these four fields,
        # so nothing can collapse five components back into one colour.
        assert set(report) == {"components", "wired", "not_wired", "marker_semantics"}
        assert report["marker_semantics"] == MARKER_SEMANTICS

    def test_a_marker_can_never_be_read_as_a_zero(self) -> None:
        """The block contains no number at all — the whole point.

        ``not_wired`` means UNKNOWN; a measured zero is a float in an arm's
        row. Keeping the marker block string-only means the two cannot be
        confused by a renderer, a jq filter, or a reader skimming the JSON.
        Booleans are excluded too: ``False`` is one ``+`` away from ``0``.
        """
        ledger = WiringLedger(MEMORY_RECALL_COMPONENTS)
        ledger.mark_wired("hybrid", "ran over 41 train case(s)")
        found = _leaves(ledger.as_report())
        assert found, "the wiring block is empty"
        assert all(isinstance(leaf, str) for leaf in found), (
            "the wiring block grew a non-string leaf: "
            f"{[leaf for leaf in found if not isinstance(leaf, str)]}. A number "
            "here can be read as a measurement, which is exactly what a "
            "not_wired component does NOT have."
        )

    def test_an_undeclared_component_is_a_hard_error(self) -> None:
        """A typo must not invent a lookalike that claims to be wired."""
        ledger = WiringLedger(("alpha",))
        with pytest.raises(KeyError, match="undeclared component"):
            ledger.mark_wired("alhpa")
        assert ledger.status("alpha") == NOT_WIRED

    def test_duplicate_and_empty_declarations_are_rejected(self) -> None:
        with pytest.raises(ValueError, match="duplicate"):
            WiringLedger(("alpha", "alpha"))
        with pytest.raises(ValueError, match="marks nothing"):
            WiringLedger(())

    def test_the_driver_marks_every_declared_component(self) -> None:
        """All five the plan names are promoted, and this says so WITHOUT a DB.

        The previous version of this test looked for the two literal
        ``mark_wired("paired" | "sealed_holdout", ...)`` calls and stopped
        there, because the three arms are marked through ``_run_arm``'s
        ``arm`` parameter rather than a literal. Deleting
        ``wiring.mark_wired(arm, ...)`` outright left it green — only the
        Postgres-gated ``report["wiring"]["not_wired"] == []`` caught that,
        which means it went uncaught everywhere Postgres is absent, i.e.
        every local run and every non-eval CI job.

        So the arm marking is now read the way it is actually written: a
        ``mark_wired`` call taking ``_run_arm``'s own ``arm`` parameter,
        plus the ``arm=`` literals at the REPORTED call sites (the ones
        that pass a ledger). Their union has to be the declared set.
        """
        tree = ast.parse(_driver_source())

        literal_marks = {
            str(node.args[0].value)
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "mark_wired"
            and node.args
            and isinstance(node.args[0], ast.Constant)
        }

        run_arm = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == "_run_arm"
        ]
        assert len(run_arm) == 1, "the driver's per-arm runner was renamed"
        marks_its_arm = [
            node
            for node in ast.walk(run_arm[0])
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "mark_wired"
            and node.args
            and isinstance(node.args[0], ast.Name)
            and node.args[0].id == "arm"
        ]
        assert marks_its_arm, (
            "`_run_arm` no longer promotes the arm it ran. Every reported arm "
            "would sit at `not_wired` in a complete run — a marker claiming "
            "the instrumentation never executed when it did."
        )

        reported_arms = {
            keyword.value.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "_run_arm"
            and any(
                kw.arg == "wiring" and not _is_none(kw.value) for kw in node.keywords
            )
            for keyword in node.keywords
            if keyword.arg == "arm" and isinstance(keyword.value, ast.Constant)
        }
        assert literal_marks | reported_arms == set(MEMORY_RECALL_COMPONENTS), (
            "the components the driver actually promotes are no longer the "
            f"declared set: {sorted(literal_marks | reported_arms)} vs "
            f"{sorted(MEMORY_RECALL_COMPONENTS)}"
        )
