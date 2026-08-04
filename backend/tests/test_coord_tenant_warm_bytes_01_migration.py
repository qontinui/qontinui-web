"""Data-semantics test for the ``coord_tenant_warm_bytes_01`` revision.

Phase 2a of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-07-28-coord-session-output-warm-quota-full-table-sum.md``
creates ``coord.tenant_warm_bytes`` and seeds it from the aggregate it
replaces. The DDL is three lines; the *contract* is everything else — which
tenants get a row, which are represented by ABSENCE, what the counter is
seeded to, and what the CHECK rejects. None of that is visible in a schema
shape, so this test seeds the parent revision, walks one step up, and asserts
the resulting rows.

Why CI does not already cover this
==================================

``migration-reversal.yml`` runs upgrade → downgrade → upgrade against an
**empty** database. The backfill's ``GROUP BY`` yields zero rows there, so the
``INSERT`` inserts nothing, the ``ON CONFLICT`` arm never fires, and the whole
data contract is exercised vacuously. Every assertion below is invisible to
that job.

Cases covered
=============

1. **Backfill arithmetic** — two tenants, several sessions and several chunks
   each, so the ``SUM``/``GROUP BY`` is asserted against a number that only
   the right grouping produces (a per-session or per-chunk grouping gives a
   different one).
2. **A tenant whose session has NO output rows gets NO row** — absence, not a
   zero. This is the whole "a missing row means ZERO" contract from the
   docstring: a zero row would be indistinguishable from a seeded one and
   would quietly become a second component's responsibility to create.
3. **A second ``upgrade()`` pass re-seats a deliberately-wrong counter** —
   ``DO UPDATE`` (not ``DO NOTHING``), which is the repair the docstring
   advertises.
4. **The CHECK rejects a negative write** — on both an ``UPDATE`` of a seeded
   row and an ``INSERT`` of a fresh one, which is where the published upsert
   shape actually lands.
5. **The published clamped upsert works on an ABSENT row, and the naive
   one-armed clamp does not.** The migration's docstring publishes SQL for
   the coord-side consumer to copy; this asserts that what it publishes runs.
6. **The advertised re-run repairs a NEGATIVE counter** — the statement
   ordering fix. ``ADD CONSTRAINT … CHECK`` validates existing rows, so with
   the constraint added before the backfill the one re-run worth doing aborts
   on validation before reaching the backfill that repairs it.

Plus the usual walk: **downgrade** (table gone) and **re-upgrade** (the seed
is re-derivable from ``coord.session_output``, which the counter never owned).

Two guards need no database and therefore never skip: they pin the statement
ORDER inside the revision and the shape of the upsert its docstring publishes.

Substrate comes from ``_alembic_harness`` (shared with the other migration
tests): an ephemeral DB inside the test Postgres, skipped when none is
reachable. ⚠️ A skip proves nothing — point it at a live instance with
``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the one accepting the test
credentials.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
    table_exists,
)

# Pinned explicitly rather than "head" so a later migration landing on top
# cannot silently change what this test walks.
_REVISION_ID = "coord_tenant_warm_bytes_01"
_PARENT_REVISION_ID = "memhold_adjudicate_02"
_REVISION_FILENAME = "coord_tenant_warm_bytes_01_counter_table.py"

_CHECK_NAME = "tenant_warm_bytes_bytes_nonnegative"

# Tenant A: two sessions, four chunks. Tenant B: one session, two chunks.
# Tenant C: one session and NOT ONE output row.
_A_CHUNKS = (10, 20, 30, 5)
_B_CHUNKS = (100, 7)
_EXPECT_A = sum(_A_CHUNKS)  # 65
_EXPECT_B = sum(_B_CHUNKS)  # 107

# The wrong value case 3 plants before the re-run.
_DRIFTED = 999_999


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _revision_source() -> str:
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    return path.read_text(encoding="utf-8")


def test_the_backfill_runs_before_the_constraint_is_added() -> None:
    """Statement order is the repair path, and nothing else enforces it.

    ``ALTER TABLE … ADD CONSTRAINT … CHECK`` VALIDATES existing rows. The
    revision advertises a re-run as the repair for a drifted counter — but the
    drift worth repairing is a counter that has gone NEGATIVE, and adding the
    constraint first aborts that re-run on validation before the backfill it
    needs ever runs. ``test_the_advertised_rerun_repairs_a_negative_counter``
    proves the behaviour end to end; this pins the ordering itself so a later
    editor reshuffling the numbered steps trips here even without a database.
    """
    source = _revision_source()
    # Anchored on the aggregate expression, which appears ONLY in the executed
    # backfill — the phrase "ON CONFLICT ... DO UPDATE" also appears in the
    # docstring, ahead of everything, and would make this assertion vacuous.
    backfill = source.index("SELECT s.tenant_id, COALESCE(SUM(o.compressed_size)")
    add_constraint = source.index("ADD CONSTRAINT tenant_warm_bytes_bytes_nonnegative")
    assert backfill < add_constraint, (
        "the backfill must precede the ADD CONSTRAINT guard, or a re-run "
        "against a negative counter aborts on validation before repairing it"
    )


def test_the_published_upsert_clamps_both_arms() -> None:
    """The docstring publishes SQL for coord to copy; it must be the safe one.

    Two ways to get it wrong, and the docstring has to dodge both:

    * A clamp on the ``DO UPDATE`` arm alone is the natural thing to write and
      is wrong — the conflict action does not run when the row is ABSENT, so a
      decrement against an unseeded tenant inserts the negative value directly
      and trips the CHECK. Reachable on every ``prune_closed_sessions`` tick
      for a tenant created after this migration applied.
    * Clamping the INSERT arm and then adding ``EXCLUDED.bytes`` on the update
      arm is wrong in the other direction: ``EXCLUDED`` carries the CLAMPED
      value, which is 0 for every decrement, so the decrement is silently
      dropped on the conflict path. The published form adds the parameter.
    """
    source = _revision_source()
    assert "VALUES ($1, GREATEST(0, $2))" in source, (
        "the published decrement upsert must clamp the INSERT arm too"
    )
    assert "SET bytes = GREATEST(0, coord.tenant_warm_bytes.bytes + $2)" in source, (
        "the published DO UPDATE arm must add the raw delta, clamped at the floor"
    )
    # EXCLUDED may survive in exactly one place: the labelled WRONG example.
    assert source.count("+ EXCLUDED.bytes)") == 1, (
        "EXCLUDED carries the clamped value (0 for any decrement), so an "
        "EXCLUDED-based DO UPDATE silently drops decrements — it belongs only "
        "in the explicitly-labelled WRONG example"
    )
    assert source.index("-- WRONG.") < source.index("+ EXCLUDED.bytes)")


# ---------------------------------------------------------------------------
# The database walk.
# ---------------------------------------------------------------------------

_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:5433 (or "
        "bring up a backend Postgres) before running this test."
    ),
)


def _seed(engine: Engine) -> dict[str, uuid.UUID]:
    """Seed three tenants at the PARENT revision.

    Seeding must happen before the revision runs: the backfill is one-shot
    DML, so rows inserted afterwards would never be summed.
    """
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    tenant_c = uuid.uuid4()
    device_id = uuid.uuid4()
    session_a1 = uuid.uuid4()
    session_a2 = uuid.uuid4()
    session_b1 = uuid.uuid4()
    session_c1 = uuid.uuid4()

    with engine.begin() as conn:
        for tenant, label in (
            (tenant_a, "a"),
            (tenant_b, "b"),
            (tenant_c, "c"),
        ):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.tenants (tenant_id, slug, display_name)
                    VALUES (:tenant_id, :slug, :display_name)
                    """
                ),
                {
                    "tenant_id": tenant,
                    "slug": f"warmbytes-{label}-{tenant.hex[:12]}",
                    "display_name": f"warm bytes test tenant {label}",
                },
            )

        # One device is enough: coord.sessions.device_id is NOT NULL but the
        # counter is grouped by TENANT, so a shared device is exactly the
        # shape that would break a device-keyed grouping.
        conn.execute(
            text(
                """
                INSERT INTO coord.devices
                    (device_id, tenant_id, name, hostname)
                VALUES (:device_id, :tenant_id, :name, :hostname)
                """
            ),
            {
                "device_id": device_id,
                "tenant_id": tenant_a,
                "name": "warm-bytes-test-device",
                "hostname": "warm-bytes-test-host",
            },
        )

        def session(session_id: uuid.UUID, tenant: uuid.UUID) -> None:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.sessions
                        (id, tenant_id, device_id, session_kind, intent)
                    VALUES (:id, :tenant_id, :device_id, 'agentic',
                            CAST('{}' AS jsonb))
                    """
                ),
                {"id": session_id, "tenant_id": tenant, "device_id": device_id},
            )

        def chunk(session_id: uuid.UUID, offset: int, size: int) -> None:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.session_output
                        (session_id, chunk_offset, payload, compressed_size)
                    VALUES (:session_id, :chunk_offset,
                            :payload, :compressed_size)
                    """
                ),
                {
                    "session_id": session_id,
                    "chunk_offset": offset,
                    "payload": b"x",
                    "compressed_size": size,
                },
            )

        session(session_a1, tenant_a)
        session(session_a2, tenant_a)
        session(session_b1, tenant_b)
        session(session_c1, tenant_c)

        # Tenant A's bytes are spread over TWO sessions, so a grouping keyed
        # on session_id instead of tenant_id produces two rows, not 65.
        chunk(session_a1, 0, _A_CHUNKS[0])
        chunk(session_a1, 1, _A_CHUNKS[1])
        chunk(session_a1, 2, _A_CHUNKS[2])
        chunk(session_a2, 0, _A_CHUNKS[3])

        chunk(session_b1, 0, _B_CHUNKS[0])
        chunk(session_b1, 1, _B_CHUNKS[1])

        # Tenant C's session gets NO chunks at all.

    return {"a": tenant_a, "b": tenant_b, "c": tenant_c}


def _counters(engine: Engine) -> dict[uuid.UUID, int]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT tenant_id, bytes FROM coord.tenant_warm_bytes")
        ).all()
    return {row[0]: int(row[1]) for row in rows}


@_PG_SKIP
def test_coord_tenant_warm_bytes_01_backfills_and_downgrades() -> None:
    """Seed the parent revision, apply the counter table, assert the seed."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_warm_bytes_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", "tenant_warm_bytes")
        tenants = _seed(engine)

        # ----------------------------------------------------------------
        # Apply.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", "tenant_warm_bytes")

        # -- 1. backfill arithmetic ---------------------------------------
        counters = _counters(engine)
        assert counters.get(tenants["a"]) == _EXPECT_A, (
            "tenant A's four chunks span TWO sessions; only a tenant-keyed "
            "GROUP BY over the session join produces one row of 65"
        )
        assert counters.get(tenants["b"]) == _EXPECT_B

        # -- 2. no output rows → NO row, not a zero -----------------------
        assert tenants["c"] not in counters, (
            "a tenant whose sessions hold no output rows is represented by "
            "ABSENCE — a seeded 0 would be indistinguishable from a real "
            "counter and would make row creation a second component's job"
        )
        assert len(counters) == 2, f"exactly two tenants seed a row; got {counters}"

        # The declared column width: compressed_size is INTEGER and prod's sum
        # is already 4.8e8, so an INTEGER counter would be ~4.5x from overflow.
        with engine.connect() as conn:
            data_type = conn.execute(
                text(
                    """
                    SELECT data_type FROM information_schema.columns
                     WHERE table_schema = 'coord'
                       AND table_name = 'tenant_warm_bytes'
                       AND column_name = 'bytes'
                    """
                )
            ).scalar()
        assert data_type == "bigint"

        # -- 4. the CHECK rejects a negative write ------------------------
        with pytest.raises(IntegrityError, match=_CHECK_NAME):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE coord.tenant_warm_bytes SET bytes = -1 "
                        "WHERE tenant_id = :tenant_id"
                    ),
                    {"tenant_id": tenants["a"]},
                )
        with pytest.raises(IntegrityError, match=_CHECK_NAME):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO coord.tenant_warm_bytes (tenant_id, bytes) "
                        "VALUES (:tenant_id, -1)"
                    ),
                    {"tenant_id": tenants["c"]},
                )
        assert _counters(engine) == counters, "a rejected write leaves no residue"

        # -- 5. the published upsert shapes, against an ABSENT row --------
        # The one-armed clamp: the DO UPDATE arm never runs for tenant C, so
        # the negative value goes straight in and the CHECK rejects it.
        with pytest.raises(IntegrityError, match=_CHECK_NAME):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.tenant_warm_bytes (tenant_id, bytes)
                        VALUES (:tenant_id, :delta)
                        ON CONFLICT (tenant_id) DO UPDATE
                          SET bytes = GREATEST(
                                0, coord.tenant_warm_bytes.bytes + EXCLUDED.bytes)
                        """
                    ),
                    {"tenant_id": tenants["c"], "delta": -40},
                )
        # Clamping the INSERT arm but adding EXCLUDED.bytes on the update arm
        # is the OTHER way to get this wrong, and it is worse: EXCLUDED carries
        # the value the insert arm would have written — the already-clamped
        # GREATEST(0, delta), i.e. 0 for any decrement — so the decrement is
        # silently dropped on the conflict path and the counter only ever
        # grows. Silent, permanent, and fails OPEN.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.tenant_warm_bytes (tenant_id, bytes)
                    VALUES (:tenant_id, GREATEST(0, :delta))
                    ON CONFLICT (tenant_id) DO UPDATE
                      SET bytes = GREATEST(
                            0, coord.tenant_warm_bytes.bytes + EXCLUDED.bytes)
                    """
                ),
                {"tenant_id": tenants["a"], "delta": -10},
            )
        assert _counters(engine)[tenants["a"]] == _EXPECT_A, (
            "this is the defect being guarded against, asserted rather than "
            "assumed: the EXCLUDED form is a NO-OP for a decrement"
        )

        # The shape the docstring actually publishes: clamped on both arms,
        # and the update arm adds the RAW delta rather than EXCLUDED.
        clamped_upsert = text(
            """
            INSERT INTO coord.tenant_warm_bytes (tenant_id, bytes)
            VALUES (:tenant_id, GREATEST(0, :delta))
            ON CONFLICT (tenant_id) DO UPDATE
              SET bytes = GREATEST(0, coord.tenant_warm_bytes.bytes + :delta)
            """
        )
        with engine.begin() as conn:
            conn.execute(clamped_upsert, {"tenant_id": tenants["c"], "delta": -40})
        assert _counters(engine)[tenants["c"]] == 0, (
            "the published shape must survive a decrement against an absent "
            "row, landing on the floor instead of aborting the transaction"
        )
        # An ordinary decrement against a SEEDED row must actually decrement.
        with engine.begin() as conn:
            conn.execute(clamped_upsert, {"tenant_id": tenants["a"], "delta": -5})
        assert _counters(engine)[tenants["a"]] == _EXPECT_A - 5
        # And an OVER-decrement lands on the floor rather than going negative.
        with engine.begin() as conn:
            conn.execute(
                clamped_upsert,
                {"tenant_id": tenants["a"], "delta": -(_EXPECT_A + 1)},
            )
        assert _counters(engine)[tenants["a"]] == 0
        # An increment still increments — the clamp must not eat those.
        with engine.begin() as conn:
            conn.execute(clamped_upsert, {"tenant_id": tenants["a"], "delta": 42})
        assert _counters(engine)[tenants["a"]] == 42

        # ----------------------------------------------------------------
        # 3. Re-run over a deliberately-wrong counter — the advertised
        #    repair. `stamp` rewinds only the version marker, so the
        #    backfill re-executes against the table it already seeded.
        # ----------------------------------------------------------------
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.tenant_warm_bytes SET bytes = :wrong "
                    "WHERE tenant_id = :tenant_id"
                ),
                {"wrong": _DRIFTED, "tenant_id": tenants["a"]},
            )
        assert _counters(engine)[tenants["a"]] == _DRIFTED

        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)

        reseated = _counters(engine)
        assert reseated[tenants["a"]] == _EXPECT_A, (
            "DO UPDATE (not DO NOTHING) is what makes the re-run re-seat a "
            "drifted counter to the recomputed truth"
        )
        assert reseated[tenants["b"]] == _EXPECT_B
        assert reseated[tenants["c"]] == 0, (
            "tenant C holds no output rows, so the seed's GROUP BY does not "
            "reach it — the row written above by the clamped upsert is left "
            "exactly as it was, neither re-seated nor deleted"
        )

        # ----------------------------------------------------------------
        # Downgrade — the counter is derived, so the table just goes.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", "tenant_warm_bytes")

        # ----------------------------------------------------------------
        # Re-upgrade — the seed is re-derivable from session_output, which
        # the counter never owned.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        again = _counters(engine)
        assert again == {tenants["a"]: _EXPECT_A, tenants["b"]: _EXPECT_B}, (
            "after a full round trip the seed is exactly the original one, "
            "and tenant C is back to absence"
        )


@_PG_SKIP
def test_the_advertised_rerun_repairs_a_negative_counter() -> None:
    """A counter that has gone NEGATIVE is the one re-run worth doing.

    The revision's whole re-run story is "recompute the SUM and re-seat".
    ``ALTER TABLE … ADD CONSTRAINT … CHECK`` validates existing rows, so if the
    constraint were added before the backfill this run would abort during
    validation — on the exact drift it exists to repair — and roll back without
    ever executing the seed.

    The negative value is planted by dropping the constraint first, because a
    healthy database cannot produce one: that is the point of the CHECK, and it
    is also why this scenario is otherwise unreachable from a test.
    """
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_warm_bytes_repair") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        tenants = _seed(engine)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _counters(engine)[tenants["a"]] == _EXPECT_A

        with engine.begin() as conn:
            conn.execute(
                text(
                    f"ALTER TABLE coord.tenant_warm_bytes DROP CONSTRAINT {_CHECK_NAME}"
                )
            )
            conn.execute(
                text(
                    "UPDATE coord.tenant_warm_bytes SET bytes = -12345 "
                    "WHERE tenant_id = :tenant_id"
                ),
                {"tenant_id": tenants["a"]},
            )
        assert _counters(engine)[tenants["a"]] == -12345

        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)

        assert _counters(engine)[tenants["a"]] == _EXPECT_A, (
            "the re-run must repair the negative counter, not abort on it"
        )
        with engine.connect() as conn:
            restored = conn.execute(
                text(
                    """
                    SELECT EXISTS(
                        SELECT 1
                          FROM pg_constraint c
                          JOIN pg_class t ON t.oid = c.conrelid
                          JOIN pg_namespace n ON n.oid = t.relnamespace
                         WHERE n.nspname = 'coord'
                           AND t.relname = 'tenant_warm_bytes'
                           AND c.conname = :name
                    )
                    """
                ),
                {"name": _CHECK_NAME},
            ).scalar()
        assert restored, (
            "the DO $$ guard must re-attach the CHECK the repair run dropped "
            "— and it can only do that after the backfill made the rows valid"
        )
