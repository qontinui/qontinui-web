"""Claude Code Session Repository API — ``/api/v1/session-repository``.

Phase 4 of ``2026-08-26-claude-code-session-repository-in-qontinui-web``: the
read/write surface over ``agent.session_artifacts`` that turns 8,238 on-disk
Claude Code transcripts into a queryable, permanent, agent-reachable corpus —
and, specifically, makes "which sessions were never closed out?" a question
something can answer.

Routes
------
``GET  /session-repository``              list + filter (account/repo/state/
                                          closeout_state/tenant_source/since/q)
``GET  /session-repository/unfinished``   the never-closed-out capability (§3.4)
``GET  /session-repository/{id}``         head row + turn index
``GET  /session-repository/{id}/turns``   paged decoded turns (``from``/``limit``)
``GET  /session-repository/{id}/export``  the archived JSONL, byte-verbatim
``POST /session-repository``              upsert — the RUNNER's primary door
``POST /session-repository/{id}/relaunch`` resume, or transfer-as-context (§3.5)

The posture is copied from :mod:`app.api.v1.endpoints.plan_library`
(``:20-101``), which proved every idiom this surface needs. The invariants
below are that module's, restated where they hold and *corrected* where this
store deliberately diverges.

Invariants this module is responsible for
-----------------------------------------
1. **``organization_id`` is never read from the request body.** It is derived
   from the authenticated principal's personal organization by
   :func:`_resolve_org_scope`. :class:`~app.schemas.session_repository.SessionArtifactUpsert`
   does not declare the field, and ``crud.UPSERTABLE_COLUMNS`` does not contain
   it, so there are two independent reasons a caller cannot set one.

   It is also **not part of the row's identity** — that is
   ``(claude_session_id, coalesce(account_label, ''))``, and the reasoning is
   in :class:`~app.models.session_artifact.SessionArtifact`. The consequence
   this module owns: a ``POST`` addresses a session, not a session-within-an-
   organization, so the runner's write and the web archiver's principal-less
   write land on ONE row. ``crud.upsert_artifact`` then fills the organization
   in on an org-less row and refuses to move a row that already carries one.
   **Reads are unaffected and stay organization-scoped** (invariant 8) —
   scoping and identity are separate predicates here.

2. **Tenancy is NOT derived from the caller — this is where the plan-library
   idiom must not be copied.** ``plan_library._resolve_org_id`` derives an
   organization from the caller's PERSONAL organization; reusing that shape
   for ``tenant_id`` would file every shared-tenant session under whichever
   operator's personal org happened to POST it, and an archive cannot recover
   from a misattribution it never recorded as one. Plan §3.6 rule 1 is
   explicit: tenancy comes from the session record, or it is ``unknown``.

   Concretely: :func:`_resolve_org_scope` resolves the ORG axis and nothing
   else. ``tenant_id``/``tenant_source`` arrive as request data and are
   written verbatim; no code path in this module reads a tenant off the
   principal. The two axes answer different questions — "who owns this row in
   qontinui-web" versus "which coord tenant did this session run against" —
   and the model records both precisely so they cannot be conflated.

3. **``tenant_source`` and ``body_source`` ride on EVERY row, and the API
   never launders either.** ``tenant_source`` is required whenever a
   ``tenant_id`` is supplied and is filterable (``?tenant_source=``), so a
   guessed attribution can be rendered as visibly weaker than a declared one
   instead of identically (plan §3.6 rule 2). ``body_source`` is required
   whenever a body is supplied, and ``/export`` reports
   ``X-Digest-Verifiable: false`` for a ``coord_redacted`` body: those bytes
   passed through ``redact_secrets`` on the way into coord's stream, so their
   digest can never be checked against the original transcript (plan §5).

4. **Secret findings are an AUDIT SIGNAL, never a gate and never a mask.**
   ``secret_finding_count`` / ``secret_finding_kinds`` are returned on every
   row and filterable (``?has_secret_findings=``, ``?secret_finding_kind=``,
   ``?detector_ran=``). Nothing in this module hides a row, truncates a body
   or redacts an export because of them. The measured reason is in plan §5:
   the shipped redactor produced 57% false positives on this corpus while
   missing whole credential shapes, so masking would corrupt the archive
   without delivering the safety property.

5. **No direct reads of coord's schema.** Every coord-owned signal is fetched
   over coord's HTTP API via
   :func:`~app.api.v1.endpoints.operations._proxy_coord_get` — the house rule
   enforced by ``tests/test_coord_schema_boundary_guard.py``, which fails the
   build on a ``coord.<table>`` token in any non-docstring SQL string literal.

6. **An unavailable coord is UNKNOWN, never empty.** ``GET /unfinished``
   attaches coord's outstanding-work ledger as a
   :class:`~app.schemas.session_repository.CoordSignal` that degrades to
   ``available=False`` with a stated reason. "coord is down" and "coord says
   there is nothing outstanding" are opposite answers, and a monitoring
   surface that renders the first as the second reports an outage as good
   news.

7. **Dual auth — both a Cognito operator JWT and a coord device JWT read AND
   write.** Every route except ``POST /{id}/relaunch`` authenticates through
   :func:`~app.api.deps.get_audit_actor_user`. This is not a convenience:
   plan §5 makes the RUNNER the sole writer of ``body_object_key`` and
   ``content_sha256`` — it is the only component that can read the verbatim
   bytes off the account home — and the runner holds only its device JWT. A
   Cognito-only ``POST`` would 401 the one writer that has the bytes, and the
   corpus would sit empty while looking exactly like a corpus nobody wrote to.

   ``POST /{id}/relaunch`` is the exception and is admin-gated
   (``require_coord_tenant_admin``) ON PURPOSE. It is the only route here that
   acts on the fleet rather than on the archive: it dispatches real work onto
   a machine through coord's handoff subject, which the shipped
   ``POST /operations/sessions/{id}/handoff`` proxy already gates the same
   way. Ingest stays open to the credential that owns the bytes; dispatch
   stays closed to an operator admin.

8. **Reads are organization-scoped server-side, which is also what delivers
   plan §3.6 rule 4 today.** Rule 4 says ``ambiguous`` and ``unknown``
   attributions are owner-visible only, and every read here is already
   confined to the capturing principal's organization bucket — so a
   weakly-attributed row is never visible to anyone but its owner, and no
   second gate is needed. The condition under which one WOULD be needed is
   worth stating rather than discovering later: the moment a read is added
   that is scoped by ``tenant_id`` and visible to tenant members generally,
   the ``ambiguous``/``unknown`` buckets must be excluded from it, because a
   MISATTRIBUTED session surfacing in a tenant shared with other people is an
   exposure its owner never chose.

9. **Export is verbatim, and one-way.** ``/export`` emits the stored bytes
   unmodified — no re-encoding, no normalisation — because fidelity is the
   product: a ``disk_verbatim`` row's digest is meant to verify against the
   file it came from. There is deliberately no import half; bodies enter
   through ``POST /`` from the component that read them off disk.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import re
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    ActorKind,
    ActorPrincipal,
    current_active_user,
    get_async_db,
    get_audit_actor_principal,
    get_audit_actor_user,
)
from app.api.v1.endpoints.operations import (
    _proxy_coord_get,
    _proxy_coord_post,
    get_tenant_id,
    require_coord_tenant_admin,
)
from app.crud import session_artifact as crud
from app.models.session_artifact import SessionArtifact
from app.models.user import User
from app.schemas.session_repository import (
    CoordSignal,
    SessionArtifactDetail,
    SessionArtifactListResponse,
    SessionArtifactSummary,
    SessionArtifactUpsert,
    SessionArtifactUpsertResponse,
    SessionRelaunchRequest,
    SessionRelaunchResponse,
    SessionTurn,
    SessionTurnIndexEntry,
    SessionTurnsResponse,
    SessionUnfinishedResponse,
)
from app.services.permissions import resolve_personal_organization
from app.services.storage import object_storage

logger = structlog.get_logger(__name__)

router = APIRouter()

#: Object-store prefix for archived transcripts. One namespace so a bucket
#: policy can be written against this corpus alone — plan §5 notes that moving
#: the transcripts off one machine's filesystem concentrates the blast radius,
#: and a reviewable prefix is what makes that policy expressible.
_BODY_PREFIX = "session-repository"

#: Characters allowed in an object key segment. Session ids and account labels
#: are external input (a JSONL filename stem, a directory suffix), so
#: everything else folds to ``-``. This also removes path separators and
#: ``..`` segments, which is what stops a hostile label writing outside the
#: prefix on a filesystem-backed backend.
_KEY_SAFE = re.compile(r"[^A-Za-z0-9._-]+")

#: How much of a turn's text the detail read's index carries. Enough to
#: recognise a turn, never enough to be the transcript — ``/turns`` is the
#: route that hands back content.
_PREVIEW_CHARS = 200

#: Default ceiling on the detail read's turn index. A session's transcript can
#: hold thousands of turns and the detail read must stay a *head row* read;
#: truncation is REPORTED (``turn_index_state='truncated'``), never silent.
_TURN_INDEX_DEFAULT_LIMIT = 200

#: The custom response headers ``GET /{artifact_id}/export`` carries.
#:
#: Spelled ONCE because there are two consumers and they must not drift:
#: :func:`_export_provenance` builds the response from this tuple, and
#: :data:`app.main.CORS_EXPOSE_HEADERS` publishes it in
#: ``Access-Control-Expose-Headers``.
#:
#: The CORS half is not a formality. Exactly seven response headers are
#: CORS-safelisted, and none of these is among them, so a browser on a
#: different origin from the API — the shape ``ApiConfig.IS_REMOTE_BACKEND``
#: exists for — gets ``null`` from ``response.headers.get(...)`` for every one
#: of them. That failure is SILENT and indistinguishable from "the server did
#: not send it", which for these particular headers means the honesty signals
#: this route exists to carry (whether the served bytes match the recorded
#: digest, and whether that digest can be checked against the original at all)
#: vanish with no error anywhere.
EXPORT_PROVENANCE_HEADERS: tuple[str, ...] = (
    "X-Content-Sha256",
    "X-Content-Sha256-Stored",
    "X-Content-Sha256-Match",
    "X-Digest-Verifiable",
    "X-Body-Source",
    "X-Claude-Session-Id",
    "X-Tenant-Source",
)


# ────────────────────────── scope & principal ──────────────────────────


async def _resolve_org_scope(db: AsyncSession, user: User) -> UUID | None:
    """Derive the caller's ORGANIZATION scope — and nothing else.

    Returns the principal's personal-organization id, or ``None`` for the NULL
    bucket (a real scope, folded onto the nil UUID by the read predicate
    ``crud._org_scope``, not an error).

    **Read the name literally: this resolves the ORG axis, not tenancy.** The
    plan-library's ``_resolve_org_id`` is the function this one deliberately
    is not a copy of in effect — there, the personal organization is the only
    ownership axis and deriving it from the caller is correct. Here there is a
    second axis, ``tenant_id``, naming the coord tenant a session ran against,
    and plan §3.6 rule 1 forbids deriving THAT from the caller: a shared-tenant
    session filed under the operator's personal org is a misattribution with no
    signal that it happened. Tenancy therefore arrives as data on the upsert,
    carrying ``tenant_source`` to say how it was established. Nothing in this
    module reads a tenant off the principal.

    Failure fails CLOSED with a 503. A statement timeout or pool blip during
    the org read would otherwise be indistinguishable from genuine absence and
    would silently write the session into the shared NULL bucket — invariant 6
    ("unavailable is UNKNOWN, never empty") applied to authorization scope.
    """
    try:
        org = await resolve_personal_organization(db, user.id)
    except Exception as exc:  # noqa: BLE001 — re-raised as 503 below
        logger.error(
            "session_repository.org_scope_lookup_failed",
            user_id=str(user.id),
            error=str(exc),
            detail="failing closed rather than scoping to the NULL bucket",
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Could not resolve the caller's organization scope. This is a "
                "transient dependency failure, not an authorization decision "
                "— retry. (Proceeding would scope this request to the shared "
                "NULL organization bucket.)"
            ),
        ) from exc

    if org is None:
        logger.info(
            "session_repository.no_personal_organization",
            user_id=str(user.id),
            detail="scoping this caller to the NULL organization bucket",
        )
        return None
    # ``Organization`` is a legacy-style model, so mypy types ``id`` as
    # ``Column[UUID]`` rather than ``UUID`` — the same cast plan_library makes.
    return org.id  # type: ignore[return-value]


# ──────────────────────────── object store ─────────────────────────────


def _body_object_key(
    *, org_id: UUID | None, claude_session_id: str, account_label: str | None
) -> str:
    """The DETERMINISTIC key for one session's archived JSONL.

    Deterministic rather than uuid-suffixed on purpose: the backfill is
    idempotent over 8,238 files and re-POSTs every row, so a fresh key per
    write would leave an orphaned object behind on every re-run and make the
    archive's size a function of how many times it was scanned.

    The account home and the session id are here because they ARE the row's
    identity: that is what makes two account homes holding the same session id
    (a legitimate outcome of a resume rotation) two objects rather than one
    overwriting the other.

    The organization is here for a DIFFERENT reason, and the difference is
    worth stating because the row's identity no longer carries one. Namespacing
    the object by the capturing organization means a cross-organization re-POST
    of the same session writes a NEW object and leaves the previous
    organization's archived bytes intact and recoverable, instead of
    overwriting them. The head row is single and identity-addressed; the bytes
    behind it are not worth making destructible to match.
    """
    org = str(org_id) if org_id is not None else "no-org"
    label = _KEY_SAFE.sub("-", account_label or "default").strip("-.") or "default"
    stem = _KEY_SAFE.sub("-", claude_session_id).strip("-.") or "session"
    return f"{_BODY_PREFIX}/{org}/{label}/{stem[:200]}.jsonl"


async def _store_body(key: str, data: bytes) -> None:
    """Write the archived bytes.

    ``object_storage`` is a synchronous, blocking client (botocore, or plain
    file IO on the local backend). Called inline it would stall the event loop
    for the whole upload — a 4 MB p99 body on an S3 round trip — so it runs on
    a worker thread.
    """
    prefix, _, filename = key.rpartition("/")
    await asyncio.to_thread(
        object_storage.upload_bytes,
        data,
        prefix,
        filename,
        "application/x-ndjson",
        None,
        False,
    )


async def _load_body(key: str) -> bytes:
    """Read the archived bytes back. Blocking client → worker thread."""
    return await asyncio.to_thread(object_storage.download_file, key)


async def _load_body_or_none(row: SessionArtifact) -> tuple[bytes | None, str | None]:
    """The body, or ``(None, reason)`` — never ``(None, None)``.

    Two failures are genuinely different and both must be nameable: a row that
    has no ``body_object_key`` at all (the archiver's metadata-only promotion
    for a machine that never uploaded) and a key whose object could not be
    read. Collapsing them into an empty body would render a storage outage as
    "this session was empty".
    """
    if not row.body_object_key:
        return None, (
            "This row carries no body: it is a metadata-only head row. The "
            "runner is the sole writer of archived bytes (plan §5), so a "
            "session whose machine never uploaded has lifecycle and "
            "attribution here but no transcript."
        )
    try:
        return await _load_body(row.body_object_key), None
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — surfaced as a stated reason
        logger.error(
            "session_repository.body_read_failed",
            artifact_id=str(row.id),
            object_key=row.body_object_key,
            error=str(exc),
        )
        return None, f"The archived body could not be read from storage: {exc}"


# ─────────────────────────── transcript decode ──────────────────────────


def _flatten_content(content: Any) -> str | None:
    """Flatten a Claude Code message ``content`` into readable text.

    Non-text blocks are SUMMARISED in place (``[tool_use: Bash]``) rather than
    dropped. A turn that was three tool calls and no prose is a real turn, and
    returning it as empty text would misreport what the session did.
    """
    if content is None:
        return None
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return json.dumps(content, ensure_ascii=False)

    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
            continue
        if not isinstance(block, dict):
            parts.append(json.dumps(block, ensure_ascii=False))
            continue
        kind = block.get("type")
        if kind == "text" and isinstance(block.get("text"), str):
            parts.append(block["text"])
        elif kind == "thinking" and isinstance(block.get("thinking"), str):
            parts.append(block["thinking"])
        elif kind == "tool_use":
            parts.append(f"[tool_use: {block.get('name') or 'unknown'}]")
        elif kind == "tool_result":
            parts.append("[tool_result]")
        else:
            parts.append(f"[{kind or 'block'}]")
    return "\n".join(p for p in parts if p) or None


def _transcript_lines(raw: bytes) -> list[tuple[int, bytes]]:
    """``(1-based line number, line)`` for every NON-BLANK line.

    Blank lines are skipped because they are file structure, not turns, but
    the original line number is carried so a decoded turn can still be pointed
    back at its place in the file.
    """
    out: list[tuple[int, bytes]] = []
    for lineno, line in enumerate(raw.split(b"\n"), start=1):
        if line.strip():
            out.append((lineno, line))
    return out


def _decode_turn(
    index: int, lineno: int, line: bytes, *, include_raw: bool
) -> SessionTurn:
    """Decode one JSONL line into a turn.

    A malformed line becomes an ERROR TURN, never a skipped one. This is an
    archive: a reader has to be able to see that line 4,102 did not parse,
    and a silently dropped line is indistinguishable from a session that said
    nothing there.
    """
    try:
        record = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return SessionTurn(
            index=index,
            line_number=lineno,
            parse_error=f"{type(exc).__name__}: {exc}",
        )

    if not isinstance(record, dict):
        return SessionTurn(
            index=index,
            line_number=lineno,
            parse_error=(
                f"expected a JSON object, got {type(record).__name__} — this "
                "line is not a Claude Code transcript record"
            ),
        )

    message = record.get("message")
    message = message if isinstance(message, dict) else {}
    text = _flatten_content(message.get("content"))
    if text is None and isinstance(record.get("summary"), str):
        # ``type: "summary"`` records carry their text at the top level.
        text = record["summary"]

    def _str_or_none(value: Any) -> str | None:
        return value if isinstance(value, str) else None

    return SessionTurn(
        index=index,
        line_number=lineno,
        type=_str_or_none(record.get("type")),
        role=_str_or_none(message.get("role")),
        uuid=_str_or_none(record.get("uuid")),
        parent_uuid=_str_or_none(record.get("parentUuid")),
        timestamp=_str_or_none(record.get("timestamp")),
        text=text,
        raw=record if include_raw else None,
    )


def _decode_turns(
    raw: bytes, *, offset: int, limit: int, include_raw: bool
) -> tuple[list[SessionTurn], int]:
    """A page of decoded turns plus the transcript's total turn count.

    Only the requested window is decoded. Counting the lines is a cheap scan;
    parsing every record of a 4 MB transcript to hand back twenty of them is
    the cost this route exists to avoid.
    """
    lines = _transcript_lines(raw)
    window = lines[offset : offset + limit]
    turns = [
        _decode_turn(offset + i, lineno, line, include_raw=include_raw)
        for i, (lineno, line) in enumerate(window)
    ]
    return turns, len(lines)


def _turn_index(raw: bytes, *, limit: int) -> tuple[list[SessionTurnIndexEntry], int]:
    """A bounded index of turns for the detail read, plus the total."""
    turns, total = _decode_turns(raw, offset=0, limit=limit, include_raw=False)
    entries = [
        SessionTurnIndexEntry(
            index=t.index,
            line_number=t.line_number,
            type=t.type,
            role=t.role,
            timestamp=t.timestamp,
            preview=(t.text[:_PREVIEW_CHARS] if t.text else None),
            parse_error=t.parse_error,
        )
        for t in turns
    ]
    return entries, total


def _digest_verifiable(row: SessionArtifact) -> bool:
    """Whether this row's ``content_sha256`` can be checked against the ORIGINAL.

    True only for ``disk_verbatim`` bytes carrying a digest. A
    ``coord_redacted`` body came through coord's transcript stream, which ran
    ``redact_secrets`` unconditionally on the way in, so its digest describes
    the redacted bytes and can never be compared with the transcript on disk.
    Presenting that digest as a verification is the exact dishonesty plan §5
    added ``body_source`` to prevent.
    """
    return row.body_source == "disk_verbatim" and bool(row.content_sha256)


def _export_provenance(
    row: SessionArtifact,
    *,
    served_digest: str,
    stored_digest: str,
    matches: bool,
) -> dict[str, str]:
    """The export's provenance headers, keyed by :data:`EXPORT_PROVENANCE_HEADERS`.

    Built here rather than inline in the route so the names have exactly one
    spelling: the tuple is what CORS publishes, and a header emitted under a
    name that is not in it would be unreadable cross-origin with nothing to
    catch it. ``test_session_repository_export_headers.py`` asserts the two
    agree, which is only meaningful because this function is the sole producer.
    """
    return {
        "X-Content-Sha256": served_digest,
        "X-Content-Sha256-Stored": stored_digest or "none",
        "X-Content-Sha256-Match": "true" if matches else "false",
        "X-Digest-Verifiable": "true" if _digest_verifiable(row) else "false",
        "X-Body-Source": row.body_source or "unknown",
        "X-Claude-Session-Id": row.claude_session_id,
        "X-Tenant-Source": row.tenant_source,
    }


def _summary(row: SessionArtifact) -> SessionArtifactSummary:
    return SessionArtifactSummary.model_validate(row)


# ─────────────────── coord-owned signals (HTTP only) ────────────────────


async def _coord_outstanding(request: Request, *, actor_kind: ActorKind) -> CoordSignal:
    """coord's outstanding-work ledger, or an explicit UNKNOWN.

    Read over coord's HTTP API (invariant 5) — nothing here touches coord's
    Postgres schema. Every failure degrades to ``available=False`` with the
    reason NAMED, because ``GET /unfinished`` exists to report unfinished work
    and silently returning coord's half as empty would report an outage as
    "nothing outstanding" (invariant 6).

    A DEVICE caller is answered without a round trip. coord's
    session-compliance routes are OPERATOR doors: they resolve a tenant from a
    Cognito ``OperatorContext`` and reject a device JWT, exactly as
    ``plan_library._soft_tenant_id`` documents for the identity door. Issuing
    a request whose only possible outcome is a rejection would put a
    guaranteed-failing coord round trip on a 5s budget in front of every
    runner-originated read, and the honest answer — "this credential cannot
    reach that door" — is already known here.
    """
    if actor_kind == "device":
        return CoordSignal(
            available=False,
            unavailable_reason=(
                "This request authenticated with a coord device JWT. coord's "
                "session-compliance routes are operator doors that resolve a "
                "tenant from a Cognito operator context and reject a device "
                "credential, so the ledger was not read. This is UNKNOWN, not "
                "an empty ledger."
            ),
        )

    try:
        tenant_id = await get_tenant_id(request)
    except Exception as exc:  # noqa: BLE001 — a degraded read, never a 403
        logger.info(
            "session_repository.coord_tenant_unresolved",
            error=str(exc),
        )
        return CoordSignal(
            available=False,
            unavailable_reason=(
                f"The caller's coord tenant could not be resolved ({exc}), so "
                "the outstanding-work ledger was not read. This is UNKNOWN, "
                "not an empty ledger."
            ),
        )

    try:
        payload = await _proxy_coord_get(
            "/coord/session-compliance/outstanding", tenant_id=tenant_id
        )
    except Exception as exc:  # noqa: BLE001 — a degraded read, never a 502
        logger.info("session_repository.coord_outstanding_failed", error=str(exc))
        return CoordSignal(
            available=False,
            unavailable_reason=(
                f"coord's outstanding-work ledger could not be read ({exc}). "
                "This is UNKNOWN, not an empty ledger."
            ),
        )

    return CoordSignal(available=True, payload=payload)


# ───────────────────────────── reads ─────────────────────────────


@router.get(
    "",
    response_model=SessionArtifactListResponse,
    summary="List archived Claude Code sessions",
)
async def list_sessions(
    account: str | None = Query(
        None, description="Exact match on the account home's label"
    ),
    repo: str | None = Query(None, description="Exact match on the recorded repo"),
    session_state: str | None = Query(
        None,
        alias="state",
        description="open | closed | abandoned",
    ),
    closeout_state: str | None = Query(
        None, description="clean | unfinished | unknown"
    ),
    tenant_id: UUID | None = Query(
        None, description="The coord tenant the session ran against"
    ),
    tenant_source: str | None = Query(
        None,
        description="How the tenant was established: declared | derived_repo | "
        "derived_sole_binding | ambiguous | unknown. Filterable because plan "
        "§3.6 rule 2 requires a GUESSED attribution to be separable from a "
        "declared one rather than rendering identically to it.",
    ),
    body_source: str | None = Query(
        None,
        description="disk_verbatim | coord_redacted. A coord_redacted body's "
        "digest can never be verified against the original transcript.",
    ),
    machine_id: str | None = Query(None, description="Exact match on machine_id"),
    work_unit_slug: str | None = Query(
        None,
        description="Soft link to a coord work unit. Never resolved; a slug "
        "with no matching work unit simply returns its sessions.",
    ),
    has_secret_findings: bool | None = Query(
        None,
        description="Audit filter over the Phase 1 detector's output. It "
        "selects rows — it never hides them, and it never masks a body.",
    ),
    secret_finding_kind: str | None = Query(
        None, description="Sessions whose secret_finding_kinds contains this kind"
    ),
    detector_ran: bool | None = Query(
        None,
        description="true = the detector ran (kinds is non-NULL, possibly "
        "empty); false = it never ran. The two are deliberately distinct: an "
        "unscanned row is not a clean one.",
    ),
    since: datetime | None = Query(
        None,
        description="Only sessions with last_activity_at at/after this "
        "timestamp. A row with no recorded activity is excluded.",
    ),
    q: str | None = Query(
        None,
        description="Full-text query over the title, session name and the "
        "first/last prompts",
    ),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> SessionArtifactListResponse:
    """A filtered page of archived sessions.

    Every row carries ``tenant_source`` and ``body_source`` so a consumer can
    render a guessed attribution and a non-verifiable digest as the weaker
    things they are (invariant 3).
    """
    org_id = await _resolve_org_scope(db, current_user)
    rows, total = await crud.list_artifacts(
        db,
        org_id=org_id,
        account=account,
        repo=repo,
        state=session_state,
        closeout_state=closeout_state,
        tenant_id=tenant_id,
        tenant_source=tenant_source,
        body_source=body_source,
        machine_id=machine_id,
        work_unit_slug=work_unit_slug,
        has_secret_findings=has_secret_findings,
        secret_finding_kind=secret_finding_kind,
        detector_ran=detector_ran,
        since=since,
        q=q,
        offset=offset,
        limit=limit,
    )
    return SessionArtifactListResponse(
        items=[_summary(r) for r in rows], total=total, offset=offset, limit=limit
    )


# NOTE: declared BEFORE ``/{artifact_id}`` so the literal path wins the match.
@router.get(
    "/unfinished",
    response_model=SessionUnfinishedResponse,
    summary="Sessions that were never closed out",
)
async def list_unfinished_sessions(
    request: Request,
    account: str | None = Query(None, description="Exact match on account label"),
    repo: str | None = Query(None, description="Exact match on the recorded repo"),
    since: datetime | None = Query(
        None, description="Only sessions active at/after this timestamp"
    ),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_async_db),
    principal: ActorPrincipal = Depends(get_audit_actor_principal),
) -> SessionUnfinishedResponse:
    """ "Which sessions were never closed out?" — the capability plan §3.4
    names, answered from the DERIVED ``closeout_state`` column.

    Two things this route refuses to do, both because they would turn a
    reporting surface into a reassuring one:

    * **It does not merge the ``unknown`` bucket into the answer.**
      ``closeout_state`` defaults to ``unknown`` — "nobody has evaluated this
      session" — which is not evidence of clean closeout. It is reported as
      its own count beside the results, so an empty ``items`` next to a large
      ``unknown_count`` reads as "the derivation has not run" rather than
      "everything is fine".

    * **It does not silently drop coord's half.** coord's outstanding-work
      ledger is attached as a signal that degrades to ``available=False`` with
      a stated reason (invariant 6).
    """
    org_id = await _resolve_org_scope(db, principal.user)
    rows, total = await crud.list_artifacts(
        db,
        org_id=org_id,
        account=account,
        repo=repo,
        since=since,
        closeout_state="unfinished",
        offset=offset,
        limit=limit,
    )
    counts = await crud.closeout_state_counts(db, org_id=org_id)
    coord_signal = await _coord_outstanding(request, actor_kind=principal.kind)

    return SessionUnfinishedResponse(
        items=[_summary(r) for r in rows],
        total=total,
        offset=offset,
        limit=limit,
        unknown_count=counts.get("unknown", 0),
        clean_count=counts.get("clean", 0),
        coord_outstanding=coord_signal,
    )


@router.get(
    "/{artifact_id}",
    response_model=SessionArtifactDetail,
    summary="One archived session — head row plus its turn index",
)
async def get_session(
    artifact_id: UUID,
    include_turn_index: bool = Query(
        True,
        description="Decode a bounded index of turns from the archived body. "
        "Set false to read the head row alone; the response then reports "
        "turn_index_state='not_requested' rather than an empty list, because "
        "'we did not look' is not 'there are no turns'.",
    ),
    turn_index_limit: int = Query(
        _TURN_INDEX_DEFAULT_LIMIT,
        ge=1,
        le=2000,
        description="Ceiling on indexed turns. Truncation is reported via "
        "turn_index_state='truncated', never applied silently.",
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> SessionArtifactDetail:
    """The head row, with a bounded index of the transcript's turns.

    The index is bounded and its state is explicit for the same reason
    ``/turns`` exists at all: a transcript's p99 is 4 MB, and a detail read
    that returns the whole thing is unusable by the agents this repository is
    built for.
    """
    org_id = await _resolve_org_scope(db, current_user)
    row = await crud.get_artifact(db, artifact_id, org_id=org_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session artifact not found: {artifact_id}",
        )

    # ``model_validate`` off the ORM row rather than re-parsing a dumped
    # summary: the summary's datetimes serialize to ISO strings, and a
    # round trip through them is a lossy step this read has no reason to take.
    detail = SessionArtifactDetail.model_validate(row)
    detail.digest_verifiable = _digest_verifiable(row)

    if not include_turn_index:
        detail.turn_index_state = "not_requested"
        return detail

    raw, reason = await _load_body_or_none(row)
    if raw is None:
        detail.turn_index_state = "unavailable"
        detail.turn_index_unavailable_reason = reason
        return detail

    entries, decoded_total = _turn_index(raw, limit=turn_index_limit)
    detail.turn_index = entries
    detail.decoded_turn_count = decoded_total
    detail.turn_index_state = "truncated" if decoded_total > len(entries) else "present"
    return detail


@router.get(
    "/{artifact_id}/turns",
    response_model=SessionTurnsResponse,
    summary="A page of decoded turns from an archived session",
)
async def list_session_turns(
    artifact_id: UUID,
    from_: int = Query(
        0,
        alias="from",
        ge=0,
        description="Zero-based turn index to start at",
    ),
    limit: int = Query(50, ge=1, le=500),
    include_raw: bool = Query(
        False,
        description="Include each record's full parsed JSON. Off by default: "
        "returning every raw record would hand back the same megabytes this "
        "route exists to avoid.",
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> SessionTurnsResponse:
    """Paged, decoded turns — for the UI, and for agents that must not swallow
    a 4 MB body.

    Only the requested window is parsed. Malformed lines come back as turns
    carrying ``parse_error`` rather than being skipped, so a gap in the
    archive is visible instead of looking like silence.
    """
    org_id = await _resolve_org_scope(db, current_user)
    row = await crud.get_artifact(db, artifact_id, org_id=org_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session artifact not found: {artifact_id}",
        )

    raw, reason = await _load_body_or_none(row)
    if raw is None:
        # 409 rather than 404: the SESSION exists and this read is about its
        # body. A 404 here would say "no such session", which is false and
        # would send a caller looking for the wrong problem.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=reason)

    turns, total = _decode_turns(
        raw, offset=from_, limit=limit, include_raw=include_raw
    )
    return SessionTurnsResponse(
        session_artifact_id=row.id,
        claude_session_id=row.claude_session_id,
        items=turns,
        total=total,
        offset=from_,
        limit=limit,
        body_source=row.body_source,
        digest_verifiable=_digest_verifiable(row),
    )


@router.get(
    "/{artifact_id}/export",
    summary="The archived JSONL, byte-verbatim",
    response_class=Response,
    responses={
        200: {
            "content": {"application/x-ndjson": {}},
            "description": "The stored transcript, byte-for-byte.",
        },
        404: {"description": "No such session artifact."},
        409: {"description": "The session has no archived body."},
    },
)
async def export_session(
    artifact_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> Response:
    """One session's transcript, back out as the JSONL it came from.

    **The bytes are emitted verbatim** — no re-encoding, no normalisation.
    Fidelity is the product: a ``disk_verbatim`` archive is supposed to hash
    to the same digest as the file the runner read.

    Three headers carry the provenance, and the distinction between them is
    the whole point:

    ``X-Content-Sha256``
        The digest of the bytes ON THIS RESPONSE, recomputed here. It is
        always a true statement about what was sent.
    ``X-Content-Sha256-Stored``/``X-Content-Sha256-Match``
        The digest recorded on the row, and whether it agrees. Plan §3's exit
        criterion is that no row carries a digest that fails to verify against
        its stored body; recomputing on export is what turns that criterion
        into an enforced, observable property instead of a one-off audit.
    ``X-Digest-Verifiable``
        Whether the digest can be checked against the ORIGINAL transcript at
        all. ``false`` for a ``coord_redacted`` body, whose bytes passed
        through ``redact_secrets`` on the way into coord's stream — a digest
        over redacted bytes can never be compared with the file on disk, and
        presenting it as a verification would be a lie the caller has no way
        to detect (plan §5).
    """
    org_id = await _resolve_org_scope(db, current_user)
    row = await crud.get_artifact(db, artifact_id, org_id=org_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session artifact not found: {artifact_id}",
        )

    raw, reason = await _load_body_or_none(row)
    if raw is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=reason)

    served_digest = crud.compute_content_sha256(raw)
    stored_digest = row.content_sha256 or ""
    matches = bool(stored_digest) and served_digest == stored_digest
    if stored_digest and not matches:
        # Served anyway, with the disagreement on the wire. Withholding the
        # bytes would destroy the only copy a caller can inspect; hiding the
        # mismatch would be worse still.
        logger.error(
            "session_repository.digest_mismatch",
            artifact_id=str(row.id),
            object_key=row.body_object_key,
            stored=stored_digest,
            served=served_digest,
        )

    filename = _KEY_SAFE.sub("-", row.claude_session_id).strip("-.") or "session"
    # The provenance headers are built from EXPORT_PROVENANCE_HEADERS and
    # published through CORS `Access-Control-Expose-Headers` (app.main). That
    # is load-bearing rather than housekeeping: none of them is CORS-safelisted,
    # so without the exposure a browser on a different origin from the API
    # reads `null` for every one — the same answer it gets when the header was
    # never sent, which makes the honesty signals above disappear silently.
    return Response(
        content=raw,
        media_type="application/x-ndjson",
        headers={
            "Content-Disposition": f'attachment; filename="{filename[:200]}.jsonl"',
            **_export_provenance(
                row,
                served_digest=served_digest,
                stored_digest=stored_digest,
                matches=matches,
            ),
        },
    )


# ───────────────────────────── writes ─────────────────────────────


def _decode_supplied_body(payload: SessionArtifactUpsert) -> bytes | None:
    """The archived bytes the caller supplied, or ``None``.

    ``body_base64`` is decoded to the EXACT bytes; ``body`` is encoded as
    UTF-8. Both paths end at bytes before anything is hashed, because a digest
    over a decoded string is a digest over whatever encoding happened to be in
    force at that moment — which is precisely the ambiguity ``content_sha256``
    exists to remove.
    """
    if payload.body_base64 is not None:
        try:
            return base64.b64decode(payload.body_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"body_base64 is not valid base64: {exc}",
            ) from exc
    if payload.body is not None:
        return payload.body.encode("utf-8")
    return None


@router.post(
    "",
    response_model=SessionArtifactUpsertResponse,
    summary="Upsert an archived session by (session id, account home)",
)
async def upsert_session(
    payload: SessionArtifactUpsert,
    response: Response,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_audit_actor_user),
) -> SessionArtifactUpsertResponse:
    """Insert or update one session head row, and archive its bytes.

    **This is the runner's PRIMARY door, not a fallback** (plan §5). The runner
    holds the verbatim transcript and is the sole writer of
    ``body_object_key`` + ``content_sha256``; the web archiver uses the same
    route for metadata promotion. Both are authenticated by
    :func:`~app.api.deps.get_audit_actor_user`, which accepts the device JWT
    the runner actually holds — see invariant 7 for why a Cognito-only door
    here would leave the corpus permanently empty.

    **Omitted fields are left alone.** With two writers on one row, treating an
    absent field as ``NULL`` would have the archiver's next metadata pass erase
    the runner's archived body. Only fields present in the request are written
    (``model_fields_set`` → ``crud.UPSERTABLE_COLUMNS``).

    ``organization_id`` is not a field on the payload and is not in the
    upsertable column set — it comes from the principal (invariant 1), and
    ``tenant_id`` deliberately does NOT (invariant 2).

    **The row is addressed by ``(claude_session_id, account_label)``, without
    the organization.** So a session the web archiver already promoted
    org-less is UPDATED here, not duplicated, and this authenticated write is
    what finally scopes it: ``crud.upsert_artifact`` fills the organization in
    on a row that has none, and never moves a row that already has one.
    """
    org_id = await _resolve_org_scope(db, current_user)

    supplied = payload.model_fields_set
    fields: dict[str, Any] = {
        name: getattr(payload, name)
        for name in supplied
        if name in crud.UPSERTABLE_COLUMNS
    }

    raw = _decode_supplied_body(payload)
    body_written = False
    if raw is not None:
        computed = crud.compute_content_sha256(raw)
        if payload.content_sha256 is not None and payload.content_sha256 != computed:
            # The caller's digest disagrees with its own bytes. Trusting it
            # would let a stale or forged hash label the wrong content as
            # verified — and this corpus's entire verifiability claim rests on
            # that digest meaning one thing.
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "content_sha256 does not match sha256(body): "
                    f"supplied={payload.content_sha256} computed={computed}"
                ),
            )
        key = _body_object_key(
            org_id=org_id,
            claude_session_id=payload.claude_session_id,
            account_label=payload.account_label,
        )
        try:
            await _store_body(key, raw)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 — surfaced as a 502
            logger.error(
                "session_repository.body_write_failed",
                claude_session_id=payload.claude_session_id,
                object_key=key,
                error=str(exc),
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "The archived body could not be written to object "
                    f"storage ({exc}). NOTHING was recorded — a head row "
                    "pointing at bytes that are not there would claim an "
                    "archive this store does not hold."
                ),
            ) from exc

        # The server owns these three, always. A caller cannot name the key it
        # was stored under, cannot supply the digest of record, and cannot
        # declare a byte count that disagrees with the object.
        fields["body_object_key"] = key
        fields["content_sha256"] = computed
        fields["byte_count"] = len(raw)
        body_written = True

    row, created, changed = await crud.upsert_artifact(
        db,
        org_id=org_id,
        claude_session_id=payload.claude_session_id,
        account_label=payload.account_label,
        fields=fields,
    )

    if row.content_sha256:
        response.headers["ETag"] = f'"{row.content_sha256}"'
    if created:
        response.status_code = status.HTTP_201_CREATED
    elif not changed:
        # The idempotent re-scan case: 8,238 transcripts get re-POSTed on
        # every backfill run, and the caller needs to tell "already archived"
        # from "took a new revision" without diffing the row itself.
        response.headers["X-Session-Unchanged"] = "true"

    return SessionArtifactUpsertResponse(
        created=created,
        changed=changed,
        body_written=body_written,
        artifact=_summary(row),
    )


@router.post(
    "/{artifact_id}/relaunch",
    response_model=SessionRelaunchResponse,
    summary="Relaunch a session — as a resume, or as a transfer",
)
async def relaunch_session(
    artifact_id: UUID,
    payload: SessionRelaunchRequest,
    db: AsyncSession = Depends(get_async_db),
    tenant_id: UUID = Depends(require_coord_tenant_admin),
    current_user: User = Depends(current_active_user),
) -> SessionRelaunchResponse:
    """Bring a session back, with the tier stated honestly (plan §3.5).

    Two genuinely different operations, deliberately not one:

    ``mode="resume"`` → tier ``full``
        Dispatched through the SHIPPED ``POST /sessions/:id/handoff`` subject,
        which coord already records as a durable ``handoff_request`` event and
        publishes to the target machine, where ``session/handoff.rs``
        re-acquires claims and replays warm-tier scrollback into a new PTY.
        **No new spawn channel is built here** — the plan is explicit that one
        must not be.

    ``mode="transfer"`` → tier ``replay_as_context``
        NOT a resume, and never reported as one. Claude Code cannot resume
        another account's session id: the transcript is account-scoped. What
        this returns is what the shipped ``resume-foreign`` skill does by hand
        — the trailing turns rendered as context for a NEW session, plus the
        two notices that make the seam visible. ``dispatched`` is ``false``,
        because nothing was dispatched; claiming otherwise would let a UI
        present a context replay as a restored conversation and silently lose
        every bit of state after the transcript's last line.

    Admin-gated where every other route here is dual-auth (invariant 7): this
    is the only route that acts on the fleet rather than on the archive, and
    the shipped handoff proxy it reuses gates the same way.
    """
    org_id = await _resolve_org_scope(db, current_user)
    row = await crud.get_artifact(db, artifact_id, org_id=org_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session artifact not found: {artifact_id}",
        )

    common: dict[str, Any] = {
        "session_artifact_id": row.id,
        "claude_session_id": row.claude_session_id,
        "coord_session_id": row.coord_session_id,
        "account_label": row.account_label,
        "config_dir": row.config_dir,
        "working_dir": row.working_dir,
        "launch_command": row.launch_command,
    }

    if payload.mode == "transfer":
        raw, reason = await _load_body_or_none(row)
        context: list[SessionTurn] | None = None
        ended = (
            row.last_activity_at.isoformat()
            if row.last_activity_at
            else "an unrecorded time"
        )
        notices = [
            "This is a TRANSFER, not a resume: Claude Code cannot resume "
            "another account's session id, because the transcript is "
            "account-scoped. The turns below are replay CONTEXT for a NEW "
            "session.",
            f"The transcript ended at {ended}; state after that point is "
            "unknown. Do not auto-continue the replayed context — read it, "
            "then decide.",
        ]
        if raw is None:
            notices.append(f"No replay context is available: {reason}")
        else:
            total = len(_transcript_lines(raw))
            start = max(0, total - payload.context_turns)
            context, _ = _decode_turns(
                raw, offset=start, limit=payload.context_turns, include_raw=False
            )
        return SessionRelaunchResponse(
            mode="transfer",
            restore_tier="replay_as_context",
            dispatched=False,
            context_turns=context,
            notices=notices,
            **common,
        )

    if row.coord_session_id is None:
        # Expected, not exceptional: coord's `prune_closed_sessions` deletes a
        # closed session after 7 days (plan §2.2), which is the whole reason
        # this archive exists. The row survives; the handoff subject does not.
        # The response names what is missing AND hands back everything needed
        # to relaunch by hand, rather than a bare failure.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "no_coord_session",
                "message": (
                    "This session has no live coord session id, so there is "
                    "no handoff subject to dispatch to. That is the expected "
                    "state for any session coord has already pruned (closed "
                    "sessions are deleted after 7 days) — the archive "
                    "outlives the coordination record by design. Relaunch it "
                    "directly with the recorded launch parameters."
                ),
                "claude_session_id": row.claude_session_id,
                "account_label": row.account_label,
                "config_dir": row.config_dir,
                "working_dir": row.working_dir,
                "launch_command": row.launch_command,
            },
        )

    if payload.target_device_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "target_device_id is required for mode='resume': the handoff "
                "subject is scoped to the machine that will materialize the "
                "session, and there is no defensible default for which "
                "machine that is."
            ),
        )

    body: dict[str, Any] = {"target_device_id": str(payload.target_device_id)}
    if payload.reason is not None:
        body["reason"] = payload.reason

    coord_response = await _proxy_coord_post(
        f"/sessions/{row.coord_session_id}/handoff", body, tenant_id=tenant_id
    )

    return SessionRelaunchResponse(
        mode="resume",
        restore_tier="full",
        dispatched=True,
        target_device_id=payload.target_device_id,
        coord_response=coord_response,
        notices=[
            "Dispatched through the shipped handoff subject: the target "
            "runner materializes the session and replays warm-tier "
            "scrollback. The conversation is restored — this is the full "
            "tier, unlike a transfer."
        ],
        **common,
    )
