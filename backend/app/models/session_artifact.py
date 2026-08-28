"""Claude Code Session Repository — the ``agent.session_artifacts`` store.

Phase 3a of ``2026-08-26-claude-code-session-repository-in-qontinui-web``.
Mirrors alembic revision ``session_repo_01_session_artifacts``; read that
migration's docstring for the DDL-level rationale.

The shape is copied DELIBERATELY from :mod:`app.models.work_artifact` (the
plan-library head row), because that store already proved the four idioms
this one needs: a functional NULL-collapsing identity index, explicitly
named CHECKs, FK-less soft links to coord, and a single-spelling full-text
expression. Where this store DIVERGES from the plan library, it is on
purpose and is commented at the divergence:

* **Bodies live in the object store, not in a column.** ``agent.work_artifacts``
  keeps ``body TEXT`` because plans are kilobytes; the session corpus is
  8,238 transcripts / ~3.5 GB with a 4 MB p99. Only ``body_object_key`` +
  ``content_sha256`` + ``byte_count`` live here.
* **Tenancy is recorded WITH its provenance** (``tenant_id`` +
  ``tenant_source``) and is NEVER derived from the caller's personal
  organization — see plan §3.6 rule 1. ``plan_library.py``'s
  ``_resolve_org_id`` is the idiom that must *not* be copied here: it would
  file every shared-tenant session under the operator's personal org.
* **``organization_id`` is still carried, but it is NOT part of identity** —
  and that is this store's sharpest divergence from the plan library. It is
  the web-side ownership axis every ``agent.*`` read scopes on, and it is a
  different question both from "which coord tenant did this session run
  against" (``tenant_id``) and from "which row is this". Plans are genuinely
  per-organization, so ``work_artifacts`` keys on it; sessions have two
  legitimate writers that do not agree about it, so this store must not — see
  :class:`SessionArtifact`'s identity paragraph for the whole argument.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

#: How this row's ``tenant_id`` was established. Enforced in Postgres by
#: ``ck_session_artifacts_tenant_source``; mirrored here so the API can 422 a
#: bad value instead of letting it become an IntegrityError 500.
#:
#: The distinction is load-bearing, not decorative (plan §3.6 rule 2). Only a
#: session whose SPAWN INPUT carried an explicit tenant earns ``declared``.
#: An interactive Claude Code pane never does — ``register_sniffed_session``
#: omits ``tenant_id`` on purpose so coord resolves it from the device
#: registration — so a tenant read off a ``terminal_claude`` coord session row
#: is ``derived_sole_binding``, never ``declared``. A guessed tenant that
#: renders identically to a declared one is the exact defect this column
#: exists to prevent.
SESSION_TENANT_SOURCES: tuple[str, ...] = (
    "declared",
    "derived_repo",
    "derived_sole_binding",
    "ambiguous",
    "unknown",
)

#: Where the archived bytes came from. Enforced by
#: ``ck_session_artifacts_body_source``.
#:
#: ⚠️ This column is what keeps ``content_sha256`` HONEST (plan §5, "Two
#: ingest paths, one digest"). The runner is the sole writer of verbatim
#: bodies read straight off disk (``disk_verbatim``): that digest verifies
#: against the original file. The web archiver's fallback body — for a
#: machine that is gone and never uploaded — is sourced from coord's warm/cold
#: transcript stream, which passed through ``redact_secrets`` unconditionally
#: on the way in (``transcript_emitter.rs`` Gate 3). A digest over redacted
#: bytes can NEVER be verified against the original, so such a row is stamped
#: ``coord_redacted`` and the export/verify API must never present it as if it
#: could be.
SESSION_BODY_SOURCES: tuple[str, ...] = ("disk_verbatim", "coord_redacted")

#: Lifecycle state. Enforced by ``ck_session_artifacts_state``.
SESSION_STATES: tuple[str, ...] = ("open", "closed", "abandoned")

#: Whether the session was closed out. DERIVED and RECOMPUTABLE (plan §3.4)
#: from three independently-produced signals — ``coord.session_compliance``,
#: the ``/unattended`` taxonomy, and open gates/PRs attributable to the
#: session — and NEVER hand-set. Enforced by
#: ``ck_session_artifacts_closeout_state``.
SESSION_CLOSEOUT_STATES: tuple[str, ...] = ("clean", "unfinished", "unknown")

#: The indexed full-text expression, spelled ONCE. The ``?q=`` filter reuses
#: this exact string so the predicate matches the index expression verbatim
#: and the GIN index is actually usable — the trap ``work_artifact.py``
#: documents at ``:103-107`` / ``:174-181``.
#:
#: Two properties are deliberate:
#:
#: * The regconfig is spelled explicitly. The one-argument ``to_tsvector(text)``
#:   reads ``default_text_search_config`` and is only STABLE, so it cannot be
#:   indexed at all.
#: * The column references are UNQUALIFIED, which is what lets one string
#:   serve both a ``CREATE INDEX`` expression and a query predicate. The list
#:   read is single-table; a future join that introduces an ambiguous column
#:   name must alias the other side rather than qualify this expression, or
#:   the two spellings drift apart and the index goes unused again.
SESSION_SEARCH_TSVECTOR_SQL = (
    "to_tsvector('english', "
    "coalesce(ai_title, '') || ' ' || "
    "coalesce(session_name, '') || ' ' || "
    "coalesce(first_prompt, '') || ' ' || "
    "coalesce(last_prompt, ''))"
)


class SessionArtifact(Base):
    """One archived Claude Code session — the mutable head row.

    Identity is ``(claude_session_id, coalesce(account_label, ''))``. Two
    decisions are packed into that, and both are load-bearing:

    * **``account_label`` is IN the key.** A Claude Code session id is unique
      per ACCOUNT HOME, not globally, and a resume rotation can hand two
      account homes the same id — so the session id alone would fuse two
      genuinely different sessions into one row.

    * **``organization_id`` is deliberately OUT of it.** This row has two
      legitimate writers with different knowledge of the organization (plan §5,
      "Two ingest paths, one digest"): the runner POSTs authenticated and so
      carries one, while :mod:`app.jobs.session_archiver` is a scheduled job
      with NO calling principal and can only ever write NULL. With the
      organization in the key, those two writers produced two rows for one real
      session — and it did not self-heal: the archiver's next cycle saw two
      candidate rows for the session id, refused to guess between them, and
      counted ``ambiguous_identity`` forever. An identity component that a
      legitimate writer structurally cannot supply is a defect in the key, not
      in the writer. It was inherited from ``work_artifacts``, where plans
      genuinely ARE per-organization; sessions are not.

    ⚠️ Do not "restore" the organization to this index. Scoping and identity
    are different questions: ``organization_id`` stays on the row as the
    web-side ownership axis every read filters on
    (``crud.session_artifact._org_scope``), and
    :func:`app.crud.session_artifact.upsert_artifact` fills it in on an
    org-less row rather than forking one.
    """

    __tablename__ = "session_artifacts"
    __table_args__ = (
        # Identity. Functional and NULL-collapsing — a plain UNIQUE over the
        # raw nullable ``account_label`` would not bind (NULL <> NULL in
        # PostgreSQL), which is exactly the shape a scan of an unlabelled
        # account home produces. This is the upsert conflict target.
        Index(
            "uq_session_artifacts_identity",
            text("claude_session_id"),
            text("coalesce(account_label, '')"),
            unique=True,
        ),
        # Serves `?tenant=` and the owner-visible-only filtering of the
        # `ambiguous` / `unknown` buckets (plan §3.6 rule 4).
        Index("ix_session_artifacts_tenant_id", "tenant_id"),
        Index("ix_session_artifacts_state", "state"),
        # Serves `GET /unfinished` — the capability the operator asked for by
        # name.
        Index("ix_session_artifacts_closeout_state", "closeout_state"),
        # Serves `?since=` and the default recency ordering.
        Index("ix_session_artifacts_last_activity_at", "last_activity_at"),
        Index("ix_session_artifacts_repo", "repo"),
        Index("ix_session_artifacts_account_label", "account_label"),
        # Serves `?q=`. The expression comes from the module constant so the
        # predicate can be built from the same string — see
        # SESSION_SEARCH_TSVECTOR_SQL.
        Index(
            "ix_session_artifacts_search",
            text(SESSION_SEARCH_TSVECTOR_SQL),
            postgresql_using="gin",
        ),
        CheckConstraint(
            "tenant_source IN ('declared', 'derived_repo', "
            "'derived_sole_binding', 'ambiguous', 'unknown')",
            name="ck_session_artifacts_tenant_source",
        ),
        # NULL-tolerant on purpose: a metadata-only row (the Phase 3 archiver
        # promotes head rows for sessions whose bytes were never uploaded) has
        # no body at all, and "no body" must not be forced to claim a source.
        CheckConstraint(
            "body_source IS NULL OR body_source IN ('disk_verbatim', 'coord_redacted')",
            name="ck_session_artifacts_body_source",
        ),
        CheckConstraint(
            "state IN ('open', 'closed', 'abandoned')",
            name="ck_session_artifacts_state",
        ),
        CheckConstraint(
            "closeout_state IN ('clean', 'unfinished', 'unknown')",
            name="ck_session_artifacts_closeout_state",
        ),
        {"schema": "agent"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # No FK: rows arrive from runner scans of on-disk JSONL whose org is
    # resolved from the scanning principal, not from a guaranteed row. Never
    # accepted from a request body — always derived server-side.
    #
    # SCOPING, NOT IDENTITY (see the class docstring). Nullable and MEANINGFUL:
    # NULL is the archiver's honest "no calling principal wrote this row", and
    # it is a state a later authenticated write fills in rather than forks.
    organization_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )

    #: The Claude Code session id (the JSONL stem, and the argument to
    #: ``claude --resume``). Unique per account home, not globally.
    claude_session_id: Mapped[str] = mapped_column(Text, nullable=False)

    #: Which account home the transcript was found in (e.g. the
    #: ``.claude-<label>`` suffix). Part of identity, because the same session
    #: id can legitimately exist under two accounts.
    account_label: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Tenancy (plan §3.6) ─────────────────────────────────────────────
    #
    # FK-less like every other coord-side pointer here: coord owns tenants,
    # and this column may name a tenant this deployment cannot resolve.
    tenant_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )

    # NOT NULL with an 'unknown' default: every row must state HOW its tenant
    # was established, and "no attribution attempted yet" is a value in the
    # vocabulary rather than a NULL a reader could mistake for `declared`.
    tenant_source: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'unknown'"),
        default="unknown",
    )

    device_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )

    machine_hostname: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Soft links to coord — FK-less, PERMITTED TO DANGLE ──────────────
    #
    # coord is a separate deployment with its own schema, and it DELETES these
    # rows: `prune_closed_sessions` drops closed sessions after 7 days
    # (plan §2.2), which is the whole reason this archive exists. A pointer
    # into a store that garbage-collects underneath us is by definition a
    # dangling one — readers treat all three as nullable metadata and never
    # 404 on a missing coord row.
    coord_session_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )

    work_unit_slug: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: TEXT, not UUID: coord's task-run identifiers are opaque strings on this
    #: axis and an interactive pane has none at all.
    task_run_id: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Provenance / relaunch (plan §3.5) ───────────────────────────────
    #
    # Everything `claude --resume` needs to be reconstructed on the machine it
    # came from, plus the honest tier label. `restore_tier` is NOT decoration:
    # a same-account relaunch is `full`, while a transfer to another account
    # is replay-as-context only, and a UI that renders them alike silently
    # loses state.
    config_dir: Mapped[str | None] = mapped_column(Text, nullable=True)

    working_dir: Mapped[str | None] = mapped_column(Text, nullable=True)

    repo: Mapped[str | None] = mapped_column(Text, nullable=True)

    git_branch: Mapped[str | None] = mapped_column(Text, nullable=True)

    provider: Mapped[str | None] = mapped_column(Text, nullable=True)

    launch_command: Mapped[str | None] = mapped_column(Text, nullable=True)

    restore_tier: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: The runner's machine identifier — a string in the restore-record
    #: payload, so TEXT here rather than UUID.
    machine_id: Mapped[str | None] = mapped_column(Text, nullable=True)

    permission_mode: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Content ─────────────────────────────────────────────────────────

    #: Object-store key of the archived JSONL. NOT a body column: p99 is 4 MB
    #: and the corpus is ~3.5 GB. Written through ``app/services/storage/``.
    body_object_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Named ``content_sha256`` — the spelling this corpus standardised on, so
    # a reader never has to guess which digest a column holds. Nullable here
    # (unlike ``work_artifacts``) because a metadata-only head row legitimately
    # has no body yet. Its MEANING is qualified by ``body_source`` above.
    content_sha256: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: BIGINT, not INTEGER: the corpus max is 7 MB today but nothing bounds a
    #: long-lived session's transcript, and a silent 2 GB ceiling on an
    #: archive is not worth the four bytes.
    byte_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    turn_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    first_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)

    last_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)

    ai_title: Mapped[str | None] = mapped_column(Text, nullable=True)

    session_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: Which of the two names above is authoritative for display, and how it
    #: was produced. Opaque TEXT with no CHECK: name sources are authored by
    #: whichever writer named the session and policing them here would turn a
    #: new one into a 500 at ingest.
    name_source: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: See :data:`SESSION_BODY_SOURCES` — the column that keeps
    #: ``content_sha256`` honest.
    body_source: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Lifecycle ───────────────────────────────────────────────────────

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    last_activity_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    state: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'open'"),
        default="open",
    )

    # Derived, recomputable, never hand-set (plan §3.4). Defaults to
    # 'unknown' rather than 'clean': a session nobody has evaluated has NOT
    # been shown to be closed out, and defaulting the other way would report
    # unfinished work as finished — the exact failure this column is for.
    closeout_state: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'unknown'"),
        default="unknown",
    )

    # ── Exposure (plan §4 Phase 1) ──────────────────────────────────────
    #
    # Written by the backfill DETECTOR, never by hand, and deliberately NOT a
    # visibility gate and NOT a mask: bodies are archived verbatim and
    # controlled by access, because the shipped redactor measured 57% false
    # positives on this corpus while missing whole credential shapes. This is
    # a recorded audit signal you can query later.
    secret_finding_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
        default=0,
    )

    # Nullable, and the NULL is meaningful: NULL = the detector never ran over
    # this row, '{}' = it ran and found nothing. Collapsing the two would make
    # an un-scanned backfill row indistinguishable from a clean one.
    secret_finding_kinds: Mapped[list[str] | None] = mapped_column(
        ARRAY(Text),
        nullable=True,
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
