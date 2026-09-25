"""CRUD for per-device plan-scan-source readings (``agent.plan_scan_root_observations``).

Revised Phase 2 of ``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``.

Scoping contract — the plan library's, unchanged: every function takes
``org_id: UUID | None`` derived from the authenticated principal by the
endpoint layer, never from a request body, and matches rows with the same
NULL-collapsing expression the identity index uses, so a principal with no
personal organization reads and writes the NULL bucket consistently.

Upsert contract: ONE row per ``(organization, device)``, overwritten by each
report in a single ``INSERT ... ON CONFLICT DO UPDATE`` — two concurrent
reports from one device cannot race a select-then-insert into an
IntegrityError. ``created_at`` keeps the first report's stamp.

Two clocks, two jobs:

* ``observed_at`` (the runner's clock) ORDERS readings. The reported columns
  are replaced only when the incoming reading was observed at or after the
  stored one (``excluded.observed_at >= observed_at``, per column, in one
  ``CASE``). A report delivered late — a retry that lost a race with a newer
  one, or a runner whose clock stepped back — must not replace the newer
  reading; it is reported as ``applied=False``. Equal timestamps apply, so a
  heartbeat re-post counts. The write route refuses an ``observed_at`` more
  than 300 s in the future, so a skewed runner clock cannot plant a reading
  every later report loses to.
* The SAME statement records the latest report's own verdict:
  ``last_report_applied`` (was it applied?) and ``last_report_observed_at``
  (its ``observed_at``, applied or not). A declined report means the stored
  reading may no longer be what the device says NOW — its clock stepped back,
  or a report was delivered late; this server cannot tell which — so the read
  route renders the row
  ``unknown`` / ``reading_superseded`` until a newer report applies again.
  Keeping the stored reading AND serving it as current was the defect: a
  device that went from 0/0 to 254 behind across a clock step kept reading
  "in step".
* ``received_at`` (this server's clock) records LIVENESS and is stamped on
  EVERY report, applied or not: a device whose report was declined as out of
  order still demonstrably reported, and the read route judges freshness from
  ``received_at`` alone. Stamping only applied writes let a single future-dated
  report freeze the row and age a live device out to ``unknown``.

The slug census (Phase 1 of
``2026-09-15-captured-vs-authored-coverage-is-a-set-difference``) is stored by
the same statement, with ONE departure from the whole-snapshot rule above, and
it is the integrity property the coverage signal rests on:

* A census the device sends WITH ``slugs`` replaces the stored one outright.
* A census the device sends with ``slugs: null`` is the heartbeat form —
  *"unchanged since my last report, and ``digest`` says which set I mean"*.
  The stored stems are KEPT when the incoming digest equals the stored digest,
  and the rest of the census (``count``, ``truncated``, ``ref_sha``) is
  refreshed from the report, because those are this cycle's readings.
* A census with ``slugs: null`` whose digest DOES NOT match what is stored
  **clears the stored stems to UNKNOWN** (``slugs`` stays ``null``). The
  asymmetry is deliberate: the device is asserting a set this server has never
  seen, so keeping the old stems would publish a set difference against stems
  nobody claims any more — exactly the false-coverage reading this plan exists
  to remove. The next report carrying stems restores it.
* A source the report omits entirely sets that column to NULL, under the same
  whole-snapshot rule as every other reported column. NULL is UNKNOWN, never
  an empty side — **SQL NULL**, which is a property of the MODEL
  (``JSONB(none_as_null=True)``) and not of this module: with SQLAlchemy's
  default a Python ``None`` lands as the JSON document ``null``, so
  ``ref_census IS NULL`` reads false and :func:`_resolved_census`'s first arm
  can never fire. See the model's own note.

None of it applies to a report that was not applied: an out-of-order report
leaves the census exactly as the newer reading left it.

Not done here: pruning. A decommissioned device's row persists and simply
reads ``unknown`` (``observation_stale``) forever; removing it is a follow-up.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, case, func, literal_column, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer, undefer
from sqlalchemy.sql.dml import ReturningInsert

from app.models.plan_scan_root import IDENTITY_ORG_SQL, PlanScanRootObservation
from app.models.work_artifact import NIL_ORGANIZATION_ID

#: The columns a report may write. ``organization_id`` / ``device_id`` are
#: absent on purpose — they are the key, supplied by the caller's credential —
#: and so are the two server timestamps.
REPORTED_COLUMNS: tuple[str, ...] = (
    "state",
    "plans_dir",
    "repo_root",
    "source_repo",
    "default_ref",
    "ref_sha",
    "head_sha",
    "behind",
    "ahead",
    "ref_age_secs",
    "counts_are_floors",
    "detail",
    "observed_at",
)


#: The stored census columns, per :data:`CENSUS_SOURCE_COLUMNS`' source, plus
#: the two the report itself supplies. Written by every report — nulls
#: included — under the same whole-snapshot rule as :data:`REPORTED_COLUMNS`,
#: except that the two JSON columns resolve a withheld set (see the module
#: docstring and :func:`_resolved_census`).
CENSUS_SOURCE_COLUMNS: dict[str, tuple[str, str]] = {
    "ref": ("ref_census", "ref_census_digest"),
    "work_tree": ("work_tree_census", "work_tree_census_digest"),
}

#: The census columns a report supplies directly, with no per-source
#: resolution: written like any other reported column.
CENSUS_SCALAR_COLUMNS: tuple[str, ...] = ("census_ref_sha", "census_observed_at")

#: JSON ``null`` as a JSONB value — what ``census -> 'slugs'`` holds when the
#: device withheld the stems, and what a carried-forward set falls back to when
#: there is nothing stored to carry. SQL NULL is a different thing: passing one
#: to ``jsonb_set`` returns NULL and would wipe the census.
_JSONB_NULL = text("'null'::jsonb")

#: ``jsonb_set``'s path argument: the census object's ``slugs`` key.
_SLUGS_PATH = text("'{slugs}'::text[]")


def census_fields(report: dict[str, Any]) -> dict[str, Any]:
    """Flatten a report's ``censuses`` list into its stored columns.

    ``report`` is the request model's ``model_dump()``. A source the report
    does not carry maps to ``None`` for both of its columns — UNKNOWN, which
    is what a build predating the census, an idle cycle and a failed scan all
    report, and which must never be read as an empty side. That ``None``
    reaches Postgres as SQL NULL only because the model declares
    ``JSONB(none_as_null=True)``; see the note beside those columns.

    ``censuses`` is read with ``or []`` because the request model accepts the
    key omitted, ``[]`` and an explicit ``null`` as one state (the runner's
    wire discipline serializes every optional field as an explicit ``null``),
    and because this function is also called with a raw dict by the migration
    test.

    ``census_observed_at`` is the report's own ``observed_at`` whenever ANY
    census rode along, and ``None`` otherwise: the device re-enumerates every
    cycle, so even a census whose stems were withheld was taken then.
    """
    by_source = {census["source"]: census for census in (report.get("censuses") or [])}
    fields: dict[str, Any] = {}
    for source, (json_column, digest_column) in CENSUS_SOURCE_COLUMNS.items():
        census = by_source.get(source)
        fields[json_column] = census
        fields[digest_column] = census["digest"] if census else None
    ref_census = by_source.get("ref")
    fields["census_ref_sha"] = ref_census["ref_sha"] if ref_census else None
    fields["census_observed_at"] = report.get("observed_at") if by_source else None
    return fields


def _resolved_census(
    *,
    json_column: str,
    digest_column: str,
    excluded: Any,
    table: Any,
) -> ColumnElement[Any]:
    """The census to store when an incoming report is applied.

    Four arms, in order:

    1. the report carries no census for this source → ``NULL`` (UNKNOWN).
       This arm is live only because the column is ``JSONB(none_as_null=True)``:
       with the SQLAlchemy default the bound ``None`` is the JSON document
       ``null``, ``incoming.is_(None)`` is false, and the whole ``case``'s
       safety — including never handing ``jsonb_set`` a scalar — rests instead
       on the digest column happening to be SQL NULL so arm 3 is NULL-false.
       The right answer emerged from an undocumented coupling rather than from
       the guard written for it;
    2. it carries the stems → store them;
    3. it withholds them (``slugs: null``) and its digest equals the stored
       one → carry the stored stems forward into this cycle's census;
    4. it withholds them and the digest does NOT match → store the census with
       ``slugs`` still ``null``, clearing the stored set to UNKNOWN rather
       than vouching for stems the device no longer claims.
    """
    incoming = excluded[json_column]
    stored = table.c[json_column]
    return case(
        (incoming.is_(None), text("NULL::jsonb")),
        # ``jsonb_typeof``, not a NULL test: ``census -> 'slugs'`` is JSON
        # ``null`` when the device withheld the stems, which is a VALUE, not
        # SQL NULL. Conflating the two would store a withheld set as a real
        # one.
        (func.jsonb_typeof(incoming["slugs"]) == "array", incoming),
        (
            excluded[digest_column] == table.c[digest_column],
            func.jsonb_set(
                incoming,
                _SLUGS_PATH,
                func.coalesce(stored["slugs"], _JSONB_NULL),
            ),
        ),
        else_=incoming,
    )


def _org_scope(org_id: UUID | None) -> ColumnElement[bool]:
    """The NULL-collapsing organization predicate — the identity index's own."""
    return func.coalesce(
        PlanScanRootObservation.organization_id, NIL_ORGANIZATION_ID
    ) == func.coalesce(org_id, NIL_ORGANIZATION_ID)


def upsert_statement(
    *,
    org_id: UUID | None,
    device_id: UUID,
    fields: dict[str, Any],
    received_at: datetime,
) -> ReturningInsert[tuple[UUID, bool, bool]]:
    """The single-statement upsert, returning ``(id, inserted, applied)``.

    Always returns exactly one row. ``applied`` is the row's
    ``last_report_applied`` after the statement — this report's own verdict.

    Separate from :func:`upsert_observation` so the migration test can run the
    EXACT statement against the alembic-built table: the ``ON CONFLICT``
    target is inferred from the migration's index, and a target that only
    matched the ``create_all`` schema would fail in production and nowhere
    else.

    Keys of ``fields`` outside :data:`REPORTED_COLUMNS` are dropped rather than
    trusted, so nothing a caller supplies can move the key. Every reported
    column is overwritten, nulls included: a reading is a whole snapshot, and a
    field the runner no longer reports must not survive from an older one. The
    census columns are derived from ``fields["censuses"]`` by
    :func:`census_fields` and follow the same rule, with the one withheld-set
    resolution the module docstring states.
    """
    reported = {name: fields.get(name) for name in REPORTED_COLUMNS}
    census = census_fields(fields)
    values: dict[str, Any] = {
        **reported,
        **census,
        "organization_id": org_id,
        "device_id": device_id,
        "received_at": received_at,
        # Written on INSERT only — absent from ``set_`` below — so it keeps the
        # first report's stamp, and equals that report's ``received_at``.
        "created_at": received_at,
        # A first report is trivially applied.
        "last_report_applied": True,
        "last_report_observed_at": reported["observed_at"],
    }
    insert_stmt = pg_insert(PlanScanRootObservation).values(**values)
    table = PlanScanRootObservation.__table__
    # The out-of-order guard. Evaluated against the OLD row for every column
    # (Postgres computes all SET expressions from the pre-update tuple), so
    # ``observed_at`` itself can be one of the guarded columns.
    incoming_is_newer = insert_stmt.excluded.observed_at >= table.c.observed_at
    return insert_stmt.on_conflict_do_update(
        # Must be the identity index's exact expressions for Postgres to infer
        # it — the NULL-collapsed organization, then the device.
        index_elements=[
            literal_column(IDENTITY_ORG_SQL),
            PlanScanRootObservation.device_id,
        ],
        set_={
            **{
                name: case(
                    (incoming_is_newer, insert_stmt.excluded[name]),
                    else_=table.c[name],
                )
                for name in (*REPORTED_COLUMNS, *CENSUS_SCALAR_COLUMNS)
            },
            # The stem census. Same out-of-order guard; the applied arm
            # resolves a withheld set against the stored digest rather than
            # taking the incoming value whole.
            **{
                digest_column: case(
                    (incoming_is_newer, insert_stmt.excluded[digest_column]),
                    else_=table.c[digest_column],
                )
                for _json_column, digest_column in CENSUS_SOURCE_COLUMNS.values()
            },
            **{
                json_column: case(
                    (
                        incoming_is_newer,
                        _resolved_census(
                            json_column=json_column,
                            digest_column=digest_column,
                            excluded=insert_stmt.excluded,
                            table=table,
                        ),
                    ),
                    else_=table.c[json_column],
                )
                for json_column, digest_column in CENSUS_SOURCE_COLUMNS.values()
            },
            # Liveness: stamped whether or not the reading was applied.
            "received_at": insert_stmt.excluded.received_at,
            # This report's own verdict, so the read route can tell a stored
            # reading the device has since contradicted from a current one.
            "last_report_applied": incoming_is_newer,
            "last_report_observed_at": insert_stmt.excluded.last_report_observed_at,
        },
    ).returning(
        PlanScanRootObservation.id,
        # ``xmax = 0`` holds only for a freshly inserted tuple: the standard
        # PostgreSQL tell for which arm of an upsert ran.
        literal_column("(xmax = 0)").label("inserted"),
        PlanScanRootObservation.last_report_applied,
    )


async def upsert_observation(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    device_id: UUID,
    fields: dict[str, Any],
) -> tuple[PlanScanRootObservation, bool, bool]:
    """Store ``device_id``'s latest reading for ``org_id``, replacing an older one.

    Returns ``(row, created, applied)``. ``created`` is ``True`` on the
    device's first report for this organization. ``applied`` is ``False`` when
    the stored reading was observed LATER than this one: the reading is kept,
    ``received_at`` moves, the row is marked ``last_report_applied = false``
    (read as ``reading_superseded``), and ``row`` is the stored reading. See
    :func:`upsert_statement` for what is written.
    """
    stmt = upsert_statement(
        org_id=org_id,
        device_id=device_id,
        fields=fields,
        received_at=datetime.now(UTC),
    )
    result = await db.execute(stmt)
    row_id, inserted, applied = result.one()
    await db.commit()

    row = await db.get(PlanScanRootObservation, row_id, populate_existing=True)
    if row is None:  # pragma: no cover — the statement above just wrote it
        raise RuntimeError(f"scan-root observation {row_id} vanished after upsert")
    return row, bool(inserted), bool(applied)


async def list_observations(
    db: AsyncSession, *, org_id: UUID | None
) -> list[PlanScanRootObservation]:
    """Every device's latest reading for ``org_id``, most recently received first.

    ⚠️ **The two census JSON columns are DEFERRED, and Phase 3's coverage read
    must undefer them** (``.options(undefer(...))`` on its own select, or a
    separate query) — a deferred attribute touched on a loaded row RAISES
    ``sqlalchemy.exc.MissingGreenlet`` here — it is a lazy load, and on the
    ``AsyncSession`` every caller uses there is no greenlet context to run the
    IO in. Not one extra SELECT per row: an unhandled 500. It matters most in
    ``_load_corpus_health``, where ``scan_roots_health`` runs AFTER the
    ``async with db.begin_nested()`` block has exited, so a Phase 3 edit that
    reaches a census there takes down every ``GET /plan-library`` page and
    ``/plan-library/candidates`` rather than merely slowing them.

    Why they are deferred: this function is not only the scan-roots route's.
    ``_load_corpus_health`` calls it, and that block rides EVERY
    ``GET /plan-library`` list page and ``/plan-library/candidates``, while
    ``plan_scan_root_health.render_row`` renders no stem at all — so every
    stored stem was detoasted, transferred, decoded and discarded on every
    page. Measured: 1837 stems ≈ 103.6 KB per census, ≈ 208 KB per device for
    both. At the measured average stem length (53.9 chars) the realistic
    ceiling is ≈ 0.27 MB per census; the schema's WORST case is 5000 × 512,
    ≈ 2.46 MB. (An earlier revision of this comment said ≈ 1.3 MB, which was
    5000 × 255 — the ``_SLUG_MAX`` this same commit raised to 512.) That is also the
    cost the coverage design decision explicitly refused to pay ("would put an
    anti-join over ~1800 slugs on every list request"), arriving by another
    route.

    The digests, ``census_ref_sha`` and ``census_observed_at`` stay loaded:
    they are small, and they are what a reader needs to know a census EXISTS.
    """
    stmt = (
        select(PlanScanRootObservation)
        .options(
            defer(PlanScanRootObservation.ref_census),
            defer(PlanScanRootObservation.work_tree_census),
        )
        .where(_org_scope(org_id))
        .order_by(
            PlanScanRootObservation.received_at.desc(),
            PlanScanRootObservation.device_id,
        )
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def list_observations_with_censuses(
    db: AsyncSession, *, org_id: UUID | None
) -> list[PlanScanRootObservation]:
    """:func:`list_observations`, with the two census JSON columns LOADED.

    Phase 3 of ``2026-09-15-captured-vs-authored-coverage-is-a-set-difference``
    — the coverage set difference needs the stems, and touching a deferred
    attribute on the ``AsyncSession`` every caller uses raises
    ``MissingGreenlet`` rather than emitting a lazy SELECT. That is why this is
    a SEPARATE function rather than a flag on the one above: the coverage read
    is ``GET /plan-library/scan-roots``'s alone (design decision D2), and the
    deferred read stays the default so ``corpus_health.scan_roots`` — which
    rides every ``GET /plan-library`` page and ``/candidates`` — keeps paying
    nothing for stems it renders none of.

    ``populate_existing`` is LOAD-BEARING, not defensive. The two functions can
    run in one request (the scan-roots route does not build a corpus block
    today, but nothing stops a later caller), and SQLAlchemy returns the
    identity map's existing object for a row already loaded — still carrying
    the DEFERRED attribute, so the undefer would be silently discarded and the
    stem access would raise the very ``MissingGreenlet`` this function exists
    to avoid. ``populate_existing`` re-populates the loaded instance from this
    statement's own columns instead.
    """
    stmt = (
        select(PlanScanRootObservation)
        .options(
            undefer(PlanScanRootObservation.ref_census),
            undefer(PlanScanRootObservation.work_tree_census),
        )
        .execution_options(populate_existing=True)
        .where(_org_scope(org_id))
        .order_by(
            PlanScanRootObservation.received_at.desc(),
            PlanScanRootObservation.device_id,
        )
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())
