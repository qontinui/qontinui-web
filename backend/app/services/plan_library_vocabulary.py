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
    SPEC_KIND_STATUS_LITERALS,
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
from app.schemas.plan_library_scan_roots import ScanRootState, SlugCensusSource
from app.services.plan_difficulty import MODEL_TIERS

_PREFIX: Final = "/api/v1/plan-library"
_UPSERT: Final = f"POST {_PREFIX}"
_EDGE_CREATE: Final = f"POST {_PREFIX}/{{artifact_id}}/edges"
_SCAN_ROOTS: Final = f"POST {_PREFIX}/scan-roots"

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
    "request": (
        "Specification family: a stakeholder ask as received, before analysis. "
        "Gets a stable spec_ref (RQ-0001) and a closed status lifecycle."
    ),
    "requirement": (
        "Specification family: one testable statement of required behaviour "
        "(EARS form where it fits). Gets a stable spec_ref (REQ-0001)."
    ),
    "interface_mapping": (
        "Specification family: a field-level mapping between two interfaces "
        "(source, target, transformation rule). Gets a stable spec_ref (IFM-0001)."
    ),
    "story": (
        "Specification family: a deliverable slice of a requirement, sized for "
        "one delivery cycle. Gets a stable spec_ref (STY-0001)."
    ),
    "test_case": (
        "Specification family: a test that verifies a requirement or story. "
        "Gets a stable spec_ref (TC-0001)."
    ),
    "doc_correction": (
        "Specification family: a proposed correction to existing documentation. "
        "Gets a stable spec_ref (DOC-0001)."
    ),
}

#: What each status in a specification kind's lifecycle asserts, keyed
#: ``kind → status → meaning``. The VALUES come from the per-kind ``Literal``s
#: in ``app.schemas.plan_library``; only the sentences live here.
SPEC_STATUS_MEANINGS: Final[dict[str, dict[str, str]]] = {
    "request": {
        "new": "Received and not yet looked at (the default).",
        "triaged": "Looked at, scoped and assigned for analysis.",
        "accepted": "Taken on: requirements will be derived from it.",
        "rejected": "Declined; no requirements will be derived from it.",
        "withdrawn": "Withdrawn by whoever asked for it.",
    },
    "requirement": {
        "draft": "Being written; not yet put forward (the default).",
        "proposed": "Put forward for review.",
        "approved": "Agreed; ready to be implemented.",
        "implemented": "Delivered by a change; not yet verified.",
        "verified": "Shown to hold by its test cases.",
        "deprecated": "No longer required; kept for traceability.",
        "rejected": "Reviewed and not agreed.",
    },
    "interface_mapping": {
        "draft": "Being written (the default).",
        "in_review": "Put forward for review.",
        "approved": "Agreed; the mapping is authoritative.",
        "deprecated": "No longer in force; kept for traceability.",
    },
    "story": {
        "draft": "Being written (the default).",
        "ready": "Refined and ready to be picked up.",
        "in_progress": "Being delivered.",
        "done": "Delivered.",
        "cancelled": "Will not be delivered.",
    },
    "test_case": {
        "draft": "Being written (the default).",
        "ready": "Written and runnable; no result recorded yet.",
        "passing": "Its last recorded run passed.",
        "failing": "Its last recorded run failed.",
        "blocked": "Cannot run (environment, data or dependency missing).",
        "retired": "No longer run; kept for traceability.",
    },
    "doc_correction": {
        "proposed": "Suggested and awaiting a decision (the default).",
        "accepted": "Agreed; not yet applied to the document.",
        "applied": "Applied to the document.",
        "rejected": "Declined.",
    },
}

CAPTURED_BY_MEANINGS: Final[dict[str, str]] = {
    "runner_scan": "The runner's deterministic scan of a plans directory wrote the row.",
    "agent": "An agent wrote the row through a write door (the default).",
    "operator": "A human wrote the row from the web console.",
}

#: The routing sense of each level; the model names come from
#: ``plan_difficulty.MODEL_TIERS`` (the one served display copy), never retyped.
_DIFFICULTY_LEVEL_SENSE: Final[dict[str, str]] = {
    "low": "A fast model tier is enough to vet and implement it",
    "medium": "A mid model tier is well suited to it",
    "high": "Needs the strongest model tier",
}

DIFFICULTY_LEVEL_MEANINGS: Final[dict[str, str]] = {
    level: f"{sense} ({MODEL_TIERS[level]})."
    for level, sense in _DIFFICULTY_LEVEL_SENSE.items()
    if level in MODEL_TIERS
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
    "derives_from": (
        "THIS artifact was DERIVED FROM THAT one (a requirement from a request). "
        "Two-ended."
    ),
    "refines": (
        "THIS artifact is a more detailed statement of THAT one (a story refines "
        "a requirement). Two-ended."
    ),
    "implements": (
        "THIS artifact IMPLEMENTS THAT one (a plan implements a requirement). "
        "Two-ended."
    ),
    "verifies": (
        "THIS artifact VERIFIES THAT one (a test case verifies a requirement). "
        "Two-ended."
    ),
    "traces_to": (
        "A traceability link with no stronger meaning; prefer derives_from, "
        "refines, implements or verifies when one fits. Two-ended."
    ),
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
        *spec_status_fields(),
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


def spec_status_field_name(kind: str) -> str:
    """How a spec kind's status lifecycle is named on the route."""
    return f"status[kind={kind}]"


def spec_status_fields() -> list[ClosedFieldVocabulary]:
    """One entry per specification kind: its closed ``status`` lifecycle.

    ``status`` is opaque for every other kind, so it is served per spec kind
    rather than as one field. The first value is the default.
    """
    return [
        ClosedFieldVocabulary(
            field=spec_status_field_name(kind),
            written_as=f"request body `status` when `kind` is `{kind}`",
            accepted_by=[_UPSERT],
            default=get_args(literal)[0],
            values=_terms(literal, SPEC_STATUS_MEANINGS.get(kind, {})),
            note=(
                "Closed for this kind only — a value outside the lifecycle is "
                "a 422; omitted, it is the first value. For every kind outside "
                "the specification family status stays opaque free text."
            ),
        )
        for kind, literal in SPEC_KIND_STATUS_LITERALS.items()
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
