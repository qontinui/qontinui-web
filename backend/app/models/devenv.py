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
        Index("idx_devenv_machine_coord_device", "coord_device_id"),
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
    # falls back to the single-environment auto-bind).
    #
    # NOT mapped as a ForeignKey in the ORM metadata (though devenv_02 DID add a
    # DB-level FK with ON DELETE SET NULL, which is kept for prod integrity):
    # environments.canonical_machine_id already references machines, so declaring
    # the back-reference in metadata closes a machines<->environments cycle that
    # `Base.metadata.sorted_tables` (the test harness's table ordering) cannot
    # sort, breaking every devenv unit test. The DB FK still enforces integrity
    # + nulls the binding on environment delete; the ORM just treats it as a
    # plain column.
    environment_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    # P3 bridge to coord's device registry (``coord.devices.device_id``).
    # Deliberately NOT a FK (cross-surface soft pointer; coord devices may be
    # reaped/re-enrolled without devenv knowing — see devenv_03 migration).
    # Populated at agent enroll (the agent asserts its coord device id) or by
    # the unambiguous-hostname backfill.
    coord_device_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
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


class MachineEnvironmentConfigHistory(Base):
    """Append-only capture timeline for (environment, machine) configs.

    ``machine_environment_configs`` keeps only the LATEST envelope per
    (environment, machine); this table records every *distinct* capture so an
    operator can see how a machine's config drifted over time and diff two
    points. Written alongside the latest-snapshot upsert in the agent
    ``report_config`` path.

    Append semantics — **consecutive dedup by ``content_hash``**: the
    ~15-min runner capture is mostly no-change noise, so a row is appended
    only when the hash differs from the most recent history row for the pair.
    ``content_hash`` is the sha256 hex of the canonical-JSON envelope (sorted
    keys, compact separators, ``captured_at`` excluded — a re-capture of
    identical content must dedup even though its timestamp moved).

    FK rationale — history dies with its machine (``ON DELETE CASCADE`` on
    ``machine_id``), unlike the canonical change log's soft machine refs: the
    canonical log records *decisions* that must outlive the machine; this
    records a machine's private *self-observations*, which have no audit
    value after the machine is gone. The FKs mirror
    :class:`MachineEnvironmentConfig` exactly, so no new ORM sort cycle is
    introduced (see the ``environment_id`` note on :class:`Machine`).

    Secret stance: stores the same post-backstop envelope as the latest
    snapshot — secret values never enter either table.
    """

    __tablename__ = "machine_environment_config_history"
    __table_args__ = (
        Index(
            "idx_devenv_config_history_env_machine_captured",
            "environment_id",
            "machine_id",
            text("captured_at DESC"),
        ),
        {"schema": _SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
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
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    def __repr__(self) -> str:
        """Return repr."""
        return (
            f"<MachineEnvironmentConfigHistory(env={self.environment_id}, "
            f"machine={self.machine_id}, captured_at={self.captured_at})>"
        )


class DeviceMachineCredential(Base):
    """A device-bound machine key (``devenv.device_machine_credentials``).

    A long-lived, hash-at-rest bearer credential (``dmk_<token>``) a paired
    runner can exchange for a device JWT with NO user session — the >30-day
    cold-start recovery path (4b). Mirrors the ``devenv.machines`` ``mk_``
    idiom: only the sha256 ``dmk_hash`` + a short ``dmk_prefix`` are stored;
    the plaintext is returned to the runner exactly ONCE at mint time.

    ``device_id`` is a **soft, cross-schema reference** to
    ``coord.devices.device_id`` — deliberately NOT a FK (coord devices may
    be reaped/re-enrolled without devenv knowing; also avoids a cross-schema
    FK that ``coord-db-tests`` would reject). Device existence is validated
    in application code. UNIQUE on ``device_id`` => one active dmk_ per
    device; re-mint UPSERTs the row.
    """

    __tablename__ = "device_machine_credentials"
    __table_args__ = (
        UniqueConstraint("device_id", name="uq_devenv_dmk_device_id"),
        Index("idx_devenv_dmk_hash", "dmk_hash"),
        Index("idx_devenv_dmk_owner_device", "owner_user_id", "device_id"),
        {"schema": _SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    # Soft pointer to coord.devices.device_id (NOT a FK — see class docstring).
    device_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=True,
    )
    dmk_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    dmk_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def __repr__(self) -> str:
        """Return repr; never includes key material."""
        return (
            f"<DeviceMachineCredential(id={self.id}, "
            f"device_id={self.device_id}, "
            f"revoked={self.revoked_at is not None})>"
        )


class CanonicalChangeLog(Base):
    """Append-only audit of canonical-machine designations.

    Written inside ``PUT /environments/{id}/canonical`` so every change to
    which machine is the source of truth is attributable: who changed it,
    when, and from which machine to which. This is the "records of who
    changed it and when" the team-sync (pull-model) design requires.

    ``from_machine_id`` / ``to_machine_id`` are **soft references, NOT FKs**:
    the audit record must survive later deletion of a machine (an FK would
    ``SET NULL`` away which machine a past change pointed at). ``tenant_id``
    is a best-effort, nullable, soft reference to the coord tenant the change
    was made under (tenants are a coord/identity concept, not a web table) —
    forward-compat for tenant-scoped devenv (plan P3).
    """

    __tablename__ = "canonical_change_log"
    __table_args__ = (
        Index(
            "idx_devenv_canonical_log_env_changed_at",
            "environment_id",
            text("changed_at DESC"),
        ),
        {"schema": _SCHEMA},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    environment_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("devenv.environments.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Soft references (NOT FKs) — see class docstring.
    from_machine_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    to_machine_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    changed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    def __repr__(self) -> str:
        """Return repr."""
        return (
            f"<CanonicalChangeLog(env={self.environment_id}, to={self.to_machine_id})>"
        )
