"""Plan & Prompt Library models — the ``agent.work_artifacts`` store.

Phase 1 of ``2026-08-10-plan-and-prompt-library-in-web``. Mirrors alembic
revision ``plan_library_01_work_artifacts``; read that migration's docstring
for the design rationale (functional unique identity, opaque ``status``, the
FK-less soft link to coord's work units).

These are the FIRST ORM models bound to the web-owned ``agent`` schema — the
schema itself has existed since ``consolidation_phase1_01_infrastructure``
but only ever held migration-managed tables with no SQLAlchemy counterpart.
``tests/conftest.py``'s ``test_engine`` derives the set of schemas to create
from ``Base.metadata``, so the binding below is what makes ``agent`` appear
in a freshly-built test database; ``tests/test_plan_library_api.py`` asserts
the tables really land there rather than trusting that it works.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

#: The sentinel a NULL ``organization_id`` collapses onto in the functional
#: unique index. Kept here (not just in the migration) because the upsert has
#: to key on the exact same expression the index enforces.
NIL_ORGANIZATION_ID = UUID("00000000-0000-0000-0000-000000000000")

#: The six artifact families the library tracks. Enforced in Postgres by
#: ``ck_work_artifacts_kind``; mirrored here so the API can 422 a bad kind
#: instead of letting it become an IntegrityError 500.
WORK_ARTIFACT_KINDS: tuple[str, ...] = (
    "investigation_prompt",
    "plan_authoring_prompt",
    "implementation_prompt",
    "investigation_report",
    "handoff",
    "plan",
)

#: How the row got here. Enforced by ``ck_work_artifacts_captured_by``.
WORK_ARTIFACT_CAPTURE_SOURCES: tuple[str, ...] = (
    "runner_scan",
    "agent",
    "operator",
)

#: Provenance relations. Enforced by ``ck_work_artifact_edges_relation``.
WORK_ARTIFACT_RELATIONS: tuple[str, ...] = (
    "produced_report",
    "feeds",
    "authored_plan",
    "supersedes",
    "depends_on",
)

#: The indexed full-text expression, spelled once. The API's ``?q=`` filter
#: reuses this string verbatim so the predicate matches the index expression
#: exactly and the GIN index is actually usable.
SEARCH_TSVECTOR_SQL = (
    "to_tsvector('english', "
    "coalesce(work_artifacts.title, '') || ' ' || "
    "coalesce(work_artifacts.body, ''))"
)

_IDENTITY_ORG_EXPR = f"coalesce(organization_id, '{NIL_ORGANIZATION_ID}'::uuid)"


class WorkArtifact(Base):
    """A plan, prompt, report or handoff — the mutable head row.

    ``body`` / ``content_sha256`` / ``current_version`` always describe the
    latest revision; every superseded revision survives in
    :class:`WorkArtifactVersion`.
    """

    __tablename__ = "work_artifacts"
    __table_args__ = (
        # Identity. Functional, NULL-collapsing — a plain UNIQUE over the raw
        # nullable columns would not bind (NULL <> NULL in PostgreSQL).
        Index(
            "uq_work_artifacts_identity",
            text(_IDENTITY_ORG_EXPR),
            text("kind"),
            text("slug"),
            text("coalesce(source_repo, '')"),
            unique=True,
        ),
        Index("ix_work_artifacts_kind_status", "kind", "status"),
        Index("ix_work_artifacts_work_unit_slug", "work_unit_slug"),
        Index("ix_work_artifacts_kind_slug", "kind", "slug"),
        Index("ix_work_artifacts_repos", "repos", postgresql_using="gin"),
        Index(
            "ix_work_artifacts_search",
            text(
                "to_tsvector('english', "
                "coalesce(title, '') || ' ' || coalesce(body, ''))"
            ),
            postgresql_using="gin",
        ),
        {"schema": "agent"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # No FK: rows arrive from runner scans of on-disk markdown whose org is
    # resolved from the scanning principal, not from a guaranteed row. Never
    # accepted from a request body — always derived server-side.
    organization_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )

    kind: Mapped[str] = mapped_column(Text, nullable=False)

    slug: Mapped[str] = mapped_column(Text, nullable=False)

    title: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )

    # OPAQUE free-form text — no CHECK, no Literal, no vocabulary. Plan
    # front-matter statuses are authored by humans and agents ("VETTED",
    # "IN PROGRESS", "SHIPPED", "draft", ...) and the library mirrors what
    # was written rather than policing it. Never validated, never a 422.
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )

    body: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )

    # Named ``content_sha256`` — NOT ``checksum`` (project.skills) and NOT
    # ``content_hash`` (project.prompt_template_versions). The repo has both
    # spellings and neither says which digest it holds; this store names the
    # algorithm in the column so a reader never has to guess, and the plan
    # standardises every new table on this spelling.
    content_sha256: Mapped[str] = mapped_column(Text, nullable=False)

    source_path: Mapped[str | None] = mapped_column(Text, nullable=True)

    source_repo: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Soft link to a coord work-unit slug. Deliberately FK-less: agent.* is
    # web-owned and coord's tables are coord's, so a cross-schema FK would
    # re-couple what the schema-boundary decoupling separated. It MAY DANGLE
    # — readers treat it as nullable metadata and never 404 on it.
    work_unit_slug: Mapped[str | None] = mapped_column(Text, nullable=True)

    repos: Mapped[list[str]] = mapped_column(
        ARRAY(Text),
        nullable=False,
        server_default=text("'{}'"),
        default=list,
    )

    authored_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    captured_by: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'agent'"),
        default="agent",
    )

    current_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
        default=1,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(UTC),
    )

    versions: Mapped[list["WorkArtifactVersion"]] = relationship(
        "WorkArtifactVersion",
        back_populates="artifact",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="WorkArtifactVersion.version_number",
    )


class WorkArtifactVersion(Base):
    """An immutable snapshot of one revision of a :class:`WorkArtifact`."""

    __tablename__ = "work_artifact_versions"
    __table_args__ = (
        Index(
            "uq_work_artifact_versions_doc_version",
            "document_id",
            "version_number",
            unique=True,
        ),
        {"schema": "agent"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    document_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent.work_artifacts.id", ondelete="CASCADE"),
        nullable=False,
    )

    version_number: Mapped[int] = mapped_column(Integer, nullable=False)

    body: Mapped[str] = mapped_column(Text, nullable=False)

    content_sha256: Mapped[str] = mapped_column(Text, nullable=False)

    change_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    artifact: Mapped["WorkArtifact"] = relationship(
        "WorkArtifact", back_populates="versions"
    )


class WorkArtifactEdge(Base):
    """A directed provenance relation between two work artifacts."""

    __tablename__ = "work_artifact_edges"
    __table_args__ = (
        Index(
            "uq_work_artifact_edges_from_to_relation",
            "from_id",
            "to_id",
            "relation",
            unique=True,
        ),
        Index("ix_work_artifact_edges_from_id", "from_id"),
        Index("ix_work_artifact_edges_to_id", "to_id"),
        {"schema": "agent"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    from_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent.work_artifacts.id", ondelete="CASCADE"),
        nullable=False,
    )

    to_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent.work_artifacts.id", ondelete="CASCADE"),
        nullable=False,
    )

    relation: Mapped[str] = mapped_column(Text, nullable=False)

    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )
