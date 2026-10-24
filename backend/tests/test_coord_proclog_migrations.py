"""Shape test for the ``coord_proclog_01`` revision.

Phase 1 of plan ``2026-10-11-process-twin-event-log-and-flow-metrics`` lands
every table and source index the process twin reads in ONE revision (the
``Migration Reversal Tested`` required check admits one added migration per
PR). What this pins is the CONTRACT coord's projector and workers
(Phases 2-9) depend on:

1. **Source shapes coord's migration_classifier admits** — every upgrade
   ``op.execute`` is one static literal; no statement is a ``DROP``, no
   ``ALTER TABLE`` carries ``DROP`` and no ``ADD CONSTRAINT`` lacks ``NOT
   VALID`` (each of those escalates the PR to an operator); the new-table
   DDL runs in the migration's transaction (never inside the
   ``autocommit_block``), and every CONCURRENTLY build sits inside the
   ``autocommit_block`` and is ``IF NOT EXISTS``. Every index's key columns, uniqueness, ``NULLS NOT DISTINCT`` and
   partial predicate are read back from ``pg_get_indexdef`` and compared with
   the statement that created it.
2. **The parent is pinned** — the one-line ``down_revision`` is the head the
   revision was authored against.
3. **No index names ``coord.gates.evaluated_at``** — the 10 s sweep rewrites
   it on every open gate, and an index on it would make each write non-HOT.
4. **Absent at the parent; present, VALID and idempotent after** — a ``stamp``
   back to the parent and a re-upgrade converge on the same catalog state.
5. **The idempotency keys behave on real rows** — a fleet-scope event
   (``tenant_id NULL``) dedupes under ``NULLS NOT DISTINCT``; a link
   re-observation upserts one row; the categorical CHECKs refuse
   out-of-vocabulary values; E2O rows cascade with their event.
6. **Downgrade removes exactly what upgrade added**, and re-upgrade restores it.
"""

from __future__ import annotations

import ast
import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
    upgrade_execute_calls,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot change what this test walks. The first test enforces that
# `_PARENT_REVISION_ID` equals coord_proclog_01's own `down_revision`.
_PARENT_REVISION_ID = "coord_agent_worktrees_client_allocation_id_01"
_REVISIONS = [
    ("coord_proclog_01", "coord_proclog_01_process_log.py"),
]
_HEAD_REVISION_ID = _REVISIONS[-1][0]

_TABLES = {
    "process_events",
    "process_event_objects",
    "process_object_links",
    "process_log_watermarks",
    "process_flow_snapshots",
    "process_conformance_verdicts",
    "process_forecasts",
}
_STAMP_INDEX_COUNT = 36  # plus ix_proclog_gates_terminal_unarchived


def _source(filename: str) -> str:
    return (backend_root() / "alembic" / "versions" / filename).read_text(
        encoding="utf-8"
    )


@pytest.mark.parametrize("position", range(len(_REVISIONS)))
def test_the_parent_is_pinned_and_on_one_line(position: int) -> None:
    revision_id, filename = _REVISIONS[position]
    parent = _PARENT_REVISION_ID if position == 0 else _REVISIONS[position - 1][0]
    source = _source(filename)
    declared = declared_parent_revision_id(source, filename)
    assert declared == parent, (
        f"{filename} declares down_revision={declared!r}; expected {parent!r}. "
        "Re-point the chain and this test together."
    )
    assert re.search(
        r'^revision[^=\n]*=\s*"' + re.escape(revision_id) + r'"\s*$',
        source,
        re.MULTILINE,
    ), f"{filename} must declare revision={revision_id!r}"
    one_line = re.search(
        r'^down_revision[^=\n]*=\s*"' + re.escape(parent) + r'"',
        source,
        re.MULTILINE,
    )
    assert one_line is not None, (
        "down_revision must be assigned its string literal on ONE line — "
        "coord's line-scoped alembic-graph parser reads only that line"
    )


@pytest.mark.parametrize(("revision_id", "filename"), _REVISIONS)
def test_upgrade_statements_are_static_and_concurrently_is_in_autocommit(
    revision_id: str, filename: str
) -> None:
    calls = upgrade_execute_calls(backend_root() / "alembic" / "versions" / filename)
    assert calls, f"{revision_id}: upgrade() must issue its DDL through op.execute"
    for call in calls:
        assert call.sql is not None, (
            "every upgrade op.execute must take ONE static string literal — "
            "coord's migration_classifier rejects anything dynamic"
        )
    concurrent = [c for c in calls if "CONCURRENTLY" in (c.sql or "").upper()]
    assert len(concurrent) == _STAMP_INDEX_COUNT + 1, revision_id
    for call in calls:
        if call in concurrent:
            assert call.in_autocommit_block, (
                "CREATE INDEX CONCURRENTLY outside autocommit_block fails at runtime"
            )
            assert "IF NOT EXISTS" in (call.sql or "").upper()
        else:
            assert not call.in_autocommit_block, (
                "new-table DDL must run in the migration's transaction, not in "
                f"the autocommit block: {call.sql}"
            )


def _upgrade_sql(filename: str) -> list[str]:
    """Every upgrade ``op.execute`` literal, whitespace-collapsed."""
    return [
        " ".join((call.sql or "").split())
        for call in upgrade_execute_calls(
            backend_root() / "alembic" / "versions" / filename
        )
    ]


_ON_GATES = re.compile(r"\bON\s+(?:ONLY\s+)?coord\.gates\b", re.IGNORECASE)


def test_no_index_names_gates_evaluated_at() -> None:
    for _, filename in _REVISIONS:
        for sql in _upgrade_sql(filename):
            if _ON_GATES.search(sql):
                assert "evaluated_at" not in sql, (
                    "an index naming coord.gates.evaluated_at makes every 10 s "
                    f"sweep write non-HOT: {sql}"
                )


@pytest.mark.parametrize(("revision_id", "filename"), _REVISIONS)
def test_no_statement_coords_migration_classifier_rejects(
    revision_id: str, filename: str
) -> None:
    """Mirror the two ALTER TABLE rules of coord's
    ``pr_merge/migration_classifier.rs``: one rejected statement escalates the
    whole PR to an operator instead of letting coord land it."""
    for sql in _upgrade_sql(filename):
        # The classifier pads parens so `c int,DROP COLUMN x` cannot hide.
        padded = " " + re.sub(r"([(),])", r" \1 ", sql.upper()) + " "
        assert not padded.lstrip().startswith("DROP "), (
            f"{revision_id}: destructive DROP statement: {sql}"
        )
        if padded.lstrip().startswith("ALTER TABLE"):
            assert " DROP " not in padded, (
                f"{revision_id}: destructive DROP inside ALTER TABLE: {sql}"
            )
            if " ADD CONSTRAINT " in padded:
                assert padded.rstrip().endswith("NOT VALID"), (
                    f"{revision_id}: ADD CONSTRAINT without NOT VALID: {sql}"
                )


# coord's `FOREIGN_EXECUTE` list (pr_merge/migration_classifier.rs), verbatim.
_FOREIGN_EXECUTE = {
    "execute",
    "exec_driver_sql",
    "executemany",
    "executescript",
    "scalar",
    "scalars",
    "stream",
    "stream_scalars",
    "create",
    "drop",
    "create_all",
    "drop_all",
    "_exec",
    "run_callable",
    "impl",
}


@pytest.mark.parametrize(("revision_id", "filename"), _REVISIONS)
def test_no_sql_runs_outside_op_execute(revision_id: str, filename: str) -> None:
    """Mirror the classifier's ``forbid_unclassifiable_code`` attribute rule:
    anywhere in the file (helpers and downgrade included), an attribute in its
    ``FOREIGN_EXECUTE`` list, called or not, is SQL the classifier cannot
    inspect unless it is exactly ``op.execute``, and it escalates the PR to an
    operator. ``op.get_bind().execute(...)`` is the case that bit this chain."""
    tree = ast.parse(_source(filename), filename=filename)
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr in _FOREIGN_EXECUTE:
            receiver = node.value
            assert (
                node.attr == "execute"
                and isinstance(receiver, ast.Name)
                and receiver.id == "op"
            ), (
                f"{revision_id}:{node.lineno}: SQL executed outside op.execute "
                f"(`{ast.unparse(node)}`)"
            )


_CREATE_INDEX = re.compile(
    r"^CREATE (?P<unique>UNIQUE )?INDEX (?:CONCURRENTLY )?IF NOT EXISTS "
    r"(?P<name>\w+) ON coord\.(?P<table>\w+) \( ?(?P<cols>[^)]*?) ?\)"
    r"(?P<nnd> NULLS NOT DISTINCT)?(?: WHERE (?P<pred>.+))?$"
)


def _expected_indexes() -> dict[str, re.Match[str]]:
    """Every index the chain's upgrade() literals create, keyed by name."""
    expected: dict[str, re.Match[str]] = {}
    for _, filename in _REVISIONS:
        for sql in _upgrade_sql(filename):
            if " INDEX " in f" {sql} ":
                match = _CREATE_INDEX.match(sql)
                assert match is not None, f"unparsed index statement: {sql}"
                expected[match["name"]] = match
    return expected


def test_the_source_declares_every_expected_index() -> None:
    expected = _expected_indexes()
    stamp = [n for n in expected if n.startswith("ix_proclog_")]
    assert len(stamp) == _STAMP_INDEX_COUNT + 1, sorted(stamp)
    for name in stamp:
        match = expected[name]
        if name != "ix_proclog_gates_terminal_unarchived":
            stamp_col = match["cols"].split(",")[0].strip()
            assert match["pred"] == f"{stamp_col} IS NOT NULL", name


def _tables(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT table_name FROM information_schema.tables
                 WHERE table_schema = 'coord' AND table_name = ANY(:tables)
                """
            ),
            {"tables": sorted(_TABLES)},
        ).all()
    return {r[0] for r in rows}


def _proclog_indexes(engine: Engine) -> dict[str, tuple[bool, str]]:
    """``{name: (indisvalid, pg_get_indexdef)}`` for every index the chain
    declares, plus any other index on one of its seven tables."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relname, i.indisvalid, pg_get_indexdef(i.indexrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_class t ON t.oid = i.indrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord'
                   AND (c.relname = ANY(:names) OR t.relname = ANY(:tables))
                """
            ),
            {"names": sorted(_expected_indexes()), "tables": sorted(_TABLES)},
        ).all()
    return {r[0]: (bool(r[1]), str(r[2])) for r in rows}


def _assert_present(engine: Engine) -> dict[str, tuple[bool, str]]:
    assert _tables(engine) == _TABLES
    indexes = _proclog_indexes(engine)
    invalid = sorted(name for name, (valid, _) in indexes.items() if not valid)
    assert not invalid, f"INVALID indexes (a failed CONCURRENTLY build): {invalid}"
    for name, match in _expected_indexes().items():
        assert name in indexes, f"upgrade must create coord.{name}"
        indexdef = indexes[name][1]
        assert indexdef.startswith(
            "CREATE UNIQUE INDEX" if match["unique"] else "CREATE INDEX "
        ), indexdef
        assert f" ON coord.{match['table']} USING btree ({match['cols']})" in (
            indexdef
        ), f"{name}: key columns or their order drifted: {indexdef}"
        assert ("NULLS NOT DISTINCT" in indexdef) == bool(match["nnd"]), indexdef
        assert (" WHERE " in indexdef) == bool(match["pred"]), (
            f"{name}: partial predicate drifted: {indexdef}"
        )
        if match["pred"]:
            # PG renders `WHERE (x IS NOT NULL)`, with casts and extra parens;
            # every column the source predicate names must be in the rendering.
            rendered = indexdef.split(" WHERE ", 1)[1]
            for column in re.findall(r"\b([a-z_]+)\b", match["pred"]):
                if column not in {"is", "not", "null", "and", "open"}:
                    assert column in rendered, (
                        f"{name}: predicate column {column!r} missing: {indexdef}"
                    )
    return indexes


def _assert_absent(engine: Engine) -> None:
    assert _tables(engine) == set()
    assert not _proclog_indexes(engine)


_INSERT_EVENT = text(
    """
    INSERT INTO coord.process_events
        (tenant_id, activity, occurred_at, source, source_key,
         evidence_tier, time_basis)
    VALUES (:tenant_id, 'train.occupancy_hourly', now(), 'scheduler_ticks',
            :source_key, :tier, 'event')
    ON CONFLICT (tenant_id, source, source_key) DO NOTHING
    RETURNING event_id
    """
)


def _assert_key_behaviour(engine: Engine) -> None:
    with engine.connect() as conn:
        outer = conn.begin()
        try:
            fleet = {
                "tenant_id": None,
                "source_key": "2026-10-12T00",
                "tier": "derived",
            }
            first = conn.execute(_INSERT_EVENT, fleet).scalar_one_or_none()
            assert first is not None
            # A fleet-scope replay dedupes: NULL tenant compares NOT DISTINCT.
            assert conn.execute(_INSERT_EVENT, fleet).scalar_one_or_none() is None
            # The same source key under a tenant is a different event.
            tenant = {**fleet, "tenant_id": uuid.uuid4()}
            assert conn.execute(_INSERT_EVENT, tenant).scalar_one_or_none()

            # E2O rows cascade with their event.
            conn.execute(
                text(
                    """
                    INSERT INTO coord.process_event_objects
                        (event_id, tenant_id, object_type, object_id, qualifier,
                         occurred_at)
                    VALUES (:event_id, NULL, 'train', 'train', 'subject', now())
                    """
                ),
                {"event_id": first},
            )
            conn.execute(
                text("DELETE FROM coord.process_events WHERE event_id = :e"),
                {"e": first},
            )
            assert (
                conn.execute(
                    text(
                        "SELECT count(*) FROM coord.process_event_objects "
                        "WHERE event_id = :e"
                    ),
                    {"e": first},
                ).scalar_one()
                == 0
            )

            # A link re-observation moves last_observed_at, not the row count.
            upsert = text(
                """
                INSERT INTO coord.process_object_links
                    (tenant_id, from_type, from_id, to_type, to_id, qualifier,
                     resolution, source)
                VALUES (NULL, 'pr', 'o/r#1', 'work_unit', 'w', 'implements',
                        'resolved', 'work_unit_pr_citations')
                ON CONFLICT (tenant_id, from_type, from_id, to_type, to_id,
                             qualifier, source)
                DO UPDATE SET last_observed_at = now()
                """
            )
            conn.execute(upsert)
            conn.execute(upsert)
            assert (
                conn.execute(
                    text(
                        "SELECT count(*) FROM coord.process_object_links "
                        "WHERE from_type = 'pr' AND from_id = 'o/r#1' "
                        "AND source = 'work_unit_pr_citations'"
                    )
                ).scalar_one()
                == 1
            )

            # Closed categorical vocabularies refuse anything else.
            refused = [
                (_INSERT_EVENT, {**fleet, "source_key": "x", "tier": "0.9"}),
                (
                    text(
                        """
                        INSERT INTO coord.process_conformance_verdicts
                            (tenant_id, constraint_id, case_type, case_id, verdict)
                        VALUES (gen_random_uuid(), 'c', 'session', '1', 'maybe')
                        """
                    ),
                    {},
                ),
                (
                    text(
                        """
                        INSERT INTO coord.process_forecasts
                            (tenant_id, question, object_type, object_id,
                             issued_at, horizon_secs, p)
                        VALUES (gen_random_uuid(), 'land_within_t', 'proposal',
                                '1', now(), 3600, 1.5)
                        """
                    ),
                    {},
                ),
            ]
            for statement, params in refused:
                savepoint = conn.begin_nested()
                with pytest.raises(IntegrityError) as excinfo:
                    conn.execute(statement, params)
                savepoint.rollback()
                assert getattr(excinfo.value.orig, "pgcode", None) == "23514"
        finally:
            outer.rollback()


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL, so the process-log tables "
        "and source-stamp indexes were NOT verified — only the revision source. "
        "This skip is not a pass. CI provisions a postgres service; locally, "
        "point DATABASE_URL at a reachable instance."
    ),
)
def test_coord_proclog_chain_round_trip() -> None:
    """Walk parent → head → stamp+re-run → downgrade → re-upgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_proclog") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        run_alembic(root, url, "upgrade", _HEAD_REVISION_ID)
        indexes = _assert_present(engine)
        _assert_key_behaviour(engine)

        # Re-run over its own output: `stamp` rewinds only the version marker.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _HEAD_REVISION_ID)
        assert _assert_present(engine) == indexes

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        run_alembic(root, url, "upgrade", _HEAD_REVISION_ID)
        assert _assert_present(engine) == indexes
