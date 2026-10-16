"""The plan-library write vocabulary, DERIVED from the schema ``Literal``s.

Phase 3 of plan
``2026-09-20-nothing-checks-that-an-agent-writable-evidence-store-ships-its-vocabulary-and-a-correction-verb``,
served at ``GET /api/v1/plan-library/vocabulary``.

Three wrong ``supersedes`` edges on 2026-09-20 were written by agents that had
no way to read the relation vocabulary before writing, and on this store a
recorded edge cannot be corrected (see ``app.core.evidence_posture``). So the
accepted set of every closed field, and what each value ASSERTS, has to be
readable at the write door.

**Never retyped.** Each field's values come from ``typing.get_args`` over the
``Literal`` in ``app.schemas.plan_library``; only the one-line meanings live
here. A value added to a ``Literal`` therefore appears on the route the moment
it is added — with an empty meaning, which
``tests/test_plan_library_vocabulary.py`` refuses, so the widening cannot land
without its explanation.
"""

from __future__ import annotations

from typing import Any, Final, Literal, get_args

from app.core.evidence_posture import (
    ROUTE_POSTURE,
    Ephemeral,
    Evidence,
    Gap,
    Read,
    correction_sentences,
)
from app.schemas.plan_library import (
    CapturedBy,
    ClosedFieldVocabulary,
    DifficultyLevel,
    DifficultySource,
    PlanLibraryVocabularyResponse,
    VocabularyTerm,
    WorkArtifactKind,
    WorkArtifactRelation,
    WorkArtifactUpsert,
    WriteDoorCorrection,
)
from app.schemas.plan_library_followups import (
    FollowupSizeClass,
    FollowupSizeClassSource,
    FollowupTransitionTarget,
)
from app.schemas.plan_library_scan_roots import ScanRootState, SlugCensusSource

_PREFIX: Final = "/api/v1/plan-library"
_UPSERT: Final = f"POST {_PREFIX}"
_EDGE_CREATE: Final = f"POST {_PREFIX}/{{artifact_id}}/edges"
_SCAN_ROOTS: Final = f"POST {_PREFIX}/scan-roots"
_ANCHORS_PUT: Final = f"PUT {_PREFIX}/edges/{{edge_id}}/anchors"
_RESOLUTION: Final = f"POST {_PREFIX}/edges/{{edge_id}}/resolution"

KIND_MEANINGS: Final[dict[str, str]] = {
    "investigation_prompt": "A prompt that asks an agent to investigate a question.",
    "plan_authoring_prompt": "A prompt that asks an agent to write a plan.",
    "implementation_prompt": "A prompt that asks an agent to implement a plan or one of its phases.",
    "investigation_report": "What an investigation found (including /chart gap verdicts).",
    "handoff": "A note handing unfinished work from one session to another.",
    "plan": "A plan document — phases, status, design decisions.",
    "diagnostic": (
        "An operator question answered by live MEASUREMENT; kept apart from "
        "investigation_report so the two families stay separable on the kind filter."
    ),
}

CAPTURED_BY_MEANINGS: Final[dict[str, str]] = {
    "runner_scan": "The runner's deterministic scan of a plans directory wrote the row.",
    "agent": "An agent wrote the row through a write door (the default).",
    "operator": "A human wrote the row from the web console.",
}

#: The routing sense of each level. Deliberately names NO model: which family
#: a level routes to is per organization and operator-editable (plan
#: ``2026-10-08-operator-editable-model-family-per-plan-difficulty``), while
#: this vocabulary is the same for every caller. The organization's map is the
#: ``model_selectors`` / ``model_tiers`` pair on ``GET /plan-library``.
_ROUTING_POINTER: Final = (
    "the model family it routes to is this organization's model_selectors "
    "map on GET /plan-library"
)

DIFFICULTY_LEVEL_MEANINGS: Final[dict[str, str]] = {
    "low": f"A fast model tier is enough to vet and implement it ({_ROUTING_POINTER}).",
    "medium": f"A mid model tier is well suited to it ({_ROUTING_POINTER}).",
    "high": f"Needs the strongest model tier ({_ROUTING_POINTER}).",
}

SCAN_ROOT_STATE_MEANINGS: Final[dict[str, str]] = {
    "measured": (
        "The device measured its scanned work tree against the default "
        "branch; behind and ahead are required."
    ),
    "not_scanning": "Nothing is scanned at all on this device; carries no census.",
    "not_a_git_work_tree": (
        "The scanned directory is not in a git work tree, so no counts can "
        "be measured; detail must say why."
    ),
    "unknown": (
        "The device could not establish a reading; detail must say why, and "
        "no counts are carried."
    ),
}

SLUG_CENSUS_SOURCE_MEANINGS: Final[dict[str, str]] = {
    "ref": "Stems listed from the fetched default branch — what the work-unit half of the plan adapter reads.",
    "work_tree": "Stems listed from the checked-out directory — what the body-sync half reads to fill the corpus.",
}

DIFFICULTY_SOURCE_MEANINGS: Final[dict[str, str]] = {
    "declared": "The plan's own **Difficulty:** header stamp — an author's or vetter's judgement; it wins.",
    "computed": "The server's deterministic rating of the body, used when no stamp is declared.",
}

RELATION_MEANINGS: Final[dict[str, str]] = {
    "produced_report": "THIS artifact (an investigation prompt) produced THAT report.",
    "feeds": "THIS artifact is input to THAT one (a report feeding a plan-authoring prompt).",
    "authored_plan": "THIS prompt authored THAT plan.",
    "supersedes": (
        "THIS artifact REPLACES THAT one — a newer version of the same thing. "
        "Wrong for a follow-up (use spawned_followup) and wrong for a "
        "prerequisite (use depends_on)."
    ),
    "depends_on": (
        "THIS artifact needs THAT one done first — a prerequisite; "
        "/candidates reports THIS as blocked until THAT ships."
    ),
    "spawned_followup": (
        "THIS artifact surfaced work it deliberately did not do. The only "
        "relation that may omit to_id (the follow-up has no artifact yet); "
        "note is then required."
    ),
    "refutes": (
        "THIS measurement FALSIFIES THAT artifact's claim. Two-ended (to_id "
        "required); not supersedes, which means a newer version of the same thing."
    ),
}

SIZE_CLASS_MEANINGS: Final[dict[str, str]] = {
    "trivial": (
        "The expected fix is NON-EXECUTABLE (a comment, a docstring, a "
        "non-code file) — the class a session folds into a PR that already "
        "touches the file, and the follow-up sweep batches."
    ),
    "small": (
        "One PR-sized change within about three files and no design question; "
        "folded only when its hunk stays inside files the PR already touches."
    ),
    "plan_sized": "Needs design, several repos, or a plan of its own; never folded in.",
}

SIZE_CLASS_SOURCE_MEANINGS: Final[dict[str, str]] = {
    "declared": "The follow-up's writer sized it (set by the server when POST …/edges carries size_class).",
    "sweep": "The follow-up sweep sized it after attempting the fix and proving it was not non-executable.",
}

RESOLUTION_MEANINGS: Final[dict[str, str]] = {
    "open": (
        "Back to the open queue: from fixing when its PR closed unlanded, or "
        "from fixed / already_fixed / dismissed to correct a wrong closure "
        "(resolution_note required then)."
    ),
    "fixing": "A PR that fixes it is open; resolution_pr (owner/name#n) required.",
    "fixed": (
        "coord observed that PR land — normally written by the reconcile from "
        "coord's land record; by hand it needs the land commit."
    ),
    "already_fixed": "An earlier commit already fixed it; resolution_commit required.",
    "dismissed": "Closed without a fix; resolution_note (the reason) required.",
}

RELATION_NOTE: Final = (
    "supersedes asserts that THIS artifact replaces THAT one; it is wrong for "
    "a follow-up (spawned_followup) or a prerequisite (depends_on). A recorded "
    "edge has no correction verb on this backend yet, so choose the relation "
    "before writing it."
)


def _terms(literal: Any, meanings: dict[str, str]) -> list[VocabularyTerm]:
    """The ``Literal``'s values in declaration order, each with its meaning.

    A value with no meaning is served with an EMPTY one rather than dropped:
    dropping it would make the route lie about the accepted set, which is the
    one thing it must not do. The test refuses the empty meaning.
    """
    return [
        VocabularyTerm(value=value, meaning=meanings.get(value, ""))
        for value in get_args(literal)
    ]


def _default(model_field: str) -> str | None:
    default = WorkArtifactUpsert.model_fields[model_field].default
    return default if isinstance(default, str) else None


def closed_fields() -> list[ClosedFieldVocabulary]:
    """Every closed field the plan-library write doors accept."""
    difficulty_as = (
        "the plan body's header stamp `**Difficulty:** <level>` on POST "
        "/plan-library (parsed server-side; not a request-body property)"
    )
    return [
        ClosedFieldVocabulary(
            field="kind",
            written_as="request body `kind`",
            accepted_by=[_UPSERT],
            values=_terms(WorkArtifactKind, KIND_MEANINGS),
            note=(
                "kind is part of the row identity (organization, kind, slug, "
                "source_repo): a wrong kind files a SECOND row rather than "
                "correcting the first, and no device-reachable verb removes "
                "the wrong one yet."
            ),
        ),
        ClosedFieldVocabulary(
            field="captured_by",
            written_as="request body `captured_by`",
            accepted_by=[_UPSERT],
            default=_default("captured_by"),
            values=_terms(CapturedBy, CAPTURED_BY_MEANINGS),
        ),
        ClosedFieldVocabulary(
            field="relation",
            written_as="request body `relation`",
            accepted_by=[_EDGE_CREATE],
            values=_terms(WorkArtifactRelation, RELATION_MEANINGS),
            note=RELATION_NOTE,
        ),
        ClosedFieldVocabulary(
            field="difficulty",
            written_as=difficulty_as,
            accepted_by=[_UPSERT],
            values=_terms(DifficultyLevel, DIFFICULTY_LEVEL_MEANINGS),
            note=(
                "Only plans are rated. Omit the stamp and the level is "
                "computed from the body; difficulty_conceptual and "
                "difficulty_implementation are always computed and use the "
                "same three values."
            ),
        ),
        ClosedFieldVocabulary(
            field="state",
            written_as="request body `state` (scan-root report; device token only)",
            accepted_by=[_SCAN_ROOTS],
            values=_terms(ScanRootState, SCAN_ROOT_STATE_MEANINGS),
        ),
        ClosedFieldVocabulary(
            field="censuses[].source",
            written_as="request body `censuses[].source` (scan-root report; device token only)",
            accepted_by=[_SCAN_ROOTS],
            values=_terms(SlugCensusSource, SLUG_CENSUS_SOURCE_MEANINGS),
            note="At most one census per source in a report.",
        ),
        ClosedFieldVocabulary(
            field="size_class",
            written_as=(
                "request body `size_class` (a spawned_followup on POST …/edges; "
                "PUT …/anchors, with size_class_source)"
            ),
            accepted_by=[_EDGE_CREATE, _ANCHORS_PUT],
            values=_terms(FollowupSizeClass, SIZE_CLASS_MEANINGS),
            note="Omitted is UNCLASSIFIED — never read as small.",
        ),
        ClosedFieldVocabulary(
            field="size_class_source",
            written_as=(
                "request body `size_class_source` on PUT …/anchors (POST …/edges "
                "stores `declared` itself)"
            ),
            accepted_by=[_ANCHORS_PUT],
            values=_terms(FollowupSizeClassSource, SIZE_CLASS_SOURCE_MEANINGS),
        ),
        ClosedFieldVocabulary(
            field="resolution",
            written_as="request body `resolution` on POST …/edges/{edge_id}/resolution",
            accepted_by=[_RESOLUTION],
            values=_terms(FollowupTransitionTarget, RESOLUTION_MEANINGS),
            note=(
                "Legal moves: open → fixing | already_fixed | dismissed; fixing → "
                "fixed | open; fixed / already_fixed / dismissed → open (with a "
                "reason). Anything else is a 409 naming the current state."
            ),
        ),
        ClosedFieldVocabulary(
            field="difficulty_source",
            written_as=(
                "set by the server on POST /plan-library — `declared` when "
                "the body carries the stamp, `computed` otherwise; never sent"
            ),
            accepted_by=[],
            server_set=True,
            values=_terms(DifficultySource, DIFFICULTY_SOURCE_MEANINGS),
        ),
    ]


def write_doors() -> list[WriteDoorCorrection]:
    """How a wrong write through each plan-library door is corrected, rendered
    from the posture table the build pins."""
    doors: list[WriteDoorCorrection] = []
    for (method, path), posture in ROUTE_POSTURE.items():
        if path != _PREFIX and not path.startswith(f"{_PREFIX}/"):
            continue
        label: Literal["read", "ephemeral", "evidence"] = "evidence"
        if isinstance(posture, Read):
            label = "read"
        elif isinstance(posture, Ephemeral):
            label = "ephemeral"
        tracked_by = (
            [c.tracked_by for _, c in posture.corrections() if isinstance(c, Gap)]
            if isinstance(posture, Evidence)
            else []
        )
        doors.append(
            WriteDoorCorrection(
                method=method,
                path=path,
                posture=label,
                corrections=correction_sentences(posture),
                tracked_by=tracked_by,
            )
        )
    return doors


def build_vocabulary() -> PlanLibraryVocabularyResponse:
    fields = closed_fields()
    return PlanLibraryVocabularyResponse(
        fields=fields, count=len(fields), write_doors=write_doors()
    )
