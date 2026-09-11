"""Round-trip + upsert-target test for ``plan_library_05_scan_root_observations``.

Revised Phase 2 (web half) of
``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``.

The API suite (``tests/test_plan_library_scan_roots.py``) runs against a
``create_all`` schema built from the MODEL, so it cannot notice a migration
that disagrees with the model. The one disagreement that would bite only in
production is the upsert's ``ON CONFLICT`` target: Postgres infers the unique
index from the target's expressions, so a target that matches the model's
index but not the migration's is an error on the first report and nowhere
else. The walk below therefore runs the crud's EXACT statement
(:func:`app.crud.plan_scan_root.upsert_statement`) against the alembic-built
table, twice for one device, and asserts one row.

Also asserted: the table, its identity index and both CHECKs land; the NULL
organization bucket is one row per device (the reason the index is
NULL-collapsing); and head → downgrade to the parent BY NAME → head leaves no
residue.

Substrate is ``tests/_alembic_harness``. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:<port>`` when 5432 is not the
one accepting the test credentials.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app.crud.plan_scan_root import upsert_statement
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
    table_exists,
)

_REVISION_ID = "plan_library_05_scan_root_observations"
_PARENT_REVISION_ID = "devenv_10_unique_active_coord_device"
_REVISION_FILENAME = "plan_library_05_scan_root_observations.py"
_TABLE = "plan_scan_root_observations"


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_down_revision_pins_the_parent() -> None:
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None
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
    assert same_id == [_REVISION_FILENAME], (
        f"revision id {_REVISION_ID!r} is claimed by {same_id}"
    )


def test_the_migration_nil_uuid_is_the_models() -> None:
    """The index folds NULL onto a sentinel the upsert target must repeat."""
    from app.models.work_artifact import NIL_ORGANIZATION_ID

    assert f'_NIL_UUID = "{NIL_ORGANIZATION_ID}"' in _revision_source()


# ---------------------------------------------------------------------------
# The database walk.
# ---------------------------------------------------------------------------

_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:<port> "
        "before running this test."
    ),
)


def _reading(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "state": "measured",
        "plans_dir": "/p/plans",
        "repo_root": "/p",
        "source_repo": "p/plans",
        "default_ref": "origin/main",
        "ref_sha": "a" * 40,
        "head_sha": "b" * 40,
        "behind": 254,
        "ahead": 0,
        "ref_age_secs": 220,
        "counts_are_floors": False,
        "detail": None,
        "observed_at": datetime.now(UTC),
    }
    body.update(overrides)
    return body


def _upsert(
    engine: Engine, *, org_id: uuid.UUID | None, device_id: uuid.UUID, **fields: object
) -> bool:
    """Run the crud's own statement; return whether it INSERTED."""
    stmt = upsert_statement(
        org_id=org_id,
        device_id=device_id,
        fields=_reading(**fields),
        received_at=datetime.now(UTC),
    )
    with engine.begin() as conn:
        _row_id, inserted = conn.execute(stmt).one()
    return bool(inserted)


def _rows(engine: Engine, device_id: uuid.UUID) -> list[tuple[object, ...]]:
    with engine.connect() as conn:
        return [
            tuple(r)
            for r in conn.execute(
                text(
                    f"SELECT organization_id, behind, state FROM agent.{_TABLE} "
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

    with ephemeral_database(admin_url, "planlib_scanroot") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", "head")

        assert table_exists(engine, "agent", _TABLE)
        indexes = _indexes(engine)
        identity = indexes["uq_plan_scan_root_observations_identity"]
        assert "UNIQUE" in identity
        assert "COALESCE(organization_id" in identity
        assert _checks(engine) == {
            "ck_plan_scan_root_observations_state",
            "ck_plan_scan_root_observations_counts_nonnegative",
        }

        # The crud's exact ON CONFLICT target infers the MIGRATION's index:
        # the second report for one (org, device) overwrites the first.
        org = uuid.uuid4()
        device = uuid.uuid4()
        assert _upsert(engine, org_id=org, device_id=device, behind=254) is True
        assert _upsert(engine, org_id=org, device_id=device, behind=3) is False
        assert _rows(engine, device) == [(org, 3, "measured")]

        # The NULL bucket is one row per device too — the reason the index is
        # NULL-collapsing rather than a plain UNIQUE (NULL <> NULL).
        bucketless = uuid.uuid4()
        assert _upsert(engine, org_id=None, device_id=bucketless) is True
        assert _upsert(engine, org_id=None, device_id=bucketless, behind=9) is False
        assert _rows(engine, bucketless) == [(None, 9, "measured")]

        # The same device under a different org is a different row.
        assert _upsert(engine, org_id=uuid.uuid4(), device_id=device) is True
        assert len(_rows(engine, device)) == 2

        # The CHECKs are live backstops behind the request schema.
        for bad in (
            {"state": "exact"},
            {"behind": -1},
            {"ref_age_secs": -1},
        ):
            with pytest.raises(IntegrityError):
                _upsert(engine, org_id=org, device_id=uuid.uuid4(), **bad)

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "agent", _TABLE)
        assert _indexes(engine) == {}

        run_alembic(root, db_url, "upgrade", "head")
        assert table_exists(engine, "agent", _TABLE)
        assert "uq_plan_scan_root_observations_identity" in _indexes(engine)
