"""Per-device plan-scan-source readings — ``agent.plan_scan_root_observations``.

Revised Phase 2 of ``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``.
Mirrors alembic revision ``plan_library_05_scan_root_observations``; read that
migration's docstring for why the table exists and why its key is what it is.

One row per ``(organization, device)``: the LATEST reading that device's runner
made of the directory its plan-library body sync scans — how far that git work
tree is from its default branch, and how fresh the ref it measured against is.
Each report newer than the stored one (by ``observed_at``) overwrites the
reading, and EVERY report stamps ``received_at``. There is no history: the
question this row answers is "what does the corpus's feeder on device D look
like now", and a device not heard from within the freshness window (by
``received_at``, this server's clock) is rendered ``unknown`` by the read route
rather than kept around as a series.

The fields are the runner's ``ScanDivergence``
(``qontinui-runner/src-tauri/src/plan_workunit_adapter/trigger.rs``) plus
``ref_age_secs`` / ``counts_are_floors`` (this plan's Revised Phase 1) and
``source_repo``, carried verbatim. ``device_id`` is NEVER a request field — it
is the verified device token's ``device_id`` claim.

The census columns are Phase 1 of
``2026-09-15-captured-vs-authored-coverage-is-a-set-difference``: the stem
listings the device enumerated on each of the two sides it scans, which is the
denominator a coverage set difference is taken against. They are nullable
because the fleet that existed when they landed sends none, and a NULL is
UNKNOWN, never an empty side.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.work_artifact import NIL_ORGANIZATION_ID

#: The four states a runner's reading can be in. Enforced in Postgres by
#: ``ck_plan_scan_root_observations_state``; mirrored as a ``Literal`` on the
#: request schema so a bad value is a 422, not an IntegrityError 500. Spelled
#: exactly as the runner's ``ScanDivergenceState`` serializes.
#:
#: This tuple is the ONE copy the code derives from — :data:`STATE_CHECK_SQL`
#: below builds this model's CHECK out of it, and
#: ``tests/test_plan_scan_root_state_vocabulary.py`` pins the two copies it
#: cannot reach (the request schema's ``Literal``, and the shipped migration's
#: own CHECK, which is history and must never be rewritten) against it. Adding
#: a fifth state without updating those is a silent drift that Postgres would
#: only surface as a 500 on the first device to report it.
#:
#: The operator console's copy (``SCAN_ROOT_STATES`` in the frontend's
#: ``admin/coord/plan-library/types.ts``) is across a language seam this suite
#: does not parse. ``types.wire.test.ts`` beside it pins it against the
#: committed OpenAPI snapshots, which backend CI regenerates from this app's
#: schema.
SCAN_ROOT_STATES: tuple[str, ...] = (
    "measured",
    "not_scanning",
    "not_a_git_work_tree",
    "unknown",
)

#: The model's ``state`` CHECK, built from :data:`SCAN_ROOT_STATES` rather than
#: restating it. Byte-identical to the literal this replaced, and to the
#: shipped migration's clause modulo whitespace — which is the property the
#: vocabulary test asserts rather than assumes.
STATE_CHECK_SQL = "state IN ({})".format(
    ", ".join(f"'{state}'" for state in SCAN_ROOT_STATES)
)

#: The NULL-collapsing organization expression of the identity index, spelled
#: once. The upsert's ``ON CONFLICT`` target must be this exact expression for
#: Postgres to infer the index, so both are built from this string.
IDENTITY_ORG_SQL = f"coalesce(organization_id, '{NIL_ORGANIZATION_ID}'::uuid)"


class PlanScanRootObservation(Base):
    """The latest scan-source reading one device reported for one organization."""

    __tablename__ = "plan_scan_root_observations"
    __table_args__ = (
        # Identity — one row per (org, device). NULL-collapsing for the same
        # reason ``uq_work_artifacts_identity`` is: a plain UNIQUE over a
        # nullable column does not bind (NULL <> NULL), and a principal with no
        # personal organization is scoped to the NULL bucket by the same
        # resolver the artifact upsert uses.
        Index(
            "uq_plan_scan_root_observations_identity",
            text(IDENTITY_ORG_SQL),
            text("device_id"),
            unique=True,
        ),
        CheckConstraint(
            STATE_CHECK_SQL,
            name="ck_plan_scan_root_observations_state",
        ),
        CheckConstraint(
            "(behind IS NULL OR behind >= 0) "
            "AND (ahead IS NULL OR ahead >= 0) "
            "AND (ref_age_secs IS NULL OR ref_age_secs >= 0)",
            name="ck_plan_scan_root_observations_counts_nonnegative",
        ),
        {"schema": "agent"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # No FK, matching ``agent.work_artifacts.organization_id``: the scope is
    # derived from the reporting principal's personal organization and may be
    # the NULL bucket. Never accepted from a request body.
    organization_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )

    # The verified device token's ``device_id`` claim. FK-less for the same
    # reason: the device registry is coord's, not this schema's.
    device_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)

    state: Mapped[str] = mapped_column(Text, nullable=False)
    plans_dir: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_root: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_repo: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    ref_sha: Mapped[str | None] = mapped_column(Text, nullable=True)
    head_sha: Mapped[str | None] = mapped_column(Text, nullable=True)

    # BIGINT because the runner's fields are ``u64``; the request schema caps
    # them at the BIGINT ceiling so an out-of-range value is a 422.
    behind: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ahead: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ref_age_secs: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    counts_are_floors: Mapped[bool] = mapped_column(Boolean, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: When the RUNNER took the reading (its clock).
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    #: When THIS server received the device's latest report (our clock) —
    #: stamped on every report, including one declined as out of order. The
    #: only stamp liveness is judged from.
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )

    #: Whether the device's LATEST report was applied. ``False`` means its
    #: latest report was observed before the stored reading (a clock step-back
    #: or a late-delivered report): the stored reading may not be what the
    #: device says now, and the read route renders ``reading_superseded``.
    last_report_applied: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )

    #: The ``observed_at`` of the device's latest report, applied or not. Equal
    #: to ``observed_at`` while ``last_report_applied``; otherwise earlier — by
    #: the N the ``reading_superseded`` detail reports.
    last_report_observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # --- The slug census (Phase 1 of
    # ``2026-09-15-captured-vs-authored-coverage-is-a-set-difference``).
    #
    # All nullable, and NULL is UNKNOWN rather than "no plans": a device whose
    # build predates the census — the entire fleet at the time these columns
    # landed — reports none, and an idle or failed scan cycle sends none
    # either. The enumerated set is what a coverage set difference is taken
    # against, so a NULL here must never be read as an empty side.
    #
    # ⚠️ ``JSONB(none_as_null=True)`` is LOAD-BEARING on the two JSON columns,
    # and the default (``False``) silently broke that sentence. SQLAlchemy's
    # JSON types serialize a Python ``None`` as the JSON DOCUMENT ``null`` by
    # default, so "absent census" stored a JSONB scalar ``null``:
    # ``ref_census IS NULL`` read FALSE and ``jsonb_typeof(ref_census)`` read
    # ``'null'``. Three things that costs, all real:
    #
    #   * ``_resolved_census``'s first arm (``incoming.is_(None)``) can never
    #     fire — it tests SQL NULL against a JSONB null. The right census still
    #     emerged, but only because the DIGEST column really is SQL NULL, so a
    #     later arm's comparison was NULL-false and control fell to ``else_``.
    #     The guard written for the case, including keeping ``jsonb_set`` off a
    #     scalar, was resting on an undocumented coupling.
    #   * A Phase 3 ``WHERE ref_census IS NOT NULL`` meaning "this device has a
    #     census" would be TRUE for every UNKNOWN row — one ``COALESCE(…, 0)``
    #     from the false zero this whole plan exists to delete.
    #   * Two encodings of UNKNOWN would coexist: rows from
    #     ``ALTER TABLE ADD COLUMN`` hold real SQL NULL, rows written after it
    #     held JSONB ``null``.
    #
    # No test could see any of it: JSONB ``null`` deserializes to Python
    # ``None``, so ``row.ref_census is None`` passes either way. The migration
    # test now asserts ``ref_census IS NULL`` and ``jsonb_typeof(ref_census)``
    # in raw SQL, which is the only place the two are distinguishable.
    #
    # This says nothing about ``slugs`` INSIDE a stored census: that really is
    # a JSON ``null`` when the device withheld the stems (``none_as_null``
    # governs the top-level value only), and ``_resolved_census`` reads it with
    # ``jsonb_typeof`` for exactly that reason.
    #
    # Each census column holds the whole ``PlanSlugCensus`` object as the
    # device sent it (``source``, ``ref_sha``, ``count``, ``digest``,
    # ``slugs``, ``truncated``), with ONE resolution applied by the upsert:
    # ``slugs`` is carried forward from the stored census when the device
    # withheld it and the digest matches, and left ``null`` — UNKNOWN — when it
    # does not. See ``app.crud.plan_scan_root``.

    #: The stems listed at ``default_ref``, the side the work-unit half reads.
    ref_census: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    #: ``ref_census``'s digest, lifted out so the upsert can compare a withheld
    #: set's claim against what is stored without unpacking the JSON.
    ref_census_digest: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: The stems listed in the scanned WORKING TREE — the side the body sync
    #: reads, and therefore the only side that bounds what the corpus could
    #: possibly have captured.
    work_tree_census: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    #: ``work_tree_census``'s digest, for the same reason.
    work_tree_census_digest: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: What ``default_ref`` pointed at when the ``ref`` census was listed. May
    #: differ from ``ref_sha`` above, which is the reading's ref.
    census_ref_sha: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: The runner's clock when it took the report that carried a census. NULL
    #: when the stored reading carried none. Equal to ``observed_at`` for the
    #: report that wrote it, including a report that withheld the stems: the
    #: device re-enumerates every cycle and the digest re-asserts the set, so
    #: the enumeration behind a carried-forward set is that cycle's.
    census_observed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    #: When this device first reported for this organization.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )
