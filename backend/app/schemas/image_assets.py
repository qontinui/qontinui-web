"""Request and response shapes of the content-addressed image store.

Phase 13 of plan ``2026-10-13-image-generation-and-visual-judgment``; the
routes are ``app/api/v1/endpoints/image_assets.py``. The tenant never appears
in a request — it is the server-side principal ``get_memory_tenant`` resolves.
"""

from __future__ import annotations

import json
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

#: The largest serialized ``provenance`` an upload may carry, and the largest
#: serialized ``values`` / ``judge`` a slot candidate may carry (UTF-8 bytes).
MAX_PROVENANCE_BYTES: Final = 64 * 1024
MAX_CANDIDATE_JSON_BYTES: Final = 64 * 1024

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


def _json_size(value: Any) -> int:
    return len(json.dumps(value, separators=(",", ":")).encode("utf-8"))


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
    #: form field. Kept verbatim.
    provenance: Json[dict[str, Any]] | None = None

    @field_validator("provenance", mode="before")
    @classmethod
    def _cap_provenance(cls, value: Any) -> Any:
        if isinstance(value, str) and len(value.encode("utf-8")) > MAX_PROVENANCE_BYTES:
            raise ValueError(
                f"provenance is larger than {MAX_PROVENANCE_BYTES} bytes as JSON"
            )
        return value


class ImageAssetOut(BaseModel):
    """One stored image. ``mime_type``, ``width`` and ``height`` were read from
    the bytes; ``sha256`` was computed from them."""

    model_config = ConfigDict(from_attributes=True)

    sha256: str
    kind: ImageAssetKind
    mime_type: str
    width: int
    height: int
    byte_size: int
    provenance: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class ImageAssetUploadResponse(ImageAssetOut):
    """``created`` is true when this request created the row (HTTP 201) and
    false when the tenant already held these bytes (HTTP 200)."""

    created: bool


class ImageAssetWithUrl(ImageAssetOut):
    """A stored image plus a time-limited URL to its bytes."""

    url: str
    #: When ``url`` stops working. ``null`` when the storage backend serves the
    #: object with no expiry (the local development backend's static mount) —
    #: never an expiry time it cannot enforce.
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
            if _json_size(getattr(self, name)) > MAX_CANDIDATE_JSON_BYTES:
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


class SlotCandidateList(BaseModel):
    """``GET /api/v1/image-assets/slot-candidates`` — one slot's candidates,
    oldest first. The query is echoed so an empty list can be checked against
    what was asked; ``truncated`` says whether more rows exist past ``limit``.
    """

    repo: str
    slot_id: str
    status: SlotCandidateStatus | None
    limit: int
    truncated: bool
    candidates: list[SlotCandidateOut]
