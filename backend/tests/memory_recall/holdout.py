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
* **No frame of an escaping traceback holds a score.** The five mechanisms
  above all govern code this harness wrote; none of them governs the
  INTERPRETER's own error reporting. ``backend/pytest.ini`` passes
  ``--showlocals`` unconditionally, so any exception escaping
  :meth:`SealedHoldoutRunner.score` prints every traceback frame's locals
  into a public CI job log.

  Three statements can raise, and until 2026-08-20 only the third was
  covered. ``aggregate`` rejects a denominator below the data; ``json.dumps``
  rejects a non-finite metric under ``allow_nan=False``; ``mkdir``/the write
  fail on a read-only mount, a foreign uid or a full disk. The first two sat
  in ``score``'s own frame with ``scores``, ``suite`` and ``payload`` bound —
  a traceback there rendered the entire holdout report into the job log. Only
  the write had been isolated, and the test provoked only the write.

  Relocating the ``del`` does not close it: the frames that COMPUTE a score
  (``score_case``, ``aggregate``, a serialising helper) hold one by
  definition, so no arrangement of statements can make the claim true by
  structure alone. What makes it true is a boundary that ends the traceback
  above them. :func:`_sealed_document` computes and serialises inside a
  ``try`` and re-raises :class:`SealedHoldoutError` ``from None``, so the
  escaping traceback begins at that ``raise`` and the score-bearing frames
  beneath it are never rendered. Its own locals are its parameters, which
  are rankings and fixture bytes, never scores. The write keeps the
  boundary it already had (:func:`_write_sealed_document`, which receives an
  opaque :class:`_SealedDocument`) — its failures name a path and an errno,
  so its message is worth keeping verbatim.
  The exception MESSAGE is the other rendered surface, which is why
  :class:`SealedHoldoutError` carries only a type and a ``file:line``:
  ``json.dumps`` quotes the offending value (``... are not JSON compliant:
  inf``) and that value is a holdout metric.
  ``test_no_failure_renders_a_score_in_any_frame`` provokes all three
  statements and asserts an ALLOWLIST of permitted local names per frame,
  because a denylist of metric names passes a tuple of bare floats
  (``(0.0417, 0.0833)`` is neither a score object nor a repr that names a
  metric).

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
#: what the CI comment step reads, and the whole point is that the report
#: never lands in this directory — neither AS it nor INSIDE it.
SEALED_DIR_ENV = "MEMORY_RECALL_HOLDOUT_DIR"

#: The report path the CI comment step reads. Named here ONLY so
#: :func:`sealed_directory` can check itself against it: the docstring above
#: claims the two destinations never coincide, and a claim nothing checks
#: is a rule rather than a mechanism.
REPORT_PATH_ENV = "MEMORY_RECALL_EVAL_REPORT"

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
#: the tuning side.
PUBLIC_CALLABLES: frozenset[str] = frozenset(
    {
        "CaseSplit",
        "HoldoutObservation",
        "SealedHoldoutError",
        "SealedHoldoutRunner",
        "sealed_directory",
        "sealed_runner",
        "split_cases",
        "split_key",
        "split_report",
        "split_report_violations",
    }
)

#: Every public NON-callable this module defines, pinned for the same reason
#: as :data:`PUBLIC_CALLABLES`. This used to be left unpinned on the grounds
#: that "a ``str`` cannot return a score" — true, and beside the point: a
#: ``dict`` can. A module-scope ``LAST_SUITE: dict = {}`` that :meth:`score`
#: wrote into would satisfy every other mechanism in this file — ``score``
#: still returns ``None``, ``__slots__`` is untouched, the runner still has
#: one public member, the sealed directory is still write-only — and hand a
#: holdout number to anyone who imports the module. So the constant surface
#: is pinned too, and the structural test additionally requires every entry
#: to be IMMUTABLE, which is the half a future addition cannot talk its way
#: past by editing this set.
PUBLIC_CONSTANTS: frozenset[str] = frozenset(
    {
        "HOLDOUT_EVERY",
        "PUBLIC_CALLABLES",
        "PUBLIC_CONSTANTS",
        "REPORT_PATH_ENV",
        "SEALED_DIR_ENV",
        "SPLIT_REPORT_INT_KEYS",
        "SPLIT_VERSION",
    }
)

#: The ONLY keys in a :func:`split_report` block whose value may be an
#: ``int``. Every other leaf must be a ``str`` — see
#: :func:`split_report_violations` for why "no float" was not enough.
SPLIT_REPORT_INT_KEYS: frozenset[str] = frozenset({"train_cases", "holdout_cases"})


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
    mechanical and asserted in both test suites via
    :func:`split_report_violations`: *every leaf of this dict is a string,
    or an int under one of the two keys in* :data:`SPLIT_REPORT_INT_KEYS`.
    Anything else is a violation, and a score has nowhere left to be.

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


def split_report_violations(block: object, *, key: str = "") -> list[str]:
    """Every leaf of a :func:`split_report` block that could carry a score.

    The rule, stated **totally**: a leaf is a ``str``, or an ``int`` whose
    key is in :data:`SPLIT_REPORT_INT_KEYS`. Everything else — a float, a
    bool, a ``None``, an ``int`` under any other key — comes back as a
    ``"<key>=<value!r>"`` string for the caller to fail on. An empty list is
    the only passing result.

    **Why not "no float anywhere", which is what this used to say.** That
    formulation is not total, and the counterexample is in this repo:
    :class:`~tests.memory_recall.scorer.SuiteScore` reports
    ``total_token_cost_at_10``, ``correction_pairs`` and
    ``correction_precedence_passes`` as ``int``, and the plan's baseline
    table headlines two of them. A ``"holdout_token_cost": 374`` added to
    :func:`split_report` would have sailed past a float-only check in both
    suites. Pinning the int keys instead of pinning the type is what makes
    the invariant cover the metrics that are not floats.

    The counterpart to copy is
    :meth:`~tests.memory_recall.wiring.WiringLedger.as_report`, whose
    strings-only invariant has always been total.
    """
    if isinstance(block, Mapping):
        return [
            violation
            for child_key, item in block.items()
            for violation in split_report_violations(item, key=str(child_key))
        ]
    if isinstance(block, (list, tuple)):
        return [
            violation
            for item in block
            for violation in split_report_violations(item, key=key)
        ]
    if isinstance(block, str):
        return []
    if (
        isinstance(block, int)
        and not isinstance(block, bool)
        and key in SPLIT_REPORT_INT_KEYS
    ):
        return []
    return [f"{key or '<root>'}={block!r}"]


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


@dataclass(frozen=True, repr=False, slots=True)
class _SealedDocument:
    """A serialised sealed payload whose ``repr`` withholds its contents.

    Not decoration, and not paranoia about ``print``. ``backend/pytest.ini``
    passes ``--showlocals``, which pytest applies to EVERY frame of a
    traceback, and ``-q`` does not cancel it. A plain ``str`` handed to
    :func:`_write_sealed_document` would put the whole holdout JSON —
    recall@5/@10/@20, MRR, nDCG, noise rate — into the locals of the one
    frame that is expected to raise. This wrapper puts a length there
    instead. :meth:`text` is called on the value stack at the write, so the
    string is never bound to a name in that frame either.

    ``slots=True`` removes the instance ``__dict__``, so ``vars(document)``
    raises ``TypeError`` and ``document.__dict__`` raises ``AttributeError``
    instead of handing the plaintext back past the withheld ``repr``.

    **What it does NOT close, measured rather than assumed:**
    :func:`dataclasses.asdict` reads ``fields()``, not ``__dict__``, and
    still returns ``{'_text': ...}``; a pickle round-trip still carries the
    text (a slotted dataclass gets ``__getstate__``/``__setstate__``); and
    :func:`gc.get_referents` still lists the ``str`` object, because slot
    values are referents too. None of the three is on a traceback path — the
    sixth bullet's claim is about frames, and held either way — so this is
    two cheap doors closed, not a seal. ``test_the_sealed_document_holds_the_line_it_can``
    pins both halves so neither is overstated later.
    """

    _text: str

    def __repr__(self) -> str:
        return f"<sealed document: {len(self._text)} chars, contents withheld>"

    def text(self) -> str:
        return self._text


class SealedHoldoutError(RuntimeError):
    """Sealing the holdout failed — with the original detail DISCARDED.

    Raised by :func:`_sealed_document` in place of whatever ``aggregate``,
    :func:`json.dumps` or the payload build raised. The substitution is the
    mechanism behind the module docstring's sixth bullet: ``raise ... from
    None`` makes THIS the escaping exception, so the traceback pytest
    renders with ``--showlocals`` begins at that ``raise`` and the frames
    beneath it — the ones that hold ``scores``, ``suite`` and ``payload`` by
    definition — are never rendered at all.

    The original message goes with them, deliberately: ``json.dumps``
    reports a non-finite value by quoting it (``Out of range float values
    are not JSON compliant: inf``), and that value is a holdout metric. What
    survives is the exception TYPE and the ``file:line`` it came from, which
    is what a reader needs to go and look. Reproduce locally to see the rest.

    The write is NOT wrapped in this: its failures name a path and an errno
    and hold nothing else, so :func:`_write_sealed_document` keeps its
    verbatim ``OSError``.
    """


def _origin(error: BaseException) -> str:
    """``file:line`` of the innermost frame of ``error``'s traceback.

    Total by construction — it is called from an ``except`` block whose own
    failure would put the original exception's ``repr`` (and so its message)
    into a rendered frame, which is the leak this whole path exists to
    close.
    """
    innermost = error.__traceback__
    if innermost is None:
        return "an unknown location"
    while innermost.tb_next is not None:
        innermost = innermost.tb_next
    return f"{Path(innermost.tb_frame.f_code.co_filename).name}:{innermost.tb_lineno}"


def _write_sealed_document(
    directory: Path, filename: str, document: _SealedDocument
) -> None:
    """Write one already-serialised sealed document, atomically.

    Split out of :meth:`SealedHoldoutRunner.score` for exactly one reason:
    **this is the frame that raises.** ``mkdir`` fails on a read-only mount
    or on a shared temp directory another uid owns; the write fails on a
    full disk. Those failures must still propagate — the seal may not be
    silent about its own breakage — but the frame they propagate out of now
    holds a path, a filename and an opaque document, so ``--showlocals`` has
    nothing to render.
    """
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / filename
    temporary = destination.with_suffix(".json.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        handle.write(document.text())
    temporary.replace(destination)


def _sealed_payload(
    *,
    arm: str,
    vector_arm: str,
    observations: Sequence[HoldoutObservation],
    content_bytes: Mapping[str, int],
    case_count: int,
) -> dict[str, object]:
    """Score every observation and build the JSON body. **Holds scores.**

    This is the frame the module docstring's sixth bullet cannot make
    score-free — ``scores``, ``suite`` and the payload itself live here, and
    ``aggregate`` and ``score_case`` below hold their own. It is never on an
    escaping traceback because :func:`_sealed_document` catches everything it
    raises and substitutes :class:`SealedHoldoutError` ``from None``.
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
    return {
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


def _sealed_document(
    *,
    arm: str,
    vector_arm: str,
    observations: Sequence[HoldoutObservation],
    content_bytes: Mapping[str, int],
    case_count: int,
) -> _SealedDocument:
    """The scoring + serialising boundary. **Nothing score-bearing escapes.**

    The counterpart to :func:`_write_sealed_document`, and the half that was
    missing until 2026-08-19. The write could be made safe structurally
    because its inputs carry no score; scoring cannot — ``aggregate`` holds
    the list it is validating, ``json.dumps`` is reached with the payload
    built. So the boundary here is the ``except``: every failure of the
    compute-and-serialise pair is replaced by a :class:`SealedHoldoutError`
    raised from THIS frame, whose locals are the parameters above.

    ``observations`` are rankings and ``content_bytes`` is fixture data —
    the driver already holds both — so ``--showlocals`` on the escaping
    traceback renders nothing the tuning side did not put in.

    ``allow_nan=False`` for the same reason the report emit uses it: bare
    ``Infinity``/``NaN`` are not JSON and would otherwise be discovered by
    whoever eventually opens the file.
    """
    try:
        return _SealedDocument(
            json.dumps(
                _sealed_payload(
                    arm=arm,
                    vector_arm=vector_arm,
                    observations=observations,
                    content_bytes=content_bytes,
                    case_count=case_count,
                ),
                indent=2,
                sort_keys=True,
                allow_nan=False,
            )
        )
    except Exception as error:  # noqa: BLE001 - re-raised, never swallowed
        origin = _origin(error)
        raise SealedHoldoutError(
            f"sealing the holdout for arm {arm!r} failed with "
            f"{type(error).__name__} at {origin}. The original message and "
            "traceback are discarded on purpose — --showlocals would render "
            "the score-bearing frames beneath this one into a public CI log, "
            "and json.dumps quotes the offending metric in its own message. "
            "Reproduce locally to see them."
        ) from None


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
        the holdout at all. Both a failure to SCORE and a failure to WRITE
        raise — the seal must not also be silent about its own breakage —
        but neither raises out of THIS frame holding a score. Scoring and
        serialising happen behind :func:`_sealed_document`, which substitutes
        a :class:`SealedHoldoutError` for anything the score-bearing frames
        raise; the write happens behind :func:`_write_sealed_document`, whose
        inputs are a path, a filename and an opaque document. This frame
        binds no score at any point, so there is no ``del`` to get wrong.

        The denominator is checked HERE rather than being left to
        :func:`~tests.memory_recall.scorer.aggregate`. Not redundancy:
        ``aggregate``'s message is the useful one ("case_count=1 is smaller
        than the 2 scores handed in") and it is exactly the message the
        sanitising boundary would throw away. Checking against
        ``len(observations)`` — which equals the score count by
        construction — keeps that diagnosis in a frame that holds only
        rankings.

        Raises:
            ValueError: ``case_count`` is negative, or smaller than the
                number of observations handed in.
            SealedHoldoutError: scoring or serialising failed.
            OSError: the sealed directory could not be created or written.
        """
        if case_count < 0:
            raise ValueError(f"case_count must not be negative, got {case_count}")
        if case_count < len(observations):
            raise ValueError(
                f"case_count={case_count} is smaller than the "
                f"{len(observations)} holdout observations handed in — a "
                "denominator below the data would inflate every sealed mean"
            )
        _write_sealed_document(
            self._directory,
            f"holdout-{arm}.json",
            _sealed_document(
                arm=arm,
                vector_arm=vector_arm,
                observations=observations,
                content_bytes=content_bytes,
                case_count=case_count,
            ),
        )


def _fallback_directory() -> Path:
    """The temp destination used when :data:`SEALED_DIR_ENV` is unset.

    **Self-identifying, deliberately.** This was a fixed shared name
    (``<tmp>/memory-recall-holdout``) until 2026-08-19, and ``backend-ci.yml``
    sets neither environment variable — so every run of the suite dropped
    its ``holdout-*.json`` into the same place, on top of files from earlier
    branches that were indistinguishable from this run's. Nothing reads
    them, so that was never a leak; it defeated the one purpose the sealed
    file has, which is to be auditable AFTER the fact by a human who needs
    to know which run produced the number.

    The token is stable WITHIN a process — the driver calls
    :func:`sealed_runner` once per arm and all three must land in one
    directory — so it is the run id and the pid, never a timestamp.
    """
    run_id = os.environ.get("GITHUB_RUN_ID")
    token = f"{run_id}-{os.getpid()}" if run_id else str(os.getpid())
    return Path(tempfile.gettempdir()) / f"memory-recall-holdout-{token}"


def sealed_directory() -> Path:
    """Where holdout scores go. Never the report path.

    Falls back to :func:`_fallback_directory` when :data:`SEALED_DIR_ENV` is
    unset, so a local run still exercises the write leg (and still cannot
    read it back). CI sets the variable and uploads the directory as a build
    artifact — a human reads it later, on purpose, after the tuning
    decision; the PR comment never does.

    Raises:
        ValueError: the report named by :data:`REPORT_PATH_ENV` IS the
            sealed directory, or sits INSIDE it. This is where the module
            docstring's "the two destinations never coincide" is CHECKED
            rather than merely asserted in prose.

            Containment, not just equality, and the containing case is the
            realistic one: ``MEMORY_RECALL_HOLDOUT_DIR=${{
            github.workspace }}`` with the report at
            ``${{ github.workspace }}/recall-eval.json`` passes an
            equality check while dropping every ``holdout-*.json`` beside
            the report — and ``actions/upload-artifact`` publishes the
            workspace. An equality-only guard would have called that
            configuration clean.
    """
    configured = os.environ.get(SEALED_DIR_ENV)
    directory = Path(configured) if configured else _fallback_directory()

    report = os.environ.get(REPORT_PATH_ENV)
    if report:
        report_path = Path(report).expanduser().resolve()
        resolved = directory.expanduser().resolve()
        if report_path == resolved or report_path.is_relative_to(resolved):
            raise ValueError(
                f"{REPORT_PATH_ENV}={report_path} is {SEALED_DIR_ENV}={resolved} "
                "or lies inside it — the sealed holdout's destination may never "
                "be, nor contain, the file the PR comment step reads"
            )
    return directory


def sealed_runner(directory: Path | None = None) -> SealedHoldoutRunner:
    """A runner pointed at :func:`sealed_directory` unless told otherwise."""
    return SealedHoldoutRunner(sealed_directory() if directory is None else directory)
