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

    @property
    def correction_precedence_rate(self) -> float:
        """Share of correction pairs whose corrector outranked its target."""
        if self.correction_pairs == 0:
            return 0.0
        return self.correction_precedence_passes / self.correction_pairs


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


def aggregate(arm: str, vector_arm: str, scores: Sequence[CaseScore]) -> SuiteScore:
    """Mean each metric across cases; sum the costs; count the pass/fail pairs.

    Unweighted means — every case counts once regardless of how many
    relevant records it has. A weighted mean would let one heavily-labelled
    case dominate the headline, and the set is curated precisely so that
    each case represents one retrieval situation worth an equal vote.
    """
    n = len(scores)
    if n == 0:
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
        )
    pairs = [s for s in scores if s.correction_precedence is not None]
    return SuiteScore(
        arm=arm,
        vector_arm=vector_arm,
        case_count=n,
        recall_at_5=sum(s.recall_at_5 for s in scores) / n,
        recall_at_10=sum(s.recall_at_10 for s in scores) / n,
        recall_at_20=sum(s.recall_at_20 for s in scores) / n,
        mrr=sum(s.reciprocal_rank for s in scores) / n,
        ndcg_at_10=sum(s.ndcg_at_10 for s in scores) / n,
        noise_rate_at_10=sum(s.noise_rate_at_10 for s in scores) / n,
        total_token_cost_at_10=sum(s.token_cost_at_10 for s in scores),
        correction_pairs=len(pairs),
        correction_precedence_passes=sum(1 for s in pairs if s.correction_precedence),
    )
