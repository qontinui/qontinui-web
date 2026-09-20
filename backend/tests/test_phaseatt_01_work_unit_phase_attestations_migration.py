"""Structural and round-trip test for alembic ``phaseatt_01``.

Plan ``2026-09-20-coord-delivery-has-no-verb-for-a-phase-that-ships-no-pr``
Phase 2. ``coord.work_unit_phase_attestations`` is the contract coord's
``delivery_view`` (plan Phase 3) codes against, so the properties its safety
argument rests on are pinned here rather than in prose:

* the identity key — re-attesting the same evidence collides with the existing
  row instead of accumulating a second one, which is the ONLY reason a
  retraction is durable: a re-attest cannot route around a correction it is
  forced to collide with;
* ``phase_index`` 0 is an ordinary key value, not an absence;
* ``evidence_min_version`` is NULLABLE and its NULL is a real value ("this kind
  has no version axis"), not a missing observation;
* the ``ON DELETE CASCADE`` back to ``coord.work_units``, so an attestation
  cannot outlive the unit it describes.

**This test deliberately does NOT pin the parent revision.** ``down_revision``
is re-pointed at the merged head at land time (this directory's convention, and
mandatory here: ``origin/main`` carried FOUR heads when this revision was
authored). A test asserting a specific ``down_revision`` fails on every such
re-point and wedges coord's rebase. What is asserted instead is that the chain
is WELL-FORMED — exactly one parent, named as a plain string, resolving to
exactly one existing sibling file — and that the ``Revises:`` docstring line
agrees with whatever that parent currently is. Both survive a re-point; both
catch a half-done one.

Without a database (always runs):

1. Chain wiring: one parent, a real sibling, no branch labels, and a
   ``Revises:`` header that agrees with the declared parent.
2. Every DDL object is ``coord.``-qualified, the only DROPs are in
   ``downgrade()``, and the column-drop guard reads the upgrade path as
   dropping nothing.
3. Both directions are pure ``op.execute`` with static SQL, the upgrade DDL is
   ``IF NOT EXISTS`` throughout, and the vocabulary column carries no CHECK.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Column types, nullability and defaults; the primary key; both index
   definitions, including ``NULLS NOT DISTINCT`` read out of ``pg_index``
   rather than pattern-matched on ``indexdef``.
5. The dedupe index refuses a second identical attestation and NOTHING else —
   another phase (0 included), another kind, another ref, another unit all
   coexist — and a retraction is an UPDATE on the colliding row.
6. ``ON DELETE CASCADE`` from ``coord.work_units``, and every ``NOT NULL``.
7. The table and column comments land as the source writes them.
8. ``upgrade()`` is idempotent, and up, down, up leaves no residue while
   ``coord.work_units`` survives the downgrade.
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
    column_comment,
    comment_body_from_source,
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

_REVISION_ID = "phaseatt_01"
_REVISION_FILENAME = "phaseatt_01_work_unit_phase_attestations.py"

_SCHEMA = "coord"
_TABLE = "work_unit_phase_attestations"
_DEDUPE_INDEX = "uq_work_unit_phase_attestations_dedupe"
_UNIT_INDEX = "idx_work_unit_phase_attestations_work_unit"

# (name, information_schema data_type, nullable, default-substring or None)
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", True, None),
    ("work_unit_id", "uuid", False, None),
    ("phase_index", "integer", False, None),
    ("evidence_kind", "text", False, None),
    ("evidence_ref", "text", False, None),
    ("evidence_min_version", "integer", True, None),
    ("note", "text", True, None),
    ("attested_by", "text", False, None),
    ("attested_at", "timestamp with time zone", False, "now()"),
    ("retracted_at", "timestamp with time zone", True, None),
    ("retracted_by", "text", True, None),
    ("retraction_reason", "text", True, None),
)

_COMMENTED_COLUMNS = (
    "phase_index",
    "evidence_kind",
    "evidence_ref",
    "evidence_min_version",
    "attested_by",
    "retracted_at",
)

_NOT_NULL_COLUMNS = (
    "work_unit_id",
    "phase_index",
    "evidence_kind",
    "evidence_ref",
    "attested_by",
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
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


def _declared_parent() -> str:
    """The parent this revision currently names — READ, never pinned."""
    parent = _revision_module().down_revision
    assert isinstance(parent, str) and parent, (
        f"down_revision is {parent!r}; this revision takes exactly one parent, "
        "named as a plain string (a tuple would make it a merge revision)"
    )
    return parent


def _tree() -> ast.Module:
    return ast.parse(_revision_source(), filename=str(_revision_path()))


def _function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    """Every string constant inside ``fn`` except its own docstring."""
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


# ---------------------------------------------------------------------------
# 1. chain wiring — well-formed, NOT pinned
# ---------------------------------------------------------------------------


def test_revision_id_is_wired() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None


def test_the_declared_parent_is_exactly_one_real_sibling() -> None:
    """The parent must RESOLVE; which revision it is stays unpinned.

    A land-time re-point changes the token and must keep passing here. What
    would not keep passing is a re-point onto a revision that does not exist,
    or onto an id two files declare — both of which break
    ``alembic upgrade head`` in ways the head counter cannot see.
    """
    parent = _declared_parent()
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
        f"down_revision {parent!r} must name exactly one existing sibling "
        f"(found {[f.name for f in siblings]})"
    )


def test_docstring_header_agrees_with_the_declared_parent() -> None:
    """Catches a half-done re-point: the token moved, the header did not."""
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    parent = _declared_parent()
    assert re.search(rf"^Revises: {re.escape(parent)}$", source, re.M), (
        f"the docstring's `Revises:` line does not name {parent!r}; a re-point "
        "edits the down_revision token AND that line (and nothing in this test)"
    )


# ---------------------------------------------------------------------------
# 2. coord-qualified, and the only DROPs are in downgrade()
# ---------------------------------------------------------------------------

_TABLE_OBJECT_RE = re.compile(
    r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|REFERENCES"
    r"|COMMENT\s+ON\s+TABLE|COMMENT\s+ON\s+COLUMN)"
    r"(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
    re.I,
)
_INDEX_OBJECT_RE = re.compile(
    r"(?:CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\w+\s+ON"
    r"|DROP\s+INDEX(?:\s+IF\s+EXISTS)?)\s+([A-Za-z_.\"]+)",
    re.I,
)
_OWNED = (f"{_SCHEMA}.{_TABLE}", f"{_SCHEMA}.work_units")


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in _TABLE_OBJECT_RE.findall(sql):
                assert obj.startswith(_OWNED), (
                    f"{fn_name}(): object {obj!r} is not one of {_OWNED}"
                )
            for obj in _INDEX_OBJECT_RE.findall(sql):
                assert obj in (
                    f"{_SCHEMA}.{_TABLE}",
                    f"{_SCHEMA}.{_DEDUPE_INDEX}",
                    f"{_SCHEMA}.{_UNIT_INDEX}",
                ), f"{fn_name}(): index object {obj!r} is not coord-qualified"


def test_every_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down, re.I)
    for index in (_DEDUPE_INDEX, _UNIT_INDEX):
        assert re.search(
            rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{_SCHEMA}\.{index}\b", down, re.I
        ), f"downgrade() must drop {index}"


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
# ---------------------------------------------------------------------------


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    tree = _tree()
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "no op calls found"
    assert {c.func.attr for c in calls} == {"execute"}  # type: ignore[attr-defined]
    for call in calls:
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)


def test_upgrade_ddl_is_idempotent_and_the_dedupe_key_is_the_identity() -> None:
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    assert re.search(r"CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+coord\b", up, re.I)
    assert re.search(
        rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", up, re.I
    )
    assert re.search(
        rf"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+{_DEDUPE_INDEX}\s+ON\s+"
        rf"{_SCHEMA}\.{_TABLE}\s*\(work_unit_id,\s*phase_index,\s*evidence_kind,"
        r"\s*evidence_ref\)\s*NULLS\s+NOT\s+DISTINCT",
        up,
        re.I,
    ), "the identity key must be UNIQUE over the four evidence columns"
    assert re.search(
        rf"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+{_UNIT_INDEX}\s+ON\s+"
        rf"{_SCHEMA}\.{_TABLE}\s*\(work_unit_id\)",
        up,
        re.I,
    ), "the per-unit read index must exist"
    assert re.search(
        rf"REFERENCES\s+{_SCHEMA}\.work_units\(id\)\s+ON\s+DELETE\s+CASCADE", up, re.I
    ), "an attestation must not outlive its work unit"
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"
    # evidence_kind is a closed vocabulary enforced in Rust, deliberately not by
    # a CHECK — widening it must be a coord deploy, not a web migration ordered
    # ahead of one.
    assert not re.search(r"\bCHECK\s*\(", up, re.I), "vocabulary columns carry no CHECK"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------

_TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")


def _seed_work_unit(engine: Engine, slug: str) -> uuid.UUID:
    with engine.begin() as conn:
        row = conn.execute(
            text(
                "INSERT INTO coord.work_units (slug, tenant_id, status, title) "
                "VALUES (:slug, :tenant, 'in_progress', :title) RETURNING id"
            ),
            {"slug": slug, "tenant": _TENANT, "title": slug},
        ).one()
    assert isinstance(row[0], uuid.UUID)
    return row[0]


def _row(work_unit_id: uuid.UUID, **overrides: object) -> dict[str, object]:
    """A complete, valid attestation row, with ``overrides`` applied on top.

    Built as a dict rather than through keyword arguments so a test can null
    ANY column — ``work_unit_id`` and ``phase_index`` included — without
    colliding with a parameter name.
    """
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "work_unit_id": work_unit_id,
        "phase_index": 0,
        "evidence_kind": "finding",
        "evidence_ref": "b64bfc67-3ed5-411d-99d0-3171b1c360b3",
        "attested_by": "device:eb2155ed-4152-4a91-be82-5d4346f717fc",
    }
    params.update(overrides)
    return params


def _insert(engine: Engine, params: dict[str, object]) -> uuid.UUID:
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        row = conn.execute(
            text(f"INSERT INTO coord.{_TABLE} ({cols}) VALUES ({binds}) RETURNING id"),
            params,
        ).one()
    assert isinstance(row[0], uuid.UUID)
    return row[0]


def _attest(engine: Engine, work_unit_id: uuid.UUID, **overrides: object) -> uuid.UUID:
    return _insert(engine, _row(work_unit_id, **overrides))


def _count(engine: Engine) -> int:
    value = scalar(engine, f"SELECT count(*) FROM coord.{_TABLE}")
    assert isinstance(value, int)
    return value


def _columns(engine: Engine) -> dict[str, tuple[str, bool, str | None]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": _TABLE},
        ).all()
    return {r[0]: (r[1], r[2] == "YES", r[3]) for r in rows}


@_needs_pg
def test_table_shape_primary_key_and_both_indexes() -> None:
    with ephemeral_database(admin_database_url(), "phaseatt01_shape") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        got = _columns(engine)
        for name, data_type, nullable, default in _COLUMNS:
            assert name in got, f"coord.{_TABLE} is missing {name}"
            got_type, got_nullable, got_default = got[name]
            assert got_type == data_type, f"{name}: {got_type} != {data_type}"
            assert got_nullable is nullable, f"{name}: nullable {got_nullable}"
            if default is None:
                assert got_default is None, f"{name}: unexpected {got_default}"
            else:
                assert got_default is not None and default in got_default, (
                    f"{name}: default {got_default!r} lacks {default!r}"
                )
        assert set(got) == {c[0] for c in _COLUMNS}, f"unexpected columns: {set(got)}"

        assert (
            scalar(
                engine,
                f"""
                SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                  FROM pg_constraint c
                  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a
                    ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                 WHERE c.conrelid = 'coord.{_TABLE}'::regclass
                   AND c.contype = 'p'
                """,
            )
            == "id"
        )

        # NULLS NOT DISTINCT read out of the catalog, not pattern-matched on
        # indexdef: the property is what coord's identity argument rests on.
        flags = scalar(
            engine,
            """
            SELECT i.indisunique::text || ',' || i.indnullsnotdistinct::text
              FROM pg_index i
              JOIN pg_class c ON c.oid = i.indexrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = :schema AND c.relname = :idx
            """,
            schema=_SCHEMA,
            idx=_DEDUPE_INDEX,
        )
        assert flags == "true,true", (
            f"{_DEDUPE_INDEX}: (unique, nulls_not_distinct) = {flags!r}"
        )

        unit_index_def = scalar(
            engine,
            "SELECT indexdef FROM pg_indexes WHERE schemaname = :s AND indexname = :i",
            s=_SCHEMA,
            i=_UNIT_INDEX,
        )
        assert isinstance(unit_index_def, str)
        assert unit_index_def.startswith("CREATE INDEX"), unit_index_def
        assert unit_index_def.endswith("(work_unit_id)"), unit_index_def


@_needs_pg
def test_the_identity_key_refuses_a_duplicate_and_nothing_else() -> None:
    with ephemeral_database(admin_database_url(), "phaseatt01_ident") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "phaseatt-identity")
        other_unit = _seed_work_unit(engine, "phaseatt-identity-other")

        first = _attest(engine, unit)

        # The one thing the index exists to refuse.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
            _attest(engine, unit)
        diag = getattr(excinfo.value.orig, "diag", None)
        assert diag is not None and diag.constraint_name == _DEDUPE_INDEX

        # A different note or version does NOT make a new identity: those are
        # attributes OF an attestation, not part of one.
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _attest(engine, unit, note="re-said with a note", evidence_min_version=3)

        # Everything that IS a different attestation coexists. phase_index 1
        # beside phase_index 0 is the case that proves 0 is an ordinary key
        # value rather than an absence.
        _attest(engine, unit, phase_index=1)
        _attest(engine, unit, evidence_kind="prompt_document")
        _attest(engine, unit, evidence_ref="another-finding-id")
        _attest(engine, other_unit)
        assert _count(engine) == 5

        # A retraction is an UPDATE on the colliding row — never a delete, never
        # a second row — and re-attesting the same evidence afterwards still
        # collides, so the correction cannot be routed around by re-inserting.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.{_TABLE} SET retracted_at = now(), "
                    "retracted_by = :who, retraction_reason = :why WHERE id = :id"
                ),
                {
                    "who": "device:test",
                    "why": "the finding was superseded",
                    "id": first,
                },
            )
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _attest(engine, unit)
        assert _count(engine) == 5

        with engine.connect() as conn:
            row = conn.execute(
                text(
                    f"SELECT retracted_at IS NOT NULL, retracted_by, "
                    f"retraction_reason FROM coord.{_TABLE} WHERE id = :id"
                ),
                {"id": first},
            ).one()
        assert tuple(row) == (True, "device:test", "the finding was superseded")


@_needs_pg
def test_defaults_not_nulls_and_the_cascade_back_to_the_work_unit() -> None:
    with ephemeral_database(admin_database_url(), "phaseatt01_fk") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "phaseatt-cascade")

        row_id = _attest(engine, unit)
        with engine.connect() as conn:
            defaults = conn.execute(
                text(
                    f"""
                    SELECT attested_at IS NOT NULL, evidence_min_version, note,
                           retracted_at, retracted_by, retraction_reason
                      FROM coord.{_TABLE} WHERE id = :id
                    """
                ),
                {"id": row_id},
            ).one()
        assert tuple(defaults) == (True, None, None, None, None, None)

        # tenant_id is nullable, like every sibling coord table.
        _attest(engine, unit, phase_index=6, tenant_id=None)

        for column in _NOT_NULL_COLUMNS:
            params = _row(unit, phase_index=9)
            params[column] = None
            with pytest.raises(sqlalchemy.exc.IntegrityError) as nn:
                _insert(engine, params)
            orig = nn.value.orig
            assert getattr(orig, "pgcode", None) == "23502", f"{column}: {orig!r}"
            assert orig.diag.column_name == column  # type: ignore[union-attr]

        # An attestation about a unit that no longer exists is not evidence.
        assert _count(engine) == 2
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.work_units WHERE id = :id"), {"id": unit}
            )
        assert _count(engine) == 0


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "phaseatt01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        table_comment = scalar(
            engine, f"SELECT obj_description('coord.{_TABLE}'::regclass)"
        )
        assert table_comment == comment_body_from_source(
            source, f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
        )
        assert "PhaseCoverage" in str(table_comment), (
            "the table comment must name its owner on the coord side"
        )
        for column in _COMMENTED_COLUMNS:
            assert column_comment(engine, _TABLE, column) == comment_body_from_source(
                source, f"{_SCHEMA}.{_TABLE}.{column}"
            ), f"comment on {column} differs from the revision source"


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "phaseatt01_idem") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "phaseatt-idempotent")
        _attest(engine, unit)

        # Re-run the revision against a DB that already has it: coord boots
        # against this schema, so a second apply must be a no-op rather than an
        # error, and must not disturb what is stored.
        run_alembic(backend_root(), db_url, "stamp", parent)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _DEDUPE_INDEX)
        assert index_exists(engine, _UNIT_INDEX)
        assert _count(engine) == 1


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "phaseatt01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "phaseatt-roundtrip")
        _attest(engine, unit)

        run_alembic(backend_root(), db_url, "downgrade", parent)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, _DEDUPE_INDEX)
        assert not index_exists(engine, _UNIT_INDEX)
        # The unit this revision hangs off is NOT this revision's to drop.
        assert table_exists(engine, _SCHEMA, "work_units")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _count(engine) == 0
