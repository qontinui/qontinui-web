"""Schema + round-trip test for the ``ci_job_res_01`` revision.

Phase 3 of plan ``2026-10-27-coord-routes-ci-jobs-by-runner-capability`` adds
six columns to ``coord.ci_job_observations`` that a CI job's
``qontinui-resource-report`` annotation fills (see the revision docstring for
the report-key -> column map). The contract a passing ``upgrade`` does not
show:

1. **Names and types are a cross-repo interface.** coord writes these through a
   42703-degrading UPDATE, so a misspelled column is indistinguishable from one
   that has not shipped: the names and types are pinned here, against the
   revision's own list.
2. **Nullable, undefaulted, NULL distinct from 0.** The report OMITS an
   unmeasured key; a defaulted 0 would fabricate "committed nothing" or an OOM
   all-clear. ``cgroup_oom_kills = 0`` is a real reading and must stay distinct
   from NULL.
3. **No CHECK on the two TEXT columns** — a label must never fail the UPSERT.
4. **Up -> down -> up removes only these six** and leaves the table, its rows
   and ``ci_job_mem_01``'s columns alone.
5. **Every column carries its COMMENT**, read back from the database.

Substrate comes from ``_alembic_harness``; a skip proves nothing — set
``QONTINUI_TEST_PG_DSN`` to a live pgvector instance.
"""

from __future__ import annotations

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
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

_REVISION_ID = "ci_job_res_01"
_PARENT_REVISION_ID = "journey_02_explorations"
_REVISION_FILENAME = "ci_job_res_01_resource_report_columns.py"

_TABLE = "ci_job_observations"

# (column, information_schema.data_type) — what every live walk iterates.
_EXPECTED: tuple[tuple[str, str], ...] = (
    ("peak_commit_mb", "integer"),
    ("commit_limit_mb", "integer"),
    ("peak_anon_mem_mb", "integer"),
    ("cgroup_oom_kills", "integer"),
    ("resource_os", "text"),
    ("build_outcome", "text"),
)

# The same six as the revision's DDL spells them.
_EXPECTED_DDL: tuple[tuple[str, str], ...] = (
    ("peak_commit_mb", "INTEGER"),
    ("commit_limit_mb", "INTEGER"),
    ("peak_anon_mem_mb", "INTEGER"),
    ("cgroup_oom_kills", "INTEGER"),
    ("resource_os", "TEXT"),
    ("build_outcome", "TEXT"),
)

_DDL_TO_INFORMATION_SCHEMA = {"INTEGER": "integer", "TEXT": "text"}

# The ci_job_mem_01 columns the report ALSO fills; downgrade must not touch them.
_PRIOR_COLUMNS: tuple[str, ...] = (
    "peak_swap_used_mb",
    "swap_total_mb",
    "mem_total_mb",
    "min_disk_avail_mb",
    "resource_source",
)

# Runner job 122032841168's hosted windows-latest class (plan 2026-10-27 Why):
# TotalVisibleMemorySize 16771836 KB -> 16378 MB; TotalVirtualMemorySize
# 50326268 KB -> 49146 MB; the 32 GB pagefile's PeakUsage 32767 MB.
_WIN_PHYS_MB = 16378
_WIN_COMMIT_LIMIT_MB = 49146
_WIN_PAGEFILE_PEAK_MB = 32767


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _expected_comment(column: str) -> str:
    return comment_body_from_source(_revision_source(), f"coord.{_TABLE}.{column}")


def _ci_job_mem_01_comment(column: str) -> str:
    """The COMMENT ``ci_job_mem_01`` gave ``column``, from that revision's own
    source, its one author. This test holds no copy of it."""
    source = (
        backend_root()
        / "alembic"
        / "versions"
        / "ci_job_mem_01_memory_headroom_columns.py"
    ).read_text(encoding="utf-8")
    return comment_body_from_source(source, f"coord.{_TABLE}.{column}")


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    declared = declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} but this test "
        f"pins {_PARENT_REVISION_ID!r}; re-point both together"
    )


def test_the_revision_names_the_columns_coord_writes_from_one_list() -> None:
    module = load_revision_module(_revision_path(), "_ci_job_res_01_under_test")
    assert module._TABLE == f"coord.{_TABLE}"
    assert tuple(module._REPORT_COLUMNS) == _EXPECTED_DDL, (
        "the revision's column list drifted from what coord's ci_job_sampler "
        "writes; coord's write swallows 42703, so drift idles silently"
    )
    assert (
        tuple((name, _DDL_TO_INFORMATION_SCHEMA[ddl]) for name, ddl in _EXPECTED_DDL)
        == _EXPECTED
    ), "the DDL table and the catalogue table describe different columns"


def test_the_revision_comments_every_column_it_adds() -> None:
    for name, _ in _EXPECTED:
        body = _expected_comment(name)
        assert body, f"coord.{_TABLE}.{name} has no COMMENT ON COLUMN block"
        assert "NULL" in body and "UNKNOWN" in body, (
            f"coord.{_TABLE}.{name}'s comment does not say NULL is UNKNOWN"
        )


def test_peak_anon_mem_is_documented_as_anon_not_the_cgroup_charge() -> None:
    body = _expected_comment("peak_anon_mem_mb")
    assert "peak_rss_mb" in body and "memory.stat anon" in body
    assert "NOT system-wide" in body
    assert "page cache EXCLUDED" in body and "not ingested" in body


def test_mem_total_is_recommented_as_job_memory_not_host_ram() -> None:
    """The report's phys_mem_mb is memory available to the JOB (min of MemTotal
    and the tightest finite cgroup memory.high/max). ci_job_mem_01's COMMENT on
    the column it lands in says "Total system memory", so this revision must
    rewrite it rather than let coord's rows contradict the catalog."""
    body = _expected_comment("mem_total_mb")
    assert body, "the revision does not re-COMMENT mem_total_mb"
    assert "AVAILABLE TO THE JOB" in body
    assert "memory.high" in body and "memory.max" in body and "MemTotal" in body
    assert "NOT the host's RAM" in body
    assert "resource_source" in body and "phys_mem_mb" in body
    assert "NULL = UNKNOWN" in body
    assert "Total system memory" not in body
    assert body != _ci_job_mem_01_comment("mem_total_mb")


def test_downgrade_restores_ci_job_mem_01s_mem_total_comment_verbatim() -> None:
    module = load_revision_module(_revision_path(), "_ci_job_res_01_restore_under_test")
    prior = _ci_job_mem_01_comment("mem_total_mb")
    assert prior.startswith("Total system memory"), "ci_job_mem_01's comment moved"
    assert module._MEM_TOTAL_PRIOR_COMMENT == prior, (
        "downgrade() would restore a mem_total_mb COMMENT that is not ci_job_mem_01's"
    )


def test_peak_anon_mem_comment_names_the_saturation_reading() -> None:
    body = _expected_comment("peak_anon_mem_mb")
    assert "levels off at memory.high" in body and "saturated" in body


def test_oom_kills_comment_says_zero_is_a_real_reading() -> None:
    body = _expected_comment("cgroup_oom_kills")
    assert "0 IS A REAL READING" in body
    assert "Never coalesce NULL to 0" in body


# ---------------------------------------------------------------------------
# Live-schema walks.
# ---------------------------------------------------------------------------


def _columns(engine: Engine) -> dict[str, tuple[str, str, str | None]]:
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
    cols = _columns(engine)
    for name, expected_type in _EXPECTED:
        assert name in cols, f"coord.{_TABLE} is missing {name}"
        data_type, nullable, default = cols[name]
        assert data_type == expected_type, (
            f"coord.{_TABLE}.{name} is {data_type}, expected {expected_type}"
        )
        assert nullable == "YES", f"coord.{_TABLE}.{name} is NOT NULL"
        assert default is None, (
            f"coord.{_TABLE}.{name} carries DEFAULT {default}; a default "
            f"manufactures a reading the report omitted"
        )


def _assert_columns_commented(engine: Engine) -> None:
    for name in [n for n, _ in _EXPECTED] + ["mem_total_mb"]:
        actual = column_comment(engine, _TABLE, name)
        assert actual == _expected_comment(name), (
            f"coord.{_TABLE}.{name}'s COMMENT is not what the revision emits:\n"
            f"  db:       {actual!r}\n  revision: {_expected_comment(name)!r}"
        )


def _seed_job_row(engine: Engine, job_id: int) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.ci_job_observations
                    (repo, job_id, run_id, run_attempt, workflow_name,
                     job_name, self_hosted, outcome, duration_secs)
                VALUES ('qontinui/qontinui-runner', :j, 40449994591, 1, 'CI',
                        'test (windows-latest)', false, 'content_fail', 2400)
                """
            ),
            {"j": job_id},
        )


def _job_row(engine: Engine, job_id: int) -> tuple:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT repo, run_id, workflow_name, job_name, outcome,
                       duration_secs, mem_total_mb, resource_source
                  FROM coord.ci_job_observations WHERE job_id = :j
                """
            ),
            {"j": job_id},
        ).fetchone()
    assert row is not None, "the seeded observation row vanished"
    return tuple(row)


def _read_report_columns(engine: Engine, job_id: int) -> tuple:
    projection = ", ".join(name for name, _ in _EXPECTED)
    with engine.connect() as conn:
        row = conn.execute(
            text(
                f"SELECT {projection} FROM coord.ci_job_observations WHERE job_id = :j"
            ),
            {"j": job_id},
        ).fetchone()
    assert row is not None
    return tuple(row)


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def test_an_unreported_job_and_a_reported_one_round_trip(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "ci_job_res_01_rtp") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)

        # A row written the way the sampler writes a job with no report.
        _seed_job_row(engine, 1)
        assert _read_report_columns(engine, 1) == (None,) * len(_EXPECTED), (
            "a job with no resource report must read NULL on every report column"
        )

        # The motivating windows-latest job, as coord writes it from its
        # report: commit limit and peak present, Linux-only keys NULL.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.ci_job_observations
                        (repo, job_id, run_id, run_attempt, workflow_name,
                         job_name, self_hosted, outcome,
                         mem_total_mb, swap_total_mb, peak_swap_used_mb,
                         peak_commit_mb, commit_limit_mb, peak_anon_mem_mb,
                         cgroup_oom_kills, resource_os, build_outcome,
                         resource_source)
                    VALUES ('qontinui/qontinui-runner', 2, 40449994591, 1, 'CI',
                            'test (windows-latest)', false, 'content_fail',
                            :phys, 32768, :pf_peak,
                            :commit_limit, :commit_limit, NULL,
                            NULL, 'windows', 'failure', 'job_annotation')
                    """
                ),
                {
                    "phys": _WIN_PHYS_MB,
                    "pf_peak": _WIN_PAGEFILE_PEAK_MB,
                    "commit_limit": _WIN_COMMIT_LIMIT_MB,
                },
            )
        assert _read_report_columns(engine, 2) == (
            _WIN_COMMIT_LIMIT_MB,
            _WIN_COMMIT_LIMIT_MB,
            None,
            None,
            "windows",
            "failure",
        )

        # 0 OOM kills is a reading, distinct from NULL.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.ci_job_observations SET cgroup_oom_kills = 0 "
                    "WHERE job_id = 1"
                )
            )
        with engine.connect() as conn:
            got = conn.execute(
                text(
                    "SELECT cgroup_oom_kills, cgroup_oom_kills IS NULL, "
                    "peak_commit_mb IS NULL FROM coord.ci_job_observations "
                    "WHERE job_id = 1"
                )
            ).fetchone()
        assert got is not None
        assert tuple(got) == (0, False, True)

        # No CHECK on either TEXT column.
        with engine.connect() as conn:
            checks = conn.execute(
                text(
                    """
                    SELECT c.conname
                      FROM pg_constraint c
                      JOIN pg_attribute a
                        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                     WHERE c.conrelid = 'coord.ci_job_observations'::regclass
                       AND c.contype = 'c'
                       AND a.attname IN ('resource_os', 'build_outcome')
                    """
                )
            ).fetchall()
        assert checks == [], f"a CHECK governs a report label column: {checks}"


def test_up_down_up_removes_only_these_six(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "ci_job_res_01_ud") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_job_row(engine, 1)
        before = _job_row(engine, 1)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        cols = _columns(engine)
        for name, _ in _EXPECTED:
            assert name not in cols, f"coord.{_TABLE}.{name} survived downgrade()"
        for name in _PRIOR_COLUMNS:
            assert name in cols, f"downgrade() removed ci_job_mem_01's {name}"
        assert column_comment(engine, _TABLE, "mem_total_mb") == _ci_job_mem_01_comment(
            "mem_total_mb"
        ), "downgrade() did not restore ci_job_mem_01's mem_total_mb COMMENT"
        assert table_exists(engine, "coord", _TABLE)
        assert _job_row(engine, 1) == before

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)
        assert _job_row(engine, 1) == before
        assert _read_report_columns(engine, 1) == (None,) * len(_EXPECTED)


def test_upgrade_is_idempotent(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "ci_job_res_01_id") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)
