"""Schema + round-trip test for the ``fleet_res_tel_05_socket_census`` revision.

Phase 2a of plan
``2026-08-31-devops-runner-9876-accept-path-starved-by-close-wait-sockets`` adds
six socket-census columns to ``coord.device_resource_samples``. The DDL is one
ALTER; the contract is everything around it, and **none of it is visible from a
passing ``upgrade``** — the consumer is in another repo and every way it could
notice a violation is deliberately disabled, exactly as for the
``fleet_res_tel_04`` sibling this file mirrors.

What is asserted, and why each one has no runtime backstop:

1. **The column NAMES are an interface, and a typo is silent forever.** coord
   reads these over ``pg_error::is_missing_schema_object``, which swallows
   SQLSTATE 42703 so a coord deploy landing ahead of this migration fails open
   instead of erroring. A misspelled column is therefore indistinguishable from
   one that has not shipped yet — no error, in either repo, ever.
2. **The TYPES are an interface too, and ``IF NOT EXISTS`` is type-blind.** All
   five numeric columns are ``INTEGER`` and coord must read them as
   ``Option<i32>``, matching the ``INTEGER`` columns already on this table
   (``cpu_cores``, ``build_slots_*``, ``ci_jobs_running``). This is the
   deliberate divergence from ``fleet_res_tel_04``'s ``BIGINT``, and getting it
   wrong is a **panic** in ``row.get``, not a degradable SQLSTATE.
3. **Every column nullable, no DEFAULT, and NULL is never 0.** The load-bearing
   rule of the whole revision. A measured ``sock_close_wait_local = 0`` is the
   healthy baseline the incident's growth figure was taken against; NULL is "no
   probe ran". A ``DEFAULT 0`` added later would write the all-clear onto every
   row sent by a publisher that cannot probe — which is every runner on the
   fleet until the publisher ships — with no error anywhere.
4. **LOCAL and REMOTE ``CLOSE_WAIT`` stay two columns.** They indict different
   processes: ``*_local`` is server-side (the runner leaked the fd, the
   2026-08-31 fault) and ``*_remote`` is client-side (a probe process leaked
   it, and the listener is fine). A summed column reads identically for both.
5. **``sock_source`` carries NO CHECK, on purpose.** The vocabulary is open and
   ingest is best-effort, so a CHECK violation would fail the whole INSERT and
   discard the memory, disk and saturation metrics on the row over a
   *provenance label*. A later edit "tightening" it to an enum is the
   regression this asserts against.
6. **``'unavailable'`` is a measurement.** A row may carry it with all four
   counts NULL, and that must be storable — it says the publisher ran and
   neither instrument was reachable, which is strictly more than NULL says.
7. **Up -> down -> up leaves no residue and does not touch data.** Downgrade
   drops six columns; the TABLE belongs to ``fleet_res_tel_01`` and every
   pre-existing sample row must survive.

``migration-reversal.yml`` walks the chain against an EMPTY database, so it
proves the SQL parses and nothing more: no row exists there to survive a
round-trip, and it asserts nothing about which columns arrived with which type.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing — point it
at a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the
one accepting the test credentials.

Use that variable, **not** ``DATABASE_URL``: ``conftest.py`` overwrites
``os.environ["DATABASE_URL"]`` unconditionally at import time from
``QONTINUI_TEST_PG``, so setting ``DATABASE_URL`` on the command line is
silently discarded and every database-backed test below skips against 5432 —
which looks exactly like a green run in the summary line.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. `_PARENT_REVISION_ID` MUST equal
# the revision's own `down_revision` — the first test below enforces it,
# because a stale pin rewinds too far and replays unrelated non-idempotent
# revisions, surfacing as someone else's `DuplicateTable`.
#
# It is `require_review_cols_01`, the chain head measured with the repo's own gate
# (`scripts/ci/count_alembic_heads.py`). The family prefix says nothing about
# the chain edge — `fleet_res_tel_04` is the sibling that added the saturation
# columns to this same table and is NOT this revision's parent — so read
# `down_revision` rather than inferring it from the name.
#
# This pin has already moved twice: the revision was authored against
# `pmf_scope_cols_01`, re-pointed onto `vetev_01` when #1212 landed on top, and
# onto `require_review_cols_01` when this branch was rebased onto current main.
# That re-point edited the revision alone and left this constant behind, so the
# guard below failed the PR — which is the guard doing its job. **A future
# re-point must edit BOTH files in the same commit**, exactly as that test's
# failure message instructs.
_REVISION_ID = "fleet_res_tel_05_socket_census"
_PARENT_REVISION_ID = "require_review_cols_01"
_REVISION_FILENAME = "fleet_res_tel_05_socket_census.py"

_TABLE = "device_resource_samples"

# (column, information_schema.data_type). The type strings are PostgreSQL's own
# spellings, so an INTEGER that drifted to BIGINT fails loudly here rather than
# at coord's first `row.get::<i32>` — which is a panic, not a degrade.
_EXPECTED: tuple[tuple[str, str], ...] = (
    ("sock_probe_port", "integer"),
    ("sock_close_wait_local", "integer"),
    ("sock_close_wait_remote", "integer"),
    ("sock_established_local", "integer"),
    ("sock_time_wait_local", "integer"),
    ("sock_source", "text"),
)

# The same six, spelled as the revision's own DDL spells them — this is what
# the module-constant guard compares against, so a name or type edited in one
# place and not the other cannot pass.
#
# Only THIS tuple is pinned to the revision's `_SOCKET_CENSUS_COLUMNS`;
# `_EXPECTED` above is pinned to nothing, and it is what every live-schema walk
# iterates. The two are reconciled by
# `test_the_two_column_tables_describe_the_same_six` below.
_EXPECTED_DDL: tuple[tuple[str, str], ...] = (
    ("sock_probe_port", "INTEGER"),
    ("sock_close_wait_local", "INTEGER"),
    ("sock_close_wait_remote", "INTEGER"),
    ("sock_established_local", "INTEGER"),
    ("sock_time_wait_local", "INTEGER"),
    ("sock_source", "TEXT"),
)

# The 2026-08-31 incident reading, verbatim: 148 unreaped server-side
# CLOSE_WAIT sockets on the primary runner's listener, against a known-zero
# baseline, while :9875 and :3001 on the same host accepted normally.
_INCIDENT_PORT = 9876
_INCIDENT_CLOSE_WAIT_LOCAL = 148


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _expected_comment(column: str) -> str:
    """The body the revision's own source emits for ``column``.

    Read from the ONE author rather than copied here: a second copy of six
    prose blocks is the divergence such an assertion exists to catch, and the
    reader collapses the doubled apostrophes exactly as the SQL parser does.
    """
    return comment_body_from_source(_revision_source(), f"coord.{_TABLE}.{column}")


def _revision_module():
    """Import the revision file directly — it only imports ``alembic.op``."""
    return load_revision_module(_revision_path(), "_fleet_res_tel_05_under_test")


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` names the revision's real parent."""
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins {_PARENT_REVISION_ID!r}. Re-point both together — "
        f"and re-run scripts/ci/count_alembic_heads.py, since a re-point that "
        f"forks the chain fails the required `alembic-heads-pr` check instead."
    )


def test_the_revision_names_the_columns_coord_reads_from_one_list() -> None:
    """The six names and types, read off the revision's own constants.

    This is the guard that has no runtime backstop anywhere. coord reaches
    these columns through `is_missing_schema_object`, which swallows 42703
    precisely so a coord deploy that lands ahead of the migration degrades
    instead of erroring — and the same swallow means a MISSPELLED column is
    indistinguishable from one that has not shipped yet. There is no error, in
    either repo, ever.

    Reading the module's constants (rather than grepping the DDL text) also
    pins that the upgrade's ADDs and the downgrade's DROPs are generated from
    ONE list, which is what makes "add and drop the same six" mechanical
    instead of a convention.
    """
    module = _revision_module()
    assert module._TABLE == f"coord.{_TABLE}", (
        "the revision must widen coord.device_resource_samples; the socket "
        "census belongs on the sample row, beside the instruments that were "
        "all green while one listener was starved"
    )
    assert tuple(module._SOCKET_CENSUS_COLUMNS) == _EXPECTED_DDL, (
        "the revision's column list drifted from what coord's "
        "ResourceSampleRow will read. These names are an INTERFACE across two "
        "repos and 42703 is swallowed on the reading side, so drift here idles "
        "forever in silence rather than failing."
    )


def test_the_counts_are_integer_and_not_bigint() -> None:
    """The type choice is deliberate, and it is the opposite of the sibling's.

    ``fleet_res_tel_04`` chose ``BIGINT`` because a kernel task table scales by
    orders of magnitude between machine classes and coord reads those columns
    as ``Option<i64>``. A socket census does not: a port is bounded by 65535
    and a per-listener socket count is bounded by the process descriptor
    ceiling. What decides it is the neighbours — ``cpu_cores``,
    ``build_slots_total``, ``build_slots_busy``, ``build_queue_depth`` and
    ``ci_jobs_running`` are all ``INTEGER`` on this table and coord reads every
    one as ``Option<i32>``.

    Asserted separately from the list guard above because "someone widened
    these to BIGINT for symmetry with the saturation lane" is the plausible
    edit, and it would panic coord's ``row.get::<i32>`` rather than degrade.
    """
    module = _revision_module()
    numeric = [
        (name, sql_type)
        for name, sql_type in module._SOCKET_CENSUS_COLUMNS
        if sql_type != "TEXT"
    ]
    assert numeric, "the revision declares no numeric socket-census column"
    assert all(sql_type == "INTEGER" for _, sql_type in numeric), (
        f"a socket-census column is not INTEGER ({numeric}); coord must read "
        f"these as Option<i32> like every other INTEGER on this table, and an "
        f"i32 read off a BIGINT column is a runtime type error there"
    )


def test_the_local_and_remote_close_wait_columns_are_both_present() -> None:
    """The split that carries the diagnosis, asserted as a pair.

    ``CLOSE_WAIT`` where the probe port is LOCAL means the listener's own
    process holds the descriptor — the starvation signal, 148 of them on
    2026-08-31. Where the probe port is REMOTE it means a probe process on the
    same box holds it, and the listener is not implicated at all. A future
    "simplification" that sums them into one column reads identically for two
    faults in two different processes, and it is the specific edit this guards.
    """
    names = {name for name, _ in _revision_module()._SOCKET_CENSUS_COLUMNS}
    assert {"sock_close_wait_local", "sock_close_wait_remote"} <= names, (
        "the CLOSE_WAIT census must stay split by which END of the socket the "
        "probe port sits on; collapsing it discards which process leaked the "
        "descriptor, which is the whole finding"
    )


def test_the_two_column_tables_describe_the_same_six() -> None:
    """`_EXPECTED` and `_EXPECTED_DDL` name the same columns, in the same order.

    Closes the one seam between the guards above and the walks below.
    `_EXPECTED_DDL` is pinned to the revision's `_SOCKET_CENSUS_COLUMNS`;
    nothing pins `_EXPECTED`, and `_EXPECTED` is what every live-schema
    assertion iterates. Without this, a seventh column fails the revision-list
    guard, is fixed by extending `_EXPECTED_DDL` alone, and then ships
    unchecked for type, nullability or default. Name-level only: the type
    SPELLINGS differ on purpose (``INTEGER`` in DDL, ``integer`` in
    ``information_schema``).
    """
    assert [name for name, _ in _EXPECTED] == [name for name, _ in _EXPECTED_DDL], (
        "the catalogue table and the DDL table list different columns; every "
        "live-schema walk below iterates the FORMER, so a column present only "
        "in the latter is added by the revision and asserted about by nothing"
    )


def test_the_revision_comments_every_column_it_adds() -> None:
    """Each of the six carries a ``COMMENT ON COLUMN`` in the revision source.

    The ADDs and DROPs are generated from `_SOCKET_CENSUS_COLUMNS`; the
    comments are **six hand-written blocks** that are not. So a seventh column
    added to that list is added, dropped, type-checked and round-tripped by
    everything else in this file, and lands with no comment at all.

    That matters more than tidiness, because these comments are the only place
    the NULL-is-never-0 rule and the local/remote split are written into the
    database itself. coord reads these columns across a repo boundary through a
    swallowed 42703, the revision's docstring is not shipped anywhere an
    operator sees, and ``\\d+`` is where a human meets this schema.

    Structural rather than database-backed: it never skips, which is the point
    — the walks below skip wholesale when no Postgres is reachable.
    """
    source = _revision_source()
    for name, _ in _EXPECTED_DDL:
        marker = f"COMMENT ON COLUMN coord.{_TABLE}.{name} IS"
        assert marker in source, (
            f"{name} is added by the revision's one column list but carries no "
            f"COMMENT; the comments are hand-written blocks rather than "
            f"generated from that list, so a new column lands bare unless one "
            f"is written for it"
        )
        assert _expected_comment(name).strip(), (
            f"{name}'s COMMENT body is empty; an empty comment records nothing "
            f"and reads as documented to anyone checking for one"
        )


def test_every_count_column_documents_that_null_is_not_zero() -> None:
    """The rule is in the DATABASE, not only in the revision's docstring.

    ``\\d+`` is where an operator meets this schema and where a future author
    deciding whether to "tidy" a nullable count into ``NOT NULL DEFAULT 0``
    will look. The catalogue guard below enforces the *state*; this enforces
    that the state is explained where the state is visible.
    """
    for name, _ in _EXPECTED_DDL:
        if name in {"sock_probe_port", "sock_source"}:
            continue
        body = _expected_comment(name)
        assert "NULL" in body and "0" in body, (
            f"{name}'s COMMENT does not say what NULL means against 0. NULL is "
            f"'no probe ran' and a measured 0 is the healthy baseline the "
            f"2026-08-31 growth figure was taken against; conflating them is "
            f"what made the 2026-08-27 saturation dimension invisible"
        )


def test_the_revision_generates_its_drops_from_the_same_list() -> None:
    """Every column is both ADDed idempotently and DROPped, in the two spellings.

    A structural guard beside the round-trip walk below, which proves the same
    agreement behaviourally but only for the columns that exist TODAY. This one
    reads the generated SQL, so it also pins the two per-clause guards the
    round-trip cannot see the absence of: `IF NOT EXISTS` on every ADD (the
    guard is per-clause, so one missing clause aborts the whole re-run) and
    `IF EXISTS` on every DROP.
    """
    module = _revision_module()
    add_sql = module._add_columns(module._TABLE)
    drop_sql = module._drop_columns(module._TABLE)
    for name, sql_type in _EXPECTED_DDL:
        assert f"ADD COLUMN IF NOT EXISTS {name} {sql_type}" in add_sql, (
            f"{name} is not added idempotently; the IF NOT EXISTS guard is "
            f"per-clause, so one missing clause aborts the whole re-run"
        )
        assert f"DROP COLUMN IF EXISTS {name}" in drop_sql, (
            f"{name} is added by upgrade() but not dropped by downgrade(); "
            f"the residue would survive as a column coord may still read"
        )


def test_the_revision_adds_no_default_and_no_not_null() -> None:
    """Read off the generated DDL, so it never skips.

    The live-schema walk asserts the same property from the catalogue, but only
    when a Postgres is reachable. This one holds in CI lanes that have none —
    and the property it defends (an unmeasured count must be NULL) is the one
    the whole revision rests on.
    """
    module = _revision_module()
    add_sql = module._add_columns(module._TABLE).upper()
    assert "DEFAULT" not in add_sql, (
        "the revision adds a DEFAULT; a default on these columns manufactures "
        "a reading nothing measured, and 0 here is the all-clear this "
        "dimension exists to disprove"
    )
    assert "NOT NULL" not in add_sql, (
        "the revision adds NOT NULL; NULL is how this schema says 'no probe "
        "ran', which is every row until a publisher ships"
    )


# ---------------------------------------------------------------------------
# Live-schema walks.
# ---------------------------------------------------------------------------


def _columns(engine: Engine) -> dict[str, tuple[str, str, str | None]]:
    """``{column: (data_type, is_nullable, column_default)}`` for the table."""
    sql = text(
        """
        SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'coord' AND table_name = :t
        """
    )
    with engine.connect() as conn:
        return {
            r[0]: (r[1], r[2], r[3])
            for r in conn.execute(sql, {"t": _TABLE}).fetchall()
        }


def _assert_columns_present(engine: Engine) -> None:
    """All six columns, right type, nullable, and carrying no default."""
    cols = _columns(engine)
    for name, expected_type in _EXPECTED:
        assert name in cols, f"coord.{_TABLE} is missing {name}"
        data_type, nullable, default = cols[name]
        assert data_type == expected_type, (
            f"coord.{_TABLE}.{name} is {data_type}, expected {expected_type}. "
            f"ADD COLUMN IF NOT EXISTS is type-blind, so a wrong type is a "
            f"silent no-op here and a panic in coord's row.get"
        )
        assert nullable == "YES", (
            f"coord.{_TABLE}.{name} is NOT NULL; NULL is how this schema says "
            f"'no probe ran', which is every row on the fleet until a "
            f"publisher ships"
        )
        # Nullability alone does not defend the NULL-is-never-0 rule: a plain
        # `DEFAULT 0` leaves the column nullable and still writes 0 into every
        # INSERT that omits it, which is every row a pre-publisher runner
        # sends — and 0 on this axis is the healthy reading.
        assert default is None, (
            f"coord.{_TABLE}.{name} carries DEFAULT {default}; a default here "
            f"manufactures a reading nothing measured, and it manufactures "
            f"precisely the all-clear this dimension exists to disprove"
        )


def _assert_columns_commented(engine: Engine) -> None:
    """Each column's ``col_description`` is what the revision's source emits.

    Worth a live read on top of the structural guard above, which only proves
    the source CONTAINS the blocks: the six ``COMMENT ON COLUMN`` statements
    are unguarded ``op.execute`` calls replayed on every re-run, and nothing
    else in this file notices if they stop arriving, land on the wrong column,
    or are truncated by an edit to the adjacent-literal runs.
    """
    for name, _ in _EXPECTED:
        actual = column_comment(engine, _TABLE, name)
        assert actual == _expected_comment(name), (
            f"coord.{_TABLE}.{name}'s COMMENT is not what the revision emits.\n"
            f"  in the database: {actual!r}\n"
            f"  in the revision: {_expected_comment(name)!r}\n"
            f"These comments are the only place NULL-is-never-0 and the "
            f"local/remote split are recorded in the database itself; coord "
            f"reads these columns from another repo through a swallowed 42703, "
            f"so nothing at runtime would notice."
        )


def _assert_columns_absent(engine: Engine) -> None:
    """No residue after downgrade."""
    cols = _columns(engine)
    for name, _ in _EXPECTED:
        assert name not in cols, f"coord.{_TABLE}.{name} survived downgrade()"


def _seed_sample_row(engine: Engine, device_id: uuid.UUID) -> None:
    """One pre-existing sample row, as an already-live database would have.

    Only the NOT NULL columns plus a memory reading: this row predates the
    socket census, which is the whole point of it.
    """
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.device_resource_samples
                    (device_id, lane, source, mem_total_bytes,
                     mem_available_bytes)
                VALUES (:d, 'host', 'supervisor', 34359738368, 3800000000)
                """
            ),
            {"d": str(device_id)},
        )


def _sample_row(engine: Engine, device_id: uuid.UUID) -> tuple:
    """The pre-census columns of a seeded row.

    Deliberately not the census columns: they do not exist after downgrade, and
    the point of this read is that the columns predating the revision survive
    the walk untouched.
    """
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT lane, source, mem_total_bytes, mem_available_bytes
                  FROM coord.device_resource_samples
                 WHERE device_id = :d
                """
            ),
            {"d": str(device_id)},
        ).fetchone()
    assert row is not None, "the seeded sample row vanished"
    return tuple(row)


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def test_a_sample_row_carries_the_incident_reading(_admin_url: str) -> None:
    """The 2026-08-31 reading round-trips, and the census scope survives.

    Written as the publisher will write it — the census in the same INSERT as
    the memory metrics, because that is the row shape that made the incident
    invisible: accurate memory numbers beside a socket dimension that did not
    exist.

    Several properties in one walk, since every database-backed test here
    replays the whole chain into its own ephemeral database and a second replay
    costs real wall-clock for what an extra query answers for free:

    * the six columns arrive with the right types and nullability;
    * the server-side CLOSE_WAIT count and the port that scopes it round-trip;
    * a MEASURED 0 on the remote (client-side) column is storable and distinct
      from NULL — the healthy reading, not the absence of one;
    * no CHECK governs ``sock_source``, so an instrument nobody has named yet
      cannot take a whole best-effort sample down with it.

    There is deliberately no separate "upgrade adds the columns" test: this one
    upgrades and asserts that shape before doing anything else.
    """
    device_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "fleet_res_tel_05_in") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)

        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, source,
                         mem_total_bytes, mem_available_bytes,
                         sock_probe_port, sock_close_wait_local,
                         sock_close_wait_remote, sock_established_local,
                         sock_time_wait_local, sock_source)
                    VALUES (:d, 'host', 'runner',
                            34359738368, 3800000000,
                            :port, :cw, 0, 2, 0, 'ss')
                    """
                ),
                {
                    "d": str(device_id),
                    "port": _INCIDENT_PORT,
                    "cw": _INCIDENT_CLOSE_WAIT_LOCAL,
                },
            )

        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT sock_probe_port, sock_close_wait_local,
                           sock_close_wait_remote,
                           sock_close_wait_remote IS NULL,
                           sock_established_local, sock_time_wait_local,
                           sock_source
                      FROM coord.device_resource_samples
                     WHERE device_id = :d
                    """
                ),
                {"d": str(device_id)},
            ).fetchone()

        assert row is not None, "no socket-census row"
        assert tuple(row) == (
            _INCIDENT_PORT,
            _INCIDENT_CLOSE_WAIT_LOCAL,
            0,
            False,
            2,
            0,
            "ss",
        ), (
            "the incident reading did not round-trip. The port in particular "
            "must survive: every count on the row is scoped to one listener, "
            "and the whole diagnosis was that :9876 was starved while :9875 "
            "and :3001 on the same host accepted normally"
        )

        # `sock_source` is free text, and that is a decision the revision
        # argues at length, not an omission. `unavailable` is in the documented
        # vocabulary with no shipped publisher, and a Windows-native arm is a
        # plausible outcome of the publisher phase. A CHECKed enum would reject
        # the whole best-effort INSERT over an unrecognised *provenance label*,
        # discarding the memory, disk and saturation metrics on the same row.
        #
        # Asserted from the catalogue rather than by inserting each label: the
        # catalogue answers for every value at once, including the ones no one
        # has thought of, which is the actual property being defended.
        with engine.connect() as conn:
            checks = conn.execute(
                text(
                    """
                    SELECT c.conname, pg_get_constraintdef(c.oid)
                      FROM pg_constraint c
                      JOIN pg_attribute a
                        ON a.attrelid = c.conrelid
                       AND a.attnum = ANY (c.conkey)
                     WHERE c.conrelid = 'coord.device_resource_samples'::regclass
                       AND c.contype = 'c'
                       AND a.attname = 'sock_source'
                    """
                )
            ).fetchall()
        assert checks == [], (
            f"a CHECK now governs sock_source ({checks}); it sits on the "
            f"free-text `source` side of this table's CHECKed-lane vs "
            f"free-text-source split, and tightening it to an enum breaks "
            f"best-effort ingest for exactly the rows that matter most"
        )

        # `'unavailable'` with every count NULL is a MEASUREMENT: the publisher
        # ran and neither instrument was reachable. It must be storable, and it
        # must be distinguishable from a row that said nothing at all.
        unavailable_device = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, source, sock_probe_port, sock_source)
                    VALUES (:d, 'host', 'runner', 9877, 'unavailable')
                    """
                ),
                {"d": str(unavailable_device)},
            )
        with engine.connect() as conn:
            degraded = conn.execute(
                text(
                    """
                    SELECT sock_source, sock_close_wait_local IS NULL,
                           sock_established_local IS NULL
                      FROM coord.device_resource_samples WHERE device_id = :d
                    """
                ),
                {"d": str(unavailable_device)},
            ).fetchone()
        assert degraded == ("unavailable", True, True), (
            "a publisher that ran and found no instrument must be able to say "
            "so with NULL counts; that is strictly more informative than a row "
            "that mentions the census not at all"
        )


def test_a_null_socket_reading_is_distinguishable_from_zero(
    _admin_url: str,
) -> None:
    """NULL ("no probe ran") and 0 stay two different values on every column.

    This is the rule the whole revision rests on, and it is sharper here than
    on the saturation lane: a MEASURED 0 is not merely legitimate, it is the
    baseline the incident's growth figure was taken against. So the schema must
    carry both, and a NOT NULL DEFAULT 0 added later would paint every machine
    that cannot probe with the exact all-clear this dimension exists to
    disprove.
    """
    device_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "fleet_res_tel_05_nz") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_sample_row(engine, device_id)

        with engine.connect() as conn:
            unset = conn.execute(
                text(
                    """
                    SELECT sock_probe_port IS NULL,
                           sock_close_wait_local IS NULL,
                           sock_close_wait_remote IS NULL,
                           sock_established_local IS NULL,
                           sock_time_wait_local IS NULL,
                           sock_source IS NULL
                      FROM coord.device_resource_samples WHERE device_id = :d
                    """
                ),
                {"d": str(device_id)},
            ).fetchone()
        assert unset == (True, True, True, True, True, True), (
            "a row that published no socket census must read as NULL, not as a "
            "defaulted 0 — 0 on this axis is a claim that the listener was "
            "looked at and found clean"
        )

        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE coord.device_resource_samples
                       SET sock_probe_port = 9876,
                           sock_close_wait_local = 0,
                           sock_close_wait_remote = 0,
                           sock_established_local = 0,
                           sock_time_wait_local = 0,
                           sock_source = 'ss'
                     WHERE device_id = :d
                    """
                ),
                {"d": str(device_id)},
            )
        with engine.connect() as conn:
            zeroed = conn.execute(
                text(
                    """
                    SELECT sock_close_wait_local,
                           sock_close_wait_local IS NULL,
                           sock_established_local,
                           sock_established_local IS NULL
                      FROM coord.device_resource_samples WHERE device_id = :d
                    """
                ),
                {"d": str(device_id)},
            ).fetchone()
        assert zeroed == (0, False, 0, False), (
            "a measured 0 must be storable and distinct from NULL: it is the "
            "known-zero baseline the 148-socket growth figure was measured "
            "against, not the absence of a reading"
        )


def test_up_down_up_leaves_no_residue_and_keeps_the_sample_row(
    _admin_url: str,
) -> None:
    """The full walk: a live sample row survives, and downgrade cleans up.

    ``downgrade()`` ALTERs the table every runner in the fleet writes to every
    30 seconds, so the assertion that the TABLE and its rows survive is not
    ceremony — an over-broad drop here destroys the fleet's whole telemetry
    history, and the table belongs to ``fleet_res_tel_01``, not to this
    revision.
    """
    device_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "fleet_res_tel_05_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_sample_row(engine, device_id)
        _assert_columns_present(engine)
        before = _sample_row(engine, device_id)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        assert table_exists(engine, "coord", _TABLE), (
            "downgrade() dropped the samples TABLE; it owns six columns there, "
            "not the table — that belongs to fleet_res_tel_01"
        )
        assert _sample_row(engine, device_id) == before, (
            "downgrade() disturbed a live sample row; it must drop columns, not data"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        # DROP COLUMN takes the comment with it, so this is the restore path
        # rather than the replay one: the re-added columns must be documented
        # again, not merely present again.
        _assert_columns_commented(engine)
        assert _sample_row(engine, device_id) == before

        # The re-added columns are NULL for the row that predates them, which
        # is the honest record: while they did not exist nothing could have
        # been measured, so there is nothing to backfill.
        with engine.connect() as conn:
            nulls = conn.execute(
                text(
                    """
                    SELECT sock_close_wait_local IS NULL, sock_source IS NULL
                      FROM coord.device_resource_samples WHERE device_id = :d
                    """
                ),
                {"d": str(device_id)},
            ).fetchone()
        assert nulls == (True, True)


def test_upgrade_is_idempotent(_admin_url: str) -> None:
    """`ADD COLUMN IF NOT EXISTS` — a re-run of upgrade() is a no-op.

    The house convention for `coord.*` tables, and worth an assertion because
    the guard is per-clause: one missing `IF NOT EXISTS` in a six-clause ALTER
    makes the whole statement abort on the re-run. The re-run also replays the
    six `COMMENT ON COLUMN` statements, which are not themselves guarded and
    must stay safe to repeat — so the replayed comments are read back too,
    rather than only asserted to have not aborted the run.
    """
    with ephemeral_database(_admin_url, "fleet_res_tel_05_id") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)


def test_no_executed_sql_contains_a_sqlalchemy_bind_parameter() -> None:
    """`op.execute("... :9876 ...")` is parsed by SQLAlchemy as a BIND PARAMETER.

    This is not hypothetical: the first cut of this revision wrote ``:9876``,
    ``:9875``, ``:3001`` and ``1:1`` into COMMENT ON COLUMN text, and every one
    of them became a required bind param. CI failed with
    ``InvalidRequestError: A value is required for bind parameter '9876'`` —
    at *downgrade-then-upgrade* time, i.e. the reversibility gate, not the
    forward run, which is the slower place to find it.

    A colon followed by a word character inside executed SQL is the whole
    hazard, so this asserts on the shape rather than on the specific ports.
    Spell ports as ``port 9876`` and ratios as ``one-for-one`` in comment text.
    """
    import re

    source = _revision_source()
    offenders: list[str] = []
    for block in re.finditer(r'op\.execute\(\s*"""(.*?)"""', source, re.S):
        for hit in re.finditer(r":\w", block.group(1)):
            start = max(0, hit.start() - 60)
            offenders.append(
                block.group(1)[start : hit.start() + 10].replace("\n", " ")
            )

    assert not offenders, (
        "executed SQL contains SQLAlchemy bind-parameter syntax (':' + word char); "
        "these will fail at migration time, not at import time:\n  "
        + "\n  ".join(offenders)
    )
