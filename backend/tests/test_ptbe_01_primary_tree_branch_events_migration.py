"""Structural and round-trip test for the ``ptbe_01_primary_tree_branch_events``
revision — Phase 2 of plan
``2026-08-28-shared-checkout-branch-provenance-and-reclaim-signal``.

Why this file exists
====================

Phase 2's own gate reads *"migration applies cleanly against a fresh
``coord_test`` DB; a hand-inserted row round-trips through the query in Phase
4"*. The second half is coord's and shipped with qontinui-coord#1836. **The
first half was never mechanized in this repo.** qontinui-web#1218 verified
``scripts/ci/count_alembic_heads.py`` and ``ruff`` — a head count and a linter,
neither of which executes a line of the DDL — and landed (fast-forward, so
GitHub shows it CLOSED with ``mergedAt: null``) with the table's whole contract
resting on prose in its docstring. This test is that missing half.

Everything asserted below is a claim the revision's own docstring makes about
itself. None of them is checked by anything else: ``migration-reversal.yml``
proves only up → down → up and is explicitly non-gating,
``alembic-heads-pr`` counts heads, and ``forbid-public-schema`` excludes
``backend/alembic/versions/`` wholesale.

What is asserted, and why each one can fail silently otherwise
==============================================================

Without a database (always runs, including on a box with no Postgres):

1. **Chain wiring, and the docstring agreeing with it.** The parent is read
   FROM the module rather than pinned to a literal — coord re-points
   ``down_revision`` at the live head at land time, and this revision was
   re-pointed **twice** (``e88a201cc`` onto ``reqchk_walk_01``, then
   ``0c1aea0f6`` onto ``remote_attach_01``). What IS pinned is coherence: the
   parent names exactly one real sibling, and the docstring's ``Revises:``
   header agrees with the assignment. That header has ALREADY drifted from the
   assignment once here — commit ``ccc9f994c``, *"the chaining note named the
   parent the re-point replaced"* — and a stale ``Revises:`` is what a reader
   reconstructing the chain by eye believes.

2. **Every DDL statement is ``coord.``-qualified.** This revision is raw
   ``op.execute`` SQL, not ``op.create_table``, so the ``schema="coord"``
   keyword the ``alembic-schema-arg-gate`` pre-commit hook looks for does not
   apply to it at all, and ``forbid-public-schema`` skips this directory. An
   unqualified ``CREATE TABLE primary_tree_branch_events`` would land the
   table in ``public`` on a fresh database, and every assertion coord makes
   about ``coord.primary_tree_branch_events`` would meet a missing relation.

3. **The only DROP lives inside ``downgrade()``** — asserted by walking the AST
   and by running ``scripts/ci/check_coord_column_drops.py``'s own scanner over
   the source. That guard scans the whole module MINUS the ``downgrade()``
   body, so a DROP hoisted into a helper or a module-level SQL string would
   make this revision block on the very gate its sibling table serves.

4. **No CHECK constraint is written anywhere in the upgrade path.** The
   docstring calls this "deliberate" for ``terminal_outcome`` and states the
   same posture for ``created_via``. A CHECK is the one addition that reads as
   tightening and is in fact the defect (see 9 below).

With a database (skipped when none is reachable — see the warning below):

5. **All eleven columns land with the declared type, nullability and default.**
   coord reads them positionally by name; a widened or renamed column is a
   runtime error inside the sweep, not a migration failure.

6. **``device_id`` has the FK to ``coord.devices`` with ON DELETE CASCADE, and
   ``tenant_id`` / ``agent_session_id`` have NO foreign key at all.** All three
   are load-bearing and pull in opposite directions. The docstring's reasoning:
   a deregistered device's provenance goes with it, but an ``ON DELETE
   CASCADE`` from ``coord.tenants`` would erase provenance history as a side
   effect of tenant administration — and ``agent_session_id`` is an
   unverifiable self-reported claim that "must never be able to fail an
   insert". A later migration adding either FK compiles, migrates and passes
   every other gate.

7. **``idx_ptbe_open`` is PARTIAL on ``terminal_outcome IS NULL``.** Dropping
   the predicate leaves a working index and a correct sweep — and an index that
   grows with the whole append-only log instead of with the open set. Nothing
   fails; it just gets slower forever. The DESC ordering of
   ``idx_ptbe_device_repo_observed`` is pinned for the same reason: without it
   the "latest event for this checkout" read still returns the right row, by
   scanning.

8. **The table is APPEND-ONLY: two events for the same
   ``(device_id, repo, branch)`` coexist.** This is the entire difference from
   ``coord.primary_trees``, which holds exactly one row per ``(device_id,
   repo)`` and is overwritten every publisher tick. A unique constraint added
   later would silently turn the event log back into the current-state upsert
   whose amnesia this plan exists to fix, and every individual insert would
   still succeed.

9. **The vocabulary is ``landed`` / ``closed_unmerged``, and the column takes
   an unknown value too.** The docstring calls the vocabulary "the single most
   important line in this migration": ``landed`` is
   ``pr_state = 'merged' OR close_cause = ANY(PR_LAND_CAUSES)``, because coord
   fast-forward-lands and GitHub closes the majority of coord's own lands with
   ``merged == false`` — a ``pr_merged``/``pr_closed`` split would mislabel
   every one of them as abandoned. The no-CHECK posture is what makes a
   *widened* ``PR_LAND_CAUSES`` readable without a schema change in another
   repo, so the test inserts a value from neither the current vocabulary nor
   any other and asserts it is accepted. Asserting only that the two known
   values work would pass just as happily against a CHECK that pins the wrong
   pair forever.

10. **``created_via`` ships exactly one value.** ``'checkout_guard_observed'``
    is the only writer this plan lands; the docstring forbids a second value
    without its writer (the ``agent_worktrees.work_unit_id`` failure — a column
    that sat unwritten from 2026-06-26). Asserted against the revision's own
    SQL comment rather than against a copy of the string.

11. **``agent_session_id`` NULL is a normal outcome**, not an error: a
    hand-typed ``git checkout -b`` at a terminal identifies no session.

12. **``upgrade()`` is idempotent** (its documented claim — every statement
    carries ``IF NOT EXISTS``), and **up → down → up leaves no residue and
    spares a neighbouring ``coord.*`` table.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the one
accepting the test credentials. Use that variable, **not** ``DATABASE_URL``:
``conftest.py`` overwrites ``os.environ["DATABASE_URL"]`` unconditionally at
import time from ``QONTINUI_TEST_PG``.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from pathlib import Path

import pytest
import sqlalchemy
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "ptbe_01_primary_tree_branch_events"
_REVISION_FILENAME = "ptbe_01_primary_tree_branch_events.py"

_SCHEMA = "coord"
_TABLE = "primary_tree_branch_events"

_IDX_OBSERVED = "idx_ptbe_device_repo_observed"
_IDX_OPEN = "idx_ptbe_open"

# The one value Phase 3's writer emits. Pinned as a literal so a rename in the
# revision reddens this test instead of moving with it.
_CREATED_VIA = "checkout_guard_observed"

# `TerminalPrOutcome`'s two variants, lowercased
# (qontinui-coord/crates/coord/src/data/repo_branches.rs).
_TERMINAL_LANDED = "landed"
_TERMINAL_CLOSED_UNMERGED = "closed_unmerged"

# Spelled out so the wrong split is visible in this file rather than only in the
# revision's prose. If either of these ever becomes a legal value, D3 has been
# reverted and the sweep mislabels every coord fast-forward land.
_FORBIDDEN_VOCABULARY = ("pr_merged", "pr_closed")

# (name, information_schema data_type, nullable, default-substring or None)
_EXPECTED_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("device_id", "uuid", False, None),
    ("repo", "text", False, None),
    ("branch", "text", False, None),
    ("agent_session_id", "text", True, None),
    ("created_via", "text", False, None),
    ("observed_created_at", "timestamp with time zone", False, "now()"),
    ("terminal_outcome", "text", True, None),
    ("terminal_pr_number", "integer", True, None),
    ("terminal_observed_at", "timestamp with time zone", True, None),
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


# ---------------------------------------------------------------------------
# source helpers
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _parent_revision_id() -> str:
    parent = _revision_module().down_revision
    assert isinstance(parent, str) and parent, "down_revision must name ONE parent"
    return parent


def _module_tree() -> ast.Module:
    return ast.parse(_revision_source(), filename=str(_revision_path()))


def _function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _op_calls(node: ast.AST) -> list[ast.Call]:
    """Every ``op.<something>(...)`` call under ``node``."""
    return [
        sub
        for sub in ast.walk(node)
        if isinstance(sub, ast.Call)
        and isinstance(sub.func, ast.Attribute)
        and isinstance(sub.func.value, ast.Name)
        and sub.func.value.id == "op"
    ]


def _docstring_node_ids(tree: ast.Module) -> set[int]:
    """The ids of every docstring Constant — prose, which the guard skips too."""
    owners: list[ast.AST] = [
        tree,
        *[n for n in tree.body if isinstance(n, ast.FunctionDef)],
    ]
    return {
        id(node.body[0].value)  # type: ignore[attr-defined,union-attr]
        for node in owners
        if getattr(node, "body", None)
        and isinstance(node.body[0], ast.Expr)  # type: ignore[attr-defined]
        and isinstance(node.body[0].value, ast.Constant)  # type: ignore[attr-defined]
        and isinstance(node.body[0].value.value, str)  # type: ignore[attr-defined]
    }


def _sql_literals(fn: ast.FunctionDef, tree: ast.Module) -> list[str]:
    """Every non-docstring string constant inside ``fn`` — i.e. its SQL."""
    docstrings = _docstring_node_ids(tree)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and id(node) not in docstrings
    ]


# ---------------------------------------------------------------------------
# 1. chain wiring, and the docstring agreeing with it
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    parent = _parent_revision_id()
    assert parent != "head", "down_revision must be a concrete revision id"

    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']', re.M
    )
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {parent!r} must name exactly one existing sibling revision "
        f"(found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    """``ccc9f994c`` is this revision's own precedent for the header drifting."""
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_parent_revision_id())}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. every DDL statement is coord.-qualified
# ---------------------------------------------------------------------------


def test_upgrade_is_three_op_execute_calls_and_every_object_is_coord_qualified() -> (
    None
):
    tree = _module_tree()
    upgrade = _function(tree, "upgrade")

    calls = [c.func.attr for c in _op_calls(upgrade)]  # type: ignore[attr-defined]
    assert calls == ["execute", "execute", "execute"], (
        "upgrade() is one CREATE TABLE and two CREATE INDEXes, all raw SQL. "
        f"It now calls: {calls}"
    )

    sql = "\n".join(_sql_literals(upgrade, tree))
    assert re.search(
        rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", sql, re.I
    ), (
        "the CREATE TABLE must name the coord schema explicitly: this revision "
        'is raw op.execute, so the schema="coord" keyword the '
        "alembic-schema-arg-gate looks for does not apply, and an unqualified "
        "name lands the table in public"
    )
    for index in (_IDX_OBSERVED, _IDX_OPEN):
        assert re.search(
            rf"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+{index}\s+ON\s+{_SCHEMA}\.{_TABLE}\b",
            sql,
            re.I,
        ), f"{index} must be created ON {_SCHEMA}.{_TABLE}"

    # Nothing in the upgrade path may name a bare (unqualified) relation.
    for match in re.finditer(r"\b(?:CREATE\s+TABLE|ON)\s+(\w+)\s*\(", sql, re.I):
        assert match.group(1) != _TABLE, (
            f"unqualified reference to {_TABLE!r} in the upgrade path: {match.group(0)!r}"
        )


# ---------------------------------------------------------------------------
# 3. the only DROP lives inside downgrade()
# ---------------------------------------------------------------------------


def test_every_drop_is_inside_downgrade() -> None:
    tree = _module_tree()
    downgrade = _function(tree, "downgrade")

    dropped = "\n".join(_sql_literals(downgrade, tree))
    assert re.search(
        rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", dropped, re.I
    )
    for index in (_IDX_OBSERVED, _IDX_OPEN):
        assert re.search(
            rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{_SCHEMA}\.{index}\b", dropped, re.I
        ), f"downgrade() must drop {_SCHEMA}.{index} (schema-qualified)"

    downgrade_span = range(
        downgrade.lineno, (downgrade.end_lineno or downgrade.lineno) + 1
    )
    docstrings = _docstring_node_ids(tree)
    for node in ast.walk(tree):
        if getattr(node, "lineno", None) in downgrade_span:
            continue
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and id(node) not in docstrings
        ):
            assert not re.search(
                r"\b(DROP\s+TABLE|DROP\s+INDEX|DROP\s+COLUMN|ALTER\s+TABLE"
                r"|RENAME\s+(COLUMN|TO)|SET\s+SCHEMA)\b",
                node.value,
                re.I,
            ), (
                f"a DROP/RENAME SQL token outside downgrade() at line {node.lineno}: "
                "the column-drop guard would read it as an upgrade-path drop"
            )


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    """The revision's own structural claim, checked with the guard's own scanner."""
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, (
        "the guard now reads an upgrade-path coord drop in this revision: "
        f"{[(d.table, d.column) for d in scan.drops]}"
    )
    assert not scan.unresolved, (
        "the guard now reads an UNRESOLVED drop site here, which is a violation "
        f"on its own before any manifest is consulted: {scan.unresolved}"
    )
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 4. no CHECK anywhere in the upgrade path; created_via ships one value
# ---------------------------------------------------------------------------


def test_the_upgrade_path_writes_no_check_constraint() -> None:
    """``terminal_outcome`` and ``created_via`` are free-form TEXT, deliberately.

    A CHECK here reads as tightening and is the defect: it is precisely what
    stops a widened ``PR_LAND_CAUSES`` — or Phase 3's second observation path —
    from being storable without a migration in another repo.
    """
    tree = _module_tree()
    sql = "\n".join(_sql_literals(_function(tree, "upgrade"), tree))
    # `CHECK (` rather than a bare `CHECK`, so the word may still appear in an
    # explanatory SQL comment.
    assert not re.search(r"\bCHECK\s*\(", sql, re.I), (
        "a CHECK constraint appeared in the upgrade path; terminal_outcome and "
        "created_via are deliberately unconstrained (see the revision docstring)"
    )


def test_created_via_ships_exactly_one_value() -> None:
    tree = _module_tree()
    sql = "\n".join(_sql_literals(_function(tree, "upgrade"), tree))
    assert _CREATED_VIA in sql, (
        f"the revision no longer names {_CREATED_VIA!r}, the only value Phase 3 writes"
    )
    assert "manual_report" not in sql, (
        "`manual_report` has no writer in any phase of this plan; a value with "
        "no writer is the agent_worktrees.work_unit_id failure. Add it in the "
        "same PR as the door that emits it, or not at all."
    )


def test_the_forbidden_terminal_vocabulary_is_absent_from_the_ddl() -> None:
    tree = _module_tree()
    sql = "\n".join(_sql_literals(_function(tree, "upgrade"), tree))
    for forbidden in _FORBIDDEN_VOCABULARY:
        assert forbidden not in sql, (
            f"{forbidden!r} in the DDL: a merged-vs-closed split mislabels every "
            "coord fast-forward land as an abandoned branch (D3)"
        )


# ---------------------------------------------------------------------------
# 5-12. against a real Postgres
# ---------------------------------------------------------------------------


def _seed_device(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    """A tenant and a device to hang events off. Returns ``(tenant_id, device_id)``."""
    tenant_id = uuid.uuid4()
    device_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:tenant_id, :slug, :display_name)
                """
            ),
            {
                "tenant_id": tenant_id,
                "slug": f"ptbe-{tenant_id.hex[:12]}",
                "display_name": "ptbe test tenant",
            },
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.devices (device_id, tenant_id, name, hostname)
                VALUES (:device_id, :tenant_id, :name, :hostname)
                """
            ),
            {
                "device_id": device_id,
                "tenant_id": tenant_id,
                "name": "ptbe-test-device",
                "hostname": "ptbe-test-host",
            },
        )
    return tenant_id, device_id


def _insert_event(
    engine: Engine,
    *,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    repo: str = "qontinui-web",
    branch: str = "feat/x",
    agent_session_id: str | None = None,
    created_via: str = _CREATED_VIA,
    terminal_outcome: str | None = None,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO {_SCHEMA}.{_TABLE}
                    (tenant_id, device_id, repo, branch, agent_session_id,
                     created_via, terminal_outcome)
                VALUES (:tenant_id, :device_id, :repo, :branch, :agent_session_id,
                        :created_via, :terminal_outcome)
                """
            ),
            {
                "tenant_id": tenant_id,
                "device_id": device_id,
                "repo": repo,
                "branch": branch,
                "agent_session_id": agent_session_id,
                "created_via": created_via,
                "terminal_outcome": terminal_outcome,
            },
        )


def _row_count(engine: Engine) -> int:
    return int(scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_TABLE}"))  # type: ignore[arg-type]


@_needs_pg
def test_table_lands_with_the_declared_shape() -> None:
    with ephemeral_database(admin_database_url(), "ptbe01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)

        for name, expected_type, nullable, default_fragment in _EXPECTED_COLUMNS:
            info = column_info(engine, _TABLE, name, schema=_SCHEMA)
            assert info is not None, f"{name} is missing"
            data_type, is_nullable, default = info
            assert data_type == expected_type, (name, info)
            assert (is_nullable == "YES") is nullable, (name, info)
            if default_fragment is None:
                assert default is None, (name, info)
            else:
                assert default is not None and default_fragment in default, (name, info)

        # No column beyond the eleven — an extra one means a reader somewhere is
        # consuming a shape this test does not describe.
        actual = scalar(
            engine,
            """
            SELECT count(*) FROM information_schema.columns
             WHERE table_schema = :schema AND table_name = :table
            """,
            schema=_SCHEMA,
            table=_TABLE,
        )
        assert int(actual) == len(_EXPECTED_COLUMNS)  # type: ignore[arg-type]

        # id is the primary key, alone.
        pk_cols = scalar(
            engine,
            """
            SELECT array_agg(a.attname ORDER BY array_position(i.indkey, a.attnum))
              FROM pg_index i
              JOIN pg_class c ON c.oid = i.indrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
             WHERE i.indisprimary AND n.nspname = :schema AND c.relname = :table
            """,
            schema=_SCHEMA,
            table=_TABLE,
        )
        assert list(pk_cols or []) == ["id"]  # type: ignore[arg-type]


@_needs_pg
def test_device_fk_cascades_and_tenant_and_session_carry_no_fk() -> None:
    with ephemeral_database(admin_database_url(), "ptbe01_fk") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        fks = scalar(
            engine,
            """
            SELECT coalesce(
                     jsonb_object_agg(col, jsonb_build_object(
                       'target', target, 'delete_action', delete_action)),
                     '{}'::jsonb)
              FROM (
                SELECT a.attname                          AS col,
                       tn.nspname || '.' || tc.relname    AS target,
                       con.confdeltype::text              AS delete_action
                  FROM pg_constraint con
                  JOIN pg_class c   ON c.oid  = con.conrelid
                  JOIN pg_namespace n  ON n.oid  = c.relnamespace
                  JOIN pg_class tc  ON tc.oid = con.confrelid
                  JOIN pg_namespace tn ON tn.oid = tc.relnamespace
                  JOIN pg_attribute a
                    ON a.attrelid = c.oid AND a.attnum = ANY (con.conkey)
                 WHERE con.contype = 'f'
                   AND n.nspname = :schema
                   AND c.relname = :table
              ) s
            """,
            schema=_SCHEMA,
            table=_TABLE,
        )
        assert isinstance(fks, dict)
        assert set(fks) == {"device_id"}, (
            "device_id is the ONLY foreign key. tenant_id must carry none — an "
            "ON DELETE CASCADE from coord.tenants would erase provenance as a "
            "side effect of tenant administration — and agent_session_id must "
            "carry none, because an unverifiable self-reported claim must never "
            f"be able to fail an insert. Found: {sorted(fks)}"
        )
        assert fks["device_id"]["target"] == "coord.devices"
        assert fks["device_id"]["delete_action"] == "c", (
            "device_id's FK must be ON DELETE CASCADE ('c'): a deregistered "
            "device's provenance rows describe a checkout that no longer exists"
        )

        # And the cascade actually fires.
        tenant_id, device_id = _seed_device(engine)
        _insert_event(engine, tenant_id=tenant_id, device_id=device_id)
        assert _row_count(engine) == 1
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.devices WHERE device_id = :d"),
                {"d": device_id},
            )
        assert _row_count(engine) == 0


@_needs_pg
def test_the_open_index_is_partial_and_the_observed_index_is_descending() -> None:
    with ephemeral_database(admin_database_url(), "ptbe01_idx") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _IDX_OBSERVED, schema=_SCHEMA)
        assert index_exists(engine, _IDX_OPEN, schema=_SCHEMA)

        def indexdef(name: str) -> str:
            return str(
                scalar(
                    engine,
                    "SELECT indexdef FROM pg_indexes "
                    "WHERE schemaname = :schema AND indexname = :idx",
                    schema=_SCHEMA,
                    idx=name,
                )
            )

        open_def = indexdef(_IDX_OPEN)
        assert re.search(
            r"WHERE\s*\(?\s*terminal_outcome\s+IS\s+NULL", open_def, re.I
        ), (
            "idx_ptbe_open must stay PARTIAL. Without the predicate the sweep is "
            "still correct and the index grows with the whole append-only log "
            f"instead of with the open set: {open_def}"
        )
        assert re.search(r"\(\s*repo\s*,\s*branch\s*\)", open_def), open_def

        observed_def = indexdef(_IDX_OBSERVED)
        assert re.search(
            r"\(\s*device_id\s*,\s*repo\s*,\s*observed_created_at\s+DESC\s*\)",
            observed_def,
            re.I,
        ), (
            "idx_ptbe_device_repo_observed must keep the DESC ordering — it is "
            f"what makes the 'latest event' read land on one row: {observed_def}"
        )
        assert "WHERE" not in observed_def.upper(), (
            f"idx_ptbe_device_repo_observed must NOT be partial: {observed_def}"
        )


@_needs_pg
def test_the_log_is_append_only_for_the_same_device_repo_branch() -> None:
    """The whole difference from ``coord.primary_trees``' one-row-per-key upsert."""
    with ephemeral_database(admin_database_url(), "ptbe01_append") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id, device_id = _seed_device(engine)

        for _ in range(3):
            _insert_event(
                engine,
                tenant_id=tenant_id,
                device_id=device_id,
                repo="qontinui-web",
                branch="feat/same-branch-twice",
            )
        assert _row_count(engine) == 3, (
            "three observations of the same (device, repo, branch) must produce "
            "three rows; a unique constraint here turns the event log back into "
            "the current-state upsert whose amnesia this plan exists to fix"
        )

        # Distinct surrogate ids, defaulted server-side.
        distinct_ids = scalar(
            engine, f"SELECT count(DISTINCT id) FROM {_SCHEMA}.{_TABLE}"
        )
        assert int(distinct_ids) == 3  # type: ignore[arg-type]


@_needs_pg
@pytest.mark.parametrize(
    "outcome",
    [
        pytest.param(None, id="not-yet-terminal"),
        pytest.param(_TERMINAL_LANDED, id="landed"),
        pytest.param(_TERMINAL_CLOSED_UNMERGED, id="closed-unmerged"),
        # The no-CHECK posture itself: a value the vocabulary does not carry
        # today must still store, or a widened PR_LAND_CAUSES needs a migration
        # in another repo to be readable.
        pytest.param("landed_via_some_future_cause", id="unknown-future-value"),
    ],
)
def test_terminal_outcome_is_free_form_text(outcome: str | None) -> None:
    with ephemeral_database(admin_database_url(), "ptbe01_vocab") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id, device_id = _seed_device(engine)
        _insert_event(
            engine,
            tenant_id=tenant_id,
            device_id=device_id,
            terminal_outcome=outcome,
        )
        stored = scalar(engine, f"SELECT terminal_outcome FROM {_SCHEMA}.{_TABLE}")
        assert stored == outcome


@_needs_pg
def test_null_session_id_is_normal_and_tenant_id_is_required() -> None:
    with ephemeral_database(admin_database_url(), "ptbe01_nulls") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id, device_id = _seed_device(engine)

        # A hand-typed `git checkout -b` names no session. Not an error.
        _insert_event(
            engine, tenant_id=tenant_id, device_id=device_id, agent_session_id=None
        )
        assert _row_count(engine) == 1

        # ...and a self-reported id that matches no session anywhere still stores,
        # because there is no FK to fail against.
        _insert_event(
            engine,
            tenant_id=tenant_id,
            device_id=device_id,
            agent_session_id="not-a-uuid-and-names-no-session",
        )
        assert _row_count(engine) == 2

        # tenant_id is resolved server-side and NOT NULL: a tenant-blind caller
        # cannot write this table.
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"""
                        INSERT INTO {_SCHEMA}.{_TABLE}
                            (device_id, repo, branch, created_via)
                        VALUES (:device_id, 'qontinui-web', 'b', :created_via)
                        """
                    ),
                    {"device_id": device_id, "created_via": _CREATED_VIA},
                )


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    """Every statement carries ``IF NOT EXISTS`` — the revision's own claim.

    ``stamp`` back to the parent and re-``upgrade`` re-runs ``upgrade()``
    against a database that already has the table and both indexes, which is the
    only way alembic will replay it.
    """
    with ephemeral_database(admin_database_url(), "ptbe01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id, device_id = _seed_device(engine)
        _insert_event(engine, tenant_id=tenant_id, device_id=device_id)

        run_alembic(backend_root(), db_url, "stamp", _parent_revision_id())
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _IDX_OBSERVED, schema=_SCHEMA)
        assert index_exists(engine, _IDX_OPEN, schema=_SCHEMA)
        assert _row_count(engine) == 1, "the re-run must not disturb existing rows"


@_needs_pg
def test_up_down_up_leaves_no_residue_and_spares_neighbours() -> None:
    with ephemeral_database(admin_database_url(), "ptbe01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id, device_id = _seed_device(engine)
        _insert_event(engine, tenant_id=tenant_id, device_id=device_id)

        # The current-state table this one sits beside; the walk must not touch it.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.primary_trees
                        (device_id, repo, branch, head_sha, dirty)
                    VALUES (:device_id, 'qontinui-web', 'main', :head_sha, false)
                    """
                ),
                {"device_id": device_id, "head_sha": "0" * 40},
            )

        run_alembic(backend_root(), db_url, "downgrade", _parent_revision_id())
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, _IDX_OBSERVED, schema=_SCHEMA)
        assert not index_exists(engine, _IDX_OPEN, schema=_SCHEMA)
        assert (
            int(scalar(engine, "SELECT count(*) FROM coord.primary_trees"))  # type: ignore[arg-type]
            == 1
        ), "downgrade touched a neighbouring coord.* table"

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _IDX_OBSERVED, schema=_SCHEMA)
        assert index_exists(engine, _IDX_OPEN, schema=_SCHEMA)
        assert _row_count(engine) == 0, "the table comes back empty, not restored"
