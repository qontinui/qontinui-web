"""Schema, backfill and round-trip test for ``acctconsent_01``
(``coord.account_tenant_consents``, the ``account|off`` autobind vocabulary and
the ``owner_withdrew`` unbind reason).

Phase 1 of plan
``2026-11-07-pair-a-runner-once-to-the-account-and-reach-every-tenant``.

What is pinned:

1. The revision is wired to an existing parent and its header agrees; every
   DDL object is ``coord.``-qualified; ``upgrade()`` drops no table, column or
   index; both directions are static ``op.execute`` literals.
2. The live shape: every consents column, the ``(operator_id, tenant_id)``
   primary key, both cascading FKs, the tenant index, and the
   ``accepted_via`` CHECK (which refuses an unknown value).
3. The backfill: a ``self_service`` row is consented; a NULL-origin,
   granter-less row that is its tenant's FIRST grant is consented; a
   later-granted NULL-origin row, an ``admin_grant`` row, a NULL-origin row
   WITH a granter at the tenant's earliest ``granted_at``, and operators TIED
   at that earliest ``granted_at`` are NOT; ``accepted_at`` is the operator's
   MIN ``granted_at`` over ALL its roles in that tenant (qualifying or not);
   a second ``upgrade()`` really runs ON CONFLICT DO NOTHING and changes no
   row. Deleting an operator or a tenant cascades its consent rows.
4. ``membership_autobind``: ``created`` rows read ``account``, the default is
   ``account``, and the CHECK refuses ``created``.
5. ``tenant_device_unbinds.reason`` admits ``owner_withdrew``.
6. Downgrade restores the prior state (``created`` vocabulary, two-value
   reason CHECK, no consents table, ``owner_withdrew`` tombstones KEPT as
   ``owner_declined``), and
   up-down-up leaves no residue.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing; set
``QONTINUI_TEST_PG=host:port`` or ``QONTINUI_TEST_PG_DSN``.
"""

from __future__ import annotations

import ast
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

# `_PARENT_REVISION_ID` MUST equal the revision's own `down_revision`; the
# first test enforces it. Re-point both together if main moves before landing.
_REVISION_ID = "acctconsent_01"
_PARENT_REVISION_ID = "outbound_budget_windows_01"
_REVISION_FILENAME = "acctconsent_01_account_tenant_consents.py"

_SCHEMA = "coord"
_TABLE = "account_tenant_consents"
_INDEX = "ix_account_tenant_consents_tenant"
_VIA_CHECK = "ck_account_tenant_consents_accepted_via"
_AUTOBIND_CHECK = "ck_devices_membership_autobind"
_REASON_CHECK = "ck_tenant_device_unbinds_reason"

# (column, information_schema.data_type, nullable, default substring or None)
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("operator_id", "uuid", False, None),
    ("tenant_id", "uuid", False, None),
    ("accepted_at", "timestamp with time zone", False, "now()"),
    ("accepted_via", "text", False, None),
    ("withdrawn_at", "timestamp with time zone", True, None),
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


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


def _sql_literals(name: str) -> list[str]:
    fn = _function(name)
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


# ---------------------------------------------------------------------------
# Static checks (no database)
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_exists() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    parents = [
        f
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(parents) == 1, [f.name for f in parents]


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_every_ddl_object_is_coord_qualified_and_upgrade_drops_no_table() -> None:
    object_re = re.compile(
        r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE|"
        r"COMMENT\s+ON\s+COLUMN|REFERENCES|INSERT\s+INTO|UPDATE|DELETE\s+FROM|FROM|"
        r"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON)"
        r"(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.]+)",
        re.I,
    )
    allowed = (
        f"{_SCHEMA}.{_TABLE}",
        f"{_SCHEMA}.devices",
        f"{_SCHEMA}.tenants",
        f"{_SCHEMA}.operators",
        f"{_SCHEMA}.operator_roles",
        f"{_SCHEMA}.tenant_device_unbinds",
    )
    for name in ("upgrade", "downgrade"):
        for sql in _sql_literals(name):
            for obj in object_re.findall(sql):
                assert obj.startswith(allowed), (name, obj)
    up = "\n".join(_sql_literals("upgrade"))
    assert not re.search(r"\bDROP\s+(?:TABLE|COLUMN|INDEX)\b", up, re.I), (
        "upgrade() must not drop a table, column or index"
    )
    assert "ON CONFLICT (operator_id, tenant_id) DO NOTHING" in up
    down = "\n".join(_sql_literals("downgrade"))
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down)
    assert re.search(rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{_SCHEMA}\.{_INDEX}\b", down)


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    tree = ast.parse(_revision_source())
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls
    assert {c.func.attr for c in calls} == {"execute"}  # type: ignore[attr-defined]
    for call in calls:
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant)
        assert isinstance(call.args[0].value, str)


# ---------------------------------------------------------------------------
# Live checks (ephemeral database)
# ---------------------------------------------------------------------------


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


def _constraint_def(engine: Engine, name: str) -> str | None:
    # max() over zero rows is one NULL row, so an absent constraint reads None.
    found = scalar(
        engine,
        """
        SELECT max(pg_get_constraintdef(c.oid)) FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = 'coord' AND c.conname = :name
        """,
        name=name,
    )
    assert found is None or isinstance(found, str)
    return found


def _index_count(engine: Engine) -> int:
    count = scalar(
        engine,
        "SELECT count(*) FROM pg_indexes WHERE schemaname = 'coord' AND indexname = :i",
        i=_INDEX,
    )
    assert isinstance(count, int)
    return count


def _insert_row(conn: Connection, table: str, given: dict[str, object]) -> None:
    """Insert into coord.<table>, filling every NOT NULL no-default column not given."""
    required = conn.execute(
        text(
            """
            SELECT column_name, data_type
              FROM information_schema.columns
             WHERE table_schema = 'coord' AND table_name = :t
               AND is_nullable = 'NO' AND column_default IS NULL
            """
        ),
        {"t": table},
    ).all()
    vals = dict(given)
    for name, data_type in required:
        if name in vals:
            continue
        if data_type == "uuid":
            vals[name] = str(uuid.uuid4())
        elif data_type in ("text", "character varying"):
            vals[name] = f"acctconsent-{name}-{uuid.uuid4().hex[:8]}"
        elif data_type in ("jsonb", "json"):
            vals[name] = "{}"
        elif data_type == "boolean":
            vals[name] = False
        elif data_type.startswith("timestamp"):
            vals[name] = "2026-11-07T00:00:00+00:00"
        elif data_type in ("integer", "bigint", "smallint"):
            vals[name] = 0
        else:  # pragma: no cover - surfaces a new required column type
            raise AssertionError(f"coord.{table}.{name}: unhandled {data_type}")
    cols = list(vals)
    conn.execute(
        text(
            f"INSERT INTO coord.{table} ({', '.join(cols)}) "
            f"VALUES ({', '.join(':' + c for c in cols)})"
        ),
        vals,
    )


def _seed_tenant(conn: Connection) -> str:
    tenant_id = str(uuid.uuid4())
    _insert_row(conn, "tenants", {"tenant_id": tenant_id})
    return tenant_id


def _seed_operator(conn: Connection, home_tenant: str) -> str:
    operator_id = str(uuid.uuid4())
    _insert_row(
        conn, "operators", {"operator_id": operator_id, "tenant_id": home_tenant}
    )
    return operator_id


def _seed_device(conn: Connection, tenant_id: str) -> str:
    device_id = str(uuid.uuid4())
    _insert_row(conn, "devices", {"device_id": device_id, "tenant_id": tenant_id})
    return device_id


def _grant(
    conn: Connection,
    operator_id: str,
    tenant_id: str,
    role: str,
    granted_at: datetime,
    granted_by: str | None,
    grant_origin: str | None,
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO coord.operator_roles
                (operator_id, tenant_id, role, granted_at, granted_by, grant_origin)
            VALUES (:o, :t, :r, :at, :by, :origin)
            """
        ),
        {
            "o": operator_id,
            "t": tenant_id,
            "r": role,
            "at": granted_at,
            "by": granted_by,
            "origin": grant_origin,
        },
    )


_T0 = datetime(2026, 1, 1, tzinfo=UTC)


@_needs_pg
def test_shape_primary_key_foreign_keys_index_and_checks() -> None:
    with ephemeral_database(admin_database_url(), "acctconsent_shape") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        got = _columns(engine)
        assert set(got) == {c[0] for c in _COLUMNS}, set(got) ^ {c[0] for c in _COLUMNS}
        for name, data_type, nullable, default in _COLUMNS:
            got_type, got_nullable, got_default = got[name]
            assert got_type == data_type, (name, got_type)
            assert got_nullable is nullable, (name, got_nullable)
            if default is None:
                assert got_default is None, (name, got_default)
            else:
                assert got_default is not None and default in got_default, name
        pk = scalar(
            engine,
            """
            SELECT string_agg(a.attname, ',' ORDER BY k.ord)
              FROM pg_constraint c
              CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
             WHERE c.conrelid = 'coord.account_tenant_consents'::regclass
               AND c.contype = 'p'
            """,
        )
        assert pk == "operator_id,tenant_id"
        fks = scalar(
            engine,
            """
            SELECT string_agg(pg_get_constraintdef(c.oid), ' | ' ORDER BY 1)
              FROM pg_constraint c
             WHERE c.conrelid = 'coord.account_tenant_consents'::regclass
               AND c.contype = 'f'
            """,
        )
        assert isinstance(fks, str)
        assert "REFERENCES coord.operators(operator_id) ON DELETE CASCADE" in fks
        assert "REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE" in fks
        assert _index_count(engine) == 1
        via = _constraint_def(engine, _VIA_CHECK)
        assert via is not None
        for value in ("web", "runner", "tenant_create", "backfill"):
            assert f"'{value}'" in via, (value, via)

        with engine.begin() as conn:
            tenant = _seed_tenant(conn)
            operator = _seed_operator(conn, tenant)
        for via_value in ("web", "runner", "tenant_create", "backfill"):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO coord.account_tenant_consents "
                        "(operator_id, tenant_id, accepted_via) VALUES (:o, :t, :v)"
                    ),
                    {"o": operator, "t": tenant, "v": via_value},
                )
                conn.execute(text("DELETE FROM coord.account_tenant_consents"))
        for bad in ("operator", "email", ""):
            with pytest.raises(IntegrityError):
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO coord.account_tenant_consents "
                            "(operator_id, tenant_id, accepted_via) VALUES (:o, :t, :v)"
                        ),
                        {"o": operator, "t": tenant, "v": bad},
                    )


def _consent_rows(engine: Engine) -> dict[tuple[str, str], tuple[object, ...]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT operator_id::text, tenant_id::text, accepted_at, "
                "accepted_via, withdrawn_at FROM coord.account_tenant_consents"
            )
        ).all()
    return {(r[0], r[1]): (r[2], r[3], r[4]) for r in rows}


def _rerun_upgrade(engine: Engine) -> None:
    """Invoke the revision upgrade() a second time, so ON CONFLICT really runs."""
    module = load_revision_module(_revision_path(), f"_rerun_{_REVISION_ID}")
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()


@_needs_pg
def test_backfill_consents_creators_and_not_invitees() -> None:
    with ephemeral_database(admin_database_url(), "acctconsent_backfill") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        with engine.begin() as conn:
            t_self = _seed_tenant(conn)  # self_service creator
            t_legacy = _seed_tenant(conn)  # NULL-origin legacy creator
            t_granted = _seed_tenant(conn)  # earliest NULL-origin row HAS a granter
            owner = _seed_operator(conn, t_self)
            legacy_invitee = _seed_operator(conn, t_legacy)
            admin_invitee = _seed_operator(conn, t_legacy)
            legacy_creator = _seed_operator(conn, t_legacy)
            granted_first = _seed_operator(conn, t_granted)

            # owner in t_self: a NON-qualifying role first (NULL origin with a
            # granter, so not creator-shaped) at day 0.5, the qualifying
            # self_service admin at day 1, a later extra role at day 3.
            # accepted_at must be the MIN over ALL of them: day 0.5.
            _grant(
                conn,
                owner,
                t_self,
                "viewer",
                _T0 + timedelta(hours=12),
                legacy_creator,
                None,
            )
            _grant(
                conn,
                owner,
                t_self,
                "admin",
                _T0 + timedelta(days=1),
                None,
                "self_service",
            )
            _grant(conn, owner, t_self, "operator", _T0 + timedelta(days=3), None, None)

            # t_legacy: the first-granted granter-less NULL-origin row is the creator.
            _grant(conn, legacy_creator, t_legacy, "admin", _T0, None, None)
            # A later-granted NULL-origin granter-less row: a legacy invitation.
            _grant(
                conn,
                legacy_invitee,
                t_legacy,
                "operator",
                _T0 + timedelta(days=5),
                None,
                None,
            )
            # An admin_grant row with a granter: an invitation.
            _grant(
                conn,
                admin_invitee,
                t_legacy,
                "operator",
                _T0 + timedelta(days=6),
                legacy_creator,
                "admin_grant",
            )
            # owner was also invited into t_legacy, NULL origin, later-granted.
            _grant(
                conn, owner, t_legacy, "operator", _T0 + timedelta(days=7), None, None
            )
            # t_granted: the EARLIEST row of the tenant is NULL-origin but has a
            # granter, so it is an invitation, not a creator.
            _grant(conn, granted_first, t_granted, "admin", _T0, legacy_creator, None)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        rows = _consent_rows(engine)
        # The chain itself seeds one bootstrap admin (coord_tenant_scope_columns:
        # the personal tenant, granted_by NULL, its only grant, one operator),
        # which is creator-shaped and so consented too; it is checked separately.
        seeded = {owner, legacy_invitee, admin_invitee, legacy_creator, granted_first}
        got = {k: v for k, v in rows.items() if k[0] in seeded}
        expected = {(owner, t_self), (legacy_creator, t_legacy)}
        assert set(got) == expected, got
        chain_seeded = {k: v for k, v in rows.items() if k[0] not in seeded}
        bootstrap_roles = scalar(
            engine,
            "SELECT count(*) FROM coord.operator_roles WHERE operator_id::text <> ALL(:ids)",
            ids=list(seeded),
        )
        assert isinstance(bootstrap_roles, int)
        assert len(chain_seeded) == bootstrap_roles == 1, (
            chain_seeded,
            bootstrap_roles,
        )
        assert got[(owner, t_self)] == (_T0 + timedelta(hours=12), "backfill", None)
        assert got[(legacy_creator, t_legacy)] == (_T0, "backfill", None)

        # Idempotent: a second upgrade() over the populated table must hit
        # ON CONFLICT DO NOTHING for every pair and overwrite nothing -- not
        # even a row the account has since re-accepted on another surface.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.account_tenant_consents SET accepted_via = 'web' "
                    "WHERE operator_id = :o AND tenant_id = :t"
                ),
                {"o": owner, "t": t_self},
            )
        before = _consent_rows(engine)
        assert len(before) == len(expected) + bootstrap_roles
        _rerun_upgrade(engine)
        assert _consent_rows(engine) == before


@_needs_pg
def test_backfill_skips_operators_tied_at_the_earliest_grant() -> None:
    with ephemeral_database(admin_database_url(), "acctconsent_tie") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        with engine.begin() as conn:
            t_tie = _seed_tenant(conn)
            first = _seed_operator(conn, t_tie)
            second = _seed_operator(conn, t_tie)
            creator = _seed_operator(conn, t_tie)
            # Two distinct operators, both NULL-origin granter-less, tied at the
            # earliest granted_at of the tenant: a one-transaction insert.
            _grant(conn, first, t_tie, "admin", _T0, None, None)
            _grant(conn, second, t_tie, "operator", _T0, None, None)
            # A self_service row in the same tenant is unaffected by the tie.
            _grant(
                conn,
                creator,
                t_tie,
                "admin",
                _T0 + timedelta(days=1),
                None,
                "self_service",
            )
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        got = {k: v for k, v in _consent_rows(engine).items() if k[1] == t_tie}
        assert got == {(creator, t_tie): (_T0 + timedelta(days=1), "backfill", None)}


@_needs_pg
def test_backfill_tie_partners_are_only_null_origin_granterless_rows() -> None:
    """A same-instant row is a tie partner only if NULL-origin AND granter-less.

    Each tenant pins one condition of the tie exclusion: in ``t_origin`` the
    other operator's same-instant row is ``self_service`` (pins
    ``grant_origin IS NULL``); in ``t_granter`` it is NULL-origin but has a
    granter (pins ``granted_by IS NULL``). Neither is a tie partner, so the
    granter-less NULL-origin creator is consented in both.
    """
    with ephemeral_database(admin_database_url(), "acctconsent_tiepart") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        with engine.begin() as conn:
            t_origin = _seed_tenant(conn)
            t_granter = _seed_tenant(conn)
            creator = _seed_operator(conn, t_origin)
            self_served = _seed_operator(conn, t_origin)
            invited = _seed_operator(conn, t_granter)
            # (a) same instant: the creator, and another operator's self_service row.
            _grant(conn, creator, t_origin, "admin", _T0, None, None)
            _grant(conn, self_served, t_origin, "admin", _T0, None, "self_service")
            # (b) same instant: the creator, and another operator's NULL-origin
            # row WITH a granter.
            _grant(conn, creator, t_granter, "admin", _T0, None, None)
            _grant(conn, invited, t_granter, "operator", _T0, creator, None)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        rows = _consent_rows(engine)
        assert rows.get((creator, t_origin)) == (_T0, "backfill", None), rows
        assert rows.get((creator, t_granter)) == (_T0, "backfill", None), rows
        assert (self_served, t_origin) in rows
        assert (invited, t_granter) not in rows


@_needs_pg
def test_deleting_the_operator_or_tenant_cascades_its_consents() -> None:
    with ephemeral_database(admin_database_url(), "acctconsent_cascade") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        count = "SELECT count(*) FROM coord.account_tenant_consents"
        baseline = scalar(engine, count)
        assert isinstance(baseline, int)
        with engine.begin() as conn:
            home = _seed_tenant(conn)
            tenant_a = _seed_tenant(conn)
            tenant_b = _seed_tenant(conn)
            op_a = _seed_operator(conn, home)
            op_b = _seed_operator(conn, home)
            for o, t in ((op_a, tenant_a), (op_a, tenant_b), (op_b, tenant_b)):
                conn.execute(
                    text(
                        "INSERT INTO coord.account_tenant_consents "
                        "(operator_id, tenant_id, accepted_via) VALUES (:o, :t, 'web')"
                    ),
                    {"o": o, "t": t},
                )
        assert scalar(engine, count) == baseline + 3
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.operators WHERE operator_id = :o"), {"o": op_b}
            )
        assert scalar(engine, count) == baseline + 2
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.tenants WHERE tenant_id = :t"), {"t": tenant_a}
            )
        remaining = {
            k
            for k in _consent_rows(engine)
            if k[0] in (op_a, op_b) or k[1] in (tenant_a, tenant_b)
        }
        assert remaining == {(op_a, tenant_b)}


@_needs_pg
def test_autobind_vocabulary_is_account_or_off() -> None:
    with ephemeral_database(admin_database_url(), "acctconsent_autobind") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        with engine.begin() as conn:
            tenant = _seed_tenant(conn)
            created = [_seed_device(conn, tenant) for _ in range(2)]
            off = _seed_device(conn, tenant)
            conn.execute(
                text(
                    "UPDATE coord.devices SET membership_autobind = 'off' "
                    "WHERE device_id = :d"
                ),
                {"d": off},
            )
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with engine.connect() as conn:
            got = dict(
                conn.execute(
                    text(
                        "SELECT device_id::text, membership_autobind FROM coord.devices"
                    )
                ).all()
            )
        assert got == {created[0]: "account", created[1]: "account", off: "off"}
        info = column_info(engine, "devices", "membership_autobind")
        assert info is not None and info[2] is not None and "'account'" in info[2]
        with engine.begin() as conn:
            fresh = _seed_device(conn, tenant)
        assert (
            scalar(
                engine,
                "SELECT membership_autobind FROM coord.devices WHERE device_id = :d",
                d=fresh,
            )
            == "account"
        )
        for bad in ("created", "all", ""):
            with pytest.raises(IntegrityError):
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "UPDATE coord.devices SET membership_autobind = :v "
                            "WHERE device_id = :d"
                        ),
                        {"v": bad, "d": fresh},
                    )


@_needs_pg
def test_unbind_reason_admits_owner_withdrew() -> None:
    with ephemeral_database(admin_database_url(), "acctconsent_reason") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with engine.begin() as conn:
            tenant = _seed_tenant(conn)
            device = _seed_device(conn, tenant)
            conn.execute(
                text(
                    "INSERT INTO coord.tenant_device_unbinds (tenant_id, device_id, reason) "
                    "VALUES (:t, :d, 'owner_withdrew')"
                ),
                {"t": tenant, "d": device},
            )
        with engine.begin() as conn:
            other = _seed_tenant(conn)
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO coord.tenant_device_unbinds (tenant_id, device_id, reason) "
                        "VALUES (:t, :d, 'owner_left')"
                    ),
                    {"t": other, "d": device},
                )


@_needs_pg
def test_downgrade_restores_prior_state_and_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "acctconsent_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with engine.begin() as conn:
            tenant = _seed_tenant(conn)
            other = _seed_tenant(conn)
            device = _seed_device(conn, tenant)
            for t, reason in ((tenant, "owner_withdrew"), (other, "owner_declined")):
                conn.execute(
                    text(
                        "INSERT INTO coord.tenant_device_unbinds "
                        "(tenant_id, device_id, reason) VALUES (:t, :d, :r)"
                    ),
                    {"t": t, "d": device, "r": reason},
                )
        assert table_exists(engine, _SCHEMA, _TABLE)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert _index_count(engine) == 0
        assert _constraint_def(engine, _VIA_CHECK) is None
        reasons = scalar(
            engine,
            "SELECT array_agg(reason ORDER BY reason) FROM coord.tenant_device_unbinds",
        )
        # owner_withdrew tombstones are KEPT, mapped to owner_declined.
        assert reasons == ["owner_declined", "owner_declined"]
        assert (
            scalar(
                engine,
                "SELECT reason FROM coord.tenant_device_unbinds WHERE tenant_id = :t",
                t=tenant,
            )
            == "owner_declined"
        )
        reason_check = _constraint_def(engine, _REASON_CHECK)
        assert reason_check is not None and "owner_withdrew" not in reason_check
        autobind_check = _constraint_def(engine, _AUTOBIND_CHECK)
        assert autobind_check is not None
        assert "'created'" in autobind_check and "'account'" not in autobind_check
        assert (
            scalar(
                engine,
                "SELECT membership_autobind FROM coord.devices WHERE device_id = :d",
                d=device,
            )
            == "created"
        )
        info = column_info(engine, "devices", "membership_autobind")
        assert info is not None and info[2] is not None and "'created'" in info[2]

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _index_count(engine) == 1
        assert (
            scalar(
                engine,
                "SELECT membership_autobind FROM coord.devices WHERE device_id = :d",
                d=device,
            )
            == "account"
        )
