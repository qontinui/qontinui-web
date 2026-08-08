"""Loader + validation for the checked-in memory-recall golden set.

The golden set is DATA in the tree, not rows in a database — see the
plan's §0 "Discovered prior art", which rejects the existing
``project.evaluation_datasets`` table for this purpose. A checked-in
fixture can be diffed in review, pinned to a commit, and reproduced from
the tree alone; a DB-resident one can do none of those.

Validation is strict and eager. Every defect this module rejects is one
that would otherwise surface as a plausible-looking score: a case whose
``relevant`` names a record that was never seeded scores a silent zero
recall, and a correction pair pointing at a missing record scores a
silent precedence failure. Both look exactly like a retrieval regression.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from app.services.memory_vectors import EMBEDDING_DIM, EMBEDDING_MODEL_TAG

GOLDEN_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "memory_golden"

#: Provenance tags accepted in ``records.json`` / ``cases.json``.
#:
#: The backend embeds NOTHING by design (``app/services/memory_vectors.py``;
#: the ban is enforced by ``tests/test_no_fastembed_import.py``), so the
#: harness cannot compute a real vector even if it wanted to — vectors are
#: generated out-of-band by a runner and committed. The tag records which
#: generator produced them, because it changes what the hybrid arm's
#: numbers MEAN:
#:
#: * ``minilm-l6-v2-256@sentence-transformers`` — real vectors from the
#:   deployed space. The only provenance under which a hybrid score says
#:   anything about semantic retrieval.
#: * ``hashing-stub-v1`` — the deterministic bag-of-words stub from
#:   ``test_memory_api_db.py``. Exercises fusion MECHANICS only: two texts
#:   sharing no content words are near-orthogonal under it, exactly like
#:   FTS, so a vocabulary-mismatch case scored under this tag measures the
#:   stub rather than the system.
REAL_EMBEDDING_SOURCE = EMBEDDING_MODEL_TAG
STUB_EMBEDDING_SOURCE = "hashing-stub-v1"
ACCEPTED_EMBEDDING_SOURCES = frozenset({REAL_EMBEDDING_SOURCE, STUB_EMBEDDING_SOURCE})

VALID_KINDS = frozenset(
    {
        "observation",
        "fact",
        "mental_model",
        "episode",
        "feedback",
        "reference",
        "rule",
        "library",
    }
)

#: Case classes the plan's §2.1 names, plus ``general`` for the rest.
VALID_CASE_CLASSES = frozenset(
    {
        "correction",
        "vocabulary_mismatch",
        "recency_conflict",
        "general",
    }
)

#: The ``coord.memory_links`` relation vocabulary, mirroring the CHECK in the
#: ``coord_memory_links`` migration and ``MemoryLinkRelation``.
VALID_RELATIONS = frozenset({"depends_on", "implements", "supersedes", "related"})


class GoldenSetError(ValueError):
    """The fixture on disk is not a valid golden set."""


@dataclass(frozen=True)
class GoldenLink:
    """One outbound ``coord.memory_links`` edge, by fixture key.

    Keyed the same way cases are — by ``key``, never by ``memory_id``, which
    does not exist until seed time.
    """

    target_key: str
    relation: str


@dataclass(frozen=True)
class GoldenRecord:
    """One seeded corpus record.

    ``key`` is a stable, human-readable local identifier used by the cases
    to refer to this record. It is NOT the ``memory_id`` — those are
    assigned by the database at seed time, so the fixture cannot know them
    and must not pretend to.
    """

    key: str
    title: str
    content: str
    kind: str
    importance: float
    embedding: list[float] | None
    links: tuple[GoldenLink, ...] = ()

    @property
    def content_bytes(self) -> int:
        """UTF-8 byte length of the content — the token-cost unit."""
        return len(self.content.encode("utf-8"))


@dataclass(frozen=True)
class GoldenCase:
    """One ``(query, relevant_record_keys, rationale)`` triple."""

    case_id: str
    query_text: str
    relevant: tuple[str, ...]
    rationale: str
    case_class: str
    query_embedding: list[float] | None
    #: ``(corrector_key, corrected_key)`` for a correction pair, else None.
    correction: tuple[str, str] | None


@dataclass(frozen=True)
class GoldenSet:
    """The validated fixture: records to seed + cases to score."""

    embedding_source: str
    records: tuple[GoldenRecord, ...]
    cases: tuple[GoldenCase, ...]

    @property
    def vectors_committed(self) -> bool:
        """True when the fixture carries vectors rather than deriving them.

        A fixture with no ``embedding`` fields is still valid: the harness
        derives stub vectors at seed time so the hybrid arm can be exercised
        for its MECHANICS. Committing 384 floats per record is only worth it
        once those floats are real.
        """
        return any(r.embedding is not None for r in self.records)

    @property
    def has_real_vectors(self) -> bool:
        """True when the committed vectors came from the deployed space.

        The hybrid arm's numbers are interpretable as SEMANTIC retrieval
        quality ONLY when this is true. Both conditions are required: the
        manifest must claim the deployed space AND the vectors must actually
        be committed — a manifest tag alone proves nothing.
        See :data:`ACCEPTED_EMBEDDING_SOURCES`.
        """
        return self.embedding_source == REAL_EMBEDDING_SOURCE and self.vectors_committed

    def content_bytes_by_key(self) -> Mapping[str, int]:
        """Key → content byte length, for :func:`scorer.token_cost`."""
        return {r.key: r.content_bytes for r in self.records}

    @property
    def link_count(self) -> int:
        """Total declared edges. Zero means the link arm has nothing to do."""
        return sum(len(r.links) for r in self.records)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise GoldenSetError(message)


def _validate_vector(vector: object, where: str) -> list[float]:
    _require(isinstance(vector, list), f"{where}: embedding must be a list")
    assert isinstance(vector, list)  # narrowed by _require
    _require(
        len(vector) == EMBEDDING_DIM,
        f"{where}: embedding has {len(vector)} components, expected {EMBEDDING_DIM}",
    )
    _require(
        all(isinstance(x, (int, float)) for x in vector),
        f"{where}: embedding must contain only numbers",
    )
    return [float(x) for x in vector]


def _load_records(raw: object) -> tuple[tuple[GoldenRecord, ...], bool]:
    _require(isinstance(raw, list), "records.json: top level must be a list")
    assert isinstance(raw, list)
    _require(bool(raw), "records.json: the corpus is empty")

    records: list[GoldenRecord] = []
    seen: set[str] = set()
    any_embedded = False
    for index, item in enumerate(raw):
        where = f"records.json[{index}]"
        _require(isinstance(item, dict), f"{where}: must be an object")
        assert isinstance(item, dict)
        for field in ("key", "title", "content", "kind"):
            _require(field in item, f"{where}: missing required field {field!r}")
        key = item["key"]
        _require(isinstance(key, str) and bool(key), f"{where}: key must be a string")
        _require(key not in seen, f"{where}: duplicate record key {key!r}")
        seen.add(key)
        _require(
            item["kind"] in VALID_KINDS,
            f"{where}: kind {item['kind']!r} is not one of {sorted(VALID_KINDS)}",
        )
        importance = float(item.get("importance", 0.5))
        _require(
            0.0 <= importance <= 1.0,
            f"{where}: importance {importance} outside [0, 1]",
        )
        embedding = item.get("embedding")
        if embedding is not None:
            embedding = _validate_vector(embedding, where)
            any_embedded = True
        records.append(
            GoldenRecord(
                key=key,
                title=item["title"],
                content=item["content"],
                kind=item["kind"],
                importance=importance,
                embedding=embedding,
                links=_load_links(item.get("links"), where),
            )
        )

    # Targets are resolved after the whole corpus is known — an edge may
    # legitimately point forwards.
    known = {r.key for r in records}
    for record in records:
        for link in record.links:
            _require(
                link.target_key in known,
                f"records.json: record {record.key!r} links to unknown key "
                f"{link.target_key!r}",
            )
            _require(
                link.target_key != record.key,
                f"records.json: record {record.key!r} links to itself — the "
                "write path drops self-edges, so this would silently seed "
                "nothing",
            )
    return tuple(records), any_embedded


def _load_links(raw: object, where: str) -> tuple[GoldenLink, ...]:
    """Parse and validate one record's outbound edges.

    Target existence is NOT checked here — see :func:`_load_records`, which
    checks it once the whole corpus is known.
    """
    if raw is None:
        return ()
    _require(isinstance(raw, list), f"{where}: links must be a list")
    assert isinstance(raw, list)
    links: list[GoldenLink] = []
    seen: set[tuple[str, str]] = set()
    for index, item in enumerate(raw):
        at = f"{where}.links[{index}]"
        _require(isinstance(item, dict), f"{at}: must be an object")
        assert isinstance(item, dict)
        for field in ("target_key", "relation"):
            _require(field in item, f"{at}: missing required field {field!r}")
        relation = item["relation"]
        _require(
            relation in VALID_RELATIONS,
            f"{at}: relation {relation!r} is not one of {sorted(VALID_RELATIONS)}",
        )
        edge = (item["target_key"], relation)
        _require(edge not in seen, f"{at}: duplicate edge {edge!r}")
        seen.add(edge)
        links.append(GoldenLink(target_key=item["target_key"], relation=relation))
    return tuple(links)


def _reject_circular_edges(
    records: Sequence[GoldenRecord], cases: Sequence[GoldenCase]
) -> None:
    """Refuse an edge that reproduces a case's answer key.

    **This is what makes the link arm's score mean anything.** An edge drawn
    between exactly the two records a case declares ``relevant`` lets the
    expansion arm retrieve the second from the first BY CONSTRUCTION, so the
    benchmark would be measuring the fixture rather than the system — and it
    would measure it in the flattering direction, which is the kind of error
    nobody goes looking for.

    Edges must therefore be derivable from the RECORDS alone. The one
    exception is a case's own declared ``correction`` pair: those two records
    announce their relationship in their own titles (``CORRECTION: …``), so a
    ``supersedes`` edge between them expresses something the corpus already
    states rather than importing the answer key.
    """
    sanctioned = {
        frozenset(case.correction) for case in cases if case.correction is not None
    }
    # Checked as a SUBSET, not an equality: an edge between two members of a
    # three-record answer key hands the arm one of those records for free just
    # as surely as one between the two members of a pair. Equality would let
    # the wider cases through.
    answer_keys = [
        (frozenset(case.relevant), case.case_id)
        for case in cases
        if len(case.relevant) >= 2
    ]
    for record in records:
        for link in record.links:
            pair = frozenset({record.key, link.target_key})
            if pair in sanctioned:
                continue
            case_id = next(
                (cid for relevant, cid in answer_keys if pair <= relevant), None
            )
            _require(
                case_id is None,
                f"records.json: the edge {record.key!r} -[{link.relation}]-> "
                f"{link.target_key!r} joins two records inside the relevant "
                f"set of case {case_id!r}, which declares no correction pair. "
                "An edge "
                "copied from a case's answer key makes the link arm retrieve "
                "that answer by construction — the benchmark would score the "
                "fixture, not the system. Author edges from the records.",
            )


def _load_cases(raw: object, record_keys: set[str]) -> tuple[GoldenCase, ...]:
    _require(isinstance(raw, list), "cases.json: top level must be a list")
    assert isinstance(raw, list)
    _require(bool(raw), "cases.json: the case set is empty")

    cases: list[GoldenCase] = []
    seen: set[str] = set()
    for index, item in enumerate(raw):
        where = f"cases.json[{index}]"
        _require(isinstance(item, dict), f"{where}: must be an object")
        assert isinstance(item, dict)
        for field in ("case_id", "query_text", "relevant", "rationale"):
            _require(field in item, f"{where}: missing required field {field!r}")
        case_id = item["case_id"]
        _require(isinstance(case_id, str) and bool(case_id), f"{where}: bad case_id")
        _require(case_id not in seen, f"{where}: duplicate case_id {case_id!r}")
        seen.add(case_id)

        relevant = item["relevant"]
        _require(isinstance(relevant, list), f"{where}: relevant must be a list")
        assert isinstance(relevant, list)
        # A case with no relevant record scores a structural zero on every
        # metric and would silently drag the suite mean down — reject it as
        # a fixture bug rather than reporting it as a retrieval failure.
        _require(bool(relevant), f"{where}: relevant is empty")
        for key in relevant:
            _require(
                key in record_keys,
                f"{where}: relevant names unknown record key {key!r}",
            )

        case_class = item.get("class", "general")
        _require(
            case_class in VALID_CASE_CLASSES,
            f"{where}: class {case_class!r} not one of {sorted(VALID_CASE_CLASSES)}",
        )

        correction_raw = item.get("correction")
        correction: tuple[str, str] | None = None
        if correction_raw is not None:
            _require(
                isinstance(correction_raw, dict)
                and "corrector" in correction_raw
                and "corrected" in correction_raw,
                f"{where}: correction needs 'corrector' and 'corrected'",
            )
            corrector = correction_raw["corrector"]
            corrected = correction_raw["corrected"]
            for role, key in (("corrector", corrector), ("corrected", corrected)):
                _require(
                    key in record_keys,
                    f"{where}: correction.{role} names unknown record key {key!r}",
                )
            _require(
                corrector != corrected,
                f"{where}: correction.corrector and .corrected are the same record",
            )
            # The corrector must be judged relevant, or precedence and
            # recall would disagree about the same case.
            _require(
                corrector in relevant,
                f"{where}: correction.corrector {corrector!r} is not in relevant",
            )
            correction = (corrector, corrected)

        query_embedding = item.get("query_embedding")
        if query_embedding is not None:
            query_embedding = _validate_vector(query_embedding, where)

        cases.append(
            GoldenCase(
                case_id=case_id,
                query_text=item["query_text"],
                relevant=tuple(relevant),
                rationale=item["rationale"],
                case_class=case_class,
                query_embedding=query_embedding,
                correction=correction,
            )
        )
    return tuple(cases)


def load_golden_set(directory: Path | None = None) -> GoldenSet:
    """Read, validate and return the golden set.

    Raises :class:`GoldenSetError` on any structural defect — an unknown
    record key, a duplicate id, a wrong-dimension vector, an unrecognised
    provenance tag. Loud is correct here: every one of these would
    otherwise be reported as a retrieval result.
    """
    root = directory or GOLDEN_DIR
    manifest_path = root / "manifest.json"
    records_path = root / "records.json"
    cases_path = root / "cases.json"
    for path in (manifest_path, records_path, cases_path):
        _require(path.is_file(), f"golden set incomplete: {path} is missing")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    _require(
        isinstance(manifest, dict) and "embedding_source" in manifest,
        "manifest.json: missing 'embedding_source'",
    )
    source = manifest["embedding_source"]
    _require(
        source in ACCEPTED_EMBEDDING_SOURCES,
        f"manifest.json: embedding_source {source!r} not one of "
        f"{sorted(ACCEPTED_EMBEDDING_SOURCES)}",
    )

    records, any_embedded = _load_records(
        json.loads(records_path.read_text(encoding="utf-8"))
    )
    cases = _load_cases(
        json.loads(cases_path.read_text(encoding="utf-8")),
        {r.key for r in records},
    )
    _reject_circular_edges(records, cases)

    # Vectors are all-or-nothing per fixture: a partially-embedded corpus
    # makes the hybrid arm score a subset of the corpus while the FTS arm
    # scores all of it, so the two arms would not be comparable — which is
    # the entire point of running both.
    # NOTE: `_require(cond, msg)` evaluates `msg` EAGERLY — it is an ordinary
    # argument, not a lambda. So the message must never index a list that is
    # empty in the PASSING case. An earlier version interpolated
    # `missing[0]` directly and raised IndexError exactly when the fixture was
    # valid, which stayed invisible for as long as no fixture carried vectors
    # (`any_embedded` was False, so this block never ran at all). Build the
    # message only inside the failure branch.
    if any_embedded:
        missing = [r.key for r in records if r.embedding is None]
        if missing:
            raise GoldenSetError(
                f"records.json: embeddings are partial — {len(missing)} "
                f"record(s) have none (first: {missing[0]!r}). Embed all or "
                "none: a hybrid arm scoring a subset while the FTS arm scores "
                "everything makes the two arms incomparable."
            )
        case_missing = [c.case_id for c in cases if c.query_embedding is None]
        if case_missing:
            raise GoldenSetError(
                f"cases.json: corpus is embedded but {len(case_missing)} "
                f"case(s) have no query_embedding (first: {case_missing[0]!r})"
            )

    return GoldenSet(embedding_source=source, records=records, cases=cases)


def resolve_keys(
    ranked_ids: Sequence[str], key_by_memory_id: Mapping[str, str]
) -> list[str]:
    """Map returned ``memory_id``s back to fixture keys, order preserved.

    Ids the fixture did not seed are kept as-is (prefixed ``unseeded:``) so
    they still count against the noise rate — dropping them would let a
    ranker return arbitrary junk for free.
    """
    return [key_by_memory_id.get(mid, f"unseeded:{mid}") for mid in ranked_ids]
