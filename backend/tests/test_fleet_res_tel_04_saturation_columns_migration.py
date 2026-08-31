"""Schema + round-trip test for the ``fleet_res_tel_04`` revision.

Phase 1 of plan
``2026-08-27-fleet-telemetry-has-no-saturation-dimension-but-memory`` adds five
saturation columns to ``coord.device_resource_samples`` (qontinui-web#1104).
The DDL is one ALTER; the contract is everything around it, and **none of it
is visible from a passing ``upgrade``** — which matters more here than for a
normal revision, because the consumer is in another repo and every way it could
notice a violation has been deliberately disabled:

1. **The column NAMES are an interface, and a typo is silent forever.** coord
   reads these over ``pg_error::is_missing_schema_object``, which swallows
   SQLSTATE 42703 so a coord deploy landing ahead of this migration fails open
   instead of erroring. The revision's own docstring draws the consequence:
   *"a typo'd column name idles forever with no error."* There is no runtime
   signal at all, in either repo, so an explicit assertion is the only pin.
2. **The TYPES are an interface too, and ``IF NOT EXISTS`` is type-blind.** It
   matches on name alone, so a column of the right name and the wrong type
   makes the ADD a silent no-op and leaves the wrong type in place — where
   coord's ``row.get::<i64>`` **panics** rather than returning a degradable
   SQLSTATE. Re-running ``upgrade()`` does not repair that. All four counts are
   ``BIGINT`` for exactly this reason, and the type is asserted by name.
3. **Every column nullable, and NULL is never 0.** This is the load-bearing
   rule of the whole revision, not tidiness: ``threads_used = 0`` renders as
   *perfectly idle* on the one axis built to catch a box at 99.3%, and the
   consumer's ``NULLS LAST`` ordering would then rank the blind machine first.
   A NOT NULL DEFAULT 0 added later would collapse "not probed" into "idle"
   with no error anywhere.
4. **``saturation_source`` carries NO CHECK, on purpose.** The revision argues
   it at length: the vocabulary is demonstrably open (the same revision that
   documents the shipped ``cgroup``/``proc`` pair widens it with
   ``job_object``), and ingest is best-effort, so a CHECK violation would fail
   the whole INSERT and discard the memory and disk metrics on the row over a
   *provenance label*. A later edit "tightening" it to a CHECKed enum is the
   regression this asserts against.
5. **``pids_max`` NULL means no ceiling applies** — cgroup v2's literal ``max``,
   which is what ``docker inspect`` reported as ``PidsLimit=<nil>`` for the
   container that consumed the whole kernel task table on 2026-08-27. It must
   survive as NULL and never as 0: a 0 ceiling makes the consumer's ratio
   divide by zero, and any non-NULL sentinel renders an unbounded cgroup as
   saturated.
6. **Up -> down -> up leaves no residue and does not touch data.** Downgrade
   drops five columns; it must leave the TABLE (that belongs to
   ``fleet_res_tel_01``) and every pre-existing sample row alone.
7. **Every column carries its ``COMMENT``, and no column carries a DEFAULT.**
   The comments are the only place rules 3 and 5 are written into the DATABASE
   — the revision's docstring ships nowhere an operator sees, and ``\\d+`` is
   where a human meets this schema. They are also five HAND-WRITTEN blocks
   while the ADDs and DROPs are generated from one list, so a sixth column is
   added, dropped and type-checked by everything here and lands undocumented.
   The DEFAULT half is rule 3's other flank: ``NOT NULL`` is not the only way
   to manufacture a 0, since a plain nullable ``DEFAULT 0`` writes one into
   every INSERT that omits the column — which is every row a pre-publisher
   runner sends.

``migration-reversal.yml`` walks the chain against an EMPTY database, so it
proves the SQL parses and nothing more: no row exists there to survive a
round-trip, and it asserts nothing about which columns arrived with which type.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing — point it
at a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the
one accepting the test credentials (on this box the canonical Postgres listens
on **5433**).

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
# It is `pdtier_01`, NOT the `fleet_res_tel_03` the plan named and NOT the
# `ffland_headsync_01` the revision was first authored against: the head moved
# twice during this revision's life. The family prefix says nothing about the
# chain edge, so read `down_revision` rather than inferring it from the name.
_REVISION_ID = "fleet_res_tel_04"
_PARENT_REVISION_ID = "pdtier_01"
_REVISION_FILENAME = "fleet_res_tel_04_saturation_columns.py"

_TABLE = "device_resource_samples"

# (column, information_schema.data_type). The type strings are PostgreSQL's own
# spellings, so a BIGINT that regressed to INTEGER fails loudly here rather
# than at coord's first `row.get::<i64>` — which is a panic, not a degrade.
_EXPECTED: tuple[tuple[str, str], ...] = (
    ("threads_max", "bigint"),
    ("threads_used", "bigint"),
    ("pids_max", "bigint"),
    ("pids_used", "bigint"),
    ("saturation_source", "text"),
)

# The same five, spelled as the revision's own DDL spells them — this is what
# the module-constant guard compares against, so a name or type edited in one
# place and not the other cannot pass.
#
# Only THIS tuple is pinned to the revision's `_SATURATION_COLUMNS`; `_EXPECTED`
# above is pinned to nothing, and it is what every live-schema walk iterates.
# So a sixth column fails the revision-list guard, gets added here to fix it,
# and is then absent from `_EXPECTED` — where its omission is silent, because
# `_assert_columns_present` only checks the names it was handed. The two are
# reconciled by `test_the_two_column_tables_describe_the_same_five` below.
_EXPECTED_DDL: tuple[tuple[str, str], ...] = (
    ("threads_max", "BIGINT"),
    ("threads_used", "BIGINT"),
    ("pids_max", "BIGINT"),
    ("pids_used", "BIGINT"),
    ("saturation_source", "TEXT"),
)

# The 2026-08-27 incident reading, verbatim, as the row that motivated the
# revision: `qontinui-canonical-coord` at 190,840 PIDs against a
# /proc/sys/kernel/threads-max of 192,146 — 99.3%.
#
# `pids_max` is None on purpose and is the most load-bearing value here:
# `docker inspect` showed `PidsLimit=<nil>`, i.e. cgroup v2's literal `max`.
# NOTHING bounded that container, which is why the host kernel ceiling was the
# binding one. NULL is how the schema says that.
_INCIDENT_THREADS_MAX = 192_146
_INCIDENT_USED = 190_840

# Deliberately past 2^31-1 (2,147,483,647). A task table is exactly the counter
# that grows by orders of magnitude between machine classes, and coord reads it
# as `Option<i64>`; a narrowed column dies on this write rather than surviving
# to panic in `row.get`. This is a SECOND, independent pin on the same
# property `_EXPECTED` asserts from the catalogue.
_BEYOND_INT32 = 4_294_967_296


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _expected_comment(column: str) -> str:
    """The body the revision's own source emits for ``column``.

    Read from the ONE author rather than copied here: a second copy of five
    prose blocks is the divergence such an assertion exists to catch, and the
    reader collapses the doubled apostrophes exactly as the SQL parser does.
    """
    return comment_body_from_source(_revision_source(), f"coord.{_TABLE}.{column}")


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
        f"but this test pins {_PARENT_REVISION_ID!r}. Re-point both together."
    )


def _revision_module():
    """Import the revision file directly — it only imports ``alembic.op``."""
    return load_revision_module(_revision_path(), "_fleet_res_tel_04_under_test")


def test_the_revision_names_the_columns_coord_reads_from_one_list() -> None:
    """The five names and types, read off the revision's own constants.

    This is the guard that has no runtime backstop anywhere. coord reaches
    these columns through `is_missing_schema_object`, which swallows 42703
    precisely so a coord deploy that lands ahead of the migration degrades
    instead of erroring — and the same swallow means a MISSPELLED column is
    indistinguishable from one that has not shipped yet. There is no error, in
    either repo, ever. Reading the module's constants (rather than grepping the
    DDL text) also pins that the upgrade's ADDs and the downgrade's DROPs are
    generated from ONE list, which is what makes "add and drop the same five"
    mechanical instead of a convention.
    """
    module = _revision_module()
    assert module._TABLE == f"coord.{_TABLE}", (
        "the revision must widen coord.device_resource_samples; the saturation "
        "axis belongs on the sample row, beside the memory instruments it "
        "exists to be independent of"
    )
    assert tuple(module._SATURATION_COLUMNS) == _EXPECTED_DDL, (
        "the revision's column list drifted from what coord's ResourceSampleRow "
        "reads. These names are an INTERFACE across two repos and 42703 is "
        "swallowed on the reading side, so drift here idles forever in silence "
        "rather than failing."
    )


def test_the_two_column_tables_describe_the_same_five() -> None:
    """`_EXPECTED` and `_EXPECTED_DDL` name the same columns, in the same order.

    Closes the one seam between the guards above and the walks below.
    `_EXPECTED_DDL` is pinned to the revision's `_SATURATION_COLUMNS`; nothing
    pinned `_EXPECTED`, and `_EXPECTED` is what every live-schema assertion
    iterates. Adding a sixth column therefore failed the revision-list guard,
    was fixed by extending `_EXPECTED_DDL` alone, and then shipped a column
    that no walk in this file ever looked at — present, dropped and
    round-tripped by the revision, and unchecked for type, nullability or
    default. This is a name-level pin only: the type SPELLINGS differ on
    purpose (``BIGINT`` in DDL, ``bigint`` in ``information_schema``).
    """
    assert [name for name, _ in _EXPECTED] == [name for name, _ in _EXPECTED_DDL], (
        "the catalogue table and the DDL table list different columns; every "
        "live-schema walk below iterates the FORMER, so a column present only "
        "in the latter is added by the revision and asserted about by nothing"
    )


def test_the_revision_comments_every_column_it_adds() -> None:
    """Each of the five carries a ``COMMENT ON COLUMN`` in the revision source.

    The ADDs and DROPs are generated from `_SATURATION_COLUMNS`; the comments
    are **five hand-written blocks** that are not. So a sixth column added to
    that list is added, dropped, type-checked and round-tripped by everything
    else in this file, and lands with no comment at all — the exact asymmetry
    `sess_guard_01` asserts against for the same reason (*"a column name cannot
    say it"*).

    That matters more here than tidiness, because these comments are the only
    place the NULL-is-never-0 rule is written into the database itself. coord
    reads these columns across a repo boundary through a swallowed 42703, the
    revision's docstring is not shipped anywhere an operator sees, and
    ``\\d+`` is where a human meets this schema.

    Structural rather than database-backed: it never skips, which is the point
    — the four walks below skip wholesale when no Postgres is reachable.
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


def test_the_revision_generates_its_drops_from_the_same_list() -> None:
    """Every column is both ADDed idempotently and DROPped, in the two spellings.

    A structural guard beside the round-trip walk below, which proves the same
    agreement behaviourally but only for the columns that exist TODAY. This one
    reads the generated SQL, so it also pins the two per-clause guards the
    round-trip cannot see the absence of: `IF NOT EXISTS` on every ADD (the
    guard is per-clause, so one missing clause aborts the whole re-run) and
    `IF EXISTS` on every DROP.

    Together with the list assertion above — which pins `_EXPECTED_DDL` against
    the revision's own `_SATURATION_COLUMNS` — a sixth column cannot reach
    `upgrade()` without also reaching `downgrade()` and this file.
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


# ---------------------------------------------------------------------------
# Live-schema walks.
# ---------------------------------------------------------------------------


def _columns(engine: Engine) -> dict[str, tuple[str, str, str | None]]:
    """``{column: (data_type, is_nullable, column_default)}`` for the table.

    One bulk read rather than the harness's per-column ``column_info``: the
    round-trip walk calls this three times over five columns, and
    [`_assert_columns_absent`] needs the whole set rather than one column.
    """
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
    """All five columns, right type, nullable, and carrying no default."""
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
            f"'not probed', and 0 on this axis means 'perfectly idle'"
        )
        # Nullability alone does not defend the NULL-is-never-0 rule: a plain
        # `DEFAULT 0` leaves the column nullable and still writes 0 into every
        # INSERT that omits it, which is every row a pre-publisher runner
        # sends. The no-default state is what makes an unprobed lane read as
        # unknown rather than as idle.
        assert default is None, (
            f"coord.{_TABLE}.{name} carries DEFAULT {default}; a default on "
            f"this axis manufactures a reading nothing measured — 0 renders as "
            f"perfectly idle, and NULLS LAST would rank the blind machine first"
        )


def _assert_columns_commented(engine: Engine) -> None:
    """Each column's ``col_description`` is what the revision's source emits.

    Compared against the revision rather than a copy pasted here, so the
    assertion cannot drift from the thing it describes.

    Worth a live read on top of the structural guard above, which only proves
    the source CONTAINS the blocks: the five ``COMMENT ON COLUMN`` statements
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
            f"These comments are the only place NULL-is-never-0 is recorded in "
            f"the database itself; coord reads these columns from another repo "
            f"through a swallowed 42703, so nothing at runtime would notice."
        )


def _assert_columns_absent(engine: Engine) -> None:
    """No residue after downgrade."""
    cols = _columns(engine)
    for name, _ in _EXPECTED:
        assert name not in cols, f"coord.{_TABLE}.{name} survived downgrade()"


def _seed_sample_row(engine: Engine, device_id: uuid.UUID) -> None:
    """One pre-existing sample row, as an already-live database would have.

    Only the NOT NULL columns plus a memory reading: this row predates the
    saturation axis, which is the whole point of it — it is what the round-trip
    walk below checks survives untouched.
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
    """The pre-saturation columns of a seeded row.

    Deliberately not the saturation columns: they do not exist after
    downgrade, and the point of this read is that the columns predating the
    revision survive the walk untouched.
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
    """The 2026-08-27 reading round-trips, unbounded ceiling and all.

    Written as the publisher will write it — the four counts and their
    ``saturation_source`` in the same INSERT as the memory metrics, because
    that is the row shape that made the incident invisible: accurate memory
    numbers beside a saturation axis that did not exist.

    Four properties in one walk, since every database-backed test here replays
    the whole chain into its own ephemeral database (~2 min each) and a second
    replay costs real wall-clock for what an extra query answers for free:

    * the five columns arrive with the right types and nullability;
    * ``pids_max IS NULL`` survives as NULL — the unbounded cgroup;
    * a count past 2^31 is storable, so a narrowed column dies on the write;
    * no CHECK governs ``saturation_source``, so an instrument nobody has
      named yet cannot take a whole best-effort sample down with it.

    There is deliberately no separate "upgrade adds the columns" test: this one
    upgrades and asserts that shape before doing anything else.
    """
    device_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "fleet_res_tel_04_in") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)

        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, lane_instance, source,
                         mem_total_bytes, mem_available_bytes,
                         commit_total_bytes, commit_available_bytes,
                         threads_max, threads_used, pids_max, pids_used,
                         saturation_source)
                    VALUES (:d, 'container', 'qontinui-canonical-coord',
                            'runner',
                            34359738368, 3800000000,
                            134876397568, 78678556672,
                            :tmax, :used, NULL, :used, 'cgroup')
                    """
                ),
                {
                    "d": str(device_id),
                    "tmax": _INCIDENT_THREADS_MAX,
                    "used": _INCIDENT_USED,
                },
            )

        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT threads_max, threads_used, pids_max, pids_used,
                           saturation_source, pids_max IS NULL
                      FROM coord.device_resource_samples
                     WHERE device_id = :d
                    """
                ),
                {"d": str(device_id)},
            ).fetchone()

        assert row is not None, "no saturation row"
        assert tuple(row) == (
            _INCIDENT_THREADS_MAX,
            _INCIDENT_USED,
            None,
            _INCIDENT_USED,
            "cgroup",
            True,
        ), (
            "the incident reading did not round-trip. pids_max in particular "
            "must stay NULL: docker inspect reported PidsLimit=<nil>, so "
            "nothing bounded the cgroup and the host kernel ceiling was the "
            "binding one — a 0 there would divide the consumer's ratio by zero"
        )

        # The BIGINT pin from the write side. The catalogue assertion above
        # reads the declared type; this one proves the column actually accepts
        # a value an INTEGER could not hold.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE coord.device_resource_samples
                       SET threads_max = :big, threads_used = :big
                     WHERE device_id = :d
                    """
                ),
                {"d": str(device_id), "big": _BEYOND_INT32},
            )
        with engine.connect() as conn:
            wide = conn.execute(
                text(
                    "SELECT threads_max, threads_used FROM "
                    "coord.device_resource_samples WHERE device_id = :d"
                ),
                {"d": str(device_id)},
            ).fetchone()
        assert wide == (_BEYOND_INT32, _BEYOND_INT32), (
            "a count past 2^31 did not survive; the ceiling scales with RAM "
            "and coord reads these as Option<i64>, so an INTEGER column is a "
            "runtime type error there rather than a widening"
        )

        # `saturation_source` is free text, and that is a decision the revision
        # argues at length, not an omission. `job_object` is in the documented
        # vocabulary with NO shipped publisher — the Windows host lane's arm,
        # introduced by this very revision — and a fourth instrument is a
        # plausible outcome of the publisher phase. A CHECKed enum would reject
        # the whole best-effort INSERT over an unrecognised *provenance label*,
        # discarding the memory and disk metrics on the same row. Rejecting a
        # saturation sample because we did not recognise the name of the
        # instrument that took it is precisely backwards during an incident,
        # which is the only time these rows matter.
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
                       AND a.attname = 'saturation_source'
                    """
                )
            ).fetchall()
        assert checks == [], (
            f"a CHECK now governs saturation_source ({checks}); it sits on the "
            f"free-text `source` side of this table's CHECKed-lane vs "
            f"free-text-source split, and tightening it to an enum breaks "
            f"best-effort ingest for exactly the rows that matter most"
        )

        # And behaviourally: a label with no publisher anywhere is storable.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, source, threads_max, threads_used,
                         saturation_source)
                    VALUES (:d, 'host', 'runner', 1000, 10, 'job_object')
                    """
                ),
                {"d": str(device_id)},
            )


def test_a_null_saturation_reading_is_distinguishable_from_zero(
    _admin_url: str,
) -> None:
    """NULL ("not probed") and 0 stay two different values on every column.

    This is the rule the whole revision rests on. ``threads_used = 0`` renders
    as *perfectly idle* on the one axis built to catch a box at 99.3%, and the
    consumer's ``NULLS LAST`` ordering would rank the blind machine first — so
    a NOT NULL DEFAULT 0 added later would not merely lose information, it
    would invert the verdict for exactly the machine this plan exists to catch.
    """
    device_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "fleet_res_tel_04_nz") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_sample_row(engine, device_id)

        with engine.connect() as conn:
            unset = conn.execute(
                text(
                    """
                    SELECT threads_max IS NULL, threads_used IS NULL,
                           pids_max IS NULL, pids_used IS NULL,
                           saturation_source IS NULL
                      FROM coord.device_resource_samples WHERE device_id = :d
                    """
                ),
                {"d": str(device_id)},
            ).fetchone()
        assert unset == (True, True, True, True, True), (
            "a row that published no saturation reading must read as NULL, not "
            "as a defaulted 0 — 0 on this axis is a claim of idleness, and a "
            "pre-publisher runner must render unknown, never green"
        )

        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE coord.device_resource_samples
                       SET threads_used = 0, pids_used = 0
                     WHERE device_id = :d
                    """
                ),
                {"d": str(device_id)},
            )
        with engine.connect() as conn:
            zeroed = conn.execute(
                text(
                    """
                    SELECT threads_used, threads_used IS NULL,
                           pids_used, pids_used IS NULL
                      FROM coord.device_resource_samples WHERE device_id = :d
                    """
                ),
                {"d": str(device_id)},
            ).fetchone()
        assert zeroed == (0, False, 0, False), (
            "0 must be storable and distinct from NULL: a genuinely idle lane "
            "is a legitimate reading, not the absence of one"
        )


def test_up_down_up_leaves_no_residue_and_keeps_the_sample_row(
    _admin_url: str,
) -> None:
    """The full walk: a live sample row survives, and downgrade cleans up.

    ``downgrade()`` ALTERs the table every runner in the fleet writes to every
    30 seconds, so the assertion that the TABLE and its rows survive is not
    ceremony — an over-broad drop here destroys the fleet's whole telemetry
    history, and it belongs to ``fleet_res_tel_01``, not to this revision.
    """
    device_id = uuid.uuid4()
    with ephemeral_database(_admin_url, "fleet_res_tel_04_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_sample_row(engine, device_id)
        _assert_columns_present(engine)
        before = _sample_row(engine, device_id)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        assert table_exists(engine, "coord", _TABLE), (
            "downgrade() dropped the samples TABLE; it owns five columns "
            "there, not the table — that belongs to fleet_res_tel_01"
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
        # been measured, so there is nothing to backfill. This is also the
        # steady state on the whole fleet until every machine's runner is
        # rebuilt with a publisher.
        with engine.connect() as conn:
            nulls = conn.execute(
                text(
                    """
                    SELECT threads_used IS NULL, saturation_source IS NULL
                      FROM coord.device_resource_samples WHERE device_id = :d
                    """
                ),
                {"d": str(device_id)},
            ).fetchone()
        assert nulls == (True, True)


def test_upgrade_is_idempotent(_admin_url: str) -> None:
    """`ADD COLUMN IF NOT EXISTS` — a re-run of upgrade() is a no-op.

    The house convention for `coord.*` tables, and worth an assertion because
    the guard is per-clause: one missing `IF NOT EXISTS` in a five-clause ALTER
    makes the whole statement abort on the re-run. The re-run also replays the
    five `COMMENT ON COLUMN` statements, which are not themselves guarded and
    must stay safe to repeat — so the replayed comments are read back too,
    rather than only asserted to have not aborted the run.
    """
    with ephemeral_database(_admin_url, "fleet_res_tel_04_id") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)
