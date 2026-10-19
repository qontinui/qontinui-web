"""Plan & Prompt Library models — the ``agent.work_artifacts`` store.

Phase 1 of ``2026-08-10-plan-and-prompt-library-in-web``. Mirrors alembic
revision ``plan_library_01_work_artifacts``; read that migration's docstring
for the design rationale (functional unique identity, opaque ``status``, the
FK-less soft link to coord's work units).

These are the FIRST ORM models bound to the web-owned ``agent`` schema — the
schema itself has existed since ``consolidation_phase1_01_infrastructure``
but only ever held migration-managed tables with no SQLAlchemy counterpart.
``tests/conftest.py``'s ``test_engine`` derives the set of schemas to create
from ``Base.metadata``, so the binding below is what makes ``agent`` appear
in a freshly-built test database; ``tests/test_plan_library_api.py`` asserts
the tables really land there rather than trusting that it works.
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
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.services.plan_difficulty import DifficultyLevel, DifficultySource

#: The sentinel a NULL ``organization_id`` collapses onto in the functional
#: unique index. Kept here (not just in the migration) because the upsert has
#: to key on the exact same expression the index enforces.
NIL_ORGANIZATION_ID = UUID("00000000-0000-0000-0000-000000000000")

#: The artifact families the library tracks. Enforced in Postgres by
#: ``ck_work_artifacts_kind``; mirrored here so the API can 422 a bad kind
#: instead of letting it become an IntegrityError 500.
WORK_ARTIFACT_KINDS: tuple[str, ...] = (
    "investigation_prompt",
    "plan_authoring_prompt",
    "implementation_prompt",
    "investigation_report",
    "handoff",
    "plan",
    #: An operator question answered by live MEASUREMENT — typically "the
    #: obvious action is inert, and here is the mechanism". Distinct from
    #: ``investigation_report`` (``/chart``'s gap verdicts) so the two families
    #: stay separable on the one structured filter the API offers. Added by
    #: ``plan_library_04_diagnostic_refutes``.
    "diagnostic",
    # ── The specification family (``plan_library_11_spec_artifacts``) ──
    # Analyst artifacts — see :data:`SPEC_ARTIFACT_KINDS`.
    "request",
    "requirement",
    "interface_mapping",
    "story",
    "test_case",
    "doc_correction",
)

#: The specification family: what an analyst writes BEFORE there is a plan.
#: Added by ``plan_library_11_spec_artifacts``. Three properties set these
#: kinds apart from the rest of the library, and all three are enforced:
#:
#: * each row carries a stable, human-readable ``spec_ref`` (``REQ-0042``)
#:   assigned on create from a per-organization, per-kind counter that only
#:   ever moves forward, so a number is never handed out twice — not even
#:   after the row it named is deleted (``ck_work_artifacts_spec_ref``);
#: * ``status`` is a closed lifecycle per kind (:data:`SPEC_KIND_STATUSES`),
#:   where every other kind's status stays opaque free text;
#: * the kind can never be corrected across the family boundary, because the
#:   ``spec_ref`` prefix names the kind and an ID that changed meaning would
#:   not be stable. A different kind of thing is a new artifact, linked by
#:   ``derives_from`` / ``refines``.
#:
#: Never written by the runner's plan scanner — these rows are authored, so a
#: heuristic (``kind_is_heuristic``) write of one is refused.
SPEC_ARTIFACT_KINDS: tuple[str, ...] = (
    "request",
    "requirement",
    "interface_mapping",
    "story",
    "test_case",
    "doc_correction",
)

#: The ``spec_ref`` prefix per spec kind. The CHECK
#: ``ck_work_artifacts_spec_ref`` spells the same table, and
#: ``tests/test_plan_library_spec_artifacts.py`` holds the two equal.
SPEC_REF_PREFIXES: dict[str, str] = {
    "request": "RQ",
    "requirement": "REQ",
    "interface_mapping": "IFM",
    "story": "STY",
    "test_case": "TC",
    "doc_correction": "DOC",
}

#: The minimum width of a ``spec_ref``'s number — ``REQ-0042``. Wider numbers
#: simply grow (``REQ-12345``); the width is presentation, never a cap.
SPEC_REF_MIN_DIGITS = 4

#: The lifecycle of each spec kind, in lifecycle order; the FIRST member is
#: the status a write that omits ``status`` gets. Mirrors the per-kind
#: ``Literal``s in ``app.schemas.plan_library`` (held equal by test). Checked
#: by the API only — no CHECK, because ``status`` predates the spec family
#: and stays opaque for every other kind.
SPEC_KIND_STATUSES: dict[str, tuple[str, ...]] = {
    "request": ("new", "triaged", "accepted", "rejected", "withdrawn"),
    "requirement": (
        "draft",
        "proposed",
        "approved",
        "implemented",
        "verified",
        "deprecated",
        "rejected",
    ),
    "interface_mapping": ("draft", "in_review", "approved", "deprecated"),
    "story": ("draft", "ready", "in_progress", "done", "cancelled"),
    "test_case": ("draft", "ready", "passing", "failing", "blocked", "retired"),
    "doc_correction": ("proposed", "accepted", "applied", "rejected"),
}


def format_spec_ref(kind: str, number: int) -> str:
    """``("requirement", 42)`` → ``"REQ-0042"``."""
    return f"{SPEC_REF_PREFIXES[kind]}-{number:0{SPEC_REF_MIN_DIGITS}d}"


def _spec_ref_check_sql() -> str:
    """The body of ``ck_work_artifacts_spec_ref``, spelled once.

    A spec kind REQUIRES a ``spec_ref`` carrying its own prefix; every other
    kind REQUIRES none. ``IS NOT NULL AND`` is load-bearing: ``NULL ~ '…'`` is
    NULL, and a CHECK passes on NULL, so without it a spec row with no ref
    would be admitted. The migration embeds this exact string.
    """
    arms = " ".join(
        f"WHEN '{kind}' THEN spec_ref IS NOT NULL "
        f"AND spec_ref ~ '^{prefix}-[0-9]{{{SPEC_REF_MIN_DIGITS},}}$'"
        for kind, prefix in SPEC_REF_PREFIXES.items()
    )
    return f"CASE kind {arms} ELSE spec_ref IS NULL END"


SPEC_REF_CHECK_SQL = _spec_ref_check_sql()

#: How the row got here. Enforced by ``ck_work_artifacts_captured_by``.
WORK_ARTIFACT_CAPTURE_SOURCES: tuple[str, ...] = (
    "runner_scan",
    "agent",
    "operator",
)

#: Provenance relations. Enforced by ``ck_work_artifact_edges_relation``.
WORK_ARTIFACT_RELATIONS: tuple[str, ...] = (
    "produced_report",
    "feeds",
    "authored_plan",
    "supersedes",
    "depends_on",
    "spawned_followup",
    #: A measurement that FALSIFIES the target claim. Two-ended — the refuted
    #: artifact must exist — and deliberately not ``supersedes``, which means
    #: "a newer version of the same thing". Added by
    #: ``plan_library_04_diagnostic_refutes``.
    "refutes",
    # ── Traceability (``plan_library_11_spec_artifacts``) — all two-ended ──
    "derives_from",
    "refines",
    "implements",
    "verifies",
    "traces_to",
)

#: The relation for work a plan SURFACED but deliberately did not do —
#: "worth its own plan". Added by ``plan_library_03_spawned_followup``.
#:
#: It is the only relation whose ``to_id`` may be NULL, because the follow-up
#: has no artifact yet: the whole point is to record identified-but-unowned
#: work. ``depends_on`` is the near miss and points the WRONG WAY ("I need that
#: first" rather than "I surfaced that"), which is why this is a new member of
#: the vocabulary rather than a re-use.
SPAWNED_FOLLOWUP_RELATION = "spawned_followup"

#: Relations permitted to carry a NULL ``to_id``. Mirrors
#: ``ck_work_artifact_edges_open_target``; the API checks it FIRST so a
#: one-ended edge on the wrong relation is a 422 naming the relation rather
#: than a bare IntegrityError 500.
RELATIONS_ALLOWING_OPEN_TARGET: frozenset[str] = frozenset({SPAWNED_FOLLOWUP_RELATION})

#: Whitespace stripped from a follow-up ``note`` before it is compared —
#: by the blank-note CHECK, by the duplicate-guard index, and by the CRUD
#: dedup lookup, all three of which MUST agree.
#:
#: ⚠️ Spelled out because one-argument ``btrim`` strips **spaces only**:
#: ``btrim(E'\n\t ')`` is ``E'\n\t'``, not ``''``, so the obvious spelling of
#: "must not be blank" admits a tab-and-newline note. The set matches what
#: Python's ``str.strip()`` removes for ASCII, which is what the API check uses.
NOTE_TRIM_CHARS = " \t\n\r\f\v"

#: The SQL trim expression over ``note``, spelled once. Mirrors
#: ``uq_work_artifact_edges_open_followup``'s indexed expression exactly, so the
#: CRUD dedup lookup can be served by that index and shares its grain.
NOTE_TRIM_SQL = r"btrim(note, E' \t\n\r\f\v')"

# ── follow-up closure and anchors (``plan_library_11_followup_anchors_and_closure``)
#
# Plan ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``
# D1/D2. A ``spawned_followup`` used to leave the queue ONLY by being claimed by
# an artifact (``to_id``), so a two-line fix that never earns a plan could never
# close. It now has a closure state of its own and structured file anchors.

#: How a follow-up was closed, NULL meaning OPEN. ``fixing``: a PR that fixes
#: it is open. ``fixed``: coord observed that PR land (the land commit is
#: stamped whenever coord recorded one). ``already_fixed``: an earlier commit
#: fixed it (the commit is required). ``dismissed``: closed without a fix (the
#: reason is required). Mirrors ``ck_work_artifact_edges_resolution``.
FOLLOWUP_RESOLUTIONS: tuple[str, ...] = (
    "fixing",
    "fixed",
    "already_fixed",
    "dismissed",
)

#: The resolutions a record RESTS in: nothing automatic moves them (the
#: reconcile only walks ``fixing``). Reopening one is the store's correction
#: verb — see ``app.crud.work_artifact_followups.LEGAL_TRANSITIONS``.
FOLLOWUP_TERMINAL_RESOLUTIONS: tuple[str, ...] = ("fixed", "already_fixed", "dismissed")

#: The expected size of the fix. ``trivial``: non-executable by the
#: exec-equivalence checker's definition; ``small``: one PR-sized change in
#: about three files with no design question; ``plan_sized``: needs a plan.
#: NULL is UNCLASSIFIED. Mirrors ``ck_work_artifact_edges_size_class``.
FOLLOWUP_SIZE_CLASSES: tuple[str, ...] = ("trivial", "small", "plan_sized")

#: Who classified it: the writer (``declared``) or the follow-up sweep after
#: attempting the fix (``sweep``). Mirrors ``ck_work_artifact_edges_size_class_source``.
FOLLOWUP_SIZE_CLASS_SOURCES: tuple[str, ...] = ("declared", "sweep")

#: The predicate of every follow-up NOT owned by an artifact, whatever its
#: resolution — the population the state views (``fixing``, the resolved ones)
#: and the reconcile walk read. Spelled with LITERALS on purpose: a query that
#: binds ``relation = $1`` cannot prove a partial index's predicate under a
#: generic prepared plan, so every reader renders this string verbatim and the
#: planner can match ``ix_work_artifact_edges_open_followups_created_id``.
#: The column names are unqualified; every statement that embeds this joins
#: only tables without a ``relation`` / ``to_id`` column of their own.
UNCLAIMED_FOLLOWUP_SQL = "relation = 'spawned_followup' AND to_id IS NULL"

#: The ONE spelling of "this follow-up is OPEN": unowned AND unresolved. The
#: model's open-queue index, the migration's index build (a static literal —
#: coord's migration classifier refuses an interpolated ``op.execute``, and no
#: revision imports ``app``; the migration test pins the two equal), and the
#: open reads (``list_open_followups``, ``match_followups``) all render it.
#:
#: Composition with qontinui-web#1459 (edge correction, ``retracted_at``): that
#: PR is not on ``main``. Whichever of the two lands second chains on the
#: other's revision and adds ``AND retracted_at IS NULL`` here and to the
#: rebuilt partial index, and ``transition_followup`` refuses a retracted row.
OPEN_FOLLOWUP_SQL = f"{UNCLAIMED_FOLLOWUP_SQL} AND resolution IS NULL"

#: An anchor's / a resolution PR's repository: ``owner/name``.
FOLLOWUP_REPO_PATTERN = "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"

#: A resolution PR citation: ``owner/name#<number>``.
FOLLOWUP_PR_PATTERN = "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[1-9][0-9]*$"

#: A commit sha, abbreviated (>= 7) or full, lowercase hex.
FOLLOWUP_COMMIT_PATTERN = "^[0-9a-f]{7,64}$"

#: The whitespace set every blank-text CHECK here strips — :data:`NOTE_TRIM_SQL`'s
#: set, for the same reason (one-argument ``btrim`` strips spaces only).
_TRIM_SET_SQL = r"E' \t\n\r\f\v'"

#: The longest anchor path the store accepts (the API refuses longer first).
FOLLOWUP_ANCHOR_PATH_MAX = 1024

#: ``(name, predicate)`` of every CHECK the closure columns carry on
#: ``agent.work_artifact_edges``, in the order ``plan_library_11`` declares
#: them. Held as data, not inlined in ``__table_args__``, so the migration test
#: can prove each migrated constraint equal to this one THROUGH POSTGRES'S OWN
#: NORMALISATION (it re-declares each predicate here on a probe table and
#: compares ``pg_get_constraintdef``) — a string compare against the revision
#: would pass on a reformatting and fail on nothing.
FOLLOWUP_EDGE_CHECKS: tuple[tuple[str, str], ...] = (
    # Every closure column is NULL — and the history empty — unless the edge is
    # a follow-up. The four other relations keep exactly the shape they had.
    (
        "ck_work_artifact_edges_followup_only_columns",
        "relation = 'spawned_followup' OR ("
        "resolution IS NULL AND resolution_pr IS NULL "
        "AND resolution_commit IS NULL AND resolution_note IS NULL "
        "AND resolved_by IS NULL AND resolved_at IS NULL "
        "AND size_class IS NULL AND size_class_source IS NULL "
        "AND unanchored_reason IS NULL "
        "AND resolution_history = '[]'::jsonb)",
    ),
    (
        "ck_work_artifact_edges_resolution",
        "resolution IN ('fixing', 'fixed', 'already_fixed', 'dismissed')",
    ),
    # Owned by an artifact and closed by a resolution are two different ways
    # out of the queue; a row holds at most one.
    (
        "ck_work_artifact_edges_resolution_unclaimed",
        "resolution IS NULL OR to_id IS NULL",
    ),
    (
        "ck_work_artifact_edges_resolution_pr_shape",
        f"resolution_pr ~ '{FOLLOWUP_PR_PATTERN}'",
    ),
    (
        "ck_work_artifact_edges_resolution_commit_shape",
        f"resolution_commit ~ '{FOLLOWUP_COMMIT_PATTERN}'",
    ),
    (
        "ck_work_artifact_edges_resolution_pr_required",
        "resolution IS NULL OR resolution NOT IN ('fixing', 'fixed') "
        "OR resolution_pr IS NOT NULL",
    ),
    # ``already_fixed`` is nothing BUT its commit. ``fixed`` is coord's land
    # verdict, and coord may hold no commit for a land (a PR whose commits
    # landed through another one) — the verdict still stands, so a ``fixed``
    # row carries the commit whenever coord recorded one and is never refused
    # for lacking it.
    (
        "ck_work_artifact_edges_resolution_commit_required",
        "resolution IS DISTINCT FROM 'already_fixed' OR resolution_commit IS NOT NULL",
    ),
    # When the current state was entered — a ``fixing`` row's age reads from it.
    (
        "ck_work_artifact_edges_resolved_at_required",
        "resolution IS NULL OR resolved_at IS NOT NULL",
    ),
    (
        "ck_work_artifact_edges_dismissed_reason",
        "resolution IS DISTINCT FROM 'dismissed' OR (resolution_note IS NOT NULL "
        f"AND btrim(resolution_note, {_TRIM_SET_SQL}) <> '')",
    ),
    # The current-state columns describe the CURRENT state: an open row (never
    # resolved, or reopened) carries none of them. What happened before lives
    # in ``resolution_history``.
    (
        "ck_work_artifact_edges_open_carries_no_resolution",
        "resolution IS NOT NULL OR (resolution_pr IS NULL "
        "AND resolution_commit IS NULL AND resolution_note IS NULL "
        "AND resolved_by IS NULL AND resolved_at IS NULL)",
    ),
    (
        "ck_work_artifact_edges_resolution_history_array",
        "jsonb_typeof(resolution_history) = 'array'",
    ),
    (
        "ck_work_artifact_edges_size_class",
        "size_class IN ('trivial', 'small', 'plan_sized')",
    ),
    (
        "ck_work_artifact_edges_size_class_source",
        "size_class_source IN ('declared', 'sweep')",
    ),
    (
        "ck_work_artifact_edges_size_class_paired",
        "(size_class IS NULL) = (size_class_source IS NULL)",
    ),
    (
        "ck_work_artifact_edges_unanchored_reason_nonblank",
        f"unanchored_reason IS NULL OR btrim(unanchored_reason, {_TRIM_SET_SQL}) <> ''",
    ),
)

#: ``(name, predicate)`` of every CHECK on ``agent.work_artifact_edge_anchors``.
#: A path is repo-relative with forward slashes: non-empty, no leading or
#: trailing ``/`` or space, no backslash (``chr(92)``), no empty, ``.`` or
#: ``..`` segment, no control character. A directory anchor is refused rather
#: than stored, because matching is exact on ``(repo, path)`` and a directory
#: would never match a changed file — an anchor that silently matches nothing.
FOLLOWUP_ANCHOR_CHECKS: tuple[tuple[str, str], ...] = (
    (
        "ck_work_artifact_edge_anchors_repo_shape",
        f"length(repo) <= 255 AND repo ~ '{FOLLOWUP_REPO_PATTERN}'",
    ),
    (
        "ck_work_artifact_edge_anchors_path_shape",
        f"path <> '' AND length(path) <= {FOLLOWUP_ANCHOR_PATH_MAX} "
        "AND left(path, 1) NOT IN ('/', ' ') AND right(path, 1) NOT IN ('/', ' ') "
        "AND strpos(path, chr(92)) = 0 AND strpos(path, '//') = 0 "
        "AND path !~ '(^|/)[.][.]?(/|$)' AND path !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')",
    ),
    (
        "ck_work_artifact_edge_anchors_lines",
        "(line_start IS NULL OR line_start >= 1) AND (line_end IS NULL "
        "OR (line_start IS NOT NULL AND line_end >= line_start))",
    ),
    (
        "ck_work_artifact_edge_anchors_symbol_nonblank",
        f"symbol IS NULL OR btrim(symbol, {_TRIM_SET_SQL}) <> ''",
    ),
)

#: The indexed full-text expression, spelled once and reused.
#:
#: BOTH consumers are built from this one string: ``ix_work_artifacts_search``
#: below, and the API's ``?q=`` predicate in
#: :func:`app.crud.work_artifact._apply_filters`. PostgreSQL matches an
#: expression index by the PARSED expression, so a predicate that merely
#: resembles the indexed expression yields a perfectly healthy-looking index
#: that is never used; reusing the constant is the only thing that keeps the
#: two identical under edits.
#:
#: Spelled UNQUALIFIED (``title``, not ``work_artifacts.title``) because that
#: is what the deployed index actually holds. PostgreSQL *accepts* a
#: table-qualified column reference in ``CREATE INDEX`` but normalizes it away
#: on the way in, so the qualified spelling this constant used to carry was
#: never the thing stored — it only ever agreed with the index by accident of
#: parse-tree equality. Every statement that embeds this string selects from
#: ``work_artifacts`` alone, so the bare column names are unambiguous.
SEARCH_TSVECTOR_SQL = (
    "to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))"
)

_IDENTITY_ORG_EXPR = f"coalesce(organization_id, '{NIL_ORGANIZATION_ID}'::uuid)"

#: Statuses that mean "this artifact is done" — compared against the FIRST
#: token of the normalized status (uppercased, every run of non-alphanumerics
#: collapsed to ``_``, edges trimmed, then the leading ``_``-separated word:
#: ``crud.work_artifact.terminal_token``). The fleet stamps plans
#: ``SHIPPED 2026-09-02`` and the scanner stores that opaquely, so the
#: leading word is the state and the rest is provenance. ``status`` is OPAQUE
#: free-form text by design, so this is a *reading* of it, not a vocabulary:
#: nothing rejects an unlisted status, it simply counts as not-yet-shipped
#: (``IN PROGRESS`` → ``IN``, ``NOT STARTED`` → ``NOT``, neither listed).
#: Used by the candidate read (which lists UNSHIPPED plans) and by
#: ``unmet_depends_on`` (a dependency in one of these states is met).
TERMINAL_STATUSES: frozenset[str] = frozenset(
    {
        "SHIPPED",
        "COMPLETE",
        "COMPLETED",
        "DONE",
        "LANDED",
        "MERGED",
        "ABANDONED",
        "SUPERSEDED",
        "CANCELLED",
        "CANCELED",
        "OBSOLETE",
        "CLOSED",
        "WITHDRAWN",
    }
)


class WorkArtifact(Base):
    """A plan, prompt, report or handoff — the mutable head row.

    ``body`` / ``content_sha256`` / ``current_version`` always describe the
    latest revision; every superseded revision survives in
    :class:`WorkArtifactVersion`.
    """

    __tablename__ = "work_artifacts"
    __table_args__ = (
        # Identity. Functional, NULL-collapsing — a plain UNIQUE over the raw
        # nullable columns would not bind (NULL <> NULL in PostgreSQL).
        Index(
            "uq_work_artifacts_identity",
            text(_IDENTITY_ORG_EXPR),
            text("kind"),
            text("slug"),
            text("coalesce(source_repo, '')"),
            unique=True,
        ),
        # The kind-LESS resolution key the scan-safe upsert path queries on.
        # Deliberately NOT unique: an already-forked corpus (two kinds for one
        # document) must still load so the API can report the ambiguity.
        Index(
            "ix_work_artifacts_scan_identity",
            text(_IDENTITY_ORG_EXPR),
            text("slug"),
            text("coalesce(source_repo, '')"),
        ),
        Index(
            "ix_work_artifacts_kind_locked",
            "kind_locked",
            postgresql_where=text("kind_locked"),
        ),
        Index("ix_work_artifacts_kind_status", "kind", "status"),
        Index("ix_work_artifacts_work_unit_slug", "work_unit_slug"),
        Index("ix_work_artifacts_kind_slug", "kind", "slug"),
        Index("ix_work_artifacts_repos", "repos", postgresql_using="gin"),
        Index("ix_work_artifacts_intent_refs", "intent_refs", postgresql_using="gin"),
        # The keyset walk's index (``plan_library_10_keyset_walk_indexes``):
        # the org scope's NULL-collapsing expression, then the IMMUTABLE
        # ``(created_at, id)`` every plan-library walk keys on (D8).
        Index(
            "ix_work_artifacts_org_created_id",
            text(_IDENTITY_ORG_EXPR),
            "created_at",
            "id",
        ),
        # The body is SEARCH_TSVECTOR_SQL itself, never a copy of it — a
        # second spelling here is exactly the drift the constant exists to
        # prevent, and it stayed invisible for as long as it existed because
        # PostgreSQL compares parse trees rather than strings.
        Index(
            "ix_work_artifacts_search",
            text(SEARCH_TSVECTOR_SQL),
            postgresql_using="gin",
        ),
        # A spec ref names ONE artifact within its organization scope. Mirrors
        # ``plan_library_11_spec_artifacts``.
        Index(
            "uq_work_artifacts_spec_ref",
            text(_IDENTITY_ORG_EXPR),
            text("spec_ref"),
            unique=True,
            postgresql_where=text("spec_ref IS NOT NULL"),
        ),
        CheckConstraint(SPEC_REF_CHECK_SQL, name="ck_work_artifacts_spec_ref"),
        # Mirror ``plan_library_07_plan_difficulty``. NULL passes: unrated.
        CheckConstraint(
            "difficulty IN ('low', 'medium', 'high')",
            name="ck_work_artifacts_difficulty",
        ),
        CheckConstraint(
            "difficulty_conceptual IN ('low', 'medium', 'high')",
            name="ck_work_artifacts_difficulty_conceptual",
        ),
        CheckConstraint(
            "difficulty_implementation IN ('low', 'medium', 'high')",
            name="ck_work_artifacts_difficulty_implementation",
        ),
        CheckConstraint(
            "difficulty_source IN ('declared', 'computed')",
            name="ck_work_artifacts_difficulty_source",
        ),
        {"schema": "agent"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # No FK: rows arrive from runner scans of on-disk markdown whose org is
    # resolved from the scanning principal, not from a guaranteed row. Never
    # accepted from a request body — always derived server-side.
    organization_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )

    created_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )

    kind: Mapped[str] = mapped_column(Text, nullable=False)

    # True once ``kind`` was set DELIBERATELY (an operator/agent upsert or the
    # explicit PATCH .../kind door) rather than guessed by a scanner. The
    # scan-safe upsert path resolves its target ignoring ``kind`` and refuses
    # to move the kind of a locked row — that is what makes a correction
    # survive the next re-scan instead of forking into a second row. See
    # alembic revision ``plan_library_02_kind_lock``.
    kind_locked: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
        default=False,
    )

    slug: Mapped[str] = mapped_column(Text, nullable=False)

    #: The stable, human-readable identifier of a spec-family artifact
    #: (``REQ-0042``); NULL on every other kind. Assigned once, on create, by
    #: ``crud.work_artifact.allocate_spec_ref`` and never rewritten — no
    #: request model carries it. See :data:`SPEC_ARTIFACT_KINDS`.
    spec_ref: Mapped[str | None] = mapped_column(Text, nullable=True)

    title: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )

    # OPAQUE free-form text for every kind outside the spec family — no
    # CHECK, no vocabulary. Plan front-matter statuses are authored by humans
    # and agents ("VETTED", "IN PROGRESS", "SHIPPED", "draft", ...) and the
    # library mirrors what was written rather than policing it. A SPEC kind's
    # status is its lifecycle and IS closed (:data:`SPEC_KIND_STATUSES`,
    # checked by the API, a 422 on a value outside it).
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )

    body: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )

    # Named ``content_sha256`` — NOT ``checksum`` (project.skills) and NOT
    # ``content_hash`` (project.prompt_template_versions). The repo has both
    # spellings and neither says which digest it holds; this store names the
    # algorithm in the column so a reader never has to guess, and the plan
    # standardises every new table on this spelling.
    content_sha256: Mapped[str] = mapped_column(Text, nullable=False)

    source_path: Mapped[str | None] = mapped_column(Text, nullable=True)

    source_repo: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Soft link to a coord work-unit slug. Deliberately FK-less: agent.* is
    # web-owned and coord's tables are coord's, so a cross-schema FK would
    # re-couple what the schema-boundary decoupling separated. It MAY DANGLE
    # — readers treat it as nullable metadata and never 404 on it.
    work_unit_slug: Mapped[str | None] = mapped_column(Text, nullable=True)

    repos: Mapped[list[str]] = mapped_column(
        ARRAY(Text),
        nullable=False,
        server_default=text("'{}'"),
        default=list,
    )

    # Citations to the served coord Intent this artifact bears on
    # (``success_metric/<name>``, ``domain_spec/<name>``). A column rather than
    # an edge because those documents live in coord's deployment, not in
    # ``agent.*``; FK-less for the same reason ``work_unit_slug`` is, and it
    # MAY DANGLE. ``TEXT[]`` not JSONB: the query it serves is containment
    # (``@>``), which ``ix_work_artifacts_intent_refs`` answers directly. See
    # ``plan_library_04_diagnostic_refutes``.
    intent_refs: Mapped[list[str]] = mapped_column(
        ARRAY(Text),
        nullable=False,
        server_default=text("'{}'"),
        default=list,
    )

    # ── Difficulty rating (``plan_library_07_plan_difficulty``) ──────────
    #
    # Derived from ``body`` by ``app.services.plan_difficulty`` for
    # ``kind = 'plan'`` rows only; NULL on every other kind, and NULL on a
    # plan means UNRATED — never "low". ``crud.work_artifact.assign_difficulty``
    # is the one writer. The CHECKs mirror the migration's.
    difficulty: Mapped[DifficultyLevel | None] = mapped_column(Text, nullable=True)
    difficulty_conceptual: Mapped[DifficultyLevel | None] = mapped_column(
        Text, nullable=True
    )
    difficulty_implementation: Mapped[DifficultyLevel | None] = mapped_column(
        Text, nullable=True
    )
    #: ``declared`` (the plan's own ``Difficulty:`` stamp) or ``computed``.
    difficulty_source: Mapped[DifficultySource | None] = mapped_column(
        Text, nullable=True
    )
    #: The rubric version that produced the rating; a row below the running
    #: ``RUBRIC_VERSION`` is re-rated by ``GET /plan-library/difficulty``.
    difficulty_rubric_version: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    #: The measured inputs. ``none_as_null`` so an unrated row is SQL NULL,
    #: not the JSONB scalar ``null`` (see ``plan_scan_root.py``).
    difficulty_signals: Mapped[dict[str, object] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    authored_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    captured_by: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'agent'"),
        default="agent",
    )

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

    versions: Mapped[list["WorkArtifactVersion"]] = relationship(
        "WorkArtifactVersion",
        back_populates="artifact",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="WorkArtifactVersion.version_number",
    )


class WorkArtifactSpecRefCounter(Base):
    """The high-water mark of ``spec_ref`` numbers per organization and kind.

    One row per ``(organization scope, kind)``; ``last_number`` only ever
    increases (``crud.work_artifact.allocate_spec_ref`` bumps it with an
    atomic ``INSERT … ON CONFLICT DO UPDATE … RETURNING``). That is what makes
    a ref never reused: deleting ``REQ-0042`` leaves the counter at 42 or
    beyond. Numbers may have GAPS (a write that rolls back after allocating),
    which is harmless — stability, not density, is the contract.

    ``organization_scope`` is the same NULL-collapsed key the identity index
    uses, so a NULL-org artifact numbers under :data:`NIL_ORGANIZATION_ID`.
    Mirrors ``plan_library_11_spec_artifacts``.
    """

    __tablename__ = "work_artifact_spec_ref_counters"
    __table_args__ = (
        CheckConstraint("last_number >= 1", name="ck_spec_ref_counters_positive"),
        # Only spec kinds are numbered. Mirrors the migration's CHECK, spelled
        # from the same constant so the two cannot drift.
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{k}'" for k in SPEC_ARTIFACT_KINDS) + ")",
            name="ck_spec_ref_counters_kind",
        ),
        {"schema": "agent"},
    )

    organization_scope: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True
    )
    kind: Mapped[str] = mapped_column(Text, primary_key=True)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False)


class WorkArtifactVersion(Base):
    """An immutable snapshot of one revision of a :class:`WorkArtifact`."""

    __tablename__ = "work_artifact_versions"
    __table_args__ = (
        Index(
            "uq_work_artifact_versions_doc_version",
            "document_id",
            "version_number",
            unique=True,
        ),
        {"schema": "agent"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    document_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent.work_artifacts.id", ondelete="CASCADE"),
        nullable=False,
    )

    version_number: Mapped[int] = mapped_column(Integer, nullable=False)

    body: Mapped[str] = mapped_column(Text, nullable=False)

    content_sha256: Mapped[str] = mapped_column(Text, nullable=False)

    change_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    artifact: Mapped["WorkArtifact"] = relationship(
        "WorkArtifact", back_populates="versions"
    )


class WorkArtifactEdge(Base):
    """A directed provenance relation between two work artifacts.

    Usually two-ended. The ONE exception is
    :data:`SPAWNED_FOLLOWUP_RELATION`, whose ``to_id`` is NULL until somebody
    writes the plan that owns the surfaced work — see
    ``plan_library_03_spawned_followup``.
    """

    __tablename__ = "work_artifact_edges"
    __table_args__ = (
        Index(
            "uq_work_artifact_edges_from_to_relation",
            "from_id",
            "to_id",
            "relation",
            unique=True,
        ),
        Index("ix_work_artifact_edges_from_id", "from_id"),
        Index("ix_work_artifact_edges_to_id", "to_id"),
        # Every UNCLAIMED follow-up, whatever its resolution
        # (``plan_library_10_keyset_walk_indexes``). Built when "open" meant
        # ``to_id IS NULL``, so the name predates the closure states; it now
        # serves the walks over the state views (``fixing`` and the resolved
        # ones) and the reconcile's walk over ``fixing``. Not renamed: coord's
        # migration classifier refuses a DROP or a RENAME on the upgrade path,
        # which would park the revision that renamed it.
        Index(
            "ix_work_artifact_edges_open_followups_created_id",
            "created_at",
            "id",
            postgresql_where=text(UNCLAIMED_FOLLOWUP_SQL),
        ),
        # ``/followups``' keyset walk over the OPEN queue — unowned AND
        # unresolved (``plan_library_11_followup_anchors_and_closure``), so a
        # first page never scans the resolved history first.
        Index(
            "ix_work_artifact_edges_open_followup_queue_created_id",
            "created_at",
            "id",
            postgresql_where=text(OPEN_FOLLOWUP_SQL),
        ),
        # The duplicate guard for OPEN follow-ups. The unique index above
        # cannot constrain them — SQL NULLs are distinct, so every null-target
        # row is unique to it regardless of content. Two DIFFERENT follow-ups
        # off one plan must stay legal (a plan can surface several); an
        # identical re-post must not become a second queue entry. Keyed on the
        # note, therefore, and PARTIAL so it can never touch the four shipped
        # relations. Mirrors ``uq_work_artifact_edges_open_followup``.
        Index(
            "uq_work_artifact_edges_open_followup",
            "from_id",
            "relation",
            text(NOTE_TRIM_SQL),
            unique=True,
            postgresql_where=text("to_id IS NULL AND relation = 'spawned_followup'"),
        ),
        # Mirrors ``ck_work_artifact_edges_open_target``. The four shipped
        # relations keep the target guarantee they had before this revision:
        # ``/candidates`` joins ``depends_on`` through ``to_id``, and a null
        # target there would silently drop the row out of the join and report a
        # blocked plan as unblocked.
        CheckConstraint(
            "relation = 'spawned_followup' OR to_id IS NOT NULL",
            name="ck_work_artifact_edges_open_target",
        ),
        # Mirrors ``ck_work_artifact_edges_followup_note``. For an unowned
        # follow-up there is no far end, so the note IS the payload; an empty
        # one records that a plan surfaced *something* and leaves the queue
        # holding a row nobody can act on.
        CheckConstraint(
            "relation <> 'spawned_followup' "
            f"OR (note IS NOT NULL AND {NOTE_TRIM_SQL} <> '')",
            name="ck_work_artifact_edges_followup_note",
        ),
        # The closure columns' fences (``plan_library_11_followup_anchors_and_closure``).
        *(
            CheckConstraint(predicate, name=name)
            for name, predicate in FOLLOWUP_EDGE_CHECKS
        ),
        {"schema": "agent"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    from_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent.work_artifacts.id", ondelete="CASCADE"),
        nullable=False,
    )

    #: NULL only for an OPEN ``spawned_followup`` — work the ``from_id`` plan
    #: surfaced but deliberately did not do, with no owning artifact yet.
    #: ``PATCH /plan-library/edges/{id}`` fills it in when someone claims it,
    #: and the edge then reads like any other two-ended provenance link.
    to_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent.work_artifacts.id", ondelete="CASCADE"),
        nullable=True,
    )

    relation: Mapped[str] = mapped_column(Text, nullable=False)

    #: Optional colour on a normal edge; REQUIRED (and non-blank) on a
    #: ``spawned_followup``, where it is the row's entire content.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    # ── closure (``plan_library_11_followup_anchors_and_closure``) ──────────
    #
    # Valid only on a ``spawned_followup`` (``ck_work_artifact_edges_followup_only_columns``).
    # Written ONLY by ``app.crud.work_artifact_followups.transition_followup``,
    # which locks the row, applies the legal-transition table and appends to
    # ``resolution_history`` in the same write.

    #: :data:`FOLLOWUP_RESOLUTIONS`, or NULL for an OPEN follow-up.
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: ``owner/name#<n>`` — the PR fixing (``fixing``) or that fixed (``fixed``) it.
    resolution_pr: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The land commit (``fixed``) or the earlier fixing commit (``already_fixed``).
    resolution_commit: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Why — required on ``dismissed``.
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Who made the transition into the current state.
    resolved_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: When the current state was entered.
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    #: Append-only ``[{from, to, at, by, pr, commit, note}, ...]``. Never
    #: mutated in place — a write assigns a new list, so SQLAlchemy sees it.
    resolution_history: Mapped[list[dict[str, object]]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
        default=list,
    )

    # ── matching facts (D2) ─────────────────────────────────────────────

    #: :data:`FOLLOWUP_SIZE_CLASSES`, or NULL for UNCLASSIFIED.
    size_class: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: :data:`FOLLOWUP_SIZE_CLASS_SOURCES`; set iff ``size_class`` is.
    size_class_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Why the follow-up carries no anchor, so an unanchored row is VISIBLY
    #: unanchored rather than silently unmatchable.
    unanchored_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class WorkArtifactEdgeAnchor(Base):
    """One file a follow-up is about: ``(repo, path)`` plus line hints.

    Many per follow-up (D2): a finding routinely names several files, in
    several repositories. Matching is EXACT on ``(repo, path)`` —
    ``ix_work_artifact_edge_anchors_repo_path`` answers "the follow-ups on
    these N files" in one query for any diff size. ``line_start`` /
    ``line_end`` / ``symbol`` are hints for whoever folds the fix in, never
    part of the match: lines drift with every commit.

    Rows are only ever written through
    ``app.crud.work_artifact_followups`` (create with the edge, or replaced
    wholesale by ``PUT /plan-library/edges/{edge_id}/anchors``), and deleting
    the edge deletes them (``ON DELETE CASCADE``).
    """

    __tablename__ = "work_artifact_edge_anchors"
    __table_args__ = (
        # One anchor per (follow-up, file, starting line); a line-less anchor
        # collapses onto -1 so two line-less anchors on one file collide too.
        Index(
            "uq_work_artifact_edge_anchors_edge_repo_path_line",
            "edge_id",
            "repo",
            "path",
            text("coalesce(line_start, -1)"),
            unique=True,
        ),
        Index("ix_work_artifact_edge_anchors_repo_path", "repo", "path"),
        *(
            CheckConstraint(predicate, name=name)
            for name, predicate in FOLLOWUP_ANCHOR_CHECKS
        ),
        {"schema": "agent"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    edge_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent.work_artifact_edges.id", ondelete="CASCADE"),
        nullable=False,
    )

    #: ``owner/name``.
    repo: Mapped[str] = mapped_column(Text, nullable=False)
    #: Repo-relative, forward slashes (``ck_work_artifact_edge_anchors_path_shape``).
    path: Mapped[str] = mapped_column(Text, nullable=False)
    line_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    line_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    symbol: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )
