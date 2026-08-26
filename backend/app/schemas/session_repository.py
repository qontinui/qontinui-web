"""Pydantic schemas for the Claude Code Session Repository.

Phase 4 of ``2026-08-26-claude-code-session-repository-in-qontinui-web``
(``agent.session_artifacts``; see :mod:`app.models.session_artifact`).

Modelled on :mod:`app.schemas.plan_library`, and diverging from it in three
places that are all load-bearing rather than stylistic:

* **``organization_id`` is absent from every request model** — same rule, same
  reason: it is derived server-side from the authenticated principal, and the
  surest way to stop a caller escalating scope is to give the request nowhere
  to put one.

* **``tenant_id`` and ``tenant_source`` ARE request fields, and that is the
  point.** Plan §3.6 rule 1 forbids deriving tenancy from the caller: the
  plan library's ``_resolve_org_id`` idiom would file every shared-tenant
  session under the operator's personal organization. Tenancy belongs to the
  *session record*, so it travels in the payload alongside the provenance
  label that says how it was established — never inferred here from who is
  holding the credential.

* **Every optional field is genuinely OPTIONAL, and omission means "leave it
  alone".** This store has TWO writers for one row (plan §5): the runner owns
  ``body_object_key`` / ``content_sha256`` / ``body_source``, while the web
  archiver promotes metadata only. A merge that treated an omitted field as
  ``NULL`` would have the archiver's next metadata pass silently erase the
  runner's archived body. The upsert therefore writes only the fields the
  request actually carried (``model_fields_set``), which is why nothing below
  is spelled with a "clearing" default.

``secret_finding_count`` / ``secret_finding_kinds`` appear on requests and
responses and are filterable — an audit signal, never a visibility gate and
never a mask (plan §4 Phase 1, §5).
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.base import BaseORMSchema, IsoDatetime

#: How a row's ``tenant_id`` was established. Mirrors
#: :data:`app.models.session_artifact.SESSION_TENANT_SOURCES` and the
#: ``ck_session_artifacts_tenant_source`` CHECK — a ``Literal`` so a bad value
#: is a 422 here instead of an IntegrityError 500 at the database.
SessionTenantSource = Literal[
    "declared",
    "derived_repo",
    "derived_sole_binding",
    "ambiguous",
    "unknown",
]

#: Where the archived bytes came from. ``disk_verbatim`` bytes were read
#: straight off the account home by the runner, so their ``content_sha256``
#: verifies against the original file; ``coord_redacted`` bytes came through
#: coord's transcript stream, which ran ``redact_secrets`` on the way in, so
#: their digest can NEVER be checked against the original. The API must never
#: present the second as if it were the first (plan §5).
SessionBodySource = Literal["disk_verbatim", "coord_redacted"]

SessionState = Literal["open", "closed", "abandoned"]

SessionCloseoutState = Literal["clean", "unfinished", "unknown"]

#: How ``POST /{id}/relaunch`` was asked to bring a session back. These are
#: genuinely different operations, not two labels for one (plan §3.5) — see
#: :class:`SessionRelaunchRequest`.
SessionRelaunchMode = Literal["resume", "transfer"]

#: The honest tier label for a relaunch. ``full`` restores the conversation;
#: ``replay_as_context`` does not and cannot. Preserved from the shipped
#: ``ResumePanel.tsx`` pattern precisely because a UI that renders the two
#: alike silently loses state.
SessionRestoreTier = Literal["full", "replay_as_context"]


# ───────────────────────────── requests ─────────────────────────────


class SessionArtifactUpsert(BaseModel):
    """Upsert payload for one archived session.

    Identity is ``(claude_session_id, account_label)`` — both of them here,
    and nothing else. A Claude Code session id is unique per ACCOUNT HOME
    rather than globally, which is why ``account_label`` is part of the key and
    not decoration. The organization is NOT part of it: it is server-derived
    scoping (see :class:`app.models.session_artifact.SessionArtifact`), so this
    payload addresses a session rather than a session-within-an-organization,
    and the web archiver's principal-less write can converge on the same row.

    **Omitted means untouched.** See the module docstring: two writers share
    this row, so only the fields present in the request are written.

    NOTE the absence of ``organization_id``, and the deliberate PRESENCE of
    ``tenant_id`` — also the module docstring.
    """

    claude_session_id: str = Field(..., min_length=1, max_length=512)
    account_label: str | None = Field(None, max_length=255)

    # ── tenancy: from the session record, never from the caller ──────────
    tenant_id: UUID | None = None
    #: REQUIRED whenever ``tenant_id`` is supplied — a tenant with no
    #: provenance is exactly the "guess that renders like a declaration"
    #: defect plan §3.6 rule 2 exists to prevent. Enforced below.
    tenant_source: SessionTenantSource | None = None
    device_id: UUID | None = None
    machine_hostname: str | None = Field(None, max_length=512)

    # ── soft links: FK-less, permitted to dangle ─────────────────────────
    coord_session_id: UUID | None = None
    work_unit_slug: str | None = Field(None, max_length=255)
    task_run_id: str | None = Field(None, max_length=255)

    # ── provenance / relaunch ────────────────────────────────────────────
    config_dir: str | None = Field(None, max_length=4096)
    working_dir: str | None = Field(None, max_length=4096)
    repo: str | None = Field(None, max_length=255)
    git_branch: str | None = Field(None, max_length=512)
    provider: str | None = Field(None, max_length=64)
    launch_command: str | None = Field(None, max_length=8192)
    restore_tier: str | None = Field(None, max_length=64)
    machine_id: str | None = Field(None, max_length=255)
    permission_mode: str | None = Field(None, max_length=64)

    # ── content ──────────────────────────────────────────────────────────
    #: The archived JSONL as UTF-8 TEXT. Convenient, and correct for every
    #: transcript that is valid UTF-8 (all of them, in practice).
    body: str | None = None
    #: The archived JSONL as EXACT BYTES, base64-encoded. This is the door
    #: that keeps "byte-verbatim" true in the general case: a JSON string
    #: cannot carry a lone surrogate or an invalid UTF-8 sequence, and a
    #: transcript that lost bytes in transit would still get a
    #: ``content_sha256`` — over the wrong bytes. A caller that cares about
    #: verifiability uses this one.
    body_base64: str | None = None
    #: REQUIRED when a body is supplied. Never defaulted: a body whose origin
    #: is unstated would let a redacted stream masquerade as a verifiable
    #: archive (plan §5).
    body_source: SessionBodySource | None = None
    #: Optional caller-computed digest, CHECKED against the server's own
    #: sha256 of the supplied bytes. Same rule as the plan library: the stored
    #: value is always the server-computed one, so a stale or forged hash can
    #: never suppress a real revision.
    content_sha256: str | None = Field(None, min_length=64, max_length=64)
    #: Only meaningful on a metadata-only upsert; ignored when a body is
    #: supplied, because the server counts the bytes it actually stored.
    byte_count: int | None = Field(None, ge=0)
    turn_count: int | None = Field(None, ge=0)
    first_prompt: str | None = None
    last_prompt: str | None = None
    ai_title: str | None = Field(None, max_length=1024)
    session_name: str | None = Field(None, max_length=1024)
    name_source: str | None = Field(None, max_length=64)

    # ── lifecycle ────────────────────────────────────────────────────────
    started_at: datetime | None = None
    last_activity_at: datetime | None = None
    ended_at: datetime | None = None
    state: SessionState | None = None
    #: DERIVED and recomputable (plan §3.4) — written by whatever recomputes
    #: it from coord's compliance verdict, the ``/unattended`` taxonomy and
    #: open gates/PRs. Accepted here because that recomputation runs OUTSIDE
    #: this process; it is never hand-set by a UI.
    closeout_state: SessionCloseoutState | None = None

    # ── exposure ─────────────────────────────────────────────────────────
    #: Written by the Phase 1 detector. An audit signal you can query — NOT a
    #: visibility gate and NOT a mask.
    secret_finding_count: int | None = Field(None, ge=0)
    #: ``None``/omitted = the detector never ran; ``[]`` = it ran and found
    #: nothing. Collapsing the two would make an unscanned row look clean.
    secret_finding_kinds: list[str] | None = None

    @model_validator(mode="after")
    def _check_body_and_tenancy(self) -> "SessionArtifactUpsert":
        """The three cross-field rules, rejected here rather than at the DB.

        Each one exists to stop a specific silent lie reaching the corpus, so
        none of them is defaulted away.
        """
        if self.body is not None and self.body_base64 is not None:
            raise ValueError(
                "Supply body OR body_base64, never both — two spellings of "
                "the archived bytes cannot be reconciled, and guessing which "
                "one the digest covers is exactly the ambiguity "
                "content_sha256 exists to remove."
            )
        has_body = self.body is not None or self.body_base64 is not None
        if has_body and self.body_source is None:
            raise ValueError(
                "body_source is required when a body is supplied: it is what "
                "keeps content_sha256 honest. 'disk_verbatim' bytes verify "
                "against the original file; 'coord_redacted' bytes never can."
            )
        if self.tenant_id is not None and self.tenant_source is None:
            raise ValueError(
                "tenant_source is required when tenant_id is supplied — a "
                "tenant with no provenance renders identically to a declared "
                "one, which is the defect the column exists to prevent."
            )
        if self.tenant_source == "declared" and self.tenant_id is None:
            raise ValueError(
                "tenant_source='declared' with no tenant_id declares nothing."
            )
        return self


class SessionRelaunchRequest(BaseModel):
    """Ask for a session back — as a resume, or as a transfer.

    The two are NOT interchangeable (plan §3.5). ``resume`` restores the
    conversation on the account and machine that owns it; ``transfer`` cannot,
    because a Claude Code transcript is account-scoped and no other account
    can ``claude --resume`` it. Labelling the second a resume is how state gets
    silently lost, so the mode is required and the response carries the tier.
    """

    mode: SessionRelaunchMode = "resume"
    #: The coord device to hand the session to. REQUIRED for ``resume`` —
    #: dispatch reuses the shipped ``POST /sessions/:id/handoff`` subject,
    #: whose body is ``{target_device_id}``. Ignored for ``transfer``, which
    #: is not a handoff.
    target_device_id: UUID | None = None
    #: How many trailing turns to render as replay context for a
    #: ``transfer``. Ignored for ``resume``, which restores the whole
    #: conversation and needs no excerpt.
    context_turns: int = Field(20, ge=1, le=200)
    #: Free-text reason recorded on coord's durable ``handoff_request`` event.
    reason: str | None = Field(None, max_length=1024)


# ───────────────────────────── responses ────────────────────────────


class SessionArtifactSummary(BaseORMSchema):
    """One list row — every head-row field except the (large) body.

    ``tenant_source`` and ``body_source`` are on EVERY row on purpose. They
    are the two honesty signals the plan makes load-bearing: the first lets a
    UI render a guessed tenant as visibly weaker than a declared one, the
    second is what stops a digest over redacted bytes being presented as
    verifiable.
    """

    id: UUID
    organization_id: UUID | None
    claude_session_id: str
    account_label: str | None

    tenant_id: UUID | None
    tenant_source: str
    device_id: UUID | None
    machine_hostname: str | None

    coord_session_id: UUID | None
    work_unit_slug: str | None
    task_run_id: str | None

    config_dir: str | None
    working_dir: str | None
    repo: str | None
    git_branch: str | None
    provider: str | None
    launch_command: str | None
    restore_tier: str | None
    machine_id: str | None
    permission_mode: str | None

    body_object_key: str | None
    content_sha256: str | None
    byte_count: int | None
    turn_count: int | None
    first_prompt: str | None
    last_prompt: str | None
    ai_title: str | None
    session_name: str | None
    name_source: str | None
    body_source: str | None

    started_at: IsoDatetime | None
    last_activity_at: IsoDatetime | None
    ended_at: IsoDatetime | None
    state: str
    closeout_state: str

    secret_finding_count: int
    secret_finding_kinds: list[str] | None

    created_at: IsoDatetime
    updated_at: IsoDatetime


class SessionTurn(BaseORMSchema):
    """One decoded turn out of the archived JSONL.

    ``raw`` is omitted unless the caller asks for it: the whole reason
    ``/turns`` exists is that an agent must be able to read a 4 MB transcript
    without swallowing it whole, and returning every parsed record by default
    would hand back the same 4 MB in a more expensive encoding.
    """

    #: Zero-based position in the transcript — the ``from`` cursor's unit.
    index: int
    #: 1-based line number in the archived file, so a finding can be pointed
    #: at the byte range it came from.
    line_number: int
    #: The record's ``type`` (``user``, ``assistant``, ``summary``, …), or
    #: ``None`` on a record that has none.
    type: str | None = None
    #: ``message.role`` where the record carries one.
    role: str | None = None
    uuid: str | None = None
    parent_uuid: str | None = None
    timestamp: str | None = None
    #: Text content, flattened out of the content blocks. Non-text blocks are
    #: summarised in place (``[tool_use: Bash]``) rather than dropped, so the
    #: shape of the turn survives.
    text: str | None = None
    #: Set when the line could not be parsed. A malformed line is RETURNED as
    #: an error turn rather than skipped: a reader of an archive has to be
    #: able to see the gap, and a silently dropped line is indistinguishable
    #: from a session that never said anything there.
    parse_error: str | None = None
    raw: dict | None = None


class SessionTurnIndexEntry(BaseModel):
    """A cheap pointer at one turn, for the detail read's index."""

    index: int
    line_number: int
    type: str | None = None
    role: str | None = None
    timestamp: str | None = None
    #: First few characters of the turn's text — enough to recognise it,
    #: never enough to constitute the transcript.
    preview: str | None = None
    parse_error: str | None = None


class SessionArtifactDetail(SessionArtifactSummary):
    """Head row plus the turn index.

    ``turn_index_state`` is not decoration. ``not_requested`` and
    ``unavailable`` are both distinct from ``present`` with an empty list,
    because "we did not look" and "the body is gone" must never render as
    "this session has no turns".
    """

    turn_index: list[SessionTurnIndexEntry] | None = None
    turn_index_state: Literal[
        "present", "truncated", "not_requested", "unavailable"
    ] = "not_requested"
    #: Why the index is ``unavailable`` — a missing body, or a storage read
    #: that failed. Never ``None`` when the state is ``unavailable``.
    turn_index_unavailable_reason: str | None = None
    #: Turns actually decoded from the stored body. May differ from
    #: ``turn_count`` (a metadata-only writer's estimate) — both are reported
    #: rather than reconciled behind the caller's back.
    decoded_turn_count: int | None = None
    #: ``True`` only for a ``disk_verbatim`` body carrying a digest. A
    #: ``coord_redacted`` body's digest cannot be checked against the original
    #: transcript, and this flag is what says so (plan §5).
    digest_verifiable: bool = False


class SessionArtifactListResponse(BaseModel):
    """A page of list rows."""

    items: list[SessionArtifactSummary]
    total: int
    offset: int
    limit: int


class SessionTurnsResponse(BaseModel):
    """A page of decoded turns."""

    session_artifact_id: UUID
    claude_session_id: str
    items: list[SessionTurn]
    #: Turns in the whole transcript, so a caller can page without guessing.
    total: int
    offset: int
    limit: int
    body_source: str | None = None
    digest_verifiable: bool = False


class SessionArtifactUpsertResponse(BaseModel):
    """Upsert outcome.

    ``body_written`` distinguishes the runner's body-carrying write from the
    archiver's metadata promotion, which is the distinction plan §5 turns on:
    only the first may move ``body_object_key`` / ``content_sha256``.
    """

    created: bool
    changed: bool
    body_written: bool
    artifact: SessionArtifactSummary


class CoordSignal(BaseModel):
    """A coord-owned signal, or an explicit statement that it is UNKNOWN.

    Copied from the plan library's invariant 5 posture: an unavailable coord
    degrades to ``available=False`` with a stated reason, and NEVER to an
    empty payload. "coord is down" and "coord says there is nothing" are
    different answers, and rendering the first as the second is how a
    monitoring surface reports an outage as good news.
    """

    available: bool
    #: Populated iff ``available`` is False. Names what actually failed.
    unavailable_reason: str | None = None
    #: coord's payload, verbatim, when it answered.
    payload: object | None = None


class SessionUnfinishedResponse(BaseModel):
    """``GET /unfinished`` — the capability the operator asked for by name.

    Two buckets, reported separately and never merged:

    * ``items`` — rows whose derived ``closeout_state`` is ``unfinished``.
    * ``unknown_count`` — rows nobody has evaluated yet. These are NOT
      evidence of clean closeout; an empty ``items`` beside a large
      ``unknown_count`` means the derivation has not run, which is a different
      fact from "everything was closed out" and must not read like it.
    """

    items: list[SessionArtifactSummary]
    total: int
    offset: int
    limit: int
    unknown_count: int
    clean_count: int
    #: coord's live outstanding-work ledger
    #: (``/coord/session-compliance/outstanding``), or an explicit UNKNOWN.
    coord_outstanding: CoordSignal


class SessionRelaunchResponse(BaseModel):
    """The outcome of a relaunch request, with its honest tier.

    A ``transfer`` never reports ``dispatched=True``: there is no mechanism
    that can resume another account's session id, so the response carries the
    replay context and the two ``resume-foreign`` notices instead of pretending
    a spawn happened.
    """

    mode: SessionRelaunchMode
    restore_tier: SessionRestoreTier
    dispatched: bool
    session_artifact_id: UUID
    claude_session_id: str
    coord_session_id: UUID | None = None
    target_device_id: UUID | None = None
    #: Everything needed to relaunch by hand if dispatch was not possible.
    account_label: str | None = None
    config_dir: str | None = None
    working_dir: str | None = None
    launch_command: str | None = None
    #: coord's response to the handoff, when one was dispatched.
    coord_response: object | None = None
    #: The trailing turns rendered as replay context — ``transfer`` only.
    context_turns: list[SessionTurn] | None = None
    #: The seam, stated plainly. ``resume-foreign``'s own rules become the
    #: copy: the transcript ended at a known instant and state after it is
    #: unknown, and the replayed context must not be auto-continued.
    notices: list[str] = Field(default_factory=list)
