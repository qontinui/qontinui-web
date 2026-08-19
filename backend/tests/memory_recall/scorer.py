"""Ranking metrics for the memory-recall golden set.

Pure arithmetic over ranked id lists — no database, no HTTP, no model.
Every function here is deterministic and total: given the same ranking and
the same judgements it returns the same number on every machine, which is
what makes a committed baseline (§3 Phase 2 of the plan) something a later
run can actually be regressed against.

Vocabulary used throughout:

``ranked``
    The ids the retrieval system returned, best-first. Duplicates are not
    expected; if present they are scored as-is rather than silently
    de-duplicated, because a ranker that returns the same record twice has
    a bug the harness should surface rather than hide.
``relevant``
    The ids a judge marked relevant for the query. Order is irrelevant.

Binary relevance only. The golden set records a yes/no judgement per
(query, record) pair, so graded-relevance nDCG would be reporting
precision the labels do not carry.

Beyond the per-case metrics this module also carries the two-arm
comparison primitives added by plan
``2026-08-11-coord-ambient-recall-and-efficacy-statistical-rigor`` §3.3:
:func:`paired_delta` (paired differences on the SAME cases, so
between-case difficulty cancels) and the explicit denominator
:func:`aggregate` now demands. Both are pure ``math`` — no scipy, no
numpy — precisely so the "same number on every machine" promise above
keeps holding for the significance label too.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass


def recall_at_k(ranked: Sequence[str], relevant: Iterable[str], k: int) -> float:
    """Fraction of the relevant records that appear in the top ``k``.

    The headline metric: did the right record come back at all? Returns
    ``0.0`` for a query with no relevant records, which cannot occur in a
    validated fixture (:func:`tests.memory_recall.fixtures.load_golden_set`
    rejects it) but keeps the function total.
    """
    relevant_set = set(relevant)
    if not relevant_set:
        return 0.0
    hits = sum(1 for mid in ranked[:k] if mid in relevant_set)
    return hits / len(relevant_set)


def reciprocal_rank(ranked: Sequence[str], relevant: Iterable[str]) -> float:
    """``1 / rank`` of the FIRST relevant record (1-based), else ``0.0``.

    Averaged over the case set this is MRR. It answers "did it come back
    *high*" in the cheapest possible way: only the best-placed relevant
    record counts, so a ranker cannot buy a good score by burying extra
    correct answers deep in the list.
    """
    relevant_set = set(relevant)
    for position, mid in enumerate(ranked, start=1):
        if mid in relevant_set:
            return 1.0 / position
    return 0.0


def dcg_at_k(ranked: Sequence[str], relevant: Iterable[str], k: int) -> float:
    """Discounted cumulative gain over binary relevance.

    ``Σ 1 / log2(position + 1)`` over relevant hits in the top ``k``,
    1-based positions — so a hit at position 1 contributes exactly 1.0.
    """
    relevant_set = set(relevant)
    return sum(
        1.0 / math.log2(position + 1)
        for position, mid in enumerate(ranked[:k], start=1)
        if mid in relevant_set
    )


def ndcg_at_k(ranked: Sequence[str], relevant: Iterable[str], k: int) -> float:
    """:func:`dcg_at_k` normalized by the best achievable DCG for this query.

    The ideal ranking puts every relevant record first, so the ideal DCG
    depends on ``min(len(relevant), k)`` and nothing else. Returns ``0.0``
    when there is nothing to find.
    """
    relevant_set = set(relevant)
    ideal_hits = min(len(relevant_set), k)
    if ideal_hits == 0:
        return 0.0
    ideal = sum(1.0 / math.log2(position + 1) for position in range(1, ideal_hits + 1))
    return dcg_at_k(ranked, relevant_set, k) / ideal


def noise_rate(ranked: Sequence[str], relevant: Iterable[str], k: int) -> float:
    """Fraction of the returned top ``k`` that no judge marked relevant.

    The counterweight to recall. An arm that widens its net — link
    expansion, aggressive query rewriting — buys recall with noise, and a
    harness that reports only recall would call that a pure win. Measured
    against what was actually RETURNED (``len(ranked[:k])``), not against
    ``k``, so a query that legitimately returns 3 records is not penalised
    for the 7 it did not invent.
    """
    window = ranked[:k]
    if not window:
        return 0.0
    relevant_set = set(relevant)
    return sum(1 for mid in window if mid not in relevant_set) / len(window)


def token_cost(ranked: Sequence[str], content_bytes: Mapping[str, int], k: int) -> int:
    """Total content bytes of the top ``k`` — recall's price.

    Recall bought with an unbounded context budget is not a win, so every
    recall number is reported next to what it cost to deliver. Bytes, not
    tokens: the harness has no tokenizer and inventing one would make the
    number model-specific and non-deterministic. Unknown ids contribute 0.
    """
    return sum(content_bytes.get(mid, 0) for mid in ranked[:k])


def correction_precedence(
    ranked: Sequence[str], corrector: str, corrected: str
) -> bool:
    """Does the correcting record outrank the record it corrects?

    Binary and unambiguous — the highest-value assertion in the set,
    because a memory store that surfaces a superseded fact above its own
    correction is actively harmful rather than merely unhelpful.

    Three cases:

    * corrector absent from the ranking → ``False``. The correction was
      not retrieved at all, which is the worst outcome and must not be
      scored as a pass just because the stale record was also missing.
    * corrector present, corrected absent → ``True``. Only the correction
      came back; precedence is trivially satisfied.
    * both present → ``True`` iff the corrector ranks strictly higher.
    """
    try:
        corrector_rank = ranked.index(corrector)
    except ValueError:
        return False
    try:
        corrected_rank = ranked.index(corrected)
    except ValueError:
        return True
    return corrector_rank < corrected_rank


@dataclass(frozen=True)
class CaseScore:
    """Every metric for a single query, at the k values the plan names."""

    case_id: str
    case_class: str
    recall_at_5: float
    recall_at_10: float
    recall_at_20: float
    reciprocal_rank: float
    ndcg_at_10: float
    noise_rate_at_10: float
    token_cost_at_10: int
    # ``None`` when the case carries no correction pair — distinct from
    # ``False`` (a pair that FAILED), which a bare bool would conflate.
    correction_precedence: bool | None


@dataclass(frozen=True)
class SuiteScore:
    """Aggregate over a case set, plus the arm the numbers were produced under.

    ``vector_arm`` is carried as data rather than assumed, because the
    query endpoint decides at request time whether the semantic arm ran
    (see the plan's §2.1a). A suite score that does not name its arm is
    not interpretable.
    """

    arm: str
    vector_arm: str
    #: The DENOMINATOR every mean below was divided by — the size of the
    #: case set the arm was asked to run, not the number of ``CaseScore``
    #: objects that came back. The two differ only when cases went
    #: missing, and that gap is reported in :attr:`missing_cases` rather
    #: than absorbed into a smaller denominator.
    case_count: int
    recall_at_5: float
    recall_at_10: float
    recall_at_20: float
    mrr: float
    ndcg_at_10: float
    noise_rate_at_10: float
    total_token_cost_at_10: int
    correction_pairs: int
    correction_precedence_passes: int
    #: Cases in the set that produced no ``CaseScore``. Each contributed
    #: ``0.0`` to every mean above — never dropped from the denominator.
    #: A non-zero value here means the headline numbers are a floor, and
    #: it is REPORTED rather than folded into a pass/fail, exactly as
    #: :attr:`vector_arm` is.
    missing_cases: int = 0

    @property
    def correction_precedence_rate(self) -> float:
        """Share of correction pairs whose corrector outranked its target."""
        if self.correction_pairs == 0:
            return 0.0
        return self.correction_precedence_passes / self.correction_pairs

    @property
    def scored_cases(self) -> int:
        """Cases that actually produced a score. ``case_count`` is the divisor."""
        return self.case_count - self.missing_cases


def score_case(
    case_id: str,
    case_class: str,
    ranked: Sequence[str],
    relevant: Iterable[str],
    content_bytes: Mapping[str, int],
    correction: tuple[str, str] | None = None,
) -> CaseScore:
    """Every metric for one query. ``correction`` is ``(corrector, corrected)``."""
    relevant_set = set(relevant)
    return CaseScore(
        case_id=case_id,
        case_class=case_class,
        recall_at_5=recall_at_k(ranked, relevant_set, 5),
        recall_at_10=recall_at_k(ranked, relevant_set, 10),
        recall_at_20=recall_at_k(ranked, relevant_set, 20),
        reciprocal_rank=reciprocal_rank(ranked, relevant_set),
        ndcg_at_10=ndcg_at_k(ranked, relevant_set, 10),
        noise_rate_at_10=noise_rate(ranked, relevant_set, 10),
        token_cost_at_10=token_cost(ranked, content_bytes, 10),
        correction_precedence=(
            None
            if correction is None
            else correction_precedence(ranked, correction[0], correction[1])
        ),
    )


def aggregate(
    arm: str,
    vector_arm: str,
    scores: Sequence[CaseScore],
    *,
    case_count: int,
) -> SuiteScore:
    """Mean each metric across cases; sum the costs; count the pass/fail pairs.

    Unweighted means — every case counts once regardless of how many
    relevant records it has. A weighted mean would let one heavily-labelled
    case dominate the headline, and the set is curated precisely so that
    each case represents one retrieval situation worth an equal vote.

    **``case_count`` is the denominator and it is REQUIRED.** It is the size
    of the case set the arm was asked to run — ``len(golden.cases)`` at
    every real call site — not ``len(scores)``. Deriving it from the list
    would mean a case that failed, timed out, or was quietly tolerated
    shrinks the divisor and *raises* the reported mean: the fair-subset
    extrapolation trap. Here a missing case contributes ``0.0`` to every
    mean and is counted in :attr:`SuiteScore.missing_cases`, so tolerance
    cannot be added later without the score visibly dropping.

    Today the DB harness has no per-case tolerance at all — a failing case
    raises and kills the arm — which is strictly louder than retain-at-zero
    and must stay that way. This parameter exists so the *next* change
    cannot silently weaken it.

    Raises:
        ValueError: if ``case_count`` is negative, or is smaller than the
            number of scores handed in (a denominator below the data is a
            bug in the caller, never a tolerable rounding).
    """
    n = len(scores)
    if case_count < 0:
        raise ValueError(f"case_count must not be negative, got {case_count}")
    if case_count < n:
        raise ValueError(
            f"case_count={case_count} is smaller than the {n} scores handed in — "
            "a denominator below the data would inflate every mean"
        )
    if case_count == 0:
        return SuiteScore(
            arm=arm,
            vector_arm=vector_arm,
            case_count=0,
            recall_at_5=0.0,
            recall_at_10=0.0,
            recall_at_20=0.0,
            mrr=0.0,
            ndcg_at_10=0.0,
            noise_rate_at_10=0.0,
            total_token_cost_at_10=0,
            correction_pairs=0,
            correction_precedence_passes=0,
            missing_cases=0,
        )
    pairs = [s for s in scores if s.correction_precedence is not None]
    return SuiteScore(
        arm=arm,
        vector_arm=vector_arm,
        case_count=case_count,
        recall_at_5=sum(s.recall_at_5 for s in scores) / case_count,
        recall_at_10=sum(s.recall_at_10 for s in scores) / case_count,
        recall_at_20=sum(s.recall_at_20 for s in scores) / case_count,
        mrr=sum(s.reciprocal_rank for s in scores) / case_count,
        ndcg_at_10=sum(s.ndcg_at_10 for s in scores) / case_count,
        noise_rate_at_10=sum(s.noise_rate_at_10 for s in scores) / case_count,
        total_token_cost_at_10=sum(s.token_cost_at_10 for s in scores),
        correction_pairs=len(pairs),
        correction_precedence_passes=sum(1 for s in pairs if s.correction_precedence),
        missing_cases=case_count - n,
    )


#: Metric names :func:`paired_delta` accepts, mapped to the :class:`CaseScore`
#: attribute they read. ``mrr`` is the suite-level name for the per-case
#: ``reciprocal_rank``; both spellings are accepted so a caller can name the
#: metric the way the report renders it.
#:
#: The key is a module-level constant, never caller- or model-derived, so an
#: unknown metric is a loud ``KeyError``-shaped failure rather than a silently
#: skipped comparison.
_PAIRED_METRICS: Mapping[str, str] = {
    "recall_at_5": "recall_at_5",
    "recall_at_10": "recall_at_10",
    "recall_at_20": "recall_at_20",
    "reciprocal_rank": "reciprocal_rank",
    "mrr": "reciprocal_rank",
    "ndcg_at_10": "ndcg_at_10",
    "noise_rate_at_10": "noise_rate_at_10",
    "token_cost_at_10": "token_cost_at_10",
}

#: Metrics where a HIGHER mean is WORSE — recall's price, not its reward.
#: :attr:`PairedResult.promoted` is a literal ``candidate > control``, so on
#: these two it reads "scored higher", which is the opposite of "better".
LOWER_IS_BETTER_METRICS: frozenset[str] = frozenset(
    {"noise_rate_at_10", "token_cost_at_10"}
)

#: The z at or above which a lift is LABELLED significant. A label, never a
#: gate — see :class:`PairedResult`.
CREDIT_Z_THRESHOLD: float = 2.0

#: Tolerance below which the per-case differences count as IDENTICAL, i.e.
#: as zero observed variance.
#:
#: An exact ``se == 0.0`` guard is the obvious spelling and it is wrong.
#: Every metric here is a quotient, so two arithmetically equal differences
#: routinely differ in their last bits — ``0.3 - 0.2`` and ``0.2 - 0.1`` are
#: not the same double. A perfectly uniform +0.1 lift over three cases
#: measured that way yields ``se = 1.9e-17`` and therefore
#: ``z = 5.3e15``: an "overwhelmingly significant" result assembled
#: entirely out of rounding noise, which is a far worse failure than the
#: ZeroDivisionError the exact guard was written to avoid. Anything inside
#: this tolerance is reported as zero variance and routed through the
#: signed-infinity branch instead.
ZERO_VARIANCE_TOL: float = 1e-12


@dataclass(frozen=True)
class PairedResult:
    """A paired comparison of two arms over the SAME cases.

    Pairing is the whole point: between-case difficulty cancels, so the
    variance being tested is the variance of the *difference*, not the
    variance of the case set. An unpaired comparison of two arms over a
    few dozen heterogeneous queries is dominated by which queries are hard.

    **``promoted`` and ``credited_2sigma`` are deliberately separate and
    must never be collapsed into one boolean.** ``promoted`` is what banks
    — the candidate scored higher on the mean, full stop. ``credited_2sigma``
    is a reported label saying the lift also cleared
    :data:`CREDIT_Z_THRESHOLD`. A candidate that banks +6.4pp at z=1.71 is
    ``promoted=True, credited_2sigma=False``: a legitimate, expected,
    entirely non-erroneous outcome — permissive bank, honest label. This
    mirrors how :attr:`SuiteScore.vector_arm` is carried as reported data
    rather than folded into a pass/fail.

    ``promoted`` is literally ``candidate_mean > control_mean``. For the
    metrics in :data:`LOWER_IS_BETTER_METRICS` a higher mean is worse, so
    there it means "scored higher", not "did better" — read the metric name
    before reading the flag.
    """

    #: The metric name as the CALLER spelled it (``mrr`` stays ``mrr``).
    metric: str
    #: Number of paired cases — the denominator of every number below.
    n: int
    control_mean: float
    candidate_mean: float
    #: ``candidate_mean - control_mean``, equivalently the mean of the
    #: per-case differences (identical by construction, since the cases pair
    #: one-to-one).
    mean_lift: float
    #: SAMPLE standard deviation (``ddof=1``) of the per-case differences.
    sd: float
    #: ``sd / sqrt(n)`` — the standard error of :attr:`mean_lift`.
    se: float
    #: ``mean_lift / se``. Exactly ``0.0`` when the arms are identical, and
    #: signed ``inf`` for a perfectly uniform non-zero lift (se == 0 with a
    #: non-zero mean is not "insignificant" — it is a lift with no observed
    #: variance at all). Never ``None``, which would read as "not
    #: significant" when it actually means "not computed".
    z: float
    #: What banks: ``candidate_mean > control_mean``.
    promoted: bool
    #: A reported LABEL: ``z >= CREDIT_Z_THRESHOLD``. Never a gate.
    credited_2sigma: bool
    #: ``n < 2``, so no sample sd exists. :attr:`sd`, :attr:`se` and
    #: :attr:`z` are ``0.0`` placeholders in that case — stated explicitly
    #: rather than invented.
    insufficient_n: bool

    @property
    def z_is_infinite(self) -> bool:
        """True when the lift is uniform and non-zero (``se == 0``)."""
        return math.isinf(self.z)

    @property
    def z_display(self) -> str:
        """A JSON/markdown-safe rendering of :attr:`z`.

        ``json.dumps`` emits a bare ``Infinity`` for an infinite float,
        which is not valid JSON and blows up every standards-conforming
        parser — including the CI comment renderer. Report through this.
        """
        if self.insufficient_n:
            return "n/a"
        if math.isinf(self.z):
            return "+inf" if self.z > 0 else "-inf"
        return f"{self.z:.4f}"


def _metric_values(scores: Sequence[CaseScore], attribute: str) -> dict[str, float]:
    """``case_id -> metric value``, rejecting a duplicated ``case_id``.

    A repeated id makes the pairing ambiguous — which of the two rows is
    the partner? — so it is a hard error rather than a last-one-wins.
    """
    out: dict[str, float] = {}
    for score in scores:
        if score.case_id in out:
            raise ValueError(
                f"case_id {score.case_id!r} appears more than once in an arm — "
                "pairing is ambiguous"
            )
        out[score.case_id] = float(getattr(score, attribute))
    return out


def paired_delta(
    control: Sequence[CaseScore],
    candidate: Sequence[CaseScore],
    *,
    metric: str,
) -> PairedResult:
    """Paired difference of ``candidate - control`` on one metric.

    Cases are matched strictly by :attr:`CaseScore.case_id`. **A case
    present in one arm and not the other is a hard error**, never a silent
    drop: the entire justification for a paired test is that between-case
    difficulty cancels, and it only cancels if both arms ran the same
    cases. Dropping the odd one out would quietly turn this into an
    unpaired comparison wearing a paired label.

    Differences are taken in the control arm's own iteration order, so the
    result is bit-identical across runs and machines.

    Raises:
        KeyError: ``metric`` is not one of :data:`_PAIRED_METRICS`.
        ValueError: an arm repeats a ``case_id``, or the two arms do not
            cover exactly the same case set.
    """
    try:
        attribute = _PAIRED_METRICS[metric]
    except KeyError:
        raise KeyError(
            f"unknown paired metric {metric!r}; "
            f"expected one of {sorted(_PAIRED_METRICS)}"
        ) from None

    control_values = _metric_values(control, attribute)
    candidate_values = _metric_values(candidate, attribute)

    only_control = sorted(set(control_values) - set(candidate_values))
    only_candidate = sorted(set(candidate_values) - set(control_values))
    if only_control or only_candidate:
        raise ValueError(
            "paired comparison requires identical case sets; "
            f"control-only={only_control} candidate-only={only_candidate}. "
            "Dropping the unmatched cases would silently make this an "
            "unpaired comparison."
        )

    differences = [
        candidate_values[cid] - control_values[cid] for cid in control_values
    ]
    n = len(differences)

    if n == 0:
        return PairedResult(
            metric=metric,
            n=0,
            control_mean=0.0,
            candidate_mean=0.0,
            mean_lift=0.0,
            sd=0.0,
            se=0.0,
            z=0.0,
            promoted=False,
            credited_2sigma=False,
            insufficient_n=True,
        )

    control_mean = sum(control_values.values()) / n
    candidate_mean = sum(candidate_values.values()) / n
    mean_lift = sum(differences) / n
    promoted = candidate_mean > control_mean

    if n < 2:
        # No sample standard deviation exists for a single observation.
        # Report that fact rather than inventing a number for it.
        return PairedResult(
            metric=metric,
            n=n,
            control_mean=control_mean,
            candidate_mean=candidate_mean,
            mean_lift=mean_lift,
            sd=0.0,
            se=0.0,
            z=0.0,
            promoted=promoted,
            credited_2sigma=False,
            insufficient_n=True,
        )

    # Zero variance is decided on a TOLERANCE, not on `se == 0.0` — see
    # ZERO_VARIANCE_TOL for why the exact test produces z ~ 5e15 out of
    # pure float noise.
    tolerance = ZERO_VARIANCE_TOL * max(1.0, max(abs(d) for d in differences))
    if all(abs(d - mean_lift) <= tolerance for d in differences):
        # Every case moved by the same amount. Identical arms give a
        # genuine 0; a uniform non-zero lift has no observed variance at
        # all, which is the strongest signal this test can express —
        # signed infinity, never a ZeroDivisionError and never a None that
        # would be read as "not significant". sd/se are reported as 0.0
        # rather than as their sub-picoscale rounding residue, which is
        # the honest statement: no distinguishable variance.
        sd = 0.0
        se = 0.0
        z = 0.0 if abs(mean_lift) <= tolerance else math.copysign(math.inf, mean_lift)
    else:
        variance = sum((d - mean_lift) ** 2 for d in differences) / (n - 1)
        sd = math.sqrt(variance)
        se = sd / math.sqrt(n)
        z = mean_lift / se

    return PairedResult(
        metric=metric,
        n=n,
        control_mean=control_mean,
        candidate_mean=candidate_mean,
        mean_lift=mean_lift,
        sd=sd,
        se=se,
        z=z,
        promoted=promoted,
        credited_2sigma=z >= CREDIT_Z_THRESHOLD,
        insufficient_n=False,
    )
