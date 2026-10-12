"""Round-trip + shape test for ``plan_library_11_followup_anchors_and_closure``.

Phase 3 of ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``:
follow-up closure states (D1), file anchors (D2) and the open-queue index.

What is pinned, and why each matters:

* **Static, no database.** Every ``op.execute`` in ``upgrade()`` is ONE static
  literal and only the ``CONCURRENTLY`` build sits in an autocommit block — the
  shapes coord's migration classifier admits, so the PR is not parked. The
  open-queue index's predicate is ``OPEN_FOLLOWUP_SQL`` (the model's one
  spelling of "open"), the downgrade's ``_COLUMNS`` is the upgrade's
  ``ADD COLUMN`` sequence, and the revision declares exactly the constraints
  the model declares.
* **Model ≡ migration, through PostgreSQL.** ``conftest`` builds the shared
  test database from ``Base.metadata``, not alembic, so a constraint the model
  spells differently would be invisible to every API test. Each migrated
  constraint is compared with the MODEL's predicate re-declared on a probe
  table, by ``pg_get_constraintdef`` — PostgreSQL's own normalisation, so a
  reformatting cannot fail it and a real difference cannot pass it.
* **Every CHECK refuses its violating row**, each violation built to break
  exactly one constraint, and the valid shapes of every state are accepted.
* **The round trip**: down removes the columns, the table and the index and
  leaves pre-existing edges intact; up again restores them.

Substrate is ``tests/_alembic_harness``. A skip proves nothing — point it at a
live instance with ``QONTINUI_TEST_PG`` / ``QONTINUI_TEST_PG_DSN``.
"""

from __future__ import annotations

import re
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app.models.work_artifact import (
    FOLLOWUP_ANCHOR_CHECKS,
    FOLLOWUP_EDGE_CHECKS,
    OPEN_FOLLOWUP_SQL,
)
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REVISION_ID = "plan_library_11_followup_anchors_and_closure"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_OPEN_QUEUE_INDEX = "ix_work_artifact_edges_open_followup_queue_created_id"
_ANCHOR_INDEXES = (
    "uq_work_artifact_edge_anchors_edge_repo_path_line",
    "ix_work_artifact_edge_anchors_repo_path",
)


def _revision_path():
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """Parsed from the revision itself at runtime, never hardcoded — a rebase
    onto a newer head re-points ``down_revision`` and this follows it."""
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


def _upgrade_sql() -> list[str]:
    calls = upgrade_execute_calls(_revision_path())
    return [call.sql for call in calls if call.sql is not None]


# ───────────────────────────── static ─────────────────────────────


def test_the_parent_is_a_real_revision() -> None:
    parent = _parent_revision_id()
    versions = backend_root() / "alembic" / "versions"
    owners = [
        path.name
        for path in versions.glob("*.py")
        if re.search(
            rf'^revision[^=]*=\s*["\']{re.escape(parent)}["\']',
            path.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
    ]
    assert len(owners) == 1, (parent, owners)


def test_the_revision_id_is_unique_in_the_chain() -> None:
    versions = backend_root() / "alembic" / "versions"
    same_id = [
        path.name
        for path in versions.glob("*.py")
        if re.search(
            rf'^revision[^=]*=\s*["\']{re.escape(_REVISION_ID)}["\']',
            path.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
    ]
    assert same_id == [_REVISION_FILENAME]


def test_every_upgrade_execute_is_a_static_literal_in_the_right_block() -> None:
    """coord's classifier admits a static literal only, and a CONCURRENTLY
    build only inside ``autocommit_block`` (where it cannot run in the
    migration transaction)."""
    calls = upgrade_execute_calls(_revision_path())
    assert calls, "upgrade() executes nothing"
    assert all(call.sql is not None for call in calls), calls
    for call in calls:
        assert call.sql is not None
        concurrent = "CONCURRENTLY" in call.sql
        assert concurrent == call.in_autocommit_block, call
    assert sum("CONCURRENTLY" in (c.sql or "") for c in calls) == 1


def test_the_open_queue_index_predicate_is_the_models() -> None:
    """``OPEN_FOLLOWUP_SQL`` is the ONE spelling of "open"; the revision
    cannot import it (no revision imports ``app``) or interpolate it (the
    classifier refuses an f-string), so it is pinned equal here instead."""
    (build,) = [sql for sql in _upgrade_sql() if _OPEN_QUEUE_INDEX in sql]
    predicate = build.split(" WHERE ", 1)[1]
    assert " ".join(predicate.split()) == " ".join(OPEN_FOLLOWUP_SQL.split())


def test_the_downgrade_columns_are_the_upgrade_columns() -> None:
    added = [
        match
        for sql in _upgrade_sql()
        for match in re.findall(r"ADD COLUMN IF NOT EXISTS (\w+)", sql)
    ]
    module = load_revision_module(_revision_path(), "plan_library_11_under_test")
    assert tuple(added) == module._COLUMNS


def test_the_revision_declares_exactly_the_models_constraints() -> None:
    declared = {
        name for sql in _upgrade_sql() for name in re.findall(r"CONSTRAINT (\w+)", sql)
    }
    modelled = {name for name, _ in (*FOLLOWUP_EDGE_CHECKS, *FOLLOWUP_ANCHOR_CHECKS)}
    assert declared == modelled


def test_the_old_index_is_left_alone_on_the_upgrade_path() -> None:
    """A DROP on the upgrade path parks the PR on the classifier; the old
    index keeps serving the unclaimed walks (see the revision docstring)."""
    for sql in _upgrade_sql():
        assert "DROP" not in sql.upper(), sql


# ───────────────────────────── database ─────────────────────────────

_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG / QONTINUI_TEST_PG_DSN "
        "before running this test."
    ),
)

_CLOSURE_COLUMNS: dict[str, tuple[str, str]] = {
    "resolution": ("text", "YES"),
    "resolution_pr": ("text", "YES"),
    "resolution_commit": ("text", "YES"),
    "resolution_note": ("text", "YES"),
    "resolved_by": ("text", "YES"),
    "resolved_at": ("timestamp with time zone", "YES"),
    "resolution_history": ("jsonb", "NO"),
    "size_class": ("text", "YES"),
    "size_class_source": ("text", "YES"),
    "unanchored_reason": ("text", "YES"),
}

_ANCHOR_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("uuid", "NO"),
    "edge_id": ("uuid", "NO"),
    "repo": ("text", "NO"),
    "path": ("text", "NO"),
    "line_start": ("integer", "YES"),
    "line_end": ("integer", "YES"),
    "symbol": ("text", "YES"),
    "created_at": ("timestamp with time zone", "NO"),
}


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'agent' AND table_name = :table
                """
            ),
            {"table": table},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _index(engine: Engine, name: str) -> tuple[str, bool] | None:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT pg_get_indexdef(i.indexrelid), i.indisvalid "
                "FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'agent' AND c.relname = :name"
            ),
            {"name": name},
        ).first()
    return (str(row[0]), bool(row[1])) if row is not None else None


def _constraint_defs(engine: Engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conrelid = to_regclass(:table) AND contype = 'c'"
            ),
            {"table": f"agent.{table}"},
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _model_defs(
    engine: Engine, table: str, checks: tuple[tuple[str, str], ...]
) -> dict[str, str]:
    """The MODEL's predicates as PostgreSQL renders them: re-declared on a
    probe table shaped like ``table``, read back by ``pg_get_constraintdef``."""
    out: dict[str, str] = {}
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TEMP TABLE probe_{table} "
                f"(LIKE agent.{table} INCLUDING DEFAULTS) ON COMMIT DROP"
            )
        )
        for name, predicate in checks:
            conn.execute(
                text(
                    f"ALTER TABLE probe_{table} ADD CONSTRAINT probe_{name} "
                    f"CHECK ({predicate})"
                )
            )
            out[name] = conn.execute(
                text(
                    "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE conname = :name"
                ),
                {"name": f"probe_{name}"},
            ).scalar_one()
    return out


def _seed(engine: Engine) -> dict[str, str]:
    """Two artifacts and three edges: an OPEN follow-up, a CLAIMED follow-up
    and a two-ended ``depends_on``. Written at the PARENT revision, so they
    also prove the upgrade back-fills existing rows validly."""
    ids = {
        key: str(uuid4())
        for key in ("plan", "owner", "open_edge", "claimed_edge", "dep_edge")
    }
    with engine.begin() as conn:
        for key in ("plan", "owner"):
            conn.execute(
                text(
                    "INSERT INTO agent.work_artifacts "
                    "(id, kind, slug, content_sha256) "
                    "VALUES (:id, 'plan', :slug, 'sha')"
                ),
                {"id": ids[key], "slug": f"{key}-{ids[key][:8]}"},
            )
        conn.execute(
            text(
                "INSERT INTO agent.work_artifact_edges "
                "(id, from_id, to_id, relation, note) VALUES "
                "(:open, :plan, NULL, 'spawned_followup', 'open finding'), "
                "(:claimed, :plan, :owner, 'spawned_followup', 'claimed finding'), "
                "(:dep, :plan, :owner, 'depends_on', NULL)"
            ),
            {
                "open": ids["open_edge"],
                "claimed": ids["claimed_edge"],
                "dep": ids["dep_edge"],
                "plan": ids["plan"],
                "owner": ids["owner"],
            },
        )
    return ids


def _refused(engine: Engine, constraint: str, sql: str, **params: object) -> None:
    """``sql`` must be refused, by ``constraint`` and no other."""
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(text(sql), params)
    message = str(excinfo.value)
    assert f'"{constraint}"' in message, (constraint, message)


def _accepted(engine: Engine, sql: str, **params: object) -> None:
    """``sql`` must succeed; rolled back so each case starts from the seed."""
    with engine.connect() as conn:
        tx = conn.begin()
        conn.execute(text(sql), params)
        tx.rollback()


_SET_E1 = "UPDATE agent.work_artifact_edges SET {} WHERE id = :edge"


def _assert_edge_checks(engine: Engine, ids: dict[str, str]) -> None:
    edge = ids["open_edge"]

    # The VALID shape of every state is accepted — a CHECK that refused a
    # legal row would pass every negative case below.
    for assignment in (
        "resolution = 'fixing', resolution_pr = 'acme/widgets#12', "
        "resolved_at = now(), resolved_by = 'agent'",
        # ``fixed`` WITHOUT a commit: coord can report a land it holds no
        # commit for, and the verdict still stands (see the revision).
        "resolution = 'fixed', resolution_pr = 'acme/widgets#12', resolved_at = now()",
        "resolution = 'fixed', resolution_pr = 'acme/widgets#12', "
        "resolution_commit = '0123456789abcdef0123456789abcdef01234567', "
        "resolved_at = now()",
        "resolution = 'already_fixed', resolution_commit = 'abc1234', resolved_at = now()",
        "resolution = 'dismissed', resolution_note = 'not worth it', resolved_at = now()",
        "size_class = 'trivial', size_class_source = 'declared'",
        "size_class = 'plan_sized', size_class_source = 'sweep'",
        "unanchored_reason = 'no file named in the note'",
        'resolution_history = \'[{"from": "open", "to": "fixing"}]\'::jsonb',
    ):
        _accepted(engine, _SET_E1.format(assignment), edge=edge)

    cases: list[tuple[str, str, str]] = [
        (
            "ck_work_artifact_edges_followup_only_columns",
            "unanchored_reason = 'a reason on a two-ended edge'",
            ids["dep_edge"],
        ),
        (
            "ck_work_artifact_edges_resolution",
            "resolution = 'bogus', resolved_at = now()",
            edge,
        ),
        (
            "ck_work_artifact_edges_resolution_unclaimed",
            "resolution = 'dismissed', resolution_note = 'x', resolved_at = now()",
            ids["claimed_edge"],
        ),
        (
            "ck_work_artifact_edges_resolution_pr_shape",
            "resolution = 'fixing', resolution_pr = 'not a pr', resolved_at = now()",
            edge,
        ),
        (
            "ck_work_artifact_edges_resolution_commit_shape",
            "resolution = 'already_fixed', resolution_commit = 'NOTHEX99', "
            "resolved_at = now()",
            edge,
        ),
        (
            "ck_work_artifact_edges_resolution_pr_required",
            "resolution = 'fixing', resolved_at = now()",
            edge,
        ),
        (
            "ck_work_artifact_edges_resolution_commit_required",
            "resolution = 'already_fixed', resolved_at = now()",
            edge,
        ),
        (
            "ck_work_artifact_edges_resolved_at_required",
            "resolution = 'dismissed', resolution_note = 'x'",
            edge,
        ),
        (
            "ck_work_artifact_edges_dismissed_reason",
            "resolution = 'dismissed', resolution_note = E'\\t \\n', "
            "resolved_at = now()",
            edge,
        ),
        (
            "ck_work_artifact_edges_open_carries_no_resolution",
            "resolution_pr = 'acme/widgets#12'",
            edge,
        ),
        (
            "ck_work_artifact_edges_resolution_history_array",
            "resolution_history = '{}'::jsonb",
            edge,
        ),
        (
            "ck_work_artifact_edges_size_class",
            "size_class = 'huge', size_class_source = 'declared'",
            edge,
        ),
        (
            "ck_work_artifact_edges_size_class_source",
            "size_class = 'small', size_class_source = 'guess'",
            edge,
        ),
        (
            "ck_work_artifact_edges_size_class_paired",
            "size_class = 'small'",
            edge,
        ),
        (
            "ck_work_artifact_edges_unanchored_reason_nonblank",
            "unanchored_reason = E' \\n\\t'",
            edge,
        ),
    ]
    assert {name for name, _, _ in cases} == {name for name, _ in FOLLOWUP_EDGE_CHECKS}
    for constraint, assignment, target in cases:
        _refused(engine, constraint, _SET_E1.format(assignment), edge=target)


_ANCHOR_INSERT = (
    "INSERT INTO agent.work_artifact_edge_anchors "
    "(edge_id, repo, path, line_start, line_end, symbol) "
    "VALUES (:edge, :repo, :path, :line_start, :line_end, :symbol)"
)


def _anchor(edge: str, **over: object) -> dict[str, object]:
    row: dict[str, object] = {
        "edge": edge,
        "repo": "acme/widgets",
        "path": "backend/app/thing.py",
        "line_start": None,
        "line_end": None,
        "symbol": None,
    }
    row.update(over)
    return row


def _assert_anchor_checks(engine: Engine, ids: dict[str, str]) -> None:
    edge = ids["open_edge"]
    for over in (
        {},
        {"line_start": 3, "line_end": 3},
        {"line_start": 3, "line_end": 9, "symbol": "Thing.run"},
        {"repo": "acme.io/widgets_2-x", "path": "a b/c.d.ts"},
        {"path": ".github/workflows/ci.yml"},
    ):
        _accepted(engine, _ANCHOR_INSERT, **_anchor(edge, **over))

    shape = "ck_work_artifact_edge_anchors_path_shape"
    cases: list[tuple[str, dict[str, object]]] = [
        ("ck_work_artifact_edge_anchors_repo_shape", {"repo": "widgets"}),
        ("ck_work_artifact_edge_anchors_repo_shape", {"repo": "a/b/c"}),
        (shape, {"path": ""}),
        (shape, {"path": "/abs/path.py"}),
        (shape, {"path": "dir/"}),
        (shape, {"path": "a//b.py"}),
        (shape, {"path": "a\\b.py"}),
        (shape, {"path": "../escape.py"}),
        (shape, {"path": "a/../b.py"}),
        (shape, {"path": "./a.py"}),
        (shape, {"path": "a/./b.py"}),
        (shape, {"path": " lead.py"}),
        (shape, {"path": "trail.py "}),
        (shape, {"path": "new\nline.py"}),
        (shape, {"path": "del\x7f.py"}),
        (shape, {"path": "c1\x85.py"}),
        (shape, {"path": "x" * 1025}),
        ("ck_work_artifact_edge_anchors_lines", {"line_start": 0}),
        ("ck_work_artifact_edge_anchors_lines", {"line_end": 4}),
        ("ck_work_artifact_edge_anchors_lines", {"line_start": 9, "line_end": 4}),
        ("ck_work_artifact_edge_anchors_symbol_nonblank", {"symbol": "\t "}),
    ]
    assert {name for name, _ in cases} == {name for name, _ in FOLLOWUP_ANCHOR_CHECKS}
    for constraint, over in cases:
        _refused(engine, constraint, _ANCHOR_INSERT, **_anchor(edge, **over))

    # One anchor per (follow-up, file, starting line), a line-less one included.
    with engine.begin() as conn:
        conn.execute(text(_ANCHOR_INSERT), _anchor(edge))
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(text(_ANCHOR_INSERT), _anchor(edge, symbol="other"))
    assert "uq_work_artifact_edge_anchors_edge_repo_path_line" in str(excinfo.value)

    # Deleting the follow-up deletes its anchors.
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM agent.work_artifact_edges WHERE id = :e"), {"e": edge}
        )
        left = conn.execute(
            text(
                "SELECT count(*) FROM agent.work_artifact_edge_anchors "
                "WHERE edge_id = :e"
            ),
            {"e": edge},
        ).scalar_one()
    assert left == 0


@_PG_SKIP
def test_upgrade_shape_fences_and_round_trip() -> None:
    root = backend_root()
    parent = _parent_revision_id()

    with ephemeral_database(admin_database_url(), "planlib_followup_closure") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", parent)
        assert not table_exists(engine, "agent", "work_artifact_edge_anchors")
        ids = _seed(engine)

        run_alembic(root, url, "upgrade", _REVISION_ID)

        # ── shape ──
        columns = _columns(engine, "work_artifact_edges")
        for name, expected in _CLOSURE_COLUMNS.items():
            assert columns.get(name) == expected, name
        assert _columns(engine, "work_artifact_edge_anchors") == _ANCHOR_COLUMNS
        with engine.connect() as conn:
            histories = (
                conn.execute(
                    text(
                        "SELECT DISTINCT resolution_history::text "
                        "FROM agent.work_artifact_edges"
                    )
                )
                .scalars()
                .all()
            )
        # Existing rows took the constant default — no NULL, no backfill.
        assert histories == ["[]"]

        queue = _index(engine, _OPEN_QUEUE_INDEX)
        assert queue is not None and queue[1], queue
        assert "(created_at, id)" in queue[0]
        assert "resolution IS NULL" in queue[0] and "to_id IS NULL" in queue[0]
        for name in _ANCHOR_INDEXES:
            built = _index(engine, name)
            assert built is not None and built[1], name
        assert "UNIQUE" in (_index(engine, _ANCHOR_INDEXES[0]) or ("", False))[0]
        # The pre-existing unclaimed-walk index is untouched.
        assert _index(engine, "ix_work_artifact_edges_open_followups_created_id")

        # ── model ≡ migration, by PostgreSQL's normalisation ──
        migrated_edges = _constraint_defs(engine, "work_artifact_edges")
        modelled_edges = _model_defs(
            engine, "work_artifact_edges", FOLLOWUP_EDGE_CHECKS
        )
        for name, definition in modelled_edges.items():
            assert migrated_edges.get(name) == definition, name
        migrated_anchors = _constraint_defs(engine, "work_artifact_edge_anchors")
        modelled_anchors = _model_defs(
            engine, "work_artifact_edge_anchors", FOLLOWUP_ANCHOR_CHECKS
        )
        assert migrated_anchors == modelled_anchors

        # ── every fence refuses its violating row ──
        _assert_edge_checks(engine, ids)
        _assert_anchor_checks(engine, ids)

        # ── reversal ──
        ids = _seed(engine)
        run_alembic(root, url, "downgrade", parent)
        assert not table_exists(engine, "agent", "work_artifact_edge_anchors")
        assert _index(engine, _OPEN_QUEUE_INDEX) is None
        columns = _columns(engine, "work_artifact_edges")
        assert not set(_CLOSURE_COLUMNS) & set(columns), sorted(columns)
        with engine.connect() as conn:
            kept = conn.execute(
                text(
                    "SELECT count(*) FROM agent.work_artifact_edges "
                    "WHERE id IN (:a, :b, :c)"
                ),
                {"a": ids["open_edge"], "b": ids["claimed_edge"], "c": ids["dep_edge"]},
            ).scalar_one()
        assert kept == 3

        # ── and back up ──
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "agent", "work_artifact_edge_anchors")
        assert _index(engine, _OPEN_QUEUE_INDEX) is not None
