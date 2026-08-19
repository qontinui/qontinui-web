"""Train/holdout split, and a holdout scorer whose numbers cannot come back.

Plan ``2026-08-11-coord-ambient-recall-and-efficacy-statistical-rigor``
§3.3 item 4 — *"a case subset the scorer writes but the tuning path cannot
read. Enforced by construction (write-only directory), not by rule."* The
upstream this borrows from (`EverMind-AI/Raven`, `raven/evolver/`) states
the principle as *"the train/test firewall as a mechanism, not a rule…
Historically this was enforced by discipline. Here it's enforced by
construction"*, and implements it as a runner that writes to a directory
the driver never reads and **returns nothing**.

**Read this before trusting the word "sealed".**

The golden set is a COMMITTED fixture (``tests/fixtures/memory_golden/``)
and :func:`split_cases` is deterministic, published right here, and
reproducible from the tree alone. So anybody reading this repository can
work out exactly which cases are in the holdout, and could re-score them
by hand in five lines. **The cases are not secret and this module never
pretends they are.** What is sealed is the *return path* of the holdout
SCORES:

* :meth:`SealedHoldoutRunner.score` computes them, writes them, and
  returns ``None`` — there is no value to wire anywhere.
* The runner's ``__slots__`` leave physically nowhere to stash a result,
  so a later "just keep the last suite around" is an ``AttributeError``
  rather than a quiet leak.
* The class exposes exactly one public callable, ``score``. No reader, no
  ``last_result``, no ``load()``. The module exposes no reader either
  (:data:`PUBLIC_CALLABLES` pins that, and the pure test suite asserts it).
* The destination is a directory of its own, named by
  :data:`SEALED_DIR_ENV`, which the driver never opens. The tuning path
  reads exactly one file — the report at ``MEMORY_RECALL_EVAL_REPORT`` —
  and no holdout number is ever written into it.

Together those make the honest claim: **no holdout score reaches a gate, a
verdict, the emitted report, or the PR comment through any code path this
harness provides.** That is a mechanism against wiring it up by accident
or by drift, which is the failure this exists to prevent. It is not a
claim that the number is unknowable to a determined reader — with a
committed fixture it never could be, and a name that implied otherwise
would be overclaiming.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from tests.memory_recall.scorer import CaseScore, aggregate, score_case

#: Environment variable naming the directory the holdout scores are written
#: to. Deliberately NOT ``MEMORY_RECALL_EVAL_REPORT``: the report path is
#: what the CI comment step reads, and the whole point is that these two
#: destinations never coincide.
SEALED_DIR_ENV = "MEMORY_RECALL_HOLDOUT_DIR"

#: Salt for the split hash. Bump it to REDRAW the split — which invalidates
#: every holdout number recorded under the old draw, so bump it deliberately
#: and say so in the commit, never as a drive-by.
SPLIT_VERSION = "v1"

#: One case in every ``HOLDOUT_EVERY`` goes to the holdout, counted WITHIN
#: each case class (see :func:`split_cases` for why the stratification is
#: not optional).
HOLDOUT_EVERY = 5

#: Every public class and function this module defines. Pinned as data so
#: that adding a reader — ``load_holdout``, ``read_scores``, anything that
#: could hand a holdout number back — fails the structural test in
#: ``test_memory_recall_scorer.py`` instead of silently opening a path to
#: the tuning side. Constants are not listed: a ``str`` cannot return a
#: score.
PUBLIC_CALLABLES: frozenset[str] = frozenset(
    {
        "CaseSplit",
        "HoldoutObservation",
        "SealedHoldoutRunner",
        "sealed_directory",
        "sealed_runner",
        "split_cases",
        "split_key",
        "split_report",
    }
)


@dataclass(frozen=True)
class CaseSplit:
    """Which case ids are scored into the report, and which are sealed.

    Both tuples are in the caller's input order (i.e. the committed
    fixture's order), so the split is not merely deterministic but
    readable next to ``cases.json``.
    """

    train: tuple[str, ...]
    holdout: tuple[str, ...]

    @property
    def train_count(self) -> int:
        """The DENOMINATOR the reported arms must aggregate over."""
        return len(self.train)

    @property
    def holdout_count(self) -> int:
        return len(self.holdout)

    @property
    def train_set(self) -> frozenset[str]:
        return frozenset(self.train)

    @property
    def holdout_set(self) -> frozenset[str]:
        return frozenset(self.holdout)

    def is_holdout(self, case_id: str) -> bool:
        return case_id in self.holdout_set


def split_key(case_id: str) -> str:
    """Stable per-case hash. ``sha256``, never :func:`hash`.

    Python's built-in ``hash`` is salted per process (PYTHONHASHSEED), so a
    split built on it would differ between two runs on the SAME machine —
    the one thing a train/test split may never do. ``sha256`` of
    ``"<SPLIT_VERSION>:<case_id>"`` is identical on every machine, every
    interpreter and every run, which is the same determinism promise
    ``scorer.py`` makes for its metrics.
    """
    return hashlib.sha256(f"{SPLIT_VERSION}:{case_id}".encode()).hexdigest()


def split_cases(cases: Sequence[tuple[str, str]]) -> CaseSplit:
    """Split ``(case_id, case_class)`` pairs into train and holdout.

    **Stratified by case class, and that is load-bearing rather than
    tidy.** The golden set's classes are small (8 recency-conflict cases,
    10 vocabulary-mismatch) and several assertions in the DB harness are
    per-class — "the hardest classes are where FTS fails" needs hard-class
    cases to still be on the train side. An unstratified draw can empty a
    class into the holdout and turn those into vacuous passes over an
    empty list.

    Within each class the cases are ordered by :func:`split_key` and every
    ``HOLDOUT_EVERY``-th one (1-based) is sealed. A class with fewer than
    ``HOLDOUT_EVERY`` cases therefore contributes NOTHING to the holdout,
    which is the conservative direction: a small class stays wholly
    measurable rather than being half-sealed.

    Raises:
        ValueError: a ``case_id`` appears more than once — which case
            would be on which side is then undefined, and a split that is
            not a partition is not a split.
    """
    seen: set[str] = set()
    by_class: dict[str, list[str]] = defaultdict(list)
    for case_id, case_class in cases:
        if case_id in seen:
            raise ValueError(
                f"case_id {case_id!r} appears more than once — a train/holdout "
                "split must be a partition of distinct cases"
            )
        seen.add(case_id)
        by_class[case_class].append(case_id)

    holdout: set[str] = set()
    for class_cases in by_class.values():
        ordered = sorted(class_cases, key=lambda cid: (split_key(cid), cid))
        holdout.update(
            cid
            for position, cid in enumerate(ordered, start=1)
            if position % HOLDOUT_EVERY == 0
        )

    return CaseSplit(
        train=tuple(cid for cid, _ in cases if cid not in holdout),
        holdout=tuple(cid for cid, _ in cases if cid in holdout),
    )


def split_report(split: CaseSplit) -> dict[str, object]:
    """The ONLY holdout-derived block the emitted report is allowed to carry.

    Counts, ids and the algorithm — **never a score**. The invariant is
    mechanical and asserted in the pure test suite: *every leaf of this
    dict is a string or an int-valued count; no float appears anywhere*.
    Every metric this harness produces is a float, so a float here would
    be the first visible symptom of a holdout number leaking into the
    report, and the assertion fires before a human ever reads it.

    The case ids are included on purpose. They are already derivable from
    the committed fixture plus :func:`split_cases`, so withholding them
    would buy no secrecy at all and would only stop a reader checking that
    the split is the stratified one it claims to be.
    """
    return {
        "algorithm": (
            f"sha256({SPLIT_VERSION}:case_id), stratified by case_class, "
            f"1 in {HOLDOUT_EVERY} per class"
        ),
        "train_cases": split.train_count,
        "holdout_cases": split.holdout_count,
        "holdout_case_ids": list(split.holdout),
        "sealed_dir_env": SEALED_DIR_ENV,
        "note": (
            "The holdout CASES are committed and visible; only the holdout "
            "SCORES are sealed. They are written to the directory named by "
            "sealed_dir_env and never enter this report."
        ),
    }


@dataclass(frozen=True)
class HoldoutObservation:
    """One holdout case as OBSERVED — a ranking, never a score.

    This is what the driver is allowed to hold: what the retrieval system
    returned. Turning it into a number is :meth:`SealedHoldoutRunner.score`'s
    job, and that number never comes back.
    """

    case_id: str
    case_class: str
    ranked: tuple[str, ...]
    relevant: tuple[str, ...]
    #: ``(corrector_key, corrected_key)`` for a correction pair, else None.
    correction: tuple[str, str] | None = None


class SealedHoldoutRunner:
    """Scores holdout cases, writes them out, and returns nothing.

    ``__slots__`` is the mechanism, not decoration: the instance has no
    ``__dict__``, so ``runner.last_suite = suite`` raises ``AttributeError``
    at the moment someone tries to keep a result around. Combined with
    ``score`` returning ``None`` and the class having no other public
    member, there is nothing for a caller to read and nothing for a future
    edit to accidentally expose.
    """

    __slots__ = ("_directory",)

    def __init__(self, directory: Path) -> None:
        self._directory = directory

    def score(
        self,
        *,
        arm: str,
        vector_arm: str,
        observations: Sequence[HoldoutObservation],
        content_bytes: Mapping[str, int],
        case_count: int,
    ) -> None:
        """Score the holdout and write it. **Returns nothing, deliberately.**

        ``case_count`` is required and keyword-only for the same reason
        :func:`~tests.memory_recall.scorer.aggregate` demands it: the
        holdout gets its OWN denominator (the holdout case count), and a
        missing case must lower the sealed score rather than shrink the
        divisor.

        There is no return value to check, so a caller cannot branch on
        the holdout at all. A failure to WRITE raises — the seal must not
        also be silent about its own breakage.
        """
        scores: list[CaseScore] = [
            score_case(
                case_id=observation.case_id,
                case_class=observation.case_class,
                ranked=observation.ranked,
                relevant=observation.relevant,
                content_bytes=content_bytes,
                correction=observation.correction,
            )
            for observation in observations
        ]
        suite = aggregate(arm, vector_arm, scores, case_count=case_count)
        payload = {
            "_warning": (
                "SEALED HOLDOUT SCORES. Nothing in the eval harness reads this "
                "file: it exists so a human can audit the holdout AFTER the "
                "tuning decision was made. Do not wire it into the report, a "
                "gate, or the PR comment — that would delete the only property "
                "this split has."
            ),
            "arm": suite.arm,
            "vector_arm": suite.vector_arm,
            "case_count": suite.case_count,
            "scored_cases": suite.scored_cases,
            "missing_cases": suite.missing_cases,
            "recall_at_5": suite.recall_at_5,
            "recall_at_10": suite.recall_at_10,
            "recall_at_20": suite.recall_at_20,
            "mrr": suite.mrr,
            "ndcg_at_10": suite.ndcg_at_10,
            "noise_rate_at_10": suite.noise_rate_at_10,
            "total_token_cost_at_10": suite.total_token_cost_at_10,
            "correction_pairs": suite.correction_pairs,
            "correction_precedence_passes": suite.correction_precedence_passes,
            "cases": [
                {
                    "case_id": s.case_id,
                    "case_class": s.case_class,
                    "recall_at_10": s.recall_at_10,
                    "reciprocal_rank": s.reciprocal_rank,
                    "ndcg_at_10": s.ndcg_at_10,
                    "noise_rate_at_10": s.noise_rate_at_10,
                    "correction_precedence": s.correction_precedence,
                }
                for s in scores
            ],
        }
        self._directory.mkdir(parents=True, exist_ok=True)
        destination = self._directory / f"holdout-{arm}.json"
        # `allow_nan=False` for the same reason the report emit uses it:
        # bare `Infinity`/`NaN` are not JSON and would only be discovered
        # by whoever eventually opens this file.
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(payload, indent=2, sort_keys=True, allow_nan=False),
            encoding="utf-8",
        )
        temporary.replace(destination)


def sealed_directory() -> Path:
    """Where holdout scores go. Never the report path.

    Falls back to a temp directory when :data:`SEALED_DIR_ENV` is unset, so
    a local run still exercises the write leg (and still cannot read it
    back). CI sets the variable and uploads the directory as a build
    artifact — a human reads it later, on purpose, after the tuning
    decision; the PR comment never does.
    """
    configured = os.environ.get(SEALED_DIR_ENV)
    if configured:
        return Path(configured)
    return Path(tempfile.gettempdir()) / "memory-recall-holdout"


def sealed_runner(directory: Path | None = None) -> SealedHoldoutRunner:
    """A runner pointed at :func:`sealed_directory` unless told otherwise."""
    return SealedHoldoutRunner(sealed_directory() if directory is None else directory)
