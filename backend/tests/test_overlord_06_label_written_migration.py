"""Schema + round-trip test for the ``overlord_06_label_written`` revision.

Phase 1 of plan ``2026-11-22-overlord-intervention-label-written-marker`` adds
``coord.overlord_interventions.label_written BOOLEAN NULL`` and the CHECK
``ck_overlord_interventions_label_written_has_source``. The contract:

1. **The column's NAME and TYPE are an interface.** coord's Phase 2 names it in
   its INSERT and its freshness read, so the live walk asserts both.
2. **Nullable with no DEFAULT and no backfill.** NULL means "written before the
   marker, unknown"; a pre-migration row keeps NULL.
3. **The CHECK refuses ``label_written = true`` with ``label_source`` NULL**
   and admits ``false`` (and NULL) with ``label_source`` NULL.
4. **Every ``op.execute`` is one static literal**, and DROPs live only in
   ``downgrade()``.
5. **Up -> down -> up leaves no residue and keeps pre-existing rows.**
6. **The chain has exactly one head, and this revision is on it.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing.
"""

from __future__ import annotations

import ast
import re
import uuid
from pathlib import Path
from types import ModuleType

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
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
    load_revision_module,
    run_alembic,
    scalar,
)

# Pinned explicitly rather than "head". `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision` — the first test enforces it. If the alembic
# head moves before landing, re-point BOTH together.
_REVISION_ID = "overlord_06_label_written"
_PARENT_REVISION_ID = "ci_measure_01_dispatch_measurement"
_LOCK_BOUND = "SET LOCAL lock_timeout = '3s'"
_REVISION_FILENAME = "overlord_06_label_written.py"
_PLAN_STEM = "2026-11-22-overlord-intervention-label-written-marker"

_SCHEMA = "coord"
_TABLE = "overlord_interventions"
_COLUMN = "label_written"
_CHECK = "ck_overlord_interventions_label_written_has_source"


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), "_rev_overlord_06")


def _expected_comment() -> str:
    return comment_body_from_source(_revision_source(), f"{_SCHEMA}.{_TABLE}.{_COLUMN}")


# ---------------------------------------------------------------------------
# Source-level guards — no database needed, so they never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "the revision was re-pointed onto a new chain head and "
        "`_PARENT_REVISION_ID` was not updated with it"
    )
    assert (
        declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
        == _PARENT_REVISION_ID
    )
    assert module.branch_labels is None
    assert module.depends_on is None
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_the_chain_has_one_head_and_this_revision_is_on_it() -> None:
    config = Config(str(backend_root() / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root() / "alembic"))
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    assert len(heads) == 1, f"alembic has {len(heads)} heads: {sorted(heads)}"
    walked = [rev.revision for rev in script.walk_revisions("base", heads[0])]
    assert _REVISION_ID in walked, (
        f"{_REVISION_ID} is not an ancestor of the single head {heads[0]}"
    )
    revision = script.get_revision(_REVISION_ID)
    assert revision is not None
    assert revision.down_revision == _PARENT_REVISION_ID


def test_no_file_of_this_change_is_named_after_a_security_glob() -> None:
    for name in (_REVISION_FILENAME, Path(__file__).name):
        lowered = name.lower()
        for glob_word in ("token", "jwt", "auth", "credential"):
            assert glob_word not in lowered, name


def test_the_revision_names_what_coord_reads_from_its_constants() -> None:
    module = _revision_module()
    assert tuple(module._ADDED_COLUMN) == (_TABLE, _COLUMN, "BOOLEAN")
    assert module._CHECK_NAME == _CHECK


def _recorded_sql(monkeypatch: pytest.MonkeyPatch, step: str) -> list[str]:
    module = _revision_module()
    executed: list[str] = []

    class _RecordingOp:
        @staticmethod
        def execute(sql: object) -> None:
            executed.append(str(sql))

    monkeypatch.setattr(module, "op", _RecordingOp)
    getattr(module, step)()
    return executed


def _collapsed(sql: str) -> str:
    return " ".join(sql.split())


def test_upgrade_emits_the_column_comment_and_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _revision_module()
    table, column, sql_type = module._ADDED_COLUMN
    statements = [_collapsed(s) for s in _recorded_sql(monkeypatch, "upgrade")]
    assert statements[0] == _LOCK_BOUND, statements
    # Names-as-data: the constants and the static SQL agree.
    assert f"ALTER TABLE {_SCHEMA}.{table} ADD COLUMN {column} {sql_type}" in statements
    assert any(
        s.startswith(f"COMMENT ON COLUMN {_SCHEMA}.{table}.{column} IS")
        for s in statements
    ), statements
    assert (
        f"ALTER TABLE {_SCHEMA}.{table} ADD CONSTRAINT {module._CHECK_NAME} CHECK "
        f"({column} IS NOT TRUE OR label_source IS NOT NULL)"
    ) in statements
    assert sum("ADD COLUMN" in s for s in statements) == 1
    assert len(statements) == 4, statements  # lock, add, comment, check


def test_downgrade_drops_check_then_column(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = [_collapsed(s) for s in _recorded_sql(monkeypatch, "downgrade")]
    assert statements == [
        _LOCK_BOUND,
        f"ALTER TABLE {_SCHEMA}.{_TABLE} DROP CONSTRAINT IF EXISTS {_CHECK}",
        f"ALTER TABLE {_SCHEMA}.{_TABLE} DROP COLUMN IF EXISTS {_COLUMN}",
    ]


def test_upgrade_never_drops_backfills_or_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = _recorded_sql(monkeypatch, "upgrade")
    up = "\n".join(statements)
    assert not re.search(r"\bDROP\b", up)
    assert not re.search(r"\b(UPDATE|INSERT|DELETE)\b", up, re.I), (
        "the revision backfills; the Design decision rejected a backfill (D)"
    )
    add = next(_collapsed(s) for s in statements if "ADD COLUMN" in s)
    assert not re.search(r"\bNOT NULL\b|\bDEFAULT\b|\bREFERENCES\b", add, re.I), (
        "the ADD carries NOT NULL / DEFAULT / a FK; NULL means 'written before "
        "the marker, unknown' and pre-migration rows must stay NULL"
    )


def test_the_column_comment_states_its_contract() -> None:
    comment = _expected_comment()
    assert "true = this row wrote its label" in comment
    assert "false = it inherited" in comment
    assert "NULL = written before this revision" in comment
    assert "counted as a decision" in comment


def test_every_op_execute_takes_a_static_string_literal() -> None:
    """coord's migration classifier cannot read a dynamic ``op.execute`` argument."""
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


def test_no_drop_text_outside_downgrade() -> None:
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
            assert not re.search(r"\bDROP\b", literal.upper()), (
                "a DROP template appeared OUTSIDE downgrade()"
            )


def test_the_docstring_is_the_columns_authority() -> None:
    doc = _revision_module().__doc__ or ""
    assert _PLAN_STEM in doc
    assert "Phase 1" in doc
    assert _CHECK in doc
    assert "IS NOT FALSE" in doc, "the fail-closed reading of NULL"
    assert "never inherited" in doc, "successors must not inherit the marker"
    # Why no DEFAULT and no backfill: options B-D and the production reading.
    assert "NOT NULL DEFAULT false" in doc
    assert "NOT NULL DEFAULT true" in doc
    assert "backfill" in doc
    assert "8d4f3678" in doc
    assert "schema.manifest" in doc, "the deploy-ordering note names coord's pin"


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------

_INSERT = text(
    """
    INSERT INTO coord.overlord_interventions
        (id, intervention_id, tenant_id, stop_class, verb, mode,
         operator_label, label_kind, label_source, label_written)
    VALUES (:id, :id, :tid, 'A', 'nudge', 'live',
            :label, :kind, :source, :written)
    """
)

_INSERT_PRE = text(
    """
    INSERT INTO coord.overlord_interventions
        (id, intervention_id, tenant_id, stop_class, verb, mode,
         operator_label, label_kind, label_source)
    VALUES (:id, :id, :tid, 'A', 'nudge', 'live', 'A', 'class',
            'operator_page')
    """
)


def _row(tid: uuid.UUID, *, labelled: bool, written: bool | None) -> dict[str, object]:
    return {
        "id": uuid.uuid4(),
        "tid": tid,
        "label": "A" if labelled else None,
        "kind": "class" if labelled else None,
        "source": "operator_page" if labelled else None,
        "written": written,
    }


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def _constraint_count(engine: Engine) -> int:
    count = scalar(
        engine,
        """
            SELECT count(*) FROM pg_constraint
             WHERE conname = :name
               AND conrelid = 'coord.overlord_interventions'::regclass
            """,
        name=_CHECK,
    )
    assert isinstance(count, int), f"pg_constraint count was {count!r}, not an int"
    return count


def _assert_present(engine: Engine) -> None:
    info = column_info(engine, _TABLE, _COLUMN)
    assert info is not None, "label_written missing after upgrade"
    data_type, is_nullable, default = info
    assert data_type == "boolean", data_type
    assert is_nullable == "YES"
    assert default is None, default
    assert column_comment(engine, _TABLE, _COLUMN) == _expected_comment()
    assert _constraint_count(engine) == 1


def _assert_absent(engine: Engine) -> None:
    assert column_info(engine, _TABLE, _COLUMN) is None
    assert _constraint_count(engine) == 0


def test_up_down_up_constraint_and_existing_rows() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "overlord06w") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)
        tenant = uuid.uuid4()
        pre_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(_INSERT_PRE, {"id": pre_id, "tid": tenant})

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_present(engine)
        assert (
            scalar(
                engine,
                "SELECT label_written FROM coord.overlord_interventions WHERE id = :id",
                id=pre_id,
            )
            is None
        ), "a pre-migration row must read NULL (unknown), not a default"

        # The CHECK refuses "wrote a label" with no stored source.
        with pytest.raises(IntegrityError) as caught, engine.begin() as conn:
            conn.execute(_INSERT, _row(tenant, labelled=False, written=True))
        assert _CHECK in str(caught.value), str(caught.value)

        # ...and admits false / NULL with no source, and true with a source.
        accepted = [
            _row(tenant, labelled=False, written=False),
            _row(tenant, labelled=False, written=None),
            _row(tenant, labelled=True, written=True),
            _row(tenant, labelled=True, written=False),
        ]
        with engine.begin() as conn:
            for params in accepted:
                conn.execute(_INSERT, params)
        for params in accepted:
            assert (
                scalar(
                    engine,
                    "SELECT label_written FROM coord.overlord_interventions "
                    "WHERE id = :id",
                    id=params["id"],
                )
                is params["written"]
            )

        rows_before = scalar(
            engine, "SELECT count(*) FROM coord.overlord_interventions"
        )
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)
        assert (
            scalar(engine, "SELECT count(*) FROM coord.overlord_interventions")
            == rows_before
        ), "downgrade destroyed rows"

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_present(engine)
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.overlord_interventions "
                "WHERE label_written IS NOT NULL",
            )
            == 0
        ), "re-upgrade must not backfill"
