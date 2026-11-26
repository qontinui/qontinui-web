"""Schema + round-trip test for the ``kernel_census_01`` revision.

Phase 1 of plan
``2026-11-26-devops-windows-process-object-leak-has-no-holder-attribution``
adds six nullable columns to ``coord.device_resource_samples`` -- the runner's
per-process census (a jsonb object and its read time) and four per-type kernel
counts -- and touches no other table. The contract around that ALTER:

1. **Every column NAME and TYPE is an interface.** coord reads ``BIGINT`` as
   ``Option<i64>``, and ``IF NOT EXISTS`` is type-blind, so a wrong type is
   never repaired by re-running the revision.
2. **Nullable with no DEFAULT.** A NULL sample is "never read / read failed /
   not applicable"; a default of 0 or ``[]`` would fabricate a reading (0
   Process handles reads as "every dead process is reference-pinned").
3. **Only ``coord.device_resource_samples``.** The image-name off-switch rides
   the egress-flow family, so no policy table is widened.
4. **Every ``op.execute`` is one static literal** (coord's migration
   classifier reads nothing else), and DROPs live only in ``downgrade()``.
5. **Up -> down -> up leaves no residue and keeps pre-existing rows.**
6. **The chain has exactly one head, and this revision is on it.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing: point it
at a live instance with ``QONTINUI_TEST_PG=host:port`` or
``QONTINUI_TEST_PG_DSN``.
"""

from __future__ import annotations

import ast
import json
import re
import sys
import uuid
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    alter_statement,
    backend_root,
    backfill_statements,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    forbidden_add_clauses,
    load_revision_module,
    recorded_sql,
    run_alembic,
    table_exists,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. `_PARENT_REVISION_ID` MUST
# equal the revision's own `down_revision` — the first test below enforces
# it. If the alembic head moves before landing, re-point BOTH together.
_REVISION_ID = "kernel_census_01"
_PARENT_REVISION_ID = "overview_07_schedule_last_known"
_LOCK_BOUND = "SET LOCAL lock_timeout = '3s'"
_REVISION_FILENAME = "kernel_census_01_process_census_on_resource_sample.py"
_PLAN_STEM = "2026-11-26-devops-windows-process-object-leak-has-no-holder-attribution"
_FINDING_ID = "da391a7e-4a35-4a6d-a1e5-b9ee6263d744"

_SCHEMA = "coord"
_SAMPLE_TABLE = "device_resource_samples"

# (column, DDL type) — spelled as the revision's own DDL spells them. Pinned
# to the revision's `_CENSUS_COLUMNS`.
_EXPECTED_SAMPLE_DDL: tuple[tuple[str, str], ...] = (
    ("kernel_process_census", "JSONB"),
    ("kernel_process_census_at", "TIMESTAMPTZ"),
    ("kernel_process_handles", "BIGINT"),
    ("kernel_thread_objects", "BIGINT"),
    ("kernel_thread_handles", "BIGINT"),
    ("os_thread_count", "BIGINT"),
)

# PostgreSQL's own `information_schema.columns.data_type` spelling of each
# DDL type. Kept separate so the live assertion does not derive its
# expectation from the thing under test.
_PG_TYPE = {
    "BIGINT": "bigint",
    "TIMESTAMPTZ": "timestamp with time zone",
    "JSONB": "jsonb",
}

# Tables this revision must NOT touch: the policy pair kernel_gauges_01
# widened. The D7 off-switch rides the egress-flow family instead.
_UNTOUCHED_TABLES: tuple[str, ...] = (
    "fleet_runtime_policy",
    "fleet_runtime_policy_versions",
)

# The round-trip fixtures: the plan D2/R3 census shape with ILLUSTRATIVE
# numbers (not any device's), internally consistent — no entry claims more
# handles, processes or threads than `totals` — which
# `test_the_round_trip_fixture_is_internally_consistent` pins.
_MEASURED_CENSUS: dict[str, Any] = {
    "status": "measured",
    "top_by_handles": [
        {
            "image": "bash.exe",
            "pid": 4120,
            "parent_pid": 3100,
            "handle_count": 52_000,
            "thread_count": 3,
            "started_at": "2026-11-26T11:52:03Z",
        },
        {
            "image": None,
            "image_withheld": "persisted",
            "pid": 812,
            "parent_pid": 4,
            "handle_count": 12_000,
            "thread_count": 40,
            "started_at": "2026-11-20T08:00:00Z",
        },
    ],
    "top_images": [
        {
            "image": "bash.exe",
            "processes": 120,
            "handle_count": 61_000,
            "thread_count": 360,
        }
    ],
    "dead_images": {
        "status": "measured",
        "reason": None,
        "sampled": 256,
        "hits": 31,
        "range_max": 1_048_576,
        "top": [
            {"image": "cmd.exe", "hits": 22},
            {"image": None, "image_withheld": "unknown", "hits": 9},
        ],
    },
    "totals": {"processes": 400, "handle_count": 180_000, "thread_count": 5_200},
    "top_by_handles_share": 0.356,
}

_UNMEASURED_CENSUS: dict[str, Any] = {
    "status": "unmeasured",
    "reason": "buffer_cap_exceeded",
    "required_bytes": 351_000_000,
}


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_rev_{_REVISION_ID}")


def _expected_comment(column: str) -> str:
    """The comment body the REVISION emits, read out of its own source."""
    return comment_body_from_source(
        _revision_source(), f"{_SCHEMA}.{_SAMPLE_TABLE}.{column}"
    )


# ---------------------------------------------------------------------------
# Source-level guards — no database needed, so they never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """The walk target below is only correct while this equality holds."""
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "the revision was re-pointed onto a new chain head and "
        "`_PARENT_REVISION_ID` was not updated with it"
    )
    # The head gate's own parser must read the same single parent.
    assert (
        declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
        == _PARENT_REVISION_ID
    )
    assert module.branch_labels is None
    assert module.depends_on is None
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def _script_directory(monkeypatch: pytest.MonkeyPatch) -> ScriptDirectory:
    """alembic's view of the chain, built without leaking into ``sys.path``.

    ``ScriptDirectory.from_config`` prepends ``alembic.ini``'s
    ``prepend_sys_path`` to the PROCESS-GLOBAL ``sys.path``, and the revision
    map it loads later reads revision files through it. So the whole test runs
    on a copy of ``sys.path`` that ``monkeypatch`` swaps back at teardown, and
    nothing this test adds outlives it.
    """
    monkeypatch.setattr(sys, "path", list(sys.path))
    config = Config(str(backend_root() / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root() / "alembic"))
    return ScriptDirectory.from_config(config)


def test_the_chain_has_one_head_and_this_revision_is_on_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One head, and walking down from it reaches this revision and its parent.

    Asserting the head IS this revision would break the day a later revision
    lands on top; asserting it is an ANCESTOR of the one head stays true and
    still catches a fork (two heads) or an orphaned revision (not reachable).
    """
    script = _script_directory(monkeypatch)
    heads = script.get_heads()
    assert len(heads) == 1, f"alembic has {len(heads)} heads: {sorted(heads)}"
    walked = [rev.revision for rev in script.walk_revisions("base", heads[0])]
    assert _REVISION_ID in walked, (
        f"{_REVISION_ID} is not an ancestor of the single head {heads[0]}"
    )
    revision = script.get_revision(_REVISION_ID)
    assert revision is not None
    assert revision.down_revision == _PARENT_REVISION_ID


# Every entry of coord's `DEFAULT_SECURITY_GLOBS` (qontinui-coord
# `pr_merge/expedite/predicate/security.rs`), as each matches a basename:
# `**/jwt*`, `**/auth*` and `**/credential*` a PREFIX, `**/*token*` a
# substring anywhere, and `**/agent_tool_access.rs` one exact name.
_SECURITY_BASENAME_PREFIXES: tuple[str, ...] = ("jwt", "auth", "credential")
_SECURITY_BASENAME_SUBSTRINGS: tuple[str, ...] = ("token",)
_SECURITY_BASENAMES: tuple[str, ...] = ("agent_tool_access.rs",)


def test_no_file_of_this_change_is_named_after_a_security_surface_glob() -> None:
    """coord's security-surface globs match file basenames, and a match holds
    the PR for a security review this schema-only change does not need."""
    for name in (_REVISION_FILENAME, Path(__file__).name):
        lowered = name.lower()
        for prefix in _SECURITY_BASENAME_PREFIXES:
            assert not lowered.startswith(prefix), (name, f"**/{prefix}*")
        for fragment in _SECURITY_BASENAME_SUBSTRINGS:
            assert fragment not in lowered, (name, f"**/*{fragment}*")
        assert lowered not in _SECURITY_BASENAMES, name


def test_the_revision_names_the_columns_coord_reads_from_its_list() -> None:
    """The static SQL is checked against this list, so it IS the interface."""
    module = _revision_module()
    assert tuple(module._CENSUS_COLUMNS) == _EXPECTED_SAMPLE_DDL, (
        "the revision's column list changed; coord names these columns in its "
        "INSERT and reads, so a rename or retype breaks the push"
    )
    assert module._SAMPLE_TABLE == f"{_SCHEMA}.{_SAMPLE_TABLE}"


def test_every_ddl_type_has_a_postgres_spelling_and_names_are_unique() -> None:
    """`_PG_TYPE` covers every DDL type, and no column is listed twice.

    This reads only THIS test's own constants: it guards the test data that
    the live-schema walks below derive their expectations from, not the
    revision. The revision's own list is pinned by
    `test_the_revision_names_the_columns_coord_reads_from_its_list`.
    """
    names = [name for name, _ in _EXPECTED_SAMPLE_DDL]
    assert len(names) == len(set(names)), "a column is listed twice"
    for name, ddl_type in _EXPECTED_SAMPLE_DDL:
        assert ddl_type in _PG_TYPE, f"{name}: unmapped {ddl_type}"


def _ancestor_revision_paths(script: ScriptDirectory) -> list[Path]:
    """The file of every revision from base up to and including the parent.

    Walked through alembic's own graph rather than globbed, so a LATER
    revision (the ``ALTER COLUMN ... TYPE`` repair the revision's docstring
    prescribes, say) is out of scope by construction.
    """
    return [
        Path(rev.path) for rev in script.walk_revisions("base", _PARENT_REVISION_ID)
    ]


def _adds_column(source: str, name: str) -> bool:
    """True when ``source`` ADDS a column called ``name``, in either spelling a
    revision here uses: raw SQL ``ADD COLUMN [IF NOT EXISTS] <name>``, or
    ``sa.Column("<name>"`` (``op.add_column`` / ``op.create_table``). A bare
    mention — a comment, a docstring, a read — is not an add."""
    escaped = re.escape(name)
    sql = rf"\bADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?{escaped}\b"
    orm = rf"\bColumn\(\s*['\"]{escaped}['\"]"
    return bool(re.search(sql, source, re.I) or re.search(orm, source))


def test_no_ancestor_revision_adds_these_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``ADD COLUMN IF NOT EXISTS`` matches on name alone, so a column an
    ANCESTOR revision already added would make this ADD a silent no-op that
    keeps the earlier column's type. Every name must be new at this point in
    the chain. Only ancestors are read: a later revision naming these columns
    is expected.
    """
    script = _script_directory(monkeypatch)
    ancestors = _ancestor_revision_paths(script)
    resolved = {path.resolve() for path in ancestors}
    assert _revision_path().resolve() not in resolved, "the walk reached this revision"
    parent = script.get_revision(_PARENT_REVISION_ID)
    assert parent is not None, f"{_PARENT_REVISION_ID} is not in the chain"
    assert Path(parent.path).resolve() in resolved, (
        "the walk did not include the parent revision's own file"
    )
    gauges = script.get_revision("kernel_gauges_01")
    assert gauges is not None
    assert Path(gauges.path).resolve() in resolved, (
        "the walk missed kernel_gauges_01, so it is not reading the ancestry"
    )
    for path in ancestors:
        source = path.read_text(encoding="utf-8")
        for name, _ in _EXPECTED_SAMPLE_DDL:
            assert not _adds_column(source, name), (
                f"ancestor {path.name} already adds {name}"
            )


def test_the_add_column_matcher_reads_both_spellings() -> None:
    """The ancestor scan is only as good as ``_adds_column``: it must see both
    ADD spellings and must not fire on a bare mention."""
    name = "kernel_process_handles"
    assert _adds_column(f"ADD COLUMN IF NOT EXISTS {name} BIGINT", name)
    assert _adds_column(f"add column {name} bigint", name)
    assert _adds_column(
        f'op.add_column("t", sa.Column("{name}", sa.BigInteger()))', name
    )
    assert not _adds_column(f"# {name} is read by coord", name)
    assert not _adds_column(f"ADD COLUMN IF NOT EXISTS {name}_v2 BIGINT", name)


def _recorded_sql(monkeypatch: pytest.MonkeyPatch, step: str) -> list[str]:
    return recorded_sql(_revision_module(), step, monkeypatch)


def _alter_statement(statements: list[str], verb: str) -> str:
    return alter_statement(statements, _SCHEMA, _SAMPLE_TABLE, verb)


def test_upgrade_adds_exactly_the_listed_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One ADD carrying exactly the list — no more, no fewer, same order."""
    statements = _recorded_sql(monkeypatch, "upgrade")
    add = _alter_statement(statements, "ADD")
    added = re.findall(r"ADD COLUMN IF NOT EXISTS (\w+) (\w+)", add)
    assert tuple(added) == _EXPECTED_SAMPLE_DDL, (
        f"{_SCHEMA}.{_SAMPLE_TABLE}: the static ADD names {added}, the list "
        f"says {list(_EXPECTED_SAMPLE_DDL)}"
    )
    assert add.count("ADD COLUMN") == len(_EXPECTED_SAMPLE_DDL)


def test_downgrade_drops_exactly_the_listed_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Downgrade is the exact reverse: the lock bound, then ONE DROP over the list."""
    statements = _recorded_sql(monkeypatch, "downgrade")
    assert statements[0] == _LOCK_BOUND, statements
    assert len(statements) == 2, statements
    drop = _alter_statement(statements, "DROP")
    dropped = re.findall(r"DROP COLUMN IF EXISTS (\w+)", drop)
    assert tuple(dropped) == tuple(name for name, _ in _EXPECTED_SAMPLE_DDL), (
        f"{_SCHEMA}.{_SAMPLE_TABLE}: the static DROP names {dropped}"
    )
    assert drop.count("DROP COLUMN") == len(_EXPECTED_SAMPLE_DDL)


def test_both_directions_open_with_the_lock_bound(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A queued ACCESS EXCLUSIVE request blocks every reader behind it, so the
    wait is bounded before the first ALTER in each direction."""
    for direction in ("upgrade", "downgrade"):
        statements = _recorded_sql(monkeypatch, direction)
        assert statements[0] == _LOCK_BOUND, (direction, statements[0])
        assert sum(1 for sql in statements if "lock_timeout" in sql) == 1


def test_neither_direction_touches_any_other_table(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No policy-table column (D7 rides the egress family): after the lock
    bound, every statement is an ALTER of, or a COMMENT ON a column of,
    ``coord.device_resource_samples`` — schema-qualified — and names no other
    coord table. An unqualified ``ALTER TABLE device_resource_samples`` or a
    ``COMMENT ON COLUMN`` of another table fails here, not only a
    coord-qualified one."""
    qualified = re.escape(f"{_SCHEMA}.{_SAMPLE_TABLE}")
    alter_head = re.compile(rf"\s*ALTER TABLE {qualified}\s")
    comment_head = re.compile(rf"\s*COMMENT ON COLUMN {qualified}\.\w+ IS\s")
    for direction in ("upgrade", "downgrade"):
        statements = _recorded_sql(monkeypatch, direction)
        assert statements[0] == _LOCK_BOUND, (direction, statements[0])
        for sql in statements[1:]:
            assert alter_head.match(sql) or comment_head.match(sql), (
                f"{direction}: a statement targets something other than "
                f"{_SCHEMA}.{_SAMPLE_TABLE}: {sql.strip()[:120]!r}"
            )
            for table in _UNTOUCHED_TABLES:
                assert table not in sql, (direction, table, sql)
            named = set(re.findall(rf"\b{_SCHEMA}\.(\w+)", sql))
            assert named <= {_SAMPLE_TABLE}, (direction, named, sql)


def test_upgrade_never_drops_defaults_or_constrains(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Nullable, no DEFAULT / CHECK / constraint, no DROP, and no backfill.

    The clause scan reads the WHOLE ADD statement, whitespace-collapsed
    (``_alembic_harness.forbidden_add_clauses``).
    """
    statements = _recorded_sql(monkeypatch, "upgrade")
    assert not re.search(r"\bDROP\b", "\n".join(statements))
    add = _alter_statement(statements, "ADD")
    found = forbidden_add_clauses(add)
    assert not found, (
        f"{_SCHEMA}.{_SAMPLE_TABLE}: the ADD carries {found}; NULL is "
        "load-bearing here and the census shape is validated app-side"
    )
    assert not backfill_statements(statements), (
        "the revision backfills; rows written before it must keep NULL"
    )
    # Pin the shape: the lock bound, the one ALTER, then only COMMENTs — so a
    # second ALTER the finder's anchor does not match (``ALTER TABLE ONLY``,
    # another table, a ``SET DEFAULT``) cannot slip past the clause scan.
    others = [sql for sql in statements if sql is not add]
    assert others[0] == _LOCK_BOUND, others
    assert all(sql.lstrip().startswith("COMMENT ON COLUMN") for sql in others[1:]), (
        others
    )


def test_every_column_comment_states_its_null_contract() -> None:
    """NULL = never read / failed / not applicable per kernel_source."""
    for name, _ in _EXPECTED_SAMPLE_DDL:
        body = _expected_comment(name)
        assert "NULL =" in body, f"{name}'s comment must state what NULL means"
        assert "kernel_source" in body, (
            f"{name}'s comment must say kernel_source tells not-applicable from failed"
        )


def test_the_census_comment_states_its_shape_and_what_never_leaves() -> None:
    """The jsonb comment is the only on-database description of the shape."""
    body = _expected_comment("kernel_process_census")
    for key in (
        "status: measured",
        "status: unmeasured",
        "required_bytes",
        "top_by_handles",
        "top_images",
        "dead_images",
        "never extrapolated",
        "totals",
        "top_by_handles_share",
        "{image, pid, parent_pid, handle_count, thread_count, started_at}",
        "each {image, processes, handle_count, thread_count}",
        "totals is {processes, handle_count, thread_count}",
        "image_withheld?",
        "(coord, persisted, profile, product_default or unknown)",
        "Per plan D4 the runner will",
        "per plan D7",
        "Per plan D3",
        "egress_process_names",
        "NtQuerySystemInformation(SystemProcessInformation)",
        "SystemProcessIdInformation (class 88), only if Phase 0 keeps plan R3",
        "dead_images (plan R3; absent if Phase 0 drops R3)",
        "{status, reason, sampled, hits, range_max, top: [{image, ",
        "top at most 8 entries of raw hits only",
        "never a path, command line, user or SID",
        "never an empty array or 0",
        _PLAN_STEM,
    ):
        assert key in body, f"the census comment no longer states {key!r}"


def test_the_process_bound_subtracts_both_handle_types() -> None:
    """A thread object references its owning process (plan R2), so an open
    Thread handle can pin a dead process with no Process handle: the bound
    needs BOTH counts, the thread-handle comment must say it is half of it, and
    both must say the bound is evidence, not proof, and why."""
    bound = "dead - kernel_process_handles - kernel_thread_handles"
    attribution = "a thread object references its owning process"
    process_body = _expected_comment("kernel_process_handles")
    assert bound in process_body
    assert "tighter lower bound" in process_body
    assert "coord will compute (plan R2)" in process_body
    assert attribution in process_body
    assert "Phase 0 probe (d) is to measure it" in process_body
    assert "a debug object or an ALPC port could also pin one" in process_body
    assert "assumes one handle pins at most one dead process" in process_body
    assert "evidence, not proof (plan R1/R2)" in process_body
    thread_body = _expected_comment("kernel_thread_handles")
    assert bound in thread_body
    assert "half of the dead-process bound" in thread_body
    assert attribution in thread_body.lower()
    assert "(plan R2; Phase 0 probe (d) is to measure it)" in thread_body
    assert "evidence, not proof (plan R1/R2)" in thread_body


# A sentence that names an actor whose code does not exist yet...
_FUTURE_ACTOR = re.compile(r"\b(coord|the runner)\b", re.I)
# ...must carry one of these, so it reads as the plan's, not as present fact.
_ATTRIBUTION_MARKERS: tuple[str, ...] = ("plan", " will ", " is to ")


def test_comments_attribute_future_behaviour_to_the_plan() -> None:
    """Nothing in the runner or coord reads or writes these columns yet, so a
    durable COMMENT may not state their behaviour as present fact (the
    ``kernel_gauges_01`` rule). Every sentence of every column comment that
    names ``coord`` or ``the runner`` must also say ``plan``, `` will `` or
    `` is to ``."""
    checked = 0
    for name, _ in _EXPECTED_SAMPLE_DDL:
        for sentence in _expected_comment(name).split(". "):
            if not _FUTURE_ACTOR.search(sentence):
                continue
            checked += 1
            assert any(marker in sentence for marker in _ATTRIBUTION_MARKERS), (
                f"{name}: a sentence states coord or runner behaviour as present "
                f"fact, with no plan attribution: {sentence!r}"
            )
    # Non-vacuity: the comments do describe the runner and coord, so a guard
    # that checked nothing would mean the split or the actor match broke.
    assert checked >= 4, f"only {checked} actor sentences were found"


def test_upgrade_comments_exactly_the_added_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No COMMENT names a column the list does not, and none is missing."""
    commented = [
        (match.group(1), match.group(2))
        for sql in _recorded_sql(monkeypatch, "upgrade")
        for match in [
            re.match(rf"\s*COMMENT ON COLUMN {_SCHEMA}\.(\w+)\.(\w+) IS\s", sql)
        ]
        if match
    ]
    expected = [(_SAMPLE_TABLE, name) for name, _ in _EXPECTED_SAMPLE_DDL]
    assert sorted(commented) == sorted(expected)
    assert len(commented) == len(set(commented)), "a column is commented twice"


def test_every_op_execute_takes_a_static_string_literal() -> None:
    """coord's migration classifier cannot read a dynamic ``op.execute`` argument.

    ``qontinui-coord`` ``pr_merge/migration_classifier.rs`` (``classify_op``,
    the ``"execute"`` arm) rejects an ``op.execute`` whose argument carries no
    string literal: "op.execute with no static SQL string literal (dynamic =
    unsafe)". An f-string or a helper call here would hold the PR on the
    merge train.
    """
    tree = ast.parse(_revision_source())
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "execute"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "the revision makes no op.execute calls at all"
    for call in calls:
        assert len(call.args) == 1 and not call.keywords
        arg = call.args[0]
        assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
            f"op.execute at line {call.lineno} is not a static string literal"
        )


def test_no_drop_column_text_outside_downgrade() -> None:
    """No DROP COLUMN text outside downgrade(), where the drop guard reads it."""
    tree = ast.parse(_revision_source())
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "downgrade":
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # the module docstring is prose
        for literal in (
            n.value
            for n in ast.walk(node)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
        ):
            assert "DROP COLUMN" not in literal.upper(), (
                "a DROP COLUMN template appeared OUTSIDE downgrade()"
            )


def test_the_docstring_states_why_deploy_ordering_and_retention() -> None:
    module = _revision_module()
    doc = module.__doc__ or ""
    assert _PLAN_STEM in doc
    assert "Phase 1" in doc
    assert _FINDING_ID in doc
    assert "2026-11-26T20:20Z" in doc
    for measured in ("**482,303**", "**667**", "**241,089**", "240,547"):
        assert measured in doc, f"the motivating measurement {measured} is gone"
    assert "dead - kernel_process_handles - kernel_thread_handles" in doc
    assert "TIGHTER lower bound" in doc
    assert "evidence, not proof" in doc
    assert "assuming one handle pins at most one process" in doc
    flat = " ".join(doc.split())  # prose pins survive a re-wrap
    assert "(plan R2; Phase 0 probe (d) is to measure it)" in flat
    assert "coord will" in doc, "future coord behaviour is attributed to the plan"
    assert "a NEW kernel-style readiness group for the four scalars" in flat
    assert "not the existing ``kernel`` group" in flat, (
        "the scalars' readiness group must be named as a NEW group"
    )
    for glob in ("**/jwt*", "**/auth*", "**/*token*", "**/credential*"):
        assert glob in doc, f"the docstring no longer names {glob}"
    assert "``census`` group" in doc, "the deploy-ordering note names the group"
    assert "Present" in doc, "the deploy-ordering note names the readiness probe"
    assert "arms nothing" in doc
    assert "alembic-sole-authorship" in doc
    assert "prune_samples" in doc
    assert "COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS" in doc


def test_the_round_trip_fixture_is_internally_consistent() -> None:
    """The fixture guards the test, not the revision: a census whose entries
    claim more than its totals would teach a reader the wrong shape."""
    totals = _MEASURED_CENSUS["totals"]
    for entry in _MEASURED_CENSUS["top_by_handles"]:
        assert entry["handle_count"] <= totals["handle_count"], entry
        assert entry["thread_count"] <= totals["thread_count"], entry
    for entry in _MEASURED_CENSUS["top_images"]:
        assert entry["processes"] <= totals["processes"], entry
        assert entry["handle_count"] <= totals["handle_count"], entry
        assert entry["thread_count"] <= totals["thread_count"], entry
    top8 = sum(e["handle_count"] for e in _MEASURED_CENSUS["top_by_handles"])
    assert _MEASURED_CENSUS["top_by_handles_share"] == round(
        top8 / totals["handle_count"], 3
    )
    dead = _MEASURED_CENSUS["dead_images"]
    assert sum(e["hits"] for e in dead["top"]) <= dead["hits"] <= dead["sampled"]
    withheld = {
        e["image_withheld"]
        for e in (*_MEASURED_CENSUS["top_by_handles"], *dead["top"])
        if "image_withheld" in e
    }
    assert withheld <= {"coord", "persisted", "profile", "product_default", "unknown"}


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------


def _assert_columns_present(engine: Engine) -> None:
    for name, ddl_type in _EXPECTED_SAMPLE_DDL:
        info = column_info(engine, _SAMPLE_TABLE, name)
        assert info is not None, f"{_SAMPLE_TABLE}.{name} missing after upgrade"
        data_type, is_nullable, default = info
        assert data_type == _PG_TYPE[ddl_type], (
            f"{_SAMPLE_TABLE}.{name} is {data_type}, expected {_PG_TYPE[ddl_type]}"
        )
        assert is_nullable == "YES", f"{_SAMPLE_TABLE}.{name} is NOT NULL"
        assert default is None, (
            f"{_SAMPLE_TABLE}.{name} carries DEFAULT {default!r}; NULL is the "
            "honest record of no reading"
        )


def _assert_columns_commented(engine: Engine) -> None:
    for name, _ in _EXPECTED_SAMPLE_DDL:
        live = column_comment(engine, _SAMPLE_TABLE, name)
        assert live == _expected_comment(name), (
            f"{_SAMPLE_TABLE}.{name}'s live comment differs from the revision's"
        )


def _assert_columns_absent(engine: Engine) -> None:
    for name, _ in _EXPECTED_SAMPLE_DDL:
        assert column_info(engine, _SAMPLE_TABLE, name) is None, (
            f"{_SAMPLE_TABLE}.{name} survived downgrade"
        )


def _sample_column_names(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        return {
            str(row[0])
            for row in conn.execute(
                text(
                    """
                    SELECT column_name
                      FROM information_schema.columns
                     WHERE table_schema = :schema AND table_name = :table
                    """
                ),
                {"schema": _SCHEMA, "table": _SAMPLE_TABLE},
            )
        }


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def test_up_down_up_leaves_no_residue_and_keeps_the_sample_row() -> None:
    """Downgrade drops exactly the added columns and touches nothing else."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "kcensus01r") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        before = _sample_column_names(engine)
        device_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source)
                    VALUES (:device_id, 'host', now(), 'test')
                    """
                ),
                {"device_id": str(device_id)},
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)
        assert _sample_column_names(engine) - before == {
            name for name, _ in _EXPECTED_SAMPLE_DDL
        }, "upgrade added a column the list does not name"

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        assert _sample_column_names(engine) == before, (
            "downgrade did not restore the parent revision's exact column set"
        )
        assert table_exists(engine, _SCHEMA, _SAMPLE_TABLE), (
            f"downgrade dropped the TABLE {_SAMPLE_TABLE}; it predates this revision"
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


def test_an_unread_row_is_null_and_real_readings_round_trip() -> None:
    """A row omitting the census reads NULL; both census shapes, a withheld
    image and counts past INTEGER's range round-trip unchanged."""
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "kcensus01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        unread = uuid.uuid4()
        measured = uuid.uuid4()
        failed = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source)
                    VALUES (:unread, 'host', now(), 'test')
                    """
                ),
                {"unread": str(unread)},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source,
                         kernel_process_census, kernel_process_census_at,
                         kernel_process_handles, kernel_thread_objects,
                         kernel_thread_handles, os_thread_count)
                    VALUES
                        (:measured, 'host', now(), 'runner',
                         CAST(:census AS JSONB), '2026-11-26T20:18:30Z',
                         0, 3000000000,
                         5000000000, 5200)
                    """
                ),
                {"measured": str(measured), "census": json.dumps(_MEASURED_CENSUS)},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.device_resource_samples
                        (device_id, lane, sampled_at, source,
                         kernel_process_census, kernel_process_census_at)
                    VALUES
                        (:failed, 'host', now(), 'runner',
                         CAST(:census AS JSONB), '2026-11-26T20:18:30Z')
                    """
                ),
                {"failed": str(failed), "census": json.dumps(_UNMEASURED_CENSUS)},
            )
            columns = ", ".join(name for name, _ in _EXPECTED_SAMPLE_DDL)
            rows = {
                str(row[0]): row[1:]
                for row in conn.execute(
                    text(
                        f"SELECT device_id, {columns} "
                        "FROM coord.device_resource_samples "
                        "WHERE device_id IN (:unread, :measured, :failed)"
                    ),
                    {
                        "unread": str(unread),
                        "measured": str(measured),
                        "failed": str(failed),
                    },
                )
            }

        assert all(value is None for value in rows[str(unread)]), (
            "a row from a publisher that omits the census must read NULL "
            "(never read), never a fabricated 0 or []"
        )
        names = [name for name, _ in _EXPECTED_SAMPLE_DDL]
        reading = dict(zip(names, rows[str(measured)], strict=True))
        assert reading["kernel_process_census"] == _MEASURED_CENSUS
        assert reading["kernel_process_census"]["top_by_handles"][1]["image"] is None
        assert reading["kernel_process_census_at"] is not None
        assert reading["kernel_process_census_at"].tzinfo is not None
        assert reading["kernel_process_handles"] == 0, (
            "a real 0 stays distinct from NULL"
        )
        assert reading["kernel_thread_objects"] == 3_000_000_000, (
            "a count past 2**31 must fit; INTEGER would overflow"
        )
        assert reading["kernel_thread_handles"] == 5_000_000_000
        assert reading["os_thread_count"] == 5_200

        failed_reading = dict(zip(names, rows[str(failed)], strict=True))
        assert failed_reading["kernel_process_census"] == _UNMEASURED_CENSUS, (
            "a failed census read is the typed unmeasured object, not NULL"
        )
        assert failed_reading["kernel_process_handles"] is None


def test_upgrade_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Re-running the revision's own ADD is a no-op, not an error."""
    statements = _recorded_sql(monkeypatch, "upgrade")
    add = _alter_statement(statements, "ADD")
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "kcensus01i") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)

        with engine.begin() as conn:
            conn.execute(text(add))

        _assert_columns_present(engine)
        _assert_columns_commented(engine)
