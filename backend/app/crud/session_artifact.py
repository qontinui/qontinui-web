"""CRUD for the Claude Code Session Repository (``agent.session_artifacts``).

Phase 4 of ``2026-08-26-claude-code-session-repository-in-qontinui-web``.
Shaped after :mod:`app.crud.work_artifact`, whose scoping and upsert idioms
this store reuses wholesale. The three contracts that differ are below.

Scoping contract — and why it is NOT the identity contract
----------------------------------------------------------
Every READ takes ``org_id: UUID | None`` — the organization derived by the
endpoint layer from the AUTHENTICATED PRINCIPAL, never from a request body —
and applies :func:`_org_scope`, a NULL-collapsing predicate so that a principal
with no personal organization reads the NULL bucket consistently instead of
seeing everything or nothing.

``uq_session_artifacts_identity`` deliberately does NOT carry the organization
(read that index's rationale in :class:`app.models.session_artifact.SessionArtifact`),
so **scoping and identity are two different predicates here and must not be
collapsed back into one.** :func:`get_by_identity` takes no ``org_id`` at all —
it addresses the row, and there is exactly one row per real session — while
every list/get read still filters by organization. Writing the organization
back into the identity lookup is what forked the corpus: the web archiver has
no calling principal, so it can only ever write ``NULL``, and an org-keyed
lookup made its row and the runner's row two different sessions.

``org_id`` is the WEB-SIDE OWNERSHIP axis and is a different question from
``tenant_id``, which names the coord tenant the session ran against. Nothing
in this module ever derives one from the other: plan §3.6 rule 1 forbids it
outright, because filing a shared-tenant session under whichever operator's
personal organization happened to POST it is a misattribution the corpus can
never recover from. Tenancy arrives as data, with ``tenant_source`` recording
how it was established.

Upsert contract — TWO WRITERS, ONE ROW
--------------------------------------
Plan §5 ("Two ingest paths, one digest") gives this row two writers with
disjoint responsibilities: the runner owns the body columns
(``body_object_key`` / ``content_sha256`` / ``byte_count`` / ``body_source``)
because it is the only component that can read the verbatim bytes off disk,
while the web archiver promotes metadata only.

:func:`upsert_artifact` therefore takes an explicit ``fields`` mapping of the
columns the caller actually supplied, and writes NOTHING else. An "update all
columns from the payload" upsert would have the archiver's next metadata pass
null out the runner's archived body — a silent loss of exactly the content
this repository exists to keep.

Search contract
---------------
``?q=`` is built from
:data:`app.models.session_artifact.SESSION_SEARCH_TSVECTOR_SQL` — the SAME
module constant the GIN index expression is built from. A hand-retyped
predicate is the documented trap: it still returns correct rows, so nothing
fails, it just silently stops using the index.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, Select, Text, cast, func, select, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session_artifact import (
    SESSION_SEARCH_TSVECTOR_SQL,
    SessionArtifact,
)
from app.models.work_artifact import NIL_ORGANIZATION_ID

#: Columns :func:`upsert_artifact` will write when the caller supplies them.
#: Spelled as an explicit allowlist rather than "whatever keys are in the
#: mapping": the mapping is assembled from a request body, and a typo'd or
#: hostile key must not reach ``setattr`` on an ORM row. ``organization_id``
#: is deliberately ABSENT — it is derived from the principal and passed as its
#: own argument, so there is no path by which a request could set it. It stays
#: absent even though it is no longer an identity component: a request must
#: never move a row between organizations. The ONE write it may cause is the
#: fill-in in :func:`upsert_artifact`, which is not a payload path.
UPSERTABLE_COLUMNS: frozenset[str] = frozenset(
    {
        "account_label",
        "tenant_id",
        "tenant_source",
        "device_id",
        "machine_hostname",
        "coord_session_id",
        "work_unit_slug",
        "task_run_id",
        "config_dir",
        "working_dir",
        "repo",
        "git_branch",
        "provider",
        "launch_command",
        "restore_tier",
        "machine_id",
        "permission_mode",
        "body_object_key",
        "content_sha256",
        "byte_count",
        "turn_count",
        "first_prompt",
        "last_prompt",
        "ai_title",
        "session_name",
        "name_source",
        "body_source",
        "started_at",
        "last_activity_at",
        "ended_at",
        "state",
        "closeout_state",
        "secret_finding_count",
        "secret_finding_kinds",
    }
)


def compute_content_sha256(data: bytes) -> str:
    """The digest, over the BYTES — never over a decoded string.

    Hashing a ``str`` would hash whatever encoding happened to be applied at
    that moment, which is precisely the ambiguity that makes a digest
    worthless as a round-trip check.
    """
    return hashlib.sha256(data).hexdigest()


def _org_scope(org_id: UUID | None) -> ColumnElement[bool]:
    """The NULL-collapsing organization predicate — a READ scope, not a key.

    NULL-collapsing so that "the caller has no personal organization" and "this
    row was written by something with no calling principal" are the same
    bucket, rather than a comparison that silently matches nothing because
    ``NULL <> NULL``.

    This is the ONLY place the organization is compared. It is deliberately not
    part of ``uq_session_artifacts_identity`` (see the module docstring), so
    this predicate decides who may SEE a row — never which row is which.
    """
    return func.coalesce(
        SessionArtifact.organization_id, NIL_ORGANIZATION_ID
    ) == func.coalesce(org_id, NIL_ORGANIZATION_ID)


def _apply_filters(
    stmt: Select,
    *,
    org_id: UUID | None,
    account: str | None = None,
    repo: str | None = None,
    state: str | None = None,
    closeout_state: str | None = None,
    tenant_id: UUID | None = None,
    tenant_source: str | None = None,
    body_source: str | None = None,
    machine_id: str | None = None,
    work_unit_slug: str | None = None,
    claude_session_id: str | None = None,
    coord_session_id: UUID | None = None,
    has_secret_findings: bool | None = None,
    secret_finding_kind: str | None = None,
    detector_ran: bool | None = None,
    since: datetime | None = None,
    q: str | None = None,
) -> Select:
    """Apply the shared list/count filters to a statement.

    One function for both the page and its total, so a filter can never be
    applied to one and forgotten on the other — a drift that shows up as a
    pager that reports more rows than it can ever hand back.
    """
    stmt = stmt.where(_org_scope(org_id))
    if account is not None:
        stmt = stmt.where(SessionArtifact.account_label == account)
    if repo is not None:
        stmt = stmt.where(SessionArtifact.repo == repo)
    if state is not None:
        stmt = stmt.where(SessionArtifact.state == state)
    if closeout_state is not None:
        stmt = stmt.where(SessionArtifact.closeout_state == closeout_state)
    if tenant_id is not None:
        stmt = stmt.where(SessionArtifact.tenant_id == tenant_id)
    if tenant_source is not None:
        # Plan §3.6 rule 2: a `derived_*` or `ambiguous` attribution must be
        # FILTERABLE, not merely displayed. This is the predicate that makes
        # "show me everything whose tenant was guessed" a real query.
        stmt = stmt.where(SessionArtifact.tenant_source == tenant_source)
    if body_source is not None:
        stmt = stmt.where(SessionArtifact.body_source == body_source)
    if machine_id is not None:
        stmt = stmt.where(SessionArtifact.machine_id == machine_id)
    if work_unit_slug is not None:
        stmt = stmt.where(SessionArtifact.work_unit_slug == work_unit_slug)
    if claude_session_id is not None:
        # The FORWARD half of the session <-> archive round trip
        # (`2026-08-26-sessions-console-consolidation` Phase 2, D-both-stores).
        # The reverse direction — archive row -> `/sessions/{coord_session_id}`
        # — already shipped; this is what lets a session surface find its own
        # permanent transcript.
        #
        # Indexed: `claude_session_id` is the LEADING column of
        # `uq_session_artifacts_identity`, so this is the cheap arm and the one
        # a caller should prefer. It is not unique on its own — one Claude
        # session archived under two account homes is two rows — so this is a
        # LIST filter, never a by-identity lookup (`get_by_identity` is that,
        # and it needs the account label too).
        stmt = stmt.where(SessionArtifact.claude_session_id == claude_session_id)
    if coord_session_id is not None:
        # The other id space. `coord_session_id` carries NO index today, so
        # this is a scan — stated rather than discovered later, exactly as the
        # `secret_finding_kind` arm below states its own. It is also a SOFT
        # link coord garbage-collects underneath us (see the column's comment
        # in `models/session_artifact.py`), so a miss here means "this archive
        # row never recorded a coord id", never "no such session".
        stmt = stmt.where(SessionArtifact.coord_session_id == coord_session_id)
    if has_secret_findings is not None:
        # An AUDIT filter. It selects rows; it never hides them from a caller
        # who did not ask, and it never masks a body (plan §4 Phase 1).
        stmt = stmt.where(
            SessionArtifact.secret_finding_count > 0
            if has_secret_findings
            else SessionArtifact.secret_finding_count == 0
        )
    if secret_finding_kind is not None:
        # Array containment. There is no GIN index on this column today, so
        # this is a scan — acceptable for an audit query, and stated here so
        # nobody later mistakes it for an indexed path.
        stmt = stmt.where(
            SessionArtifact.secret_finding_kinds.op("@>")(
                cast([secret_finding_kind], ARRAY(Text))
            )
        )
    if detector_ran is not None:
        # NULL vs '{}' is meaningful on this column: NULL means the detector
        # never ran, '{}' means it ran and found nothing. Collapsing them
        # would make an unscanned backfill row indistinguishable from a clean
        # one, so both are reachable.
        stmt = stmt.where(
            SessionArtifact.secret_finding_kinds.isnot(None)
            if detector_ran
            else SessionArtifact.secret_finding_kinds.is_(None)
        )
    if since is not None:
        # Matched against `last_activity_at` (the indexed recency column). A
        # row with NO recorded activity is EXCLUDED rather than silently
        # swept in: `since` is a claim about when something happened, and a
        # row that never said when cannot satisfy it.
        stmt = stmt.where(SessionArtifact.last_activity_at >= since)
    if q:
        # Spelled from the module constant so it matches
        # ix_session_artifacts_search's indexed expression VERBATIM. Retyping
        # it here would still return the right rows — it would just stop
        # using the index, with nothing failing to reveal it.
        stmt = stmt.where(
            text(
                f"{SESSION_SEARCH_TSVECTOR_SQL} "
                "@@ plainto_tsquery('english', :session_repo_q)"
            ).bindparams(session_repo_q=q)
        )
    return stmt


async def list_artifacts(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    account: str | None = None,
    repo: str | None = None,
    state: str | None = None,
    closeout_state: str | None = None,
    tenant_id: UUID | None = None,
    tenant_source: str | None = None,
    body_source: str | None = None,
    machine_id: str | None = None,
    work_unit_slug: str | None = None,
    claude_session_id: str | None = None,
    coord_session_id: UUID | None = None,
    has_secret_findings: bool | None = None,
    secret_finding_kind: str | None = None,
    detector_ran: bool | None = None,
    since: datetime | None = None,
    q: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[SessionArtifact], int]:
    """A filtered page of sessions plus the unpaged total."""
    filters: dict[str, Any] = {
        "org_id": org_id,
        "account": account,
        "repo": repo,
        "state": state,
        "closeout_state": closeout_state,
        "tenant_id": tenant_id,
        "tenant_source": tenant_source,
        "body_source": body_source,
        "machine_id": machine_id,
        "work_unit_slug": work_unit_slug,
        "claude_session_id": claude_session_id,
        "coord_session_id": coord_session_id,
        "has_secret_findings": has_secret_findings,
        "secret_finding_kind": secret_finding_kind,
        "detector_ran": detector_ran,
        "since": since,
        "q": q,
    }

    total = int(
        (
            await db.execute(
                _apply_filters(
                    select(func.count()).select_from(SessionArtifact), **filters
                )
            )
        ).scalar_one()
    )

    # Newest activity first, with `nullslast` so a metadata-only row that has
    # no recorded activity sinks rather than sorting above live sessions.
    # `id` breaks ties so paging is stable.
    rows = (
        (
            await db.execute(
                _apply_filters(select(SessionArtifact), **filters)
                .order_by(
                    SessionArtifact.last_activity_at.desc().nullslast(),
                    SessionArtifact.created_at.desc(),
                    SessionArtifact.id.desc(),
                )
                .offset(offset)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return list(rows), total


async def get_artifact(
    db: AsyncSession, artifact_id: UUID, *, org_id: UUID | None
) -> SessionArtifact | None:
    """One session, scoped to the caller's organization bucket."""
    stmt = select(SessionArtifact).where(
        SessionArtifact.id == artifact_id, _org_scope(org_id)
    )
    return (await db.execute(stmt)).scalars().first()


async def get_by_identity(
    db: AsyncSession,
    *,
    claude_session_id: str,
    account_label: str | None,
) -> SessionArtifact | None:
    """Look a row up by the functional unique key — ORGANIZATION-BLIND.

    ``coalesce(account_label, '')`` mirrors the index expression: an unlabelled
    account home and an empty label are the SAME identity, which is what stops
    a backfill of a default ``%USERPROFILE%`` home forking into two rows.

    **There is no ``org_id`` parameter, and that omission is the fix.** While
    the organization was part of the key, this lookup was org-scoped — so the
    web archiver (no calling principal, ``organization_id = NULL``) and the
    runner (authenticated, so an organization) addressed two different rows for
    one real session, and nothing downstream could merge them. Both writers now
    converge here. Deciding who may READ the row it returns is
    :func:`_org_scope`'s job, on a different query.
    """
    stmt = select(SessionArtifact).where(
        SessionArtifact.claude_session_id == claude_session_id,
        func.coalesce(SessionArtifact.account_label, "") == (account_label or ""),
    )
    return (await db.execute(stmt)).scalars().first()


async def closeout_state_counts(
    db: AsyncSession, *, org_id: UUID | None
) -> dict[str, int]:
    """How many rows sit in each ``closeout_state`` bucket.

    ``GET /unfinished`` reports the ``unknown`` bucket beside its results
    because an empty result next to a large unevaluated backlog means "the
    derivation has not run", which is a different fact from "everything was
    closed out" and must not be rendered as one.
    """
    rows = (
        await db.execute(
            select(SessionArtifact.closeout_state, func.count())
            .where(_org_scope(org_id))
            .group_by(SessionArtifact.closeout_state)
        )
    ).all()
    return {str(state): int(count) for state, count in rows}


async def upsert_artifact(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    claude_session_id: str,
    account_label: str | None,
    fields: dict[str, Any],
) -> tuple[SessionArtifact, bool, bool]:
    """Insert or update one session head row.

    Returns ``(row, created, changed)``.

    The row is addressed by :func:`get_by_identity`, which is
    organization-blind, so the two writers plan §5 gives this store — the
    authenticated runner and the principal-less web archiver — land on the SAME
    row instead of forking one session into two.

    ``fields`` carries ONLY the columns the caller supplied — see the module
    docstring's two-writers contract. Keys outside
    :data:`UPSERTABLE_COLUMNS` are ignored rather than trusted, and
    ``organization_id`` is not in that set at all, so no request can move a
    row between organizations.

    ``org_id`` reaches the row in exactly two situations, and the asymmetry
    between them is deliberate:

    * **On INSERT** it is recorded as given — ``None`` included, which is the
      archiver's honest "no calling principal wrote this".
    * **On UPDATE it is FILL-IN ONLY.** An org-less row may have its
      ``organization_id`` set by an authenticated caller that knows one; a row
      that already carries an organization is NEVER moved to a different one
      and NEVER blanked back to ``NULL``. Fill-in is what lets an
      archiver-created row become properly scoped the moment the runner POSTs
      the same session — the capability that dropping the organization from the
      identity key exists to buy. Refusing the other two directions is what
      stops the same mechanism becoming a way to take a row off its owner: a
      later caller with a different (or absent) organization writes the
      metadata it supplied, and nothing else.

    ``changed`` reports whether any stored value actually moved. It is not
    cosmetic: an idempotent re-scan of 8,238 transcripts re-POSTs every row,
    and a caller needs to distinguish "the archive already had this" from "the
    archive took a new revision" without diffing it itself.
    """
    writable = {k: v for k, v in fields.items() if k in UPSERTABLE_COLUMNS}

    row = await get_by_identity(
        db,
        claude_session_id=claude_session_id,
        account_label=account_label,
    )

    if row is None:
        row = SessionArtifact(
            organization_id=org_id,
            claude_session_id=claude_session_id,
            account_label=account_label,
        )
        for key, value in writable.items():
            setattr(row, key, value)
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return row, True, True

    changed = False
    if row.organization_id is None and org_id is not None:
        # FILL-IN, never a transfer — the one asymmetric write, and the reason
        # this arm exists at all. It fires only for a row nobody claimed, which
        # in practice means the archiver got there first and this authenticated
        # caller is now supplying the axis the archiver structurally cannot.
        # The mirror cases are handled by NOT being written here: a row that
        # already has an organization keeps it whatever this caller's is.
        row.organization_id = org_id
        changed = True

    for key, value in writable.items():
        if getattr(row, key) != value:
            setattr(row, key, value)
            changed = True

    if changed:
        await db.commit()
        await db.refresh(row)
    return row, False, changed
