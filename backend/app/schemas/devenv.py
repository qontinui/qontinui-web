"""Pydantic request/response schemas for the ``devenv`` digital-twin feature.

Conventions:

* Inherit :class:`BaseSchema` for request bodies, :class:`BaseORMSchema`
  for responses populated from ORM models, and use :data:`IsoDatetime`
  for every datetime field so the frontend Zod validators get the
  ``...Z`` UTC suffix.
* **Secrets are never exposed.** :class:`MachineResponse` exposes only
  ``key_prefix`` + boolean ``enrolled`` / ``revoked`` flags — never the
  key or hash. The one-time plaintext key/enrollment-code appear only in
  the dedicated "...Created" / enroll response shapes.
* :class:`ConfigEnvelope` carries a validator that rejects nested
  non-string section values and applies the ``env_contract`` secret
  backstop (every value coerced to ``"present"``/``"absent"``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime

if TYPE_CHECKING:
    from app.models.devenv import Machine

# Section whose values are a contract presence-map. Secret VALUES must never
# be stored, so every value here is coerced to "present"/"absent".
ENV_CONTRACT_SECTION = "env_contract"

# Severity ranking used by the drift service for the overall rollup.
SeverityT = Literal["info", "warning", "critical"]
DeltaStatusT = Literal["added", "removed", "changed"]

# What a pulling runner may do with a config section (see
# app.services.devenv_section_policy). Defined here because it is part of the
# CanonicalConfigResponse wire contract; the service imports it.
SectionPolicyT = Literal[
    "applyable",  # safe to reconcile automatically toward canonical
    "secret_report_only",  # presence-only; report gaps, never invent values
    "destructive_confirm",  # schema/migration; stop, require a local confirm
    "report_only",  # informational; do not auto-apply
]


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------


class ApplicationCreate(BaseSchema):
    """Create an application."""

    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=200)
    description: str | None = None


class ApplicationUpdate(BaseSchema):
    """Partial update of an application."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class ApplicationResponse(BaseORMSchema):
    """An application."""

    id: UUID
    name: str
    slug: str
    description: str | None = None
    created_at: IsoDatetime
    updated_at: IsoDatetime


# ---------------------------------------------------------------------------
# Machines
# ---------------------------------------------------------------------------


class MachineCreate(BaseSchema):
    """Register a machine. Creation also mints a one-time enrollment code."""

    name: str = Field(min_length=1, max_length=200)
    hostname: str | None = Field(default=None, max_length=255)
    description: str | None = None
    # Phase 2 P1: optionally bind the machine to a chosen environment at
    # creation. When set, enroll binds config to THIS environment (no reliance
    # on the single-environment auto-bind). Must be owned by the caller.
    environment_id: UUID | None = None


class MachineUpdate(BaseSchema):
    """Partial update of a machine's descriptive fields."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    hostname: str | None = Field(default=None, max_length=255)
    description: str | None = None


class SetMachineEnvironmentRequest(BaseSchema):
    """Bind (or unbind) a machine to an environment. ``None`` unbinds."""

    environment_id: UUID | None = None


class MachineResponse(BaseORMSchema):
    """A machine — NEVER exposes key/hash.

    Only ``key_prefix`` + the derived boolean flags are surfaced.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    hostname: str | None = None
    description: str | None = None
    environment_id: UUID | None = None
    # P3 bridge to coord's device registry (soft pointer, not a FK).
    coord_device_id: UUID | None = None
    key_prefix: str | None = None
    enrolled: bool = False
    last_seen_at: IsoDatetime | None = None
    revoked: bool = False
    created_at: IsoDatetime
    updated_at: IsoDatetime

    @classmethod
    def from_model(cls, machine: Machine) -> MachineResponse:
        """Build a response from a ``Machine`` ORM row, deriving flags."""
        return cls(
            id=machine.id,
            name=machine.name,
            hostname=machine.hostname,
            description=machine.description,
            environment_id=machine.environment_id,
            coord_device_id=machine.coord_device_id,
            key_prefix=machine.key_prefix,
            enrolled=machine.enrolled_at is not None,
            last_seen_at=machine.last_seen_at,
            revoked=machine.revoked_at is not None,
            created_at=machine.created_at,
            updated_at=machine.updated_at,
        )


class MachineCreatedResponse(MachineResponse):
    """Returned on create / regenerate-enrollment.

    Includes the one-time ``enrollment_code`` + its expiry. The agent must
    consume the code before it expires; it is NOT retrievable afterwards.
    """

    enrollment_code: str
    enrollment_expires_at: IsoDatetime

    @classmethod
    def from_model(cls, machine: Machine) -> MachineCreatedResponse:
        """Build a created-response, including the one-time enrollment code."""
        assert machine.enrollment_code is not None
        assert machine.enrollment_expires_at is not None
        return cls(
            id=machine.id,
            name=machine.name,
            hostname=machine.hostname,
            description=machine.description,
            environment_id=machine.environment_id,
            coord_device_id=machine.coord_device_id,
            key_prefix=machine.key_prefix,
            enrolled=machine.enrolled_at is not None,
            last_seen_at=machine.last_seen_at,
            revoked=machine.revoked_at is not None,
            created_at=machine.created_at,
            updated_at=machine.updated_at,
            enrollment_code=machine.enrollment_code,
            enrollment_expires_at=machine.enrollment_expires_at,
        )


class DispatchEnrollRequest(MachineCreate):
    """Create a machine + dispatch an enroll directive to a paired runner.

    Extends :class:`MachineCreate` with the coord device to dispatch to. The
    server mints the machine + one-time code, then asks coord to publish an
    enroll directive to that device's runner — no terminal, no copy-paste.
    """

    target_device_id: UUID


class DispatchEnrollResponse(BaseSchema):
    """Result of a dispatched enroll.

    ``machine`` carries the created machine + its one-time code, so the UI can
    fall back to the copy-paste command when the runner is offline / the
    dispatch did not land. ``dispatched`` is True when coord accepted the
    directive.
    """

    machine: MachineCreatedResponse
    dispatched: bool
    detail: str | None = None


# ---------------------------------------------------------------------------
# Environments
# ---------------------------------------------------------------------------


class EnvironmentCreate(BaseSchema):
    """Create an environment, optionally bound to an application."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    application_id: UUID | None = None


class EnvironmentUpdate(BaseSchema):
    """Partial update of an environment."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    application_id: UUID | None = None


class EnvironmentResponse(BaseORMSchema):
    """An environment, including its (single) canonical machine pointer."""

    id: UUID
    name: str
    description: str | None = None
    application_id: UUID | None = None
    canonical_machine_id: UUID | None = None
    created_at: IsoDatetime
    updated_at: IsoDatetime


class SetCanonicalRequest(BaseSchema):
    """Designate a machine as the canonical source of truth for an env."""

    machine_id: UUID


class CanonicalChangeResponse(BaseORMSchema):
    """One audited canonical-designation change (newest-first in a list).

    The "records of who changed it and when" for the team-sync model:
    ``changed_by_user_id`` + ``changed_at`` + the ``from``/``to`` machine.
    ``tenant_id`` is best-effort (the active-tenant context of the change).
    """

    id: UUID
    environment_id: UUID
    from_machine_id: UUID | None = None
    to_machine_id: UUID | None = None
    changed_by_user_id: UUID | None = None
    tenant_id: UUID | None = None
    note: str | None = None
    changed_at: IsoDatetime


# ---------------------------------------------------------------------------
# Agent enrollment + config
# ---------------------------------------------------------------------------


class EnrollRequest(BaseSchema):
    """Agent enroll request — consumes a one-time enrollment code.

    ``machine_id`` is optional and, when supplied, must match the machine
    the enrollment code belongs to (a sanity binding the agent can assert).
    ``hostname`` lets the agent report/refresh its hostname at enroll time.
    ``coord_device_id`` is the agent's device id in coord's registry
    (``coord.devices.device_id``) — persisted as the P3 devenv↔coord
    bridge when supplied.
    """

    enrollment_code: str = Field(min_length=1, max_length=16)
    machine_id: UUID | None = None
    hostname: str | None = Field(default=None, max_length=255)
    coord_device_id: UUID | None = None


class EnrollResponse(BaseSchema):
    """Agent enroll response — plaintext machine key returned ONCE."""

    machine_id: UUID
    machine_key: str
    environment_id: UUID | None = None


class ConfigEnvelope(BaseSchema):
    """General JSON config envelope: named sections of flat string maps.

    Validation invariants:

    * Every section is a flat ``dict[str, str]`` — nested / non-string
      section values are rejected.
    * For the ``env_contract`` section every value is coerced to the
      literal ``"present"``/``"absent"`` BEFORE persist (secret backstop):
      a non-empty value becomes ``"present"``, an empty value ``"absent"``.
      This guarantees secret VALUES never enter the store even if an agent
      misbehaves.
    """

    schema_version: int = 1
    captured_at: IsoDatetime
    sections: dict[str, dict[str, str]] = Field(default_factory=dict)

    @field_validator("sections", mode="before")
    @classmethod
    def _validate_and_backstop_sections(cls, value: object) -> object:
        """Reject nested non-string values; apply env_contract backstop."""
        if not isinstance(value, dict):
            raise ValueError("sections must be a mapping of section -> {key: value}")
        out: dict[str, dict[str, str]] = {}
        for section_name, section in value.items():
            if not isinstance(section_name, str):
                raise ValueError("section names must be strings")
            if not isinstance(section, dict):
                raise ValueError(
                    f"section '{section_name}' must be a flat key->value map"
                )
            coerced: dict[str, str] = {}
            for key, val in section.items():
                if not isinstance(key, str):
                    raise ValueError(
                        f"keys in section '{section_name}' must be strings"
                    )
                # Reject nested / non-scalar section values.
                if isinstance(val, dict | list):
                    raise ValueError(
                        f"value for '{section_name}.{key}' must be a scalar, "
                        "not a nested object/array"
                    )
                if val is None:
                    str_val = ""
                elif isinstance(val, bool):
                    str_val = "true" if val else "false"
                elif isinstance(val, str | int | float):
                    str_val = str(val)
                else:
                    raise ValueError(
                        f"value for '{section_name}.{key}' must be a string"
                    )
                # Secret backstop for the env_contract section: never store
                # the VALUE — only presence.
                if section_name == ENV_CONTRACT_SECTION:
                    str_val = "present" if str_val.strip() != "" else "absent"
                coerced[key] = str_val
            out[section_name] = coerced
        return out

    def to_stored_config(self) -> dict:
        """Serialize the envelope for JSONB persistence (post-backstop)."""
        return {
            "schema_version": self.schema_version,
            "captured_at": self.captured_at.isoformat(),
            "sections": self.sections,
        }


class CanonicalConfigResponse(BaseSchema):
    """The canonical config a runner PULLS to reconcile its own box toward.

    Secret-free by construction (the stored envelope already coerced
    ``env_contract`` to present/absent). ``section_policy`` maps each section
    to what a pulling runner may do with it (apply / report secrets only /
    stop on destructive) — see :mod:`app.services.devenv_section_policy`.

    ``canonical_machine_id`` is ``None`` (and ``sections`` empty) only if no
    canonical is set — the endpoint 422s that case before building this, so in
    practice these are always populated.
    """

    environment_id: UUID
    canonical_machine_id: UUID | None = None
    canonical_machine_name: str | None = None
    schema_version: int | None = None
    captured_at: IsoDatetime | None = None
    sections: dict[str, dict[str, str]] = Field(default_factory=dict)
    section_policy: dict[str, SectionPolicyT] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Drift
# ---------------------------------------------------------------------------


class KeyDelta(BaseSchema):
    """A single key-level difference between canonical and a target machine."""

    key: str
    status: DeltaStatusT
    expected: str | None = None
    actual: str | None = None
    severity: SeverityT


class SectionDrift(BaseSchema):
    """Per-section rollup of key deltas."""

    section: str
    deltas: list[KeyDelta] = Field(default_factory=list)
    severity: SeverityT


class MachineDriftReport(BaseSchema):
    """Drift of one target machine vs the canonical machine."""

    machine_id: UUID | None = None
    machine_name: str | None = None
    sections: list[SectionDrift] = Field(default_factory=list)
    severity: SeverityT
    in_sync: bool
    schema_version_mismatch: bool = False
    expected_schema_version: int | None = None
    actual_schema_version: int | None = None
    has_config: bool = True


class EnvironmentDriftResponse(BaseSchema):
    """Environment-level drift rollup across all non-canonical machines."""

    environment_id: UUID
    canonical_machine_id: UUID | None = None
    canonical_machine_name: str | None = None
    reports: list[MachineDriftReport] = Field(default_factory=list)
    severity: SeverityT
    in_sync: bool
