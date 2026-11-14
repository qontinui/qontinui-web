"""Schema + round-trip test for the ``overlord_05_label_question_id`` revision.

Phase 1 of plan ``2026-11-02-overlord-one-answer-relays-once-server-side`` adds
``coord.overlord_interventions.label_question_id UUID NULL``, the CHECK
``ck_overlord_interventions_label_question_relayed`` and the partial unique
index ``ux_overlord_interventions_label_question``. The contract:

1. **The column's NAME and TYPE are an interface.** coord's Phase 2 names it in
   its INSERT and its relay-once read; ``IF NOT EXISTS`` is type-blind.
2. **Nullable with no DEFAULT.** NULL means "not a relay"; a pre-migration
   ``operator_relayed`` row keeps NULL and is dated by ``recorded_at``.
3. **The CHECK refuses an id on a row that is not ``operator_relayed``.**
4. **The index refuses a second row with the same
   ``(tenant_id, label_question_id)``** and admits any number of NULLs and the
   same id under another tenant.
5. **Every ``op.execute`` is one static literal**, and DROPs live only in
   ``downgrade()``.
6. **Up -> down -> up leaves no residue and keeps pre-existing rows.**
7. **The chain has exactly one head, and this revision is on it.**

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
    index_definition,
    index_exists,
    index_state,
    load_revision_module,
    run_alembic,
    scalar,
)

# Pinned explicitly rather than "head". `_PARENT_REVISION_ID` MUST equal the
# revision's own `down_revision` — the first test enforces it. If the alembic
# head moves before landing, re-point BOTH together.
_REVISION_ID = "overlord_05_label_question_id"
_PARENT_REVISION_ID = "overlord_04_runner_start_and_nudge_time"
_LOCK_BOUND = "SET LOCAL lock_timeout = '3s'"
_REVISION_FILENAME = "overlord_05_label_question_id.py"
_PLAN_STEM = "2026-11-02-overlord-one-answer-relays-once-server-side"

_SCHEMA = "coord"
_TABLE = "overlord_interventions"
_COLUMN = "label_question_id"
_CHECK = "ck_overlord_interventions_label_question_relayed"
_INDEX = "ux_overlord_interventions_label_question"


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), "_rev_overlord_05")


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
        assert "token" not in name.lower(), name


def test_the_revision_names_what_coord_reads_from_its_constants() -> None:
    module = _revision_module()
    assert tuple(module._ADDED_COLUMN) == (_TABLE, _COLUMN, "UUID")
    assert module._CHECK_NAME == _CHECK
    assert module._INDEX_NAME == _INDEX


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


def test_upgrade_emits_the_column_check_and_index(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = [_collapsed(s) for s in _recorded_sql(monkeypatch, "upgrade")]
    assert statements[0] == _LOCK_BOUND, statements
    assert (
        f"ALTER TABLE {_SCHEMA}.{_TABLE} ADD COLUMN IF NOT EXISTS {_COLUMN} UUID"
        in statements
    )
    assert (
        f"ALTER TABLE {_SCHEMA}.{_TABLE} ADD CONSTRAINT {_CHECK} CHECK "
        f"({_COLUMN} IS NULL OR label_source IS NOT DISTINCT FROM 'operator_relayed')"
    ) in statements
    assert (
        f"CREATE UNIQUE INDEX IF NOT EXISTS {_INDEX} ON {_SCHEMA}.{_TABLE} "
        f"(tenant_id, {_COLUMN}) WHERE {_COLUMN} IS NOT NULL"
    ) in statements
    assert sum("ADD COLUMN" in s for s in statements) == 1
    assert len(statements) == 5, statements  # lock, add, comment, check, index


def test_downgrade_drops_index_check_column_in_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = [_collapsed(s) for s in _recorded_sql(monkeypatch, "downgrade")]
    assert statements == [
        _LOCK_BOUND,
        f"DROP INDEX IF EXISTS {_SCHEMA}.{_INDEX}",
        f"ALTER TABLE {_SCHEMA}.{_TABLE} DROP CONSTRAINT IF EXISTS {_CHECK}",
        f"ALTER TABLE {_SCHEMA}.{_TABLE} DROP COLUMN IF EXISTS {_COLUMN}",
    ]


def test_upgrade_never_drops_and_the_add_carries_no_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = _recorded_sql(monkeypatch, "upgrade")
    up = "\n".join(statements)
    assert not re.search(r"\bDROP\b", up)
    add = next(_collapsed(s) for s in statements if "ADD COLUMN" in s)
    assert not re.search(r"\bNOT NULL\b|\bDEFAULT\b|\bREFERENCES\b", add, re.I), (
        "the ADD carries NOT NULL / DEFAULT / a FK; NULL means not-a-relay and "
        "pre-migration relayed rows must stay NULL"
    )


def test_the_column_comment_states_its_contract() -> None:
    comment = _expected_comment()
    assert "operator_relayed" in comment
    assert "does not inherit" in comment
    assert "recorded_at" in comment, "pre-migration rows are dated by recorded_at"


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
    assert "does NOT inherit" in doc, "successors must not inherit the id"
    assert "recorded_at" in doc, "pre-migration relayed rows' dating"
    assert _CHECK in doc and _INDEX in doc
    assert "schema.manifest" in doc, "the deploy-ordering note names coord's pin"


# ---------------------------------------------------------------------------
# Live-schema walks. These skip without a reachable Postgres; a skip proves
# nothing.
# ---------------------------------------------------------------------------

_INSERT = text(
    """
    INSERT INTO coord.overlord_interventions
        (id, intervention_id, tenant_id, stop_class, verb, mode,
         operator_label, label_kind, label_source, label_question_id)
    VALUES (:id, :id, :tid, 'A', 'nudge', 'live',
            :label, :kind, :source, :qid)
    """
)

_INSERT_PRE = text(
    """
    INSERT INTO coord.overlord_interventions
        (id, intervention_id, tenant_id, stop_class, verb, mode,
         operator_label, label_kind, label_source)
    VALUES (:id, :id, :tid, 'A', 'nudge', 'live', 'A', 'class',
            'operator_relayed')
    """
)


def _relayed(tid: uuid.UUID, qid: uuid.UUID | None) -> dict[str, object]:
    return {
        "id": uuid.uuid4(),
        "tid": tid,
        "label": "A",
        "kind": "class",
        "source": "operator_relayed",
        "qid": qid,
    }


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG")
    return url


def _constraint_count(engine: Engine) -> int:
    return int(
        str(
            scalar(
                engine,
                """
            SELECT count(*) FROM pg_constraint
             WHERE conname = :name
               AND conrelid = 'coord.overlord_interventions'::regclass
            """,
                name=_CHECK,
            )
        )
    )


def _assert_present(engine: Engine) -> None:
    info = column_info(engine, _TABLE, _COLUMN)
    assert info is not None, "label_question_id missing after upgrade"
    data_type, is_nullable, default = info
    assert data_type == "uuid", data_type
    assert is_nullable == "YES"
    assert default is None, default
    assert column_comment(engine, _TABLE, _COLUMN) == _expected_comment()
    assert _constraint_count(engine) == 1
    valid, unique, predicate = index_state(engine, _INDEX)
    assert valid and unique, (valid, unique)
    assert predicate == "(label_question_id IS NOT NULL)", predicate
    assert "(tenant_id, label_question_id)" in index_definition(engine, _INDEX)


def _assert_absent(engine: Engine) -> None:
    assert column_info(engine, _TABLE, _COLUMN) is None
    assert _constraint_count(engine) == 0
    assert not index_exists(engine, _INDEX)


def _expect_refusal(engine: Engine, params: dict[str, object], name: str) -> None:
    with pytest.raises(IntegrityError) as caught, engine.begin() as conn:
        conn.execute(_INSERT, params)
    assert name in str(caught.value), str(caught.value)


def test_up_down_up_constraints_and_existing_rows() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "overlord05q") as (engine, db_url):
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
                "SELECT label_question_id FROM coord.overlord_interventions "
                "WHERE id = :id",
                id=pre_id,
            )
            is None
        ), "a pre-migration relayed row must stay NULL"

        # The CHECK: an id on a row that is not operator_relayed is refused,
        # for every other label_source and for an unlabelled row (NULL
        # label_source -- the case a plain `=` would have let through).
        for kind, label, source in (
            ("class", "A", "operator_page"),
            ("class", "A", "agent"),
            ("class", "A", "unknown"),
            (None, None, None),
        ):
            params = _relayed(tenant, uuid.uuid4())
            params.update(kind=kind, label=label, source=source)
            _expect_refusal(engine, params, _CHECK)

        # The index: one relay per (tenant, question). NULLs are unconstrained,
        # and another tenant may carry the same id.
        question = uuid.uuid4()
        other_tenant = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(_INSERT, _relayed(tenant, question))
            conn.execute(_INSERT, _relayed(tenant, None))
            conn.execute(_INSERT, _relayed(tenant, None))
            conn.execute(_INSERT, _relayed(other_tenant, question))
        _expect_refusal(engine, _relayed(tenant, question), _INDEX)

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
