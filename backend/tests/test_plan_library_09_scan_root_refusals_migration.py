"""Round-trip + upsert-target test for ``plan_library_09_scan_root_refusals``.

Phase 1 of ``2026-09-11-scan-root-readings-hide-refused-contact-and-never-prune``.

The API suite runs against a ``create_all`` schema built from the MODEL, so it
cannot notice a migration that disagrees with the model. As for the readings'
table (``plan_library_05``), the disagreement that would bite only in
production is the upsert's ``ON CONFLICT`` target, so the walk below runs the
crud's EXACT refusal statement
(:func:`app.crud.plan_scan_root.refusal_upsert_statement`) against the
alembic-built table and asserts one row per ``(organization, device)`` whose
count climbs while ``first_refused_at`` stays put.

Also asserted: the table, its identity index and both CHECKs land; the NULL
organization bucket is one row per device; and head → downgrade to the parent
BY NAME → head leaves no residue.

Substrate is ``tests/_alembic_harness``. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:<port>``.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app.crud.plan_scan_root import refusal_upsert_statement
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
    table_exists,
)

_REVISION_ID = "plan_library_09_scan_root_refusals"
_PARENT_REVISION_ID = "coord_sessev_interact_idx_01"
_REVISION_FILENAME = "plan_library_09_scan_root_refusals.py"
_TABLE = "plan_scan_root_refusals"


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def test_down_revision_pins_the_parent_on_one_line() -> None:
    match = re.search(
        r'^down_revision = "(?P<parent>[^"]+)"$',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None, "down_revision must be one unannotated line"
    assert match.group("parent") == _PARENT_REVISION_ID


def test_the_revision_id_is_unique_in_the_chain() -> None:
    versions = backend_root() / "alembic" / "versions"
    same_id = [
        path.name
        for path in versions.glob("*.py")
        if re.search(
            rf'^revision[^=]*=\s*["\']{re.escape(_REVISION_ID)}["\']',
            path.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
    ]
    assert same_id == [_REVISION_FILENAME]


def test_the_migration_nil_uuid_is_the_models() -> None:
    from app.models.work_artifact import NIL_ORGANIZATION_ID

    assert f'_NIL_UUID = "{NIL_ORGANIZATION_ID}"' in _revision_source()


def test_the_migration_reason_bound_is_the_models() -> None:
    from app.models.plan_scan_root import REFUSAL_REASON_MAX

    assert f"char_length(last_refused_reason) <= {REFUSAL_REASON_MAX}" in (
        _revision_source()
    )


_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:<port> "
        "before running this test."
    ),
)


def _refuse(
    engine: Engine,
    *,
    org_id: uuid.UUID | None,
    device_id: uuid.UUID,
    reason: str = "body.observed_at: value_error",
    refused_at: datetime | None = None,
) -> None:
    stmt = refusal_upsert_statement(
        org_id=org_id,
        device_id=device_id,
        reason=reason,
        refused_at=refused_at or datetime.now(UTC),
    )
    with engine.begin() as conn:
        conn.execute(stmt).one()


def _rows(engine: Engine, device_id: uuid.UUID) -> list[tuple[object, ...]]:
    with engine.connect() as conn:
        return [
            tuple(r)
            for r in conn.execute(
                text(
                    f"SELECT organization_id, refused_count, first_refused_at, "
                    f"last_refused_at, last_refused_reason FROM agent.{_TABLE} "
                    "WHERE device_id = :d"
                ),
                {"d": device_id},
            )
        ]


def _indexes(engine: Engine) -> dict[str, str]:
    with engine.connect() as conn:
        return {
            r.indexname: r.indexdef
            for r in conn.execute(
                text(
                    "SELECT indexname, indexdef FROM pg_indexes "
                    "WHERE schemaname = 'agent' AND tablename = :t"
                ),
                {"t": _TABLE},
            )
        }


def _checks(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        return {
            r.conname
            for r in conn.execute(
                text(
                    """
                    SELECT con.conname
                      FROM pg_constraint con
                      JOIN pg_class rel ON rel.oid = con.conrelid
                      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                     WHERE nsp.nspname = 'agent' AND rel.relname = :t
                       AND con.contype = 'c'
                    """
                ),
                {"t": _TABLE},
            )
        }


@_PG_SKIP
def test_upgrade_upsert_downgrade_upgrade_round_trip() -> None:
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "planlib_refusals") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        assert table_exists(engine, "agent", _TABLE)
        identity = _indexes(engine)["uq_plan_scan_root_refusals_identity"]
        assert "UNIQUE" in identity
        assert "COALESCE(organization_id" in identity
        assert _checks(engine) == {
            "ck_plan_scan_root_refusals_reason_length",
            "ck_plan_scan_root_refusals_count_positive",
        }

        org = uuid.uuid4()
        device = uuid.uuid4()
        first = datetime.now(UTC) - timedelta(minutes=5)
        later = datetime.now(UTC)
        _refuse(engine, org_id=org, device_id=device, refused_at=first)
        _refuse(
            engine,
            org_id=org,
            device_id=device,
            reason="body.state: literal_error",
            refused_at=later,
        )
        assert _rows(engine, device) == [
            (org, 2, first, later, "body.state: literal_error")
        ]

        # The NULL bucket is one row per device too.
        bucketless = uuid.uuid4()
        _refuse(engine, org_id=None, device_id=bucketless)
        _refuse(engine, org_id=None, device_id=bucketless)
        [(bucket_org, bucket_count, *_rest)] = _rows(engine, bucketless)
        assert (bucket_org, bucket_count) == (None, 2)

        # The reason bound is a live backstop behind ``refusal_reason``.
        with pytest.raises(IntegrityError):
            _refuse(engine, org_id=org, device_id=uuid.uuid4(), reason="x" * 513)

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "agent", _TABLE)
        assert _indexes(engine) == {}

        run_alembic(root, db_url, "upgrade", "head")
        assert table_exists(engine, "agent", _TABLE)
        assert "uq_plan_scan_root_refusals_identity" in _indexes(engine)
