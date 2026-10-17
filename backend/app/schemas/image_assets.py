"""Request and response shapes of the content-addressed image store.

Phase 13 of plan ``2026-10-13-image-generation-and-visual-judgment``; the
routes are ``app/api/v1/endpoints/image_assets.py``. The tenant never appears
in a request — it is the server-side principal ``get_memory_tenant`` resolves.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterator
from datetime import datetime
from typing import Any, Final, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    Json,
    field_validator,
    model_validator,
)

#: How an image entered the store. Equal to
#: ``app.models.image_asset.IMAGE_ASSET_KINDS`` (the CHECK's list);
#: ``tests/test_image_assets_api.py`` holds the two equal.
ImageAssetKind = Literal["candidate", "derivative", "capture", "exemplar"]
#: Where a slot candidate stands. Equal to ``SLOT_CANDIDATE_STATUSES``.
SlotCandidateStatus = Literal["candidate", "chosen", "rejected", "shipped"]

#: The largest ``provenance`` an upload may carry — and the largest the STORED
#: record may grow to as re-uploads merge into it — and the largest ``values``
#: / ``judge`` a slot candidate may carry, in UTF-8 bytes of compact JSON
#: (:func:`stored_json_bytes`).
MAX_PROVENANCE_BYTES: Final = 64 * 1024
MAX_CANDIDATE_JSON_BYTES: Final = 64 * 1024
#: The deepest a stored JSON value may nest: the value itself is level 1, and
#: every object or array inside it one level more. Deeper is refused at the
#: door (422): past 255 levels the response serializer cannot render a value,
#: so a row holding one would answer every later read of it — a whole slot's
#: candidate list — with a 500, and a few thousand levels exhaust a recursive
#: walk's stack before anything is written.
MAX_JSON_DEPTH: Final = 64

SHA256_PATTERN: Final = r"^[0-9a-f]{64}$"
#: ``name`` or ``owner/name`` — a repository as the caller names it. Not
#: normalised: ``qontinui-web`` and ``qontinui/qontinui-web`` are different
#: slots, so a caller picks one spelling and keeps it.
REPO_PATTERN: Final = r"^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)?$"
#: A slot id as the image-slot spec names it (``home.hero``,
#: ``empty-state/no-projects``): no whitespace, no control characters.
SLOT_ID_PATTERN: Final = r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
#: A recipe hash: ``sha256:…``, a bare hex digest, or another opaque token.
RECIPE_HASH_PATTERN: Final = r"^[A-Za-z0-9][A-Za-z0-9:._-]*$"


def _scalar_problem(value: Any) -> str | None:
    """Why a JSON scalar, or an object key, cannot be stored; None if it can."""
    if isinstance(value, float) and not math.isfinite(value):
        return f"is {value!r}, which JSON storage cannot hold"
    if isinstance(value, str):
        if "\x00" in value:
            return "contains U+0000, which JSON storage cannot hold"
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            return "contains a lone surrogate, which has no UTF-8 form"
    return None


def _entries(container: dict[str, Any] | list[Any]) -> Iterator[tuple[str, Any, Any]]:
    """``(path step, child, key)`` for each child; ``key`` is None in an array."""
    if isinstance(container, dict):
        for key, child in container.items():
            yield f".{key}", child, key
    else:
        for index, child in enumerate(container):
            yield f"[{index}]", child, None


def _unstorable(value: Any, path: str) -> str | None:
    """Why ``value`` cannot be stored in a JSONB column and read back; None
    if it can.

    Valid JSON for Python is not always storable JSON for PostgreSQL: a
    float that is NaN or ±Infinity (``json.loads`` accepts ``NaN`` and
    ``Infinity``), a string or key holding U+0000, and a lone surrogate
    (which has no UTF-8 form) are all refused by the database — AFTER the
    request was accepted, as a 500. JSON nested deeper than
    :data:`MAX_JSON_DEPTH` would be stored, then break every read that
    renders it. Refusing all of them here makes them a 422 at the door,
    before anything is written.

    The walk is iterative — an explicit stack, never recursion — so no input
    can exhaust the interpreter's stack, and it stops at the first refusal.
    """
    if not isinstance(value, dict | list):
        problem = _scalar_problem(value)
        return f"{path} {problem}" if problem else None
    stack: list[Iterator[tuple[str, Any, Any]]] = [_entries(value)]
    steps: list[str] = [path]
    while stack:
        entry = next(stack[-1], None)
        if entry is None:
            stack.pop()
            steps.pop()
            continue
        step, child, key = entry
        if key is not None and (problem := _scalar_problem(key)):
            return f"{''.join(steps)} key {problem}"
        if isinstance(child, dict | list):
            if len(stack) >= MAX_JSON_DEPTH:
                return f"{path} is nested more than {MAX_JSON_DEPTH} levels deep"
            stack.append(_entries(child))
            steps.append(step)
        elif problem := _scalar_problem(child):
            return f"{''.join(steps)}{step} {problem}"
    return None


def stored_json_bytes(value: Any) -> int:
    """UTF-8 bytes of ``value`` as compact JSON — the measure every size cap
    here is stated in. ``value`` must already be storable (:func:`_unstorable`):
    a NaN raises, and a lone surrogate cannot be encoded."""
    return len(
        json.dumps(
            value, separators=(",", ":"), ensure_ascii=False, allow_nan=False
        ).encode("utf-8")
    )


def _storable_json_size(value: Any, name: str) -> int:
    """:func:`stored_json_bytes` of ``value``; ValueError when it is not
    storable."""
    reason = _unstorable(value, name)
    if reason:
        raise ValueError(reason)
    return stored_json_bytes(value)


# ── uploads ─────────────────────────────────────────────────────────────


class ImageAssetUploadFields(BaseModel):
    """The non-file form fields of ``POST /api/v1/image-assets``.

    The route receives them as individual multipart fields (so its OpenAPI
    body is ``multipart/form-data`` beside the file) and validates them
    through this model; ``app.core.evidence_posture`` reads the closed fields
    from it.
    """

    model_config = ConfigDict(extra="forbid")

    kind: ImageAssetKind
    #: The generator's provenance record, a JSON object serialized into the
    #: form field. Stored as JSONB (key order and duplicate keys are not
    #: preserved); a later upload of the same bytes merges into it, adding keys
    #: and never removing or changing one.
    provenance: Json[dict[str, Any]] | None = None

    @field_validator("provenance", mode="before")
    @classmethod
    def _cap_provenance(cls, value: Any) -> Any:
        if isinstance(value, str) and len(value.encode("utf-8")) > MAX_PROVENANCE_BYTES:
            raise ValueError(
                f"provenance is larger than {MAX_PROVENANCE_BYTES} bytes as JSON"
            )
        return value

    @field_validator("provenance", mode="after")
    @classmethod
    def _storable_provenance(cls, value: dict[str, Any] | None) -> Any:
        # The raw field is capped before parsing; the parsed record is held to
        # the same cap in the measure the stored record is (a raw field can
        # re-serialize larger: ``1e5`` is ``100000.0``).
        if (
            value is not None
            and _storable_json_size(value, "provenance") > MAX_PROVENANCE_BYTES
        ):
            raise ValueError(
                f"provenance is larger than {MAX_PROVENANCE_BYTES} bytes as JSON"
            )
        return value


class ImageAssetOut(BaseModel):
    """One stored image. ``mime_type``, ``width``, ``height`` and
    ``orientation`` were read from the bytes; ``sha256`` was computed from
    them."""

    model_config = ConfigDict(from_attributes=True)

    sha256: str
    #: How the image FIRST entered the store; a later upload of the same bytes
    #: does not change it.
    kind: ImageAssetKind
    mime_type: str
    #: The image as DISPLAYED: for EXIF orientations 5-8 the encoded width and
    #: height exchanged, as a browser renders it.
    width: int
    height: int
    #: The EXIF orientation (1-8) the file declares; null when it declares
    #: none.
    orientation: int | None
    byte_size: int
    provenance: dict[str, Any]
    created_at: datetime
    updated_at: datetime


#: Why part of a re-upload was not applied (:class:`ImageAssetConflict`).
ConflictReason = Literal["kind_stands", "stored_value_stands", "provenance_full"]


class ImageAssetConflict(BaseModel):
    """One thing a re-upload sent that the store did not apply."""

    #: ``kind``, or ``provenance.<dotted path>``.
    path: str
    #: ``kind_stands`` — the first upload's kind is kept.
    #: ``stored_value_stands`` — the stored provenance holds a different value
    #: at this path, and it is kept.
    #: ``provenance_full`` — the key is new, but adding this upload's new keys
    #: would grow the stored provenance past ``MAX_PROVENANCE_BYTES``, so none
    #: of them was added (a stored key is never dropped to make room).
    reason: ConflictReason


class ImageAssetUploadResponse(ImageAssetOut):
    """``created`` is true when this request created the row (HTTP 201) and
    false when the tenant already held these bytes (HTTP 200)."""

    created: bool
    #: What this upload sent that the store did NOT apply, each with why.
    #: Empty when everything sent was applied (or was already there).
    conflicts: list[ImageAssetConflict]


class ImageAssetWithUrl(ImageAssetOut):
    """A stored image plus a URL to its bytes.

    On S3 / MinIO ``url`` is a presigned URL. Its ``url_expires_at`` is the
    requested lifetime capped at the signing credential's own expiry when the
    backend can read one (an assumed role, an instance or task profile): a
    presigned URL stops working when the credential that signed it expires,
    whatever its ``X-Amz-Expires`` says. When no expiry can be read — long-lived
    access keys, or credentials whose expiry botocore does not expose — the
    value ASSUMES the credential outlives the URL.

    On the local development backend ``url`` is this API's own authenticated
    content route (``GET /api/v1/image-assets/{sha256}/content``): fetch it
    with the same credential. It does not expire, so ``url_expires_at`` is
    null.
    """

    url: str
    url_expires_at: datetime | None


# ── slot candidates ─────────────────────────────────────────────────────


class SlotCandidateUpsert(BaseModel):
    """``PUT /api/v1/image-assets/slot-candidates`` — propose an asset for a
    slot, or move a proposal.

    Identity is ``repo`` + ``slot_id`` + ``asset_sha256``. ``status`` is
    always sent. ``recipe_hash``, ``values`` and ``judge`` are replaced when
    sent and left as stored when omitted (``recipe_hash: null`` clears it).
    """

    model_config = ConfigDict(extra="forbid")

    repo: str = Field(min_length=1, max_length=200, pattern=REPO_PATTERN)
    slot_id: str = Field(min_length=1, max_length=200, pattern=SLOT_ID_PATTERN)
    asset_sha256: str = Field(pattern=SHA256_PATTERN)
    status: SlotCandidateStatus
    recipe_hash: str | None = Field(
        default=None, min_length=1, max_length=128, pattern=RECIPE_HASH_PATTERN
    )
    #: Measured values (the L0/L1 analyzers' readings), keyed as the
    #: producer names them.
    values: dict[str, Any] = Field(default_factory=dict)
    #: The judge panel's votes, margins and pick reason.
    judge: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _cap_json(self) -> SlotCandidateUpsert:
        for name in ("values", "judge"):
            if (
                _storable_json_size(getattr(self, name), name)
                > MAX_CANDIDATE_JSON_BYTES
            ):
                raise ValueError(
                    f"{name} is larger than {MAX_CANDIDATE_JSON_BYTES} bytes as JSON"
                )
        return self


class SlotCandidateAsset(BaseModel):
    """The asset a candidate names, as stored."""

    model_config = ConfigDict(from_attributes=True)

    sha256: str
    kind: ImageAssetKind
    mime_type: str
    width: int
    height: int
    byte_size: int


class SlotCandidateOut(BaseModel):
    repo: str
    slot_id: str
    asset_sha256: str
    status: SlotCandidateStatus
    recipe_hash: str | None
    values: dict[str, Any]
    judge: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    asset: SlotCandidateAsset


class SlotCandidateDemotion(BaseModel):
    """A slot's previous choice, returned to ``candidate`` because another
    asset was chosen in the same request."""

    asset_sha256: str
    status_before: Literal["chosen"] = "chosen"
    status_after: Literal["candidate"] = "candidate"


class SlotCandidateUpsertResponse(BaseModel):
    candidate: SlotCandidateOut
    #: True when this request created the candidate row.
    created: bool
    #: Every other candidate of the slot this request moved out of ``chosen``
    #: — empty unless ``status`` was ``chosen`` and the slot held another
    #: choice.
    demoted: list[SlotCandidateDemotion]


#: The order a slot's candidates are listed in.
CandidateOrder = Literal["oldest", "newest"]


class SlotCandidateList(BaseModel):
    """``GET /api/v1/image-assets/slot-candidates`` — one page of a slot's
    candidates, ``oldest`` or ``newest`` first.

    The query is echoed so an empty page can be checked against what was
    asked. ``truncated`` says whether more rows exist past this page, and
    ``next_cursor`` — set exactly when it is true — fetches them: pass it back
    as ``after`` with the same ``order``.
    """

    repo: str
    slot_id: str
    status: SlotCandidateStatus | None
    order: CandidateOrder
    limit: int
    truncated: bool
    next_cursor: str | None
    candidates: list[SlotCandidateOut]
