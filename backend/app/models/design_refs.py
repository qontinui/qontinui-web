"""The design reference library — the ``design_refs`` schema.

Phase 1 (with the Phase 1b store additions folded in) of plan
``2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query``.
Mirrors alembic revision ``design_refs_01``; read that migration's docstring for
the table-by-table rationale.

Three families of table live here:

* **Records** — ``site``, ``page``, ``flow``, ``capture``, ``capture_source``,
  ``replay_bundle``, ``component``, ``asset_fingerprint``, ``description``:
  one third-party site captured by a worker, described, and stored. Every
  record carries ``tier`` (``private`` | ``public``), the gate for every read.
  Heavy payloads are content-addressed blobs in object storage, keyed
  ``design-refs/<tier>/<tenant>/sha256/…``; Postgres holds facets, tokens,
  embeddings, fingerprints and the blob keys (``blob`` records each verified
  object once).
* **Judgements** — ``style_family``, ``perception_dimension`` and
  ``personality_trait`` are GLOBAL vocabularies (no ``tenant_id``, writable
  only by a superuser); ``perception_rating``, ``comparison``,
  ``site_personality``, ``design_principle``, ``design_principle_evidence`` and
  ``judge_bench_run`` are tenant-scoped and append-only except for takedown.
  There is no overall grade anywhere: every judgement is per dimension.
* **Intake and curation** — ``capture_job`` (the worker queue), ``correction``
  (the append-only edit log) and ``do_not_capture`` (the takedown list).

Tenancy is the image store's: every tenant-scoped row carries ``tenant_id``
with no FK (tenants live in coord's own deployment) and every query filters on
it. Foreign keys run only WITHIN the schema (a page to its site, a capture to
its page, …) so a takedown's row deletion cascades down the record tree; the
polymorphic judgement targets have no FK and the takedown code removes them.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Final
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    DDL,
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    event,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

SCHEMA: Final = "design_refs"

#: The pinned embedding width (MiniLM-L6-v2). Embeddings are computed by the
#: CLIENT (describer for records, caller for queries); the backend never
#: computes one.
EMBEDDING_DIM: Final = 384

# ── closed vocabularies (each enforced by a named CHECK) ────────────────

TIERS: Final[tuple[str, ...]] = ("private", "public")
REVIEW_STATES: Final[tuple[str, ...]] = ("pending", "approved", "rejected")
QUALITIES: Final[tuple[str, ...]] = ("exemplar", "ok", "anti_pattern")
PRICE_TIERS: Final[tuple[str, ...]] = ("budget", "mid", "premium", "luxury", "unknown")
CONTEXT_STATES: Final[tuple[str, ...]] = ("proposed", "confirmed")
SPLITS: Final[tuple[str, ...]] = ("reference", "holdout")
DESCRIPTION_LEVELS: Final[tuple[str, ...]] = ("site", "page", "flow", "component")
#: What a perception rating, a comparison or a takedown target may name.
JUDGEMENT_TARGET_KINDS: Final[tuple[str, ...]] = ("site", "page", "component")
RATER_KINDS: Final[tuple[str, ...]] = ("operator", "ai")
CONFIDENCES: Final[tuple[str, ...]] = ("low", "medium", "high")
WINNERS: Final[tuple[str, ...]] = ("a", "b", "tie")
SHOWN_ORDERS: Final[tuple[str, ...]] = ("a_first", "b_first")
PERSONALITY_STATES: Final[tuple[str, ...]] = ("proposed", "confirmed")
PRINCIPLE_STATUSES: Final[tuple[str, ...]] = ("proposed", "approved", "retired")
EVIDENCE_ROLES: Final[tuple[str, ...]] = ("supports", "counterexample")
EVIDENCE_KINDS: Final[tuple[str, ...]] = ("perception_rating", "comparison")
ASSET_CLASSES: Final[tuple[str, ...]] = ("image", "svg", "icon", "font", "text")
JOB_SCOPES: Final[tuple[str, ...]] = ("page", "crawl", "flow")
JOB_SOURCES: Final[tuple[str, ...]] = ("operator", "cli", "mcp", "discovery")
JOB_STATES: Final[tuple[str, ...]] = (
    "proposed",
    "rejected",
    "queued",
    "running",
    "done",
    "failed",
    "cancelled",
)
CORRECTION_TARGET_KINDS: Final[tuple[str, ...]] = (
    "site",
    "page",
    "flow",
    "component",
    "description",
    "capture_job",
    "site_personality",
    "design_principle",
)
BENCH_VERDICTS: Final[tuple[str, ...]] = ("measured", "unknown")

#: Numeric capture facets the correlation scan reads (``capture.facets``).
MEASURED_FACETS: Final[tuple[str, ...]] = (
    "background_luminance",
    "palette_saturation",
    "type_scale_ratio",
)

# ── seeded vocabularies (the migration inserts exactly these rows) ──────

#: ``(key, label)`` — the pilot's five families plus ``other``.
SEED_STYLE_FAMILIES: Final[tuple[tuple[str, str], ...]] = (
    ("luxury_premium", "Luxury / premium"),
    ("modern_saas", "Modern SaaS"),
    ("architecture_editorial", "Architecture / editorial"),
    ("corporate_professional", "Corporate / professional"),
    ("creative_experimental", "Creative / experimental"),
    ("other", "Other"),
)

#: ``(key, pole_high, pole_low, {"1": …, "4": …, "7": …, "10": …})``. Score 10
#: is ``pole_high``, 1 is ``pole_low``. Higher is not "better" on every
#: dimension — which end is wanted comes from the site's intended personality.
SEED_PERCEPTION_DIMENSIONS: Final[tuple[tuple[str, str, str, dict[str, str]], ...]] = (
    (
        "premium",
        "premium",
        "cheap",
        {
            "1": "Reads as cheap: stock imagery, crowded offers, default type and colour.",
            "4": "Serviceable but budget-leaning: some care, several bargain-bin cues.",
            "7": "Reads as quality: restrained palette, considered imagery, few lapses.",
            "10": "Unmistakably premium: every surface signals cost and care.",
        },
    ),
    (
        "refined",
        "refined",
        "unpolished",
        {
            "1": "Unpolished: misalignments, inconsistent spacing, rough edges everywhere.",
            "4": "Mostly rough with some tidy areas; finishing is uneven.",
            "7": "Refined on the whole; small details occasionally slip.",
            "10": "Fully refined: alignment, spacing and detail are exact throughout.",
        },
    ),
    (
        "crafted",
        "crafted",
        "generic",
        {
            "1": "Generic: a template used as-is, nothing made for this product.",
            "4": "Template-based with light customisation.",
            "7": "Clearly made for this product, with a few stock parts.",
            "10": "Crafted end to end: bespoke decisions visible in every section.",
        },
    ),
    (
        "intelligent",
        "intelligent",
        "superficial",
        {
            "1": "Superficial: decoration with no information structure behind it.",
            "4": "Some useful structure under mostly surface-level styling.",
            "7": "Information is organised thoughtfully; styling serves it.",
            "10": "Deeply intelligent: structure, hierarchy and content reinforce each other.",
        },
    ),
    (
        "thoughtful",
        "thoughtful",
        "arbitrary",
        {
            "1": "Arbitrary: choices look random and contradict each other.",
            "4": "Some choices have a reason, many do not.",
            "7": "Most choices have a visible reason.",
            "10": "Every choice reads as deliberate and justified.",
        },
    ),
    (
        "editorial",
        "editorial",
        "promotional",
        {
            "1": "Promotional: hard sell, banners, urgency and offers dominate.",
            "4": "Sales-led with some editorial passages.",
            "7": "Editorial in tone, with occasional promotional blocks.",
            "10": "Fully editorial: content leads, selling is implicit.",
        },
    ),
    (
        "comfortable",
        "comfortable",
        "uncomfortable",
        {
            "1": "Uncomfortable: strain to read, cramped, jarring motion or contrast.",
            "4": "Usable but tiring in places.",
            "7": "Comfortable to read and move through, minor friction.",
            "10": "Effortless: reading and navigating feel easy throughout.",
        },
    ),
    (
        "welcoming",
        "welcoming",
        "cold",
        {
            "1": "Cold: distant, impersonal, nothing invites the visitor in.",
            "4": "Neutral leaning cold.",
            "7": "Friendly and inviting with some reserve.",
            "10": "Warmly welcoming from the first screen.",
        },
    ),
    (
        "calm",
        "calm",
        "chaotic",
        {
            "1": "Chaotic: competing focal points, noise, no resting place for the eye.",
            "4": "Busy, with a few calm regions.",
            "7": "Mostly calm; a few busy moments.",
            "10": "Completely calm: clear focus and generous rest.",
        },
    ),
    (
        "playful",
        "playful",
        "serious",
        {
            "1": "Entirely serious: formal, sober, no levity.",
            "4": "Mostly serious with a light touch here and there.",
            "7": "Playful in tone and detail, still composed.",
            "10": "Thoroughly playful: humour and whimsy throughout.",
        },
    ),
    (
        "elegant",
        "elegant",
        "clumsy",
        {
            "1": "Clumsy: heavy, awkward proportions and transitions.",
            "4": "Some grace, often awkward.",
            "7": "Elegant overall, an occasional heavy-handed moment.",
            "10": "Effortlessly elegant: proportion and motion are graceful.",
        },
    ),
    (
        "minimal",
        "minimal",
        "cluttered",
        {
            "1": "Cluttered: everything competes for space.",
            "4": "Dense, some breathing room.",
            "7": "Minimal with a few dense areas.",
            "10": "Strictly minimal: only what is needed is present.",
        },
    ),
    (
        "distinctive",
        "distinctive",
        "generic",
        {
            "1": "Indistinguishable from many sites in its category.",
            "4": "Familiar with one or two recognisable traits.",
            "7": "Recognisable; a clear own voice with some convention.",
            "10": "Unmistakable: could not be mistaken for anyone else.",
        },
    ),
    (
        "harmonious",
        "harmonious",
        "inconsistent",
        {
            "1": "Inconsistent: components, colours and type disagree across pages.",
            "4": "Some shared system, frequent departures.",
            "7": "Harmonious with occasional inconsistencies.",
            "10": "Fully harmonious: one system, applied everywhere.",
        },
    ),
    (
        "trustworthy",
        "trustworthy",
        "suspicious",
        {
            "1": "Suspicious: dark patterns, unclear ownership, alarming claims.",
            "4": "Some doubt: missing proof, pushy patterns.",
            "7": "Trustworthy with minor doubts.",
            "10": "Fully trustworthy: transparent, credible, proof where needed.",
        },
    ),
    (
        "professional",
        "professional",
        "amateur",
        {
            "1": "Amateur: obvious beginner mistakes throughout.",
            "4": "Semi-professional; several amateur tells.",
            "7": "Professional with small slips.",
            "10": "Fully professional execution.",
        },
    ),
    (
        "confident",
        "confident",
        "uncertain",
        {
            "1": "Uncertain: hedging copy, timid hierarchy, no clear point of view.",
            "4": "Some conviction, often hesitant.",
            "7": "Confident, with occasional hedging.",
            "10": "Fully confident: bold hierarchy and a clear point of view.",
        },
    ),
)

#: ``(key, description)`` — the design personality profile's seven traits.
SEED_PERSONALITY_TRAITS: Final[tuple[tuple[str, str], ...]] = (
    ("sophistication", "How cultivated and refined the character of the design is."),
    ("warmth", "How friendly and emotionally warm the design feels."),
    ("minimalism", "How reduced the design is to essentials."),
    ("playfulness", "How much humour, whimsy and lightness the design carries."),
    ("confidence", "How assertive and self-assured the voice of the design is."),
    ("approachability", "How easy the design is to approach for a newcomer."),
    (
        "experimental_character",
        "How far the design departs from convention on purpose.",
    ),
)


def _now() -> datetime:
    return datetime.now(UTC)


def _in_list(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


def _check_in(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    return CheckConstraint(_in_list(column, values), name=name)


def _check_in_nullable(
    column: str, values: tuple[str, ...], name: str
) -> CheckConstraint:
    return CheckConstraint(
        f"{column} IS NULL OR " + _in_list(column, values), name=name
    )


def _tier_key(column: str, name: str) -> CheckConstraint:
    """A blob key column holds a key under its row's own tier prefix."""
    return CheckConstraint(
        f"{column} IS NULL OR {column} LIKE 'design-refs/' || tier || '/%'",
        name=name,
    )


def _private_key(column: str, name: str) -> CheckConstraint:
    """Source copies and replay bundles are ``private/`` whatever the tier."""
    return CheckConstraint(f"{column} LIKE 'design-refs/private/%'", name=name)


def _uuid_pk() -> Mapped[UUID]:
    return mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )


def _tenant() -> Mapped[UUID]:
    return mapped_column(PGUUID(as_uuid=True), nullable=False)


def _created() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )


def _updated() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        onupdate=_now,
        server_default=text("now()"),
    )


def _jsonb_object() -> Mapped[dict[str, Any]]:
    return mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )


def _jsonb_array() -> Mapped[list[Any]]:
    return mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )


def _tier() -> Mapped[str]:
    return mapped_column(String(16), nullable=False)


def _review_state() -> Mapped[str]:
    return mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )


def _quality() -> Mapped[str | None]:
    return mapped_column(String(16), nullable=True)


def _curation_checks(table: str) -> tuple[CheckConstraint, ...]:
    return (
        _check_in("tier", TIERS, f"ck_{table}_tier"),
        _check_in("review_state", REVIEW_STATES, f"ck_{table}_review_state"),
        _check_in_nullable("quality", QUALITIES, f"ck_{table}_quality"),
    )


# ═════════════════════════ global vocabularies ═════════════════════════


class StyleFamily(Base):
    """A controlled style family (global; superuser-writable)."""

    __tablename__ = "style_family"
    __table_args__ = {"schema": SCHEMA}

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_at: Mapped[datetime] = _created()


class PerceptionDimension(Base):
    """A bipolar perception dimension with anchor texts at 1, 4, 7 and 10."""

    __tablename__ = "perception_dimension"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_perception_dimension_version"),
        CheckConstraint(
            "jsonb_typeof(anchors) = 'object' "
            "AND anchors ?& array['1', '4', '7', '10']",
            name="ck_perception_dimension_anchors",
        ),
        {"schema": SCHEMA},
    )

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    pole_high: Mapped[str] = mapped_column(Text, nullable=False)
    pole_low: Mapped[str] = mapped_column(Text, nullable=False)
    anchors: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False)
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class PersonalityTrait(Base):
    """A design personality trait (global; superuser-writable)."""

    __tablename__ = "personality_trait"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_personality_trait_version"),
        {"schema": SCHEMA},
    )

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_at: Mapped[datetime] = _created()


# ═════════════════════════════ records ═════════════════════════════


class Blob(Base):
    """One verified object in the store: its key, digest and size.

    Written only after the backend has re-read the object and checked its
    SHA-256 and size; a record may name only a key this table holds for the
    record's own tenant. Takedown deletes a blob (row and object) only when no
    surviving record's key column still names it.
    """

    __tablename__ = "blob"
    __table_args__ = (
        _check_in("tier", TIERS, "ck_blob_tier"),
        CheckConstraint(
            "key LIKE 'design-refs/' || tier || '/' || tenant_id::text || '/sha256/%'",
            name="ck_blob_key_shape",
        ),
        CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name="ck_blob_sha256"),
        CheckConstraint("size >= 0", name="ck_blob_size"),
        Index("ix_blob_tenant", "tenant_id"),
        {"schema": SCHEMA},
    )

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[UUID] = _tenant()
    tier: Mapped[str] = _tier()
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_at: Mapped[datetime] = _created()


class Site(Base):
    """One site (per tenant, per tier): its context and its holdout split."""

    __tablename__ = "site"
    __table_args__ = (
        *_curation_checks("site"),
        _check_in("price_tier", PRICE_TIERS, "ck_site_price_tier"),
        _check_in("context_state", CONTEXT_STATES, "ck_site_context_state"),
        _check_in_nullable("split", SPLITS, "ck_site_split"),
        # A split is assigned at the first context confirmation, never before.
        CheckConstraint(
            "split IS NULL OR context_state = 'confirmed'",
            name="ck_site_split_after_confirmation",
        ),
        CheckConstraint(
            "(context_state = 'confirmed') = (context_confirmed_at IS NOT NULL)",
            name="ck_site_context_confirmed_at",
        ),
        CheckConstraint("jsonb_typeof(tags) = 'array'", name="ck_site_tags_array"),
        UniqueConstraint(
            "tenant_id", "tier", "domain", name="uq_site_tenant_tier_domain"
        ),
        Index("ix_site_tenant_domain", "tenant_id", "domain"),
        Index("ix_site_tenant_family_split", "tenant_id", "style_family", "split"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    tier: Mapped[str] = _tier()
    domain: Mapped[str] = mapped_column(Text, nullable=False)
    product_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    industry: Mapped[str | None] = mapped_column(Text, nullable=True)
    business_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    audience: Mapped[str | None] = mapped_column(Text, nullable=True)
    positioning: Mapped[str | None] = mapped_column(Text, nullable=True)
    price_tier: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unknown", server_default="unknown"
    )
    intended_personality: Mapped[str | None] = mapped_column(Text, nullable=True)
    style_family: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey(
            f"{SCHEMA}.style_family.key",
            ondelete="RESTRICT",
            name="fk_site_style_family",
        ),
        nullable=True,
    )
    context_state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="proposed", server_default="proposed"
    )
    context_confirmed_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    context_confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: ``reference`` | ``holdout``; NULL until the context is first confirmed,
    #: immutable afterwards (``trg_site_split_immutable``).
    split: Mapped[str | None] = mapped_column(String(16), nullable=True)
    split_assigned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tags: Mapped[list[Any]] = _jsonb_array()
    review_state: Mapped[str] = _review_state()
    quality: Mapped[str | None] = _quality()
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


#: The database half of the split's immutability: the API refuses a change
#: first, and this trigger refuses one that reaches SQL any other way.
SPLIT_IMMUTABLE_FUNCTION_SQL: Final = """
CREATE OR REPLACE FUNCTION design_refs.site_split_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.split IS NOT NULL AND NEW.split IS DISTINCT FROM OLD.split THEN
        RAISE EXCEPTION 'design_refs.site.split is immutable once assigned'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$
"""
SPLIT_IMMUTABLE_TRIGGER_SQL: Final = """
CREATE OR REPLACE TRIGGER trg_site_split_immutable
    BEFORE UPDATE OF split ON design_refs.site
    FOR EACH ROW EXECUTE FUNCTION design_refs.site_split_immutable()
"""

event.listen(Site.__table__, "after_create", DDL(SPLIT_IMMUTABLE_FUNCTION_SQL))
event.listen(Site.__table__, "after_create", DDL(SPLIT_IMMUTABLE_TRIGGER_SQL))


class CaptureJob(Base):
    """One request to capture a URL: the worker queue (Phase 1b store)."""

    __tablename__ = "capture_job"
    __table_args__ = (
        _check_in("scope_kind", JOB_SCOPES, "ck_capture_job_scope_kind"),
        _check_in("source", JOB_SOURCES, "ck_capture_job_source"),
        _check_in("state", JOB_STATES, "ck_capture_job_state"),
        _check_in_nullable("derived_tier", TIERS, "ck_capture_job_derived_tier"),
        CheckConstraint(
            "(scope_kind = 'crawl') = (crawl_depth IS NOT NULL)",
            name="ck_capture_job_crawl_depth",
        ),
        CheckConstraint(
            "crawl_depth IS NULL OR crawl_depth BETWEEN 1 AND 10",
            name="ck_capture_job_crawl_depth_range",
        ),
        CheckConstraint(
            "(scope_kind = 'flow') = (flow_goal IS NOT NULL)",
            name="ck_capture_job_flow_goal",
        ),
        # rule (h): a reproduction is always private.
        CheckConstraint(
            "NOT is_reproduction OR derived_tier IS NULL OR derived_tier = 'private'",
            name="ck_capture_job_reproduction_private",
        ),
        Index("ix_capture_job_tenant_state", "tenant_id", "state", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    url: Mapped[str] = mapped_column(Text, nullable=False)
    domain: Mapped[str] = mapped_column(Text, nullable=False)
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    crawl_depth: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    flow_goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    submitter_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    submitter_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_reproduction: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    claimed_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The worker's lease: a ``running`` job whose lease has passed is
    #: claimable again, so a dead worker's job is re-queued.
    claimed_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    derived_tier: Mapped[str | None] = mapped_column(String(16), nullable=True)
    tier_reason: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class Page(Base):
    """One captured page of a site."""

    __tablename__ = "page"
    __table_args__ = (
        *_curation_checks("page"),
        CheckConstraint("jsonb_typeof(viewports) = 'array'", name="ck_page_viewports"),
        CheckConstraint(
            "jsonb_typeof(capture_basis) = 'object'", name="ck_page_capture_basis"
        ),
        CheckConstraint("jsonb_typeof(tags) = 'array'", name="ck_page_tags_array"),
        Index("ix_page_tenant_site", "tenant_id", "site_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    tier: Mapped[str] = _tier()
    site_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{SCHEMA}.site.id", ondelete="CASCADE", name="fk_page_site"),
        nullable=False,
    )
    capture_job_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            f"{SCHEMA}.capture_job.id", ondelete="SET NULL", name="fk_page_capture_job"
        ),
        nullable=True,
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The job the page serves, in one line.
    page_job: Mapped[str | None] = mapped_column(Text, nullable=True)
    captured_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    viewports: Mapped[list[Any]] = _jsonb_array()
    #: The robots verdict, its raw body digest and fetch time, and the
    #: public-reachability result — the takedown evidence.
    capture_basis: Mapped[dict[str, Any]] = _jsonb_object()
    tags: Mapped[list[Any]] = _jsonb_array()
    review_state: Mapped[str] = _review_state()
    quality: Mapped[str | None] = _quality()
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class Flow(Base):
    """An ordered journey over a site's pages (signup, checkout…)."""

    __tablename__ = "flow"
    __table_args__ = (
        *_curation_checks("flow"),
        CheckConstraint("jsonb_typeof(steps) = 'array'", name="ck_flow_steps"),
        CheckConstraint("jsonb_typeof(tags) = 'array'", name="ck_flow_tags_array"),
        Index("ix_flow_tenant_site", "tenant_id", "site_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    tier: Mapped[str] = _tier()
    site_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{SCHEMA}.site.id", ondelete="CASCADE", name="fk_flow_site"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Ordered ``[{"page_id": …, "state": …}]``.
    steps: Mapped[list[Any]] = _jsonb_array()
    tags: Mapped[list[Any]] = _jsonb_array()
    review_state: Mapped[str] = _review_state()
    quality: Mapped[str | None] = _quality()
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class Capture(Base):
    """One page at one viewport and interaction state."""

    __tablename__ = "capture"
    __table_args__ = (
        _check_in("tier", TIERS, "ck_capture_tier"),
        _tier_key("screenshot_key", "ck_capture_screenshot_key_tier"),
        _tier_key("structure_key", "ck_capture_structure_key_tier"),
        _tier_key("styles_key", "ck_capture_styles_key_tier"),
        _tier_key("a11y_key", "ck_capture_a11y_key_tier"),
        CheckConstraint("jsonb_typeof(facets) = 'object'", name="ck_capture_facets"),
        CheckConstraint("jsonb_typeof(tokens) = 'object'", name="ck_capture_tokens"),
        Index("ix_capture_tenant_page", "tenant_id", "page_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    tier: Mapped[str] = _tier()
    page_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{SCHEMA}.page.id", ondelete="CASCADE", name="fk_capture_page"),
        nullable=False,
    )
    #: One page capture run (all viewports and states of one visit).
    run_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    viewport: Mapped[str] = mapped_column(Text, nullable=False)
    interaction_state: Mapped[str] = mapped_column(
        Text, nullable=False, default="default", server_default="default"
    )
    screenshot_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    structure_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    styles_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    a11y_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    tokens: Mapped[dict[str, Any]] = _jsonb_object()
    layout_bands: Mapped[list[Any]] = _jsonb_array()
    motion_summary: Mapped[dict[str, Any]] = _jsonb_object()
    #: Measured numeric facets (``MEASURED_FACETS``) the correlation scan reads.
    facets: Mapped[dict[str, Any]] = _jsonb_object()
    element_cap_reached: Mapped[str | None] = mapped_column(Text, nullable=True)
    opt_out_signals: Mapped[list[Any]] = _jsonb_array()
    logged_in: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = _created()


class CaptureSource(Base):
    """The source copies of one viewport context: always ``private/`` blobs."""

    __tablename__ = "capture_source"
    __table_args__ = (
        _check_in("tier", TIERS, "ck_capture_source_tier"),
        CheckConstraint(
            "jsonb_typeof(parts) = 'object'", name="ck_capture_source_parts"
        ),
        CheckConstraint(
            "jsonb_typeof(missing) = 'array'", name="ck_capture_source_missing"
        ),
        UniqueConstraint(
            "page_id", "run_id", "viewport", name="uq_capture_source_page_run_viewport"
        ),
        Index("ix_capture_source_tenant_page", "tenant_id", "page_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    tier: Mapped[str] = _tier()
    page_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            f"{SCHEMA}.page.id", ondelete="CASCADE", name="fk_capture_source_page"
        ),
        nullable=False,
    )
    run_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    viewport: Mapped[str] = mapped_column(Text, nullable=False)
    #: ``{part: {"key", "sha256", "size", "content_type", "url"?, "status"?}}``
    #: — ``served_html``, ``rendered_dom``, ``cssom``, ``css-0001``…
    parts: Mapped[dict[str, Any]] = _jsonb_object()
    #: Parts that could not be captured (closed shadow roots, iframes), named.
    missing: Mapped[list[Any]] = _jsonb_array()
    logged_in: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = _created()


class ReplayBundle(Base):
    """One page capture run's HAR zip: always a ``private/`` blob."""

    __tablename__ = "replay_bundle"
    __table_args__ = (
        _check_in("tier", TIERS, "ck_replay_bundle_tier"),
        _private_key("bundle_key", "ck_replay_bundle_key_private"),
        CheckConstraint("bundle_key LIKE '%.zip'", name="ck_replay_bundle_key_zip"),
        CheckConstraint(
            "jsonb_typeof(manifest) = 'object'", name="ck_replay_bundle_manifest"
        ),
        CheckConstraint(
            "replay_miss_count IS NULL OR replay_miss_count >= 0",
            name="ck_replay_bundle_miss_count",
        ),
        UniqueConstraint("page_id", "run_id", name="uq_replay_bundle_page_run"),
        Index("ix_replay_bundle_tenant_page", "tenant_id", "page_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    tier: Mapped[str] = _tier()
    page_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            f"{SCHEMA}.page.id", ondelete="CASCADE", name="fk_replay_bundle_page"
        ),
        nullable=False,
    )
    run_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    bundle_key: Mapped[str] = mapped_column(Text, nullable=False)
    manifest: Mapped[dict[str, Any]] = _jsonb_object()
    truncated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    recorded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    worker_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    replay_miss_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    logged_in: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = _created()


class Component(Base):
    """One region of a page: crop, structure, styles, role."""

    __tablename__ = "component"
    __table_args__ = (
        *_curation_checks("component"),
        _tier_key("crop_key", "ck_component_crop_key_tier"),
        CheckConstraint("jsonb_typeof(bbox) = 'object'", name="ck_component_bbox"),
        CheckConstraint("jsonb_typeof(tokens) = 'object'", name="ck_component_tokens"),
        CheckConstraint("jsonb_typeof(states) = 'array'", name="ck_component_states"),
        CheckConstraint("jsonb_typeof(tags) = 'array'", name="ck_component_tags_array"),
        Index("ix_component_tenant_page", "tenant_id", "page_id"),
        Index("ix_component_tenant_role", "tenant_id", "role"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    tier: Mapped[str] = _tier()
    page_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{SCHEMA}.page.id", ondelete="CASCADE", name="fk_component_page"),
        nullable=False,
    )
    capture_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            f"{SCHEMA}.capture.id", ondelete="CASCADE", name="fk_component_capture"
        ),
        nullable=True,
    )
    role: Mapped[str | None] = mapped_column(Text, nullable=True)
    bbox: Mapped[dict[str, Any]] = _jsonb_object()
    structure: Mapped[dict[str, Any]] = _jsonb_object()
    styles: Mapped[dict[str, Any]] = _jsonb_object()
    tokens: Mapped[dict[str, Any]] = _jsonb_object()
    states: Mapped[list[Any]] = _jsonb_array()
    crop_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[Any]] = _jsonb_array()
    review_state: Mapped[str] = _review_state()
    quality: Mapped[str | None] = _quality()
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class AssetFingerprint(Base):
    """A fingerprint of one asset seen in a capture — used only by the asset
    guard (Phase 5)."""

    __tablename__ = "asset_fingerprint"
    __table_args__ = (
        _check_in("tier", TIERS, "ck_asset_fingerprint_tier"),
        _check_in("asset_class", ASSET_CLASSES, "ck_asset_fingerprint_class"),
        CheckConstraint(
            "jsonb_typeof(shingles) = 'array'", name="ck_asset_fingerprint_shingles"
        ),
        Index("ix_asset_fingerprint_tenant_capture", "tenant_id", "capture_id"),
        Index("ix_asset_fingerprint_phash", "tenant_id", "phash"),
        Index("ix_asset_fingerprint_content_hash", "tenant_id", "content_hash"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    tier: Mapped[str] = _tier()
    capture_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            f"{SCHEMA}.capture.id",
            ondelete="CASCADE",
            name="fk_asset_fingerprint_capture",
        ),
        nullable=False,
    )
    asset_class: Mapped[str] = mapped_column(String(16), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    phash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dhash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    canonical_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    shingles: Mapped[list[Any]] = _jsonb_array()
    created_at: Mapped[datetime] = _created()


#: The stored tsvector of a description (the memory-records pattern).
DESCRIPTION_TSV_SQL: Final = "to_tsvector('english'::regconfig, body)"


class Description(Base):
    """A description of a site, page, flow or component: text, controlled
    facets, a client-computed embedding and a stored tsvector."""

    __tablename__ = "description"
    __table_args__ = (
        *_curation_checks("description"),
        _check_in("level", DESCRIPTION_LEVELS, "ck_description_level"),
        CheckConstraint(
            "jsonb_typeof(facets) = 'object'", name="ck_description_facets"
        ),
        CheckConstraint(
            "jsonb_typeof(evidence) = 'array'", name="ck_description_evidence"
        ),
        CheckConstraint(
            "(embedding IS NULL) = (embedding_model IS NULL)",
            name="ck_description_embedding_model",
        ),
        Index("ix_description_tenant_target", "tenant_id", "level", "target_id"),
        Index("ix_description_body_tsv", "body_tsv", postgresql_using="gin"),
        Index("ix_description_facets", "facets", postgresql_using="gin"),
        Index(
            "ix_description_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    tier: Mapped[str] = _tier()
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    #: The site, page, flow or component described (polymorphic, no FK).
    target_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    facets: Mapped[dict[str, Any]] = _jsonb_object()
    embedding: Mapped[Any | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_tsv: Mapped[Any] = mapped_column(
        TSVECTOR, Computed(DESCRIPTION_TSV_SQL, persisted=True)
    )
    generator: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Which capture fields each claim was derived from.
    evidence: Mapped[list[Any]] = _jsonb_array()
    review_state: Mapped[str] = _review_state()
    quality: Mapped[str | None] = _quality()
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


# ═════════════════════════════ judgements ═════════════════════════════


class PerceptionRating(Base):
    """One rater's 1–10 score of one target on one dimension. Append-only: a
    re-rating is a new row, the rater's latest row is their current view."""

    __tablename__ = "perception_rating"
    __table_args__ = (
        _check_in(
            "target_kind", JUDGEMENT_TARGET_KINDS, "ck_perception_rating_target_kind"
        ),
        _check_in("rater_kind", RATER_KINDS, "ck_perception_rating_rater_kind"),
        _check_in_nullable(
            "confidence", CONFIDENCES, "ck_perception_rating_confidence"
        ),
        CheckConstraint("score BETWEEN 1 AND 10", name="ck_perception_rating_score"),
        CheckConstraint(
            "jsonb_typeof(positive_evidence) = 'array' "
            "AND jsonb_typeof(negative_evidence) = 'array'",
            name="ck_perception_rating_evidence_arrays",
        ),
        # An AI rating always carries at least one evidence pointer.
        CheckConstraint(
            "rater_kind <> 'ai' OR jsonb_array_length(positive_evidence) "
            "+ jsonb_array_length(negative_evidence) > 0",
            name="ck_perception_rating_ai_evidence",
        ),
        CheckConstraint(
            "answer_ms IS NULL OR (answer_ms >= 0 AND rater_kind = 'operator')",
            name="ck_perception_rating_answer_ms",
        ),
        Index(
            "ix_perception_rating_target",
            "tenant_id",
            "target_kind",
            "target_id",
            "dimension_key",
            "created_at",
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    target_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    target_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    dimension_key: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(
            f"{SCHEMA}.perception_dimension.key",
            ondelete="RESTRICT",
            name="fk_perception_rating_dimension",
        ),
        nullable=False,
    )
    dimension_version: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    rater_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    rater_id: Mapped[str] = mapped_column(Text, nullable=False)
    context_page_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    context_viewport: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[str | None] = mapped_column(String(16), nullable=True)
    positive_evidence: Mapped[list[Any]] = _jsonb_array()
    negative_evidence: Mapped[list[Any]] = _jsonb_array()
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    answer_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = _created()


class Comparison(Base):
    """One pairwise answer on one dimension — the primary judging mode. The
    resolved verdict is computed at read time from the raw rows."""

    __tablename__ = "comparison"
    __table_args__ = (
        _check_in("target_kind", JUDGEMENT_TARGET_KINDS, "ck_comparison_target_kind"),
        _check_in("winner", WINNERS, "ck_comparison_winner"),
        _check_in("rater_kind", RATER_KINDS, "ck_comparison_rater_kind"),
        _check_in_nullable("shown_order", SHOWN_ORDERS, "ck_comparison_shown_order"),
        CheckConstraint("a_id <> b_id", name="ck_comparison_distinct"),
        CheckConstraint(
            "answer_ms IS NULL OR (answer_ms >= 0 AND rater_kind = 'operator')",
            name="ck_comparison_answer_ms",
        ),
        Index("ix_comparison_a", "tenant_id", "target_kind", "a_id"),
        Index("ix_comparison_b", "tenant_id", "target_kind", "b_id"),
        Index("ix_comparison_trial", "tenant_id", "trial_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    target_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    a_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    b_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    dimension_key: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(
            f"{SCHEMA}.perception_dimension.key",
            ondelete="RESTRICT",
            name="fk_comparison_dimension",
        ),
        nullable=False,
    )
    dimension_version: Mapped[int] = mapped_column(Integer, nullable=False)
    winner: Mapped[str] = mapped_column(String(8), nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    rater_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    rater_id: Mapped[str] = mapped_column(Text, nullable=False)
    shown_order: Mapped[str | None] = mapped_column(String(16), nullable=True)
    context_viewport: Mapped[str | None] = mapped_column(Text, nullable=True)
    trial_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    answer_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = _created()


class SitePersonality(Base):
    """One rater's value (0–100) for one trait of one site. Append-only: the
    describer proposes, the operator confirms by appending a confirmed row."""

    __tablename__ = "site_personality"
    __table_args__ = (
        _check_in("rater_kind", RATER_KINDS, "ck_site_personality_rater_kind"),
        _check_in("state", PERSONALITY_STATES, "ck_site_personality_state"),
        CheckConstraint("value BETWEEN 0 AND 100", name="ck_site_personality_value"),
        # Only an operator confirms.
        CheckConstraint(
            "state <> 'confirmed' OR rater_kind = 'operator'",
            name="ck_site_personality_confirmed_by_operator",
        ),
        CheckConstraint(
            "jsonb_typeof(evidence) = 'array'", name="ck_site_personality_evidence"
        ),
        Index(
            "ix_site_personality_site_trait",
            "tenant_id",
            "site_id",
            "trait_key",
            "created_at",
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    site_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            f"{SCHEMA}.site.id", ondelete="CASCADE", name="fk_site_personality_site"
        ),
        nullable=False,
    )
    trait_key: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(
            f"{SCHEMA}.personality_trait.key",
            ondelete="RESTRICT",
            name="fk_site_personality_trait",
        ),
        nullable=False,
    )
    value: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    rater_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    rater_id: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    evidence: Mapped[list[Any]] = _jsonb_array()
    created_at: Mapped[datetime] = _created()


class DesignPrinciple(Base):
    """A proposed, approved or retired design principle."""

    __tablename__ = "design_principle"
    __table_args__ = (
        _check_in("status", PRINCIPLE_STATUSES, "ck_design_principle_status"),
        _check_in(
            "proposed_by_kind", RATER_KINDS, "ck_design_principle_proposed_by_kind"
        ),
        CheckConstraint(
            "jsonb_typeof(scope) = 'object'", name="ck_design_principle_scope"
        ),
        CheckConstraint(
            "status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)",
            name="ck_design_principle_approved_whole",
        ),
        CheckConstraint(
            "status <> 'retired' OR retired_reason IS NOT NULL",
            name="ck_design_principle_retired_reason",
        ),
        Index("ix_design_principle_tenant_status", "tenant_id", "status"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    #: ``{"industries": [], "page_types": [], "price_tiers": [], "dimensions": []}``
    scope: Mapped[dict[str, Any]] = _jsonb_object()
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="proposed", server_default="proposed"
    )
    proposed_by_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    proposed_by_id: Mapped[str] = mapped_column(Text, nullable=False)
    approved_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    retired_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class DesignPrincipleEvidence(Base):
    """One rating or comparison cited for (or against) a principle."""

    __tablename__ = "design_principle_evidence"
    __table_args__ = (
        PrimaryKeyConstraint(
            "principle_id",
            "evidence_kind",
            "evidence_id",
            "role",
            name="pk_design_principle_evidence",
        ),
        _check_in("role", EVIDENCE_ROLES, "ck_design_principle_evidence_role"),
        _check_in("evidence_kind", EVIDENCE_KINDS, "ck_design_principle_evidence_kind"),
        CheckConstraint(
            "cardinality(site_ids) >= 1", name="ck_design_principle_evidence_sites"
        ),
        Index(
            "ix_design_principle_evidence_target",
            "tenant_id",
            "evidence_kind",
            "evidence_id",
        ),
        {"schema": SCHEMA},
    )

    principle_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            f"{SCHEMA}.design_principle.id",
            ondelete="CASCADE",
            name="fk_design_principle_evidence_principle",
        ),
        nullable=False,
    )
    evidence_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    evidence_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    tenant_id: Mapped[UUID] = _tenant()
    #: Derived server-side from the evidence's targets (both sites of a
    #: comparison).
    site_ids: Mapped[list[UUID]] = mapped_column(
        ARRAY(PGUUID(as_uuid=True)), nullable=False
    )
    created_at: Mapped[datetime] = _created()


class JudgeBenchRun(Base):
    """One AI-judge benchmark run against operator judgements on holdout
    sites. Agreement is UNKNOWN (``verdict='unknown'``) under 30 pairs."""

    __tablename__ = "judge_bench_run"
    __table_args__ = (
        _check_in("verdict", BENCH_VERDICTS, "ck_judge_bench_run_verdict"),
        CheckConstraint("n_pairs >= 0", name="ck_judge_bench_run_n_pairs"),
        CheckConstraint(
            "verdict = 'unknown' OR pair_agreement IS NOT NULL",
            name="ck_judge_bench_run_measured",
        ),
        CheckConstraint(
            "pair_agreement IS NULL OR pair_agreement BETWEEN 0 AND 1",
            name="ck_judge_bench_run_agreement",
        ),
        CheckConstraint(
            "unknown_rate IS NULL OR unknown_rate BETWEEN 0 AND 1",
            name="ck_judge_bench_run_unknown_rate",
        ),
        CheckConstraint(
            "jsonb_typeof(rating_spearman) = 'object'",
            name="ck_judge_bench_run_spearman",
        ),
        Index("ix_judge_bench_run_tenant", "tenant_id", "created_at"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    model: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_version: Mapped[str] = mapped_column(Text, nullable=False)
    n_pairs: Mapped[int] = mapped_column(Integer, nullable=False)
    verdict: Mapped[str] = mapped_column(String(16), nullable=False)
    pair_agreement: Mapped[float | None] = mapped_column(Float, nullable=True)
    pair_agreement_ci_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    pair_agreement_ci_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    unknown_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: Per-dimension rating Spearman rho: ``{dimension_key: rho}``.
    rating_spearman: Mapped[dict[str, Any]] = _jsonb_object()
    krippendorff_alpha: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = _created()


# ═════════════════════════ curation ═════════════════════════


class Correction(Base):
    """One edit to a curated field: append-only (Phase 1b store)."""

    __tablename__ = "correction"
    __table_args__ = (
        _check_in("target_kind", CORRECTION_TARGET_KINDS, "ck_correction_target_kind"),
        _check_in("actor_kind", RATER_KINDS, "ck_correction_actor_kind"),
        Index("ix_correction_target", "tenant_id", "target_kind", "target_id"),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    target_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    target_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    field: Mapped[str] = mapped_column(Text, nullable=False)
    from_value: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    to_value: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _created()


class DoNotCapture(Base):
    """A domain (or domain + path prefix) the worker must not capture."""

    __tablename__ = "do_not_capture"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "domain", "path_prefix", name="uq_do_not_capture_entry"
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[UUID] = _uuid_pk()
    tenant_id: Mapped[UUID] = _tenant()
    domain: Mapped[str] = mapped_column(Text, nullable=False)
    path_prefix: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = _created()


#: Every ``design_refs`` table, for the schema-walk and parity tests.
DESIGN_REFS_MODELS: Final = (
    StyleFamily,
    PerceptionDimension,
    PersonalityTrait,
    Blob,
    Site,
    CaptureJob,
    Page,
    Flow,
    Capture,
    CaptureSource,
    ReplayBundle,
    Component,
    AssetFingerprint,
    Description,
    PerceptionRating,
    Comparison,
    SitePersonality,
    DesignPrinciple,
    DesignPrincipleEvidence,
    JudgeBenchRun,
    Correction,
    DoNotCapture,
)
