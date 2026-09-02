"""
Agent text-unit models — the fleet's ``.claude/`` corpus as one
kind-discriminated store, with an append-only version history.

A **text unit** is a named bundle of text files the runner provisions into a
spawned session. Two kinds ship today and the discriminator is deliberately
open-ended (`kind` is a widenable string, never a two-value enum — agent
definitions under ``.claude/agents/`` are a third unit with the identical
delivery gap):

===========  ==========================================  ======================
``kind``     provisioning target                         entrypoint file
===========  ==========================================  ======================
``command``  ``.claude/commands/<name>.md``              ``<name>.md``
``skill``    ``.claude/skills/<name>/``                  ``SKILL.md``
===========  ==========================================  ======================

A command is the **degenerate single-entry case** of a skill: one file in the
map. That is why there is one table rather than two — the version machinery, the
override semantics and the editor are identical, and only the provisioning
target differs.

Two layers, one table
---------------------

``organization_id IS NULL`` is the **fleet default**; a non-NULL
``organization_id`` is that **account's override**. The runner's resolution
order is therefore::

    account override  →  fleet default  →  embedded default (runner binary)

There is still no row for the *embedded* default, so deleting an account
override simply lets the fleet default — or, absent that, the binary's copy —
apply again.

Postgres does not collide two NULLs in a plain ``UNIQUE``, so a three-column
``UNIQUE (organization_id, kind, name)`` would leave the fleet-default layer
**completely unconstrained** — N rows with ``organization_id IS NULL`` sharing
one ``(kind, name)`` would all be legal, and "the fleet default" would not be a
well-defined row. The key is therefore a **partial unique index pair**, one per
layer; see ``__table_args__``.

Version chain
-------------

``AgentTextUnitVersion`` is append-only: every write appends a row, the parent's
``current_version`` is the head, and a revert writes a NEW version whose
``files`` map equals an older one. History rows are never mutated or deleted.

Import provenance
-----------------

``source_path`` / ``source_commit`` record the config repo a unit's text was
imported FROM. They sit on the unit, not the version chain, because they
describe the *current* text; a version is a historical snapshot and inventing a
provenance for one would be a claim nobody checked. Do not confuse either with
the response's ``source`` field, which names the resolution LAYER — see the
column comments.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# The two kinds this plan ships. `kind` is a plain string column on purpose —
# see the module docstring — so this tuple is the *known* set, not the legal
# set, and nothing may branch on "it must be one of these two".
KIND_COMMAND = "command"
KIND_SKILL = "skill"

#: Per-kind entrypoint filename, where the kind has a fixed one. A kind that is
#: absent here uses ``<name>.md`` (the ``.claude/commands/`` and
#: ``.claude/agents/`` convention: the unit IS one file named for the unit).
KIND_ENTRYPOINTS: dict[str, str] = {
    KIND_SKILL: "SKILL.md",
}


def entrypoint_path(kind: str, name: str) -> str:
    """The relative path inside ``files`` that holds the unit's primary text."""
    return KIND_ENTRYPOINTS.get(kind, f"{name}.md")


class AgentTextUnit(Base):
    """One text unit: a fleet default or an account's override of one."""

    __tablename__ = "agent_text_units"
    __table_args__ = (
        # THE PARTIAL UNIQUE INDEX PAIR. A plain three-column UNIQUE does not
        # constrain the NULL-org rows at all (Postgres treats every NULL as
        # distinct), which would make the fleet-default layer a bag rather than
        # a layer. Two partial indexes, one per layer, is what actually says
        # "at most one fleet default per (kind, name)" AND "at most one
        # override per (organization_id, kind, name)".
        Index(
            "uq_agent_text_unit_org_kind_name",
            "organization_id",
            "kind",
            "name",
            unique=True,
            postgresql_where=text("organization_id IS NOT NULL"),
        ),
        Index(
            "uq_agent_text_unit_fleet_kind_name",
            "kind",
            "name",
            unique=True,
            postgresql_where=text("organization_id IS NULL"),
        ),
        Index(
            "ix_project_agent_text_units_kind",
            "kind",
        ),
        # An underscore-prefixed unit is a COPY-SOURCE SPEC, never an invocable
        # slash command — `.claude/commands/` has no include mechanism, so
        # `_gate-registration.md` and `_loop-control.md` exist to be pasted from
        # by other units, and the harness must not offer them as `/_...`. The
        # corpus expresses that with a leading underscore; `is_invocable` is the
        # machine-readable form, and this CHECK is what stops the two from ever
        # disagreeing. Carried, provisioned to the same directory (so a unit
        # that cites the spec by path still resolves it), never invocable.
        CheckConstraint(
            "left(name, 1) <> '_' OR is_invocable = false",
            name="ck_agent_text_unit_underscore_not_invocable",
        ),
        # `source_commit` is a commit or it is nothing. Without this the column
        # accepts an abbreviated SHA, a branch name or a "dirty" sentinel, and
        # every consumer then has to re-validate what the column claims to be.
        CheckConstraint(
            "source_commit IS NULL OR source_commit ~ '^[0-9a-f]{40}$'",
            name="ck_agent_text_unit_source_commit_sha",
        ),
        {"schema": "project"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # NULL = the fleet default layer. Non-NULL = that account's override.
    organization_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        index=True,
    )

    # Widenable discriminator, NOT an enum — "command", "skill", and whatever
    # the next provisioning target is called.
    kind: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        server_default=text("'command'"),
        default=KIND_COMMAND,
    )

    # The unit slug provisioned into a session cwd, e.g. "vet-plan" or
    # "coord-revive". Becomes a path component, so it is a write-boundary value.
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    # Relative path -> text. A command carries one entry; a skill carries
    # SKILL.md plus siblings. Path validity and size bounds are enforced at the
    # service boundary (`validate_files`), because a corpus store that accepts a
    # traversal path is itself the defect — the runner validating again is a
    # second line, not the first.
    files: Mapped[dict[str, str]] = mapped_column(
        JSONB,
        nullable=False,
    )

    # Canonical digest over the whole `files` map — see
    # `agent_text_unit_service.compute_files_checksum`. This is NOT the
    # single-body `compute_body_checksum` digest the legacy /agent-commands
    # wire still carries.
    checksum: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        default=None,
    )

    is_shared: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
        default=False,
    )

    # False = carried by the corpus but never offered to the harness as an
    # invocable unit. See the CHECK constraint above.
    is_invocable: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
        default=True,
    )

    # --- import provenance ------------------------------------------------
    #
    # WHERE THE TEXT CAME FROM, which is a different question from which LAYER
    # served it. The layer is `organization_id` (and the derived `source` field
    # on the response); these two are the config repo an importer read. The
    # names are adjacent on purpose — `source_path` is already this backend's
    # word for exactly this (`agent.work_artifacts.source_path`) — and the
    # canonical Rust type carries the same warning.
    #
    # NULL in either column is MEANINGFUL, not missing-by-accident: it says the
    # text is not a faithful copy of a committed source. A unit authored in the
    # console never had one; an import from a dirty tree deliberately records
    # none, because no commit honestly describes the bytes that were read.

    #: Repo-relative path in the config repo — `.claude/commands/<name>.md` for
    #: a command, `.claude/skills/<name>/` (a directory) for a skill. Relative
    #: on purpose: an absolute path would pin a build machine's layout into
    #: account data.
    source_path: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        default=None,
    )

    #: Full 40-char lowercase commit of the source repo, or NULL. The CHECK
    #: above is what keeps it a commit rather than a branch name or a sentinel.
    source_commit: Mapped[str | None] = mapped_column(
        String(40),
        nullable=True,
        default=None,
    )

    # Head pointer into the version chain.
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

    versions = relationship(
        "AgentTextUnitVersion",
        back_populates="agent_text_unit",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"<AgentTextUnit(id={self.id}, kind={self.kind!r}, name={self.name!r}, "
            f"organization_id={self.organization_id}, "
            f"current_version={self.current_version})>"
        )


class AgentTextUnitVersion(Base):
    """Immutable snapshot of a unit's ``files`` map at one version."""

    __tablename__ = "agent_text_unit_versions"
    __table_args__ = (
        # Load bearing: without it "monotonic" is enforced only by application
        # code, and two concurrent appends both read the same latest version
        # number and write duplicates.
        UniqueConstraint(
            "agent_text_unit_id", "version_number", name="uq_agent_text_unit_version"
        ),
        {"schema": "project"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    agent_text_unit_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("project.agent_text_units.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    version_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    files: Mapped[dict[str, str]] = mapped_column(
        JSONB,
        nullable=False,
    )

    checksum: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
        default=None,
    )

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        index=True,
    )

    change_description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # Which version a revert copied its files from. NULL for an ordinary edit.
    restored_from: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    agent_text_unit = relationship("AgentTextUnit", back_populates="versions")

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"<AgentTextUnitVersion(id={self.id}, "
            f"agent_text_unit_id={self.agent_text_unit_id}, "
            f"version_number={self.version_number})>"
        )
