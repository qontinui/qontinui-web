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

Resolution is then CHECKED twice more, and both checks abort:

* **The winner must be LIVE.** The ranking PREFERS a live row but does not
  require one — with a single candidate it returns that candidate whatever its
  state. A tombstoned / superseded / validity-ended winner is outside every
  retrieval selector, so writing the operator's text onto it is lost work that
  reports as ``landed``, with the hold released on top.
* **The winner must be the one ``memhold_adjudicate_01`` already chose.** That
  revision superseded each ``merged``/``loser`` sidecar ONTO its adjudicated
  winner, and that pointer is a human decision already landed in prod. This
  revision only RE-derives the same ranking, so a disagreement means the corpus
  moved between the two applies and ~25 KB of content would go to a row the
  adjudication did not pick. A NULL pointer is not a disagreement (there is
  nothing to compare) and warns instead.

Which holds come off
--------------------

⚠️ **Both releases are restricted to the set the payload COVERS**, and that
restriction is load bearing rather than an optimisation. Keyed on the
disposition alone they free every ``merged``/``loser`` sidecar and every
``_WINNER_MATCH`` winner in the corpus — including a pair this payload says
nothing about, and including the rows ``memhold_adjudicate_01`` deliberately
left **INERT** for a human. A winner freed without its text rewritten keeps its
PRE-adjudication body while ``decay_prune`` is armed on the sidecars that are
its only provenance, and the run exits 0 with nothing logged.

* **Sidecars** — released when a payload record covers their
  ``(project, base_file)``.
* **Winners** — released when NO uncovered ``merged``/``loser`` sidecar still
  points at them. Deliberately *not* "only the rows this run wrote to": prod
  holds 11 winners against 6 payload records, because five of them answer
  sidecars dispositioned ``winner``, whose text was already correct. There is
  nothing for this revision to write on those and nothing left to wait for.
  What must never be released is a winner whose ``merged``/``loser`` input this
  payload does not answer.

Anything in that set still held after the releases is therefore, by
construction, a pair the payload does not cover. Each is named at ERROR with
its ``memory_id`` / project / base file and the migration **aborts** — the same
reasoning ``unresolved`` already applies, since finishing the deploy would
leave a hold regime nobody is coming back to lift.

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

So the collision is checked per record against :data:`_LIVE_DEDUP_PREDICATE` (a
textual copy of the index's own predicate — a migration cannot import
``memory_store``). On a hit the record is skipped, the colliding row is named at
ERROR with both ids, and the migration **ABORTS**. A skip on its own is not a
safe outcome here for exactly the reason an unresolved record is not: this
revision also RELEASES the holds, so completing the deploy would free the
sidecars still carrying the losing text while the winner keeps its
pre-adjudication body. The operator merges the two rows by hand and re-runs.

⚠️ **The probe reads the END state, not the state mid-loop.** Every resolved
target is excluded from it, because each one ends this run carrying its own
payload hash — probing record A against a hash record B is about to vacate
would report a collision that will not exist at COMMIT, and (since a collision
now aborts) fail the deploy on the order the records happen to be listed in.
Excluding them is safe because :func:`_assert_payload_integrity` has already
rejected two records sharing a ``content_sha256``.

That exclusion is only half the answer, because the index is a plain UNIQUE
index and is enforced per STATEMENT rather than at COMMIT. Writing a record
whose hash another not-yet-written target still holds would raise the
``UniqueViolation`` anyway. So the writes are ORDERED: a record goes only once
no other unwritten target still carries its ``content_hash``. A cycle (two rows
each holding the other's target hash) cannot be untangled one statement at a
time and is reported as such rather than left to fail on the index.

Reversibility
-------------

The pre-adjudication text of each target ships in the **JSON payload**
(``prior_content`` / ``prior_content_sha256``), not in the database. Stashing
it in ``source.adjudication`` was the obvious thing and it is wrong:
``coord.memory_records.source`` is returned verbatim to every memory-API caller
— ``memory_store``'s record projection selects ``r.source``, and the API hands
it back on ``/memory/query`` hits, ``/memory/records`` listings and graph nodes
— so a stashed pre-image would put ~43 KB of the losing text straight back into
the retrieval path this whole plan exists to clean, unlabelled and in the same
hit as the adjudicated text. Only ``prior_content_hash`` is stamped on the row:
a hash is not a leak and still proves what was replaced.

That makes the rollback MORE trustworthy, not less. The JSON travels in the
migrator image beside this revision (same reason the forward text does), so it
is available wherever the downgrade can run — this does not reintroduce a
dependency on a directory on one operator's laptop.
:func:`_assert_payload_integrity` recomputes ``prior_content_sha256`` over the
shipped bytes before anything is written, and each row is matched to its
payload record by the ``prior_content_hash`` it was stamped with — so the
restore is sha-VERIFIED rather than trusting whatever a JSONB column holds.

A stamped row whose ``prior_content_hash`` matches no payload record is a row
that had DRIFTED when the upgrade wrote it (upgrade logs that at WARNING). Its
exact pre-image is not in the payload and is not recoverable, so the downgrade
names it at ERROR and leaves it ALONE — stamp included — rather than writing
bytes that were never on it.

The downgrade restores ``content`` + ``content_hash``, re-NULLs ``embedding`` /
``embedding_model`` (so the restored text is re-embedded too — the pre-image
vector is NOT stashed, because restoring the OLD vector over the OLD text is
only correct if nothing else moved, and a NULL is unconditionally correct),
drops the keys this revision added, and re-holds exactly the rows it released.
That last claim is made true by a MARKER: each release writes
``source.adjudication.hold_released_by = 'memhold_adjudicate_02'`` and the
re-hold keys on it, so a row that already read ``false`` before this revision
ran is left alone instead of being "restored" to a hold this revision never
lifted. It does NOT restore ``updated_at``.

Invariants vs measurements
--------------------------

Same discipline as ``memhold_adjudicate_01``: **assert invariants, log
measurements.**

* **Asserted** (:func:`_assert_content_invariants`, ``RuntimeError``): every
  payload record resolved to exactly one row; that row is LIVE; it is the row
  ``memhold_adjudicate_01``'s ``superseded_by`` pointer already names; no
  record was skipped on a content-hash collision; landed +
  skipped-for-collision + unresolved equals the payload size; no row outside
  the resolved set carries a ``prior_content_hash`` stash (i.e. nothing outside
  the resolved winners had its content touched); no resolved row is a
  ``(part i/n)`` import chunk. Asserted separately, after the releases: no
  ``merged``/``loser`` sidecar and no ``_WINNER_MATCH`` winner is left held
  outside the payload's coverage.
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
    """One adjudicated file: where it goes, what it says, and what it replaces.

    ``prior_content`` is the PRE-adjudication text of the target row, shipped
    here rather than stashed in the database — see the module docstring's
    Reversibility section. :func:`downgrade` restores from it and verifies
    ``prior_content_sha256`` before writing.
    """

    project: str
    base_file: str
    disposition: str
    content: str
    content_sha256: str
    prior_content: str
    prior_content_sha256: str
    byte_length: int
    prior_byte_length: int


_REQUIRED_FIELDS = (
    "project",
    "base_file",
    "disposition",
    "content",
    "content_sha256",
    "prior_content",
    "prior_content_sha256",
    "bytes",
    "prior_bytes",
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
            prior_content=str(entry["prior_content"]),
            prior_content_sha256=str(entry["prior_content_sha256"]),
            byte_length=int(entry["bytes"]),
            prior_byte_length=int(entry["prior_bytes"]),
        )
        if not record.content:
            raise RuntimeError(
                f"memhold_adjudicate_02's payload record {index} "
                f"({record.project}/{record.base_file}) has empty content; "
                "`content` is NOT NULL and an empty adjudication is a bug, "
                "not a decision."
            )
        if not record.prior_content:
            raise RuntimeError(
                f"memhold_adjudicate_02's payload record {index} "
                f"({record.project}/{record.base_file}) has empty "
                "prior_content. It is the ONLY copy of the text this record "
                "overwrites — the pre-image is no longer stashed in the row — "
                "so an empty one is a downgrade that silently blanks a record."
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

    ``prior_content`` is checked the same way and for a sharper reason: it is
    the ONLY copy of the text this record overwrites (the pre-image is no
    longer stashed in the row — see the module docstring), so a corrupted one
    is a downgrade that writes the wrong bytes over a production record.

    Also rejects three structural impossibilities: two records aimed at the
    SAME ``(project, base_file)`` (they would overwrite each other, and only
    the last would be reversible), two records carrying the same ``base_file``
    in DIFFERENT projects (``_WINNER_JOIN_ON`` accepts a NULL-project winner,
    so both could resolve to that one row and the second write would overwrite
    the first), and two records with the SAME content (the second would collide
    with the first on the live-dedup index — a self-inflicted skip).
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
        prior_actual = hashlib.sha256(
            record.prior_content.encode("utf-8")
        ).hexdigest()
        if prior_actual != record.prior_content_sha256:
            raise RuntimeError(
                "memhold_adjudicate_02 PAYLOAD CORRUPTED: "
                f"{record.project}/{record.base_file} declares "
                f"prior_content_sha256 {record.prior_content_sha256} but its "
                f"shipped prior_content hashes to {prior_actual}. That text is "
                "the only copy of what this record overwrites, so a corrupted "
                "one is a downgrade that writes the wrong bytes."
            )
        declared_bytes = len(record.content.encode("utf-8"))
        if declared_bytes != record.byte_length:
            raise RuntimeError(
                "memhold_adjudicate_02 PAYLOAD CORRUPTED: "
                f"{record.project}/{record.base_file} declares {record.byte_length} "
                f"byte(s) but its shipped content is {declared_bytes}."
            )
        declared_prior_bytes = len(record.prior_content.encode("utf-8"))
        if declared_prior_bytes != record.prior_byte_length:
            raise RuntimeError(
                "memhold_adjudicate_02 PAYLOAD CORRUPTED: "
                f"{record.project}/{record.base_file} declares "
                f"{record.prior_byte_length} prior byte(s) but its shipped "
                f"prior_content is {declared_prior_bytes}."
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
    # And the same base file under two DIFFERENT projects. `_WINNER_JOIN_ON`
    # deliberately accepts a winner whose `source.project` is NULL — the first
    # Phase-4a import pass wrote none — so two records sharing a base file can
    # both resolve to that one NULL-project row, and the second write would
    # overwrite the first record's text with no ERROR anywhere. Unreachable in
    # today's payload (six distinct base files); this makes it code rather than
    # a measurement.
    base_files = [record.base_file for record in records]
    duplicate_base_files = sorted(
        {name for name in base_files if base_files.count(name) > 1}
    )
    if duplicate_base_files:
        raise RuntimeError(
            "memhold_adjudicate_02 PAYLOAD MALFORMED: base_file(s) "
            f"{duplicate_base_files} appear under more than one project. The "
            "winner join accepts a NULL-project 'topic-file' row, so both "
            "records could resolve to the SAME row and the second text would "
            "overwrite the first."
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
    not_live: int,
    pointer_mismatched: int,
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
    if collided:
        raise RuntimeError(
            "memhold_adjudicate_02 INVARIANT VIOLATED: "
            f"{collided} payload record(s) were SKIPPED on a content-hash "
            "collision with another live row in the same tenant (see the ERROR "
            "lines above for both ids). Exactly the reasoning that aborts on an "
            "unresolved record applies: the adjudicated text did not land on "
            "the winner, and this revision also RELEASES the holds — so "
            "completing the deploy would free rows still carrying the losing "
            "text while the winner keeps its pre-adjudication body. Merge the "
            "two rows by hand, then re-run."
        )
    if not_live:
        raise RuntimeError(
            "memhold_adjudicate_02 INVARIANT VIOLATED: "
            f"{not_live} resolved winner row(s) are NOT live — tombstoned, "
            "superseded, or with their validity ended (see the ERROR lines "
            "above for which). Writing the operator's adjudicated text onto a "
            "row retrieval can never return is lost work that reports as "
            "landed, and its hold would come off on top."
        )
    if pointer_mismatched:
        raise RuntimeError(
            "memhold_adjudicate_02 INVARIANT VIOLATED: "
            f"{pointer_mismatched} resolved winner(s) disagree with the "
            "superseded_by pointer memhold_adjudicate_01 already wrote (see the "
            "ERROR lines above for which). That pointer IS the authoritative "
            "answer to 'which row is this sidecar's winner' — it was landed in "
            "prod by the previous revision — so a disagreement means the corpus "
            "moved between the two applies and this run would send the "
            "adjudicated text to a different row than the adjudication did."
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
            "source.adjudication.prior_content_hash stash. Only this revision "
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
#
# ⚠️ The exclusion is a LIST, not just this record's own row. The probe reads
# live state, and every resolved target is about to take its payload text, so
# probing one record against a row ANOTHER record is about to vacate reports a
# collision that will not exist by COMMIT — an order-dependent false skip, and
# under the invariants below a false ABORT of the whole deploy. Excluding every
# row this run is itself updating is what makes the probe read the END state:
# the invariants guarantee each of those rows ends on its own payload hash, and
# `_assert_payload_integrity` has already rejected two records sharing one, so
# no excluded row can be a real collision.
_COLLISION_SQL = f"""
    SELECT memory_id, title
      FROM coord.memory_records
     WHERE tenant_id = :tenant_id
       AND content_hash = :content_hash
       AND NOT (memory_id = ANY(CAST(:exclude_ids AS uuid[])))
       AND {_LIVE_DEDUP_PREDICATE}
     LIMIT 1
"""

# The sidecars memhold_adjudicate_01 superseded onto a winner, for this
# record's (project, base_file). That pointer is the AUTHORITATIVE answer to
# "which topic-file row is this pair's winner" — a human's adjudication, landed
# in prod by the previous revision — so this revision's re-derived ranking must
# agree with it or abort. A NULL pointer is not a disagreement (nothing to
# compare); a DIFFERENT one means the corpus moved between the two applies.
_WINNER_POINTER_SQL = f"""
    WITH {_SIDECAR_MATCH_CTE}
    SELECT s.memory_id, m.superseded_by
      FROM sidecar s
      JOIN coord.memory_records m
        ON m.memory_id = s.memory_id
     WHERE m.tenant_id = :tenant_id
       AND m.source->'adjudication'->>'disposition' IN ({_dispositions_sql()})
       AND m.superseded_by IS NOT NULL
"""

# The write. `source.adjudication` does not exist on a winner row (Phase 3.3
# stamped sidecars only). `jsonb_set` DOES create a missing one-level key, so
# that is not why the COALESCE is here: the hazard it prevents is `NULL ||
# jsonb`, which yields NULL — on a winner with no `adjudication` key the merge
# operand would be NULL and the whole stamp would silently vanish. The `||`
# merge rather than five nested `jsonb_set` calls is for legibility.
#
# `prior_content_hash` is stashed; the prior TEXT is not. It ships in the JSON
# payload instead — `coord.memory_records.source` is returned verbatim to every
# memory-API caller, so a stashed pre-image would put the losing text straight
# back into the retrieval path this adjudication exists to clean. A hash is not
# a leak and still proves what was replaced.
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
                   'prior_content_hash', to_jsonb(m.content_hash)
               ),
               true
           )
     WHERE m.memory_id = :memory_id
       AND m.content_hash IS DISTINCT FROM :content_hash
"""

# The (project, base_file) pairs the payload covers, as a CTE. Bound as two
# parallel text[] parameters rather than rendered as literals: these values come
# from a JSON file, not from this module, so they are not transcription-guarded
# constants like `_ADJUDICATED_DISPOSITIONS`.
_COVERED_CTE = """
    covered AS (
        SELECT c.project, c.base_file
          FROM unnest(
                   CAST(:covered_projects AS text[]),
                   CAST(:covered_base_files AS text[])
               ) AS c(project, base_file)
    )
"""

# Every `merged`/`loser` sidecar whose (project, base_file) NO payload record
# covers — i.e. whose losing body is still the input to an adjudication this
# run did not land. Requires `covered`.
_PENDING_SIDECARS_CTE = f"""
    pending AS (
        SELECT s.memory_id, s.tenant_id, s.project, s.base_file
          FROM ({_SIDECAR_ROW_CTE}) s
          JOIN coord.memory_records m
            ON m.memory_id = s.memory_id
         WHERE m.source->'adjudication'->>'disposition'
               IN ({_dispositions_sql()})
           AND NOT EXISTS (
                SELECT 1
                  FROM covered c
                 WHERE c.project = s.project
                   AND c.base_file = s.base_file
           )
    )
"""

# ⚠️ Both hold releases are restricted to the PAYLOAD-COVERED set, and that
# restriction is the whole point rather than an optimisation. Keyed on the
# disposition alone (as they were), they free every `merged`/`loser` sidecar and
# every `_WINNER_MATCH` winner in the corpus — including a pair this payload
# says nothing about, and including the rows `memhold_adjudicate_01` deliberately
# left INERT for a human. A winner freed without its text rewritten keeps its
# PRE-adjudication body with `decay_prune` now armed on the sidecars that are
# its only provenance, and the run exits 0 with nothing logged.
#
# Both also key on the hold actually reading 'true', so the downgrade's mirror
# round-trips exactly. `memhold_backfill_01` wrote the JSON boolean;
# `lower(... ->> ...)` is the same TEXT comparison `_not_lifecycle_held` uses,
# so a malformed value reads as not-held rather than aborting.
#
# Each released row is MARKED with `source.adjudication.hold_released_by`. The
# downgrade keys its re-hold on that marker rather than on "reads false", so a
# row that already read `false` before this revision ran is not re-held by a
# rollback of a release that never happened.
_HOLD_RELEASED_BY = revision


def _release_marked_source(alias: str) -> str:
    """``source`` with the hold cleared and this revision's marker merged in.

    Takes the UPDATE's table alias so each statement can name its target
    whatever the fragments it interpolates require — the winner release must
    alias it ``w`` for ``_WINNER_MATCH`` / ``_WINNER_JOIN_ON`` to interpolate
    verbatim rather than be re-typed with different prefixes.
    """
    return f"""
    jsonb_set(
        jsonb_set(
            {alias}.source, '{{lifecycle_hold}}', CAST('false' AS jsonb), true
        ),
        '{{adjudication}}',
        COALESCE({alias}.source->'adjudication', CAST('{{}}' AS jsonb))
        || jsonb_build_object(
            'hold_released_by', CAST('{_HOLD_RELEASED_BY}' AS text)
        ),
        true
    )
"""

# A winner is released when NO uncovered `merged`/`loser` sidecar still points
# at it. That is the correct granularity, and deliberately NOT "only the rows
# this run wrote to": prod holds 11 winners against 6 payload records, because
# five of them answer sidecars `memhold_adjudicate_01` dispositioned `winner` —
# their text was already correct, so there is nothing for this revision to
# write and nothing left to wait for. What must never be released is a winner
# whose merged/loser input this payload does not answer.
#
# `pending` is aliased `s` so `_WINNER_JOIN_ON` — the shared, drift-guarded
# winner predicate — can be interpolated verbatim instead of re-typed.
_RELEASE_WINNERS_SQL = f"""
    WITH sidecar AS ({_SIDECAR_KEY_CTE}),
    {_COVERED_CTE},
    {_PENDING_SIDECARS_CTE}
    UPDATE coord.memory_records w
       SET source = {_release_marked_source("w")}
     WHERE {_WINNER_MATCH}
       AND lower(w.source->>'lifecycle_hold') = 'true'
       AND NOT EXISTS (
            SELECT 1
              FROM pending s
             WHERE {_WINNER_JOIN_ON}
       )
"""

_RELEASE_SIDECARS_SQL = f"""
    WITH {_COVERED_CTE},
    releasable AS (
        SELECT DISTINCT s.memory_id
          FROM ({_SIDECAR_ROW_CTE}) s
          JOIN covered c
            ON c.project = s.project
           AND c.base_file = s.base_file
    )
    UPDATE coord.memory_records m
       SET source = {_release_marked_source("m")}
      FROM releasable r
     WHERE m.memory_id = r.memory_id
       AND m.source->'adjudication'->>'disposition' IN ({_dispositions_sql()})
       AND lower(m.source->>'lifecycle_hold') = 'true'
"""

# The ASSERTED end-state check: a `merged`/`loser` sidecar, or a `_WINNER_MATCH`
# winner, that is STILL held after the releases above. By construction those are
# exactly the rows the payload does not cover — the sidecars `pending` names,
# and the winners still waiting on one — so each is an adjudication this deploy
# did not complete. Reported individually and then aborted: the same reasoning
# `unresolved` already applies, since finishing the deploy would leave a hold
# regime nobody is coming back to lift.
_UNCOVERED_HELD_SQL = f"""
    WITH sidecar AS ({_SIDECAR_KEY_CTE}),
    {_COVERED_CTE},
    {_PENDING_SIDECARS_CTE}
    SELECT CAST('merged/loser sidecar' AS text) AS kind,
           p.memory_id,
           p.project,
           p.base_file
      FROM pending p
      JOIN coord.memory_records m
        ON m.memory_id = p.memory_id
     WHERE lower(m.source->>'lifecycle_hold') = 'true'
     UNION ALL
    SELECT CAST('topic-file winner' AS text) AS kind,
           w.memory_id,
           w.source->>'project',
           w.source->>'file'
      FROM coord.memory_records w
     WHERE {_WINNER_MATCH}
       AND lower(w.source->>'lifecycle_hold') = 'true'
     ORDER BY 1, 3, 4
"""

# The LOGGED end-state measurement: anything in the CONTESTED set — every
# sidecar plus every topic-file winner — still reading held. Expected 0. Wider
# than the asserted check above and counted rather than asserted, because Phase
# 3.3 legitimately leaves an UNMAPPED sidecar (no disposition at all) held for a
# human, and that is a thing to read, not a deploy to fail.
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

# The downgrade's restore. The pre-image text comes from the shipped payload,
# not from the row: it is matched to the row by the `prior_content_hash` this
# revision stashed, and the payload's declared `prior_content_sha256` has
# already been recomputed over the shipped bytes by
# `_assert_payload_integrity`. So the rollback is sha-VERIFIED rather than
# trusting whatever a JSONB column happens to hold.
#
# The embedding is re-NULLed rather than restored — see the module docstring.
_RESTORE_TEXT_SQL = """
    WITH stripped AS (
        SELECT memory_id,
               (source->'adjudication')
                 - 'prior_content_hash'
                 - 'revision'
                 - 'disposition'
                 - 'decided'
                 - 'plan'
                 - 'gate' AS rest
          FROM coord.memory_records
         WHERE memory_id = :memory_id
    )
    UPDATE coord.memory_records m
       SET content = :prior_content,
           content_hash = :prior_content_hash,
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

# Every row this revision stamped, with the pre-image hash that names which
# payload record wrote it. The downgrade drives off this rather than
# re-resolving the winners, so a corpus that moved since the apply cannot
# redirect the restore onto a different row.
_STAMPED_ROWS_SQL = f"""
    SELECT memory_id,
           content_hash,
           source->'adjudication'->>'prior_content_hash' AS prior_content_hash
      FROM coord.memory_records
     WHERE source->'adjudication'->>'revision' = '{revision}'
     ORDER BY memory_id
"""

# The re-hold, keyed on the MARKER this revision's releases wrote — not on the
# hold reading 'false'. A winner or sidecar that already read `false` before
# this revision ran was never released by it, so re-holding it would be a
# rollback of something that never happened. The marker is dropped with the
# re-hold, and the `adjudication` object with it when nothing else remains.
_REHOLD_RELEASED_SQL = """
    WITH stripped AS (
        SELECT memory_id,
               (source->'adjudication') - 'hold_released_by' AS rest
          FROM coord.memory_records
         WHERE source->'adjudication'->>'hold_released_by' = :released_by
    )
    UPDATE coord.memory_records m
       SET source = CASE
                        WHEN s.rest = CAST('{}' AS jsonb)
                            THEN jsonb_set(
                                m.source,
                                '{lifecycle_hold}',
                                CAST('true' AS jsonb),
                                true
                            ) - 'adjudication'
                        ELSE jsonb_set(
                            jsonb_set(
                                m.source,
                                '{lifecycle_hold}',
                                CAST('true' AS jsonb),
                                true
                            ),
                            '{adjudication}',
                            s.rest
                        )
                    END
      FROM stripped s
     WHERE m.memory_id = s.memory_id
"""


def _covered_params(records: Sequence[_PayloadRecord]) -> dict[str, Any]:
    """The payload's ``(project, base_file)`` pairs, as two parallel arrays."""
    return {
        "covered_projects": [record.project for record in records],
        "covered_base_files": [record.base_file for record in records],
    }


def _covered_release_stmt(sql: str) -> sa.TextClause:
    """A statement over the covered set, with its two ``text[]`` params typed."""
    return sa.text(sql).bindparams(
        sa.bindparam("covered_projects", type_=sa.ARRAY(sa.Text)),
        sa.bindparam("covered_base_files", type_=sa.ARRAY(sa.Text)),
    )


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
    not_live = 0
    pointer_mismatched = 0
    drifted = 0

    # ------------------------------------------------------------------
    # 1. RESOLVE every record first, and only then probe for collisions.
    #    The probe reads live state, so a record checked mid-loop can be
    #    skipped against a hash another record is about to vacate — an
    #    order-dependent false skip, which under the invariants below is a
    #    false ABORT of the whole deploy. Resolving first is what lets the
    #    probe exclude every row this run is itself updating and therefore
    #    read the END state instead of a half-written one.
    # ------------------------------------------------------------------
    for record in records:
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

        # -- liveness ------------------------------------------------------
        # The ranking PREFERS a live winner but does not require one: with a
        # single candidate it returns that candidate whatever its state.
        # Writing the operator's text onto a tombstoned / superseded /
        # validity-ended row puts it where retrieval can never return it,
        # counts it as landed, and releases its hold on top of that.
        if not bool(target["is_live"]):
            not_live += 1
            logger.error(
                "memhold_adjudicate_02: NOT-LIVE winner row — memory_id=%s "
                "title=%r for project=%s base_file=%s. It is tombstoned, "
                "superseded or has its validity ended, so it is outside "
                "uq_memory_records_tenant_content_hash_live and outside every "
                "retrieval selector. The adjudicated text would land where "
                "nothing can read it. Import or revive the winner and re-run.",
                target_id,
                target["title"],
                record.project,
                record.base_file,
            )
            continue

        # -- agreement with the pointer memhold_adjudicate_01 wrote --------
        # That revision superseded each `merged`/`loser` sidecar ONTO its
        # adjudicated winner, so the pointer IS the answer to "which row is
        # this pair's winner" — a human decision, already landed in prod. This
        # revision merely re-derives the same ranking; a disagreement means the
        # corpus moved between the two applies and the text would go to a row
        # the adjudication did not choose. A NULL pointer is not a
        # disagreement — there is nothing to compare — so it warns.
        pointers = conn.execute(
            sa.text(_WINNER_POINTER_SQL),
            {
                "project": record.project,
                "base_file": record.base_file,
                "tenant_id": target["tenant_id"],
            },
        ).all()
        mismatched = [row for row in pointers if row[1] != target_id]
        if mismatched:
            pointer_mismatched += 1
            for sidecar_id, superseded_by in mismatched:
                logger.error(
                    "memhold_adjudicate_02: WINNER POINTER MISMATCH — sidecar "
                    "memory_id=%s (project=%s base_file=%s) was superseded by "
                    "memhold_adjudicate_01 onto winner memory_id=%s, but this "
                    "revision's ranking resolved memory_id=%s. The earlier "
                    "pointer is the adjudication a human approved, so a "
                    "disagreement means the corpus moved between the two "
                    "applies and this run would send the text elsewhere.",
                    sidecar_id,
                    record.project,
                    record.base_file,
                    superseded_by,
                    target_id,
                )
            continue
        if not pointers:
            logger.warning(
                "memhold_adjudicate_02: no superseded_by pointer to cross-check "
                "for project=%s base_file=%s (winner memory_id=%s). "
                "memhold_adjudicate_01 supersedes every content-dispositioned "
                "sidecar that has a winner, so an absent pointer means those "
                "sidecars were never superseded and the re-derived ranking is "
                "the only authority for where this text lands.",
                record.project,
                record.base_file,
                target_id,
            )

        # -- measurement: has the row moved since the payload was authored?
        current_hash = str(target["content_hash"])
        if current_hash not in (record.prior_content_sha256, record.content_sha256):
            drifted += 1
            logger.warning(
                "memhold_adjudicate_02: the pre-adjudication content_hash of "
                "memory_id=%s (project=%s base_file=%s) is %s, but the payload "
                "was generated against %s. The row moved between authoring and "
                "apply. Writing the adjudicated text anyway — the operator's "
                "decision is authoritative — and stamping the pre-image hash "
                "into source.adjudication.prior_content_hash. That row will "
                "NOT round-trip: downgrade() matches that hash against the "
                "shipped payload, finds no pre-image for it, and reports it "
                "rather than writing bytes that were never on the row.",
                target_id,
                record.project,
                record.base_file,
                current_hash,
                record.prior_content_sha256,
            )

    # ------------------------------------------------------------------
    # 2. The live-dedup unique index, probed against the END state. Every
    #    resolved target is excluded: each ends this run carrying its own
    #    payload hash (the invariants below make that true), and
    #    `_assert_payload_integrity` has already rejected two records sharing
    #    a content_sha256 — so no excluded row can be a real collision.
    # ------------------------------------------------------------------
    exclude_ids = [str(target_id) for _, target_id in resolved]
    collision_stmt = sa.text(_COLLISION_SQL).bindparams(
        sa.bindparam("exclude_ids", type_=sa.ARRAY(sa.Text))
    )
    writable: list[tuple[_PayloadRecord, Any, str]] = []
    for record, target_id in resolved:
        target = (
            conn.execute(sa.text(_TARGET_STATE_SQL), {"memory_id": target_id})
            .mappings()
            .one()
        )
        clash = (
            conn.execute(
                collision_stmt,
                {
                    "tenant_id": target["tenant_id"],
                    "content_hash": record.content_sha256,
                    "exclude_ids": exclude_ids,
                },
            )
            .mappings()
            .first()
        )
        if clash is not None:
            collided += 1
            logger.error(
                "memhold_adjudicate_02: SKIPPED on a content-hash collision — "
                "memory_id=%s (project=%s base_file=%s) would take "
                "content_hash %s, which live row memory_id=%s (title=%r) in "
                "the same tenant already holds. "
                "uq_memory_records_tenant_content_hash_live would reject the "
                "write with an error naming only the index. The adjudicated "
                "text is already in the corpus on that row — but this revision "
                "also RELEASES the holds, so the deploy ABORTS rather than "
                "freeing rows that still carry the losing text. Merge the two "
                "rows by hand and re-run.",
                target_id,
                record.project,
                record.base_file,
                record.content_sha256,
                clash["memory_id"],
                clash["title"],
            )
            continue
        writable.append((record, target_id, str(target["content_hash"])))

    # ------------------------------------------------------------------
    # 3. Any defect at all aborts HERE, before a single row is written.
    #    Every arm above logs and continues so the operator sees all of
    #    them rather than the first, but writing part of a payload that is
    #    already known to be un-completable buys nothing — and a partial
    #    write can trip the live-dedup index against a row the abort was
    #    about to name, replacing a clear message with an opaque one.
    #    `_assert_content_invariants` raises on every one of these counters,
    #    so this call cannot return.
    # ------------------------------------------------------------------
    if collided or unresolved or chunked or not_live or pointer_mismatched:
        _assert_content_invariants(
            payload_records=len(records),
            landed=0,
            collided=collided,
            unresolved=unresolved,
            chunked=chunked,
            not_live=not_live,
            pointer_mismatched=pointer_mismatched,
            stray_content_rows=0,
        )

    # ------------------------------------------------------------------
    # 4. The writes, ORDERED so no intermediate state trips the live-dedup
    #    index. Excluding the other resolved targets from the probe above is
    #    only half the answer: it correctly says "that row will not be
    #    holding this hash at COMMIT", but the index is a plain UNIQUE index
    #    and is enforced per STATEMENT, not at commit. Writing a record whose
    #    hash another not-yet-written target still holds would raise a
    #    UniqueViolation naming only the index — exactly the opaque failure
    #    this revision goes out of its way to avoid.
    #
    #    So a record is written only once no OTHER unwritten target still
    #    carries its content_hash. A cycle (two rows each holding the other's
    #    target hash) cannot be untangled one statement at a time and is
    #    reported as such rather than left to fail on the index.
    # ------------------------------------------------------------------
    ordered: list[tuple[_PayloadRecord, Any, str]] = []
    unwritten = list(writable)
    while unwritten:
        for index, (record, target_id, _) in enumerate(unwritten):
            blocked = any(
                other_hash == record.content_sha256
                for _, other_id, other_hash in unwritten
                if other_id != target_id
            )
            if not blocked:
                ordered.append(unwritten.pop(index))
                break
        else:
            raise RuntimeError(
                "memhold_adjudicate_02 INVARIANT VIOLATED: the remaining "
                f"{len(unwritten)} payload write(s) form a content_hash cycle — "
                "each target still holds a hash another one is about to take, "
                "so no order of single-row UPDATEs avoids "
                "uq_memory_records_tenant_content_hash_live. Reconcile those "
                "rows by hand and re-run."
            )

    for record, target_id, _ in ordered:
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

    # No row outside the resolved winners may carry a `prior_content_hash`
    # stash — only this revision writes that key, so one elsewhere is content
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
                 WHERE source->'adjudication' ? 'prior_content_hash'
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
        not_live=not_live,
        pointer_mismatched=pointer_mismatched,
        stray_content_rows=int(stray),
    )

    # ------------------------------------------------------------------
    # 4. The holds, AFTER the content lands — and only over the set this
    #    payload actually covers. Anything still held that the payload does
    #    NOT cover is an adjudication this deploy did not complete, so it is
    #    named row by row and then aborts, rather than being freed silently.
    # ------------------------------------------------------------------
    covered = _covered_params(records)
    winners_released = conn.execute(
        _covered_release_stmt(_RELEASE_WINNERS_SQL), covered
    ).rowcount
    sidecars_released = conn.execute(
        _covered_release_stmt(_RELEASE_SIDECARS_SQL), covered
    ).rowcount

    uncovered_held = conn.execute(
        _covered_release_stmt(_UNCOVERED_HELD_SQL), covered
    ).all()
    for kind, memory_id, project, base_file in uncovered_held:
        logger.error(
            "memhold_adjudicate_02: UNCOVERED ROW STILL HELD — %s memory_id=%s "
            "project=%s base_file=%s. No payload record covers that "
            "(project, base_file), so its adjudicated text was never written "
            "and its hold is not this revision's to lift. Freeing it anyway "
            "would arm decay_prune on the losing bodies while the winner still "
            "carries pre-adjudication text — exactly what "
            "memhold_adjudicate_01 held these rows to prevent.",
            kind,
            memory_id,
            project,
            base_file,
        )
    if uncovered_held:
        raise RuntimeError(
            "memhold_adjudicate_02 INVARIANT VIOLATED: "
            f"{len(uncovered_held)} row(s) in the merged/loser sidecar + "
            "topic-file winner set are still held and are NOT covered by the "
            "payload (see the ERROR lines above for each). Completing the "
            "deploy would declare the adjudication finished while leaving rows "
            "whose text nobody is coming back to write. Extend the payload — "
            "or adjudicate those rows — and re-run."
        )

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
    """Restore the pre-adjudication text from the payload, then re-hold.

    The pre-image text comes from the shipped JSON, matched to each row by the
    ``prior_content_hash`` this revision stamped, and its declared
    ``prior_content_sha256`` was recomputed over the shipped bytes by
    :func:`_assert_payload_integrity` before anything is written. A stamped row
    whose stashed hash matches NO payload record is a row whose content had
    drifted at apply time: its exact pre-image is not recoverable from here, so
    it is named at ERROR and left ALONE — stamp included — rather than
    overwritten with bytes that were never on it.

    Faithful for ``content`` and ``content_hash``. NOT faithful for
    ``embedding`` / ``embedding_model`` (re-NULLed, so the restored text is
    re-embedded by the next sweep — the pre-image vector is not stashed) or
    ``updated_at``. See the module docstring.
    """
    _assert_no_drift()
    records = _load_payload()
    _assert_payload_integrity(records)
    conn = op.get_bind()

    by_prior_hash = {record.prior_content_sha256: record for record in records}

    restored = 0
    unrestorable = 0
    for row in conn.execute(sa.text(_STAMPED_ROWS_SQL)).mappings().all():
        record = by_prior_hash.get(str(row["prior_content_hash"]))
        if record is None:
            unrestorable += 1
            logger.error(
                "memhold_adjudicate_02 downgrade: NO PRE-IMAGE for "
                "memory_id=%s — its source.adjudication.prior_content_hash is "
                "%s, which no payload record declares. The row had drifted "
                "from the payload when upgrade() wrote it (upgrade logs that "
                "at WARNING), so the text this revision overwrote is not in "
                "the shipped JSON and is not recoverable from here. Leaving "
                "the row untouched, stamp included, rather than writing bytes "
                "that were never on it.",
                row["memory_id"],
                row["prior_content_hash"],
            )
            continue
        restored += conn.execute(
            sa.text(_RESTORE_TEXT_SQL),
            {
                "memory_id": row["memory_id"],
                "prior_content": record.prior_content,
                "prior_content_hash": record.prior_content_sha256,
            },
        ).rowcount

    reheld = conn.execute(
        sa.text(_REHOLD_RELEASED_SQL), {"released_by": _HOLD_RELEASED_BY}
    ).rowcount

    logger.info(
        "memhold_adjudicate_02 downgrade: restored content + content_hash on "
        "%d row(s) from the shipped payload (sha-verified against the stamped "
        "prior_content_hash) and dropped this revision's stamp; %d row(s) had "
        "no recoverable pre-image and were left untouched. Re-held %d row(s) — "
        "exactly those carrying this revision's hold_released_by marker, so a "
        "row that already read false beforehand is left alone. embedding / "
        "embedding_model are re-NULLed rather than restored, and updated_at is "
        "not restored.",
        restored,
        unrestorable,
        reheld,
    )
