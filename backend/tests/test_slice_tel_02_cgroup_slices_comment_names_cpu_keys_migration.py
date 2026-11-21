"""Schema + round-trip test for the ``slice_tel_02`` revision.

``slice_tel_01`` commented ``coord.device_resource_samples.cgroup_slices`` as a
map keyed by slice name. The runner's CPU half added a per-slice ``cpu`` object
and a top-level ``cpu_attribution`` key that is not a slice, and coord stores
the map verbatim. This revision re-comments the column. The contract a passing
``upgrade`` does not show:

1. **The catalog names what a row holds**: the per-slice ``cpu`` object, and
   ``cpu_attribution`` as the one top-level key that is NOT a slice.
2. **Slices are the ``.slice`` keys**, and a map naming none of them beside
   ``linux_cgroup_v2`` is a measurement. qontinui-web#2221 reads the column by
   that rule, and open qontinui-coord#4090 brings coord's grader to it.
3. **The unmeasured rule survives**: NULL is NOT MEASURED, never 0, and the
   NULL list names what actually writes one (not "a failed read", which on a
   unified host leaves the slice out of an object instead).
4. **Downgrade restores ``slice_tel_01``'s text byte for byte**, checked against
   that revision's source, its one author.
5. **COMMENT-only**: the column, its type and every row are untouched.

Substrate comes from ``_alembic_harness``. A skip proves nothing: set
``QONTINUI_TEST_PG_DSN`` (or ``QONTINUI_TEST_PG``) to a live pgvector instance;
``conftest`` overwrites ``DATABASE_URL`` from it.
"""

from __future__ import annotations

import json
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
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    upgrade_execute_calls,
)

_REVISION_ID = "slice_tel_02"
_PARENT_REVISION_ID = "coord_ci_runs_head_sha_idx_01"
_REVISION_FILENAME = "slice_tel_02_cgroup_slices_comment_names_cpu_keys.py"
_PRIOR_REVISION_FILENAME = "slice_tel_01_slice_memory_and_psi_on_resource_sample.py"

_TABLE = "device_resource_samples"
_COLUMNS: tuple[str, ...] = ("cgroup_slices",)
# The two columns slice_tel_01 commented that this revision leaves alone.
_UNTOUCHED: tuple[str, ...] = ("psi", "slice_source")


def _versions_dir() -> Path:
    return backend_root() / "alembic" / "versions"


def _revision_path() -> Path:
    return _versions_dir() / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _expected_comment(column: str) -> str:
    return comment_body_from_source(_revision_source(), f"coord.{_TABLE}.{column}")


def _slice_tel_01_comment(column: str) -> str:
    """The COMMENT ``slice_tel_01`` gave ``column``, from its own source."""
    source = (_versions_dir() / _PRIOR_REVISION_FILENAME).read_text(encoding="utf-8")
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
        assert sql.startswith(f"COMMENT ON COLUMN coord.{_TABLE}."), sql[:80]
        commented.append(sql.split()[3].rsplit(".", 1)[1])
    assert tuple(commented) == _COLUMNS


def test_the_comment_names_the_per_slice_cpu_object() -> None:
    body = _expected_comment("cgroup_slices")
    assert "cpu:{usage_delta_usec, interval_usec}" in body
    assert "microseconds summed over CPUs" in body
    # The first read after a start carries no CPU delta: absent, not 0. So
    # does a slice with no delta that read.
    assert "cpu is absent on the first read" in body
    assert "when the slice has no delta that read" in body
    assert body != _slice_tel_01_comment("cgroup_slices")


def test_the_comment_says_cpu_attribution_is_not_a_slice() -> None:
    body = _expected_comment("cgroup_slices")
    assert "ONE top-level key is NOT a slice: cpu_attribution" in body
    for key in ("session_usec", "ci_usec", "unattributed_usec", "host_usec"):
        assert key in body, f"cpu_attribution's {key} is not named"
    assert "slice_telemetry/cpu.rs" in body, "the full key set's author is not named"
    # The claim that made coord grade cpu_attribution as a slice is gone.
    assert "keyed by slice name" not in body


def test_slices_are_the_dot_slice_keys_and_none_is_a_measurement() -> None:
    body = _expected_comment("cgroup_slices")
    assert "takes only the keys ending in .slice" in body
    assert "empty, or holding only cpu_attribution" in body
    assert "linux_cgroup_v2 is a MEASUREMENT" in body
    # The runner omits a slice whose memory files are unreadable, so an empty
    # map does not prove no watched slice exists.
    assert "none of its memory files was readable" in body
    assert "no watched slice yielded a memory reading" in body


def test_the_unmeasured_rule_survives_the_rewrite() -> None:
    body = _expected_comment("cgroup_slices")
    assert "NULL = NOT MEASURED" in body
    assert "NEVER 0" in body
    assert "never an empty map standing in for unmeasured" in body
    assert '"max"' in body


def test_the_null_list_names_what_writes_a_null() -> None:
    """On a unified host the runner always sends an object, so a failed read
    is not a NULL source; a non-host lane and coord's sanitizer are."""
    body = _expected_comment("cgroup_slices")
    assert "a non-host lane row" in body
    assert "a value coord rejected (not an object, or over its size" in body
    # A host-lane row from a publisher that never sends the field (the
    # supervisor) is NULL from a current build, not only from an old one.
    assert "a row from a publisher that does not send the field" in body
    assert "slice_source not_supported" in body
    assert "a failed read" not in body
    assert "a failed read" in _slice_tel_01_comment("cgroup_slices")


def test_the_comment_names_the_s11_axis() -> None:
    body = _expected_comment("cgroup_slices")
    assert "s11 axis of device_resource_headroom_breach" in body
    assert "resource_headroom_slice" in body
    assert "s10" not in body


def test_downgrade_restores_slice_tel_01s_text_verbatim() -> None:
    module = load_revision_module(_revision_path(), "_slice_tel_02_under_test")
    assert module._TABLE == f"coord.{_TABLE}"
    assert tuple(module._PRIOR_COMMENTS) == _COLUMNS
    for column, prior in module._PRIOR_COMMENTS.items():
        assert prior == _slice_tel_01_comment(column), (
            f"downgrade() would restore a {column} COMMENT that is not slice_tel_01's"
        )


# ---------------------------------------------------------------------------
# Live-schema walk.
# ---------------------------------------------------------------------------


# A row as the runner publishes it from the second sample on: two watched
# slices with memory and cpu, plus the non-slice cpu_attribution.
_SEEDED_SLICES: dict = {
    "ci-runners.slice": {
        "memory_current": 1_073_741_824,
        "memory_high": "max",
        "memory_max": "max",
        "events": {"high": 0, "max": 0, "oom_kill": 0},
        "cpu": {"usage_delta_usec": 20_000_000, "interval_usec": 30_000_000},
    },
    "agent-builds.slice": {
        "memory_current": 0,
        "memory_high": 8_589_934_592,
        "memory_max": "max",
        "events": {"high": 3, "max": 0, "oom_kill": 0},
        "cpu": {"usage_delta_usec": 0, "interval_usec": 30_000_000},
    },
    "cpu_attribution": {
        "interval_usec": 30_000_000,
        "host_usec": 60_000_000,
        "session_usec": 25_000_000,
        "ci_usec": 20_000_000,
        "unattributed_usec": 15_000_000,
    },
}


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


def _seed_sample(engine: Engine) -> str:
    device_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.device_resource_samples
                    (device_id, lane, sampled_at, source,
                     cgroup_slices, psi, slice_source)
                VALUES (:d, 'host', now(), 'test',
                        CAST(:s AS jsonb), NULL, 'linux_cgroup_v2')
                """
            ),
            {"d": device_id, "s": json.dumps(_SEEDED_SLICES)},
        )
    return device_id


def _read_sample(engine: Engine, device_id: str) -> tuple:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT cgroup_slices, psi, slice_source
                  FROM coord.device_resource_samples
                 WHERE device_id = :d
                """
            ),
            {"d": device_id},
        ).fetchone()
    assert row is not None, "the seeded sample vanished"
    return tuple(row)


def _assert_comments(engine: Engine, *, revision: bool) -> None:
    for column in _COLUMNS:
        actual = column_comment(engine, _TABLE, column)
        expected = (
            _expected_comment(column) if revision else _slice_tel_01_comment(column)
        )
        assert actual == expected, (
            f"coord.{_TABLE}.{column}'s COMMENT is not "
            f"{'this revision' if revision else 'slice_tel_01'}'s:\n"
            f"  db:       {actual!r}\n  expected: {expected!r}"
        )
    for column in _UNTOUCHED:
        assert column_comment(engine, _TABLE, column) == _slice_tel_01_comment(
            column
        ), f"{column}'s COMMENT moved; this revision does not own it"


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def test_up_down_up_moves_only_the_comment(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "slice_tel_02_ud") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_comments(engine, revision=False)
        types_before = _column_types(engine)
        device_id = _seed_sample(engine)
        row_before = _read_sample(engine, device_id)
        assert row_before == (_SEEDED_SLICES, None, "linux_cgroup_v2")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_comments(engine, revision=True)
        assert _column_types(engine) == types_before
        assert _column_types(engine)["cgroup_slices"] == "jsonb"
        assert _read_sample(engine, device_id) == row_before

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_comments(engine, revision=False)
        assert _column_types(engine) == types_before
        assert _read_sample(engine, device_id) == row_before

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_comments(engine, revision=True)
        assert _read_sample(engine, device_id) == row_before
