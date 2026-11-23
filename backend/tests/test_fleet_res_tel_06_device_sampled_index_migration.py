"""Behaviour test for the ``fleet_res_tel_06`` index.

The revision creates one index::

    CREATE INDEX CONCURRENTLY ix_device_resource_samples_device_sampled
    ON coord.device_resource_samples (device_id, sampled_at DESC)

for the coord readers moving off the tenant stamp and onto ``device_id``
(plan ``2026-11-21-coord-sample-readers-outside-fleet-placement-key-on-the-tenant-stamp``
Phase 0). Their read is "the newest sample of ANY lane for this device". The
anchor index ``(device_id, lane, COALESCE(lane_instance, ''), sampled_at
DESC)`` orders ``sampled_at`` only within one lane, so for a device publishing
several lanes it needs a Sort. ``migration-reversal.yml`` would only confirm
the statement executes; the contract is that **the newest-per-device read is
one ordered descent of this index, with no Sort**, so that is what is pinned.

What is asserted
================

1. Nothing named ``ix_device_resource_samples_device_sampled`` exists at the
   parent revision, and there the newest-per-device read does not use it.
   This is the sensitivity half: assertion 3 measures a change of index, not a
   pre-existing one.
2. After upgrade the index exists, is **``indisvalid``** (a killed
   ``CONCURRENTLY`` build leaves an INVALID index that ``IF NOT EXISTS`` would
   skip on re-run), is non-partial, and keys ``(device_id, sampled_at DESC)``.
3. **The read rides it** — with rows across two lanes for the probed device,
   the plan names this index, carries no Sort node and does not use the anchor
   index — and returns the device's true newest ``sampled_at``.
3b. **It still does after ``VACUUM ANALYZE`` sets the visibility map**, the
   state in which an Index Only Scan elsewhere becomes cheap. Autovacuum is
   disabled on the table for the seeded span so no plan above races it; this
   case sets the map deliberately, and the setting is reset afterwards.
3c. **The readers' real shape rides it too** — ``JOIN tenant_devices ... CROSS
   JOIN LATERAL (newest sample, LIMIT 1)`` over a multi-device binding set is a
   Nested Loop of per-device index descents with no Sort node.
4. Idempotency: ``stamp`` back to the parent and ``upgrade`` again leaves the
   same valid index untouched — same oid and same storage file.
5. Downgrade removes it; rows survive.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_definition,
    index_exists,
    index_filenode,
    index_oid,
    index_state,
    run_alembic,
    scalar,
)

_REVISION_ID = "fleet_res_tel_06"
_PARENT_REVISION_ID = "coord_policy_outcome_counts_02"

_INDEX_NAME = "ix_device_resource_samples_device_sampled"
# fleet_res_tel_01's per-(device, lane, lane_instance) anchor index.
_ANCHOR_INDEX_NAME = "idx_device_resource_samples_anchor_sampled"

_DEVICE = "11111111-1111-1111-1111-111111111111"
_OTHER_DEVICES = (
    "22222222-2222-2222-2222-222222222222",
    "33333333-3333-3333-3333-333333333333",
    "44444444-4444-4444-4444-444444444444",
    "55555555-5555-5555-5555-555555555555",
)

# The device-keyed reader's shape: the newest sample of any lane.
_NEWEST_SQL = f"""
    SELECT sampled_at FROM coord.device_resource_samples
     WHERE device_id = '{_DEVICE}'
     ORDER BY sampled_at DESC
     LIMIT 1
"""

# Seed geometry: the probed device publishes 20 rows alternating host / wsl
# lanes, one minute apart, ending a day ago — the stale device a freshness read
# exists to find. Four other devices publish 2000 rows each, all NEWER, so the
# probed device is ~0.25% of the table. With an evenly interleaved seed a
# backward scan of the ``(sampled_at)`` index meets the probed device's row
# almost at once and wins on cost by accident, even with this index present,
# so the probe would not be asking which index serves a device-keyed read;
# a small share is what separates the two paths. The newest probed row is in
# the ``wsl`` lane (offset 1, odd), so no single lane's ordered run can answer
# alone.
_SEED_ROWS = 2000
_PROBED_ROWS = 20


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised.

    The fixture is small, so a seq scan would win on cost regardless.
    ``enable_seqscan = off`` leaves the question being asked: which index
    path does the planner take for this read?
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _device_is_index_cond(plan: str) -> bool:
    """True when ``device_id`` bounds the scan rather than filtering it."""
    return any(
        "Index Cond" in line and "device_id" in line for line in plan.splitlines()
    )


def _has_sort(plan: str) -> bool:
    return any("Sort" in line for line in plan.splitlines())


def _newest(engine: Engine) -> object:
    with engine.connect() as conn:
        return conn.execute(text(_NEWEST_SQL)).scalar_one()


def _expected_newest(engine: Engine) -> object:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT max(sampled_at) FROM coord.device_resource_samples "
                "WHERE device_id = :d"
            ),
            {"d": _DEVICE},
        ).scalar_one()


def _all_visible_pages(engine: Engine) -> int:
    pages = scalar(
        engine,
        "SELECT relallvisible FROM pg_class "
        "WHERE oid = 'coord.device_resource_samples'::regclass",
    )
    assert isinstance(pages, int), pages
    return pages


def _sample_count(engine: Engine) -> object:
    return scalar(engine, "SELECT count(*) FROM coord.device_resource_samples")


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_fleet_res_tel_06_index_serves_newest_sample_per_device() -> None:
    """Add the (device_id, sampled_at DESC) index and prove the read rides it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "fleet_res_tel_06_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)

        # Seed five devices (the probed one plus four newer, busier ones), each
        # alternating host / wsl lanes. Autovacuum off
        # first, so it cannot set the visibility map between two plans below;
        # 3b sets it on purpose.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE coord.device_resource_samples "
                    "SET (autovacuum_enabled = false)"
                )
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, sampled_at, lane, source)
                    SELECT d.id::uuid,
                           now() - d.age - g * interval '1 minute',
                           (ARRAY['host', 'wsl'])[1 + g % 2], 'seed'
                      FROM generate_series(1, :n) AS g,
                           (
                               SELECT :dev AS id, interval '1 day' AS age
                               UNION ALL
                               SELECT o, interval '0' FROM unnest(:others) AS o
                           ) AS d
                     WHERE d.id <> :dev OR g <= :probed
                    """
                ),
                {
                    "n": _SEED_ROWS,
                    "probed": _PROBED_ROWS,
                    "dev": _DEVICE,
                    "others": list(_OTHER_DEVICES),
                },
            )
            conn.execute(text("ANALYZE coord.device_resource_samples"))

        # The probe needs the newest row to sit in a lane other than the
        # lexically-first one, or a per-lane scan could answer by accident.
        with engine.connect() as conn:
            lanes = conn.execute(
                text(
                    "SELECT count(DISTINCT lane) FROM coord.device_resource_samples "
                    "WHERE device_id = :d"
                ),
                {"d": _DEVICE},
            ).scalar_one()
        assert lanes == 2

        # 1. Sensitivity — at the parent the index does not exist to be used.
        parent_plan = _plan_for(engine, _NEWEST_SQL)
        assert _INDEX_NAME not in parent_plan, parent_plan
        # Without it the read is either the anchor index plus a Sort over every
        # lane, or a scan that FILTERS device_id instead of bounding by it.
        assert _has_sort(parent_plan) or not _device_is_index_cond(parent_plan), (
            parent_plan
        )

        # 2. Apply — exists, VALID, non-partial, keyed (device_id, sampled_at DESC).
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        valid, unique, predicate = index_state(engine, _INDEX_NAME)
        indexdef = index_definition(engine, _INDEX_NAME)
        assert valid, (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run — existence is not enough"
        )
        assert not unique, indexdef
        assert predicate == "", f"the index must not be partial: {predicate!r}"
        assert indexdef.endswith("(device_id, sampled_at DESC)"), indexdef

        # 3. The newest-per-device read rides it as one ordered descent.
        # ``begin()``, not ``connect()``: ANALYZE's pg_statistic write is
        # transactional, and a ``connect()`` block rolls back on exit.
        with engine.begin() as conn:
            conn.execute(text("ANALYZE coord.device_resource_samples"))
        plan = _plan_for(engine, _NEWEST_SQL)
        assert _INDEX_NAME in plan, f"the read must ride the index:\n{plan}"
        assert _ANCHOR_INDEX_NAME not in plan, plan
        assert not _has_sort(plan), f"the index must supply the order:\n{plan}"
        assert _device_is_index_cond(plan), plan
        assert _newest(engine) == _expected_newest(engine)

        # 3b. Set the visibility map on purpose and re-plan.
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text("VACUUM ANALYZE coord.device_resource_samples"))
        assert _all_visible_pages(engine) > 0, "VACUUM must have set the map"
        vm_plan = _plan_for(engine, _NEWEST_SQL)
        assert _INDEX_NAME in vm_plan, vm_plan
        assert _ANCHOR_INDEX_NAME not in vm_plan, vm_plan
        assert not _has_sort(vm_plan), vm_plan
        assert _device_is_index_cond(vm_plan), vm_plan
        assert _newest(engine) == _expected_newest(engine)

        # 3c. The readers' real shape: JOIN tenant_devices ... CROSS JOIN LATERAL
        # (newest sample per device, LIMIT 1) — computer_alerts_watcher's
        # MACHINE_COMPUTERS_SQL probe. Over a multi-device binding set the
        # planner must still drive one ordered index descent per device from a
        # Nested Loop, with no Sort anywhere.
        tenant_id = str(uuid4())
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                    "VALUES (CAST(:t AS uuid), :slug, 'fleet_res_tel_06 test tenant')"
                ),
                {"t": tenant_id, "slug": f"fleetrestel06-{uuid4().hex[:8]}"},
            )
            for i, device_id in enumerate((_DEVICE, *_OTHER_DEVICES)):
                conn.execute(
                    text(
                        "INSERT INTO coord.devices "
                        "(device_id, name, hostname, tenant_id, capabilities) "
                        "VALUES (CAST(:d AS uuid), :name, :host, CAST(:t AS uuid), "
                        "CAST('[\"coord_target\"]' AS jsonb))"
                    ),
                    {
                        "d": device_id,
                        "name": f"seed-{i}",
                        "host": f"seed-{i}",
                        "t": tenant_id,
                    },
                )
                conn.execute(
                    text(
                        "INSERT INTO coord.tenant_devices (tenant_id, device_id) "
                        "VALUES (CAST(:t AS uuid), CAST(:d AS uuid))"
                    ),
                    {"t": tenant_id, "d": device_id},
                )
            conn.execute(text("ANALYZE coord.tenant_devices"))
        lateral_sql = f"""
            SELECT max(ds.sampled_at)
              FROM coord.tenant_devices td
             CROSS JOIN LATERAL (
                   SELECT s.sampled_at FROM coord.device_resource_samples s
                    WHERE s.device_id = td.device_id
                    ORDER BY s.sampled_at DESC LIMIT 1) ds
             WHERE td.tenant_id = '{tenant_id}'
        """
        lateral_plan = _plan_for(engine, lateral_sql)
        assert "Nested Loop" in lateral_plan, lateral_plan
        assert _INDEX_NAME in lateral_plan, lateral_plan
        assert _ANCHOR_INDEX_NAME not in lateral_plan, lateral_plan
        # The plain (sampled_at) index with a device_id filter is the near-tie
        # alternative; name it so a planner flap reads as that, not a mystery.
        assert "idx_device_resource_samples_sampled_at" not in lateral_plan, (
            lateral_plan
        )
        assert not _has_sort(lateral_plan), lateral_plan
        assert any(
            "Index Cond" in line and "device_id" in line
            for line in lateral_plan.splitlines()
        ), lateral_plan
        with engine.connect() as conn:
            lateral_newest = conn.execute(text(lateral_sql)).scalar_one()
        assert lateral_newest == scalar(
            engine, "SELECT max(sampled_at) FROM coord.device_resource_samples"
        )

        # 4. Idempotency — re-running over its own schema is a no-op: same oid
        # (not rebuilt), same storage file (not REINDEXed), still valid.
        oid_before = index_oid(engine, _INDEX_NAME)
        filenode_before = index_filenode(engine, _INDEX_NAME)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_oid(engine, _INDEX_NAME) == oid_before
        assert index_filenode(engine, _INDEX_NAME) == filenode_before
        assert index_state(engine, _INDEX_NAME)[0]

        # Seeded span over: restore the table's autovacuum setting.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE coord.device_resource_samples "
                    "RESET (autovacuum_enabled)"
                )
            )

        # 5. Downgrade removes it; rows survive.
        rows_before = _sample_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _sample_count(engine) == rows_before, "downgrade must not delete rows"
