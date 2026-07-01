"""SQLAlchemy models for the ``devenv`` digital-twin feature.

The ``devenv`` schema lets a user register their own Applications and dev
Machines, define named Environments, have each machine auto-report its
configuration, designate ONE machine per environment as the **canonical**
source of truth, and compute **drift** of every other machine vs canonical.

Security stance — **NEVER store secret VALUES.** Only names/topology are
persisted. The ``machine_environment_configs.config`` JSONB envelope holds
named sections, each a flat ``key -> value`` map; the schema/service layers
enforce a secret backstop (the ``env_contract`` section is coerced to
``present``/``absent`` before persist).

Four tables, all user-scoped by ``owner_user_id`` (FK ``auth.users.id``,
``ondelete=CASCADE``):

* ``devenv.applications`` — a registered application.
* ``devenv.machines`` — a dev machine. Holds the enrollment-code mint and
  the hashed machine-key material (NEVER the plaintext key).
* ``devenv.environments`` — a named environment, optionally bound to an
  application, with a single nullable ``canonical_machine_id`` scalar (the
  one-canonical invariant is structural, NOT a per-machine boolean).
* ``devenv.machine_environment_configs`` — one config envelope per
  (environment, machine).
"""

import uuid
from datetime import datetime

from sqlalchemy import (
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
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

_SCHEMA = "devenv"


class Application(Base):
    """A registered application (``devenv.applications``)."""

    __tablename__ = "applications"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "slug", name="uq_devenv_app_owner_slug"),
        Index("idx_devenv_app_owner", "owner_user_id"),
        {"schema": _SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    def __repr__(self) -> str:
        """Return repr."""
        return f"<Application(id={self.id}, slug={self.slug})>"


class Machine(Base):
    """A dev machine (``devenv.machines``).

    Enrollment lifecycle:

    * ``enrollment_code`` + ``enrollment_expires_at`` are minted by the
      owner and shown ONCE; the agent consumes the code via the agent
      ``/enroll`` endpoint.
    * On enroll the agent receives a plaintext machine key (``mk_<token>``)
      ONCE; only the ``key_hash`` (sha256 hex) + ``key_prefix`` are stored.
    * ``revoked_at`` set => the key is rejected on all agent calls.
    """

    __tablename__ = "machines"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_devenv_machine_owner_name"),
        Index("idx_devenv_machine_owner", "owner_user_id"),
        Index("idx_devenv_machine_key_hash", "key_hash"),
        Index("idx_devenv_machine_enrollment_code", "enrollment_code"),
        Index("idx_devenv_machine_environment", "environment_id"),
        {"schema": _SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Phase 2 P1: explicit environment binding. NULL = unbound (enroll then
    # falls back to the single-environment auto-bind). ON DELETE SET NULL so
    # deleting an environment unbinds its machines rather than cascading.
    # ``use_alter``: environments.canonical_machine_id already references
    # machines, so this back-reference closes a machines<->environments cycle.
    # use_alter emits the FK via a separate ALTER (create) / drops it first
    # (drop), so SQLAlchemy metadata create_all/drop_all can order the tables.
    environment_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(
            "devenv.environments.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_devenv_machine_environment",
        ),
        nullable=True,
    )
    enrollment_code: Mapped[str | None] = mapped_column(String(16), nullable=True)
    enrollment_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    key_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    key_prefix: Mapped[str | None] = mapped_column(String(16), nullable=True)
    enrolled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    def __repr__(self) -> str:
        """Return repr; never includes key material."""
        return (
            f"<Machine(id={self.id}, name={self.name}, "
            f"enrolled={self.enrolled_at is not None})>"
        )


class Environment(Base):
    """A named environment (``devenv.environments``).

    The one-canonical invariant is structural: a single nullable scalar
    ``canonical_machine_id`` column, NOT a per-machine boolean. Setting a
    new canonical machine is an atomic single-column update.
    """

    __tablename__ = "environments"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_devenv_env_owner_name"),
        Index("idx_devenv_env_owner", "owner_user_id"),
        Index("idx_devenv_env_application", "application_id"),
        {"schema": _SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("devenv.applications.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    canonical_machine_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("devenv.machines.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    def __repr__(self) -> str:
        """Return repr."""
        return f"<Environment(id={self.id}, name={self.name})>"


class MachineEnvironmentConfig(Base):
    """One config envelope per (environment, machine).

    ``config`` is the general JSON envelope of named sections (each a flat
    ``key -> value`` map). Secret values are NEVER stored — the schema/
    service layers apply the secret backstop before persist.
    """

    __tablename__ = "machine_environment_configs"
    __table_args__ = (
        UniqueConstraint(
            "environment_id", "machine_id", name="uq_devenv_config_env_machine"
        ),
        Index("idx_devenv_config_environment", "environment_id"),
        Index("idx_devenv_config_machine", "machine_id"),
        {"schema": _SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    environment_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("devenv.environments.id", ondelete="CASCADE"),
        nullable=False,
    )
    machine_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("devenv.machines.id", ondelete="CASCADE"),
        nullable=False,
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    def __repr__(self) -> str:
        """Return repr."""
        return (
            f"<MachineEnvironmentConfig(env={self.environment_id}, "
            f"machine={self.machine_id})>"
        )
