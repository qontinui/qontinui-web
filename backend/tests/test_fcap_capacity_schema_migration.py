"""Schema + round-trip tests for the ``fcap_01`` .. ``fcap_03`` revisions.

Phase 1 of plan
``2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware``:

* ``fcap_01`` — ``coord.device_resource_samples.workloads`` / ``gpu`` (JSONB,
  nullable, no DEFAULT, deliberately no CHECK — a CHECK would fail the whole
  best-effort sample INSERT).
* ``fcap_02`` — ``workload_census_enabled BOOLEAN NULL`` on
  ``coord.fleet_runtime_policy`` AND ``coord.fleet_runtime_policy_versions``
  (NULL = on; the snapshot table must never hold less than its parent).
* ``fcap_03`` — ``coord.capacity_advice_log`` (append-only advice ledger, no FK
  on ``tenant_id`` / ``computer_id``, CHECKed ``confidence`` / ``actor``,
  unconstrained ``kind``).

The consumer of every name here is coord, which reads over a 42703/42P01-
swallowing degrade path — so a typo idles forever with no error. The source
guards below never skip; the live walks skip without a reachable Postgres, and
a skip proves nothing (point them at one with ``QONTINUI_TEST_PG=host:port``,
not ``DATABASE_URL``, which ``conftest.py`` overwrites at import time).
"""

from __future__ import annotations

import ast
import json
import uuid
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    table_exists,
)

_FILES = {
    "fcap_01": "fcap_01_workload_census_and_gpu_on_resource_sample.py",
    "fcap_02": "fcap_02_workload_census_policy_control.py",
    "fcap_03": "fcap_03_capacity_advice_log.py",
}


def _path(rev: str) -> Path:
    return backend_root() / "alembic" / "versions" / _FILES[rev]


def _source(rev: str) -> str:
    return _path(rev).read_text(encoding="utf-8")


def _module(rev: str) -> ModuleType:
    return load_revision_module(_path(rev), f"_rev_{rev}")


# The chain's root is re-pointed onto whatever head exists at land time, so it
# is read from the revision itself rather than pinned here.
_BASE_PARENT = declared_parent_revision_id(_source("fcap_01"), _FILES["fcap_01"])

_SAMPLES = "device_resource_samples"
_POLICY = "fleet_runtime_policy"
_POLICY_VERSIONS = "fleet_runtime_policy_versions"
_ADVICE = "capacity_advice_log"
_ADVICE_INDEX = "ix_capacity_advice_log_tenant_emitted_at"

_SAMPLE_COLUMNS: tuple[tuple[str, str], ...] = (
    ("workloads", "JSONB"),
    ("gpu", "JSONB"),
)
_CENSUS_CONTROL: tuple[tuple[str, str], ...] = (("workload_census_enabled", "BOOLEAN"),)

_ADVICE_COLUMNS: tuple[tuple[str, str, str], ...] = (
    # (column, information_schema.data_type, is_nullable)
    ("id", "uuid", "NO"),
    ("tenant_id", "uuid", "NO"),
    ("emitted_at", "timestamp with time zone", "NO"),
    ("kind", "text", "NO"),
    ("target", "text", "NO"),
    ("computer_id", "uuid", "YES"),
    ("window_secs", "integer", "YES"),
    ("bottleneck", "jsonb", "YES"),
    ("evidence", "jsonb", "YES"),
    ("expected_effect", "jsonb", "YES"),
    ("confidence", "text", "NO"),
    ("actor", "text", "NO"),
    ("acted_on_at", "timestamp with time zone", "YES"),
    ("acted_by", "text", "YES"),
    ("realised_effect", "jsonb", "YES"),
    ("realised_at", "timestamp with time zone", "YES"),
)


# ---------------------------------------------------------------------------
# Source-level guards — no database needed, so they never skip.
# ---------------------------------------------------------------------------


def test_the_three_revisions_form_one_linear_chain() -> None:
    """fcap_01 <- fcap_02 <- fcap_03, and only fcap_01 points outside the family."""
    assert _module("fcap_01").revision == "fcap_01"
    assert _module("fcap_02").down_revision == "fcap_01"
    assert _module("fcap_03").down_revision == "fcap_02"
    assert not _BASE_PARENT.startswith("fcap_")


def test_the_column_lists_are_the_interface_coord_reads() -> None:
    """The data tuples ARE the coord interface; a rename idles forever."""
    m1 = _module("fcap_01")
    assert tuple(m1._CAPACITY_COLUMNS) == _SAMPLE_COLUMNS
    assert m1._TABLE == f"coord.{_SAMPLES}"
    m2 = _module("fcap_02")
    assert tuple(m2._CENSUS_CONTROL_COLUMNS) == _CENSUS_CONTROL
    assert tuple(m2._TABLES) == (f"coord.{_POLICY}", f"coord.{_POLICY_VERSIONS}")


@pytest.mark.parametrize("rev", sorted(_FILES))
def test_every_op_execute_takes_a_static_string_literal(rev: str) -> None:
    """coord's merge-train migration classifier rejects a dynamic op.execute."""
    tree = ast.parse(_source(rev))
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "execute"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls
    for call in calls:
        assert len(call.args) == 1 and not call.keywords
        arg = call.args[0]
        assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
            f"{rev}: op.execute at line {call.lineno} is not a static string literal"
        )


@pytest.mark.parametrize("rev", ["fcap_01", "fcap_02"])
def test_no_drop_column_outside_downgrade(rev: str) -> None:
    """DROP COLUMN text lives only in downgrade(), where the drop guard skips it."""
    tree = ast.parse(_source(rev))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "downgrade":
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # the module docstring is prose
        for n in ast.walk(node):
            if isinstance(n, ast.Constant) and isinstance(n.value, str):
                assert "DROP COLUMN" not in n.value.upper()


def _recorded_sql(monkeypatch: pytest.MonkeyPatch, rev: str, step: str) -> list[str]:
    module = _module(rev)
    executed: list[str] = []

    class _RecordingOp:
        @staticmethod
        def execute(sql: object) -> None:
            executed.append(str(sql))

    monkeypatch.setattr(module, "op", _RecordingOp)
    getattr(module, step)()
    return executed


def test_fcap_01_adds_and_drops_exactly_its_columns_with_no_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = _recorded_sql(monkeypatch, "fcap_01", "upgrade")
    up = "\n".join(statements)
    down = "\n".join(_recorded_sql(monkeypatch, "fcap_01", "downgrade"))
    adds = [s for s in statements if "ADD COLUMN" in s]
    assert len(adds) == 1, "one ALTER carries both columns"
    add = adds[0]
    assert f"ALTER TABLE coord.{_SAMPLES}" in add
    for name, ddl in _SAMPLE_COLUMNS:
        assert f"ADD COLUMN IF NOT EXISTS {name} {ddl}" in add
        assert f"DROP COLUMN IF EXISTS {name}" in down
    assert add.count("ADD COLUMN") == len(_SAMPLE_COLUMNS)
    assert down.count("DROP COLUMN") == len(_SAMPLE_COLUMNS)
    # A CHECK would fail the whole best-effort sample INSERT; a DEFAULT would
    # fabricate a measured value into every row an older runner sends.
    assert "CHECK" not in add.upper()
    assert "CONSTRAINT" not in up.upper()
    assert "DEFAULT" not in add.upper()
    assert statements[0] == "SET LOCAL lock_timeout = '3s'"
    assert "SET LOCAL lock_timeout = DEFAULT" in statements


def test_fcap_02_widens_both_tables_together(monkeypatch: pytest.MonkeyPatch) -> None:
    up = _recorded_sql(monkeypatch, "fcap_02", "upgrade")
    down = _recorded_sql(monkeypatch, "fcap_02", "downgrade")
    for table in (_POLICY, _POLICY_VERSIONS):
        assert any(
            f"ALTER TABLE coord.{table}\n" in s
            and "ADD COLUMN IF NOT EXISTS workload_census_enabled BOOLEAN" in s
            for s in up
        ), f"upgrade does not widen coord.{table}"
        assert any(
            f"ALTER TABLE coord.{table}\n" in s
            and "DROP COLUMN IF EXISTS workload_census_enabled" in s
            for s in down
        ), f"downgrade does not narrow coord.{table}"


def test_the_comments_state_what_null_means() -> None:
    src1 = _source("fcap_01")
    for name, _ in _SAMPLE_COLUMNS:
        body = comment_body_from_source(src1, f"coord.{_SAMPLES}.{name}")
        assert "NOT MEASURED / UNKNOWN" in body
        assert "[]" in body
        assert "16" in body
    workloads = comment_body_from_source(src1, f"coord.{_SAMPLES}.workloads")
    for cls in (
        "claude_session",
        "gh_actions_job",
        "gh_actions_runner_idle",
        "cargo_build",
        "qontinui_runner",
        "supervisor",
        "docker",
        "wsl_vm",
        "gpu_inference",
        "browser",
        "other",
    ):
        assert cls in workloads, f"class {cls} missing from the vocabulary comment"
    assert "argv, cwd and env NEVER leave the host" in workloads

    src2 = _source("fcap_02")
    parent = comment_body_from_source(src2, f"coord.{_POLICY}.workload_census_enabled")
    assert "NULL = no override, the census" in parent
    assert "RUNS" in parent


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres.
# ---------------------------------------------------------------------------


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def _assert_fcap_01_02_present(engine: Engine) -> None:
    for name, ddl in _SAMPLE_COLUMNS:
        info = column_info(engine, _SAMPLES, name)
        assert info == (ddl.lower(), "YES", None), f"{_SAMPLES}.{name}: {info}"
        assert column_comment(engine, _SAMPLES, name) == comment_body_from_source(
            _source("fcap_01"), f"coord.{_SAMPLES}.{name}"
        )
    for table in (_POLICY, _POLICY_VERSIONS):
        info = column_info(engine, table, "workload_census_enabled")
        assert info == ("boolean", "YES", None), f"{table}: {info}"
        assert column_comment(
            engine, table, "workload_census_enabled"
        ) == comment_body_from_source(
            _source("fcap_02"), f"coord.{table}.workload_census_enabled"
        )


def _assert_advice_log_present(engine: Engine) -> None:
    assert table_exists(engine, "coord", _ADVICE)
    for name, pg_type, nullable in _ADVICE_COLUMNS:
        info = column_info(engine, _ADVICE, name)
        assert info is not None, f"{_ADVICE}.{name} missing"
        assert (info[0], info[1]) == (pg_type, nullable), f"{_ADVICE}.{name}: {info}"
    assert index_exists(engine, _ADVICE_INDEX)
    with engine.connect() as conn:
        fks = conn.execute(
            text(
                """
                SELECT count(*) FROM pg_constraint
                 WHERE conrelid = 'coord.capacity_advice_log'::regclass
                   AND contype = 'f'
                """
            )
        ).scalar_one()
    assert fks == 0, (
        "an append-only log carries no FK (computer_id's waits on web#1598)"
    )


def test_full_chain_up_down_up_and_round_trips() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "fcap") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _BASE_PARENT)

        older_device = uuid.uuid4()
        tenant_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source)
                    VALUES (:d, 'host', now(), 'test')
                    """
                ),
                {"d": str(older_device)},
            )
            policy_id = conn.execute(
                text(
                    """
                    INSERT INTO coord.fleet_runtime_policy
                        (tenant_id, domain, scope_band, scope_key, level,
                         master_enabled, current_version, updated_by)
                    VALUES (:t, 'fleet_resources', 'tenant', NULL, 'controls',
                            true, 1, 'seed@example.com')
                    RETURNING id
                    """
                ),
                {"t": str(tenant_id)},
            ).scalar_one()
            conn.execute(
                text(
                    """
                    INSERT INTO coord.fleet_runtime_policy_versions
                        (policy_id, version, level, master_enabled,
                         change_note, updated_by)
                    VALUES (:p, 1, 'controls', true, 'seeded before fcap_02',
                            'seed@example.com')
                    """
                ),
                {"p": str(policy_id)},
            )

        run_alembic(backend_root(), db_url, "upgrade", "fcap_03")
        _assert_fcap_01_02_present(engine)
        _assert_advice_log_present(engine)

        census = [
            {
                "class": "cargo_build",
                "cpu_pct": 412.5,
                "rss_bytes": 9_000_000_000,
                "gpu_mem_bytes": None,
                "proc_count": 14,
            },
            {
                "class": "other",
                "cpu_pct": 3.0,
                "rss_bytes": 1,
                "gpu_mem_bytes": None,
                "proc_count": 2,
            },
        ]
        gpus = [
            {
                "index": 0,
                "util_pct": 1,
                "mem_used_bytes": 0,
                "power_w": 21.4,
                "temp_c": 38,
            }
        ]
        empty_device = uuid.uuid4()
        busy_device = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source, workloads, gpu)
                    VALUES
                        (:e, 'host', now(), 'test', '[]'::jsonb, '[]'::jsonb),
                        (:b, 'host', now(), 'test',
                         CAST(:w AS jsonb), CAST(:g AS jsonb))
                    """
                ),
                {
                    "e": str(empty_device),
                    "b": str(busy_device),
                    "w": json.dumps(census),
                    "g": json.dumps(gpus),
                },
            )
            rows = {
                str(r[0]): (r[1], r[2])
                for r in conn.execute(
                    text(
                        """
                        SELECT device_id, workloads, gpu
                          FROM coord.device_resource_samples
                         WHERE device_id IN (:o, :e, :b)
                        """
                    ),
                    {
                        "o": str(older_device),
                        "e": str(empty_device),
                        "b": str(busy_device),
                    },
                )
            }
            # A 17-entry census is NOT refused by the schema: the bound is
            # app-side, so a violating publisher never loses the whole row.
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source, workloads)
                    VALUES (:d, 'host', now(), 'test', CAST(:w AS jsonb))
                    """
                ),
                {"d": str(uuid.uuid4()), "w": json.dumps([census[1]] * 17)},
            )
            controls = conn.execute(
                text(
                    """
                    SELECT p.workload_census_enabled, v.workload_census_enabled
                      FROM coord.fleet_runtime_policy p
                      JOIN coord.fleet_runtime_policy_versions v
                        ON v.policy_id = p.id
                     WHERE p.id = :p
                    """
                ),
                {"p": str(policy_id)},
            ).one()

        assert rows[str(older_device)] == (None, None), (
            "a pre-census row must read NULL"
        )
        assert rows[str(empty_device)] == ([], []), (
            "[] must round-trip distinct from NULL"
        )
        assert rows[str(busy_device)] == (census, gpus)
        assert tuple(controls) == (None, None), (
            "pre-existing policy rows read NULL (= on)"
        )

        # The advice log: defaults, CHECKs, and an unconstrained kind.
        with engine.begin() as conn:
            advice = conn.execute(
                text(
                    """
                    INSERT INTO coord.capacity_advice_log
                        (tenant_id, kind, target, confidence, actor)
                    VALUES (:t, 'a_kind_coord_added_later', 'qontinui/qontinui-web',
                            'unknown', 'agent')
                    RETURNING id, emitted_at, computer_id, acted_on_at
                    """
                ),
                {"t": str(tenant_id)},
            ).one()
        assert advice.id is not None and advice.emitted_at is not None
        assert advice.computer_id is None and advice.acted_on_at is None

        for column, bad in (("confidence", "certain"), ("actor", "robot")):
            values = {"confidence": "high", "actor": "operator", column: bad}
            with pytest.raises(IntegrityError), engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.capacity_advice_log
                            (tenant_id, kind, target, confidence, actor)
                        VALUES (:t, 'acquire_host', 'fleet', :c, :a)
                        """
                    ),
                    {
                        "t": str(tenant_id),
                        "c": values["confidence"],
                        "a": values["actor"],
                    },
                )

        # Down to before the chain: everything goes, the sample row survives.
        run_alembic(backend_root(), db_url, "downgrade", _BASE_PARENT)
        assert not table_exists(engine, "coord", _ADVICE)
        assert not index_exists(engine, _ADVICE_INDEX)
        for name, _ in _SAMPLE_COLUMNS:
            assert column_info(engine, _SAMPLES, name) is None
        for table in (_POLICY, _POLICY_VERSIONS):
            assert column_info(engine, table, "workload_census_enabled") is None
        with engine.connect() as conn:
            survived = conn.execute(
                text(
                    "SELECT count(*) FROM coord.device_resource_samples "
                    "WHERE device_id = :d"
                ),
                {"d": str(older_device)},
            ).scalar_one()
        assert survived == 1, "downgrade destroyed a pre-existing sample row"

        run_alembic(backend_root(), db_url, "upgrade", "fcap_03")
        _assert_fcap_01_02_present(engine)
        _assert_advice_log_present(engine)


def test_upgrade_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Re-running each revision's own upgrade() SQL is a no-op, not an error."""
    statements = [
        sql
        for rev in ("fcap_01", "fcap_02", "fcap_03")
        for sql in _recorded_sql(monkeypatch, rev, "upgrade")
    ]
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "fcapi") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", "fcap_03")
        with engine.begin() as conn:
            for sql in statements:
                conn.execute(text(sql))
        _assert_fcap_01_02_present(engine)
        _assert_advice_log_present(engine)
