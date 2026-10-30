"""Structural, arithmetic and round-trip test for ``coord_policy_outcome_counts_01``.

Plan ``2026-10-30-coord-calibration-counts-fetch-every-labeled-row-per-decision``
Phase 1.

``coord.policy_outcome_counts`` is the first trigger-maintained table in the
coord chain. coord Phase 2 serves safety posteriors from it, so a trigger that
miscounts is a silently wrong safety gate. Every property pinned here would
break that while all other migration gates stay green.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Every SQL argument is ONE static ``op.execute`` literal (coord merge-train
   classifier, offline ``--sql``), the only DROP is in ``downgrade()``, and the
   column-drop guard reads the upgrade path as dropping nothing.
3. The function and every trigger statement sit inside an ``autocommit_block``
   (never in the batch transaction, which would hold SHARE ROW EXCLUSIVE on the
   hot base table until the batch commits), behind ``lock_timeout`` (500 ms up,
   200 ms down) and a capped-backoff ``lock_not_available`` retry; the trigger
   DDL is ``CREATE OR REPLACE`` (``DROP TRIGGER IF EXISTS`` would take ACCESS
   EXCLUSIVE); and ``downgrade()`` neutralises the function before any drop.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Shape: columns, the ``NULLS NOT DISTINCT`` unique keys, no CHECK on ``n``,
   ``REPLICA IDENTITY FULL`` on the key tables, the ``seed_state`` singleton,
   the function search_path, and exactly four statement-level triggers with
   the transition tables the function reads.
5. Trigger arithmetic against real statements: labeled INSERT ``+1``,
   unlabeled INSERT writes nothing, label ``+1``, relabel moves the count,
   unlabel ``-1``, an ``agent_decision``-only UPDATE writes nothing (same
   rollup xmin, no fence lock in the open transaction), a multi-row label
   UPDATE, a retention-shaped batch DELETE ``-n`` (including going negative on
   an unseeded key: there is no CHECK to abort the prune), NULL
   ``outcome_labeled_at`` buckets to a NULL hour, hourly UTC bucketing that
   ignores the session TimeZone, and NULL JSON keys group together. TRUNCATE
   empties the rollup and the seeded set and clears ``full_pass_completed_at``.
6. The seeding fence: a labeling transaction holds
   ``pg_advisory_xact_lock_shared(774177001, hashtext(dd || '|' || surface))``
   until it ends, so a seeder exclusive try-lock fails, while a second labeler
   of the same key does not wait; an unlabeled write takes no such lock.
7. The trigger DDL retries a held lock (proven by the per-attempt NOTICEs) and
   gives up with the lock-timeout error once its budget is spent; the
   downgrade retries past a long reader.
8. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import contextlib
import logging
import re
import sys
import threading
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
import sqlalchemy
from sqlalchemy import event, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.pool import Pool

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
    upgrade_execute_calls,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_policy_outcome_counts_01"
_REVISION_FILENAME = "coord_policy_outcome_counts_01_rollup.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change.
_PARENT_REVISION_ID = "journey_04_explorations_stop_detail_any_stop"

_SCHEMA = "coord"
_COUNTS = "policy_outcome_counts"
_SEEDED = "policy_outcome_counts_seeded"
_SEED_STATE = "policy_outcome_counts_seed_state"
_FUNCTION = "policy_outcome_counts_apply"
_TRIGGERS = (
    "trg_policy_outcome_counts_del",
    "trg_policy_outcome_counts_ins",
    "trg_policy_outcome_counts_trunc",
    "trg_policy_outcome_counts_upd",
)
_LOCK_CLASS = 774177001
# The custom setting the revision reads to lower its DDL retry budget.
_ATTEMPTS_GUC = "qontinui.policy_outcome_counts_ddl_attempts"

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


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        f"down_revision is {module.down_revision!r}; if the revision was "
        "re-pointed onto a moved head, _PARENT_REVISION_ID was not updated with it"
    )
    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']',
        re.M,
    )
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, [f.name for f in siblings]
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. static SQL, coord-qualified, the only DROP in downgrade()
# ---------------------------------------------------------------------------


def test_every_execute_is_one_static_literal() -> None:
    for fn in ("upgrade", "downgrade"):
        calls = upgrade_execute_calls(_revision_path(), function=fn)
        assert calls, f"{fn}() executes nothing"
        for call in calls:
            assert call.sql is not None, f"{fn}(): an op.execute is not a literal"


def test_only_op_execute_and_get_context_are_called_on_op() -> None:
    tree = ast.parse(_revision_source())
    attrs = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    }
    assert attrs == {"execute", "get_context"}, attrs


def test_every_ddl_object_is_coord_qualified() -> None:
    for fn in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(fn)):
            for obj in re.findall(
                r"(?:CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\w+\s+ON"
                r"|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?"
                r"|DROP\s+TABLE(?:\s+IF\s+EXISTS)?"
                r"|ALTER\s+TABLE"
                r"|(?:CREATE\s+OR\s+REPLACE|DROP)\s+FUNCTION(?:\s+IF\s+EXISTS)?"
                r"|AFTER\s+(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+ON"
                r"|DROP\s+TRIGGER\s+IF\s+EXISTS\s+\w+\s+ON)\s+([A-Za-z_.\"]+)",
                sql,
                re.I,
            ):
                assert obj.startswith(f"{_SCHEMA}."), f"{fn}(): {obj!r} not coord."


def test_every_drop_is_inside_downgrade() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. the hot-table DDL is outside the batch, bounded, retried, idempotent
# ---------------------------------------------------------------------------


def test_function_and_triggers_run_in_an_autocommit_block() -> None:
    for fn in ("upgrade", "downgrade"):
        calls = upgrade_execute_calls(_revision_path(), function=fn)
        hot = [
            c
            for c in calls
            if c.sql and re.search(r"\bTRIGGER\b|\bFUNCTION\b", c.sql, re.I)
        ]
        assert hot, f"{fn}(): no trigger or function DDL found"
        for c in hot:
            assert c.in_autocommit_block, f"{fn}(): {c.sql[:60]!r} is in the batch"


def test_trigger_ddl_is_bounded_retried_and_reset() -> None:
    for fn, timeout, default_attempts in (
        ("upgrade", "500ms", 40),
        ("downgrade", "200ms", 100),
    ):
        sqls = [
            c.sql or "" for c in upgrade_execute_calls(_revision_path(), function=fn)
        ]
        set_timeout = f"SET lock_timeout = '{timeout}'"
        assert set_timeout in sqls, f"{fn}(): no {set_timeout}"
        assert sqls[-1].strip() == "RESET lock_timeout", f"{fn}(): no final RESET"
        trig = [s for s in sqls if re.search(r"\bTRIGGER\b", s)]
        assert len(trig) == 1, f"{fn}(): the trigger DDL is not one DO block"
        assert "EXCEPTION WHEN lock_not_available" in trig[0]
        assert re.search(r"IF attempt >= max_attempts THEN\s+RAISE;", trig[0])
        assert f"'{_ATTEMPTS_GUC}', true), '')::integer,\n" in trig[0]
        assert re.search(rf"::integer,\s+{default_attempts}\);", trig[0]), fn
        assert "pg_sleep(least(0.1 * attempt, 2.0))" in trig[0]
        assert sqls.index(set_timeout) < sqls.index(trig[0])


def test_downgrade_neutralises_the_function_before_any_trigger_drop() -> None:
    sqls = [
        c.sql or ""
        for c in upgrade_execute_calls(_revision_path(), function="downgrade")
    ]
    assert re.search(
        r"CREATE OR REPLACE FUNCTION coord\.policy_outcome_counts_apply\(\).*"
        r"BEGIN\s+RETURN NULL;\s+END",
        sqls[0],
        re.S,
    ), "downgrade() must first replace the function body with RETURN NULL"
    first_drop = next(i for i, q in enumerate(sqls) if "DROP TRIGGER" in q)
    assert first_drop > 0


def test_trigger_creation_never_drops_a_trigger() -> None:
    up = "\n".join(_sql_literals(_function("upgrade")))
    creates = re.findall(r"CREATE\s+(OR\s+REPLACE\s+)?TRIGGER", up, re.I)
    assert len(creates) == 4
    assert all(creates), "every trigger create must be CREATE OR REPLACE"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


_TENANT = uuid.UUID("00000000-0000-4000-8000-0000000000a1")
_OTHER_TENANT = uuid.UUID("00000000-0000-4000-8000-0000000000a2")
_POLICY = uuid.UUID("00000000-0000-0000-0000-000000000000")
_OTHER_POLICY = uuid.UUID("00000000-0000-4000-8000-0000000000b1")


@pytest.fixture(scope="module")
def migrated() -> Iterator[Engine]:
    """One database at the revision, shared by the read-mostly tests below.

    Each test that writes calls ``_reset`` first: a TRUNCATE of the base table,
    whose own trigger empties the rollup (pinned by its own test below).
    """
    if not can_connect(admin_database_url()):
        pytest.skip("test Postgres unreachable")
    with ephemeral_database(admin_database_url(), "poc01_shared") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


def _reset(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE coord.policy_rule_resolutions"))
        conn.execute(text(f"TRUNCATE coord.{_COUNTS}, coord.{_SEEDED}"))
        conn.execute(text(f"DELETE FROM coord.{_SEED_STATE}"))


def _insert_sql(rows: int = 1) -> str:
    values = ",\n".join(
        f"(:policy_{i}, :tenant_{i}, CAST(:entity_{i} AS jsonb), '{{}}'::jsonb,"
        f" :category_{i}, CAST(:labeled_{i} AS timestamptz), :rid_{i})"
        for i in range(rows)
    )
    return (
        "INSERT INTO coord.policy_rule_resolutions"
        " (policy_id, tenant_id, resolved_entity, action_taken,"
        " outcome_category, outcome_labeled_at, resolution_id)"
        f" VALUES {values}"
    )


def _entity(
    domain: str | None = "route_serving_safety",
    surface: str | None = "ok",
    decision: str | None = "allow",
) -> str:
    parts = []
    if domain is not None:
        parts.append(f'"decision_domain": "{domain}"')
    if surface is not None:
        parts.append(f'"surface": "{surface}"')
    if decision is not None:
        parts.append(f'"decision": "{decision}"')
    return "{" + ", ".join(parts) + "}"


def _insert(
    conn: Connection,
    rows: list[dict[str, object]],
) -> list[uuid.UUID]:
    """Insert ``rows`` in ONE statement (one trigger firing); return their ids."""
    params: dict[str, object] = {}
    ids: list[uuid.UUID] = []
    for i, row in enumerate(rows):
        rid = uuid.uuid4()
        ids.append(rid)
        params[f"policy_{i}"] = row.get("policy_id", _POLICY)
        params[f"tenant_{i}"] = row.get("tenant_id", _TENANT)
        params[f"entity_{i}"] = row.get("entity", _entity())
        params[f"category_{i}"] = row.get("category")
        params[f"labeled_{i}"] = row.get("labeled_at")
        params[f"rid_{i}"] = rid
    conn.execute(text(_insert_sql(len(rows))), params)
    return ids


Key = tuple[object, ...]


def _counts(engine: Engine) -> dict[Key, int]:
    """Every rollup row with a non-zero ``n``, keyed by its seven key columns."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT decision_domain, surface, decision, tenant_id, policy_id,
                       to_char(labeled_hour, 'YYYY-MM-DD HH24:MI'),
                       outcome_category, n
                  FROM coord.{_COUNTS}
                 WHERE n <> 0 AND tenant_id = ANY(:tenants)
                """
            ),
            {"tenants": [_TENANT, _OTHER_TENANT]},
        ).all()
    return {tuple(r[:7]): int(r[7]) for r in rows}


def _key(
    category: str,
    hour: str | None = "2026-10-30 13:00",
    *,
    domain: str | None = "route_serving_safety",
    surface: str | None = "ok",
    decision: str | None = "allow",
    tenant: uuid.UUID = _TENANT,
    policy: uuid.UUID = _POLICY,
) -> Key:
    return (domain, surface, decision, tenant, policy, hour, category)


def _row_total(engine: Engine) -> int:
    """Rollup rows, of any ``n``, under the two tenants these tests write."""
    value = scalar(
        engine,
        f"SELECT count(*) FROM coord.{_COUNTS} WHERE tenant_id = ANY(:tenants)",
        tenants=[_TENANT, _OTHER_TENANT],
    )
    assert isinstance(value, int)
    return value


# ---------------------------------------------------------------------------
# 4. shape
# ---------------------------------------------------------------------------


@_needs_pg
def test_tables_keys_and_replica_identity(migrated: Engine) -> None:
    engine = migrated
    with engine.connect() as conn:
        cols = conn.execute(
            text(
                """
                SELECT table_name, column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = ANY(:t)
                 ORDER BY table_name, ordinal_position
                """
            ),
            {"t": [_COUNTS, _SEEDED, _SEED_STATE]},
        ).all()
        got = [tuple(r) for r in cols]
        assert got == [
            (_COUNTS, "decision_domain", "text", "YES"),
            (_COUNTS, "surface", "text", "YES"),
            (_COUNTS, "decision", "text", "YES"),
            (_COUNTS, "tenant_id", "uuid", "NO"),
            (_COUNTS, "policy_id", "uuid", "NO"),
            (_COUNTS, "labeled_hour", "timestamp without time zone", "YES"),
            (_COUNTS, "outcome_category", "text", "NO"),
            (_COUNTS, "n", "bigint", "NO"),
            (_SEED_STATE, "id", "boolean", "NO"),
            (_SEED_STATE, "full_pass_completed_at", "timestamp with time zone", "YES"),
            (_SEEDED, "decision_domain", "text", "YES"),
            (_SEEDED, "surface", "text", "YES"),
            (_SEEDED, "seeded_at", "timestamp with time zone", "NO"),
        ]

        indexes = dict(
            conn.execute(
                text(
                    """
                    SELECT indexname, indexdef FROM pg_indexes
                     WHERE schemaname = 'coord' AND tablename = ANY(:t)
                    """
                ),
                {"t": [_COUNTS, _SEEDED]},
            ).all()
        )
        assert set(indexes) == {
            "ux_policy_outcome_counts_key",
            "ix_policy_outcome_counts_policy_surface",
            "ux_policy_outcome_counts_seeded_key",
        }
        assert indexes["ux_policy_outcome_counts_key"].endswith(
            "(decision_domain, surface, decision, tenant_id, policy_id, "
            "labeled_hour, outcome_category) NULLS NOT DISTINCT"
        )
        assert indexes["ux_policy_outcome_counts_seeded_key"].endswith(
            "(decision_domain, surface) NULLS NOT DISTINCT"
        )
        assert indexes["ix_policy_outcome_counts_policy_surface"].endswith(
            "(policy_id, surface)"
        )

        checks = conn.execute(
            text(
                """
                SELECT count(*) FROM pg_constraint
                 WHERE conrelid = 'coord.policy_outcome_counts'::regclass
                   AND contype = 'c'
                """
            )
        ).scalar_one()
        assert checks == 0, "n must carry no CHECK: an unseeded key may go negative"

        ident = dict(
            conn.execute(
                text(
                    """
                    SELECT c.relname, c.relreplident FROM pg_class c
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'coord' AND c.relname = ANY(:t)
                    """
                ),
                {"t": [_COUNTS, _SEEDED]},
            ).all()
        )
        assert ident == {_COUNTS: "f", _SEEDED: "f"}

        # The singleton: a primary key (so DEFAULT replica identity), and a
        # CHECK that admits only id = true.
        cons = dict(
            conn.execute(
                text(
                    """
                    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
                     WHERE conrelid = 'coord.policy_outcome_counts_seed_state'::regclass
                    """
                )
            ).all()
        )
        assert cons == {
            "policy_outcome_counts_seed_state_pkey": "PRIMARY KEY (id)",
            "policy_outcome_counts_seed_state_singleton_check": "CHECK (id)",
        }
        assert (
            conn.execute(
                text(
                    "SELECT relreplident FROM pg_class"
                    " WHERE oid = 'coord.policy_outcome_counts_seed_state'::regclass"
                )
            ).scalar_one()
            == "d"
        )


@_needs_pg
def test_four_statement_triggers(migrated: Engine) -> None:
    with migrated.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
                 WHERE tgrelid = 'coord.policy_rule_resolutions'::regclass
                   AND NOT tgisinternal
                 ORDER BY tgname
                """
            )
        ).all()
        fn = conn.execute(
            text(
                """
                SELECT p.prokind, l.lanname, p.prorettype::regtype::text,
                       p.proconfig
                  FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                  JOIN pg_language l ON l.oid = p.prolang
                 WHERE n.nspname = 'coord' AND p.proname = :f
                """
            ),
            {"f": _FUNCTION},
        ).all()
    assert [tuple(r) for r in fn] == [
        ("f", "plpgsql", "trigger", ["search_path=pg_catalog, coord"])
    ]
    defs = dict(rows)
    assert tuple(defs) == _TRIGGERS
    tail = "FOR EACH STATEMENT EXECUTE FUNCTION coord.policy_outcome_counts_apply()"
    on = "ON coord.policy_rule_resolutions"
    assert defs["trg_policy_outcome_counts_ins"].endswith(
        f"AFTER INSERT {on} REFERENCING NEW TABLE AS new_rows {tail}"
    )
    assert defs["trg_policy_outcome_counts_upd"].endswith(
        f"AFTER UPDATE {on} REFERENCING OLD TABLE AS old_rows "
        f"NEW TABLE AS new_rows {tail}"
    )
    assert defs["trg_policy_outcome_counts_del"].endswith(
        f"AFTER DELETE {on} REFERENCING OLD TABLE AS old_rows {tail}"
    )
    assert defs["trg_policy_outcome_counts_trunc"].endswith(
        f"AFTER TRUNCATE {on} {tail}"
    )


# ---------------------------------------------------------------------------
# 5. trigger arithmetic
# ---------------------------------------------------------------------------


@_needs_pg
def test_insert_arithmetic(migrated: Engine) -> None:
    engine = migrated
    _reset(engine)
    with engine.begin() as conn:
        # Unlabeled INSERT: no rollup row at all, not even a zero.
        _insert(conn, [{}, {"entity": _entity(domain="infra_health_safety")}])
    assert _row_total(engine) == 0

    with engine.begin() as conn:
        # One statement, mixed: two labeled with the same key, one unlabeled.
        _insert(
            conn,
            [
                {"category": "confirmed", "labeled_at": "2026-10-30T13:05:00Z"},
                {"category": "confirmed", "labeled_at": "2026-10-30T13:55:00Z"},
                {},
            ],
        )
    assert _counts(engine) == {_key("confirmed"): 2}

    with engine.begin() as conn:
        # A labeled INSERT with NULL outcome_labeled_at (the next_step.rs
        # fixture shape) buckets to a NULL hour, apart from the dated rows.
        _insert(conn, [{"category": "confirmed", "labeled_at": None}])
    assert _counts(engine) == {_key("confirmed"): 2, _key("confirmed", None): 1}


@_needs_pg
def test_update_arithmetic(migrated: Engine) -> None:
    engine = migrated
    _reset(engine)
    with engine.begin() as conn:
        a, b, c = _insert(conn, [{}, {}, {}])
    assert _row_total(engine) == 0

    def update(sql: str, **params: object) -> None:
        with engine.begin() as conn:
            conn.execute(text(sql), params)

    # NULL -> label: +1.
    update(
        """
        UPDATE coord.policy_rule_resolutions
           SET outcome_category = 'confirmed',
               outcome_labeled_at = '2026-10-30T13:30:00Z'
         WHERE resolution_id = :id AND outcome_category IS NULL
        """,
        id=a,
    )
    assert _counts(engine) == {_key("confirmed"): 1}

    # An UPDATE touching only agent_decision on a labeled row is +1 -1 on the
    # same key: the function returns before locking or writing anything. The
    # rollup row keeps its xmin (no new row version), and no fence lock is
    # held while the updating transaction is still open.
    xmin_before = _rollup_xmins(engine)
    with engine.connect() as conn:
        tx = conn.begin()
        conn.execute(
            text(
                "UPDATE coord.policy_rule_resolutions SET agent_decision = '{}'::jsonb"
                " WHERE resolution_id = :id"
            ),
            {"id": a},
        )
        assert _fence_locks(engine) == set()
        tx.commit()
    assert _rollup_xmins(engine) == xmin_before
    assert _counts(engine) == {_key("confirmed"): 1}

    # Relabel: the count moves between categories.
    update(
        "UPDATE coord.policy_rule_resolutions SET outcome_category = 'contradiction'"
        " WHERE resolution_id = :id",
        id=a,
    )
    assert _counts(engine) == {_key("contradiction"): 1}

    # Re-timing a label moves it between hour buckets.
    update(
        "UPDATE coord.policy_rule_resolutions"
        " SET outcome_labeled_at = '2026-10-30T15:00:00Z' WHERE resolution_id = :id",
        id=a,
    )
    assert _counts(engine) == {_key("contradiction", "2026-10-30 15:00"): 1}

    # Unlabel: -1.
    update(
        "UPDATE coord.policy_rule_resolutions"
        " SET outcome_category = NULL, outcome_labeled_at = NULL"
        " WHERE resolution_id = :id",
        id=a,
    )
    assert _counts(engine) == {}

    # Multi-row label UPDATE (label_outcomes_for_device shape): one statement.
    update(
        """
        UPDATE coord.policy_rule_resolutions
           SET outcome_category = 'failure',
               outcome_labeled_at = '2026-10-30T13:10:00Z'
         WHERE resolution_id = ANY(:ids) AND outcome_category IS NULL
        """,
        ids=[a, b, c],
    )
    assert _counts(engine) == {_key("failure"): 3}

    # A changed key column on a labeled row moves the count to the new key.
    update(
        "UPDATE coord.policy_rule_resolutions SET tenant_id = :t"
        " WHERE resolution_id = :id",
        t=_OTHER_TENANT,
        id=c,
    )
    assert _counts(engine) == {
        _key("failure"): 2,
        _key("failure", tenant=_OTHER_TENANT): 1,
    }


@_needs_pg
def test_retention_shaped_delete_and_negative_unseeded_key(migrated: Engine) -> None:
    engine = migrated
    _reset(engine)
    rows: list[dict[str, object]] = [
        {"category": "confirmed", "labeled_at": "2026-10-30T13:00:00Z"}
    ] * 40
    rows += [{"category": "surprise", "labeled_at": "2026-10-30T13:59:59Z"}] * 7
    rows += [{}] * 13
    with engine.begin() as conn:
        _insert(conn, rows)
    assert _counts(engine) == {_key("confirmed"): 40, _key("surprise"): 7}

    # The table_retention.rs prune: a batch DELETE by id over a mixed set.
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                DELETE FROM coord.policy_rule_resolutions
                 WHERE resolution_id IN (
                       SELECT resolution_id FROM coord.policy_rule_resolutions
                        ORDER BY outcome_category NULLS FIRST, resolution_id
                        LIMIT 30)
                """
            )
        )
    # NULLS FIRST, then by category: the 13 unlabeled and 17 of the 40
    # confirmed rows went in one statement; the 7 surprise rows stayed.
    remaining = {"confirmed": 23, "surprise": 7}
    assert _counts(engine) == {_key(k): v for k, v in remaining.items()}

    # A labeled row that was never counted (an unseeded key, here simulated by
    # clearing the rollup) is pruned: the key goes to -1, and the prune is not
    # aborted, because n carries no CHECK.
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE coord.{_COUNTS}"))
        deleted = conn.execute(
            text(
                "DELETE FROM coord.policy_rule_resolutions"
                " WHERE outcome_category IS NOT NULL"
            )
        ).rowcount
    assert deleted == 30
    assert _counts(engine) == {_key(k): -v for k, v in remaining.items()}


@_needs_pg
def test_hour_buckets_are_utc_whatever_the_session_timezone(migrated: Engine) -> None:
    engine = migrated
    _reset(engine)
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL TimeZone = 'America/New_York'"))
        _insert(
            conn,
            [
                {"category": "confirmed", "labeled_at": "2026-10-30T13:59:59.999+00"},
                {"category": "confirmed", "labeled_at": "2026-10-30T14:00:00+00"},
                # 23:30 in New York is 03:30 UTC on the next day.
                {"category": "confirmed", "labeled_at": "2026-10-30T23:30:00-04"},
            ],
        )
    assert _counts(engine) == {
        _key("confirmed", "2026-10-30 13:00"): 1,
        _key("confirmed", "2026-10-30 14:00"): 1,
        _key("confirmed", "2026-10-31 03:00"): 1,
    }


@_needs_pg
def test_missing_json_keys_group_as_null(migrated: Engine) -> None:
    engine = migrated
    _reset(engine)
    bare = _entity(domain=None, surface=None, decision=None)
    for _ in range(2):  # two statements: the second must upsert the NULL key
        with engine.begin() as conn:
            _insert(
                conn,
                [
                    {
                        "category": "partial",
                        "labeled_at": "2026-10-30T13:00:00Z",
                        "entity": bare,
                        "policy_id": _OTHER_POLICY,
                    }
                ],
            )
    assert _counts(engine) == {
        _key(
            "partial",
            domain=None,
            surface=None,
            decision=None,
            policy=_OTHER_POLICY,
        ): 2
    }
    assert _row_total(engine) == 1, "NULLS NOT DISTINCT must merge, not duplicate"


# ---------------------------------------------------------------------------
# 6. the seeding fence
# ---------------------------------------------------------------------------


def _fence_locks(engine: Engine) -> set[tuple[int, str]]:
    """Granted class-774177001 locks in THIS database, as ``(key, mode)``."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT objid::bigint, mode FROM pg_locks
                 WHERE locktype = 'advisory' AND classid = :c AND objsubid = 2
                   AND granted
                   AND database = (SELECT oid FROM pg_database
                                    WHERE datname = current_database())
                """
            ),
            {"c": _LOCK_CLASS},
        ).all()
    return {(int(r[0]), str(r[1])) for r in rows}


def _rollup_xmins(engine: Engine) -> dict[Key, str]:
    """``xmin`` of every rollup row under the test tenants: a write changes it."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT decision_domain, surface, decision, tenant_id, policy_id,
                       to_char(labeled_hour, 'YYYY-MM-DD HH24:MI'),
                       outcome_category, xmin::text
                  FROM coord.{_COUNTS}
                 WHERE tenant_id = ANY(:tenants)
                """
            ),
            {"tenants": [_TENANT, _OTHER_TENANT]},
        ).all()
    return {tuple(r[:7]): str(r[7]) for r in rows}


def _hashtext(engine: Engine, key: str) -> int:
    value = scalar(engine, "SELECT hashtext(:k)", k=key)
    assert isinstance(value, int)
    # pg_locks.objid is an oid (unsigned); the int4 key is stored bit-for-bit.
    return value & 0xFFFFFFFF


@_needs_pg
def test_labeling_holds_the_key_lock_shared_until_commit(migrated: Engine) -> None:
    engine = migrated
    _reset(engine)
    expected = _hashtext(engine, "route_serving_safety|ok")
    null_key = _hashtext(engine, "|")
    labeled = {"category": "confirmed", "labeled_at": "2026-10-30T13:00:00Z"}

    with engine.connect() as conn:
        tx = conn.begin()
        _insert(conn, [{}])  # unlabeled: no lock
        assert _fence_locks(engine) == set()
        _insert(
            conn,
            [labeled, {**labeled, "entity": _entity(domain=None, surface=None)}],
        )
        assert _fence_locks(engine) == {
            (expected, "ShareLock"),
            (null_key, "ShareLock"),
        }

        # A seeder (EXCLUSIVE on the same key) cannot get in meanwhile.
        with engine.connect() as seeder:
            took = seeder.execute(
                text("SELECT pg_try_advisory_xact_lock(:c, hashtext(:k))"),
                {"c": _LOCK_CLASS, "k": "route_serving_safety|ok"},
            ).scalar_one()
            seeder.rollback()
        assert took is False

        # A second labeler of the SAME fence key does not wait on the first:
        # its statement completes under a lock_timeout far below any real
        # wait. (It writes a different rollup row; two writers of one rollup
        # row serialize on that row, by design, not on the fence.)
        with engine.connect() as other:
            other_tx = other.begin()
            other.execute(text("SET LOCAL lock_timeout = '1s'"))
            _insert(other, [{**labeled, "category": "failure"}])
            assert (expected, "ShareLock") in _fence_locks(engine)
            other_tx.commit()

        tx.commit()
    assert _fence_locks(engine) == set()
    assert _counts(engine) == {
        _key("confirmed"): 1,
        _key("failure"): 1,
        _key("confirmed", domain=None, surface=None): 1,
    }


@_needs_pg
def test_truncate_empties_the_rollup_and_unseeds(migrated: Engine) -> None:
    engine = migrated
    _reset(engine)
    with engine.begin() as conn:
        _insert(conn, [{"category": "confirmed", "labeled_at": None}] * 3)
        conn.execute(
            text(
                f"""
                INSERT INTO coord.{_SEEDED} (decision_domain, surface, seeded_at)
                VALUES ('route_serving_safety', 'ok', now())
                """
            )
        )
        conn.execute(
            text(
                f"INSERT INTO coord.{_SEED_STATE} (full_pass_completed_at)"
                " VALUES (now())"
            )
        )
    assert _counts(engine) == {_key("confirmed", None): 3}

    with engine.begin() as conn:
        conn.execute(text("TRUNCATE coord.policy_rule_resolutions"))

    assert _row_total(engine) == 0
    with engine.connect() as conn:
        seeded = conn.execute(
            text(
                f"SELECT count(*) FROM coord.{_SEEDED}"
                " WHERE decision_domain = 'route_serving_safety'"
            )
        ).scalar_one()
        state = conn.execute(
            text(f"SELECT id, full_pass_completed_at FROM coord.{_SEED_STATE}")
        ).all()
    assert seeded == 0, "a truncated base table must leave no key trusted"
    assert [tuple(r) for r in state] == [(True, None)], (
        "the singleton survives with full_pass_completed_at cleared"
    )

    # The singleton admits no second row.
    with pytest.raises(sqlalchemy.exc.IntegrityError):
        with engine.begin() as conn:
            conn.execute(text(f"INSERT INTO coord.{_SEED_STATE} (id) VALUES (false)"))


# ---------------------------------------------------------------------------
# 7, 8. bounded retry, idempotence, round trip
# ---------------------------------------------------------------------------


def _trigger_count(engine: Engine) -> int:
    value = scalar(
        engine,
        """
        SELECT count(*) FROM pg_trigger
         WHERE tgrelid = 'coord.policy_rule_resolutions'::regclass
           AND NOT tgisinternal
        """,
    )
    assert isinstance(value, int)
    return value


def _function_exists(engine: Engine) -> bool:
    return bool(
        scalar(
            engine,
            "SELECT to_regprocedure('coord.policy_outcome_counts_apply()') IS NOT NULL",
        )
    )


@contextlib.contextmanager
def _holding(engine: Engine, sql: str, seconds: float) -> Iterator[None]:
    """Run ``sql`` in an open transaction on another thread for ``seconds``.

    Yields once the statement has run (so its lock is held), and always joins
    the thread on the way out, whatever the body raised.
    """
    holding = threading.Event()
    errors: list[BaseException] = []

    def hold() -> None:
        try:
            with engine.connect() as conn:
                tx = conn.begin()
                conn.execute(text(sql))
                holding.set()
                time.sleep(seconds)
                tx.commit()
        except BaseException as exc:  # surfaced by the join below
            errors.append(exc)
            holding.set()

    holder = threading.Thread(target=hold)
    holder.start()
    try:
        assert holding.wait(30), "the lock holder never started"
        assert not errors, errors
        yield
    finally:
        holder.join(60)
    assert not holder.is_alive(), "the lock holder thread did not finish"
    assert not errors, errors


class _ListHandler(logging.Handler):
    def __init__(self, sink: list[str]) -> None:
        super().__init__(logging.INFO)
        self.sink = sink

    def emit(self, record: logging.LogRecord) -> None:
        self.sink.append(record.getMessage())


@contextlib.contextmanager
def _captured_notices() -> Iterator[list[str]]:
    """Every server NOTICE on every connection opened inside the block.

    alembic runs in-process on its own engine, so the capture is global, by
    the two routes a psycopg2 NOTICE takes through SQLAlchemy. After a
    statement that SUCCEEDS, the dialect logs each notice at INFO on
    ``sqlalchemy.dialects.postgresql`` and clears the list, so a handler on
    that logger sees it. After a statement that FAILS nothing logs or clears
    it, so a ``Pool`` connect hook gives every DBAPI connection a list of its
    own (NOT ``sink``: the dialect iterates it while the handler appends, which
    would never end), folded into ``sink`` when the block exits.
    """
    sink: list[str] = []
    unlogged: list[str] = []

    def attach(dbapi_connection: object, _record: object) -> None:
        dbapi_connection.notices = unlogged  # type: ignore[attr-defined]

    dialect_logger = logging.getLogger("sqlalchemy.dialects.postgresql")
    saved_level = dialect_logger.level
    handler = _ListHandler(sink)
    dialect_logger.addHandler(handler)
    dialect_logger.setLevel(logging.INFO)
    event.listen(Pool, "connect", attach)
    try:
        yield sink
    finally:
        event.remove(Pool, "connect", attach)
        dialect_logger.removeHandler(handler)
        dialect_logger.setLevel(saved_level)
        sink.extend(unlogged)


def _retry_notices(sink: list[str]) -> list[str]:
    return [n for n in sink if "lock_timeout on attempt" in n]


# Holds ROW EXCLUSIVE on the base table, which conflicts with the SHARE ROW
# EXCLUSIVE of CREATE TRIGGER (an INSERT, the shape of every live writer).
_WRITER = (
    "INSERT INTO coord.policy_rule_resolutions"
    " (policy_id, tenant_id, resolved_entity, action_taken)"
    " VALUES ('00000000-0000-0000-0000-000000000000',"
    " '00000000-0000-4000-8000-0000000000a1', '{}'::jsonb, '{}'::jsonb)"
)
# Holds ACCESS SHARE on the base table, which conflicts with the ACCESS
# EXCLUSIVE of DROP TRIGGER (the shape of the long calibration count read).
_READER = "SELECT count(*) FROM coord.policy_rule_resolutions"


@_needs_pg
def test_upgrade_retries_a_held_lock_and_gives_up_at_its_budget() -> None:
    with ephemeral_database(admin_database_url(), "poc01_retry") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        db_name = engine.url.database

        # Budget exhausted: two attempts of 500 ms against a 4 s hold fail, the
        # error is the lock timeout, and no trigger is left half-created.
        with engine.begin() as conn:
            conn.execute(text(f'ALTER DATABASE "{db_name}" SET {_ATTEMPTS_GUC} = 2'))
        try:
            with _captured_notices() as sink, _holding(engine, _WRITER, 4):
                proc = run_alembic(
                    backend_root(),
                    db_url,
                    "upgrade",
                    _REVISION_ID,
                    expect_success=False,
                )
        finally:
            with engine.begin() as conn:
                conn.execute(text(f'ALTER DATABASE "{db_name}" RESET {_ATTEMPTS_GUC}'))
        assert "lock timeout" in proc.stderr, proc.stderr[-2000:]
        assert len(_retry_notices(sink)) == 1, sink
        assert _trigger_count(engine) == 0

        # Default budget: a 2.5 s hold outlasts several 500 ms attempts, and the
        # DDL lands after the writer commits. The notices prove it retried.
        with _captured_notices() as sink, _holding(engine, _WRITER, 2.5):
            run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        retries = _retry_notices(sink)
        assert len(retries) >= 2, sink
        assert "attempt 1," in retries[0]
        assert _trigger_count(engine) == 4

        # Downgrade against a long reader: the function is neutralised with no
        # base-table lock, then the ACCESS EXCLUSIVE drops retry at 200 ms.
        with _captured_notices() as sink, _holding(engine, _READER, 1.5):
            run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert len(_retry_notices(sink)) >= 2, sink
        assert _trigger_count(engine) == 0
        assert not _function_exists(engine)


@_needs_pg
def test_idempotence_and_round_trip() -> None:
    with ephemeral_database(admin_database_url(), "poc01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _trigger_count(engine) == 4

        # Down: no residue.
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert _trigger_count(engine) == 0
        assert not _function_exists(engine)
        for table in (_COUNTS, _SEEDED, _SEED_STATE):
            assert not table_exists(engine, _SCHEMA, table), table

        # Idempotent: re-run from the parent stamp over the existing objects.
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with engine.begin() as conn:
            _insert(conn, [{"category": "confirmed", "labeled_at": None}])
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _trigger_count(engine) == 4, "a re-run must not add triggers"
        assert _counts(engine) == {_key("confirmed", None): 1}, (
            "a re-run must not disturb existing rollup rows"
        )
        with engine.begin() as conn:
            _insert(conn, [{"category": "confirmed", "labeled_at": None}])
        assert _counts(engine) == {_key("confirmed", None): 2}, (
            "after a re-run each write still fires exactly one trigger"
        )

        # Down and up once more: the rollup comes back empty.
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        with engine.begin() as conn:
            _insert(conn, [{"category": "confirmed", "labeled_at": None}])
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _row_total(engine) == 0, "no backfill: the rollup starts empty"
