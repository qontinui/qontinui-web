"""Scheduled jobs — promote coord sessions into the permanent session archive.

Plan ``2026-08-26-claude-code-session-repository-in-qontinui-web``, Phase 3b.
The head-row store this fills is :mod:`app.models.session_artifact`; read that
module (and the ``session_repo_01_session_artifacts`` migration beside it) for
the column-level rationale.

Why this job exists at all
==========================

coord is an OPERATIONAL store and it DELETES the thing we want to keep. A
leader-gated task in ``qontinui-coord/src/main.rs`` (``prune_closed_sessions``,
every 5 minutes) drops closed session rows older than
``COORD_SESSION_RETENTION_DAYS`` — **default 7** — and the output/event tables
cascade with them. After that the record that the session ever existed is gone.
A repository whose purpose is "find the work I never finished" cannot live
behind a 7-day horizon, so this job copies the metadata across the seam into
qontinui-web's own ``agent.*`` corpus, which has no expiry.

METADATA ONLY — and why that is not a limitation
================================================

The drafted plan had this job source BODIES from coord's transcript stream.
Vetting killed that (plan §5, "Two ingest paths, one digest"): every byte in
that stream passed through the runner's ``redact_secrets`` unconditionally on
the way in (``session/transcript_emitter.rs`` Gate 3). Archiving from it would
put REDACTED bodies in the same corpus the runner's Phase 1 backfill fills
VERBATIM — two different digests for one session, and a ``content_sha256``
that verifies against nothing.

So the boundary is:

* **The runner is the sole writer of ``body_object_key`` + ``content_sha256``.**
  It holds the bytes on disk, it is the only component that can read them, and
  it writes them through ``POST /api/v1/session-repository``. This job NEVER
  writes a body over one the runner already wrote — see
  :func:`plan_promotions`, which refuses to emit a body for any row that
  already has a ``body_object_key``.
* **This job promotes head rows, lifecycle, ``closeout_state``, soft links and
  tenancy.** Everything that dies with the coord row and nothing else.
* **One exception — the last-chance body fallback.** For a session that is
  inside the GC danger window with NO body at all (the machine is gone and
  never uploaded), this job may fetch coord's transcript stream as a
  last-resort body. When it does it stamps ``body_source='coord_redacted'``
  so nothing downstream can present that digest as verified. The normal path
  stamps nothing at all; the runner stamps ``disk_verbatim``.

The exit criterion — *no row may carry a ``content_sha256`` that does not
verify against its stored body* — is structural here, not a review promise:
:func:`materialize_body` is the ONLY producer of a digest in this module and it
computes it over the exact bytes it hands to the object store.

HTTP ONLY — no coord SQL, ever
==============================

Web and coord share a Postgres instance, which makes a cross-schema ``SELECT``
physically possible and architecturally wrong. ``tests/`` carries a build-failing
guard (``test_coord_schema_boundary_guard.py``) that fails on a ``coord.<table>``
token in any non-docstring string literal under ``backend/app``. Every coord read
below goes over HTTP through :func:`app.api.v1.endpoints.operations._proxy_coord_get`
— the shipped door — and an unreachable coord raises :class:`CoordUnavailable`,
which the cycle reports as an explicit UNKNOWN. **A failed read is never
rendered as "no sessions".**

Coord routes read here (all bounded JSON except the fallback-only SSE reduce):

===================================================  ============================
Route                                                What it supplies
===================================================  ============================
``GET /coord/agent-sessions``                        The enumeration. The ONLY
                                                     coord surface keyed on the
                                                     Claude session UUID, which
                                                     is this corpus's identity
                                                     column.
``GET /sessions?scope=all``                          The GC-threatened rows:
                                                     tenant, task run, work
                                                     unit, lifecycle, repo.
``GET /sessions/{id}/output``                        Resolves a Claude session
                                                     id to its canonical coord
                                                     session id (coord's own
                                                     id-or-claude-id fallback
                                                     returns ``row.id``), and
                                                     says whether coord holds
                                                     any transcript bytes. Two
                                                     load-bearing answers per
                                                     call, not a body read.
``GET /coord/session-compliance/sessions``           Closeout signals 1 + 2.
``GET /coord/session-compliance/outstanding``        Closeout signal 3.
``GET /sessions/{id}/events`` (fallback path only)   The restore record.
===================================================  ============================

There is deliberately NO route here that maps a coord session id BACK to a
Claude session id — coord serves none, which is why the enumeration runs from
the agent-sessions side and joins forward through the output probe.

The restore-record read is on the fallback path only, on purpose: it is an SSE
stream with a per-session first-line deadline, so paying it for every promoted
row would cost N x seconds and hold N upstream streams — and its fields
(``config_dir``/``launch_command``/``restore_tier``/``machine_id``) are ones the
runner holds FIRST-HAND and writes through its own door. The one case where the
runner will never write them is exactly the case the fallback exists for.

Consent (plan §3.7)
===================

Archiving is gated per tenant and defaults OFF. With no tenant consented the
job is INERT — it makes no coord call, writes nothing, and coord's existing
horizons are the only behaviour, i.e. today's behaviour bit for bit. The gate
is enforced PER ROW (:func:`plan_promotions` skips a session whose tenant is
not consented) rather than only per credential, so a credential that can see
more than it should still cannot widen what gets archived.

The known race — stated, not papered over
=========================================

This job POLLS. A coord outage longer than the retention window loses those
sessions from coord permanently, and no poll can recover them. The mitigation
is that the on-disk JSONL stays authoritative until archived, so the runner's
backfill scanner can always recover a session this job missed. What this module
owes that race is VISIBILITY: every cycle counts the sessions it observed inside
the GC danger window and did NOT archive, and logs them at WARNING with the
oldest one named (``session_archive_gc_horizon_at_risk``). A silent miss is the
failure mode; a loud, countable one is recoverable.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.session_artifact import SessionArtifact

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Configuration.
#
# Read from the environment IN PLACE rather than through `app.core.config`,
# matching `app.core.scheduler`'s own kill-switch idiom: these are operator
# dials for one job, not application settings, and keeping them here keeps the
# job's whole contract readable in one file.
# ---------------------------------------------------------------------------

#: Per-tenant consent — the seat of plan §3.7's ``session_archive_enabled``.
#: A comma-separated list of tenant UUIDs. **Empty (the default) means the job
#: is inert.** Consent is per tenant because the corpus is: one tenant opting
#: in must not archive another's sessions.
#:
#: This lives web-side rather than in coord's tenant-policy row because the web
#: backend is the component that does the archiving and must be able to answer
#: "am I allowed to" without a coord round-trip that could itself be the thing
#: that is down. When coord's policy row grows the flag, :func:`consented_tenants`
#: gains it as a second source; it does not move.
ENV_CONSENTED_TENANTS = "QONTINUI_SESSION_ARCHIVE_TENANTS"

#: An explicit coord bearer for this job, when the deployment provisions one
#: (an operator or device JWT). Unset falls through to a coord-minted service
#: token — see :func:`_resolve_bearer`.
ENV_COORD_TOKEN = "QONTINUI_SESSION_ARCHIVE_COORD_TOKEN"

#: Mirror of coord's own ``COORD_SESSION_RETENTION_DAYS``. This job does not
#: control the horizon — it races it — so the value must track coord's, and a
#: mismatch only ever makes this job MORE eager, never less.
ENV_RETENTION_DAYS = "COORD_SESSION_RETENTION_DAYS"

#: coord's default when the variable is unset (``qontinui-coord/src/main.rs``).
DEFAULT_RETENTION_DAYS = 7

#: How close to the GC horizon counts as "at risk". A session closed longer ago
#: than ``retention - grace`` is inside the danger window: the fallback may fire
#: for it, and if it is still unarchived at the end of the cycle it is counted
#: and logged. Two days is ~48 hourly cycles of slack against a 7-day horizon.
GC_GRACE_DAYS = 2

#: How far back a cycle scans. Slightly WIDER than the retention window on
#: purpose: coord's own prune is leader-gated and runs on its own cadence, so
#: rows a little past the nominal horizon can still be there, and a row we can
#: still see is a row we can still save.
SCAN_SLACK_DAYS = 1

#: Per-cycle promotion budget. Bounds the output probe's request count. The
#: candidate list is ordered nearest-the-horizon-first, so a cycle that hits the
#: budget still spends it on the sessions with the least time left.
PROMOTION_BUDGET = 250

#: Per-cycle budget for the last-chance body fallback, which is far more
#: expensive than a metadata promotion (a full transcript fetch plus an object
#: store PUT plus an SSE reduce).
FALLBACK_BUDGET = 25

#: Coord's ``GET /coord/agent-sessions`` hard cap.
AGENT_SESSIONS_PAGE_MAX = 500

#: Coord's ``GET /coord/session-compliance/sessions`` page size we ask for.
COMPLIANCE_PAGE_SIZE = 200

#: ``sub = "service:<name>"`` on a coord-minted service token. Distinct from the
#: strategy and device-status service names so coord's audit log can tell which
#: web subsystem made a read.
SERVICE_NAME = "qontinui-web-session-archiver"

#: Object-store prefix for a fallback body. Mirrors coord's own cold-tier key
#: shape (``tenant/<tid>/session/<sid>.transcript.jsonl``) closely enough that
#: an operator reading a bucket listing recognises the two as the same content.
BODY_PREFIX = "session-archive"

#: The stamp a fallback body carries. See
#: :data:`app.models.session_artifact.SESSION_BODY_SOURCES` — this is the value
#: that keeps ``content_sha256`` honest.
BODY_SOURCE_COORD = "coord_redacted"

#: Report-item states from coord's ``policy-compliance/1`` block that mean the
#: work IS finished. Coord's vocabulary today is
#: ``landed | in_train | gated | deferred | surfaced``; these two are the
#: finished half, and everything else — including a state a future coord adds —
#: counts as OPEN.
#:
#: The list is spelled this way round ON PURPOSE. Enumerating the open states
#: instead would make an unrecognised new state read as finished, and a state
#: nobody here has heard of is exactly the case where this module must fail
#: toward ``unfinished`` rather than toward ``clean``.
FINISHED_ITEM_STATES = ("landed", "surfaced")

# Re-mint a service token this many seconds before it expires.
_TOKEN_REFRESH_BUFFER_S = 300


# ---------------------------------------------------------------------------
# Coord reads — the HTTP door, and the typed UNKNOWN it fails into.
# ---------------------------------------------------------------------------


class CoordUnavailable(RuntimeError):
    """A coord read could not be completed.

    Deliberately a distinct exception rather than an empty result: an
    unreachable coord and a coord with nothing to archive are DIFFERENT
    answers, and collapsing them would let an outage render as "no sessions
    need archiving" — the same absence-is-not-zero defect the fleet's
    ``silent-empty-is-unknown`` rule names. Every caller either propagates
    this or records it as an explicit ``coord_unavailable`` outcome.
    """


class CoordReader(Protocol):
    """The coord reads this job makes, as a seam.

    A Protocol rather than a concrete class so tests drive the promotion core
    with a fake and never touch HTTP. The live implementation is
    :class:`ProxyCoordReader`; it is the only thing in this module that knows
    coord has a network address.
    """

    async def list_agent_sessions(
        self, *, since: datetime, limit: int
    ) -> list[dict[str, Any]]:
        """Rows from ``GET /coord/agent-sessions``, keyed on the Claude id."""

    async def list_coord_sessions(self, *, since: datetime) -> list[dict[str, Any]]:
        """Rows from ``GET /sessions?scope=all`` — the GC-threatened set."""

    async def resolve_output(
        self, claude_session_id: str, *, tier: str, limit: int
    ) -> dict[str, Any] | None:
        """``GET /sessions/{id}/output`` for a Claude session id.

        Returns the envelope (whose ``session_id`` is coord's CANONICAL
        session id, resolved through coord's id-or-claude-id fallback), or
        ``None`` when coord has no such session.
        """

    async def list_compliance(self, *, limit: int) -> list[dict[str, Any]]:
        """Rows from ``GET /coord/session-compliance/sessions``."""

    async def list_outstanding(self) -> list[dict[str, Any]]:
        """Rows from ``GET /coord/session-compliance/outstanding``."""

    async def read_restore_record(
        self, claude_session_id: str
    ) -> dict[str, Any] | None:
        """The newest ``restore-record`` event payload, or ``None``."""


class ProxyCoordReader:
    """:class:`CoordReader` over the shipped web→coord HTTP proxy.

    Every method funnels through :meth:`_get`, which converts the proxy's
    ``HTTPException`` (its way of reporting a 4xx/5xx/transport failure to a
    REQUEST handler) into :class:`CoordUnavailable` — the right shape for a
    background job, which has no response to raise into.
    """

    def __init__(self, tenant_id: UUID) -> None:
        self._tenant_id = tenant_id

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        # Lazy import: the endpoints module pulls the whole API surface, and
        # this module must stay importable from the scheduler without it.
        from fastapi import HTTPException

        from app.api.v1.endpoints.operations import _proxy_coord_get

        try:
            return await _proxy_coord_get(
                path, params=params, tenant_id=self._tenant_id
            )
        except HTTPException as exc:
            raise CoordUnavailable(f"{path}: HTTP {exc.status_code}") from exc
        except Exception as exc:  # noqa: BLE001 - any transport fault is UNKNOWN
            raise CoordUnavailable(f"{path}: {exc}") from exc

    async def list_agent_sessions(
        self, *, since: datetime, limit: int
    ) -> list[dict[str, Any]]:
        payload = await self._get(
            "/coord/agent-sessions",
            {
                "since": since.astimezone(UTC).isoformat(),
                "limit": min(limit, AGENT_SESSIONS_PAGE_MAX),
            },
        )
        return _rows(payload, "sessions")

    async def list_coord_sessions(self, *, since: datetime) -> list[dict[str, Any]]:
        payload = await self._get(
            "/sessions",
            {"scope": "all", "since": since.astimezone(UTC).isoformat()},
        )
        return _rows(payload, "sessions")

    async def resolve_output(
        self, claude_session_id: str, *, tier: str, limit: int
    ) -> dict[str, Any] | None:
        try:
            payload = await self._get(
                f"/sessions/{claude_session_id}/output",
                {"stream": "transcript", "tier": tier, "limit": limit},
            )
        except CoordUnavailable as exc:
            # A 404 here is an ANSWER (coord no longer holds this session),
            # not an outage. Anything else stays UNKNOWN and propagates.
            if "HTTP 404" in str(exc):
                return None
            raise
        return payload if isinstance(payload, dict) else None

    async def list_compliance(self, *, limit: int) -> list[dict[str, Any]]:
        payload = await self._get(
            "/coord/session-compliance/sessions", {"limit": limit}
        )
        return _rows(payload, "sessions")

    async def list_outstanding(self) -> list[dict[str, Any]]:
        payload = await self._get("/coord/session-compliance/outstanding")
        return _rows(payload, "items")

    async def read_restore_record(
        self, claude_session_id: str
    ) -> dict[str, Any] | None:
        from fastapi import HTTPException

        from app.api.v1.endpoints.operations import get_coord_session_restore_record

        try:
            payload = await get_coord_session_restore_record(
                session_id=UUID(claude_session_id), tenant_id=self._tenant_id
            )
        except HTTPException:
            # The restore record is enrichment on a last-chance save. Losing it
            # must never lose the save, so this arm degrades to None rather
            # than aborting the promotion.
            return None
        except (ValueError, Exception):  # noqa: BLE001 - same degrade
            return None
        if not isinstance(payload, dict):
            return None
        record = payload.get("restore_record")
        if not isinstance(record, dict):
            return None
        inner = record.get("payload")
        return inner if isinstance(inner, dict) else None


def _rows(payload: Any, key: str) -> list[dict[str, Any]]:
    """Pull a list-of-objects out of a coord envelope, tolerantly.

    Coord wraps every list read as ``{"<key>": [...], "count": N}``. A
    non-conforming body is treated as empty rather than raising: the caller
    already distinguishes "coord answered" from "coord did not", and a shape
    surprise inside a successful answer is not an outage.
    """
    if isinstance(payload, dict):
        rows = payload.get(key)
        if isinstance(rows, list):
            return [r for r in rows if isinstance(r, dict)]
    return []


# ---------------------------------------------------------------------------
# Consent (pure).
# ---------------------------------------------------------------------------


def consented_tenants(raw: str | None) -> frozenset[UUID]:
    """Parse the per-tenant consent list. Unparseable entries are DROPPED.

    Dropping rather than raising is deliberate and is the safe direction: a
    typo'd UUID in the operator's list must narrow what gets archived, never
    widen it and never crash the scheduler tick. An empty result means the job
    is inert, which is the documented default.
    """
    if not raw:
        return frozenset()
    out: set[UUID] = set()
    for token in raw.split(","):
        candidate = token.strip()
        if not candidate:
            continue
        try:
            out.add(UUID(candidate))
        except ValueError:
            logger.warning(
                "session_archive_consent_entry_unparseable",
                entry=candidate,
                env=ENV_CONSENTED_TENANTS,
            )
    return frozenset(out)


def retention_days(raw: str | None) -> int:
    """coord's retention horizon in days, with coord's own default."""
    if raw is None or not raw.strip():
        return DEFAULT_RETENTION_DAYS
    try:
        value = int(raw.strip())
    except ValueError:
        return DEFAULT_RETENTION_DAYS
    return value if value > 0 else DEFAULT_RETENTION_DAYS


# ---------------------------------------------------------------------------
# `closeout_state` — DERIVED, RECOMPUTABLE, never hand-set (plan §3.4).
#
# Three independently-produced signals, each already shipped machinery. The
# derivation is a PURE function of the three so it can be re-run later against
# fresh signals and produce the same answer for the same inputs — which is what
# "recomputable" has to mean if the column is ever to be trusted.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ComplianceSignal:
    """Signal 1 — coord's ``session_compliance`` verdict for this session.

    ``verdict`` is coord's three-value vocabulary and only that: ``verified``
    (a POLICY_COMPLIANCE footer was emitted and every checkable claim
    reconciled against independently-observed activity), ``unverified``
    (a footer was emitted but >=1 claim did not reconcile — AND the case where
    no footer was emitted at all, which coord carries as ``reason='absent'``),
    or ``not_applicable`` (enforcement off, or the enforced clause is absent
    from the active policy document, so nothing was checked).
    """

    verdict: str | None
    reason: str | None = None
    unreconciled_count: int = 0

    @property
    def footer_absent(self) -> bool:
        """Whether coord recorded that NO footer was emitted."""
        return self.verdict == "unverified" and (self.reason or "") == "absent"


@dataclass(frozen=True)
class DispositionSignal:
    """Signal 2 — the ``/unattended`` taxonomy the session declared.

    ``item_states`` are the states of the final-state table's rows as coord
    stores them (``landed`` / ``in_train`` / ``gated`` / ``deferred`` /
    ``surfaced``). A session that closed WITHOUT any disposition at all is
    ``unknown``, not ``clean`` — declaring nothing is not the same as
    declaring everything done, and the whole point of this column is to stop
    the second being inferred from the first.
    """

    item_states: tuple[str, ...] = ()

    @property
    def declared_anything(self) -> bool:
        return bool(self.item_states)


@dataclass(frozen=True)
class OpenWorkSignal:
    """Signal 3 — open gates and unlanded PRs attributable to the session.

    ``agent_session_id`` is an FK axis across coord's gates, merge proposals,
    worktrees, claims audit and agent logs, so "attributable to the session" is
    a real join coord already maintains; the ledger route serves the reduced
    answer over HTTP.

    ``open_refs`` are outstanding items (coord's own ``deferred``/``gated``
    ledger); ``contradicted_refs`` are items the session claimed ``landed``
    that coord's independent signals contradict — i.e. an unlanded PR someone
    reported as landed, which is strictly worse than an item honestly left
    open.
    """

    open_refs: tuple[str, ...] = ()
    open_gate_ids: tuple[str, ...] = ()
    contradicted_refs: tuple[str, ...] = ()

    @property
    def any_open(self) -> bool:
        return bool(self.open_refs or self.open_gate_ids or self.contradicted_refs)


def derive_closeout_state(
    compliance: ComplianceSignal | None,
    disposition: DispositionSignal | None,
    open_work: OpenWorkSignal,
) -> str:
    """Reduce the three signals to ``clean`` | ``unfinished`` | ``unknown``.

    The ladder, in order, and why each rung is where it is:

    1. **Any open work → ``unfinished``.** An open gate or an unlanded PR is
       positive evidence of work left undone, and no footer can talk it away.
       This rung is first precisely so a session that claimed completeness
       while leaving a gate open cannot read ``clean``.
    2. **No compliance row → ``unknown``.** Nothing observed this session. That
       is an absence of evidence, and the default must not convert it into
       evidence of absence.
    3. **``not_applicable`` → ``unknown``.** Enforcement was off or its clause
       was edited out, so nothing was ever checked. Same reasoning as (2): a
       check that did not run is not a check that passed.
    4. **``unverified`` → ``unfinished``.** Covers plan §3.4's "no footer" arm
       (coord files a missing footer here with ``reason='absent'``) and the
       case where a footer's claims did not reconcile.
    5. **``verified`` but nothing declared → ``unknown``.** Signal 2's rule: a
       session that closed without a disposition is ``unknown``, not ``clean``.
    6. **``verified`` with a declared disposition → ``clean``.**

    Note what CANNOT happen: this function never returns ``clean`` from a
    single signal. Clean requires a reconciled footer AND a declared
    disposition AND no open work — three independent producers agreeing.
    """
    if open_work.any_open:
        return "unfinished"
    if compliance is None or compliance.verdict is None:
        return "unknown"
    if compliance.verdict == "not_applicable":
        return "unknown"
    if compliance.verdict == "unverified":
        return "unfinished"
    if compliance.verdict != "verified":
        # An unknown fourth verdict from a future coord. Fail to UNKNOWN, never
        # to clean: this module must not invent a meaning for a value it has
        # never seen.
        return "unknown"
    if disposition is None or not disposition.declared_anything:
        return "unknown"
    return "clean"


def closeout_signals(
    compliance_rows: Iterable[dict[str, Any]],
    outstanding_rows: Iterable[dict[str, Any]],
) -> dict[str, tuple[ComplianceSignal, DispositionSignal, OpenWorkSignal]]:
    """Index coord's two compliance payloads into per-session signal triples.

    Both coord routes key on the CLAUDE session UUID (coord normalises it to
    the canonical lower-case hyphenated form on write), so the returned dict is
    directly joinable to ``claude_session_id``.

    Compliance rows arrive newest-first; the FIRST row seen for a session wins,
    because a later verdict supersedes an earlier one and re-reading an older
    row would resurrect a stale answer.
    """
    out: dict[str, tuple[ComplianceSignal, DispositionSignal, OpenWorkSignal]] = {}
    open_by_session: dict[str, tuple[list[str], list[str]]] = {}

    for row in outstanding_rows:
        sid = _as_str(row.get("claude_session_id"))
        if not sid:
            continue
        refs, gates = open_by_session.setdefault(sid, ([], []))
        ref = _as_str(row.get("ref"))
        if ref:
            refs.append(ref)
        gate_id = _as_str(row.get("gate_id"))
        if gate_id:
            gates.append(gate_id)

    for row in compliance_rows:
        sid = _as_str(row.get("claude_session_id"))
        if not sid or sid in out:
            continue
        compliance = ComplianceSignal(
            verdict=_as_str(row.get("verdict")),
            reason=_as_str(row.get("reason")),
            unreconciled_count=_as_int(row.get("unreconciled_count")) or 0,
        )
        report = row.get("report")
        items = report.get("items") if isinstance(report, dict) else None
        states: list[str] = []
        report_open_refs: list[str] = []
        if isinstance(items, list):
            for item in items:
                if not isinstance(item, dict):
                    continue
                state = _as_str(item.get("state"))
                if not state:
                    continue
                states.append(state)
                if state not in FINISHED_ITEM_STATES:
                    report_open_refs.append(_as_str(item.get("ref")) or state)
        disposition = DispositionSignal(item_states=tuple(states))

        refs, gates = open_by_session.get(sid, ([], []))
        # An item the session claimed `landed` that coord's independent signals
        # CONTRADICT is an unlanded PR reported as landed — read straight off
        # the reconciliation payload coord already computed.
        contradicted = tuple(_contradicted_refs(row.get("reconciliation")))
        # The ledger scan is CAPPED and the report is not, so a session whose
        # ledger rows fell off the page still contributes its own open items.
        # Ledger rows win when present: they carry coord's reconciliation.
        open_work = OpenWorkSignal(
            open_refs=tuple(refs) or tuple(report_open_refs),
            open_gate_ids=tuple(gates),
            contradicted_refs=contradicted,
        )
        out[sid] = (compliance, disposition, open_work)

    # A session with outstanding work but no compliance verdict still has a
    # signal-3 answer, and it is the strongest one there is.
    for sid, (refs, gates) in open_by_session.items():
        if sid in out:
            continue
        out[sid] = (
            ComplianceSignal(verdict=None),
            DispositionSignal(),
            OpenWorkSignal(open_refs=tuple(refs), open_gate_ids=tuple(gates)),
        )
    return out


def _contradicted_refs(reconciliation: Any) -> list[str]:
    """Item refs whose reconciliation outcome contradicts the session's claim."""
    if not isinstance(reconciliation, dict):
        return []
    items = reconciliation.get("items")
    if not isinstance(items, list):
        return []
    out: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if _as_str(item.get("outcome")) == "contradicted":
            ref = _as_str(item.get("ref"))
            if ref:
                out.append(ref)
    return out


# ---------------------------------------------------------------------------
# Tenancy (pure) — plan §3.6.
# ---------------------------------------------------------------------------


def tenant_source_for(session_kind: str | None) -> str:
    """How THIS writer established the tenant it is about to record.

    **This job can never write ``declared``, and that is the correction the
    vetting pass made load-bearing.** ``declared`` means the session's SPAWN
    INPUT carried an explicit tenant — a fact that lives in the runner's
    ``stamp_session_tenant`` call and is not observable from any coord read.
    For the dominant class here, an operator's interactive pane
    (``session_kind='terminal_claude'``), it is not even true: the runner's
    ``register_sniffed_session`` OMITS ``tenant_id`` on purpose so coord
    resolves it from the device registration, so the tenant on that coord row
    is one coord DERIVED by sole binding.

    For every other kind the archiver still cannot see the spawn input, so the
    honest label is the same one: what this writer knows came from the
    tenant-scoped door it authenticated through, i.e. a binding, never a
    declaration. A guessed tenant that renders identically to a declared one is
    the exact defect ``tenant_source`` exists to prevent, so the weaker label
    always wins.

    ``derived_repo`` is deliberately absent from this function's range: that
    label belongs to coord's shipped ``repo_derived_tenants`` candidate rule,
    which is Rust and has no HTTP door. The runner's Phase 1 scanner produces
    it; this job does not pretend to.
    """
    if session_kind is None:
        return "unknown"
    return "derived_sole_binding"


def artifact_state_for(coord_state: str | None) -> str:
    """Map coord's session state onto the archive's three-value lifecycle.

    Only ``closed`` maps to ``closed``. Everything else — ``active``,
    ``stale``, ``expected``, or a state a future coord invents — maps to
    ``open``, because "was never closed" is exactly what those all have in
    common and it is the fact the archive is being asked about.

    ``abandoned`` is NEVER written here. It is a judgement about a session
    nobody will return to, and this job has no evidence for it; inferring it
    from staleness would file a session the operator is coming back to as
    dead. The unfinished-work question is answered by ``closeout_state``,
    which has three real signals behind it.
    """
    return "closed" if coord_state == "closed" else "open"


def gc_deadline(closed_at: datetime | None, days: int) -> datetime | None:
    """When coord's prune becomes eligible to delete this session's row."""
    if closed_at is None:
        return None
    return closed_at + timedelta(days=days)


def at_gc_risk(
    closed_at: datetime | None, *, now: datetime, days: int, grace: int = GC_GRACE_DAYS
) -> bool:
    """Whether this session is inside the GC danger window.

    An OPEN session is never at risk — coord's prune only takes closed rows.
    """
    deadline = gc_deadline(closed_at, days)
    if deadline is None:
        return False
    return now >= deadline - timedelta(days=grace)


# ---------------------------------------------------------------------------
# The promotion plan (pure).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ArchivedBody:
    """A body this job wrote, with the digest computed over what it wrote.

    The invariant the plan's exit criterion names lives in this type's ONLY
    producer, :func:`materialize_body`: ``content_sha256`` is computed over the
    same ``bytes`` the object store receives, so a row carrying this digest
    verifies against its stored body by construction. ``body_source`` is always
    :data:`BODY_SOURCE_COORD` here — this job has no access to verbatim bytes
    and must never claim otherwise.
    """

    object_key: str
    content_sha256: str
    byte_count: int
    body_source: str = BODY_SOURCE_COORD


@dataclass(frozen=True)
class ExistingRow:
    """The subset of a stored head row a promotion decision depends on."""

    id: UUID
    claude_session_id: str
    coord_session_id: UUID | None = None
    has_body: bool = False
    tenant_source: str = "unknown"


@dataclass(frozen=True)
class Promotion:
    """One session's metadata promotion — what to write, and nothing else.

    Field-level rules encoded here rather than at the write site so they are
    testable without a database:

    * ``fields`` carries ONLY metadata. No body column appears in it; a body,
      when there is one, travels separately as :attr:`body` and is subject to
      the never-overwrite rule.
    * ``tenant_source`` is in ``fields`` but the writer refuses to WEAKEN an
      existing value — see :func:`_apply_fields`.
    """

    claude_session_id: str
    tenant_id: UUID
    fields: dict[str, Any] = field(default_factory=dict)
    body: ArchivedBody | None = None
    target_id: UUID | None = None
    wants_body_fallback: bool = False


@dataclass(frozen=True)
class Candidate:
    """One coord session considered for promotion, with its joined coord rows."""

    claude_session_id: str
    agent_row: dict[str, Any]
    coord_row: dict[str, Any] | None
    coord_session_id: UUID | None
    coord_holds_transcript: bool


def build_promotion(
    candidate: Candidate,
    *,
    signals: dict[str, tuple[ComplianceSignal, DispositionSignal, OpenWorkSignal]],
    existing: ExistingRow | None,
    now: datetime,
    days: int,
) -> Promotion | None:
    """Turn one joined candidate into a metadata promotion, or ``None``.

    Returns ``None`` when the session's tenant cannot be established: an
    unattributable row cannot be consent-checked, and archiving something we
    cannot attribute is exactly the exposure plan §3.6 rule 4 is about.
    """
    coord_row = candidate.coord_row
    tenant_id = _as_uuid((coord_row or {}).get("tenant_id"))
    if tenant_id is None:
        return None

    agent = candidate.agent_row
    coord = coord_row or {}
    session_kind = _as_str(coord.get("session_kind"))
    coord_state = _as_str(coord.get("state"))
    closed_at = _as_dt(coord.get("closed_at")) or _as_dt(agent.get("closed_at"))
    started_at = _as_dt(coord.get("started_at")) or _as_dt(agent.get("first_seen"))
    last_activity = (
        _as_dt(agent.get("last_seen"))
        or _as_dt(coord.get("last_heartbeat_at"))
        or started_at
    )

    triple = signals.get(candidate.claude_session_id)
    compliance, disposition, open_work = triple or (
        None,
        None,
        OpenWorkSignal(),
    )
    closeout = derive_closeout_state(compliance, disposition, open_work)

    label = _as_str(agent.get("label"))
    session_name = label or _as_str(agent.get("derived_name"))
    name_source = "coord_label" if label else "coord_derived_name"

    # Columns this writer deliberately NEVER touches, so their absence below is
    # a decision rather than an oversight:
    #
    # * `organization_id` — the web-side ownership axis, resolved from a calling
    #   principal this job does not have. Guessing it is plan §3.6 rule 1.
    # * `account_label`, `config_dir`, `permission_mode`, `machine_hostname` —
    #   filesystem facts. No coord read carries them; the runner's scanner reads
    #   them off the account home it is walking.
    # * `turn_count`, `first_prompt`, `last_prompt`, `ai_title`,
    #   `secret_finding_*` — derived from the TRANSCRIPT BODY, which this job
    #   does not have (and, on the fallback path, has only in redacted form).
    #   Fabricating them from coord's `intent.purpose` would put a purpose
    #   string in a column readers take for transcript-derived content.
    # * `body_object_key` / `content_sha256` / `byte_count` / `body_source` —
    #   never in `fields` at all. A body travels as `Promotion.body` so the
    #   never-overwrite rule cannot be bypassed by a stray dict key.
    fields: dict[str, Any] = {
        "tenant_id": tenant_id,
        "tenant_source": tenant_source_for(session_kind),
        "device_id": _as_uuid(coord.get("device_id"))
        or _as_uuid(agent.get("device_id")),
        "coord_session_id": candidate.coord_session_id,
        "work_unit_slug": _as_str(coord.get("work_unit_slug")),
        "task_run_id": _as_str(coord.get("task_run_id")),
        "repo": _as_str(coord.get("repo")),
        "git_branch": _as_str(coord.get("branch")),
        "provider": _as_str(coord.get("provider")),
        "session_name": session_name,
        "name_source": name_source if session_name else None,
        "started_at": started_at,
        "last_activity_at": last_activity,
        "ended_at": closed_at,
        "state": artifact_state_for(coord_state),
        "closeout_state": closeout,
    }

    # The last-chance body fallback: a session inside the GC danger window
    # that has NO body at all. `has_body` is the never-overwrite rule — the
    # runner is the sole writer of a verbatim body and this job must not land
    # a redacted one on top of it.
    wants_fallback = (
        candidate.coord_holds_transcript
        and (existing is None or not existing.has_body)
        and at_gc_risk(closed_at, now=now, days=days)
    )

    return Promotion(
        claude_session_id=candidate.claude_session_id,
        tenant_id=tenant_id,
        fields=fields,
        target_id=existing.id if existing else None,
        wants_body_fallback=wants_fallback,
    )


def plan_promotions(
    candidates: Sequence[Candidate],
    *,
    signals: dict[str, tuple[ComplianceSignal, DispositionSignal, OpenWorkSignal]],
    existing: dict[str, list[ExistingRow]],
    consented: frozenset[UUID],
    now: datetime,
    days: int,
    budget: int = PROMOTION_BUDGET,
) -> tuple[list[Promotion], dict[str, int]]:
    """Decide what to promote. PURE — no I/O, no clock, no database.

    Ordering is nearest-the-GC-horizon first, so a cycle that runs out of
    budget spends it on the sessions with the least time left rather than on
    whichever ones coord happened to list first.

    Skip reasons are COUNTED, never silent. Each one is a different answer and
    an operator debugging "why is nothing archived" needs to see which:

    ``no_tenant``
        The session could not be attributed. Not archived, because an
        unattributable row cannot be consent-checked.
    ``no_consent``
        Attributed to a tenant that has not opted in (plan §3.7). This is the
        gate doing its job.
    ``ambiguous_identity``
        Two or more stored rows already carry this ``claude_session_id`` under
        different ACCOUNT HOMES. A Claude session id is unique per account
        home, not globally, and this job cannot see which account home a coord
        session came from — so it updates NEITHER rather than guessing and
        corrupting one. The runner's scanner, which reads the account home off
        the filesystem path, is the writer that can disambiguate.

        This is now the ONLY thing that produces this count. It used to also
        fire for a corpus fork this job caused itself — an org-less insert here
        plus the runner's org-carrying POST — but the organization is no longer
        part of ``uq_session_artifacts_identity``, so those two writes are one
        row. Two rows for one session id mean two account homes, and nothing
        else.
    ``budget``
        Deferred to the next cycle.
    """
    counts: dict[str, int] = {
        "no_tenant": 0,
        "no_consent": 0,
        "ambiguous_identity": 0,
        "budget": 0,
    }
    ordered = sorted(candidates, key=lambda c: _horizon_key(c, days))
    out: list[Promotion] = []
    for candidate in ordered:
        rows = existing.get(candidate.claude_session_id, [])
        target, ambiguous = _resolve_target(rows, candidate.coord_session_id)
        if ambiguous:
            counts["ambiguous_identity"] += 1
            continue
        promotion = build_promotion(
            candidate,
            signals=signals,
            existing=target,
            now=now,
            days=days,
        )
        if promotion is None:
            counts["no_tenant"] += 1
            continue
        if promotion.tenant_id not in consented:
            counts["no_consent"] += 1
            continue
        if len(out) >= budget:
            counts["budget"] += 1
            continue
        out.append(promotion)
    return out, counts


def _resolve_target(
    rows: Sequence[ExistingRow], coord_session_id: UUID | None
) -> tuple[ExistingRow | None, bool]:
    """Pick the stored row this promotion should update.

    Returns ``(row_or_none, ambiguous)``. ``ambiguous`` is a separate boolean
    rather than a sentinel row because "no row" and "too many rows" are
    genuinely different outcomes with different handling — the first inserts,
    the second must touch NOTHING. A Claude session id is unique per ACCOUNT
    HOME, not globally, and no coord read exposes which account home a session
    ran under, so when two stored rows share the id this job cannot choose
    between them and must not try.

    Since the organization left ``uq_session_artifacts_identity``, "two stored
    rows share the id" can mean ONE thing — two account homes — so the refusal
    below is answering a real question rather than papering over a fork this
    job caused.
    """
    if not rows:
        return None, False
    if len(rows) == 1:
        return rows[0], False
    if coord_session_id is not None:
        exact = [r for r in rows if r.coord_session_id == coord_session_id]
        if len(exact) == 1:
            return exact[0], False
    return None, True


def _horizon_key(candidate: Candidate, days: int) -> tuple[int, float]:
    """Sort key: closed sessions first, soonest deadline first.

    Open sessions sort last because coord's prune cannot touch them at all —
    they have no deadline to race.
    """
    closed_at = _as_dt((candidate.coord_row or {}).get("closed_at")) or _as_dt(
        candidate.agent_row.get("closed_at")
    )
    deadline = gc_deadline(closed_at, days)
    if deadline is None:
        return (1, 0.0)
    return (0, deadline.timestamp())


# ---------------------------------------------------------------------------
# Bodies (the fallback path only).
# ---------------------------------------------------------------------------


def transcript_bytes(envelope: dict[str, Any] | None) -> bytes:
    """Reassemble a transcript body from a coord output envelope.

    Chunks are concatenated in ``chunk_offset`` order — coord serves the warm
    tier oldest-first and the cold tier as a single chunk at offset 0, but
    sorting here means neither assumption is load-bearing. An undecodable chunk
    is skipped rather than aborting: a partial last-chance body is worth more
    than none, and the digest is computed over what was actually assembled, so
    the row stays internally consistent either way.
    """
    if not envelope:
        return b""
    chunks = envelope.get("chunks")
    if not isinstance(chunks, list):
        return b""
    decoded: list[tuple[int, bytes]] = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        payload = chunk.get("payload_b64")
        if not isinstance(payload, str):
            continue
        try:
            decoded.append(
                (_as_int(chunk.get("chunk_offset")) or 0, base64.b64decode(payload))
            )
        except (ValueError, TypeError):
            continue
    decoded.sort(key=lambda pair: pair[0])
    return b"".join(payload for _, payload in decoded)


def body_object_key(tenant_id: UUID, claude_session_id: str) -> str:
    """Deterministic object key, so a re-upload overwrites rather than orphans."""
    return f"{BODY_PREFIX}/{tenant_id}/{claude_session_id}.transcript.jsonl"


async def materialize_body(
    data: bytes,
    *,
    tenant_id: UUID,
    claude_session_id: str,
    storage: Any | None = None,
) -> ArchivedBody | None:
    """Upload ``data`` and describe it — the ONLY digest producer in this module.

    ``content_sha256`` is computed over the exact byte string handed to the
    object store, in the same call, so no row can ever carry a digest that does
    not verify against its stored body. That is plan Phase 3's exit criterion,
    and it is an invariant of this function rather than a rule someone has to
    remember at the call site.

    The store is synchronous (botocore), so the PUT is offloaded to a thread —
    a multi-megabyte upload on the event loop is the same class of stall that
    took ALB health checks down in the memory-consolidate incident.

    Returns ``None`` for empty input: a zero-byte body is not a body, and
    recording one would put a digest of nothing into the corpus.
    """
    if not data:
        return None
    from app.services.storage import object_storage

    store = storage if storage is not None else object_storage
    key = body_object_key(tenant_id, claude_session_id)
    digest = hashlib.sha256(data).hexdigest()
    await asyncio.to_thread(
        store.upload_bytes,
        data,
        prefix=f"{BODY_PREFIX}/{tenant_id}",
        filename=f"{claude_session_id}.transcript.jsonl",
        content_type="application/x-ndjson",
        generate_unique_name=False,
    )
    return ArchivedBody(
        object_key=key,
        content_sha256=digest,
        byte_count=len(data),
    )


#: Restore-record payload keys → head-row columns. Written ONLY on the fallback
#: path (see the module docstring): these are the relaunch fields, and the
#: runner is their first-hand writer everywhere it still exists.
_RESTORE_FIELD_MAP = {
    "cwd": "working_dir",
    "launch_command": "launch_command",
    "restore_tier": "restore_tier",
    "machine_id": "machine_id",
    "provider": "provider",
}


def restore_record_fields(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Project a ``restore-record`` event payload onto head-row columns."""
    if not payload:
        return {}
    out: dict[str, Any] = {}
    for source, column in _RESTORE_FIELD_MAP.items():
        value = _as_str(payload.get(source))
        if value:
            out[column] = value
    return out


# ---------------------------------------------------------------------------
# Persistence — the web-owned `agent.session_artifacts` store.
# ---------------------------------------------------------------------------


class ArtifactStore(Protocol):
    """The database seam, so the promotion core is testable without Postgres."""

    async def snapshot(
        self, claude_session_ids: Sequence[str]
    ) -> dict[str, list[ExistingRow]]:
        """Existing head rows for these Claude session ids, grouped by id."""

    async def apply(self, promotion: Promotion) -> str:
        """Write one promotion. Returns ``inserted`` or ``updated``."""


class SqlArtifactStore:
    """:class:`ArtifactStore` over one :class:`AsyncSession`.

    ``organization_id`` is left NULL on every row this store inserts, and that
    is a decision, not an omission. It is the web-side OWNERSHIP axis, resolved
    from the calling principal — and this job has no calling principal. The
    plan-library's ``_resolve_org_id`` idiom, which falls back to the caller's
    personal organization, is precisely what plan §3.6 rule 1 forbids copying:
    it would file every shared-tenant session under one operator's personal
    org.

    **That NULL is no longer a fork.** ``uq_session_artifacts_identity`` is
    ``(claude_session_id, coalesce(account_label, ''))`` — the organization is
    NOT in it, precisely because this writer can never supply one. So a row
    this job inserts and a row the runner POSTs for the same session are the
    same row, and ``crud.session_artifact.upsert_artifact`` fills the
    organization in on the runner's first authenticated write rather than
    creating a second row beside this one. The ``ambiguous_identity`` residual
    that used to be documented here — archiver inserts org-less, runner POSTs
    with an org, corpus forks, every later cycle declines to touch either row —
    is retired, and ``tests/test_session_repository_api.py`` reproduces the old
    fork to prove it.

    **Why this still does NOT go through ``upsert_artifact``.** Two reasons
    survive the identity change, and neither is about the organization:

    1. That function addresses a row by the FULL identity, account home
       included, and this job cannot see an account home at all — no coord read
       carries one (the runner's scanner reads it off the filesystem path it is
       walking). So :meth:`snapshot` looks a candidate up by
       ``claude_session_id``, which is the new identity minus the one component
       this writer cannot observe.
    2. The write rules in :func:`_apply_fields` are STRICTER than the API's:
       a ``None`` never blanks a value, ``tenant_source`` is never weakened,
       and a body is only ever written onto a row that has none.

    **The narrower residual that remains**, stated rather than implied: the
    account home is still part of identity, and this job writes rows without
    one. If the runner has already archived a session under a labelled account
    home, this job's ``(claude_session_id, '')`` insert is a genuinely
    different identity, and a later cycle seeing both rows counts
    ``ambiguous_identity`` and touches neither — see :func:`_resolve_target`.
    That is the ORIGINAL, honest cause: two account homes really can hold the
    same session id, this writer cannot tell which one a coord session ran
    under, and guessing would corrupt a row. It is not the org fork, and no
    change on the web side can close it — only a writer that can see the
    filesystem can.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def snapshot(
        self, claude_session_ids: Sequence[str]
    ) -> dict[str, list[ExistingRow]]:
        """Candidate rows per Claude session id — the identity, minus what this
        writer cannot see.

        The lookup is ``claude_session_id`` and NOT the full
        ``(claude_session_id, coalesce(account_label, ''))`` key on purpose: no
        coord read carries an account home, so filtering on one would mean
        filtering on ``''`` — and this job would then stop finding the runner's
        labelled row and insert a duplicate beside it, re-creating on the
        account-home axis exactly the fork that removing the organization from
        the key just closed.

        So this returns the identity's SUPERSET, and the caller resolves it:
        after the organization left the key, the only way two rows share one
        ``claude_session_id`` is that they are two different ACCOUNT HOMES —
        which is a real distinction, not a corpus defect, and
        :func:`_resolve_target` refuses to guess between them.
        """
        if not claude_session_ids:
            return {}
        stmt = select(SessionArtifact).where(
            SessionArtifact.claude_session_id.in_(list(claude_session_ids))
        )
        result = await self._session.execute(stmt)
        out: dict[str, list[ExistingRow]] = {}
        for row in result.scalars().all():
            out.setdefault(row.claude_session_id, []).append(
                ExistingRow(
                    id=row.id,
                    claude_session_id=row.claude_session_id,
                    coord_session_id=row.coord_session_id,
                    has_body=bool(row.body_object_key),
                    tenant_source=row.tenant_source,
                )
            )
        return out

    async def apply(self, promotion: Promotion) -> str:
        if promotion.target_id is not None:
            row = await self._session.get(SessionArtifact, promotion.target_id)
            if row is not None:
                _apply_fields(row, promotion)
                return "updated"
        row = SessionArtifact(claude_session_id=promotion.claude_session_id)
        _apply_fields(row, promotion)
        self._session.add(row)
        return "inserted"


def _apply_fields(row: SessionArtifact, promotion: Promotion) -> None:
    """Copy a promotion onto a head row under the write rules.

    Three rules, all of them about not destroying what a better-informed writer
    already recorded:

    1. **A ``None`` never overwrites a value.** The archiver's view is
       coord-shaped and partial; the runner's is filesystem-shaped and richer.
       Blanking ``launch_command`` because this job could not see one would be
       a regression dressed up as a sync.
    2. **``tenant_source`` is never WEAKENED.** This job can only ever produce
       ``derived_sole_binding``; if the runner already established ``declared``
       or ``derived_repo``, that stands. The whole point of the column is that
       a guessed attribution must not come to look like a declared one.
    3. **A body is written only onto a row that has none**, and only ever with
       :data:`BODY_SOURCE_COORD`. The runner is the sole writer of verbatim
       bodies; a redacted body landing on top of one would make the stored
       digest unverifiable against the file it claims to describe.

    ``closeout_state`` and ``state`` are exempt from rule 1 by construction:
    they are always present in ``fields`` because they are DERIVED every cycle,
    and overwriting them is the point — a recomputable column that is not
    recomputed is just a stale one.
    """
    for column, value in promotion.fields.items():
        if value is None:
            continue
        if column == "tenant_source" and row.tenant_source not in (None, "unknown"):
            continue
        setattr(row, column, value)
    if promotion.body is not None and not row.body_object_key:
        row.body_object_key = promotion.body.object_key
        row.content_sha256 = promotion.body.content_sha256
        row.byte_count = promotion.body.byte_count
        row.body_source = promotion.body.body_source


# ---------------------------------------------------------------------------
# Orchestration core.
# ---------------------------------------------------------------------------


async def archive_tenant_once(
    *,
    tenant_id: UUID,
    reader: CoordReader,
    store: ArtifactStore,
    consented: frozenset[UUID],
    now: datetime | None = None,
    days: int | None = None,
    storage: Any | None = None,
    budget: int = PROMOTION_BUDGET,
    fallback_budget: int = FALLBACK_BUDGET,
) -> dict[str, Any]:
    """One tenant's archive pass. Directly testable — every seam is injected.

    The returned dict is the cycle's honest report. ``coord_reachable`` is the
    field that keeps it honest: when it is ``False`` every count below it is
    UNKNOWN rather than zero, and the caller logs it as such.
    """
    now = now or datetime.now(UTC)
    days = days if days is not None else retention_days(os.getenv(ENV_RETENTION_DAYS))
    window_start = now - timedelta(days=days + SCAN_SLACK_DAYS)

    stats: dict[str, Any] = {
        "tenant_id": str(tenant_id),
        "coord_reachable": True,
        "candidates": 0,
        "inserted": 0,
        "updated": 0,
        "bodies_written": 0,
        "at_risk_unarchived": 0,
        "oldest_at_risk": None,
    }

    try:
        agent_rows = await reader.list_agent_sessions(
            since=window_start, limit=AGENT_SESSIONS_PAGE_MAX
        )
        coord_rows = await reader.list_coord_sessions(since=window_start)
        compliance_rows = await reader.list_compliance(limit=COMPLIANCE_PAGE_SIZE)
        outstanding_rows = await reader.list_outstanding()
    except CoordUnavailable as exc:
        # UNKNOWN, explicitly. NOT "no sessions" — see the module docstring.
        stats["coord_reachable"] = False
        stats["coord_error"] = str(exc)
        logger.warning(
            "session_archive_coord_unavailable",
            tenant_id=str(tenant_id),
            error=str(exc),
            note="counts are UNKNOWN for this cycle, not zero",
        )
        return stats

    by_coord_id = {
        cid: row for row in coord_rows if (cid := _as_uuid(row.get("id"))) is not None
    }
    signals = closeout_signals(compliance_rows, outstanding_rows)

    candidates: list[Candidate] = []
    for agent_row in agent_rows:
        claude_id = _as_str(agent_row.get("id"))
        if not claude_id:
            continue
        envelope = None
        try:
            envelope = await reader.resolve_output(claude_id, tier="warm", limit=1)
        except CoordUnavailable as exc:
            # One probe failing does not make the cycle unknown — it makes THIS
            # session unpromotable, which the tenant-join below records as
            # `no_tenant`. Logged at debug so a systemic failure is still
            # visible in aggregate through the skip counts.
            logger.debug(
                "session_archive_output_probe_failed",
                claude_session_id=claude_id,
                error=str(exc),
            )
        coord_session_id = _as_uuid((envelope or {}).get("session_id"))
        candidates.append(
            Candidate(
                claude_session_id=claude_id,
                agent_row=agent_row,
                coord_row=by_coord_id.get(coord_session_id)
                if coord_session_id
                else None,
                coord_session_id=coord_session_id,
                coord_holds_transcript=bool((envelope or {}).get("count")),
            )
        )
    stats["candidates"] = len(candidates)

    existing = await store.snapshot([c.claude_session_id for c in candidates])
    promotions, skipped = plan_promotions(
        candidates,
        signals=signals,
        existing=existing,
        consented=consented,
        now=now,
        days=days,
        budget=budget,
    )
    stats["skipped"] = skipped

    fallbacks_used = 0
    promoted_ids: set[str] = set()
    for promotion in promotions:
        if promotion.wants_body_fallback and fallbacks_used < fallback_budget:
            fallbacks_used += 1
            promotion = await _attach_fallback_body(
                promotion, reader=reader, storage=storage
            )
            if promotion.body is not None:
                stats["bodies_written"] += 1
        outcome = await store.apply(promotion)
        stats[outcome] = int(stats[outcome]) + 1
        promoted_ids.add(promotion.claude_session_id)

    # The race, made countable. Everything coord showed us inside the danger
    # window that we did NOT archive this cycle.
    at_risk: list[datetime] = []
    for candidate in candidates:
        if candidate.claude_session_id in promoted_ids:
            continue
        closed_at = _as_dt((candidate.coord_row or {}).get("closed_at")) or _as_dt(
            candidate.agent_row.get("closed_at")
        )
        if at_gc_risk(closed_at, now=now, days=days) and closed_at is not None:
            at_risk.append(closed_at)
    if at_risk:
        oldest = min(at_risk)
        stats["at_risk_unarchived"] = len(at_risk)
        stats["oldest_at_risk"] = oldest.isoformat()
        logger.warning(
            "session_archive_gc_horizon_at_risk",
            tenant_id=str(tenant_id),
            count=len(at_risk),
            oldest_closed_at=oldest.isoformat(),
            deadline=(gc_deadline(oldest, days) or oldest).isoformat(),
            note=(
                "these sessions are inside coord's prune window and were NOT "
                "archived this cycle; the on-disk JSONL is still authoritative "
                "and the runner's backfill scanner can recover them"
            ),
        )

    logger.info("session_archive_tenant_completed", **_loggable(stats))
    return stats


async def _attach_fallback_body(
    promotion: Promotion, *, reader: CoordReader, storage: Any | None
) -> Promotion:
    """Fetch, upload and stamp the last-chance body for one promotion.

    Warm tier first, cold as the second try: warm is the live FIFO and is what
    a session inside the danger window still has, while cold is the durable
    copy flushed on close. Either way the bytes came through coord's stream and
    are therefore REDACTED, which is why :func:`materialize_body` can only ever
    stamp :data:`BODY_SOURCE_COORD`.

    On the same last-chance pass the restore record is folded in — the only
    place this job reads it, because it is the only place the runner will never
    write it.
    """
    data = b""
    for tier in ("warm", "cold"):
        try:
            envelope = await reader.resolve_output(
                promotion.claude_session_id, tier=tier, limit=65536
            )
        except CoordUnavailable as exc:
            logger.debug(
                "session_archive_fallback_read_failed",
                claude_session_id=promotion.claude_session_id,
                tier=tier,
                error=str(exc),
            )
            continue
        data = transcript_bytes(envelope)
        if data:
            break
    if not data:
        return promotion

    body = await materialize_body(
        data,
        tenant_id=promotion.tenant_id,
        claude_session_id=promotion.claude_session_id,
        storage=storage,
    )
    if body is None:
        return promotion

    fields = dict(promotion.fields)
    try:
        record = await reader.read_restore_record(promotion.claude_session_id)
    except CoordUnavailable:
        record = None
    fields.update(restore_record_fields(record))
    logger.info(
        "session_archive_fallback_body_written",
        claude_session_id=promotion.claude_session_id,
        byte_count=body.byte_count,
        body_source=body.body_source,
        note="digest is over REDACTED coord bytes and is not verifiable "
        "against the original transcript file",
    )
    return replace(promotion, fields=fields, body=body)


# ---------------------------------------------------------------------------
# Credential — the coord bearer this job reads with.
# ---------------------------------------------------------------------------


@dataclass
class _MintedToken:
    token: str
    exp: int


_token_cache: dict[UUID, _MintedToken] = {}


async def _resolve_bearer(tenant_id: UUID) -> str | None:
    """The bearer this job presents to coord, or ``None`` if it has none.

    Two sources, in order:

    1. :data:`ENV_COORD_TOKEN` — an operator or device JWT the deployment
       provisioned. Preferred, because coord's session read routes gate on an
       operator/device principal.
    2. A coord-minted SERVICE token (``POST /coord/auth/service-token``,
       admin-secret gated), scoped to ``tenant_id``. This is the credential the
       web backend can obtain autonomously; it is cached until shortly before
       expiry.

    Returning ``None`` is a real answer: the caller reports the cycle as
    UNKNOWN and archives nothing, rather than issuing anonymous reads that
    coord would reject one at a time.
    """
    explicit = os.getenv(ENV_COORD_TOKEN)
    if explicit and explicit.strip():
        return explicit.strip()

    cached = _token_cache.get(tenant_id)
    if cached is not None and cached.exp - int(time.time()) > _TOKEN_REFRESH_BUFFER_S:
        return cached.token

    from app.core.config import settings

    admin_secret = settings.COORD_ADMIN_SECRET
    if not admin_secret:
        return None

    import httpx

    url = f"{settings.COORD_URL.rstrip('/')}/coord/auth/service-token"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            resp = await client.post(
                url,
                headers={"X-Coord-Admin-Secret": admin_secret},
                json={
                    "service_name": SERVICE_NAME,
                    "tenant_id": str(tenant_id),
                    "scopes": {},
                },
            )
    except httpx.HTTPError as exc:
        logger.warning(
            "session_archive_token_mint_failed",
            tenant_id=str(tenant_id),
            error=str(exc),
        )
        return None
    if resp.status_code != 200:
        logger.warning(
            "session_archive_token_mint_rejected",
            tenant_id=str(tenant_id),
            status=resp.status_code,
        )
        return None
    try:
        body = resp.json()
        token = str(body["token"])
        exp = int(body["exp"])
        if not token:
            raise ValueError("empty token")
    except (ValueError, KeyError, TypeError) as exc:
        logger.warning(
            "session_archive_token_mint_malformed",
            tenant_id=str(tenant_id),
            error=str(exc),
        )
        return None
    _token_cache[tenant_id] = _MintedToken(token=token, exp=exp)
    return token


# ---------------------------------------------------------------------------
# Scheduler entry point.
# ---------------------------------------------------------------------------


async def archive_all(
    session_maker: async_sessionmaker[AsyncSession],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Run one archive cycle across every CONSENTED tenant (commit per tenant).

    With no tenant consented this returns immediately having made no coord
    call and no database write — plan §3.7's "with it off the archiver is
    inert, and coord's existing horizons are the only behaviour". The debug
    line is deliberately not a warning: inert is the DEFAULT and correct state,
    not a fault.
    """
    consented = consented_tenants(os.getenv(ENV_CONSENTED_TENANTS))
    if not consented:
        logger.debug(
            "session_archive_inert",
            reason="no tenant has consented",
            env=ENV_CONSENTED_TENANTS,
        )
        return {"tenants": 0, "inert": True}

    from app.api.v1.endpoints.operations import _caller_bearer

    totals: dict[str, Any] = {
        "tenants": 0,
        "inert": False,
        "inserted": 0,
        "updated": 0,
        "bodies_written": 0,
        "at_risk_unarchived": 0,
        "unreachable_tenants": 0,
        "uncredentialed_tenants": 0,
    }
    for tenant_id in sorted(consented, key=str):
        bearer = await _resolve_bearer(tenant_id)
        if bearer is None:
            totals["uncredentialed_tenants"] += 1
            logger.warning(
                "session_archive_no_credential",
                tenant_id=str(tenant_id),
                note=(
                    "no coord bearer resolved; this cycle is UNKNOWN for this "
                    "tenant, not empty"
                ),
            )
            continue
        # ContextVar, so the shipped proxy forwards this bearer for the
        # duration of this tenant's reads and nothing else — reset in the
        # `finally` so one tenant's credential can never leak into the next
        # iteration or into a request handler sharing the loop.
        token = _caller_bearer.set(bearer)
        try:
            async with session_maker() as session:
                stats = await archive_tenant_once(
                    tenant_id=tenant_id,
                    reader=ProxyCoordReader(tenant_id),
                    store=SqlArtifactStore(session),
                    consented=consented,
                    now=now,
                )
                await session.commit()
        finally:
            _caller_bearer.reset(token)
        totals["tenants"] += 1
        if not stats.get("coord_reachable", False):
            totals["unreachable_tenants"] += 1
            continue
        for key in ("inserted", "updated", "bodies_written", "at_risk_unarchived"):
            totals[key] = int(totals[key]) + int(stats.get(key, 0))

    logger.info("session_archive_run_completed", **totals)
    return totals


# ---------------------------------------------------------------------------
# Coercions. Coord's JSON is tolerant by design (fields are added over time and
# a pre-migration coord omits them), so every read goes through one of these
# rather than assuming a shape.
# ---------------------------------------------------------------------------


def _as_str(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return None


def _as_uuid(value: Any) -> UUID | None:
    if isinstance(value, UUID):
        return value
    if isinstance(value, str):
        try:
            return UUID(value.strip())
        except ValueError:
            return None
    return None


def _as_dt(value: Any) -> datetime | None:
    """Parse an RFC 3339 timestamp into an AWARE UTC datetime.

    Naive input is treated as UTC rather than rejected: coord serves aware
    stamps, but a comparison against ``now`` must never raise on a shape
    surprise inside an otherwise successful read.
    """
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _loggable(stats: dict[str, Any]) -> dict[str, Any]:
    """Flatten the stats dict for structlog (nested dicts render poorly)."""
    out: dict[str, Any] = {}
    for key, value in stats.items():
        if isinstance(value, dict):
            for inner_key, inner_value in value.items():
                out[f"{key}_{inner_key}"] = inner_value
        else:
            out[key] = value
    return out
