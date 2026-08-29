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
   by comparing ``heartbeat_at`` against the lease TTL. A naive ``timestamp``
   would apply cleanly, accept every write, and then be wrong by the session's
   UTC offset — a live follower reading as hours stale, i.e. DEPARTED, i.e.
   the exact false verdict this table exists to prevent. Proven behaviourally
   as well as from the catalog, but the behavioural proof has to be the
   SUBTRACTION, not a read-back: PostgreSQL converts nothing when it returns a
   naive column, so reading the same row under two session timezones yields
   the same literal either way. It is ``now() - heartbeat_at`` — coord's own
   expression — that forces the naive value to be interpreted as local time
   and comes back off by the whole offset.

   ``boot_at`` is held to the same rule by a cheaper route, and deliberately
   so — there is no second subtraction, and none is needed. The insert arm
   writes both columns from one ``now()``, so step 4 of the walk below asserts
   they come back EQUAL, and an aware datetime never compares equal to a naive
   one in Python: that fails the moment exactly one of the two goes naive. The
   ``first_hb.tzinfo is not None`` check beside it fails when both do. Between
   them the tz space is closed, so the one assertion that reads ``uptime_secs``
   is about the PROJECTION, never about the column's type.

3. **``replica_id`` is the primary key.** It is the conflict target of coord's
   upsert (``ON CONFLICT (replica_id)``). With no unique constraint matching
   it PostgreSQL does not append — it raises ``InvalidColumnReference`` — and
   coord *swallows* that (``write_presence`` logs at debug and returns), so
   the table stays permanently EMPTY. Every replica then reads as
   no-evidence → UNKNOWN, the fifth conjunct goes inert, and the gate silently
   reverts to the four-conjunct behaviour this table was added to fix.

4. **Coord's landed statements actually run against this table.** All three —
   the presence upsert (``write_presence``), the retention DELETE the index
   exists for (``prune_presence``) and the loader whose age the roll gate
   grades (``load_replica_presence``) — are transcribed below from
   ``qontinui-coord`` (``crates/coord/src/replica_presence.rs`` and
   ``crates/coord/src/worker_ledger.rs``) and executed here. That is the
   ``coord_tenant_warm_bytes_01`` precedent — the migration that publishes SQL
   for a coord-side consumer asserts that what it publishes runs — applied to
   a consumer that has since landed, so the transcription is of shipped code
   rather than of a proposal.

5. **The upsert advances ``heartbeat_at`` and leaves ``boot_at`` alone**, and
   ``uptime_secs >= age_secs`` therefore holds. ``boot_at`` is what makes
   uptime truthful in the ``coord_query_workers`` drill-down; a ``DO UPDATE``
   that re-seated it would report every replica as just-booted, forever,
   without ever erroring — pinned directly, on the upsert, by
   ``second_boot == first_boot``. Coord calls the resulting ordering
   *structural* (``worker_ledger.rs``) and renders the DIFFERENCE of the two
   as "how long this replica went on ticking before it went quiet"; step 7 of
   the walk below reads that difference once, off a seeded quiet replica, as a
   guard on the transcribed projection rather than on the upsert this item
   covers.

6. **The upsert can DEMOTE ``dedicated_pool`` to false.** A replica whose
   dedicated lease pool fails mid-life must be able to overwrite its own
   earlier trustworthy row, or the consumer keeps reading a stale ``true`` and
   treats an untrustworthy signal as evidence of life.

7. **The index is on ``heartbeat_at``.** Advisory, not a correctness
   dependency (the sweep works, slower, without it) — but an index that exists
   under the right name on the wrong column is indistinguishable from a
   working one until the table is large.

8. **The retention sweep ages rows out on ``heartbeat_at``, not ``boot_at``.**
   Not advisory, unlike item 7: the column the DELETE filters decides WHICH
   rows retention bounds. On ``heartbeat_at`` it reaps replicas that stopped
   talking, which is what retention is for. On ``boot_at`` it reaps replicas
   that have merely been up a long time — deleting the presence row of a
   healthy, still-ticking process, which then reads as no-evidence → UNKNOWN
   → fifth conjunct inert, for the longest-lived replicas in the fleet. Held
   both ways: behaviourally by step 8 of the walk — on a live long-uptime
   replica step 7 seeds precisely so the two predicates stop being
   indistinguishable — and from the transcription's source, where no database
   is needed.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point
it at a live instance with ``QONTINUI_TEST_PG=host:port`` if 5432 is not the
one accepting the test credentials. That variable, and *only* that one:
``conftest.py`` overwrites ``DATABASE_URL`` unconditionally at import, so
exporting it here has no effect. The source guards at the end of this file
need no database and therefore never skip.
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
# `crates/coord/src/replica_presence.rs` — `write_presence`, `prune_presence`;
# `crates/coord/src/worker_ledger.rs` — `load_replica_presence`. Spelled
# exactly as coord spells them: this block exists so the copies can be
# re-verified by grepping coord, and a symbol that greps to nothing defeats
# that. The ONLY edit is the bind style: tokio-postgres'
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

# What coord binds into `:secs` — `PRESENCE_RETENTION_SECS`, 2h
# (`replica_presence.rs`: `2.0 * 60.0 * 60.0`).
#
# A named constant rather than a literal at the call site because step 7's
# veteran must be seeded OLDER than this on `boot_at` or step 8 stops
# discriminating between the two candidate prune predicates — and it would
# stop silently. Both the seed's premise check and the sweep now read this
# one number, so the coupling cannot be broken by editing either alone.
_PRESENCE_RETENTION_SECS = 7200.0

# The READER, from `worker_ledger::load_replica_presence` (same repo, same
# branch). This is the statement whose answer the roll gate actually acts on,
# and the one that makes `timestamptz` load-bearing: `now() - heartbeat_at`
# type-checks against a naive `timestamp` too, and then returns an age wrong by
# the session's UTC offset — which is a live replica reading as hours stale.
#
# All FOUR select expressions, in coord's order. The width is load-bearing
# because coord decodes this result set POSITIONALLY:
# `row.try_get::<_, f64>(2)` is `uptime_secs` and `try_get::<_, bool>(3)` is
# `dedicated_pool` (`worker_ledger.rs`; index 2 is read with `.ok()` because
# uptime is drill-down context with no gate authority, index 3 with a hard
# `continue`). A copy of this statement that is a column short is therefore
# not one column less thorough — it is a different projection, in which
# `dedicated_pool` sits at the index coord decodes as an `f64`. Step 6
# unpacks all four names against it, which is what pins both facts.
#
# Note what this statement does NOT have to carry: the timezone proof. Step 4
# settles that from the pair it writes with a single `now()` — an aware and a
# naive datetime never compare equal in Python, so `first_hb == first_boot`
# fails if exactly one column goes naive, and `first_hb.tzinfo is not None`
# fails if both do.
_COORD_LOAD = text(
    """
    SELECT replica_id,
           EXTRACT(EPOCH FROM (now() - heartbeat_at))::float8 AS age_secs,
           EXTRACT(EPOCH FROM (now() - boot_at))::float8 AS uptime_secs,
           dedicated_pool
      FROM coord.replica_presence
    """
)

# The reader's projection stated INDEPENDENTLY of the transcription above, so
# the guard at the end of this file grades one against the other instead of
# against itself. Order is the contract, not decoration: coord decodes this
# result set positionally.
#
# Second element is the timestamp column the expression must subtract from
# `now()`, or ``None`` where coord selects the bare column.
_COORD_READER_PROJECTION: tuple[tuple[str, str | None], ...] = (
    ("replica_id", None),
    ("age_secs", "heartbeat_at"),
    ("uptime_secs", "boot_at"),
    ("dedicated_pool", None),
)

_TIMESTAMP_COLUMNS = ("heartbeat_at", "boot_at")


def _parse_flat_select(sql: str) -> tuple[list[str], str]:
    """``(select expressions in order, table)`` for a flat single-table SELECT.

    Depth-aware on parentheses. ``EXTRACT(EPOCH FROM (now() - boot_at))``
    carries no comma today, but a splitter that would break if one arrived is
    a tripwire on its own implementation rather than a guard on the statement.
    """
    flat = " ".join(sql.split())
    match = re.match(
        r"^SELECT\s+(.+?)\s+FROM\s+([A-Za-z_][A-Za-z0-9_.]*)$", flat, re.IGNORECASE
    )
    assert match is not None, (
        f"expected a flat single-table `SELECT ... FROM <table>`; got {flat!r}"
    )

    expressions: list[str] = []
    current = ""
    depth = 0
    for char in match.group(1):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "," and depth == 0:
            expressions.append(current.strip())
            current = ""
        else:
            current += char
    # Without this an unbalanced `)` drives depth negative, a genuine
    # top-level comma then fails to split, and two expressions silently merge
    # into one — surfacing as a confusing width failure rather than as the
    # malformed statement it is.
    assert depth == 0, f"unbalanced parentheses in the select list: {match.group(1)!r}"
    expressions.append(current.strip())
    return expressions, match.group(2)


def _output_name(expression: str) -> str:
    """One select expression's ``AS`` alias, or the expression verbatim.

    A deliberate SUBSET of Postgres's output-name rules, not a model of them:
    a qualified bare column (``t.replica_id``) or a quoted alias
    (``AS "age_secs"``) comes back whole and fails the name comparison. For a
    block whose contract is "spelled exactly as coord spells them" that is the
    right direction — the copy should be verbatim, so a spelling coord does
    not use should red rather than be normalised away.
    """
    alias = re.search(r"\sAS\s+([A-Za-z_][A-Za-z0-9_]*)$", expression, re.IGNORECASE)
    return alias.group(1) if alias else expression


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
            "target of coord's ON CONFLICT (replica_id) upsert. With nothing "
            "unique to match, that statement raises InvalidColumnReference, "
            "coord swallows it, and the table stays empty forever."
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
        with pytest.raises(IntegrityError, match="dedicated_pool"):
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
            "ON CONFLICT (replica_id) must UPDATE this replica's row in "
            "place; a second row means the conflict target is not the key "
            "that identifies a replica, and the table would then grow at the "
            "election cadence rather than at the redeploy rate"
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
        # 6. timestamptz, behaviourally — coord's reader run verbatim under a
        #    session timezone far from UTC. This is the number the fifth
        #    conjunct grades against the lease TTL (15s by default).
        #
        #    The SUBTRACTION is the proof, and simply reading the column back
        #    under two timezones is NOT: PostgreSQL converts nothing when it
        #    returns a `timestamp without time zone`, so both reads hand back
        #    the same literal whichever type the column has. It is
        #    `now() - heartbeat_at` that forces a naive value to be read as
        #    LOCAL time — under +14 that is 50400s of fabricated age, thousands
        #    of TTLs, and every live replica reads as departed.
        # ----------------------------------------------------------------
        with engine.connect() as conn:
            conn.execute(text("SET TIME ZONE 'Pacific/Kiritimati'"))
            loaded = conn.execute(_COORD_LOAD).all()
        assert len(loaded) == 1
        # Four-arity unpack, deliberately. This is the positional guard: coord
        # decodes this result set by index — `try_get::<_, f64>(2)` is uptime,
        # `try_get::<_, bool>(3)` is `dedicated_pool` — so binding four names
        # pins the projection's WIDTH (a dropped or added expression raises
        # here) and pins `dedicated_pool` at the index coord reads it from.
        # `_uptime_secs` is unread at this step on purpose: with both
        # timestamps written by one `now()` there is nothing here it could
        # show that step 7 does not show better.
        loaded_id, age_secs, _uptime_secs, loaded_dedicated = loaded[0]
        assert loaded_id == replica
        assert loaded_dedicated is False
        assert 0.0 <= age_secs < 60.0, (
            "coord grades this age against the lease TTL; a row written "
            f"moments ago must not read as {age_secs}s old. An age near a "
            "whole number of hours means heartbeat_at is not timestamptz."
        )

        # ----------------------------------------------------------------
        # 7. Seed two more replicas beside the fresh one, so the table holds
        #    three shapes rather than one:
        #
        #      `stale`   — booted 9h ago, last ticked 3h ago. QUIET.
        #      `veteran` — booted 9h ago, ticking NOW. Long-lived and LIVE —
        #                  a shape this walk did not have, and the one that
        #                  makes step 8's predicate observable. Step 8 is the
        #                  reason it exists; see the note there.
        #
        #    From `stale`, read the DIFFERENCE coord's drill-down renders:
        #    "how long this replica went on ticking before it went quiet",
        #    6h here.
        #
        #    This is a TRANSCRIPTION guard, not a schema one. "boot_at
        #    survived the upsert" is owned outright by step 5's
        #    `second_boot == first_boot`, and the fresh row cannot show a
        #    difference at all (one `now()` writes both columns). What
        #    nothing else catches is a future edit mangling `_COORD_LOAD`
        #    itself — swapping the two EXTRACT expressions flips this to
        #    -6h, repointing the uptime one at `heartbeat_at` collapses it
        #    to 0 — and that block is worth only as much as its fidelity to
        #    coord's statement.
        #
        #    Deterministic, not timing-sensitive: both EXTRACTs share one
        #    statement-stable `now()`, so it cancels and this is precisely
        #    `heartbeat_at - boot_at`. `approx` is still right — the two
        #    float8 values round independently, so the difference lands a
        #    hair off 21600.0 and a bare `==` would be flaky.
        # ----------------------------------------------------------------
        stale = uuid.uuid4()
        veteran = uuid.uuid4()
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
            conn.execute(
                text(
                    """
                    INSERT INTO coord.replica_presence
                        (replica_id, heartbeat_at, boot_at, dedicated_pool)
                    VALUES (:r, now(), now() - interval '9 hours', true)
                    """
                ),
                {"r": veteran},
            )
        assert _row_count(engine) == 3

        # `_COORD_LOAD` verbatim again — never a narrowed variant of it, or
        # this stops being a test of the statement coord runs. `replica` comes
        # back too and is simply not read here.
        with engine.connect() as conn:
            by_id = {row[0]: row for row in conn.execute(_COORD_LOAD).all()}
        _, stale_age, stale_uptime, _ = by_id[stale]
        assert stale_uptime - stale_age == pytest.approx(6 * 3600, abs=1), (
            "boot_at and heartbeat_at must subtract independently: a row that "
            "booted 9h ago and last ticked 3h ago went on ticking for 6h, and "
            f"coord's drill-down renders that number. Got {stale_uptime}s - "
            f"{stale_age}s = {stale_uptime - stale_age}s."
        )

        # The veteran's FIXTURE PREMISE, checked before the sweep consumes it.
        #
        # Read this as "the seed is still what step 8 needs", not as a check on
        # the projection — an EXTRACT swap or collapse reds one assertion
        # earlier, on `stale`, and would red here only incidentally. What this
        # catches is the seed drifting: the veteran must be fresh on
        # `heartbeat_at` AND older than the retention window on `boot_at`, or
        # the two candidate prune predicates select the same rows again and
        # step 8 silently stops discriminating. Hence the bound is
        # `_PRESENCE_RETENTION_SECS` — the sweep's own number — and not a
        # loose constant that a shortened interval could still satisfy.
        _, vet_age, vet_uptime, _ = by_id[veteran]
        assert vet_age < 60.0 < _PRESENCE_RETENTION_SECS < vet_uptime, (
            "the veteran seed must straddle the retention window: freshly "
            f"ticked, yet booted longer than {_PRESENCE_RETENTION_SECS}s ago. "
            f"Got age={vet_age}s, uptime={vet_uptime}s. An uptime inside the "
            "window means step 8 can no longer tell a heartbeat_at sweep from "
            "a boot_at one — fix the seed, do not relax this bound."
        )

        # ----------------------------------------------------------------
        # 8. Coord's retention sweep — the DELETE the index exists for: the
        #    quiet row goes, the fresh one and the veteran stay.
        #
        #    The sweep reaps on LAST TICK, never on age since boot, and the
        #    veteran is what makes that decidable here. Without it this step
        #    could not tell the two apart: the only old row was old on BOTH
        #    axes, so `heartbeat_at < cutoff` and `boot_at < cutoff` selected
        #    exactly the same single row and every assertion below passed
        #    either way. The difference is not cosmetic — a sweep filtering
        #    `boot_at` deletes the presence row of every replica that has
        #    been up longer than retention WHILE IT IS STILL TICKING. Each
        #    one then reads as no-evidence, i.e. UNKNOWN, i.e. the fifth
        #    conjunct goes inert for precisely the replicas with the longest
        #    unbroken uptime — the healthiest ones in the fleet, and the
        #    exact suppression `coord.replica_presence` was added to end.
        #    With the veteran present, a `boot_at` predicate reaps two rows
        #    and reds on the count below — but ONLY while the veteran's
        #    `boot_at` sits outside the window, which is why the seed's
        #    premise is bound to `_PRESENCE_RETENTION_SECS` rather than
        #    checked against a loose constant.
        # ----------------------------------------------------------------
        with engine.begin() as conn:
            deleted = conn.execute(
                _COORD_PRUNE, {"secs": _PRESENCE_RETENTION_SECS}
            ).rowcount
        assert deleted == 1, (
            "coord's retention DELETE must reap exactly the row whose last "
            "HEARTBEAT is older than the retention window. 2 means it "
            "filtered boot_at and took the still-ticking veteran with it; "
            f"it removed {deleted}"
        )
        assert _read_row(engine, replica)[0] == second_hb, (
            "the fresh row must survive the sweep untouched"
        )
        # `_read_row` ends in `.one()`, so this call raising IS the assertion,
        # and it is the only thing pinning WHICH row the sweep took: `deleted
        # == 1` above leaves two candidates for the survivor. Spelled as a
        # read rather than as a row count so the failure names the veteran.
        _read_row(engine, veteran)

        # ----------------------------------------------------------------
        # 9. Downgrade takes the index with the table; re-upgrade restores
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
# properties they pin are the ones a reviewer is most likely to "tidy".
#
# The first two grade the REVISION; the last three grade the TRANSCRIPTIONS
# above, one per statement. Those three exist because the transcription
# block's whole value is its fidelity to coord, and until they were added
# every property of all three statements was pinned only from inside the
# Postgres-gated walk — so on a DB-less run the block the cross-repo contract
# rests on was graded by nothing at all. That is not a hypothetical:
# `_COORD_LOAD` shipped a column short in #1039 and was restored in #1059, and
# neither the drift nor the repair could red without a database.
#
# What they do NOT reach, so the DB-less arm is not over-trusted: the
# DIRECTION and UNIT of the reader's subtractions (`EXTRACT(EPOCH FROM
# (heartbeat_at - now()))`, or `EXTRACT(MINUTE FROM ...)`, satisfy every
# assertion here) and the SIDE of the prune's interval (`now() +
# make_interval(...)` likewise). Those stay owned by the walk — steps 6 and 8
# respectively — which is a real gap on a machine with no Postgres, not a
# closed one.
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
    assert re.search(rf'^revision[^=]*=\s*"{_REVISION_ID}"', source, re.MULTILINE), (
        f"the file this test reads must be revision {_REVISION_ID!r}; if it "
        "was renamed, _revision_source() is pointing at the wrong file and "
        "every source guard below is grading something else"
    )


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
    timestamp look like a fresh one. NOT NULL is checked here too, by keyword
    VALUE rather than presence — it is the property the database test's
    falsification actually rides on, and this is the only guard on it when
    Postgres is absent.

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

    columns: list[tuple[str, dict[str, ast.expr]]] = []
    for node in ast.walk(upgrade):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "Column"):
            continue
        name = node.args[0]
        assert isinstance(name, ast.Constant), "column names must be literals"
        columns.append(
            (str(name.value), {kw.arg: kw.value for kw in node.keywords if kw.arg})
        )

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

    # By VALUE, not by presence: `"nullable" in kwargs` is satisfied by
    # `nullable=True`, which is the opposite of the property. NOT NULL is what
    # makes the database test's falsification fire at all, and on a DB-less
    # run this guard is the only thing holding it.
    def _is(expr: ast.expr | None, want: bool) -> bool:
        return isinstance(expr, ast.Constant) and expr.value is want

    not_null = {
        name
        for name, kwargs in columns
        if _is(kwargs.get("nullable"), False) or _is(kwargs.get("primary_key"), True)
    }
    assert not_null == set(_EXPECTED_COLUMNS), (
        "every column must be NOT NULL — the three non-key ones via "
        "nullable=False, replica_id via primary_key=True. Unstated or "
        f"nullable: {sorted(set(_EXPECTED_COLUMNS) - not_null)}"
    )


def test_replpres_01_reader_transcription_keeps_coords_projection() -> None:
    """``_COORD_LOAD`` must still be coord's four-expression projection.

    ``worker_ledger::load_replica_presence`` decodes this result set BY INDEX
    — ``try_get::<_, f64>(1)`` is ``age_secs``, ``(2)`` is ``uptime_secs``,
    ``try_get::<_, bool>(3)`` is ``dedicated_pool`` — so the width, the order
    and the source column behind each expression are all contract. A copy that
    is one expression short is not one column less thorough; it is a different
    projection, in which ``dedicated_pool`` sits at the index coord decodes as
    an ``f64``. That exact drift shipped once already (#1039, repaired in
    #1059).

    Everything here is asserted from the transcription's TEXT, against
    ``_COORD_READER_PROJECTION`` stated separately above, so nothing in it
    grades the statement against itself. Three of the four properties are
    pinned in the walk as well (step 6 unpacks four names, step 7 catches an
    EXTRACT swap, and a wrong table errors outright); the fourth is pinned
    nowhere else at all:

    **The ``::float8`` casts.** ``EXTRACT`` returns ``numeric``, and coord
    reads both derived columns with ``try_get::<_, f64>``. Drop a cast and the
    decode fails — for ``age_secs`` that is a hard ``continue``, so the row
    vanishes from the map, the replica reads as no-evidence, i.e. UNKNOWN, and
    the fifth conjunct goes inert.

    What the walk does with that was MEASURED, not assumed, and it is worse
    than it looks. Dropping ONE cast does red step 7 — but incidentally, as a
    ``TypeError: unsupported operand type(s) for -: 'float' and
    'decimal.Decimal'``, purely because the two expressions then disagree on
    type. Drop BOTH — the symmetric edit, and much the likelier "tidy" — and
    psycopg hands back two ``Decimal``s, which subtract and compare against
    ``pytest.approx`` exactly like the ``float``s every assertion expects: the
    whole walk passes green against a projection coord cannot decode at all.
    Verified by mutation on the pre-change file, with a real Postgres.
    """
    expressions, table = _parse_flat_select(_COORD_LOAD.text)

    assert table == "coord.replica_presence", (
        "the transcribed reader must select from the table this revision "
        f"creates, or every assertion riding on it grades something else. "
        f"Got {table!r}"
    )

    assert [_output_name(e) for e in expressions] == [
        name for name, _ in _COORD_READER_PROJECTION
    ], (
        "the projection's width and ORDER are coord's positional decode "
        "contract (worker_ledger::load_replica_presence). Got "
        f"{[_output_name(e) for e in expressions]}"
    )

    for (name, source_column), expression in zip(
        _COORD_READER_PROJECTION, expressions, strict=True
    ):
        if source_column is None:
            continue

        referenced = {
            column
            for column in _TIMESTAMP_COLUMNS
            if re.search(rf"\b{column}\b", expression)
        }
        assert referenced == {source_column}, (
            f"{name} must be measured from {source_column} and nothing else. "
            "Swapping the two EXTRACTs inverts coord's drill-down; pointing "
            "both at one column collapses it to zero, and neither raises. "
            f"Got {sorted(referenced)} in {expression!r}"
        )

        assert "::float8" in expression, (
            f"{name} must keep its ::float8 cast. EXTRACT returns numeric, "
            "coord decodes with try_get::<_, f64>, and a failed decode there "
            "drops the whole row — which reads as no evidence for that "
            f"replica, never as a loud error. Got {expression!r}"
        )


def test_replpres_01_prune_transcription_reaps_on_last_tick() -> None:
    """``_COORD_PRUNE`` must age rows out on ``heartbeat_at``, never ``boot_at``.

    Retention exists to bound the table, and the column it filters decides
    WHICH rows it bounds. On ``heartbeat_at`` it reaps replicas that stopped
    talking. On ``boot_at`` it reaps replicas that have been up a long time —
    deleting the presence row of a healthy, still-ticking process, which then
    reads as no-evidence → UNKNOWN → the fifth conjunct inert, for the
    longest-lived replicas in the fleet.

    Step 8 of the walk now proves this behaviourally too, but only because
    step 7 seeds a live long-uptime `veteran` for it; before that row existed
    the fixture's only old row was old on both axes and the two predicates
    were indistinguishable. This guard holds the same property with no
    database at all.
    """
    flat = " ".join(_COORD_PRUNE.text.split())

    assert re.search(r"WHERE\s+heartbeat_at\s*<", flat, re.IGNORECASE), (
        "the retention sweep must compare heartbeat_at — the column the "
        f"index exists on and the one that means 'last tick'. Got {flat!r}"
    )
    # IGNORECASE on both arms: unquoted identifiers are case-insensitive in
    # SQL, so a case-sensitive negative check here would fail OPEN — `WHERE
    # BOOT_AT < ...` would sail past it.
    assert not re.search(r"\bboot_at\b", flat, re.IGNORECASE), (
        "boot_at must not appear in the retention predicate: age since BOOT "
        "is not staleness, and filtering on it reaps live long-lived "
        f"replicas. Got {flat!r}"
    )


def test_replpres_01_upsert_transcription_never_reseats_boot_at() -> None:
    """``_COORD_UPSERT``'s conflict target, and what its UPDATE arm may touch.

    Two properties, both silent-wrong-answer, both otherwise pinned only from
    inside the Postgres-gated walk:

    **The conflict target is ``replica_id``.** It must match the primary key
    or PostgreSQL raises ``InvalidColumnReference`` — which coord *swallows*
    (``write_presence`` logs at debug and returns), leaving the table
    permanently EMPTY and every replica reading as UNKNOWN. Step 5 catches it
    by row count; nothing does without a database.

    **The UPDATE arm advances ``heartbeat_at`` and must NOT re-seat
    ``boot_at``.** ``boot_at`` is what makes uptime truthful in coord's
    drill-down; a ``DO UPDATE`` that also wrote ``boot_at = now()`` would
    report every replica as just-booted, forever, without ever erroring.
    Step 5's ``second_boot == first_boot`` owns that behaviourally.

    Only the arm AFTER ``DO UPDATE`` is examined, because ``boot_at``
    legitimately appears in the INSERT column list above it — a guard over the
    whole statement would be unable to tell the two apart.
    """
    flat = " ".join(_COORD_UPSERT.text.split())

    assert re.search(r"ON\s+CONFLICT\s*\(\s*replica_id\s*\)", flat, re.IGNORECASE), (
        "the upsert's conflict target must be replica_id, the primary key. "
        "A target with no matching unique constraint raises "
        "InvalidColumnReference, coord swallows it, and the table never "
        f"receives a row. Got {flat!r}"
    )

    arms = re.split(r"DO\s+UPDATE", flat, maxsplit=1, flags=re.IGNORECASE)
    assert len(arms) == 2, (
        "the upsert must carry an ON CONFLICT ... DO UPDATE arm; without it a "
        f"second tick raises instead of advancing the heartbeat. Got {flat!r}"
    )
    update_arm = arms[1]

    assert re.search(r"SET\s+heartbeat_at\s*=", update_arm, re.IGNORECASE), (
        "every tick must advance heartbeat_at, or a live replica's age grows "
        f"past the lease TTL and it reads as departed. Got {update_arm!r}"
    )
    assert not re.search(r"\bboot_at\s*=", update_arm, re.IGNORECASE), (
        "the DO UPDATE arm must not write boot_at: re-seating it reports "
        "every replica as just-booted forever, and coord's drill-down renders "
        f"that as uptime. Got {update_arm!r}"
    )
