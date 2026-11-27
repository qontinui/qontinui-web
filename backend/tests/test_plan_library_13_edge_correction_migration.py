"""Round-trip + shape test for ``plan_library_13_edge_correction``.

Phase 5 of
``2026-09-20-a-recorded-delivery-scope-is-permanent-so-a-mis-declared-phase-is-uncorrectable``:
the correction columns on ``agent.work_artifact_edges`` and the two unique
indexes rebuilt PARTIAL on liveness.

What is pinned, and why each matters:

* **Static, no database.** Every ``op.execute`` is ONE static literal (coord's
  classifier refuses anything else); the only DROP on the upgrade path is a
  same-name index rebuild, each followed by its CREATE, so nothing
  destructive runs outside ``downgrade()``; each CREATE's head is ONE source
  literal, the shape coord's re-point planner needs to recognise the rebuild
  (it reads the source, not the joined string); and the downgrade drops
  exactly the columns the upgrade adds.
* **Model ≡ migration, through PostgreSQL.** ``conftest`` builds the API test
  database from ``Base.metadata``, not alembic, so an index the model spells
  differently would be invisible to every API test. Each rebuilt index is
  compared with the MODEL's index built on the same table under a probe name,
  by ``pg_get_indexdef`` — PostgreSQL's own normalisation.
* **The round trip.** Upgrade admits a second live edge beside a retracted one
  on the same key; downgrade deletes the retracted rows and restores the full
  indexes (which would otherwise refuse the pair); upgrade again re-applies.

Substrate is ``tests/_alembic_harness``. A skip proves nothing — point it at a
live instance with ``QONTINUI_TEST_PG`` / ``QONTINUI_TEST_PG_DSN``.
"""

from __future__ import annotations

import io
import re
import tokenize
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine
from sqlalchemy.schema import CreateIndex

from app.models.work_artifact import NOTE_TRIM_SQL, WorkArtifactEdge
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
    upgrade_execute_calls,
)

_REVISION_ID = "plan_library_13_edge_correction"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_REBUILT = (
    "uq_work_artifact_edges_from_to_relation",
    "uq_work_artifact_edges_open_followup",
)
_COLUMNS = (
    "retracted_at",
    "retracted_by",
    "retracted_reason",
    "source",
    "corrected_at",
    "corrected_by",
    "corrected_reason",
    "corrected_replaced",
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """Parsed from the revision itself — a re-point onto a newer head moves
    ``down_revision`` and this follows it."""
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


def _sql(function: str) -> list[str]:
    calls = upgrade_execute_calls(_revision_path(), function=function)
    assert calls, f"{function}() executes nothing"
    assert all(call.sql is not None for call in calls), calls
    assert not any(call.in_autocommit_block for call in calls), calls
    return [call.sql for call in calls if call.sql is not None]


def _added_columns(statements: list[str]) -> list[str]:
    return [
        m.group(1)
        for sql in statements
        if (m := re.search(r"ADD COLUMN IF NOT EXISTS (\w+)", sql))
    ]


def _dropped_columns(statements: list[str]) -> list[str]:
    return [
        m.group(1)
        for sql in statements
        if (m := re.search(r"DROP COLUMN IF EXISTS (\w+)", sql))
    ]


# ───────────────────────────── static ─────────────────────────────


def test_the_parent_is_a_real_revision() -> None:
    parent = _parent_revision_id()
    owners = [
        path.name
        for path in (backend_root() / "alembic" / "versions").glob("*.py")
        if re.search(
            rf'^revision[^=]*=\s*["\']{re.escape(parent)}["\']',
            path.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
    ]
    assert len(owners) == 1, (parent, owners)


def test_the_revision_id_is_unique_in_the_chain() -> None:
    same_id = [
        path.name
        for path in (backend_root() / "alembic" / "versions").glob("*.py")
        if re.search(
            rf'^revision[^=]*=\s*["\']{re.escape(_REVISION_ID)}["\']',
            path.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
    ]
    assert same_id == [_REVISION_FILENAME]


def test_the_upgrade_adds_exactly_the_model_columns() -> None:
    added = _added_columns(_sql("upgrade"))
    assert added == list(_COLUMNS)
    model_columns = set(WorkArtifactEdge.__table__.columns.keys())
    assert set(added) <= model_columns, sorted(set(added) - model_columns)


def test_the_downgrade_drops_exactly_what_the_upgrade_adds() -> None:
    assert _dropped_columns(_sql("downgrade")) == list(reversed(_COLUMNS))


def test_the_only_upgrade_drop_is_a_same_name_rebuild() -> None:
    """Each ``DROP`` on the upgrade path is ``DROP INDEX IF EXISTS
    agent.<name>`` with a later ``CREATE UNIQUE INDEX IF NOT EXISTS <name> ON
    agent.…`` — the drop removes nothing the revision does not put back. No
    other destructive token appears outside ``downgrade()``."""
    upgrade = _sql("upgrade")
    for position, sql in enumerate(upgrade):
        upper = sql.upper()
        assert "DELETE" not in upper and "TRUNCATE" not in upper, sql
        assert "DROP COLUMN" not in upper and "DROP CONSTRAINT" not in upper, sql
        if "DROP" not in upper:
            continue
        match = re.fullmatch(r"DROP INDEX IF EXISTS agent\.(\w+)", sql)
        assert match is not None, sql
        name = match.group(1)
        assert name in _REBUILT, name
        rebuilt = [
            later
            for later in upgrade[position + 1 :]
            if later.startswith(f"CREATE UNIQUE INDEX IF NOT EXISTS {name} ON agent.")
        ]
        assert len(rebuilt) == 1, (name, rebuilt)
        assert "\\" not in sql, sql
    drops = [sql for sql in upgrade if "DROP" in sql.upper()]
    assert len(drops) == len(_REBUILT)


def test_each_rebuilds_create_head_is_one_source_literal() -> None:
    """coord's re-point planner (``alembic_repoint_plan.rs``,
    ``REBUILDING_CREATE``) excuses a same-name ``DROP INDEX`` only when the
    rebuilding ``CREATE … INDEX … <name> ON <schema>.<table>`` is contiguous in
    the SOURCE. Python joins adjacent literals before ``op.execute`` sees them,
    so the joined-string checks above cannot see a head split across two
    literals — this reads the tokens."""
    literals = [
        tok.string
        for tok in tokenize.generate_tokens(io.StringIO(_revision_source()).readline)
        if tok.type == tokenize.STRING
    ]
    for name in _REBUILT:
        head = f"CREATE UNIQUE INDEX IF NOT EXISTS {name} ON agent.work_artifact_edges"
        assert sum(head in literal for literal in literals) == 2, name  # up + down


def test_both_rebuilt_unique_indexes_are_partial_on_liveness() -> None:
    for name in _REBUILT:
        (create,) = [
            sql for sql in _sql("upgrade") if f"INDEX IF NOT EXISTS {name} " in sql
        ]
        assert create.endswith("retracted_at IS NULL"), create


def test_the_trim_expression_is_the_models() -> None:
    """The rebuilt index keeps revision 03's trim expression, the model's
    ``NOTE_TRIM_SQL``, so the rebuild changes its predicate and nothing else
    (and the model's index still matches the database's)."""
    (create,) = [
        sql
        for sql in _sql("upgrade")
        if "INDEX IF NOT EXISTS uq_work_artifact_edges_open_followup " in sql
    ]
    assert NOTE_TRIM_SQL in create


# ───────────────────────────── database ─────────────────────────────

_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG_DSN before running."
    ),
)


def _indexdef(engine: Engine, name: str) -> str | None:
    with engine.connect() as conn:
        value = conn.execute(
            text(
                "SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'agent' AND c.relname = :name"
            ),
            {"name": name},
        ).scalar()
    return None if value is None else str(value)


def _column_names(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        return set(
            conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'agent' "
                    "AND table_name = 'work_artifact_edges'"
                )
            ).scalars()
        )


def _model_indexdef(engine: Engine, name: str) -> str:
    """The MODEL's index ``name``, built under a probe name on the migrated
    table and read back the way PostgreSQL renders it — then dropped."""
    (index,) = [i for i in WorkArtifactEdge.__table__.indexes if i.name == name]
    ddl = str(CreateIndex(index).compile(dialect=postgresql.dialect()))
    probe = f"probe_{uuid4().hex[:8]}"
    probe_ddl = ddl.replace(f"INDEX {name} ", f"INDEX {probe} ", 1)
    assert probe_ddl != ddl, ddl
    with engine.begin() as conn:
        conn.execute(text(probe_ddl))
    try:
        rendered = _indexdef(engine, probe)
        assert rendered is not None
        return rendered.replace(probe, name)
    finally:
        with engine.begin() as conn:
            conn.execute(text(f"DROP INDEX IF EXISTS agent.{probe}"))


def _seed_pair(engine: Engine) -> tuple[str, str, str]:
    """Two artifacts and, between them, one RETRACTED edge and one LIVE edge
    on the same (from, to, relation) key, plus a retracted open follow-up and
    a live one with the same note. Returns ``(from_id, to_id, live_edge_id)``."""
    from_id, to_id = str(uuid4()), str(uuid4())
    live_id = str(uuid4())
    with engine.begin() as conn:
        for artifact_id, slug in ((from_id, "from"), (to_id, "to")):
            conn.execute(
                text(
                    "INSERT INTO agent.work_artifacts "
                    "(id, kind, slug, title, status, body, content_sha256) "
                    "VALUES (:id, 'plan', :slug, 't', '', 'b', :sha)"
                ),
                {
                    "id": artifact_id,
                    "slug": f"{slug}-{artifact_id[:8]}",
                    "sha": "0" * 64,
                },
            )
        conn.execute(
            text(
                "INSERT INTO agent.work_artifact_edges "
                "(from_id, to_id, relation, retracted_at, retracted_by, retracted_reason) "
                "VALUES (:f, :t, 'supersedes', now(), 'test', 'wrong claim')"
            ),
            {"f": from_id, "t": to_id},
        )
        conn.execute(
            text(
                "INSERT INTO agent.work_artifact_edges (id, from_id, to_id, relation) "
                "VALUES (:id, :f, :t, 'supersedes')"
            ),
            {"id": live_id, "f": from_id, "t": to_id},
        )
        conn.execute(
            text(
                "INSERT INTO agent.work_artifact_edges "
                "(from_id, relation, note, retracted_at, retracted_reason) "
                "VALUES (:f, 'spawned_followup', 'same note', now(), 'wrong')"
            ),
            {"f": from_id},
        )
        conn.execute(
            text(
                "INSERT INTO agent.work_artifact_edges (from_id, relation, note) "
                "VALUES (:f, 'spawned_followup', 'same note')"
            ),
            {"f": from_id},
        )
    return from_id, to_id, live_id


def _edge_ids(engine: Engine, from_id: str) -> set[str]:
    with engine.connect() as conn:
        return {
            str(v)
            for v in conn.execute(
                text("SELECT id FROM agent.work_artifact_edges WHERE from_id = :f"),
                {"f": from_id},
            ).scalars()
        }


@_PG_SKIP
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    admin_url = admin_database_url()
    root = backend_root()
    parent = _parent_revision_id()

    with ephemeral_database(admin_url, "planlib_edgefix") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", _REVISION_ID)

        assert set(_COLUMNS) <= _column_names(engine)
        with engine.connect() as conn:
            check = conn.execute(
                text(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE conname = 'ck_work_artifact_edges_source'"
                )
            ).scalar_one()
        assert "source IS NULL" in check and "'corrected'" in check, check

        for name in _REBUILT:
            migrated = _indexdef(engine, name)
            assert migrated is not None, name
            assert migrated.endswith("WHERE (retracted_at IS NULL)") or (
                "AND (retracted_at IS NULL)" in migrated
            ), migrated
            assert migrated == _model_indexdef(engine, name)

        # A live edge beside a retracted one on the same key is admitted.
        from_id, _, live_id = _seed_pair(engine)
        assert len(_edge_ids(engine, from_id)) == 4

        run_alembic(root, db_url, "downgrade", parent)
        assert not set(_COLUMNS) & _column_names(engine)
        # The retracted rows went first; the live ones stayed.
        remaining = _edge_ids(engine, from_id)
        assert live_id in remaining and len(remaining) == 2, remaining
        for name in _REBUILT:
            restored = _indexdef(engine, name)
            assert restored is not None and "retracted_at" not in restored, restored
        assert _indexdef(engine, _REBUILT[0]) is not None
        assert "WHERE" not in str(_indexdef(engine, _REBUILT[0]))

        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        assert set(_COLUMNS) <= _column_names(engine)
        for name in _REBUILT:
            assert "retracted_at IS NULL" in str(_indexdef(engine, name))
