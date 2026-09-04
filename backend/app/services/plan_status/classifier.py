#!/usr/bin/env python3
"""The PURE three-way plan-status classifier: one spec, one function, one order.

WHAT THIS IS

Three writers share one fact -- "is this plan done?" -- and none of them reads
the others:

  axis A -- coord `work_units.status`, the STORED column.
  axis B -- the plan document's status stamp on `origin/main` of the plans repo.
  axis C -- coord's DERIVED `delivery` verdict, `{shipped, evidence_complete,
            evidence_gaps}`, re-derived per read and never the stored column.

`classify()` takes the three already-fetched axis values and returns
`(class_name, reason)`. It performs NO I/O: no network, no git, no subprocess,
no filesystem. That is the whole point -- it is the one piece two repos
(qontinui-dev-notes and qontinui-web) must agree on, so it has to be testable
in both without a fixture corpus, and it must not become a fifth reader of a
plan's status word.

Plan: plans/2026-09-03-plan-status-three-way-reconciler-surface.md (D1, D2, D6).

THE ORDER IS PART OF THE SPEC (D6)

Several members match one row at once. A unit whose `status` is the empty
string AND whose delivery reads `evidence_complete: false` satisfies both
`UNKNOWN_UNIT_STATUS_EMPTY` and `EVIDENCE_INCOMPLETE`. Without a stated
evaluation order the two implementations pick different winners on the same
input, which defeats the shared-vector mitigation exactly where it matters.

So this is a FIRST-MATCH-WINS ORDERED CASCADE, `CLASS_ORDER` is the order, and
`scripts/plan-status-vectors.json` asserts it. Two properties the order buys
mechanically rather than by comment:

  * `EVIDENCE_INCOMPLETE` precedes every arm that reads `shipped`, because
    below an incomplete evidence read `shipped: false` is not an observation --
    it is "we could not tell 'not landed' from 'we did not look'".
  * `AGREE_TERMINAL` / `AGREE_OPEN` are LAST, so no unreadable axis can fall
    through into agreement. `[policy: unknown-must-not-render-as-a-default]`

VOCABULARY -- WHY THE RUST NINE AND NOT THE LINTER'S ELEVEN

The document axis is read by `qontinui-claude-config/scripts/lint-plan-status.py`
with `--vocab=adapter`, whose `ADAPTER_VOCAB` carries ELEVEN spellings. The
Rust adapter that actually consumes plan bodies
(`qontinui-runner/src-tauri/src/plan_workunit_adapter/parser.rs`,
`operator_default()`) tokenizes exactly NINE phrases. The linter adds the
underscore forms `in_progress` and `not_started` because they are the adapter's
own OUTPUT forms -- but they are not INPUT phrases: `match_known_status` is a
`lower.starts_with(phrase)` test plus a word-boundary check, and
`"in_progress".starts_with("in progress")` is false.

So a stamp the linter classifies `ok` on an underscore form is one the Rust
tokenizer does NOT match, and that is a genuine
`DOC_STAMP_UNREADABLE_BY_ADAPTER` -- not a rounding error. This module compares
against the Rust nine.

ARM 6 REQUIRES A TERMINALITY CLAIM -- DO NOT "SIMPLIFY" THAT AWAY

`NO_CITATIONS_CAPTURED` needs THREE conditions, not two: `evidence_complete:
true`, zero captured citations, AND at least one axis actually CLAIMING the
work is done. The third is not decoration.

It was specified with only the first two, and the first live corpus run
measured what that costs: 351 rows landed in arm 6, and **235 of them were
plans that are simply NOT STARTED** -- both axes open, no PRs yet, so of course
coord captured nothing. Because arm 6 sits above the agreement arms, those 235
rows could never reach `AGREE_OPEN`, and the class came back **0 over a corpus
that is mostly open**. A classifier that cannot observe agreement-on-open
reports a wrong AGREE number, which is the exact defect class this surface
exists to close.

The plan's own Direction (d) states the requirement the loose predicate broke:
"The surface must classify 'no citations captured' separately from 'not
started'." The loose form conflated them in the direction neither the spec nor
the vet noticed -- it classified "not started" AS "no citations captured".

The tightened arm keeps the population direction (d) is actually about: a row
where a document stamp or a stored status ASSERTS the work landed while coord
looked and found nothing (98 terminal-doc + 54 terminal-unit rows on the same
run). `regression/both-open-zero-citations-must-be-AGREE_OPEN` in the vector
file is the guard; deleting the third condition reds it.

AXIS A IS NOT A CLOSED SET

Measured on this tenant 2026-09-03 over 1421 date-slugged work units, the
stored `status` column holds: `shipped` 480, `""` 410, `in_progress` 228,
`draft` 99, `superseded` 32, `vetted` 26, `partial` 23, `ready` 17, `obsolete`
13, `proposed` 9, `done` 8, `blocked` 7. `done` is outside every documented
vocabulary and `ready` is a *Derived* word being carried as a stored value.
Coord accepts an off-vocabulary status deliberately (the Free transition tier),
so this module must never assume axis A is drawn from a closed set: a word in
neither terminal set below reads as OPEN, and that reading is stated rather
than assumed.
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any

# --------------------------------------------------------------------------
# The class enum -- exhaustive, CLOSED, and ORDERED. First match wins.
#
# Adding a member here without adding at least one vector to
# plan-status-vectors.json fails the completeness test in
# scripts/test-plan-status-reconcile.sh. That is deliberate: an unordered or
# untested enum is the likelier drift than a missing member (plan, Risks).
# --------------------------------------------------------------------------
CLASS_ORDER: tuple[str, ...] = (
    # 1. Any axis could not be READ at all. The reason names which.
    "UNKNOWN_AXIS_UNREADABLE",
    # 2-3. A joined side is absent.
    "UNKNOWN_NO_BODY_ON_MAIN",
    "UNKNOWN_NO_UNIT",
    # 4. Axis A is the empty string -- accepted silently by coord, and it
    #    detaches the unit from every status query.
    "UNKNOWN_UNIT_STATUS_EMPTY",
    # 5. Evidence could not be established. Precedes every `shipped`-reading
    #    arm; carries `evidence_gaps` VERBATIM.
    "EVIDENCE_INCOMPLETE",
    # 6. Coord looked and found nothing WHILE SOME AXIS CLAIMS THE WORK LANDED
    #    -- rendered identically to "nothing to find" everywhere else.
    #    Direction (d) of the dossier. The terminality claim is load-bearing;
    #    see "ARM 6 REQUIRES A TERMINALITY CLAIM" in the module docstring.
    "NO_CITATIONS_CAPTURED",
    # 7. The A-vs-C class: the stored column disagrees with the live predicate.
    "UNIT_STATUS_CONTRADICTS_DELIVERY",
    # 8. The document says something the adapter cannot read -- so the adapter
    #    silently substitutes `draft` and pushes it over coord's row.
    "DOC_STAMP_UNREADABLE_BY_ADAPTER",
    # 9-10. The A-vs-B classes.
    "DOC_OVERSTATES",
    "DOC_UNDERSTATES",
    # 11-12. Agreement, reachable ONLY when every axis was read.
    "AGREE_TERMINAL",
    "AGREE_OPEN",
)

CLASSES: frozenset[str] = frozenset(CLASS_ORDER)

#: Classes that are an explicit statement of UNKNOWN rather than a verdict.
UNKNOWN_CLASSES: frozenset[str] = frozenset(
    c for c in CLASS_ORDER if c.startswith("UNKNOWN_")
)

#: Classes that mean the three axes agree.
AGREE_CLASSES: frozenset[str] = frozenset(("AGREE_TERMINAL", "AGREE_OPEN"))

#: Everything else: a stated disagreement.
DISAGREE_CLASSES: frozenset[str] = frozenset(CLASS_ORDER) - UNKNOWN_CLASSES - AGREE_CLASSES

# --------------------------------------------------------------------------
# Vocabularies
# --------------------------------------------------------------------------

#: The NINE phrases `PlanConvention::operator_default()` tokenizes, verbatim
#: and in source order (parser.rs). Spaced spellings, because that is what the
#: Rust `starts_with` test is applied against.
ADAPTER_NINE_PHRASES: tuple[str, ...] = (
    "draft",
    "vetted",
    "in progress",
    "shipped",
    "partial",
    "not started",
    "superseded",
    "obsolete",
    "implemented",
)

#: Of the nine, the ones that mean "this plan will not be worked further".
#: `superseded`/`obsolete` are terminal in the lifecycle sense without being
#: shipped-class -- a distinction arm 7 needs and arms 9-12 do not.
DOC_TERMINAL: frozenset[str] = frozenset(
    ("shipped", "implemented", "superseded", "obsolete")
)

#: Axis A words that assert the work LANDED. Open-ended by construction (see
#: the module docstring): coord's status column is not a closed set.
UNIT_SHIPPED_CLASS: frozenset[str] = frozenset(
    ("shipped", "done", "implemented", "complete", "completed", "delivered", "landed")
)

#: Axis A words that assert the work will never land.
UNIT_ABANDONED_CLASS: frozenset[str] = frozenset(
    (
        "superseded",
        "obsolete",
        "cancelled",
        "canceled",
        "wontfix",
        "rejected",
        "dropped",
        "abandoned",
    )
)

#: Terminal = landed or abandoned. Anything else -- including a word in no
#: vocabulary at all -- reads OPEN, and the reason says so.
UNIT_TERMINAL: frozenset[str] = UNIT_SHIPPED_CLASS | UNIT_ABANDONED_CLASS

#: sha256 of `scripts/plan-status-vectors.json` as authored in THIS repo.
#:
#: D7: qontinui-dev-notes and qontinui-web are separate repos with no package
#: dependency and no workflow that checks out a sibling, so the vectors cannot
#: literally be shared -- they are VENDORED. Pinning the digest in both repos
#: and asserting it in each suite makes the copy DETECTABLE rather than
#: pretending it is shared: a divergence reds both suites on the next run.
VECTORS_SHA256 = "3566c5790df0a0cc659e1ce150a8a5ee64ac00ca031bdb9f8c5488a3b59aec9d"

#: Where the vectors live, relative to this file. Used only by helpers below;
#: `classify()` itself never touches the filesystem.
VECTORS_FILENAME = "plan-status-vectors.json"


# --------------------------------------------------------------------------
# Vocabulary helpers -- pure
# --------------------------------------------------------------------------
def normalize_status_word(raw: str | None) -> str:
    """Lowercase, trim, and underscore-join a status word.

    Ported from the adapter's `normalize_status` (parser.rs) and coord's, so
    `IN_PROGRESS`, `In Progress` and `in progress` collapse to one key. Returns
    `""` for None or whitespace -- callers distinguish "absent" from "empty"
    before reaching here.
    """
    if raw is None:
        return ""
    cleaned = raw.strip().rstrip(",.:*").strip()
    return "_".join(cleaned.split()).lower()


def adapter_tokenizes(raw: str | None) -> bool:
    """Would the Rust adapter's nine phrases MATCH this stamp remainder?

    Reimplements `match_known_status` exactly: a case-insensitive
    `starts_with(phrase)` plus a word-boundary check (the next character must
    be absent, or be neither alphanumeric nor `_`).

    This is deliberately NOT `normalize_status_word(raw) in <nine>`: the
    boundary rule is what makes `in_progress` fail while `in progress` passes,
    and collapsing the two here would erase the very disagreement class
    `DOC_STAMP_UNREADABLE_BY_ADAPTER` exists to surface.
    """
    if raw is None:
        return False
    lower = raw.strip().lower()
    if not lower:
        return False
    for phrase in ADAPTER_NINE_PHRASES:
        if not lower.startswith(phrase):
            continue
        rest = lower[len(phrase) :]
        if not rest:
            return True
        nxt = rest[0]
        if not (nxt.isalnum() or nxt == "_"):
            return True
    return False


def doc_is_terminal(raw: str | None) -> bool:
    """Terminality reading for axis B, over the adapter's nine phrases."""
    return normalize_status_word(raw) in DOC_TERMINAL


def unit_is_terminal(raw: str | None) -> bool:
    """Terminality reading for axis A. An unrecognised word reads OPEN."""
    return normalize_status_word(raw) in UNIT_TERMINAL


def unit_is_shipped_class(raw: str | None) -> bool:
    """Does axis A assert the work LANDED (as opposed to being abandoned)?"""
    return normalize_status_word(raw) in UNIT_SHIPPED_CLASS


# --------------------------------------------------------------------------
# Axis shapes
#
# Plain dicts rather than dataclasses, deliberately: the vector file is JSON
# and the web-side port is Python too, so a 1:1 mapping between the fixture and
# the call argument removes a translation layer that could itself drift. The
# keys are validated strictly -- a typo must be a loud error, never a silently
# missing signal that defaults to "readable".
# --------------------------------------------------------------------------
AXIS_A_KEYS = frozenset(("readable", "present", "status", "unreadable_reason"))
AXIS_B_KEYS = frozenset(
    (
        "readable",
        "present",
        "status",
        "classification",
        "adapter_readable",
        "unreadable_reason",
    )
)
AXIS_C_KEYS = frozenset(
    (
        "readable",
        "present",
        "shipped",
        "evidence_complete",
        "evidence_gaps",
        "citation_count",
        "unreadable_reason",
    )
)


class AxisShapeError(ValueError):
    """An axis dict is missing a required key or carries an unknown one."""


def _check(axis: Any, keys: frozenset[str], name: str) -> dict[str, Any]:
    if not isinstance(axis, dict):
        raise AxisShapeError(f"axis {name} must be a dict, got {type(axis).__name__}")
    got = set(axis)
    missing = keys - got
    extra = got - keys
    if missing or extra:
        parts = []
        if missing:
            parts.append("missing " + ", ".join(sorted(missing)))
        if extra:
            parts.append("unknown " + ", ".join(sorted(extra)))
        raise AxisShapeError(f"axis {name}: " + "; ".join(parts))
    if not isinstance(axis["readable"], bool):
        raise AxisShapeError(f"axis {name}: `readable` must be a bool")
    if not isinstance(axis["present"], bool):
        raise AxisShapeError(f"axis {name}: `present` must be a bool")
    return axis


def axis_a(
    *,
    readable: bool = True,
    present: bool = True,
    status: str | None = None,
    unreadable_reason: str | None = None,
) -> dict[str, Any]:
    """Build an axis-A value. `present` is "a coord work unit exists for this stem"."""
    return {
        "readable": readable,
        "present": present,
        "status": status,
        "unreadable_reason": unreadable_reason,
    }


def axis_b(
    *,
    readable: bool = True,
    present: bool = True,
    status: str | None = None,
    classification: str | None = None,
    adapter_readable: bool | None = None,
    unreadable_reason: str | None = None,
) -> dict[str, Any]:
    """Build an axis-B value.

    `status`/`classification` come from `lint-plan-status.py --vocab=adapter
    --json` (`classification` is `ok | off_vocabulary | no_status_block`).
    `adapter_readable` is the INDEPENDENT byte-exact signal -- does any line
    satisfy `line.lstrip().startswith("> **Status:")`, the adapter's own
    first-match-wins rule -- read from the git blob, not from the linter.
    """
    return {
        "readable": readable,
        "present": present,
        "status": status,
        "classification": classification,
        "adapter_readable": adapter_readable,
        "unreadable_reason": unreadable_reason,
    }


def axis_c(
    *,
    readable: bool = True,
    present: bool = True,
    shipped: bool | None = None,
    evidence_complete: bool | None = None,
    evidence_gaps: Any = (),
    citation_count: int | None = None,
    unreadable_reason: str | None = None,
) -> dict[str, Any]:
    """Build an axis-C value from coord's `delivery` verdict + citation rows."""
    return {
        "readable": readable,
        "present": present,
        "shipped": shipped,
        "evidence_complete": evidence_complete,
        "evidence_gaps": list(evidence_gaps or ()),
        "citation_count": citation_count,
        "unreadable_reason": unreadable_reason,
    }


# --------------------------------------------------------------------------
# The cascade
# --------------------------------------------------------------------------
def classify(
    axis_a_value: dict[str, Any],
    axis_b_value: dict[str, Any],
    axis_c_value: dict[str, Any],
) -> tuple[str, str]:
    """Classify one stem. Returns `(class_name, reason)`. Pure; no I/O.

    First match wins, in `CLASS_ORDER`. Every returned class is a member of
    `CLASSES`, and the reason is a plain sentence naming the values that
    decided it -- an operator reading the JSONL must not have to re-derive
    the verdict from the axes.
    """
    a = _check(axis_a_value, AXIS_A_KEYS, "A")
    b = _check(axis_b_value, AXIS_B_KEYS, "B")
    c = _check(axis_c_value, AXIS_C_KEYS, "C")

    # -- 1 -----------------------------------------------------------------
    # Any axis unreadable. Named, never silently defaulted, and FIRST so that
    # nothing below can read a missing value as an observation.
    unreadable: list[str] = []
    for label, axis in (("A", a), ("B", b), ("C", c)):
        if not axis["readable"]:
            why = axis["unreadable_reason"] or "no reason recorded"
            unreadable.append(f"axis {label} ({why})")
    if unreadable:
        return (
            "UNKNOWN_AXIS_UNREADABLE",
            "could not read " + "; ".join(unreadable),
        )

    # -- 2 -----------------------------------------------------------------
    if not b["present"]:
        return (
            "UNKNOWN_NO_BODY_ON_MAIN",
            "no plan body for this stem on the plans repo's origin/main; the "
            "document axis has no value to compare",
        )

    # -- 3 -----------------------------------------------------------------
    if not a["present"]:
        return (
            "UNKNOWN_NO_UNIT",
            "no coord work unit for this stem; axes A and C have no value to "
            "compare",
        )

    # -- 4 -----------------------------------------------------------------
    unit_status = a["status"] if isinstance(a["status"], str) else ""
    if unit_status.strip() == "":
        return (
            "UNKNOWN_UNIT_STATUS_EMPTY",
            "coord work unit exists but its stored status is the empty string "
            "-- not null and not a vocabulary word, so it is accepted silently "
            "and detached from every status query",
        )

    # Axis C is queried per work unit, so `present` mirrors axis A's presence.
    # A readable-but-absent C alongside a present A cannot arise from the
    # reconciler; if a caller constructs it anyway, arms 5-7 are simply
    # inapplicable and the doc-vs-unit arms below still produce an honest
    # answer rather than a crash mid-corpus.
    c_usable = bool(c["present"])

    # -- 5 -----------------------------------------------------------------
    # BEFORE every `shipped`-reading arm. Below this line `shipped: false` is
    # not an observation.
    if c_usable and c["evidence_complete"] is False:
        gaps = list(c["evidence_gaps"] or ())
        rendered = "; ".join(str(g) for g in gaps) if gaps else "no gaps recorded"
        return (
            "EVIDENCE_INCOMPLETE",
            "coord's delivery verdict reads evidence_complete: false, so "
            f"shipped: {c['shipped']!r} is not an observation. Gaps verbatim: "
            f"{rendered}",
        )

    # -- 6 -----------------------------------------------------------------
    # Coord looked and found nothing WHILE SOMETHING CLAIMS THE WORK LANDED.
    # Everywhere else, "found nothing" renders identically to "nothing to find".
    #
    # The terminality claim is the third condition and it is REQUIRED: without
    # it this arm also swallows every genuinely-unstarted plan (measured
    # 2026-09-03: 235 of 351 rows), which drives AGREE_OPEN to zero because
    # this arm sits above the agreement arms. See the module docstring.
    if c_usable and c["evidence_complete"] is True and c["citation_count"] == 0:
        doc_claims_done = doc_is_terminal(b["status"])
        unit_claims_done = unit_is_terminal(unit_status)
        if doc_claims_done or unit_claims_done:
            claimant = (
                f"the document stamp {b['status']!r}"
                if doc_claims_done
                else f"the stored unit status {unit_status!r}"
            )
            if doc_claims_done and unit_claims_done:
                claimant = (
                    f"both the document stamp {b['status']!r} and the stored "
                    f"unit status {unit_status!r}"
                )
            return (
                "NO_CITATIONS_CAPTURED",
                f"{claimant} asserts the work is done, but coord's delivery "
                "verdict is complete (evidence_complete: true, no gaps) over "
                "ZERO captured citations -- coord looked and found nothing, "
                "which is not the same fact as 'not started'",
            )

    # -- 7 -----------------------------------------------------------------
    if c_usable and isinstance(c["shipped"], bool):
        shipped = c["shipped"]
        if unit_is_shipped_class(unit_status) and not shipped:
            return (
                "UNIT_STATUS_CONTRADICTS_DELIVERY",
                f"stored unit status {unit_status!r} asserts the work landed, "
                "but coord's live delivery verdict reads shipped: false over a "
                "COMPLETE evidence read",
            )
        if shipped and not unit_is_terminal(unit_status):
            return (
                "UNIT_STATUS_CONTRADICTS_DELIVERY",
                "coord's live delivery verdict reads shipped: true over a "
                "complete evidence read, but the stored unit status is "
                f"{unit_status!r}, which is not a terminal word",
            )
        if shipped and normalize_status_word(unit_status) in UNIT_ABANDONED_CLASS:
            return (
                "UNIT_STATUS_CONTRADICTS_DELIVERY",
                f"stored unit status {unit_status!r} asserts the work was "
                "abandoned, but coord's live delivery verdict reads shipped: "
                "true over a complete evidence read",
            )

    # -- 8 -----------------------------------------------------------------
    # The document leg's own readability. Everything below compares document
    # terminality, which is only meaningful once the adapter can actually read
    # the stamp -- otherwise it substitutes `draft` and pushes that over coord.
    doc_status = b["status"]
    classification = b["classification"]
    if classification == "no_status_block" or doc_status is None:
        return (
            "DOC_STAMP_UNREADABLE_BY_ADAPTER",
            "the body on origin/main carries no status block at all, so the "
            "plan->work-unit adapter silently defaults it to `draft` and can "
            "push that over whatever coord had derived",
        )
    if not adapter_tokenizes(doc_status):
        return (
            "DOC_STAMP_UNREADABLE_BY_ADAPTER",
            f"the linter parsed the stamp as {doc_status!r} (classification "
            f"{classification!r}), but the adapter's nine phrases do not match "
            "it, so the two readers disagree about what this document says",
        )
    if b["adapter_readable"] is False:
        return (
            "DOC_STAMP_UNREADABLE_BY_ADAPTER",
            f"the linter's looser grammar parsed {doc_status!r}, but NO line "
            'satisfies the adapter\'s byte-exact `> **Status:` test, so a human '
            "and the adapter read different statuses off this body",
        )

    # -- 9/10 --------------------------------------------------------------
    doc_terminal = doc_is_terminal(doc_status)
    unit_terminal = unit_is_terminal(unit_status)
    if doc_terminal and not unit_terminal:
        return (
            "DOC_OVERSTATES",
            f"document stamp {doc_status!r} is terminal while the stored unit "
            f"status {unit_status!r} is not",
        )
    if unit_terminal and not doc_terminal:
        return (
            "DOC_UNDERSTATES",
            f"stored unit status {unit_status!r} is terminal while the document "
            f"stamp {doc_status!r} is not",
        )

    # -- 11/12 -------------------------------------------------------------
    # Reachable only because arm 1 proved every axis was READ.
    if doc_terminal:
        return (
            "AGREE_TERMINAL",
            f"document stamp {doc_status!r} and stored unit status "
            f"{unit_status!r} are both terminal, and every axis was read",
        )
    return (
        "AGREE_OPEN",
        f"document stamp {doc_status!r} and stored unit status {unit_status!r} "
        "are both open, and every axis was read",
    )


# --------------------------------------------------------------------------
# Vector-file helpers (used by --selftest and by the bash suite). These DO
# touch the filesystem; `classify()` above does not.
# --------------------------------------------------------------------------
def vectors_path(base_dir: str | None = None) -> str:
    """Absolute path to the vector file that sits beside this module."""
    base = base_dir or os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, VECTORS_FILENAME)


def vectors_digest(path: str | None = None) -> str:
    """sha256 of the vector file's bytes, exactly as it sits on disk."""
    with open(path or vectors_path(), "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def load_vectors(path: str | None = None) -> dict[str, Any]:
    """Read and lightly shape-check the vector file."""
    p = path or vectors_path()
    with open(p, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict) or not isinstance(data.get("vectors"), list):
        raise ValueError(f"{p}: expected an object carrying a `vectors` list")
    return data
