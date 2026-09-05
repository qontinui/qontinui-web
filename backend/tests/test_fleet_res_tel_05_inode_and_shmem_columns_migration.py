"""Schema + round-trip test for the ``fleet_res_tel_05`` revision.

Phase 1 of plan
``2026-09-04-devops-inode-and-shmem-axes-are-invisible-to-fleet-telemetry`` adds
the inode pair and the shmem split to ``coord.device_resource_samples``. The DDL
is one ALTER; the contract is everything around it, and **none of it is visible
from a passing ``upgrade``** — which matters more here than for a normal
revision, because the consumer is in another repo and every way it could notice
a violation has been deliberately disabled. The list is
``fleet_res_tel_04``'s, because this revision is that one's structural sibling
on a third axis:

1. **The column NAMES are an interface, and a typo is silent forever.** coord
   reads these over ``pg_error::is_missing_schema_object``, which swallows
   SQLSTATE 42703 so a coord deploy landing ahead of this migration fails open
   instead of erroring. There is no runtime signal at all, in either repo, so an
   explicit assertion is the only pin.
2. **The TYPES are an interface too, and ``IF NOT EXISTS`` is type-blind.** It
   matches on name alone, so a column of the right name and the wrong type makes
   the ADD a silent no-op and leaves the wrong type in place — where coord's
   ``row.get::<i64>`` **panics** rather than returning a degradable SQLSTATE.
   All three are ``BIGINT``, and ``swap_shmem_bytes`` is not merely nominally so:
   the incident value is 67.2e9, which does not fit an ``INTEGER`` at all.
3. **Every column nullable, and NULL is never 0.** For this revision that rule
   carries a second, filesystem-level reason on top of the failed-probe one:
   btrfs, xfs and zfs allocate inodes dynamically and report ``f_files == 0``,
   so ``disk_inodes_total IS NULL`` legitimately means *no cap is measurable*. A
   substituted "0 used of 0" would compute the HEALTHIEST possible reading on
   exactly the filesystems where nothing is measurable, and a ``NULLS LAST``
   ranking would then promote the blind machine to the front of the queue.
4. **No CHECK, and no DEFAULT.** ``NOT NULL`` is not the only way to manufacture
   a 0: a plain nullable ``DEFAULT 0`` writes one into every INSERT that omits
   the column — which is every row a pre-publisher runner sends.
5. **A NULL inode reading must be distinguishable from an exhausted one.** The
   whole axis exists because 71.3% inode consumption rendered as nothing; a
   design where "no opinion" and "fully consumed" collapse into one value
   reintroduces the blind spot one level down.
6. **Up -> down -> up leaves no residue and does not touch data.** Downgrade
   drops three columns; it must leave the TABLE (that belongs to
   ``fleet_res_tel_01``) and every pre-existing sample row alone.
7. **Every column carries its ``COMMENT``.** The comments are the only place
   rules 3 and 5 are written into the DATABASE — the revision's docstring ships
   nowhere an operator sees. They are also three HAND-WRITTEN blocks while the
   ADDs and DROPs are generated from one list, so a fourth column is added,
   dropped and type-checked by everything here and lands undocumented unless a
   test pins the two together.

``migration-reversal.yml`` walks the chain against an EMPTY database, so it
proves the SQL parses and nothing more: no row exists there to survive a
round-trip, and it asserts nothing about which columns arrived with which type.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. A skip proves nothing — point it at a
live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the one
accepting the test credentials (on this box the canonical Postgres listens on
**5433**). Use that variable, **not** ``DATABASE_URL``: ``conftest.py``
overwrites ``os.environ["DATABASE_URL"]`` unconditionally at import time from
``QONTINUI_TEST_PG``, so setting ``DATABASE_URL`` on the command line is
silently discarded and every database-backed test below skips against 5432 —
which looks exactly like a green run in the summary line.
"""

from __future__ import annotations

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
    column_info,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

# Pinned explicitly rather than "head" so a later revision landing on top cannot
# silently change what this test walks. `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision` — the first test below enforces it, because a
# stale pin rewinds too far and replays unrelated non-idempotent revisions,
# surfacing as someone else's `DuplicateTable`.
#
# It is `reqchk_walk_01`, NOT the `fleet_res_tel_04` the family prefix suggests:
# that revision stopped being the chain head long ago. The prefix carries the
# lineage, never the edge.
_REVISION_ID = "fleet_res_tel_05"
_PARENT_REVISION_ID = "reqchk_walk_01"
_REVISION_FILENAME = "fleet_res_tel_05_inode_and_shmem_columns.py"

_TABLE = "device_resource_samples"
_QUALIFIED = f"coord.{_TABLE}"

# (column, information_schema.data_type). The type strings are PostgreSQL's own
# spellings, so a BIGINT that regressed to INTEGER fails loudly here rather than
# at coord's first `row.get::<i64>` — which is a panic, not a degrade.
_EXPECTED: tuple[tuple[str, str], ...] = (
    ("disk_inodes_total", "bigint"),
    ("disk_inodes_free", "bigint"),
    ("swap_shmem_bytes", "bigint"),
)

# The same three, spelled as the revision's own DDL spells them — this is what
# the module-constant guard compares against, so a name or type edited in one
# place and not the other cannot pass. Only THIS tuple is pinned to the
# revision's `_INODE_AND_SHMEM_COLUMNS`; `_EXPECTED` above is pinned to nothing
# and is what every live-schema walk iterates, so the two are reconciled by
# `test_the_two_column_tables_describe_the_same_three` below.
_EXPECTED_DDL: tuple[tuple[str, str], ...] = (
    ("disk_inodes_total", "BIGINT"),
    ("disk_inodes_free", "BIGINT"),
    ("swap_shmem_bytes", "BIGINT"),
)

# The 2026-09-04 merytshost reading, verbatim, as the row that motivated the
# revision. `df -i /tmp` -> 1048576 total, 747696 used, 300880 free = 71.3%,
# while `df -h` on the same mount said 37% and MemAvailable said 77% free.
_INCIDENT_INODES_TOTAL = 1_048_576
_INCIDENT_INODES_FREE = 300_880
# 62.6 GiB of the 73.5 GiB of swap in use was cold tmpfs, not process memory.
_INCIDENT_SHMEM_BYTES = 67_211_048_550


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _expected_comment(column: str) -> str:
    """The comment body the REVISION emits, read out of its own source.

    Never a second copy of the prose: a test holding its own copy would pass
    while the two drifted, which is the failure mode this helper exists for.
    """
    return comment_body_from_source(_revision_source(), f"{_QUALIFIED}.{column}")


def _revision_module():
    return load_revision_module(_revision_path(), f"_rev_{_REVISION_ID}")


# ---------------------------------------------------------------------------
# Source-level guards — no database needed, so they never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """The walk target below is only correct while this equality holds."""
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "the revision was re-pointed onto a new chain head (expected by "
        "`alembic-heads-pr` on a busy repo) and `_PARENT_REVISION_ID` was not "
        "updated with it; the walk below would rewind past unrelated revisions"
    )


def test_the_revision_names_the_columns_coord_reads_from_one_list() -> None:
    """The ADDs are generated, so the module constant IS the interface."""
    module = _revision_module()
    assert tuple(module._INODE_AND_SHMEM_COLUMNS) == _EXPECTED_DDL, (
        "the revision's column list changed; coord reads these names over a "
        "42703-swallowing degrade path, so a rename idles forever with no error"
    )
    assert module._TABLE == _QUALIFIED


def test_the_two_column_tables_describe_the_same_three() -> None:
    """`_EXPECTED` and `_EXPECTED_DDL` cannot drift into different sets.

    `_EXPECTED_DDL` is pinned to the revision; `_EXPECTED` is pinned to nothing
    and is what the live-schema assertions iterate. Without this, a fourth
    column added to the revision is caught by the guard above, added here to fix
    it, and is then silently untested against the real schema.
    """
    assert [name for name, _ in _EXPECTED] == [name for name, _ in _EXPECTED_DDL]
    for (name, pg_type), (_, ddl_type) in zip(_EXPECTED, _EXPECTED_DDL, strict=True):
        assert ddl_type.lower() == pg_type, (
            f"{name}: the DDL says {ddl_type} and the schema assertion expects "
            f"{pg_type}; IF NOT EXISTS is type-blind, so a mismatch here is a "
            "silent no-op in production and a panic in coord"
        )


def test_the_revision_comments_every_column_it_adds() -> None:
    """Three generated ADDs, three hand-written COMMENTs — pinned together."""
    source = _revision_source()
    for name, _ in _EXPECTED_DDL:
        marker = f"COMMENT ON COLUMN {_QUALIFIED}.{name} IS"
        assert marker in source, (
            f"{name} is added by the generated ALTER but carries no COMMENT; "
            "the comments are the only place the NULL-is-not-zero rule reaches "
            "an operator reading the live schema"
        )
        body = _expected_comment(name)
        assert "NULL" in body, f"{name}'s comment must state what NULL means"


def test_the_inode_comments_state_that_a_null_ceiling_is_a_filesystem_fact() -> None:
    """Rule 3's second reason must survive a later "tidying" of the prose.

    A reader who takes `disk_inodes_total IS NULL` for "the probe failed" will
    write a consumer that treats a dynamically-allocating filesystem as broken;
    one who takes it for "no cap" will not guard a failed probe. The comment has
    to say it is both.
    """
    body = _expected_comment("disk_inodes_total")
    assert "f_files" in body, "the comment must name the statfs field it stores"
    lowered = body.lower()
    assert "btrfs" in lowered or "dynamically" in lowered, (
        "the comment must say a NULL ceiling can be a real filesystem fact, not "
        "only a failed probe"
    )


def test_the_shmem_comment_refuses_the_formula_change_it_enables() -> None:
    """`swap_shmem_bytes` is observability first — that bound is load-bearing.

    Netting shmem out of `lane_pressure` is a live behaviour change to dispatch
    ranking on every Linux box in the fleet. The plan withholds it explicitly,
    and the column comment is where a future implementer meets that decision.
    """
    lowered = _expected_comment("swap_shmem_bytes").lower()
    assert "lane_pressure" in lowered
    assert "inference" in lowered, (
        "the comment must state that this number is an inference rather than a "
        "counter — /proc/meminfo exposes no swapped-out-tmpfs counter, and a "
        "consumer that believes otherwise will trust it too far"
    )


def test_the_revision_generates_its_drops_from_the_same_list() -> None:
    """Downgrade must be the exact inverse, over the one list."""
    module = _revision_module()
    drops = module._drop_columns(_QUALIFIED)
    adds = module._add_columns(_QUALIFIED)
    for name, sql_type in _EXPECTED_DDL:
        assert f"ADD COLUMN IF NOT EXISTS {name} {sql_type}" in adds
        assert f"DROP COLUMN IF EXISTS {name}" in drops


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _assert_columns_present(engine: Engine) -> None:
    for name, pg_type in _EXPECTED:
        info = column_info(engine, _TABLE, name)
        assert info is not None, f"{name} missing after upgrade"
        data_type, is_nullable, default = info
        assert data_type == pg_type, (
            f"{name} is {data_type}, expected {pg_type}; coord reads it as "
            "Option<i64> and a narrower column is a runtime panic, not a widening"
        )
        assert is_nullable == "YES", (
            f"{name} is NOT NULL; an unprobed lane must be able to report the "
            "rest of its row without fabricating a value on this axis"
        )
        assert default is None, (
            f"{name} carries DEFAULT {default!r}; a nullable DEFAULT 0 writes a "
            "fabricated zero into every INSERT that omits the column, which is "
            "every row a pre-publisher runner sends"
        )


def _assert_columns_commented(engine: Engine) -> None:
    for name, _ in _EXPECTED:
        live = column_comment(engine, _TABLE, name)
        assert live == _expected_comment(name), (
            f"{name}'s live comment differs from the one its revision emits"
        )


def _assert_columns_absent(engine: Engine) -> None:
    for name, _ in _EXPECTED:
        assert column_info(engine, _TABLE, name) is None, f"{name} survived downgrade"


def _seed_sample_row(engine: Engine, device_id: uuid.UUID) -> None:
    """One pre-existing row, to prove downgrade does not touch data."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.device_resource_samples
                    (device_id, lane, sampled_at, source, disk_mount)
                VALUES (:device_id, 'wsl', now(), 'test', '/tmp')
                """
            ),
            {"device_id": str(device_id)},
        )


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def test_a_sample_row_carries_the_incident_reading() -> None:
    """The 2026-09-04 numbers must round-trip through the real columns.

    This is the plan's own acceptance criterion, at the storage layer: replaying
    §1's readings must produce a row from which 747,696 / 1,048,576 is
    recoverable as its OWN axis rather than folded into the memory ratio.
    """
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "frt05") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TABLE)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)

        device_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source, disk_mount,
                         disk_inodes_total, disk_inodes_free, swap_shmem_bytes)
                    VALUES (:device_id, 'wsl', now(), 'test', '/tmp',
                            :total, :free, :shmem)
                    """
                ),
                {
                    "device_id": str(device_id),
                    "total": _INCIDENT_INODES_TOTAL,
                    "free": _INCIDENT_INODES_FREE,
                    "shmem": _INCIDENT_SHMEM_BYTES,
                },
            )
            row = conn.execute(
                text(
                    """
                    SELECT disk_inodes_total, disk_inodes_free, swap_shmem_bytes
                      FROM coord.device_resource_samples
                     WHERE device_id = :device_id
                    """
                ),
                {"device_id": str(device_id)},
            ).one()

        assert row == (
            _INCIDENT_INODES_TOTAL,
            _INCIDENT_INODES_FREE,
            _INCIDENT_SHMEM_BYTES,
        )
        used = _INCIDENT_INODES_TOTAL - _INCIDENT_INODES_FREE
        assert round(used / _INCIDENT_INODES_TOTAL, 3) == 0.713, (
            "the stored pair must reproduce the measured 71.3% — the number the "
            "whole plan exists to make expressible"
        )
        assert _INCIDENT_SHMEM_BYTES > 2**31, (
            "the shmem value does not fit an INTEGER; this is why the column is "
            "BIGINT at the value level and not merely by convention"
        )


def test_a_null_inode_reading_is_distinguishable_from_an_exhausted_one() -> None:
    """No opinion and fully consumed must never collapse into one value.

    A filesystem with no inode cap (`f_files == 0`) and a filesystem at 100% are
    the two readings a naive publisher conflates, and conflating them
    reintroduces the blind spot this revision closes.
    """
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "frt05n") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        unmeasured = uuid.uuid4()
        exhausted = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source, disk_mount,
                         disk_inodes_total, disk_inodes_free, swap_shmem_bytes)
                    VALUES
                        (:unmeasured, 'wsl', now(), 'test', '/', NULL, NULL, NULL),
                        (:exhausted, 'wsl', now(), 'test', '/tmp', 1048576, 0, 0)
                    """
                ),
                {"unmeasured": str(unmeasured), "exhausted": str(exhausted)},
            )
            rows = {
                str(r[0]): (r[1], r[2], r[3])
                for r in conn.execute(
                    text(
                        """
                        SELECT device_id, disk_inodes_total, disk_inodes_free,
                               swap_shmem_bytes
                          FROM coord.device_resource_samples
                         WHERE device_id IN (:unmeasured, :exhausted)
                        """
                    ),
                    {"unmeasured": str(unmeasured), "exhausted": str(exhausted)},
                )
            }

        assert rows[str(unmeasured)] == (None, None, None), (
            "an unmeasured axis must survive as NULL; a 0 here renders as "
            "perfectly healthy on the one axis built to catch an exhausted box"
        )
        assert rows[str(exhausted)] == (1_048_576, 0, 0)
        assert rows[str(unmeasured)] != rows[str(exhausted)]


def test_up_down_up_leaves_no_residue_and_keeps_the_sample_row() -> None:
    """Downgrade drops three columns and touches nothing else."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "frt05r") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        device_id = uuid.uuid4()
        _seed_sample_row(engine, device_id)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        assert table_exists(engine, "coord", _TABLE), (
            "downgrade dropped the TABLE; it belongs to fleet_res_tel_01 and "
            "this revision only ever added columns to it"
        )
        with engine.connect() as conn:
            survived = conn.execute(
                text(
                    "SELECT count(*) FROM coord.device_resource_samples "
                    "WHERE device_id = :device_id"
                ),
                {"device_id": str(device_id)},
            ).scalar_one()
        assert survived == 1, "downgrade destroyed a pre-existing sample row"

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)


def test_upgrade_is_idempotent() -> None:
    """Re-running the revision's own upgrade() is a no-op, not an error.

    Alembic will not replay a revision once `alembic_version` names it, so the
    ADD COLUMN IF NOT EXISTS guards are only exercised by invoking the module
    directly.
    """
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "frt05i") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)

        module = _revision_module()
        with engine.begin() as conn:
            conn.execute(text(module._add_columns(_QUALIFIED)))

        _assert_columns_present(engine)
        _assert_columns_commented(engine)
