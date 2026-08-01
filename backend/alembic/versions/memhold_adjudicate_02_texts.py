"""memhold adjudicate 02 — write the adjudicated text onto the topic-file winners

Revision ID: memhold_adjudicate_02
Revises: memhold_adjudicate_01

Why
---
Final step of plan
``D:/qontinui-root/plans/2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord.md``.

``memhold_adjudicate_01`` landed the operator's 2026-08-01 dispositions (gate
``925c3ab3-9d05-429b-b218-0d1c97262c54``) into ``coord.memory_records``: 138
sidecar rows stamped, 25 superseded onto a ``'topic-file'`` winner, 113
tombstoned, and the hold released on 126. It deliberately touched NO
``content`` — and so it deliberately left two sets HELD:

* the **11 ``'topic-file'`` winner rows**, because their text was still the
  PRE-adjudication text; and
* the **12 ``merged`` / ``loser`` sidecar rows**, because their bodies were the
  INPUT to the merge, and releasing them would have armed ``decay_prune`` on
  the very text this revision writes.

This revision is that follow-up. It writes the adjudicated text onto the
winners and then releases both remaining holds. After it applies, nothing in
the contested set is held: the adjudication is complete.

``memhold_adjudicate_01``'s docstring says the content follow-up would go
through the memory API (``POST /records``) rather than a migration, because
content writes need redaction, content-hashing and embedding. That call was
made when the follow-up was 6 records of ad-hoc DML. It is a migration here
for a different reason and with each of those three concerns answered
explicitly:

* **Redaction** — already applied. The payload is the text as it now stands in
  the adjudicated FILES, which the operator wrote and reviewed on 2026-08-01;
  it is not new material arriving from an untrusted producer.
* **Content-hashing** — reproduced exactly, and CHECKED. The payload carries a
  declared ``content_sha256`` per record and :func:`_assert_payload_integrity`
  recomputes ``sha256(content.encode('utf-8')).hexdigest()`` over the shipped
  bytes before a single row is written. That is character-for-character the
  rule ``memory_store._content_hash`` applies, so the value written to
  ``content_hash`` is the value the write API would have produced.
* **Embedding** — deliberately NOT computed here, and deliberately DESTROYED.
  Each updated row gets ``embedding = NULL`` and ``embedding_model = NULL``.
  That is the designed healing path, not a gap: ``fetch_reindex_batch`` selects
  on ``embedding_model IS DISTINCT FROM :current_tag OR embedding IS NULL``, so
  a NULLed row is picked up by the next re-index sweep and re-embedded by a
  runner. Leaving the OLD vector in place is the failure mode to avoid — it
  would leave a vector describing text that no longer exists, and retrieval
  would keep returning the row for the losing text's meaning. This backend
  loads no embedding model on any live path, so computing one here is not an
  option in any case.

⚠️ **The payload ships beside this file.**
:data:`_PAYLOAD_FILENAME` is read relative to ``__file__``; the alembic version
directory is copied wholesale into the migrator image, so the JSON travels with
the revision. A missing or malformed payload raises rather than degrading to a
no-op: a silent no-op here would leave the winners carrying pre-adjudication
text with their hold RELEASED, which is strictly worse than not running.

⚠️ **The file is read as UTF-8 explicitly.** The payload contains non-ASCII
(the memory corpus is full of ``⚠️``/``📌``/em dashes) and Python's default
text encoding is locale-dependent — on a Windows dev box it is cp1252, which
raises ``UnicodeDecodeError`` on this exact file. It is also what makes the
declared sha reproducible: the hash is over UTF-8 bytes, so the read must be.

How a payload record finds its row
----------------------------------

The target is the ``'topic-file'`` winner for the record's
``(project, base_file)`` — the same winner ``memhold_adjudicate_01`` superseded
that pair's sidecars onto. Resolution therefore REUSES that revision's
fragments verbatim rather than re-deriving them:
:data:`_SIDECAR_ROW_CTE` (per-row sidecar key), :data:`_WINNER_JOIN_ON` (the
JOINable winner predicate) and :data:`_WINNER_LINK_CTE` (the ranking) are
imported from it, which in turn imports ``_SIDECAR_KEY_CTE`` / ``_WINNER_MATCH``
from ``memhold_backfill_01``. All four revisions address one row set or the
migration refuses to run.

The one thing this revision adds is a restriction: :data:`_SIDECAR_MATCH_CTE`
wraps the imported ``_SIDECAR_ROW_CTE`` and narrows it to the payload record's
``(project, base_file)``. Anchoring on the SIDECAR rows rather than on the
winners directly is deliberate — a payload record carries no tenant, and
``s.tenant_id = w.tenant_id`` is the only thing keeping a bare ``source.file``
filename from resolving across tenants. The sidecars carry the tenant; the
payload does not. It also means the ranking that picks among several
``'topic-file'`` rows for one base file is byte-identical to the one Phase 3.3
already used: project-exactness first (``(w.source->>'project' = s.project)
DESC NULLS LAST``), then liveness, then ``created_at``, then ``memory_id``.

📌 **This creates a real dependency on the sidecar rows still existing.** That
is exactly why ``memhold_adjudicate_01`` kept the ``merged`` / ``loser``
sidecars held: had they been released with the rest, ``decay_prune`` could have
deleted them — and with them this revision's only handle on which winner each
payload record belongs to. The hold ordering across the two revisions is load
bearing in both directions.

A payload record that resolves to **no** row, or to **more than one** after
ranking (the shape a second tenant holding the same corpus would produce),
is a DEFECT: it is logged at ERROR with its identifying fields, left untouched,
counted — and then aborts the migration through
:func:`_assert_content_invariants`. Unlike Phase 3.3's unmapped/inert rows,
which were rows without a decision, an unresolvable payload record is a
DECISION without a row: the operator adjudicated this text and it has nowhere
to land, so completing the deploy would report success over lost work.

Interaction with the live-dedup unique index
--------------------------------------------

``uq_memory_records_tenant_content_hash_live`` is PARTIAL on
``(tenant_id, content_hash) WHERE is_tombstone = false AND superseded_by IS
NULL AND valid_until IS NULL``. Phase 3.3 could ignore it — it only ever moved
rows OUT of the index. This revision changes ``content_hash`` on rows that are
IN it, so a collision is reachable: if the adjudicated text is byte-identical
to some other LIVE row in the same tenant, the UPDATE would raise a
``UniqueViolation``, and psycopg2's message for it names the index, not the
record — an opaque way to fail a production deploy.

So the collision is checked FIRST, per record, against
:data:`_LIVE_DEDUP_PREDICATE` (a textual copy of the index's own predicate — a
migration cannot import ``memory_store``). On a hit the record is SKIPPED, the
colliding row is named at ERROR, and it is counted into the partition
invariant. A skip is the right outcome: an identical live row already carries
this text, so the adjudicated content is present in the corpus either way, and
the operator can merge the two by hand with the log naming both ids.

Reversibility
-------------

Before overwriting, each row's ``content`` and ``content_hash`` are stashed
into ``source.adjudication.prior_content`` / ``prior_content_hash``, and
:func:`downgrade` restores from there. Yes, that puts the full prior text in
JSONB — ~78 KB across 6 rows. That is nothing against ``memory_records``, and
it is the difference between a downgrade that works and a docstring that claims
one. The alternative (re-reading the pre-adjudication files at downgrade time)
would make the rollback depend on a directory on one operator's laptop.

The downgrade restores ``content`` + ``content_hash``, re-NULLs ``embedding`` /
``embedding_model`` (so the restored text is re-embedded too — the pre-image
vector is NOT stashed, because restoring the OLD vector over the OLD text is
only correct if nothing else moved, and a NULL is unconditionally correct),
drops the keys this revision added, and re-holds exactly the rows it released.
It does NOT restore ``updated_at``.

Invariants vs measurements
--------------------------

Same discipline as ``memhold_adjudicate_01``: **assert invariants, log
measurements.**

* **Asserted** (:func:`_assert_content_invariants`, ``RuntimeError``): every
  payload record resolved to exactly one row; landed + skipped-for-collision +
  unresolved equals the payload size; no row outside the resolved set carries a
  ``prior_content`` stash (i.e. nothing outside the resolved winners had its
  content touched); no resolved row is an ``(part i/n)`` import chunk.
* **Logged only**: 6 records, 11 winners released, 12 sidecars released, 0
  still held, and the per-record drift between a row's current ``content_hash``
  and the payload's declared ``prior_content_sha256``. The row set can
  legitimately move between the day the payload was authored and the day this
  applies, so those are things to READ, not things to abort a deploy on.

The chunk check exists because the payload was generated on the assumption that
every record is a WHOLE file: the Phase-4a import chunks a source file above
30,000 bytes into ``(part i/n)`` records, and the largest payload record is
25,769 B — comfortably under. If a resolved winner turns out to be a chunk
anyway, the assumption is false and writing a whole file over part 1 of n would
silently corrupt the record. That is an abort, not a warning.

Idempotency
-----------

The UPDATE is guarded on ``content_hash IS DISTINCT FROM`` the new sha, and
both hold releases on the hold actually reading ``'true'``, so a re-run writes
nothing and reports 0/0/0. The partition invariant is counted from the END
state (does the target row NOW carry the new hash?) rather than from the
UPDATE's rowcount, precisely so a re-run re-derives the same 6 instead of
tripping over its own idempotency.
"""

import hashlib
import importlib.util
import json
import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

import sqlalchemy as sa

from alembic import op

# Same channel the sibling data migrations report on, so the migrator
# container's logs carry this revision's blast radius.
logger = logging.getLogger("alembic.runtime.migration")

# revision identifiers, used by Alembic.
revision: str = "memhold_adjudicate_02"
down_revision: str = "memhold_adjudicate_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ---------------------------------------------------------------------------
# Shared row selection — imported from memhold_adjudicate_01, never copied.
# ---------------------------------------------------------------------------
#
# Alembic version files are not a package, so a plain ``from ... import`` does
# not resolve. Load the sibling by path instead, under a private module name so
# nothing collides with alembic's own import of the same file. That module in
# turn loads ``memhold_backfill_01`` the same way, so importing it here pulls
# the whole chain's row selection rather than a copy of it.
_ADJUDICATE_01_FILENAME = "memhold_adjudicate_01_apply_sidecar_dispositions.py"


def _load_adjudicate_01() -> ModuleType:
    """Import the Phase-3.3 revision module by path (it is not importable)."""
    path = Path(__file__).with_name(_ADJUDICATE_01_FILENAME)
    spec = importlib.util.spec_from_file_location(
        "_memhold_adjudicate_01_shared", path
    )
    if spec is None or spec.loader is None:  # pragma: no cover — packaging bug
        raise RuntimeError(
            f"memhold_adjudicate_02 cannot load {path}; the two revisions share "
            "their row selection and must not be separated."
        )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_adj01 = _load_adjudicate_01()

# From memhold_backfill_01, via memhold_adjudicate_01.
_SIDECAR_ORIGIN: str = _adj01._SIDECAR_ORIGIN
_SIDECAR_KEY_CTE: str = _adj01._SIDECAR_KEY_CTE
_WINNER_MATCH: str = _adj01._WINNER_MATCH

# From memhold_adjudicate_01 itself — the per-row sidecar key, the JOINable
# winner predicate, and the RANKING that picks one winner per sidecar.
_SIDECAR_ROW_CTE: str = _adj01._SIDECAR_ROW_CTE
_WINNER_JOIN_ON: str = _adj01._WINNER_JOIN_ON
_WINNER_LINK_CTE: str = _adj01._WINNER_LINK_CTE

# The stamp fields, so the two revisions cannot disagree about which decision
# they are landing.
_PLAN_SLUG: str = _adj01._PLAN_SLUG
_GATE_ID: str = _adj01._GATE_ID
_DECIDED_ON: str = _adj01._DECIDED_ON

_sql_str = _adj01._sql_str
_norm = _adj01._norm
_SIDECAR_ATOMS: tuple[str, ...] = _adj01._SIDECAR_ATOMS
_WINNER_ATOMS: tuple[str, ...] = _adj01._WINNER_ATOMS


# The one fragment this revision writes itself: the imported per-row sidecar
# CTE, narrowed to ONE payload record's (project, base_file). The imported
# fragment is interpolated whole rather than re-typed, so it cannot drift; the
# restriction is the only new SQL, and it is guarded by its own atoms below.
_SIDECAR_MATCH_CTE = f"""
    sidecar AS (
        SELECT sc.*
          FROM ({_SIDECAR_ROW_CTE}) sc
         WHERE sc.project = :project
           AND sc.base_file = :base_file
    )
"""

# The liveness predicate of `uq_memory_records_tenant_content_hash_live`,
# copied textually from `coord_memory_records`'s CREATE UNIQUE INDEX (a
# migration cannot import `memory_store._LIVE_DEDUP_PREDICATE`). It has to be
# the SAME predicate: a broader one would skip records the index would have
# accepted, a narrower one would let the raw IntegrityError through.
_LIVE_DEDUP_PREDICATE = (
    "is_tombstone = false AND superseded_by IS NULL AND valid_until IS NULL"
)

# Atoms of the ranking. `memhold_adjudicate_01` guards WHICH rows join; nothing
# guarded WHICH of several candidates wins, and for this revision that choice
# decides where ~78 KB of adjudicated text lands. Deleting the project-exactness
# key — the term that keeps a same-named file from another project directory
# from outranking the right row — must fail here even though it is another
# revision's constant.
_RANKING_ATOMS = (
    "PARTITION BY s.memory_id",
    "(w.source->>'project' = s.project) DESC NULLS LAST",
    "w.superseded_by IS NULL",
    "w.is_tombstone = false",
    "w.valid_until IS NULL",
    "w.created_at, w.memory_id",
)

# Atoms of the restriction this revision adds. Without both terms every payload
# record resolves against EVERY sidecar, so every record becomes ambiguous —
# caught by the invariants, but this names the cause instead of the symptom.
_RESTRICTION_ATOMS = (
    "sc.project = :project",
    "sc.base_file = :base_file",
)


def _drift_checks() -> tuple[tuple[str, tuple[str, ...], tuple[tuple[str, str], ...]], ...]:
    """(label, atoms, ((fragment name, fragment SQL), ...)) for the guard.

    Each atom is asserted against EVERY listed fragment — the constants
    imported from the two earlier revisions AND the local rewrite this
    revision's DML actually interpolates. ``memhold_adjudicate_01`` shipped
    with its guard reading only the imported originals, which left the strings
    it executed unwatched; that was fixed there and must not be reintroduced
    here.

    A function rather than a module constant so it reads the fragments as they
    are NOW, which is what lets a test mutate one and observe the guard fire.
    """
    return (
        (
            "sidecar key",
            _SIDECAR_ATOMS,
            (
                ("_SIDECAR_KEY_CTE (imported from memhold_backfill_01)", _SIDECAR_KEY_CTE),
                (
                    "_SIDECAR_ROW_CTE (imported from memhold_adjudicate_01)",
                    _SIDECAR_ROW_CTE,
                ),
                ("_SIDECAR_MATCH_CTE (interpolated here)", _SIDECAR_MATCH_CTE),
            ),
        ),
        (
            "winner match",
            _WINNER_ATOMS,
            (
                ("_WINNER_MATCH (imported from memhold_backfill_01)", _WINNER_MATCH),
                (
                    "_WINNER_JOIN_ON (imported from memhold_adjudicate_01)",
                    _WINNER_JOIN_ON,
                ),
                ("_WINNER_LINK_CTE (interpolated here)", _WINNER_LINK_CTE),
            ),
        ),
        (
            "winner ranking",
            _RANKING_ATOMS,
            (("_WINNER_LINK_CTE (interpolated here)", _WINNER_LINK_CTE),),
        ),
        (
            "payload restriction",
            _RESTRICTION_ATOMS,
            (("_SIDECAR_MATCH_CTE (interpolated here)", _SIDECAR_MATCH_CTE),),
        ),
    )


# The dispositions whose hold this revision releases: the two
# `memhold_adjudicate_01` deliberately left held, because their bodies were the
# INPUT to the text this revision writes.
_ADJUDICATED_DISPOSITIONS = ("merged", "loser")

# Every disposition Phase 3.3 can stamp — the structural index rule plus the
# manifest table's own values, read from that revision rather than re-listed.
_ALL_DISPOSITIONS = frozenset({_adj01._INDEX_DISPOSITION}) | {
    decision[-1] for decision in _adj01._CONTENT_DECISIONS
}


def _assert_disposition_coverage() -> None:
    """Every disposition's hold must be released by exactly one revision.

    ``memhold_adjudicate_01`` releases ``_RELEASED_DISPOSITIONS``; this one
    releases :data:`_ADJUDICATED_DISPOSITIONS`. Together they must PARTITION
    the dispositions Phase 3.3 can stamp — no overlap (two revisions fighting
    over one row's hold) and no gap (a disposition nobody ever frees, which is
    a row silently held out of the lifecycle forever).

    Checked here rather than assumed because a fourth disposition added to
    ``_CONTENT_DECISIONS`` later would otherwise land held and unnoticed.
    """
    mine = frozenset(_ADJUDICATED_DISPOSITIONS)
    theirs = frozenset(_adj01._RELEASED_DISPOSITIONS)
    overlap = sorted(mine & theirs)
    if overlap:
        raise RuntimeError(
            "memhold_adjudicate_02: disposition(s) "
            f"{overlap} are released by BOTH memhold_adjudicate_01 and this "
            "revision. Each disposition's hold must come off exactly once — "
            "reconcile _RELEASED_DISPOSITIONS and _ADJUDICATED_DISPOSITIONS."
        )
    missing = sorted(_ALL_DISPOSITIONS - mine - theirs)
    if missing:
        raise RuntimeError(
            "memhold_adjudicate_02: disposition(s) "
            f"{missing} are stamped by memhold_adjudicate_01 but released by "
            "neither revision. A held row is out of EVERY automatic lifecycle "
            "sweep, so a disposition nobody frees is a row held forever."
        )


def _assert_no_drift() -> None:
    """Fail loudly if this revision has parted from the shared row selection.

    Covers both the SQL atoms (every fragment, imported and local) and the
    hold-release partition across the two adjudication revisions.
    """
    for label, atoms, fragments in _drift_checks():
        for name, fragment in fragments:
            normalized = _norm(fragment)
            for atom in atoms:
                if _norm(atom) not in normalized:
                    raise RuntimeError(
                        "memhold_adjudicate_02 has drifted from the shared "
                        f"{label}: {atom!r} is no longer part of {name}. "
                        "Reconcile the revisions before applying — they must "
                        "address the same rows and pick the same winner."
                    )
    _assert_disposition_coverage()


# ---------------------------------------------------------------------------
# The payload.
# ---------------------------------------------------------------------------

_PAYLOAD_FILENAME = "memhold_adjudicate_02_texts.json"

# The Phase-4a import splits a source file above this many bytes into
# ``(part i/n)`` records. The largest payload record is 25,769 B, so every
# record is a WHOLE file and maps to a single row — the assumption the whole
# payload was generated under. `_CHUNK_TITLE` is what falsifies it loudly.
_CHUNK_THRESHOLD_BYTES = 30_000
_CHUNK_TITLE = re.compile(r"\(part\s+\d+\s*/\s*\d+\)")


@dataclass(frozen=True)
class _PayloadRecord:
    """One adjudicated file: where it goes, what it says, and its two hashes."""

    project: str
    base_file: str
    disposition: str
    content: str
    content_sha256: str
    prior_content_sha256: str
    byte_length: int


_REQUIRED_FIELDS = (
    "project",
    "base_file",
    "disposition",
    "content",
    "content_sha256",
    "prior_content_sha256",
    "bytes",
)


def _load_payload() -> tuple[_PayloadRecord, ...]:
    """Read the sibling JSON payload, or raise.

    Read as UTF-8 explicitly: the corpus is full of non-ASCII and Python's
    default text encoding is locale-dependent (cp1252 on a Windows dev box,
    which raises on this exact file). The declared sha is over UTF-8 bytes, so
    the read has to be too.

    Every failure here raises. A payload that cannot be read is not a reason to
    skip the writes and carry on: :func:`upgrade` also RELEASES the holds, so a
    no-op upgrade would free rows that still carry pre-adjudication text.
    """
    path = Path(__file__).with_name(_PAYLOAD_FILENAME)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(
            f"memhold_adjudicate_02 cannot read its payload at {path}: {exc}. "
            "The JSON ships in the alembic version directory beside this "
            "revision and must travel with it into the migrator image."
        ) from exc
    except UnicodeDecodeError as exc:  # pragma: no cover — encoding regression
        raise RuntimeError(
            f"memhold_adjudicate_02 could not decode {path} as UTF-8: {exc}. "
            "The payload is UTF-8 by construction (the declared sha256 is over "
            "its UTF-8 bytes); a decode failure means the file was rewritten."
        ) from exc

    try:
        document: Any = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"memhold_adjudicate_02's payload at {path} is not valid JSON: "
            f"{exc}."
        ) from exc

    if not isinstance(document, dict) or not isinstance(
        document.get("records"), list
    ):
        raise RuntimeError(
            f"memhold_adjudicate_02's payload at {path} is malformed: expected "
            "an object with a 'records' array."
        )

    records: list[_PayloadRecord] = []
    for index, entry in enumerate(document["records"]):
        if not isinstance(entry, dict):
            raise RuntimeError(
                f"memhold_adjudicate_02's payload record {index} is not an "
                "object."
            )
        missing = [field for field in _REQUIRED_FIELDS if field not in entry]
        if missing:
            raise RuntimeError(
                f"memhold_adjudicate_02's payload record {index} is missing "
                f"{missing}."
            )
        record = _PayloadRecord(
            project=str(entry["project"]),
            base_file=str(entry["base_file"]),
            disposition=str(entry["disposition"]),
            content=str(entry["content"]),
            content_sha256=str(entry["content_sha256"]),
            prior_content_sha256=str(entry["prior_content_sha256"]),
            byte_length=int(entry["bytes"]),
        )
        if not record.content:
            raise RuntimeError(
                f"memhold_adjudicate_02's payload record {index} "
                f"({record.project}/{record.base_file}) has empty content; "
                "`content` is NOT NULL and an empty adjudication is a bug, "
                "not a decision."
            )
        records.append(record)

    if not records:
        raise RuntimeError(
            f"memhold_adjudicate_02's payload at {path} carries no records. An "
            "empty payload would release every remaining hold while writing "
            "nothing."
        )
    return tuple(records)


def _assert_payload_integrity(records: Sequence[_PayloadRecord]) -> None:
    """Recompute every declared hash before a single row is written.

    ``sha256(content.encode('utf-8')).hexdigest()`` is the app's exact rule
    (``memory_store._content_hash``), so a record that passes here writes the
    same ``content_hash`` the write API would have produced — and a record that
    fails means the shipped bytes are not the bytes the payload was generated
    from. That is corruption in transit, and it aborts.

    Also rejects two structural impossibilities: two records aimed at the SAME
    ``(project, base_file)`` (they would overwrite each other, and only the
    last would be reversible), and two records with the SAME content (the
    second would collide with the first on the live-dedup index — a self-
    inflicted skip).
    """
    for record in records:
        actual = hashlib.sha256(record.content.encode("utf-8")).hexdigest()
        if actual != record.content_sha256:
            raise RuntimeError(
                "memhold_adjudicate_02 PAYLOAD CORRUPTED: "
                f"{record.project}/{record.base_file} declares content_sha256 "
                f"{record.content_sha256} but its shipped content hashes to "
                f"{actual}. The text in this file is not the text that was "
                "adjudicated — refusing to write it."
            )
        declared_bytes = len(record.content.encode("utf-8"))
        if declared_bytes != record.byte_length:
            raise RuntimeError(
                "memhold_adjudicate_02 PAYLOAD CORRUPTED: "
                f"{record.project}/{record.base_file} declares {record.byte_length} "
                f"byte(s) but its shipped content is {declared_bytes}."
            )
        if record.disposition not in _ADJUDICATED_DISPOSITIONS:
            raise RuntimeError(
                "memhold_adjudicate_02 PAYLOAD MALFORMED: "
                f"{record.project}/{record.base_file} carries disposition "
                f"{record.disposition!r}. Only "
                f"{list(_ADJUDICATED_DISPOSITIONS)} change a winner's text — "
                "the other dispositions were fully landed by "
                "memhold_adjudicate_01 and their holds are already released."
            )
        if record.byte_length >= _CHUNK_THRESHOLD_BYTES:
            raise RuntimeError(
                "memhold_adjudicate_02 PAYLOAD MALFORMED: "
                f"{record.project}/{record.base_file} is {record.byte_length} "
                f"byte(s), at or over the {_CHUNK_THRESHOLD_BYTES}-byte import "
                "chunk threshold. The import would have split it into "
                "'(part i/n)' records, so it does not map to one row."
            )

    keys = [(record.project, record.base_file) for record in records]
    duplicate_keys = sorted({key for key in keys if keys.count(key) > 1})
    if duplicate_keys:
        raise RuntimeError(
            "memhold_adjudicate_02 PAYLOAD MALFORMED: "
            f"{duplicate_keys} appear more than once. Two texts for one target "
            "row overwrite each other and only the last is reversible."
        )
    hashes = [record.content_sha256 for record in records]
    duplicate_hashes = sorted({h for h in hashes if hashes.count(h) > 1})
    if duplicate_hashes:
        raise RuntimeError(
            "memhold_adjudicate_02 PAYLOAD MALFORMED: content_sha256 "
            f"{duplicate_hashes} appears more than once. Identical live content "
            "in one tenant violates uq_memory_records_tenant_content_hash_live, "
            "so the second record could only ever be skipped."
        )


# ---------------------------------------------------------------------------
# Invariants. Assert invariants, log measurements.
# ---------------------------------------------------------------------------

# Measured against prod 2026-08-01, after memhold_adjudicate_01 applied at
# 15:01Z. LOGGED beside the actual counts, never asserted: the row set can
# legitimately move between the day it was measured and the day this applies.
_EXPECTED_RECORDS = 6
_EXPECTED_WINNERS_RELEASED = 11
_EXPECTED_SIDECARS_RELEASED = 12
_EXPECTED_STILL_HELD = 0


def _assert_content_invariants(
    *,
    payload_records: int,
    landed: int,
    collided: int,
    unresolved: int,
    chunked: int,
    stray_content_rows: int,
) -> None:
    """Abort the migration when the writes and the payload disagree.

    None of these can move legitimately, so each raises rather than logs — on
    a forward-only production migration whose writes are not recoverable by
    rollback, failing the deploy while the transaction can still be rolled back
    is the only useful behaviour.

    Split out of :func:`upgrade` and given plain integer arguments so the
    conditions themselves are testable without a database.
    """
    if chunked:
        raise RuntimeError(
            "memhold_adjudicate_02 INVARIANT VIOLATED: "
            f"{chunked} resolved winner row(s) are '(part i/n)' import chunks. "
            "Every payload record is a WHOLE file under the "
            f"{_CHUNK_THRESHOLD_BYTES}-byte chunk threshold, so writing one "
            "over a chunk would overwrite part i with the entire document and "
            "leave the remaining parts contradicting it."
        )
    if unresolved:
        raise RuntimeError(
            "memhold_adjudicate_02 INVARIANT VIOLATED: "
            f"{unresolved} payload record(s) did not resolve to exactly one "
            "'topic-file' winner (see the ERROR lines above for which). An "
            "adjudicated text with nowhere to land is lost work, and this "
            "revision also RELEASES the holds — so completing the deploy would "
            "free the rows that still carry the losing text."
        )
    accounted = landed + collided + unresolved
    if accounted != payload_records:
        raise RuntimeError(
            "memhold_adjudicate_02 INVARIANT VIOLATED: the outcomes do not "
            f"partition the payload — landed {landed} + skipped-for-collision "
            f"{collided} + unresolved {unresolved} = {accounted}, against "
            f"{payload_records} payload record(s). Every record must end in "
            "exactly one outcome."
        )
    if stray_content_rows:
        raise RuntimeError(
            "memhold_adjudicate_02 INVARIANT VIOLATED: "
            f"{stray_content_rows} row(s) OUTSIDE the resolved winners carry a "
            "source.adjudication.prior_content stash. Only this revision "
            "writes that key, so a row carrying one is a row whose content was "
            "overwritten by mistake."
        )


def _dispositions_sql() -> str:
    return ", ".join(_sql_str(name) for name in _ADJUDICATED_DISPOSITIONS)


# ---------------------------------------------------------------------------
# The statements.
# ---------------------------------------------------------------------------

# One payload record → the memory_id(s) of its topic-file winner. `sidecar` is
# the imported per-row CTE narrowed to this record; `_WINNER_LINK_CTE` is Phase
# 3.3's ranking, verbatim. DISTINCT because a base file usually has more than
# one sidecar (the import ran twice) and they all rank onto the same winner —
# more than one DISTINCT winner means the pair is ambiguous, which in prod
# means a second tenant holds the same corpus.
_RESOLVE_WINNER_SQL = f"""
    WITH {_SIDECAR_MATCH_CTE},
    {_WINNER_LINK_CTE}
    SELECT DISTINCT w.winner_id
      FROM winner w
     WHERE w.winner_id IS NOT NULL
"""

_TARGET_STATE_SQL = f"""
    SELECT memory_id,
           tenant_id,
           title,
           content_hash,
           ({_LIVE_DEDUP_PREDICATE}) AS is_live
      FROM coord.memory_records
     WHERE memory_id = :memory_id
"""

# Another LIVE row in the same tenant already holding this content_hash. Uses
# the unique index's own partial predicate, so what it finds is exactly what
# the index would have rejected.
_COLLISION_SQL = f"""
    SELECT memory_id, title
      FROM coord.memory_records
     WHERE tenant_id = :tenant_id
       AND content_hash = :content_hash
       AND memory_id <> :memory_id
       AND {_LIVE_DEDUP_PREDICATE}
     LIMIT 1
"""

# The write. `source.adjudication` does not exist on a winner row (Phase 3.3
# stamped sidecars only), and `jsonb_set` only creates the LAST path element —
# hence COALESCE to an empty object and a `||` merge rather than six nested
# `jsonb_set` calls. `to_jsonb` on the pre-image so the stash survives content
# containing anything at all.
_APPLY_TEXT_SQL = """
    UPDATE coord.memory_records m
       SET content = :content,
           content_hash = :content_hash,
           embedding = NULL,
           embedding_model = NULL,
           updated_at = now(),
           source = jsonb_set(
               m.source,
               '{adjudication}',
               COALESCE(m.source->'adjudication', CAST('{}' AS jsonb))
               || jsonb_build_object(
                   'revision', CAST(:revision AS text),
                   'disposition', CAST(:disposition AS text),
                   'decided', CAST(:decided AS text),
                   'plan', CAST(:plan AS text),
                   'gate', CAST(:gate AS text),
                   'prior_content', to_jsonb(m.content),
                   'prior_content_hash', to_jsonb(m.content_hash)
               ),
               true
           )
     WHERE m.memory_id = :memory_id
       AND m.content_hash IS DISTINCT FROM :content_hash
"""

# Both hold releases key on the hold actually reading 'true', so the downgrade's
# mirror ('false' → 'true') round-trips exactly and touches nothing it did not
# free. `memhold_backfill_01` wrote the JSON boolean; `lower(... ->> ...)`
# is the same TEXT comparison `_not_lifecycle_held` uses, so a malformed value
# reads as not-held rather than aborting.
_RELEASE_WINNERS_SQL = f"""
    WITH sidecar AS ({_SIDECAR_KEY_CTE})
    UPDATE coord.memory_records w
       SET source = jsonb_set(
               w.source, '{{lifecycle_hold}}', CAST('false' AS jsonb), true
           )
     WHERE {_WINNER_MATCH}
       AND lower(w.source->>'lifecycle_hold') = 'true'
"""

_RELEASE_SIDECARS_SQL = f"""
    UPDATE coord.memory_records
       SET source = jsonb_set(
               source, '{{lifecycle_hold}}', CAST('false' AS jsonb), true
           )
     WHERE source->>'origin' = '{_SIDECAR_ORIGIN}'
       AND source->'adjudication'->>'disposition' IN ({_dispositions_sql()})
       AND lower(source->>'lifecycle_hold') = 'true'
"""

# The end-state check: anything in the CONTESTED set — every sidecar plus every
# topic-file winner — still reading held. Expected 0. Counted rather than
# asserted: Phase 3.3 legitimately leaves an UNMAPPED or INERT sidecar held for
# a human, and that is a thing to read, not a deploy to fail.
_STILL_HELD_SQL = f"""
    WITH sidecar AS ({_SIDECAR_KEY_CTE})
    SELECT count(*)
      FROM coord.memory_records w
     WHERE lower(w.source->>'lifecycle_hold') = 'true'
       AND (
            w.source->>'origin' = '{_SIDECAR_ORIGIN}'
            OR ({_WINNER_MATCH})
       )
"""

# Restoring a stash is what makes the downgrade real. `->>` yields SQL text;
# `content` / `content_hash` are TEXT columns, so no cast is needed. The
# embedding is re-NULLed rather than restored — see the module docstring.
_RESTORE_TEXT_SQL = """
    WITH stripped AS (
        SELECT memory_id,
               (source->'adjudication')
                 - 'prior_content'
                 - 'prior_content_hash'
                 - 'revision'
                 - 'disposition'
                 - 'decided'
                 - 'plan'
                 - 'gate' AS rest
          FROM coord.memory_records
         WHERE source->'adjudication' ? 'prior_content'
    )
    UPDATE coord.memory_records m
       SET content = m.source->'adjudication'->>'prior_content',
           content_hash = m.source->'adjudication'->>'prior_content_hash',
           embedding = NULL,
           embedding_model = NULL,
           updated_at = now(),
           source = CASE
                        WHEN s.rest = CAST('{}' AS jsonb)
                            THEN m.source - 'adjudication'
                        ELSE jsonb_set(m.source, '{adjudication}', s.rest)
                    END
      FROM stripped s
     WHERE m.memory_id = s.memory_id
"""

_REHOLD_WINNERS_SQL = f"""
    WITH sidecar AS ({_SIDECAR_KEY_CTE})
    UPDATE coord.memory_records w
       SET source = jsonb_set(
               w.source, '{{lifecycle_hold}}', CAST('true' AS jsonb), true
           )
     WHERE {_WINNER_MATCH}
       AND lower(w.source->>'lifecycle_hold') = 'false'
"""

_REHOLD_SIDECARS_SQL = f"""
    UPDATE coord.memory_records
       SET source = jsonb_set(
               source, '{{lifecycle_hold}}', CAST('true' AS jsonb), true
           )
     WHERE source->>'origin' = '{_SIDECAR_ORIGIN}'
       AND source->'adjudication'->>'disposition' IN ({_dispositions_sql()})
       AND lower(source->>'lifecycle_hold') = 'false'
"""


def upgrade() -> None:
    """Write the adjudicated text, then release the two remaining holds."""
    _assert_no_drift()
    records = _load_payload()
    _assert_payload_integrity(records)
    conn = op.get_bind()

    resolved: list[tuple[_PayloadRecord, Any]] = []
    landed = 0
    updated = 0
    collided = 0
    unresolved = 0
    chunked = 0
    drifted = 0

    for record in records:
        # -- resolve ------------------------------------------------------
        candidates = [
            row[0]
            for row in conn.execute(
                sa.text(_RESOLVE_WINNER_SQL),
                {"project": record.project, "base_file": record.base_file},
            ).all()
        ]
        if len(candidates) != 1:
            unresolved += 1
            logger.error(
                "memhold_adjudicate_02: UNRESOLVED payload record — "
                "project=%s base_file=%s disposition=%s resolved to %d "
                "'topic-file' winner(s), expected exactly 1. Nothing was "
                "written for it. 0 means the winner (or its sidecars) is not "
                "in coord; more than 1 means the pair is ambiguous — most "
                "likely a second tenant holding the same imported corpus, "
                "since a payload record carries no tenant of its own.",
                record.project,
                record.base_file,
                record.disposition,
                len(candidates),
            )
            continue

        target_id = candidates[0]
        target = (
            conn.execute(sa.text(_TARGET_STATE_SQL), {"memory_id": target_id})
            .mappings()
            .one()
        )
        resolved.append((record, target_id))

        # -- the chunk assumption -----------------------------------------
        if _CHUNK_TITLE.search(str(target["title"])):
            chunked += 1
            logger.error(
                "memhold_adjudicate_02: CHUNKED winner row — memory_id=%s "
                "title=%r for project=%s base_file=%s. The payload was "
                "generated on the assumption that every record is a WHOLE file "
                "(largest is 25,769 B, under the %d-byte import chunk "
                "threshold), so a '(part i/n)' row means that assumption is "
                "false. Aborting rather than overwriting part i with the whole "
                "document.",
                target_id,
                target["title"],
                record.project,
                record.base_file,
                _CHUNK_THRESHOLD_BYTES,
            )
            continue

        # -- measurement: has the row moved since the payload was authored?
        current_hash = str(target["content_hash"])
        if current_hash not in (record.prior_content_sha256, record.content_sha256):
            drifted += 1
            logger.warning(
                "memhold_adjudicate_02: the pre-adjudication content_hash of "
                "memory_id=%s (project=%s base_file=%s) is %s, but the payload "
                "was generated against %s. The row moved between authoring and "
                "apply. Writing the adjudicated text anyway — the operator's "
                "decision is authoritative — and the overwritten text is "
                "stashed in source.adjudication.prior_content.",
                target_id,
                record.project,
                record.base_file,
                current_hash,
                record.prior_content_sha256,
            )

        # -- the live-dedup unique index ----------------------------------
        if bool(target["is_live"]):
            clash = (
                conn.execute(
                    sa.text(_COLLISION_SQL),
                    {
                        "tenant_id": target["tenant_id"],
                        "content_hash": record.content_sha256,
                        "memory_id": target_id,
                    },
                )
                .mappings()
                .first()
            )
            if clash is not None:
                collided += 1
                logger.error(
                    "memhold_adjudicate_02: SKIPPED on a content-hash "
                    "collision — memory_id=%s (project=%s base_file=%s) would "
                    "take content_hash %s, which live row memory_id=%s "
                    "(title=%r) in the same tenant already holds. "
                    "uq_memory_records_tenant_content_hash_live would reject "
                    "the write with an error naming only the index. The "
                    "adjudicated text is already in the corpus on that row; "
                    "merge the two by hand.",
                    target_id,
                    record.project,
                    record.base_file,
                    record.content_sha256,
                    clash["memory_id"],
                    clash["title"],
                )
                continue

        # -- the write ----------------------------------------------------
        updated += conn.execute(
            sa.text(_APPLY_TEXT_SQL),
            {
                "memory_id": target_id,
                "content": record.content,
                "content_hash": record.content_sha256,
                "revision": revision,
                "disposition": record.disposition,
                "decided": _DECIDED_ON,
                "plan": _PLAN_SLUG,
                "gate": _GATE_ID,
            },
        ).rowcount

    # ------------------------------------------------------------------
    # Landed, counted from the END state rather than from the rowcounts.
    # A re-run writes nothing (the UPDATE is guarded on the hash), so the
    # rowcount is 0 and only an end-state count can still answer "is this
    # record's text in place?" — which is what the partition invariant is
    # actually about.
    # ------------------------------------------------------------------
    for record, target_id in resolved:
        current_hash = conn.execute(
            sa.text(
                """
                SELECT content_hash
                  FROM coord.memory_records
                 WHERE memory_id = :memory_id
                """
            ),
            {"memory_id": target_id},
        ).scalar()
        if current_hash == record.content_sha256:
            landed += 1

    # No row outside the resolved winners may carry a `prior_content` stash —
    # only this revision writes that key, so one elsewhere is content
    # overwritten by mistake.
    exclusions = {
        f"id{index}": target_id
        for index, (_, target_id) in enumerate(resolved)
    }
    not_resolved = " AND ".join(
        f"memory_id <> :{name}" for name in exclusions
    ) or "true"
    stray = (
        conn.execute(
            sa.text(
                f"""
                SELECT count(*)
                  FROM coord.memory_records
                 WHERE source->'adjudication' ? 'prior_content'
                   AND {not_resolved}
                """
            ),
            exclusions,
        ).scalar()
        or 0
    )

    _assert_content_invariants(
        payload_records=len(records),
        landed=landed,
        collided=collided,
        unresolved=unresolved,
        chunked=chunked,
        stray_content_rows=int(stray),
    )

    # ------------------------------------------------------------------
    # The holds, AFTER the content lands. Everything in the contested set
    # is now adjudicated, so nothing in it should remain held.
    # ------------------------------------------------------------------
    winners_released = conn.execute(sa.text(_RELEASE_WINNERS_SQL)).rowcount
    sidecars_released = conn.execute(sa.text(_RELEASE_SIDECARS_SQL)).rowcount
    still_held = conn.execute(sa.text(_STILL_HELD_SQL)).scalar() or 0

    logger.info(
        "memhold_adjudicate_02: %d payload record(s); wrote %d row(s) this "
        "run, %d landed in total (content + content_hash set, embedding and "
        "embedding_model NULLed for the re-index sweep to heal), %d skipped on "
        "a content-hash collision, %d unresolved, %d row(s) had drifted from "
        "the payload's prior hash. Released the hold on %d topic-file "
        "winner(s) and %d '%s' sidecar(s); %d row(s) in the contested set are "
        "still held. Measured expectations (prod 2026-08-01, after "
        "memhold_adjudicate_01): %d records, %d winners released, %d sidecars "
        "released, %d still held — those are measurements, so a difference is "
        "worth reading, not necessarily a fault. A re-run reports 0 written, "
        "0 released.",
        len(records),
        updated,
        landed,
        collided,
        unresolved,
        drifted,
        winners_released,
        sidecars_released,
        "/".join(_ADJUDICATED_DISPOSITIONS),
        still_held,
        _EXPECTED_RECORDS,
        _EXPECTED_WINNERS_RELEASED,
        _EXPECTED_SIDECARS_RELEASED,
        _EXPECTED_STILL_HELD,
    )


def downgrade() -> None:
    """Restore the pre-adjudication text from the stash and re-hold.

    Faithful for ``content`` and ``content_hash``. NOT faithful for
    ``embedding`` / ``embedding_model`` (re-NULLed, so the restored text is
    re-embedded by the next sweep — the pre-image vector is not stashed) or
    ``updated_at``. See the module docstring.
    """
    _assert_no_drift()
    conn = op.get_bind()

    restored = conn.execute(sa.text(_RESTORE_TEXT_SQL)).rowcount
    reheld_winners = conn.execute(sa.text(_REHOLD_WINNERS_SQL)).rowcount
    reheld_sidecars = conn.execute(sa.text(_REHOLD_SIDECARS_SQL)).rowcount

    logger.info(
        "memhold_adjudicate_02 downgrade: restored content + content_hash on "
        "%d row(s) from source.adjudication.prior_content and dropped this "
        "revision's stamp; re-held %d topic-file winner(s) and %d '%s' "
        "sidecar(s). embedding / embedding_model are re-NULLed rather than "
        "restored, and updated_at is not restored.",
        restored,
        reheld_winners,
        reheld_sidecars,
        "/".join(_ADJUDICATED_DISPOSITIONS),
    )
