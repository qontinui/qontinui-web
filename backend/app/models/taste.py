"""The taste inbox — ``web.taste_pairs`` and ``web.taste_settings``.

Phase 23 of plan ``2026-10-13-image-generation-and-visual-judgment``. Mirrors
alembic revision ``taste_inbox_01``; read that migration's docstring for the
design rationale.

``TastePair``
    One pairwise question put to the operator: which of two images in the
    tenant's content-addressed store (``web.image_assets``, Phase 13) is
    better — for one image slot of one repo, or, for a calibration pair, for
    no slot at all. It carries the two in-situ captures when a capture run
    produced them (Phase 18; until then both are NULL and the inbox shows the
    bare images and says so), where the question came from (``source``), and,
    once answered, the label: ``a`` | ``b`` | ``both_bad``, the reason chips,
    an optional comment and an optional edit, the labeller and the time. The
    taste twin (Phase 24) reads the labelled rows.

``TasteLabelClock``
    One row per tenant: the last label-feed position handed out (see the
    class).

``TasteSettings``
    One row per tenant: the weekly labelling budget. No row means the
    default (:data:`DEFAULT_WEEKLY_BUDGET`), and the API says which.

Scoping is the image store's: every row carries ``tenant_id``, with no FK
(tenants live in coord's own deployment), and every query filters on it. Each
image a pair names is referenced through the composite FK
``(tenant_id, sha256) → web.image_assets``, so a pair can only ever name images
its own tenant holds.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

#: Where a pair came from. ``calibration`` — the first, deliberately diverse
#: batch (step 3); ``active_learning`` — pushed by studio where the judge panel
#: disagrees or the taste head is least certain; ``post_hoc`` — a sample of
#: images that already landed. Enforced by ``ck_taste_pairs_source``.
TASTE_PAIR_SOURCES: tuple[str, ...] = ("calibration", "active_learning", "post_hoc")

#: The operator's answer. ``a`` / ``b`` — that image is the better one;
#: ``both_bad`` — neither is acceptable. Enforced by ``ck_taste_pairs_label``.
TASTE_LABELS: tuple[str, ...] = ("a", "b", "both_bad")

#: How an answer was removed (``ck_taste_pairs_removal_via``): ``undo`` — the
#: pair went back to the queue; ``relabel`` — a new answer replaced it.
TASTE_REMOVAL_VIAS: tuple[str, ...] = ("undo", "relabel")

#: The longest comment, or edit note, a label may carry (characters).
MAX_TASTE_TEXT_CHARS = 2000

#: The weekly budget when a tenant has written none.
DEFAULT_WEEKLY_BUDGET = 30
#: The bounds a written weekly budget is held to (``ck_taste_settings_budget``).
MIN_WEEKLY_BUDGET = 1
MAX_WEEKLY_BUDGET = 1000


def _now() -> datetime:
    return datetime.now(UTC)


def _in_list(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


def _asset_fk(column: str, name: str, ondelete: str | None) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        ["tenant_id", column],
        ["web.image_assets.tenant_id", "web.image_assets.sha256"],
        ondelete=ondelete,
        name=name,
    )


class TastePair(Base):
    """One pairwise taste question, and — once answered — its label."""

    __tablename__ = "taste_pairs"
    __table_args__ = (
        # The two images are what the pair IS: it goes with either of them.
        _asset_fk("asset_a_sha256", "fk_taste_pairs_asset_a", "CASCADE"),
        _asset_fk("asset_b_sha256", "fk_taste_pairs_asset_b", "CASCADE"),
        # Captures and an attached edit are evidence ON the pair: an image
        # still referenced that way is not deleted out from under it.
        _asset_fk("capture_a_sha256", "fk_taste_pairs_capture_a", None),
        _asset_fk("capture_b_sha256", "fk_taste_pairs_capture_b", None),
        _asset_fk("edit_asset_sha256", "fk_taste_pairs_edit_asset", None),
        CheckConstraint(
            "asset_a_sha256 <> asset_b_sha256", name="ck_taste_pairs_distinct_assets"
        ),
        CheckConstraint(
            "(repo IS NULL) = (slot_id IS NULL)", name="ck_taste_pairs_slot_whole"
        ),
        CheckConstraint(
            "(capture_a_sha256 IS NULL) = (capture_b_sha256 IS NULL)",
            name="ck_taste_pairs_captures_paired",
        ),
        CheckConstraint(
            _in_list("source", TASTE_PAIR_SOURCES), name="ck_taste_pairs_source"
        ),
        CheckConstraint(
            "label IS NULL OR " + _in_list("label", TASTE_LABELS),
            name="ck_taste_pairs_label",
        ),
        CheckConstraint(
            "(label IS NULL) = (labelled_at IS NULL)", name="ck_taste_pairs_label_time"
        ),
        CheckConstraint(
            "label IS NULL OR first_labelled_at IS NOT NULL",
            name="ck_taste_pairs_labelled_first",
        ),
        CheckConstraint(
            "label IS NULL OR change_seq IS NOT NULL",
            name="ck_taste_pairs_labelled_seq",
        ),
        CheckConstraint(
            "(removed_at IS NULL) = (removed_label IS NULL) "
            "AND (removed_at IS NULL) = (removed_via IS NULL)",
            name="ck_taste_pairs_removal_whole",
        ),
        CheckConstraint(
            "removed_label IS NULL OR jsonb_typeof(removed_label) = 'object'",
            name="ck_taste_pairs_removal_object",
        ),
        CheckConstraint(
            "removed_via IS NULL OR " + _in_list("removed_via", TASTE_REMOVAL_VIAS),
            name="ck_taste_pairs_removal_via",
        ),
        CheckConstraint(
            "uncertainty IS NULL OR (uncertainty >= 0 AND uncertainty <= 1)",
            name="ck_taste_pairs_uncertainty",
        ),
        CheckConstraint(
            "jsonb_typeof(context) = 'object'", name="ck_taste_pairs_context_object"
        ),
        CheckConstraint(
            "jsonb_typeof(reasons) = 'array'", name="ck_taste_pairs_reasons_array"
        ),
        CheckConstraint(
            f"comment IS NULL OR char_length(comment) <= {MAX_TASTE_TEXT_CHARS}",
            name="ck_taste_pairs_comment_length",
        ),
        CheckConstraint(
            f"edit_note IS NULL OR char_length(edit_note) <= {MAX_TASTE_TEXT_CHARS}",
            name="ck_taste_pairs_edit_note_length",
        ),
        CheckConstraint("skip_count >= 0", name="ck_taste_pairs_skip_count"),
        # One row per unordered pair of images per slot (or per calibration
        # context): (A, B) and (B, A) are the same question.
        Index(
            "uq_taste_pairs_pair",
            "tenant_id",
            func.coalesce(text("repo"), text("''")),
            func.coalesce(text("slot_id"), text("''")),
            func.least(text("asset_a_sha256"), text("asset_b_sha256")),
            func.greatest(text("asset_a_sha256"), text("asset_b_sha256")),
            unique=True,
        ),
        Index(
            "ix_taste_pairs_pending",
            "tenant_id",
            "created_at",
            postgresql_where=text("label IS NULL"),
        ),
        Index(
            "ix_taste_pairs_labelled",
            "tenant_id",
            "labelled_at",
            postgresql_where=text("label IS NOT NULL"),
        ),
        Index(
            "uq_taste_pairs_change_seq",
            "tenant_id",
            "change_seq",
            unique=True,
            postgresql_where=text("change_seq IS NOT NULL"),
        ),
        {"schema": "web"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    repo: Mapped[str | None] = mapped_column(String(200), nullable=True)
    slot_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    asset_a_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    asset_b_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    capture_a_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    capture_b_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    #: How unsure the pusher was, 0..1 (higher is asked first); NULL when the
    #: pusher had no measure (every calibration pair).
    uncertainty: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: Why the pair was pushed: the panel's votes, the head's margin, the
    #: calibration directions. Opaque to the inbox; shown in the detail.
    context: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    #: The principal kind that pushed it (``device`` | ``coord_service`` |
    #: ``operator``).
    pushed_by: Mapped[str] = mapped_column(String(32), nullable=False)
    skipped_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    skip_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    label: Mapped[str | None] = mapped_column(String(16), nullable=True)
    reasons: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: What the labeller would change — a designer's edit, which beats a
    #: rating as a training signal (report §5.6).
    edit_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: An edited image the labeller attached (uploaded to the store first).
    edit_asset_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    labeller_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            "auth.users.id", ondelete="SET NULL", name="fk_taste_pairs_labeller"
        ),
        nullable=True,
    )
    labelled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: When the pair was FIRST answered; kept across an undo and a relabel, so
    #: the weekly budget charges a pair once, in the week it was first answered.
    first_labelled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: The pair's position in the tenant's label feed (``GET /taste/labels``),
    #: from :class:`TasteLabelClock` on every label and every undo. NULL until
    #: the pair is first answered.
    change_seq: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    #: The most recent REMOVAL of an answer (an undo, or a relabel that
    #: replaced it): when, by whom, whether it removed ANOTHER labeller's
    #: answer, and that answer as it stood.
    removed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    removed_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            "auth.users.id", ondelete="SET NULL", name="fk_taste_pairs_removed_by"
        ),
        nullable=True,
    )
    removed_forced: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    removed_label: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    #: How the answer was removed: ``undo`` or ``relabel`` (replaced).
    removed_via: Mapped[str | None] = mapped_column(String(8), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )


class TasteLabelClock(Base):
    """A tenant's label-feed clock: the last position handed out.

    A label write increments ``last_seq`` with ``INSERT … ON CONFLICT DO
    UPDATE`` and holds the row lock until its transaction ends, so per tenant
    positions are handed out in commit order — the property that lets the
    taste twin page ``GET /taste/labels`` by position without ever skipping a
    late commit.
    """

    __tablename__ = "taste_label_clock"
    __table_args__ = (
        CheckConstraint("last_seq >= 1", name="ck_taste_label_clock_positive"),
        {"schema": "web"},
    )

    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    last_seq: Mapped[int] = mapped_column(BigInteger, nullable=False)


class TasteSettings(Base):
    """A tenant's taste-inbox settings: the weekly labelling budget."""

    __tablename__ = "taste_settings"
    __table_args__ = (
        CheckConstraint(
            f"weekly_budget BETWEEN {MIN_WEEKLY_BUDGET} AND {MAX_WEEKLY_BUDGET}",
            name="ck_taste_settings_budget",
        ),
        {"schema": "web"},
    )

    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    weekly_budget: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            "auth.users.id", ondelete="SET NULL", name="fk_taste_settings_updated_by"
        ),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )
