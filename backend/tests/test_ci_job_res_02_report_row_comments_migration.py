"""Schema + round-trip test for the ``ci_job_res_02`` revision.

``ci_job_res_01`` re-commented ``mem_total_mb`` so the catalog would not
contradict coord's report-sourced rows. This revision does the same for the
other ``ci_job_mem_01`` columns those rows fill or leave empty. The contract a
passing ``upgrade`` does not show:

1. **The catalog states what a report row holds**: each COMMENT names
   ``job_annotation`` and its report key, and the false claims are gone.
2. **0 is a real reading on a report row**, the opposite of ``ci_job_mem_01``'s
   "NEVER 0", which is what coord's parser accepts from the emitters.
3. **Downgrade restores ``ci_job_mem_01``'s text byte for byte**, checked against
   that revision's source, its one author.
4. **COMMENT-only**: the columns, their types and every row are untouched.

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
    upgrade_execute_calls,
)

_REVISION_ID = "ci_job_res_02"
_PARENT_REVISION_ID = "coord_agent_sessions_identity_01"
_REVISION_FILENAME = "ci_job_res_02_report_row_comments.py"

_TABLE = "ci_job_observations"

# column -> the report key it holds on a job_annotation row. resource_source has
# no key: it names the provenance itself.
_REPORT_KEYS: dict[str, str] = {
    "peak_swap_used_mb": "pagefile_peak_mb",
    "swap_total_mb": "pagefile_alloc_mb",
    "min_disk_avail_mb": "disk_free_min_mb",
}
# The sample-series columns: no report key, no writer, NULL on a report row.
_SERIES_COLUMNS: tuple[str, ...] = ("min_mem_avail_mb", "peak_mem_used_mb")
_COLUMNS: tuple[str, ...] = (*_REPORT_KEYS, *_SERIES_COLUMNS, "resource_source")

# Columns whose type this revision must leave alone, as information_schema
# spells them.
_EXPECTED_TYPES: dict[str, str] = {
    "peak_swap_used_mb": "integer",
    "swap_total_mb": "integer",
    "min_disk_avail_mb": "integer",
    "min_mem_avail_mb": "integer",
    "peak_mem_used_mb": "integer",
    "resource_source": "text",
}


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _expected_comment(column: str) -> str:
    return comment_body_from_source(_revision_source(), f"coord.{_TABLE}.{column}")


def _ci_job_mem_01_comment(column: str) -> str:
    """The COMMENT ``ci_job_mem_01`` gave ``column``, from its own source."""
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


def test_the_upgrade_runs_only_static_comment_statements() -> None:
    """Coord's manifest stays put only while this is COMMENT-only, and coord's
    migration classifier needs each statement as a static inline literal."""
    calls = upgrade_execute_calls(_revision_path())
    commented: list[str] = []
    for call in calls:
        assert call.sql is not None, "an op.execute argument is not a static literal"
        sql = call.sql.strip()
        if sql.startswith("SET LOCAL lock_timeout"):
            continue
        assert sql.startswith("COMMENT ON COLUMN coord.ci_job_observations."), sql[:80]
        commented.append(sql.split()[3].rsplit(".", 1)[1])
    assert tuple(commented) == _COLUMNS


def test_every_rewritten_comment_names_its_report_key() -> None:
    for column, key in _REPORT_KEYS.items():
        body = _expected_comment(column)
        assert "job_annotation" in body, f"{column} does not name job_annotation"
        assert key in body, f"{column} does not name its report key {key}"
        assert "resource_source" in body, f"{column} is not read with resource_source"
        assert "NULL = UNKNOWN" in body, f"{column} does not say NULL is UNKNOWN"
        assert body != _ci_job_mem_01_comment(column)


def test_zero_is_a_real_reading_on_a_report_row() -> None:
    """coord's parser keeps a 0 for these keys (only job memory and the commit
    limit reject it), so "NEVER 0" would make a consumer discard a real reading."""
    for column in _REPORT_KEYS:
        body = _expected_comment(column)
        assert "0 IS A REAL READING" in body, column
        assert "NEVER 0" not in body, column


def test_the_series_columns_say_nothing_fills_them() -> None:
    for column in _SERIES_COLUMNS:
        body = _expected_comment(column)
        assert "job_annotation" in body and "no row carries it yet" in body, column
        assert "NULL = UNKNOWN" in body, column
        assert body != _ci_job_mem_01_comment(column)
    assert "no denominator yet" not in _expected_comment("min_mem_avail_mb")
    peak = _expected_comment("peak_mem_used_mb")
    assert "no cgroup read" not in peak
    assert "SYSTEM-WIDE" in peak and "peak_anon_mem_mb" in peak


def test_swap_total_says_zero_is_a_linux_reading() -> None:
    """A Windows machine with no pagefile omits the key rather than reporting 0."""
    body = _expected_comment("swap_total_mb")
    assert "on Linux 0 IS A REAL READING" in body
    assert "no pagefile omits the key and reads NULL" in body


def test_resource_source_stops_claiming_nothing_writes_it() -> None:
    body = _expected_comment("resource_source")
    assert "job_annotation" in body and "ci_job_sampler" in body
    assert "NULL on every row" not in body
    assert "has not shipped" not in body
    # job_log's arm is still unbuilt, and a report row is not a sample series.
    assert "it is not built" in body
    for column in (
        "resource_sample_count",
        "resource_span_secs",
        "min_mem_avail_mb",
        "peak_mem_used_mb",
    ):
        assert column in body, f"resource_source does not say {column} stays NULL"


def test_min_disk_says_the_runner_report_is_one_reading() -> None:
    body = _expected_comment("min_disk_avail_mb")
    assert "ONE reading" in body and "workspace" in body
    assert "df -m /" in body  # the job_log arm, still named


def test_downgrade_restores_ci_job_mem_01s_text_verbatim() -> None:
    module = load_revision_module(_revision_path(), "_ci_job_res_02_under_test")
    assert module._TABLE == f"coord.{_TABLE}"
    assert tuple(module._PRIOR_COMMENTS) == _COLUMNS
    for column, prior in module._PRIOR_COMMENTS.items():
        assert prior == _ci_job_mem_01_comment(column), (
            f"downgrade() would restore a {column} COMMENT that is not ci_job_mem_01's"
        )


# ---------------------------------------------------------------------------
# Live-schema walks.
# ---------------------------------------------------------------------------


def _assert_comments_are_the_revisions(engine: Engine) -> None:
    for column in _COLUMNS:
        actual = column_comment(engine, _TABLE, column)
        assert actual == _expected_comment(column), (
            f"coord.{_TABLE}.{column}'s COMMENT is not what the revision emits:\n"
            f"  db:       {actual!r}\n  revision: {_expected_comment(column)!r}"
        )


def _column_types(engine: Engine) -> dict[str, str]:
    sql = text(
        """
        SELECT column_name, data_type
          FROM information_schema.columns
         WHERE table_schema = 'coord' AND table_name = :t
        """
    )
    with engine.connect() as conn:
        return {r[0]: r[1] for r in conn.execute(sql, {"t": _TABLE}).fetchall()}


def _seed_report_row(engine: Engine, job_id: int) -> None:
    """A row as coord writes it from a Linux report: full disk and no swap are 0."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.ci_job_observations
                    (repo, job_id, run_id, run_attempt, workflow_name, job_name,
                     self_hosted, outcome, swap_total_mb, peak_swap_used_mb,
                     min_disk_avail_mb, resource_source)
                VALUES ('qontinui/qontinui-coord', :j, 40449994591, 1, 'CI',
                        'rust-ci', false, 'content_fail',
                        0, 0, 0, 'job_annotation')
                """
            ),
            {"j": job_id},
        )


def _read_row(engine: Engine, job_id: int) -> tuple:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT swap_total_mb, peak_swap_used_mb, min_disk_avail_mb,
                       resource_source
                  FROM coord.ci_job_observations WHERE job_id = :j
                """
            ),
            {"j": job_id},
        ).fetchone()
    assert row is not None, "the seeded observation row vanished"
    return tuple(row)


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def test_up_down_up_moves_only_the_comments(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "ci_job_res_02_ud") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        for column in _COLUMNS:
            assert column_comment(engine, _TABLE, column) == _ci_job_mem_01_comment(
                column
            ), f"the parent's {column} COMMENT is not ci_job_mem_01's"
        types_before = _column_types(engine)
        _seed_report_row(engine, 1)
        row_before = _read_row(engine, 1)
        assert row_before == (0, 0, 0, "job_annotation")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_comments_are_the_revisions(engine)
        assert _column_types(engine) == types_before
        assert {c: _column_types(engine)[c] for c in _COLUMNS} == _EXPECTED_TYPES
        assert _read_row(engine, 1) == row_before

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for column in _COLUMNS:
            assert column_comment(engine, _TABLE, column) == _ci_job_mem_01_comment(
                column
            ), f"downgrade() did not restore ci_job_mem_01's {column} COMMENT"
        assert _column_types(engine) == types_before
        assert _read_row(engine, 1) == row_before

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_comments_are_the_revisions(engine)
        assert _read_row(engine, 1) == row_before
