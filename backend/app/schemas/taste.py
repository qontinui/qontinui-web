"""Request and response shapes of the taste inbox.

Phase 23 of plan ``2026-10-13-image-generation-and-visual-judgment``; the
routes are ``app/api/v1/endpoints/taste.py`` and the tables
``web.taste_pairs`` / ``web.taste_settings`` (``app.models.taste``). The tenant
never appears in a request — it is the server-side principal.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Final, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.taste import (
    MAX_TASTE_TEXT_CHARS,
    MAX_WEEKLY_BUDGET,
    MIN_WEEKLY_BUDGET,
)
from app.schemas.image_assets import (
    MAX_CANDIDATE_JSON_BYTES,
    REPO_PATTERN,
    SHA256_PATTERN,
    SLOT_ID_PATTERN,
    ImageAssetKind,
    _storable_json_size,
)

#: Where a pair came from. Equal to ``app.models.taste.TASTE_PAIR_SOURCES``
#: (the CHECK's list); ``tests/test_taste_api.py`` holds the two equal.
TasteSource = Literal["calibration", "active_learning", "post_hoc"]
#: The operator's answer. Equal to ``TASTE_LABELS``.
TasteLabel = Literal["a", "b", "both_bad"]

#: The reason chips a label may carry — a CLOSED vocabulary, so the taste
#: twin (Phase 24) can learn a glossary from reason-tagged pairs instead of
#: parsing prose. Ten, so each has a number key (1-9, 0) in the inbox.
TasteReason = Literal[
    "on_style",
    "off_style",
    "off_palette",
    "composition",
    "cropping",
    "wrong_subject",
    "too_busy",
    "text_in_image",
    "artifacts",
    "low_quality",
]
TASTE_REASONS: Final[tuple[str, ...]] = (
    "on_style",
    "off_style",
    "off_palette",
    "composition",
    "cropping",
    "wrong_subject",
    "too_busy",
    "text_in_image",
    "artifacts",
    "low_quality",
)

#: The provenance key a calibration batch reads an image's DIRECTION from (a
#: generator records the style direction it was asked for there). An image
#: carrying none is grouped as :data:`UNDECLARED_DIRECTION`, or — when the
#: operator uploaded it as an exemplar — :data:`REFERENCE_DIRECTION`.
DIRECTION_KEY: Final = "direction"
UNDECLARED_DIRECTION: Final = "undeclared"
REFERENCE_DIRECTION: Final = "reference"

MAX_CALIBRATION_BATCH: Final = 100
DEFAULT_CALIBRATION_BATCH: Final = 20


def _check_json(value: dict[str, Any], name: str) -> dict[str, Any]:
    if _storable_json_size(value, name) > MAX_CANDIDATE_JSON_BYTES:
        raise ValueError(
            f"{name} is larger than {MAX_CANDIDATE_JSON_BYTES} bytes as JSON"
        )
    return value


# ── pushes ──────────────────────────────────────────────────────────────


class TastePairPush(BaseModel):
    """``POST /api/v1/taste/pairs`` — put one pairwise question in the queue.

    Studio's door (Phase 20 onward: where the judge panel disagrees or the
    taste head is least certain, plus post-hoc samples of landed images).
    Identity is the slot plus the UNORDERED pair of images: a push of a pair
    already queued answers with that row (``created: false``) and changes
    nothing.
    """

    model_config = ConfigDict(extra="forbid")

    #: ``repo`` and ``slot_id`` together, or neither (a pair that serves no
    #: slot, such as a calibration pair).
    repo: str | None = Field(
        default=None, min_length=1, max_length=200, pattern=REPO_PATTERN
    )
    slot_id: str | None = Field(
        default=None, min_length=1, max_length=200, pattern=SLOT_ID_PATTERN
    )
    asset_a_sha256: str = Field(pattern=SHA256_PATTERN)
    asset_b_sha256: str = Field(pattern=SHA256_PATTERN)
    #: The in-situ capture of each image on its page (an image of kind
    #: ``capture`` in the store) — both or neither.
    capture_a_sha256: str | None = Field(default=None, pattern=SHA256_PATTERN)
    capture_b_sha256: str | None = Field(default=None, pattern=SHA256_PATTERN)
    source: TasteSource
    #: How unsure the pusher is, 0..1; more uncertain pairs are asked first.
    uncertainty: float | None = Field(default=None, ge=0, le=1)
    #: Why the pair was pushed (panel votes, margins), as the pusher names it.
    context: dict[str, Any] = Field(default_factory=dict)

    @field_validator("context")
    @classmethod
    def _cap_context(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _check_json(value, "context")

    @model_validator(mode="after")
    def _shape(self) -> TastePairPush:
        if self.asset_a_sha256 == self.asset_b_sha256:
            raise ValueError("asset_a_sha256 and asset_b_sha256 must differ")
        if (self.repo is None) != (self.slot_id is None):
            raise ValueError("repo and slot_id are sent together, or neither")
        if (self.capture_a_sha256 is None) != (self.capture_b_sha256 is None):
            raise ValueError("capture_a_sha256 and capture_b_sha256 are sent together")
        return self


# ── labels ──────────────────────────────────────────────────────────────


class TasteLabelWrite(BaseModel):
    """``PUT /api/v1/taste/pairs/{id}/label`` — answer one pair.

    A pair someone has already labelled is refused (409
    ``pair_already_labelled``) unless ``relabel`` is true, so two labellers
    working the queue at once never silently overwrite each other.
    """

    model_config = ConfigDict(extra="forbid")

    choice: TasteLabel
    reasons: list[TasteReason] = Field(
        default_factory=list, max_length=len(TASTE_REASONS)
    )
    comment: str | None = Field(default=None, max_length=MAX_TASTE_TEXT_CHARS)
    #: What the labeller would change. An edit beats a rating as a training
    #: signal (report §5.6).
    edit_note: str | None = Field(default=None, max_length=MAX_TASTE_TEXT_CHARS)
    #: An edited image, uploaded to the store first.
    edit_asset_sha256: str | None = Field(default=None, pattern=SHA256_PATTERN)
    relabel: bool = False

    @field_validator("reasons")
    @classmethod
    def _unique_reasons(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("reasons must not repeat")
        return value

    @field_validator("comment", "edit_note")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if "\x00" in value:
            raise ValueError("must not contain U+0000")
        stripped = value.strip()
        return stripped or None


class TasteSettingsWrite(BaseModel):
    """``PUT /api/v1/taste/settings``."""

    model_config = ConfigDict(extra="forbid")

    weekly_budget: int = Field(ge=MIN_WEEKLY_BUDGET, le=MAX_WEEKLY_BUDGET)


class CalibrationBatchRequest(BaseModel):
    """``POST /api/v1/taste/calibration-batch``."""

    model_config = ConfigDict(extra="forbid")

    size: int = Field(default=DEFAULT_CALIBRATION_BATCH, ge=1, le=MAX_CALIBRATION_BATCH)


# ── responses ───────────────────────────────────────────────────────────


class TasteImage(BaseModel):
    """One image of a pair, as the store holds it."""

    sha256: str
    kind: ImageAssetKind
    mime_type: str
    width: int
    height: int
    byte_size: int
    #: ``provenance.direction`` when the image declares one, else null.
    direction: str | None


class TasteRemovedLabel(BaseModel):
    """The answer an undo removed, as it stood."""

    label: TasteLabel
    reasons: list[TasteReason]
    comment: str | None
    edit_note: str | None
    edit_asset_sha256: str | None
    labeller_user_id: UUID | None
    #: The removed answer's labeller, when that user still exists.
    labeller_name: str | None
    labelled_at: datetime


class TasteUndo(BaseModel):
    """The most recent undo of a pair's label. Kept after the pair is
    answered again, so a removed answer is never lost without a trace."""

    undone_at: datetime
    undone_by_user_id: UUID | None
    undone_by_name: str | None
    #: True when the undo removed ANOTHER labeller's answer (``force``).
    forced: bool
    removed: TasteRemovedLabel


class TastePairOut(BaseModel):
    id: UUID
    repo: str | None
    slot_id: str | None
    source: TasteSource
    uncertainty: float | None
    context: dict[str, Any]
    asset_a: TasteImage
    asset_b: TasteImage
    capture_a_sha256: str | None
    capture_b_sha256: str | None
    #: Whether the pair carries in-situ captures. False means the inbox can
    #: only show the bare images: in-situ capture (plan Phase 18) has not
    #: produced captures for this pair.
    in_situ: bool
    pushed_by: str
    skipped_at: datetime | None
    skip_count: int
    label: TasteLabel | None
    reasons: list[TasteReason]
    comment: str | None
    edit_note: str | None
    edit_asset_sha256: str | None
    labeller_user_id: UUID | None
    #: The labeller's name (or email) when the user still exists.
    labeller_name: str | None
    labelled_at: datetime | None
    #: When the pair was FIRST answered — the week whose budget it was
    #: charged to. Kept across an undo and a relabel.
    first_labelled_at: datetime | None
    #: The pair's position in the tenant's label feed (``GET /taste/labels``);
    #: null until the pair is first answered. Moves on every label and undo.
    change_seq: int | None
    #: True for a feed row whose latest change was an undo: ``label`` is null
    #: and the pair is back in the queue. ``undo`` says what was removed.
    tombstone: bool
    undo: TasteUndo | None
    created_at: datetime
    updated_at: datetime


class TastePairPushResponse(BaseModel):
    pair: TastePairOut
    #: True when this push created the row; false when the pair was queued.
    created: bool


class TasteBudget(BaseModel):
    """The weekly labelling budget and how much of it this week has used.

    A week starts Monday 00:00 UTC. ``source`` says whether ``weekly_budget``
    was written for this tenant (``setting``) or is the declared default
    (``default``). A pair is charged ONCE, to the week it was first
    answered: relabelling it, or undoing and answering it again, costs
    nothing.
    """

    weekly_budget: int
    source: Literal["setting", "default"]
    week_starts_at: datetime
    labelled_this_week: int
    remaining: int


class TasteDirection(BaseModel):
    direction: str
    images: int


class TastePool(BaseModel):
    """The images a calibration batch can draw from: every ``candidate`` and
    ``exemplar`` the tenant holds, grouped by direction."""

    images: int
    directions: list[TasteDirection]


class TasteInbox(BaseModel):
    """``GET /api/v1/taste/inbox`` — everything the inbox page renders, in
    one read.

    ``pairs`` is the head of the queue in the order it is asked: never-skipped
    pairs first (most uncertain, then oldest), then skipped ones (least
    recently skipped first). While the week's budget is spent it is empty
    unless ``over_budget`` was asked for — the queue itself is untouched, and
    ``pending_total`` still counts it.
    """

    budget: TasteBudget
    pending_total: int
    labelled_total: int
    #: The caller's own user id (an operator's session), or null for a device
    #: or service credential. The page undoes the newest label carrying it.
    viewer_user_id: UUID | None
    over_budget: bool
    pairs: list[TastePairOut]
    #: The most recent labels, newest first — the undo list.
    recent: list[TastePairOut]
    pool: TastePool
    #: Whether THIS caller may label, skip, set the budget or build a batch —
    #: the rule those routes enforce: coord-tenant admin in the effective
    #: tenant, or a qontinui superuser. Always false for a device or service
    #: credential.
    can_label: bool
    reason_vocabulary: list[TasteReason]


class TasteLabelPage(BaseModel):
    """``GET /api/v1/taste/labels`` — the tenant's label feed, for the taste
    twin (Phase 24).

    Every pair that has ever been answered, once, at its LATEST change, in
    ``change_seq`` order. A label or relabel is a row with ``label`` set; an
    undo is a tombstone (``tombstone: true``, ``label`` null). Positions are
    handed out in commit order per tenant, so paging by ``next_cursor`` never
    skips a late commit; a pair changed again reappears at its new position,
    so a reader that keeps the last row per pair id holds the current state.
    ``next_cursor`` is the position after the last row returned — or the
    ``after`` that was sent, when the page is empty — so it is set on the
    LAST page too: to follow the feed, ask again later with it. ``truncated``
    says whether more rows exist right now.
    """

    limit: int
    truncated: bool
    next_cursor: str | None
    labels: list[TastePairOut]


class TasteSettingsOut(BaseModel):
    weekly_budget: int
    source: Literal["setting", "default"]
    updated_at: datetime | None


class CalibrationBatchResult(BaseModel):
    """What a calibration build did.

    ``created`` new pairs were queued; ``already_queued`` were pairs the
    builder chose that the queue already held. ``shortfall`` names why fewer
    than ``requested`` were created: ``pool_too_small`` (fewer than two images
    to pair), ``pool_exhausted`` (every pairing the pool allows is queued),
    ``concurrent_build`` (another build queued some of this one's pairs
    first).
    """

    requested: int
    created: int
    already_queued: int
    pool: TastePool
    shortfall: Literal["pool_too_small", "pool_exhausted", "concurrent_build"] | None
    pair_ids: list[UUID]
