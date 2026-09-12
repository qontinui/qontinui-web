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

Not done here: pruning. A decommissioned device's row persists and simply
reads ``unknown`` (``observation_stale``) forever; removing it is a follow-up.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, case, func, literal_column, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
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
    field the runner no longer reports must not survive from an older one.
    """
    reported = {name: fields.get(name) for name in REPORTED_COLUMNS}
    values: dict[str, Any] = {
        **reported,
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
                for name in REPORTED_COLUMNS
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
    """Every device's latest reading for ``org_id``, most recently received first."""
    stmt = (
        select(PlanScanRootObservation)
        .where(_org_scope(org_id))
        .order_by(
            PlanScanRootObservation.received_at.desc(),
            PlanScanRootObservation.device_id,
        )
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())
