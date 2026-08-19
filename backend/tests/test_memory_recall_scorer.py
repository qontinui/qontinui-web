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

import json
import math

import pytest

from tests.memory_recall import fixtures as fx
from tests.memory_recall.scorer import (
    CREDIT_Z_THRESHOLD,
    LOWER_IS_BETTER_METRICS,
    CaseScore,
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

    def test_the_cost_metrics_are_flagged_as_lower_is_better(self) -> None:
        # `promoted` is literally candidate > control, so the two
        # cost-shaped metrics need their direction reported, not assumed.
        assert "noise_rate_at_10" in LOWER_IS_BETTER_METRICS
        assert "token_cost_at_10" in LOWER_IS_BETTER_METRICS
        assert "recall_at_10" not in LOWER_IS_BETTER_METRICS

        noisier = paired_delta(
            [_case("a", noise_rate_at_10=0.1), _case("b", noise_rate_at_10=0.1)],
            [_case("a", noise_rate_at_10=0.5), _case("b", noise_rate_at_10=0.3)],
            metric="noise_rate_at_10",
        )
        # Higher noise. `promoted` says "scored higher", which on this
        # metric is worse — the flag above is what tells a reader so.
        assert noisier.promoted is True
        assert noisier.metric in LOWER_IS_BETTER_METRICS


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
