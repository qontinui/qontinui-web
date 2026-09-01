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

import re
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

# How one key differs between the canonical capture and a target capture.
#
# * ``added``   — present on the target, absent from canonical.
# * ``removed`` — present on canonical, MEASURED-AND-ABSENT on the target.
# * ``changed`` — present on both with different values.
# * ``unknown`` — the capturing box could not measure the key at all (its probe
#                 exceeded the capture budget, so the runner omitted the value
#                 and named the key in the envelope's ``unknown_keys``).
#
# * ``unverified`` — both sides reported the key, but comparing them verifies
#                    nothing. Two causes, one verdict (see
#                    ``app.services.devenv_drift``): the capture's own value
#                    says the fact was never measured
#                    (``python_installed_probe`` other than ``measured``), or
#                    the two captures are not comparable at all (their
#                    ``python_installed_env_kind`` / ``..._scope_kind`` /
#                    ``..._interpreter`` markers disagree, so their digests were
#                    taken over different environments). Both must read as
#                    neither clean nor drifted.
#
# ``unknown`` is a STATUS, not a qualifier flag beside ``removed``: a
# ``removed`` delta asserts "canonical has this, the target does not", and that
# claim is simply false for a key nobody looked at — a flag alongside it would
# leave the false assertion on the wire and merely footnote it. This follows
# :data:`CiNodeReachabilityT` below, whose own comment makes the identical
# argument for keeping ``unknown`` out of ``offline``: "we do not know" and "it
# is not there" are different claims. Contrast :attr:`KeyDelta.derived`, which
# IS a qualifier — a derived key's status is genuinely known, it just is not
# machine state.
#
# ``unverified`` is a fifth member for that same reason rather than a reuse of
# ``unknown``, and the distinction is not cosmetic:
#
# * ``unknown`` says the capturing box never measured THIS KEY, which is false
#   here — ``python_installed_probe`` was measured and reported; what went
#   unmeasured is the inventory the SIBLING keys describe, which is why they
#   are absent rather than zero.
# * The two carry opposite verdicts. ``unknown`` is an information gap that
#   must NOT flip ``in_sync`` (a capture budget is a property of the measuring
#   process, not of the box); ``unverified`` MUST flip it, because two boxes
#   that both failed to measure agree on every installed key and would
#   otherwise be reported in sync on the strength of two identical notes saying
#   nobody looked. Collapsing them would force every consumer to re-derive
#   which kind it was holding — and the drift UI already tells the reader that
#   an ``unknown`` "is not counted as drift", a sentence that would become a
#   lie the moment one kind of ``unknown`` started counting.
DeltaStatusT = Literal["added", "removed", "changed", "unknown", "unverified"]

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
    """Create an application.

    ``organization_id`` (P4 org sharing) shares the application with an org
    from birth — the caller must hold an edit-capable role (owner/admin/
    member) in that org.
    """

    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=200)
    description: str | None = None
    organization_id: UUID | None = None


class ApplicationUpdate(BaseSchema):
    """Partial update of an application.

    ``organization_id`` shares (set) / unshares (explicit ``null``) the
    application. Field-absent vs explicit-null is distinguished by the
    endpoints via ``model_dump(exclude_unset=True)``. Only the resource
    OWNER may change it.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    organization_id: UUID | None = None


class ApplicationResponse(BaseORMSchema):
    """An application.

    ``owner_user_id`` is exposed so shared-view clients can render
    owner-only controls (e.g. the sharing selector) honestly.
    """

    id: UUID
    owner_user_id: UUID
    organization_id: UUID | None = None
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
    # How the row came to exist: ``manual`` | ``dispatched`` | ``auto``.
    # ``None`` means UNKNOWN (the row predates the column) and must be rendered
    # as such — never defaulted to ``manual``, which would invent provenance.
    enrollment_origin: str | None = None
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
            enrollment_origin=machine.enrollment_origin,
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
            enrollment_origin=machine.enrollment_origin,
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


class ReposApplyDispatchRequest(BaseSchema):
    """Ask a machine's runner to reconcile its cloned repositories.

    The server **requests**; the box decides and acts. Nothing here runs a clone
    on a developer's machine — the target's own runner receives the directive,
    applies its LOCAL policy (workspace-root resolution, the incomparable-scope
    refusal, the disk floor, per-repo auth), and reports. That separation is the
    same one that retired the agent-dispatch model on 2026-07-13: a clone is
    arbitrary code arriving on disk, so the authority to perform one stays with
    the box that owns the box.
    """

    confirm: bool = False
    """Whether the box should write, or only plan.

    Defaults to a **dry run**. The runner defaults the same way, so an omitted
    field asks for a plan at both ends — an omission must never be the dangerous
    case.
    """


class ReposApplyDispatchResponse(BaseSchema):
    """Result of a dispatched repos apply.

    ``dispatched`` says only that coord accepted the directive — NOT that the
    box acted on it, which it may decline to do (no workspace root, incomparable
    scopes, insufficient disk). The outcome arrives as ordinary drift on the next
    capture, which is the honest surface for it.
    """

    dispatched: bool
    confirm: bool
    detail: str | None = None


# ---------------------------------------------------------------------------
# Auto-enrollment policy (plan 2026-08-05, Phase 5)
#
# The owner-facing view of ``devenv.auto_enroll_policy``, which is what makes
# the connect-time engine visible and reversible. Two questions, one row:
# may new boxes of this owner enroll themselves, and which environment do they
# join.
#
# The response deliberately carries more than the two stored columns. The
# engine's most interesting outcome is a NO-OP — "more than one environment and
# no stated target" makes it skip every new box, silently, forever. A surface
# that showed only ``enabled`` and ``target_environment_id`` would render that
# state as a perfectly healthy "on", which is the same invisible hole the whole
# plan exists to close. So the server also reports what it would actually
# resolve (``effective_environment_id``) and how many environments the owner
# has, and the UI is expected to say so out loud.
# ---------------------------------------------------------------------------


class AutoEnrollPolicyUpdate(BaseSchema):
    """Set the owner's auto-enrollment policy.

    Both fields are required on a PUT — this is a whole-row write, not a patch,
    so a client can never half-state a policy and leave the other half at a
    value it never saw. ``target_environment_id: null`` clears the target.
    """

    enabled: bool
    target_environment_id: UUID | None = None


class AutoEnrollPolicyResponse(BaseSchema):
    """The owner's auto-enrollment policy, plus what it actually resolves to.

    ``configured`` is False when NO row exists. That is not the same as
    disabled: an absent row reads as ``enabled=True`` (the column default), so
    the flag exists to let the UI distinguish "the owner chose this" from "the
    owner has never visited this surface and is getting the default".

    ``effective_environment_id`` is the environment a new box would actually
    join right now, computed by the same precedence the engine uses: a target
    the owner really owns, else their single environment, else NULL. NULL with
    ``environment_count > 1`` is the ambiguous state — the engine will skip
    every new machine and log, and the UI must name that rather than showing a
    healthy-looking "on".

    ``globally_enabled`` is the DEPLOYMENT's ``DEVENV_AUTO_ENROLL_ENABLED``
    flag, and it dominates every other field here. It ships **false** and is
    turned on tenant by tenant, so for the whole rollout window the engine
    answers ``disabled_globally`` before it reads a single row — while
    ``enabled`` (the owner's own setting) still says true, because it does. A
    response that reported only the owner's half would let the panel render a
    healthy "on" over an engine that does nothing at all, on day one, for
    everybody. It is exposed for exactly that reason and for no other: the
    owner cannot change it and there is no route that would let them.
    """

    enabled: bool
    globally_enabled: bool
    target_environment_id: UUID | None = None
    configured: bool
    effective_environment_id: UUID | None = None
    environment_count: int
    updated_at: IsoDatetime | None = None


# ---------------------------------------------------------------------------
# CI-node configuration (plan 2026-08-07, Phase 4)
#
# These schemas mirror the runner's Rust ``CiNodeSettings``
# (qontinui-runner/src-tauri/src/settings.rs). That struct is the AUTHORITY for
# the shape; this is the editor. When it gains a field, add it here in the same
# PR or the web surface silently stops covering the runner's knobs.
# ---------------------------------------------------------------------------

# What a ``repo_allowlist`` entry may look like. The runner's admission check
# matches an entry against either the coord ``owner/name`` slug or the bare
# repo basename, so both are accepted — and nothing else. Anchored, so a
# partial match cannot sneak a wildcard-ish entry through.
_CI_NODE_REPO_RE = re.compile(r"^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)?$")

# A hard ceiling on the list length. Not a security property (the runner
# enforces its own admission): a legibility one. An allowlist longer than this
# is no longer something an owner can review before consenting to it, which is
# the entire point of the list.
CI_NODE_MAX_ALLOWLIST_ENTRIES = 100

# How reachable the paired coord device is, as far as coord will say.
#
# This exists because a CI-node setting is a REMOTE instruction, and an
# instruction that cannot arrive must not be drawn as though it had:
#
# * ``unlinked``  — the machine has no ``coord_device_id``; there is no runner
#                   to send anything to.
# * ``offline``   — coord knows the device but holds no live WS session, so a
#                   fanout publish has no subscriber and is dropped.
# * ``online``    — coord holds a live WS session for the device.
# * ``unknown``   — coord could not be asked (unreachable/timeout). Reported as
#                   its own state rather than collapsed into ``offline``: "we
#                   do not know" and "it is not there" are different claims.
CiNodeReachabilityT = Literal["unlinked", "offline", "online", "unknown"]


class CiNodeConfig(BaseSchema):
    """The four ``CiNodeSettings`` fields, with the runner's own defaults.

    The defaults are copied from the Rust ``Default for CiNodeSettings`` impl
    on purpose: a machine that has never been configured here must round-trip
    as the posture the runner actually ships with, never as a friendlier one.
    """

    # Master opt-in. FALSE by default. Enabling this lets coord dispatch
    # repo-declared commands onto the owner's machine, which is why the field
    # has no "default on" story anywhere in the stack.
    enabled: bool = False
    # Concurrent CI builds the device admits (and advertises as its budget).
    max_concurrent_builds: int = Field(default=1, ge=1, le=64)
    # Repos this device may build. EMPTY by default and empty means nothing is
    # runnable even when ``enabled`` — allowlisting is a deliberate act, and
    # there is deliberately no wildcard entry (see the validator).
    repo_allowlist: list[str] = Field(
        default_factory=list, max_length=CI_NODE_MAX_ALLOWLIST_ENTRIES
    )
    # Free disk (GiB) on the runner's volume required to START a build.
    #
    # ``ge=1``: 0 would DISABLE the guard, and this box has hit `os error 112`
    # (disk exhaustion) for real. Turning a safety floor off is not something a
    # remote surface should make one keystroke easy; an owner who truly wants
    # it can still hand-edit the runner's settings.json.
    min_free_disk_gb: int = Field(default=20, ge=1, le=100_000)

    @field_validator("repo_allowlist")
    @classmethod
    def _validate_allowlist(cls, entries: list[str]) -> list[str]:
        """Normalize + validate entries; reject wildcards and duplicates.

        A wildcard is rejected with its own message rather than the generic
        format error: "allow everything" is the exact affordance this feature
        must not have, so a caller reaching for it deserves to be told why it
        is absent instead of guessing at a regex.
        """
        seen: set[str] = set()
        cleaned: list[str] = []
        for raw in entries:
            entry = raw.strip()
            if not entry:
                raise ValueError("repo_allowlist entries must be non-empty")
            if "*" in entry or entry == "all":
                raise ValueError(
                    "repo_allowlist has no wildcard: every repo this device may "
                    "build is listed explicitly, one entry at a time"
                )
            if len(entry) > 200:
                raise ValueError(f"repo_allowlist entry {entry!r} is too long")
            if not _CI_NODE_REPO_RE.match(entry):
                raise ValueError(
                    f"repo_allowlist entry {entry!r} must be `owner/name` or a "
                    "bare repo name"
                )
            if entry in seen:
                continue
            seen.add(entry)
            cleaned.append(entry)
        return cleaned


class CiNodeConfigResponse(BaseSchema):
    """A machine's DESIRED CI-node configuration and how far it has travelled.

    Every field that could be mistaken for "what the runner is running right
    now" is named for what it actually is. Web has no read-back channel for the
    runner's settings file, so it reports what was requested, when it was
    handed to coord, and whether coord could even reach the device — and never
    asserts that the device applied it.
    """

    machine_id: UUID
    coord_device_id: UUID | None = None
    # The desired config. For a never-configured machine this is the runner's
    # own defaults (off, empty allowlist), NOT an empty object — the form has
    # to render something and it must be the honest posture.
    requested: CiNodeConfig
    # False when this surface has never saved a config for the machine. Lets
    # the UI distinguish "explicitly turned off here" from "never touched
    # here, the runner's file is whatever the owner left it as".
    configured: bool = False
    requested_at: IsoDatetime | None = None
    # When coord last ACCEPTED the directive. Handed off, never confirmed
    # applied — the runner sends no ack for settings.
    dispatched_at: IsoDatetime | None = None
    reachability: CiNodeReachabilityT
    # Result of THIS request's dispatch attempt. ``None`` on a read (nothing
    # was attempted), so a UI can never mistake a GET for a successful push.
    dispatched: bool | None = None
    # WHY the dispatch did not happen, in the words of whoever refused it.
    #
    # These three carry coord's own answer through instead of flattening it to
    # "HTTP 4xx". The distinction is load-bearing for the reader: a wildcard in
    # the allowlist is something they typed and can fix in this form, while a
    # device-ownership refusal is not — and a bare status number cannot tell
    # them which one they hit.
    #
    # * ``dispatch_status`` — the HTTP status coord answered with, or ``None``
    #   when there was no answer to have (nothing paired; coord unreachable).
    # * ``dispatch_error``  — coord's machine-readable code from the ``error``
    #   key (e.g. ``repo_allowlist_wildcard``,
    #   ``device_not_found_in_tenant``). The UI keys refusal CLASS off this +
    #   the status, never off prose.
    # * ``dispatch_detail`` — the human sentence, coord's ``message`` verbatim
    #   when it sent one. This is what the panel shows the user.
    #
    # None of them upgrade a refusal into a success: ``dispatched`` stays
    # ``False`` and the save is still reported as saved-but-not-delivered.
    dispatch_status: int | None = None
    dispatch_error: str | None = None
    dispatch_detail: str | None = None


# ---------------------------------------------------------------------------
# Environments
# ---------------------------------------------------------------------------


class EnvironmentCreate(BaseSchema):
    """Create an environment, optionally bound to an application.

    ``organization_id`` (P4 org sharing) shares the environment with an org
    from birth — the caller must hold an edit-capable role (owner/admin/
    member) in that org.
    """

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    application_id: UUID | None = None
    organization_id: UUID | None = None


class EnvironmentUpdate(BaseSchema):
    """Partial update of an environment.

    ``organization_id`` shares (set) / unshares (explicit ``null``) the
    environment. Field-absent vs explicit-null is distinguished by the
    endpoints via ``model_dump(exclude_unset=True)``. Only the resource
    OWNER may change it.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    application_id: UUID | None = None
    organization_id: UUID | None = None


class EnvironmentResponse(BaseORMSchema):
    """An environment, including its (single) canonical machine pointer.

    ``owner_user_id`` is exposed so shared-view clients can render
    owner-only controls (e.g. the sharing selector) honestly.
    """

    id: UUID
    owner_user_id: UUID
    organization_id: UUID | None = None
    name: str
    description: str | None = None
    application_id: UUID | None = None
    canonical_machine_id: UUID | None = None
    created_at: IsoDatetime
    updated_at: IsoDatetime


class SetCanonicalRequest(BaseSchema):
    """Designate a machine as the canonical source of truth for an env.

    ``note`` is the optional "why" recorded alongside the who/when in
    :class:`~app.models.devenv.CanonicalChangeLog`. Changing canonical
    re-points every other machine's drift, so the reason is the part of the
    audit trail a teammate reading it later actually needs. Optional by
    design — an unexplained change is still fully attributable, and requiring
    prose would only produce empty ceremony.
    """

    machine_id: UUID
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def _blank_note_is_none(cls, v: str | None) -> str | None:
        """Trim, and treat a whitespace-only note as no note at all.

        Keeps `""` out of the audit trail, so "has a note" is a truthiness
        check for every reader (the UI renders the row only when non-null).
        """
        return (v or "").strip() or None


class CanonicalChangeResponse(BaseORMSchema):
    """One audited canonical-designation change (newest-first in a list).

    The "records of who changed it and when" for the team-sync model:
    ``changed_by_user_id`` + ``changed_at`` + the ``from``/``to`` machine.
    ``tenant_id`` is best-effort (the active-tenant context of the change).

    The ``*_email`` / ``*_name`` fields are display labels resolved
    server-side by LEFT JOIN (one query, no client N+1). They are **always
    nullable**: the machine ids are soft references so an audit row outlives
    the machine it names, and the actor FK is ``ON DELETE SET NULL``. A UI
    must fall back (e.g. "deleted machine" / a short id prefix) rather than
    assume a name is present.
    """

    id: UUID
    environment_id: UUID
    from_machine_id: UUID | None = None
    to_machine_id: UUID | None = None
    changed_by_user_id: UUID | None = None
    changed_by_email: str | None = None
    from_machine_name: str | None = None
    to_machine_name: str | None = None
    tenant_id: UUID | None = None
    note: str | None = None
    changed_at: IsoDatetime


class ConfigHistoryEntry(BaseORMSchema):
    """One capture in a machine's config-history timeline (newest-first).

    Metadata only — deliberately NO config body, so a long timeline stays a
    small payload. The body is reachable through the diff endpoint (as a
    drift report), never dumped raw.
    """

    id: UUID
    captured_at: IsoDatetime
    schema_version: int
    source: str
    content_hash: str


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
    unknown_keys: dict[str, list[str]] | None = None
    """``section -> keys the capturing box could not MEASURE`` (additive).

    A probe that exceeds the capture budget makes the runner omit its key from
    ``sections`` entirely, and an omitted key is otherwise indistinguishable
    from a genuinely absent toolchain — so an unmeasured key would be diffed as
    ``removed``/critical and could drive an install for a version that is
    already correct. The runner names those keys here instead.

    Three states, all distinguishable and all meaningful:

    * ``None``  — the field never arrived. The runner PREDATES it; nothing can
      be concluded about whether anything went unmeasured.
    * ``{}``    — an explicit "every probe completed". The runner always emits
      the field, empty included, precisely so this differs from ``None``.
    * non-empty — these keys were not measured on this capture.

    ``None`` is preserved rather than defaulted to ``{}`` because collapsing
    them would turn "we were never told" into a positive claim that everything
    was measured — the same absence-is-not-emptiness error the whole field
    exists to correct. :meth:`to_stored_config` therefore OMITS the key from
    the persisted envelope when this is ``None``, so an old runner's stored
    shape (and its content hash) is byte-identical to what it was before this
    field existed.
    """

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

    @field_validator("unknown_keys", mode="before")
    @classmethod
    def _validate_unknown_keys(cls, value: object) -> object:
        """Validate ``section -> [key, ...]``; dedupe and sort each list.

        Sorted + deduped so two captures that named the same unmeasured keys in
        a different order hash identically — otherwise the history dedup in
        ``config_history_repo.append_if_changed`` would append a row per
        capture on nothing but list order.
        """
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ValueError("unknown_keys must be a mapping of section -> [key, ...]")
        out: dict[str, list[str]] = {}
        for section_name, keys in value.items():
            if not isinstance(section_name, str):
                raise ValueError("unknown_keys section names must be strings")
            if isinstance(keys, str) or not isinstance(keys, list | tuple | set):
                raise ValueError(
                    f"unknown_keys['{section_name}'] must be a list of key names"
                )
            cleaned: set[str] = set()
            for key in keys:
                if not isinstance(key, str):
                    raise ValueError(
                        f"unknown_keys['{section_name}'] entries must be strings"
                    )
                cleaned.add(key)
            out[section_name] = sorted(cleaned)
        return out

    def to_stored_config(self) -> dict:
        """Serialize the envelope for JSONB persistence (post-backstop).

        ``unknown_keys`` is written as a SIBLING of ``sections`` (mirroring the
        runner's wire shape) and is omitted entirely when the agent did not send
        it. Omission — not an empty dict — is what keeps "this runner predates
        the field" readable in the store, and it also leaves a pre-existing
        runner's persisted bytes (hence its content hash, hence the history
        dedup) exactly as they were.
        """
        stored: dict = {
            "schema_version": self.schema_version,
            "captured_at": self.captured_at.isoformat(),
            "sections": self.sections,
        }
        if self.unknown_keys is not None:
            stored["unknown_keys"] = self.unknown_keys
        return stored


class CanonicalConfigResponse(BaseSchema):
    """The canonical config a runner PULLS to reconcile its own box toward.

    Secret-free by construction (the stored envelope already coerced
    ``env_contract`` to present/absent). ``section_policy`` maps each section
    to what a pulling runner may do with it (apply / report secrets only /
    stop on destructive) — see :mod:`app.services.devenv_section_policy`.

    ``derived_keys`` refines that per-SECTION policy down to the KEY level:
    ``section -> keys that are repo-derived``. A repo-derived key measures the
    source tree the capturing binary was built from, not the box, so it is not
    independently settable (you cannot install your way to a crate version) and
    must never be counted actionable — regardless of its section policy. The
    field is additive: absent/empty means "no per-key refinement", i.e. exactly
    the pre-existing behavior, so already-deployed runners are unaffected.

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
    derived_keys: dict[str, list[str]] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Drift
# ---------------------------------------------------------------------------


class KeyDelta(BaseSchema):
    """A single key-level difference between canonical and a target machine.

    Two of the statuses are not differences at all — see :data:`DeltaStatusT`:

    * ``unknown`` — one side of the comparison declines to claim it measured the
      key. Reported (never dropped) so the gap stays visible, at ``info``
      severity, and it does not make a machine out-of-sync.
    * ``unverified`` — both sides reported the key, but comparing them proves
      nothing: the value says the fact was never measured, or the two captures
      were taken over environments that are not comparable. Reported at
      ``warning``, and it DOES make a machine out-of-sync, because "nobody can
      say these agree" must never render as agreement.

    ``derived`` and ``observation_only`` are qualifiers rather than statuses:
    the difference is genuinely known in both cases, it just is not machine
    state (``derived``) or is not something an apply can set
    (``observation_only``).
    """

    key: str
    status: DeltaStatusT
    expected: str | None = None
    actual: str | None = None
    severity: SeverityT
    derived: bool = False
    """Whether this key's value is repo-derived rather than machine state.

    A derived key (``runner_crate_version``, ``node_dep_*``, …) is parsed from
    the ``Cargo.toml``/``package.json`` next to the capturing binary, so it
    measures *which source tree captured the config*, not the box. It converges
    by pulling the repo and can never be applied — so it is reported at ``info``
    and does not make a machine out-of-sync. See
    ``services/devenv_section_policy.is_derived_key``.
    """
    observation_only: bool = False
    """Whether this key is a MEASUREMENT that no apply action can set.

    ``derived`` and this flag both mean "never offer this as an apply", but for
    opposite reasons, and only one of them is also "not machine drift":

    * ``derived`` — not the box's state at all (it is the capturing binary's
      source tree), so it is reported at ``info`` AND excluded from ``in_sync``.
    * ``observation_only`` — genuinely the box's state, and a difference here is
      REAL drift that counts against ``in_sync`` at full severity. It just is
      not settable as a key: ``python_installed_digest`` is a sha256 over the
      installed packages, so "set the digest to X" is not an instruction anyone
      can carry out (the box converges by installing packages, and the digest
      then follows).

    Marking such a key derived to keep it out of the apply plan would silently
    drop it from ``in_sync`` too, re-creating the "reports clean while measuring
    nothing" failure the installed-inventory capture exists to remove — hence
    two flags rather than one. See
    ``services/devenv_section_policy.is_observation_only_key``.
    """


class SectionDrift(BaseSchema):
    """Per-section rollup of key deltas."""

    section: str
    deltas: list[KeyDelta] = Field(default_factory=list)
    severity: SeverityT
    process_scoped: bool = False
    """Whether this section's capture reflects the capturing PROCESS, not the box.

    ``env_contract`` is read from the capturing process's own environment, so a
    runner-supervisor capture and a plain-shell capture legitimately disagree on
    the same machine. Deltas here may be process-scope artifacts rather than real
    drift — but they may equally be genuinely missing values, which is
    indistinguishable server-side, so they are LABELLED and never suppressed.
    """


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


class ConfigHistoryDiffResponse(MachineDriftReport):
    """SELF-drift between two captures of the SAME machine over time.

    The same drift-report shape as the vs-canonical endpoints (sections of
    key deltas + severity rollup), produced by
    :func:`app.services.devenv_drift.diff_envelopes` with the ``from``
    capture in the canonical slot ("expected") and the ``to`` capture in the
    target slot ("actual") — the report reads as "what changed going from
    ``from`` to ``to``".
    Extends the base shape with the identity of the two compared captures.
    """

    from_id: UUID
    to_id: UUID
    from_captured_at: IsoDatetime
    to_captured_at: IsoDatetime


class EnvironmentDriftResponse(BaseSchema):
    """Environment-level drift rollup across all non-canonical machines."""

    environment_id: UUID
    canonical_machine_id: UUID | None = None
    canonical_machine_name: str | None = None
    reports: list[MachineDriftReport] = Field(default_factory=list)
    severity: SeverityT
    in_sync: bool
