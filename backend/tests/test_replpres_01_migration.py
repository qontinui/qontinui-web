"""Schema-contract test for the ``replpres_01`` revision.

``replpres_01_replica_presence`` creates ``coord.replica_presence`` — Phase W1
of plan
``2026-08-11-wedged-follower-indistinguishable-from-departed-replica``
(qontinui-web#1015). The DDL is four columns and one index; the *contract* is
everything a consumer in another repo assumes about them, and none of that is
visible in the shape alone.

Why CI does not already cover this
==================================

``migration-reversal.yml`` walks upgrade → downgrade → upgrade on any PR
touching ``backend/alembic/versions/**``, so reversibility is covered and this
file does not exist for it. What that job cannot see is that every property
below is a **silent-wrong-answer**: each one applies cleanly and then hands the
roll gate a wrong verdict rather than raising.

And the consumer is in a different repository. ``coord.replica_presence`` is
read and written only by ``qontinui-coord``
(``crates/coord/src/replica_presence.rs``, ``worker_ledger.rs``); web makes
**zero** direct reads of ``coord.*`` and is forbidden from growing one
(``test_coord_schema_boundary_guard.py``). So nothing in this repo — no ORM
model, no query, no fixture — would notice if a later revision renamed a
column, widened a type, or handed ``dedicated_pool`` a default. The only place
that contract can be pinned on the authoring side is here.

What is asserted, and why each one is unsafe-if-wrong
====================================================

1. **``dedicated_pool`` has no default, and an INSERT omitting it fails.**
   The revision's own comment calls this load-bearing: ``false`` means the row
   was written on the DEGRADED shared pool and the consumer must read it as
   UNKNOWN. A ``server_default`` would let a writer that cannot state which
   pool it used inherit an optimistic answer, and UNKNOWN would quietly become
   "alive on the dedicated pool" — the direction that withholds a bounce from
   a wedged process. Asserted twice: once from the revision SOURCE (no
   database, never skips) and once by falsification against a real Postgres.

2. **``heartbeat_at`` / ``boot_at`` are ``timestamptz``.** Staleness is decided
   by comparing ``heartbeat_at`` against the lease TTL. A naive
   ``timestamp`` would apply cleanly, accept every write, and then be wrong by
   the session's UTC offset — a live follower reading as hours stale, i.e.
   DEPARTED, i.e. the exact false verdict this table exists to prevent. Proven
   behaviourally as well as from the catalog: the same row read back under a
   different session ``TIME ZONE`` must be the same instant.

3. **``replica_id`` is the primary key.** It is the conflict target of coord's
   upsert (``ON CONFLICT (replica_id)``); without it every election tick on
   every replica appends a row instead of updating one, and the table grows at
   the cadence rather than at the redeploy rate.

4. **Coord's landed statements actually run against this table.** All three —
   the presence upsert, the retention DELETE the index exists for, and the
   loader whose age the roll gate grades — are transcribed below from
   ``qontinui-coord`` (``crates/coord/src/replica_presence.rs`` and
   ``worker_ledger.rs``) and executed here. That is the
   ``coord_tenant_warm_bytes_01`` precedent — the migration that publishes SQL
   for a coord-side consumer asserts that what it publishes runs — applied to
   a consumer that has since landed, so the transcription is of shipped code
   rather than of a proposal.

5. **The upsert advances ``heartbeat_at`` and leaves ``boot_at`` alone.**
   ``boot_at`` is what makes uptime truthful in the ``coord_query_workers``
   drill-down; a ``DO UPDATE`` that re-seated it would report every replica as
   just-booted, forever, without ever erroring.

6. **The upsert can DEMOTE ``dedicated_pool`` to false.** A replica whose
   dedicated lease pool fails mid-life must be able to overwrite its own
   earlier trustworthy row, or the consumer keeps reading a stale ``true`` and
   treats an untrustworthy signal as evidence of life.

7. **The index is on ``heartbeat_at``.** Advisory, not a correctness
   dependency (the sweep works, slower, without it) — but an index that exists
   under the right name on the wrong column is indistinguishable from a
   working one until the table is large.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point
it at a live instance with ``QONTINUI_TEST_PG=host:port`` (or
``DATABASE_URL``) if 5432 is not the one accepting the test credentials. The
two source guards at the end of this file need no database and therefore never
skip.
"""

from __future__ import annotations

import ast
import re
import uuid
from datetime import datetime

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks.
_REVISION_ID = "replpres_01"
_PARENT_REVISION_ID = "memseq_01"

_TABLE = "replica_presence"
_INDEX = "replica_presence_heartbeat_at_idx"

# The exact column contract. `(data_type, is_nullable, has_default)`.
#
# `has_default` is False for every column ON PURPOSE, and for `dedicated_pool`
# that is the load-bearing one — see item 1 in the module docstring.
_EXPECTED_COLUMNS: dict[str, tuple[str, bool, bool]] = {
    "replica_id": ("uuid", False, False),
    "heartbeat_at": ("timestamp with time zone", False, False),
    "boot_at": ("timestamp with time zone", False, False),
    "dedicated_pool": ("boolean", False, False),
}

# ---------------------------------------------------------------------------
# Coord's shipped statements, transcribed.
#
# Sources, all on qontinui-coord `origin/main`:
# `crates/coord/src/replica_presence.rs` — `write_presence`,
# `prune_replica_presence`; `crates/coord/src/worker_ledger.rs` —
# `load_replica_presence`. The ONLY edit is the bind style: tokio-postgres'
# `$1`/`$2` become SQLAlchemy named binds, because the two drivers spell
# parameters differently and nothing else about the statements is allowed to
# drift.
#
# Keeping a copy here is deliberate. The alternative — asserting only the
# catalog shape — passes just as happily against a table no consumer can use,
# which is the failure mode a cross-repo schema contract has and a same-repo
# one does not.
# ---------------------------------------------------------------------------
_COORD_UPSERT = text(
    """
    INSERT INTO coord.replica_presence
        (replica_id, heartbeat_at, boot_at, dedicated_pool)
    VALUES (:replica_id, now(), now(), :dedicated_pool)
    ON CONFLICT (replica_id) DO UPDATE
    SET heartbeat_at   = now(),
        dedicated_pool = EXCLUDED.dedicated_pool
    """
)

_COORD_PRUNE = text(
    """
    DELETE FROM coord.replica_presence
     WHERE heartbeat_at < now() - make_interval(secs => :secs)
    """
)

# The READER, from `worker_ledger::load_replica_presence` (same repo, same
# branch). This is the statement whose answer the roll gate actually acts on,
# and the one that makes `timestamptz` load-bearing: `now() - heartbeat_at`
# type-checks against a naive `timestamp` too, and then returns an age wrong by
# the session's UTC offset — which is a live replica reading as hours stale.
_COORD_LOAD = text(
    """
    SELECT replica_id,
           EXTRACT(EPOCH FROM (now() - heartbeat_at))::float8 AS age_secs,
           dedicated_pool
      FROM coord.replica_presence
    """
)


def _revision_source() -> str:
    """The revision file's text — substrate for the no-database guards."""
    path = backend_root() / "alembic" / "versions" / "replpres_01_replica_presence.py"
    return path.read_text(encoding="utf-8")


def _columns(engine: Engine) -> dict[str, tuple[str, bool, bool]]:
    """``{name: (data_type, is_nullable, has_default)}`` for the table."""
    sql = text(
        """
        SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'coord' AND table_name = :t
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(sql, {"t": _TABLE}).all()
    return {str(r[0]): (str(r[1]), r[2] == "YES", r[3] is not None) for r in rows}


def _primary_key_columns(engine: Engine) -> list[str]:
    """The PK's columns, in key order — coord's ON CONFLICT target."""
    sql = text(
        """
        SELECT a.attname
          FROM pg_index i
          JOIN pg_attribute a
            ON a.attrelid = i.indrelid
           AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = CAST('coord.replica_presence' AS regclass)
           AND i.indisprimary
         ORDER BY array_position(i.indkey, a.attnum)
        """
    )
    with engine.connect() as conn:
        return [str(r[0]) for r in conn.execute(sql).all()]


def _index_definition(engine: Engine) -> str:
    sql = text(
        """
        SELECT indexdef FROM pg_indexes
         WHERE schemaname = 'coord' AND indexname = :idx
        """
    )
    with engine.connect() as conn:
        return str(conn.execute(sql, {"idx": _INDEX}).scalar_one())


def _upsert(engine: Engine, replica_id: uuid.UUID, dedicated: bool) -> None:
    """Run coord's presence write exactly as the election loop does."""
    with engine.begin() as conn:
        conn.execute(
            _COORD_UPSERT,
            {"replica_id": replica_id, "dedicated_pool": dedicated},
        )


def _read_row(engine: Engine, replica_id: uuid.UUID) -> tuple[datetime, datetime, bool]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT heartbeat_at, boot_at, dedicated_pool
                  FROM coord.replica_presence
                 WHERE replica_id = :r
                """
            ),
            {"r": replica_id},
        ).one()
    return row[0], row[1], bool(row[2])


def _row_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT count(*) FROM coord.replica_presence")
            ).scalar_one()
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_replpres_01_creates_the_contract_coord_actually_consumes() -> None:
    """The column contract, coord's three statements, and the reversal walk."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "replpres_01_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Parent revision — the table must be created by THIS revision.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE), (
            "coord.replica_presence must be created by replpres_01, not by "
            "an earlier revision"
        )

        # ----------------------------------------------------------------
        # 2. Apply, and pin the shape a cross-repo consumer depends on.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        assert not table_exists(engine, "public", _TABLE), (
            "the table belongs to the coord schema; a public.replica_presence "
            "means the schema= argument was dropped"
        )

        assert _columns(engine) == _EXPECTED_COLUMNS, (
            "the column contract changed. coord reads and writes these names "
            "and types by hand (crates/coord/src/replica_presence.rs); "
            "nothing in qontinui-web would otherwise notice."
        )

        assert _primary_key_columns(engine) == ["replica_id"], (
            "replica_id must be the sole primary key — it is the conflict "
            "target of coord's ON CONFLICT (replica_id) upsert. Without it "
            "every election tick appends a row instead of updating one."
        )

        assert index_exists(engine, _INDEX)
        indexdef = _index_definition(engine)
        assert re.search(r"\(\s*heartbeat_at\s*\)", indexdef), (
            "the retention sweep filters on heartbeat_at; an index of the "
            f"right name on another column helps nothing. Got: {indexdef}"
        )

        # ----------------------------------------------------------------
        # 3. dedicated_pool has no default — proven by falsification, not
        #    only by reading column_default. A writer that cannot state
        #    which pool it used must FAIL, never inherit an optimistic
        #    answer that the consumer would read as "alive and trustworthy".
        # ----------------------------------------------------------------
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.replica_presence
                            (replica_id, heartbeat_at, boot_at)
                        VALUES (:r, now(), now())
                        """
                    ),
                    {"r": uuid.uuid4()},
                )

        # ----------------------------------------------------------------
        # 4. Coord's upsert, first tick: one row, both timestamps equal
        #    (one statement, one transaction clock), and tz-aware.
        # ----------------------------------------------------------------
        replica = uuid.uuid4()
        _upsert(engine, replica, True)
        assert _row_count(engine) == 1
        first_hb, first_boot, dedicated = _read_row(engine, replica)
        assert dedicated is True
        assert first_hb == first_boot, (
            "the insert arm writes now() into both columns in one statement"
        )
        assert first_hb.tzinfo is not None, (
            "heartbeat_at must come back tz-aware; a naive value means the "
            "column is `timestamp`, and the staleness comparison against the "
            "lease TTL is then wrong by the session's UTC offset"
        )

        # ----------------------------------------------------------------
        # 5. Second tick, this time reporting a DEGRADED pool. The row must
        #    be updated, not appended; heartbeat_at advances; boot_at is
        #    untouched (uptime stays truthful); and the trustworthy flag can
        #    be demoted, or a replica that degrades mid-life keeps reading
        #    as alive-and-trustworthy forever.
        # ----------------------------------------------------------------
        _upsert(engine, replica, False)
        assert _row_count(engine) == 1, (
            "ON CONFLICT (replica_id) must UPDATE; a second row means the "
            "primary key is not the conflict target coord names"
        )
        second_hb, second_boot, dedicated = _read_row(engine, replica)
        assert second_hb > first_hb, "heartbeat_at must advance on every tick"
        assert second_boot == first_boot, (
            "boot_at must survive the update — it is the drill-down's uptime, "
            "and re-seating it would report every replica as just-booted"
        )
        assert dedicated is False, (
            "EXCLUDED.dedicated_pool must be able to demote a trustworthy row"
        )

        # ----------------------------------------------------------------
        # 6. timestamptz, behaviourally. Read the same row under a session
        #    timezone far from UTC: an instant is an instant. A naive column
        #    would hand back a value shifted by the offset, which is how a
        #    live follower reads as hours-stale — i.e. DEPARTED.
        # ----------------------------------------------------------------
        with engine.connect() as conn:
            conn.execute(text("SET TIME ZONE 'Pacific/Kiritimati'"))
            shifted = conn.execute(
                text(
                    """
                    SELECT heartbeat_at FROM coord.replica_presence
                     WHERE replica_id = :r
                    """
                ),
                {"r": replica},
            ).scalar_one()
        assert shifted == second_hb, (
            "the same row read under another session timezone must be the "
            f"same instant; got {shifted!r} vs {second_hb!r}"
        )

        # ----------------------------------------------------------------
        # 6b. Coord's reader, run verbatim under that same far-from-UTC
        #     session timezone. This is the number the fifth conjunct grades
        #     against the lease TTL (15s by default). With `timestamptz` the
        #     age is the handful of milliseconds since the upsert; with a
        #     naive `timestamp` the same expression would be off by the
        #     14-hour offset — 50400s, i.e. thousands of TTLs — and every
        #     live replica would read as departed.
        # ----------------------------------------------------------------
        with engine.connect() as conn:
            conn.execute(text("SET TIME ZONE 'Pacific/Kiritimati'"))
            loaded = conn.execute(_COORD_LOAD).all()
        assert len(loaded) == 1
        loaded_id, age_secs, loaded_dedicated = loaded[0]
        assert loaded_id == replica
        assert loaded_dedicated is False
        assert 0.0 <= age_secs < 60.0, (
            "coord grades this age against the lease TTL; a row written "
            f"moments ago must not read as {age_secs}s old. An age near a "
            "whole number of hours means heartbeat_at is not timestamptz."
        )

        # ----------------------------------------------------------------
        # 7. Coord's retention sweep. Seed one stale row beside the fresh
        #    one and run the DELETE the index exists for: the stale row goes,
        #    the fresh one stays.
        # ----------------------------------------------------------------
        stale = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.replica_presence
                        (replica_id, heartbeat_at, boot_at, dedicated_pool)
                    VALUES (:r, now() - interval '3 hours',
                            now() - interval '9 hours', true)
                    """
                ),
                {"r": stale},
            )
        assert _row_count(engine) == 2

        with engine.begin() as conn:
            deleted = conn.execute(_COORD_PRUNE, {"secs": 7200.0}).rowcount
        assert deleted == 1, (
            "coord's retention DELETE must reap exactly the row older than "
            f"the retention window; it removed {deleted}"
        )
        assert _row_count(engine) == 1
        assert _read_row(engine, replica)[0] == second_hb, (
            "the fresh row must survive the sweep untouched"
        )

        # ----------------------------------------------------------------
        # 8. Downgrade takes the index with the table; re-upgrade restores
        #    a table that is empty (presence is per-boot state, never data
        #    to preserve) and immediately usable.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TABLE)
        assert not index_exists(engine, _INDEX)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        assert index_exists(engine, _INDEX)
        assert _row_count(engine) == 0
        _upsert(engine, uuid.uuid4(), True)
        assert _row_count(engine) == 1


# ---------------------------------------------------------------------------
# Source guards. No database, so they never skip — which matters because the
# properties they pin are the two that a reviewer is most likely to "tidy".
# ---------------------------------------------------------------------------


def test_replpres_01_chains_onto_memseq_01() -> None:
    """The parent this test walks from is the one the revision declares.

    A test that pins ``_PARENT_REVISION_ID`` and a revision that chains
    somewhere else would both pass while walking different graphs.
    """
    source = _revision_source()
    assert re.search(
        rf'^down_revision[^=]*=\s*"{_PARENT_REVISION_ID}"',
        source,
        re.MULTILINE,
    ), f"replpres_01 must declare down_revision = {_PARENT_REVISION_ID!r}"
    assert re.search(rf'^revision[^=]*=\s*"{_REVISION_ID}"', source, re.MULTILINE)


def test_replpres_01_gives_no_column_a_server_default() -> None:
    """``upgrade()`` must not hand any column a ``server_default``.

    ``dedicated_pool`` is the one that matters: ``false`` means "written on
    the DEGRADED shared pool, read me as UNKNOWN". A default lets a writer
    that never stated which pool it used inherit an answer, and UNKNOWN
    silently becomes a positive claim about liveness. The revision says so in
    a comment; a comment is not a gate, and the behavioural proof above skips
    wherever Postgres is absent.

    ``heartbeat_at`` / ``boot_at`` are held to the same rule in a milder
    form: a ``server_default=now()`` would let a tick that failed to supply a
    timestamp look like a fresh one.

    Read through the AST rather than by substring, because the revision's own
    comment contains the words "No server_default" — a grep-shaped guard
    fails on the prose that agrees with it.
    """
    tree = ast.parse(_revision_source())
    upgrade = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "upgrade"
    )

    columns: list[tuple[str, set[str]]] = []
    for node in ast.walk(upgrade):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "Column"):
            continue
        name = node.args[0]
        assert isinstance(name, ast.Constant), "column names must be literals"
        columns.append((str(name.value), {kw.arg for kw in node.keywords if kw.arg}))

    assert [name for name, _ in columns] == list(_EXPECTED_COLUMNS), (
        "the revision must declare exactly the four columns coord consumes, "
        f"in order; got {[name for name, _ in columns]}"
    )

    with_default = [name for name, kwargs in columns if "server_default" in kwargs]
    assert not with_default, (
        "no column in coord.replica_presence may carry a server_default — a "
        "writer that cannot state its value must fail loudly rather than "
        f"inherit an optimistic one. Offenders: {with_default}"
    )

    not_null = {
        name
        for name, kwargs in columns
        if "nullable" in kwargs or "primary_key" in kwargs
    }
    assert not_null == set(_EXPECTED_COLUMNS), (
        "every column must state its nullability explicitly (the primary key "
        f"via primary_key=True); unstated: {set(_EXPECTED_COLUMNS) - not_null}"
    )
