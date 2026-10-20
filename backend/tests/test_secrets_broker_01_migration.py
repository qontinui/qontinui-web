"""Structural, redaction and round-trip tests for ``secrets_broker_01``.

Phase 3 of plan ``2026-10-20-secrets-broker-agents-act-on-secrets-never-see-them``
creates the four ``coord.secrets_broker_*`` tables and the typed
``secrets_broker_device_id`` column on ``coord.fleet_runtime_policy`` and its
``_versions`` table. coord's ingest route writes the tables, its twin door reads
them, and its ingest authorization reads the column, so every property they rely
on is asserted against the live catalog with the expected values spelled out
here. Changing the revision without changing this test turns it red.

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` are what this test pins.
2. **The upgrade path is the shape coord's migration classifier admits**: every
   ``op.execute`` takes ONE static string, every statement names the ``coord``
   schema, and none is a ``DROP``, ``GRANT``, ``REVOKE``, ``CONCURRENTLY`` or
   data DML. The downgrade drops exactly the four tables and the two columns.

With a database (skipped when none is reachable):

3. **Each table lands with exactly the pinned columns**, types and nullability,
   and **no column is shaped to hold a secret value**: no ``bytea``, and no
   column named for a value (``value``, ``secret``, ``token``, ``password``,
   ``plaintext``, ``ciphertext``, ``key``).
4. **Twin redaction by construction (D4).** The canary is planted in five RAW
   forms (the literal, its JSON-escaped form, base64, hex, a 12-digit run) into
   every text column (``secret_refs``, ``ref``, ``secret_ref``,
   ``fingerprints``, ``fingerprint16``, ``op``, ``refusal_rule``, ``scopes``,
   ``principal``, ``action``, and the six closed-vocabulary columns
   ``outcome``, ``kind``, ``delivered_to``, ``store``, ``type``, ``decision``)
   and every nested mint-scope position (``repos``
   element, ``permissions`` key and value, ``tags`` element), and each is
   refused by the named CHECK. WRAPPED forms are planted only where the schema
   claims to refuse them: a 16-hex or 12-digit run inside ``op``,
   ``refusal_rule`` and the ``tag:``/``kms:alias/``/``ecs:`` scopes, and
   ``action``'s closed vocabulary. Besides: a 64-hex digest, an uppercase
   fingerprint and a third fingerprint (the cap is 2) are refused, as are an
   unknown mint ``kind`` and ``delivered_to``; a mint
   ``scope`` refuses an extra key, a bare value and the owner / repo /
   permission-key / tag length caps; every array column refuses a separator
   planted inside ONE element, because each element is validated on its own.
   **The residual, stated completely and PINNED by one accept test per
   member, so tightening or loosening any grammar turns a test red:** a value
   that fits a name grammar (``principal``, the ``user/``, ``role/``,
   ``tag:``, ``kms:alias/`` and ``ecs:`` scopes, ``op``, ``refusal_rule``,
   ``action``, the ``ssm:``/``sm:`` references, ``repos`` elements,
   permission keys, mint tags) and a value chunked into fingerprint- or
   uuid-shaped pieces (two 16-hex fingerprints, a ``fingerprint16``, any
   ``uuid`` column) are ACCEPTED here. coord's ingest guard owns refusing
   those, loudly.
5. **No ARN, and real IAM names accepted**: an ``arn:`` principal (any case),
   a non-``user``/``role`` principal and a malformed name are refused;
   ``user/<path/>name`` and ``role/<path/>name`` in IAM's charset are accepted,
   including SSO roles with a 16-hex suffix, Terraform ``name_prefix`` roles
   with a long digit run and service-role paths, so no real exposure row is
   silently refused.
6. **Realistic rows insert**, and ``refusal_rule`` is present exactly when the
   outcome is ``refused``.
7. **A mint belongs to its op's tenant**: a mint naming another tenant's op is
   refused on the composite key; deleting the op deletes its mints; deleting the
   tenant deletes everything of that tenant only.
8. **The broker-device column is on BOTH fleet-policy tables**, nullable UUID
   with no default, each with its comment.
9. **Re-running the upgrade is a no-op**, and **up -> down -> up leaves no
   residue**.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, migrated by the real alembic chain. A skip proves nothing — point it
at a live instance with ``QONTINUI_TEST_PG_DSN`` (or ``QONTINUI_TEST_PG``).
"""

from __future__ import annotations

import ast
import base64
import json
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
    upgrade_execute_calls,
)

# Pinned rather than "head" so a later revision cannot change what this walks.
# MUST equal the revision's own down_revision (the first test enforces it).
_REVISION_ID = "secrets_broker_01"
_PARENT_REVISION_ID = "kernel_gauges_01"
_REVISION_FILENAME = "secrets_broker_01_coord_tables.py"

_SCHEMA = "coord"
_OPS = "secrets_broker_ops"
_MINTS = "secrets_broker_mints"
_INVENTORY = "secrets_broker_inventory"
_EXPOSURE = "secrets_broker_exposure"
_TABLES = (_OPS, _MINTS, _INVENTORY, _EXPOSURE)
_POLICY_TABLES = ("fleet_runtime_policy", "fleet_runtime_policy_versions")
_DEVICE_COLUMN = "secrets_broker_device_id"

# (name, information_schema data_type, nullable). Pinned as literals: coord's
# ingest route and twin door name exactly these columns.
_EXPECTED_COLUMNS: dict[str, tuple[tuple[str, str, bool], ...]] = {
    _OPS: (
        ("id", "uuid", False),
        ("tenant_id", "uuid", False),
        ("device_id", "uuid", False),
        ("agent_session_id", "uuid", True),
        ("op", "text", False),
        ("secret_refs", "ARRAY", False),
        ("outcome", "text", False),
        ("refusal_rule", "text", True),
        ("fingerprints", "ARRAY", False),
        ("at", "timestamp with time zone", False),
        ("ingested_at", "timestamp with time zone", False),
    ),
    _MINTS: (
        ("id", "uuid", False),
        ("tenant_id", "uuid", False),
        ("op_id", "uuid", False),
        ("kind", "text", False),
        ("scope", "jsonb", False),
        ("minted_at", "timestamp with time zone", False),
        ("expires_at", "timestamp with time zone", False),
        ("delivered_to", "text", False),
    ),
    _INVENTORY: (
        ("tenant_id", "uuid", False),
        ("ref", "text", False),
        ("store", "text", False),
        ("type", "text", False),
        ("scopes", "ARRAY", False),
        ("last_rotated_at", "timestamp with time zone", True),
        ("expires_at", "timestamp with time zone", True),
        ("rotation_due_at", "timestamp with time zone", True),
        ("fingerprint16", "text", True),
        ("observed_at", "timestamp with time zone", False),
    ),
    _EXPOSURE: (
        ("tenant_id", "uuid", False),
        ("principal", "text", False),
        ("secret_ref", "text", False),
        ("action", "text", False),
        ("decision", "text", False),
        ("observed_at", "timestamp with time zone", False),
    ),
}

# Name fragments a value-bearing column would carry. `fingerprints` /
# `fingerprint16` are keyed HMAC truncations, not values, and are exempt by
# name below.
_VALUE_SHAPED_NAMES = (
    "value",
    "secret",
    "token",
    "password",
    "plaintext",
    "ciphertext",
    "key",
)
_VALUE_NAME_EXEMPT = frozenset({"secret_refs", "secret_ref"})

_CHECK_VIOLATION = "23514"
_FOREIGN_KEY_VIOLATION = "23503"

# The canary: a value a careless writer might put where a reference belongs.
_CANARY = 'Sup3r$ecret-Canary!42 "quoted"'
_CANARY_JSON = json.dumps(_CANARY)[1:-1]  # the JSON-escaped form, unquoted
_CANARY_B64 = base64.b64encode(_CANARY.encode()).decode()
_SHA256_HEX = "9f" * 32
_CANARY_HEX = _CANARY.encode().hex()
_ACCOUNT_RUN = "047719635665"
# A lowercase value-shaped token with no 16-hex and no 12-digit run: it fits
# the op / refusal_rule / mint-tag grammars, which is the documented residual.
_TOKEN_LOWER = "kq3zt7mvx9wbn2plr8yhj4cswg6u"
# The canary's five raw forms, planted into every text column.
_RAW_FORMS = {
    "literal": _CANARY,
    "json": _CANARY_JSON,
    "base64": _CANARY_B64,
    "hex": _CANARY_HEX,
    "digits": _ACCOUNT_RUN,
}

_FP_A = "0123456789abcdef"
_FP_B = "fedcba9876543210"
_SSM_REF = "ssm:eu-central-1:/qontinui/operator/password"
_SM_REF = "sm:us-east-1:qontinui/broker/github-app-private-key"
_SM_JSON_REF = "sm:us-east-1:qontinui/staging/coord/app#private_key"
_SSM_FLAT_REF = "ssm:eu-central-1:qontinui_operator_password"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG_DSN or QONTINUI_TEST_PG)",
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _normalized(sql: str) -> str:
    return " ".join(sql.split())


@pytest.fixture(scope="module")
def upgraded() -> Iterator[Engine]:
    """One database migrated to this revision, shared by the non-destructive tests.

    Every test that writes uses tenants of its own, so the tests do not depend
    on each other's rows or on their order.
    """
    if not can_connect(admin_database_url()):
        pytest.skip(
            "test Postgres unreachable (set QONTINUI_TEST_PG_DSN or QONTINUI_TEST_PG)"
        )
    with ephemeral_database(admin_database_url(), "sb01") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


def _new_tenant(engine: Engine) -> str:
    tenant_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (CAST(:t AS uuid), :s, :s)"
            ),
            {"t": tenant_id, "s": f"sb01-{tenant_id[:8]}"},
        )
    return tenant_id


def _op_row(tenant: str, /, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant,
        "device_id": str(uuid.uuid4()),
        "agent_session_id": str(uuid.uuid4()),
        "op": "github.set_actions_secret",
        "secret_refs": [_SM_REF],
        "outcome": "ok",
        "refusal_rule": None,
        "fingerprints": [_FP_A],
    }
    row.update(overrides)
    return row


def _insert_op(engine: Engine, row: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.secrets_broker_ops
                    (id, tenant_id, device_id, agent_session_id, op, secret_refs,
                     outcome, refusal_rule, fingerprints, at)
                VALUES (CAST(:id AS uuid), CAST(:tenant_id AS uuid),
                        CAST(:device_id AS uuid), CAST(:agent_session_id AS uuid),
                        :op, :secret_refs, :outcome, :refusal_rule,
                        :fingerprints, now())
                """
            ),
            row,
        )


def _mint_row(tenant: str, op_id: str, /, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant,
        "op_id": op_id,
        "kind": "github_installation",
        "scope": json.dumps(
            {"repos": ["qontinui/qontinui-web"], "permissions": {"contents": "write"}}
        ),
        "delivered_to": "git-helper",
    }
    row.update(overrides)
    return row


def _insert_mint(engine: Engine, row: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.secrets_broker_mints
                    (id, tenant_id, op_id, kind, scope, minted_at, expires_at,
                     delivered_to)
                VALUES (CAST(:id AS uuid), CAST(:tenant_id AS uuid),
                        CAST(:op_id AS uuid), :kind, CAST(:scope AS jsonb), now(),
                        now() + interval '1 hour', :delivered_to)
                """
            ),
            row,
        )


def _inventory_row(tenant: str, /, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "tenant_id": tenant,
        "ref": _SSM_REF,
        "store": "ssm",
        "type": "SecureString",
        "scopes": ["kms:alias/aws/ssm", "tier:standard"],
        "fingerprint16": None,
    }
    row.update(overrides)
    return row


def _insert_inventory(engine: Engine, row: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.secrets_broker_inventory
                    (tenant_id, ref, store, type, scopes, fingerprint16, observed_at)
                VALUES (CAST(:tenant_id AS uuid), :ref, :store, :type, :scopes,
                        :fingerprint16, now())
                """
            ),
            row,
        )


def _exposure_row(tenant: str, /, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "tenant_id": tenant,
        "principal": "user/josh",
        "secret_ref": _SSM_REF,
        "action": "ssm:GetParameter",
        "decision": "allowed",
    }
    row.update(overrides)
    return row


def _insert_exposure(engine: Engine, row: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.secrets_broker_exposure
                    (tenant_id, principal, secret_ref, action, decision, observed_at)
                VALUES (CAST(:tenant_id AS uuid), :principal, :secret_ref, :action,
                        :decision, now())
                """
            ),
            row,
        )


_INSERTERS = {
    _OPS: (_op_row, _insert_op),
    _INVENTORY: (_inventory_row, _insert_inventory),
    _EXPOSURE: (_exposure_row, _insert_exposure),
}


def _refused(engine: Engine, table: str, tenant: str, **overrides: object) -> tuple:
    """Insert a row of ``table`` with ``overrides``; require a refusal.

    Returns ``(SQLSTATE, constraint name)``.
    """
    make, insert = _INSERTERS[table]
    with pytest.raises(IntegrityError) as refused:
        insert(engine, make(tenant, **overrides))
    orig = refused.value.orig
    diag = getattr(orig, "diag", None)
    return getattr(orig, "pgcode", None), getattr(diag, "constraint_name", None)


# ---------------------------------------------------------------------------
# Source-level checks (no database).
# ---------------------------------------------------------------------------


def test_the_revision_is_wired_to_its_pinned_parent() -> None:
    source = _revision_path().read_text(encoding="utf-8")
    assert declared_parent_revision_id(source, _REVISION_ID) == _PARENT_REVISION_ID
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None
    doc = ast.get_docstring(ast.parse(source)) or ""
    assert f"Revision ID: {_REVISION_ID}" in doc
    assert f"Revises: {_PARENT_REVISION_ID}" in doc


def test_the_upgrade_is_static_coord_statements_the_classifier_admits() -> None:
    calls = upgrade_execute_calls(_revision_path())
    statements = [call.sql for call in calls]
    assert all(sql is not None for sql in statements), (
        "every op.execute in upgrade() must take ONE static string literal; "
        f"got {statements!r}"
    )
    assert not any(call.in_autocommit_block for call in calls)
    normalized = [_normalized(sql or "") for sql in statements]

    creates = [s for s in normalized if s.startswith("CREATE TABLE")]
    assert [s.split(" (", 1)[0] for s in creates] == [
        f"CREATE TABLE IF NOT EXISTS coord.{t}" for t in _TABLES
    ]
    indexes = [s for s in normalized if s.startswith("CREATE INDEX")]
    for index in indexes:
        assert index.startswith("CREATE INDEX IF NOT EXISTS "), index
        target = index.split(" ON ", 1)[1].split(" ", 1)[0]
        assert target in {f"coord.{t}" for t in _TABLES}, index
    alters = [s for s in normalized if s.startswith("ALTER TABLE")]
    assert alters == [
        f"ALTER TABLE coord.{t} ADD COLUMN IF NOT EXISTS {_DEVICE_COLUMN} UUID"
        for t in _POLICY_TABLES
    ]
    comments = [s for s in normalized if s.startswith("COMMENT ON ")]
    assert len(creates) + len(indexes) + len(alters) + len(comments) == len(
        normalized
    ), normalized
    for statement in normalized:
        upper = statement.upper()
        # `ON DELETE CASCADE` is a key clause, not DML, so DML is checked by
        # the statement's leading keyword (the classifier's own test).
        assert not upper.startswith(("INSERT", "UPDATE", "DELETE", "MERGE")), statement
        for token in ("DROP ", "GRANT ", "REVOKE ", "CONCURRENTLY", ";"):
            assert token not in upper, (token, statement)


def test_the_downgrade_drops_exactly_the_tables_and_columns() -> None:
    tree = ast.parse(_revision_path().read_text(encoding="utf-8"))
    downgrade = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "downgrade"
    )
    executed = [
        _normalized(node.args[0].value)
        for node in ast.walk(downgrade)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "execute"
        and len(node.args) == 1
        and isinstance(node.args[0], ast.Constant)
    ]
    assert executed == [
        f"DROP TABLE IF EXISTS coord.{_MINTS}",
        f"DROP TABLE IF EXISTS coord.{_OPS}",
        f"DROP TABLE IF EXISTS coord.{_INVENTORY}",
        f"DROP TABLE IF EXISTS coord.{_EXPOSURE}",
        "ALTER TABLE coord.fleet_runtime_policy_versions "
        f"DROP COLUMN IF EXISTS {_DEVICE_COLUMN}",
        f"ALTER TABLE coord.fleet_runtime_policy DROP COLUMN IF EXISTS {_DEVICE_COLUMN}",
    ]


# ---------------------------------------------------------------------------
# The catalog at this revision.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("table", _TABLES)
def test_each_table_lands_with_exactly_its_pinned_columns(
    upgraded: Engine, table: str
) -> None:
    assert table_exists(upgraded, _SCHEMA, table)
    expected = _EXPECTED_COLUMNS[table]
    for name, data_type, nullable in expected:
        info = column_info(upgraded, table, name, schema=_SCHEMA)
        assert info is not None, f"coord.{table}.{name} missing"
        assert info[0] == data_type, (table, name, info)
        assert info[1] == ("YES" if nullable else "NO"), (table, name, info)
    column_count = scalar(
        upgraded,
        """
        SELECT count(*) FROM information_schema.columns
         WHERE table_schema = :schema AND table_name = :table
        """,
        schema=_SCHEMA,
        table=table,
    )
    assert column_count == len(expected)


def test_no_column_is_shaped_to_hold_a_secret_value(upgraded: Engine) -> None:
    with upgraded.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT table_name::text, column_name::text, data_type::text,
                       udt_name::text
                  FROM information_schema.columns
                 WHERE table_schema = 'coord'
                   AND table_name = ANY(:tables)
                """
            ),
            {"tables": list(_TABLES)},
        ).fetchall()
    assert {r[0] for r in rows} == set(_TABLES)
    for table, column, data_type, udt in rows:
        assert data_type != "bytea" and udt != "_bytea", (table, column)
        if column in _VALUE_NAME_EXEMPT or column.startswith("fingerprint"):
            continue
        for fragment in _VALUE_SHAPED_NAMES:
            assert fragment not in column, (table, column)
        # Array columns are references, fingerprints or scopes, all CHECKed.
        if data_type == "ARRAY":
            assert column in {"secret_refs", "fingerprints", "scopes"}, (table, column)


def test_every_table_has_a_primary_key_and_a_tenant_index(upgraded: Engine) -> None:
    for table in _TABLES:
        has_pk = scalar(
            upgraded,
            """
            SELECT EXISTS(SELECT 1 FROM pg_constraint
                           WHERE conrelid = to_regclass(:rel) AND contype = 'p')
            """,
            rel=f"coord.{table}",
        )
        assert has_pk, table
        leads_on_tenant = scalar(
            upgraded,
            """
            SELECT EXISTS(
                SELECT 1 FROM pg_index i
                  JOIN pg_attribute a
                    ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                 WHERE i.indrelid = to_regclass(:rel) AND a.attname = 'tenant_id')
            """,
            rel=f"coord.{table}",
        )
        assert leads_on_tenant, table
        cascades = scalar(
            upgraded,
            """
            SELECT EXISTS(
                SELECT 1 FROM pg_constraint
                 WHERE conrelid = to_regclass(:rel) AND contype = 'f'
                   AND confrelid = to_regclass('coord.tenants')
                   AND confdeltype = 'c')
            """,
            rel=f"coord.{table}",
        )
        assert cascades, table


# ---------------------------------------------------------------------------
# Twin redaction by construction (D4).
# ---------------------------------------------------------------------------


# Every free-text-looking column, with the canary's base64 and hex forms and a
# 12-digit run (an account id) planted RAW. Where a column carries its own
# 12-digit / 16-hex refusal (op, refusal_rule, action, the non-principal
# scopes) they are also planted wrapped in the column's grammar, so those
# refusals themselves are exercised. A principal or a user/ role/ scope is
# deliberately NOT refused for a wrapped run: see the residual accept tests.
_ENTROPY_CASES = [
    # ops.op
    (_OPS, {"op": _CANARY_B64}, "ck_secrets_broker_ops_op"),
    (_OPS, {"op": _CANARY_HEX}, "ck_secrets_broker_ops_op"),
    (_OPS, {"op": f"github.x{_CANARY_HEX}"}, "ck_secrets_broker_ops_op"),
    (_OPS, {"op": _ACCOUNT_RUN}, "ck_secrets_broker_ops_op"),
    (_OPS, {"op": f"github.x{_ACCOUNT_RUN}"}, "ck_secrets_broker_ops_op"),
    # ops.refusal_rule
    *[
        (
            _OPS,
            {"outcome": "refused", "refusal_rule": rule},
            "ck_secrets_broker_ops_refusal_rule",
        )
        for rule in (
            _CANARY_B64,
            _CANARY_HEX,
            f"rule.x{_CANARY_HEX}",
            _ACCOUNT_RUN,
            f"rule.x{_ACCOUNT_RUN}",
        )
    ],
    # inventory.scopes
    *[
        (_INVENTORY, {"scopes": [scope]}, "ck_secrets_broker_inventory_scopes")
        for scope in (
            _CANARY_B64,
            _CANARY_HEX,
            _ACCOUNT_RUN,
            f"tag:{_CANARY_HEX}",
            f"tag:team-{_ACCOUNT_RUN}",
            f"kms:alias/{_CANARY_HEX}",
            f"ecs:prod/{_CANARY_HEX[:60]}",
            "kms:0f8c2b1e-4d3a-4b5c-9e6f-7a8b9c0d1e2f",
            "alias/aws/ssm",
            "tier:premium",
            "rotation:sometimes",
            f"tag:{'k' * 129}",
        )
    ],
    # exposure.principal
    *[
        (_EXPOSURE, {"principal": principal}, "ck_secrets_broker_exposure_principal")
        for principal in (
            _CANARY_B64,
            _CANARY_HEX,
        )
    ],
    # exposure.action
    *[
        (_EXPOSURE, {"action": action}, "ck_secrets_broker_exposure_action")
        for action in (
            _CANARY_B64,
            _CANARY_HEX,
            f"ssm:G{_CANARY_HEX[:60]}",
            f"ssm:Get{_ACCOUNT_RUN}",
            f"ssm:{_CANARY_B64}",
            "ssm:getParameter",
            "iam:GetUser",
            "kms:Decrypt2",
        )
    ],
]


@pytest.mark.parametrize(("table", "overrides", "constraint"), _ENTROPY_CASES)
def test_a_base64_hex_or_account_id_run_is_refused_in_every_free_text_column(
    upgraded: Engine, table: str, overrides: dict[str, object], constraint: str
) -> None:
    tenant = _new_tenant(upgraded)
    assert _refused(upgraded, table, tenant, **overrides) == (
        _CHECK_VIOLATION,
        constraint,
    )


# One element carrying the array's old join separator must not pose as several
# valid elements: each array column validates every element on its own.
@pytest.mark.parametrize(
    ("table", "overrides", "constraint"),
    [
        (
            _OPS,
            {"fingerprints": [",".join(["9f" * 8] * 4)]},
            "ck_secrets_broker_ops_fingerprints",
        ),
        (
            _OPS,
            {"fingerprints": [_FP_A + _FP_B]},
            "ck_secrets_broker_ops_fingerprints",
        ),
        (
            _OPS,
            {"secret_refs": [f"{_SSM_REF} {_SM_REF}"]},
            "ck_secrets_broker_ops_secret_refs",
        ),
        (
            _OPS,
            {"secret_refs": [f"{_SSM_REF},{_SM_REF}"]},
            "ck_secrets_broker_ops_secret_refs",
        ),
        (
            _INVENTORY,
            {"scopes": ["tier:standard tier:advanced"]},
            "ck_secrets_broker_inventory_scopes",
        ),
        (
            _INVENTORY,
            {"scopes": ["kms:alias/aws/ssm rotation:enabled"]},
            "ck_secrets_broker_inventory_scopes",
        ),
    ],
)
def test_a_separator_inside_one_element_is_refused(
    upgraded: Engine, table: str, overrides: dict[str, object], constraint: str
) -> None:
    tenant = _new_tenant(upgraded)
    assert _refused(upgraded, table, tenant, **overrides) == (
        _CHECK_VIOLATION,
        constraint,
    )


_RAW_COLUMNS = [
    (_OPS, lambda v: {"secret_refs": [v]}, "ck_secrets_broker_ops_secret_refs"),
    (_INVENTORY, lambda v: {"ref": v}, "ck_secrets_broker_inventory_ref"),
    (_EXPOSURE, lambda v: {"secret_ref": v}, "ck_secrets_broker_exposure_secret_ref"),
    (_OPS, lambda v: {"fingerprints": [v]}, "ck_secrets_broker_ops_fingerprints"),
    (
        _INVENTORY,
        lambda v: {"fingerprint16": v},
        "ck_secrets_broker_inventory_fingerprint16",
    ),
    (_OPS, lambda v: {"op": v}, "ck_secrets_broker_ops_op"),
    (
        _OPS,
        lambda v: {"outcome": "refused", "refusal_rule": v},
        "ck_secrets_broker_ops_refusal_rule",
    ),
    (_INVENTORY, lambda v: {"scopes": [v]}, "ck_secrets_broker_inventory_scopes"),
    (_EXPOSURE, lambda v: {"principal": v}, "ck_secrets_broker_exposure_principal"),
    (_EXPOSURE, lambda v: {"action": v}, "ck_secrets_broker_exposure_action"),
    # The six closed-vocabulary TEXT columns.
    (_OPS, lambda v: {"outcome": v}, "ck_secrets_broker_ops_outcome"),
    (_MINTS, lambda v: {"kind": v}, "ck_secrets_broker_mints_kind"),
    (_MINTS, lambda v: {"delivered_to": v}, "ck_secrets_broker_mints_delivered_to"),
    (_INVENTORY, lambda v: {"store": v}, "ck_secrets_broker_inventory_store"),
    (_INVENTORY, lambda v: {"type": v}, "ck_secrets_broker_inventory_type"),
    (_EXPOSURE, lambda v: {"decision": v}, "ck_secrets_broker_exposure_decision"),
]


@pytest.mark.parametrize("form", sorted(_RAW_FORMS))
@pytest.mark.parametrize(
    ("table", "build", "constraint"),
    _RAW_COLUMNS,
    ids=[c[2] for c in _RAW_COLUMNS],
)
def test_every_raw_canary_form_is_refused_in_every_text_column(
    upgraded: Engine, table: str, build, constraint: str, form: str
) -> None:
    tenant = _new_tenant(upgraded)
    if table == _MINTS:
        op = _op_row(tenant)
        _insert_op(upgraded, op)
        with pytest.raises(IntegrityError) as refused:
            _insert_mint(
                upgraded,
                _mint_row(tenant, str(op["id"]), **build(_RAW_FORMS[form])),
            )
        orig = refused.value.orig
        diag = getattr(orig, "diag", None)
        got = (getattr(orig, "pgcode", None), getattr(diag, "constraint_name", None))
    else:
        got = _refused(upgraded, table, tenant, **build(_RAW_FORMS[form]))
    assert got == (_CHECK_VIOLATION, constraint)


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"kind": "ssh_key"}, "ck_secrets_broker_mints_kind"),
        ({"kind": "GITHUB_INSTALLATION"}, "ck_secrets_broker_mints_kind"),
        ({"delivered_to": "stdout"}, "ck_secrets_broker_mints_delivered_to"),
        ({"delivered_to": "model"}, "ck_secrets_broker_mints_delivered_to"),
    ],
)
def test_an_unknown_mint_kind_or_delivery_is_refused(
    upgraded: Engine, overrides: dict[str, object], constraint: str
) -> None:
    tenant = _new_tenant(upgraded)
    op = _op_row(tenant)
    _insert_op(upgraded, op)
    with pytest.raises(IntegrityError) as refused:
        _insert_mint(upgraded, _mint_row(tenant, str(op["id"]), **overrides))
    orig = refused.value.orig
    assert getattr(orig, "pgcode", None) == _CHECK_VIOLATION
    assert getattr(getattr(orig, "diag", None), "constraint_name", None) == constraint


def test_an_op_carries_at_most_two_fingerprints(upgraded: Engine) -> None:
    tenant = _new_tenant(upgraded)
    _insert_op(upgraded, _op_row(tenant, fingerprints=[_FP_A, _FP_B]))
    assert _refused(
        upgraded, _OPS, tenant, fingerprints=[_FP_A, _FP_B, "00112233445566ff"]
    ) == (_CHECK_VIOLATION, "ck_secrets_broker_ops_fingerprints")


# THE DOCUMENTED RESIDUAL, pinned so it cannot be mistaken for coverage: a
# value-shaped string spelled to fit a NAME grammar is accepted by the schema.
# coord's ingest guard owns refusing it (a loud 422 naming the column plus a
# coord finding). If one of these starts being refused, the residual statement
# in the revision docstring has to change with it.
@pytest.mark.parametrize(
    ("table", "overrides"),
    [
        (_EXPOSURE, {"principal": f"user/{_CANARY_B64}"}),
        (_EXPOSURE, {"principal": "role/ghp_" + "A1b2C3d4" * 4 + "Z9y8"}),
        (_INVENTORY, {"scopes": [f"user/{_CANARY_B64}"]}),
        (_INVENTORY, {"scopes": [f"tag:{_CANARY_B64}"]}),
        (_INVENTORY, {"scopes": [f"kms:alias/{_CANARY_B64}"]}),
        (_INVENTORY, {"ref": f"sm:us-east-1:{_CANARY_B64}"}),
        # The remaining name-grammar members, one each.
        (_INVENTORY, {"scopes": [f"role/{_CANARY_B64}"]}),
        (_INVENTORY, {"scopes": [f"ecs:{_CANARY_B64}/svc"]}),
        (_OPS, {"op": f"github.{_TOKEN_LOWER}"}),
        (_OPS, {"outcome": "refused", "refusal_rule": f"rule.{_TOKEN_LOWER}"}),
        (_EXPOSURE, {"action": "ssm:GhpQwErTyUiOpAsDfg"}),
        (_OPS, {"secret_refs": [f"ssm:eu-central-1:{_CANARY_B64}"]}),
        (_INVENTORY, {"ref": f"ssm:eu-central-1:{_CANARY_B64}"}),
        # A value chunked into fingerprint- or uuid-shaped pieces.
        (_OPS, {"fingerprints": [_SHA256_HEX[:16], _SHA256_HEX[16:32]]}),
        (_INVENTORY, {"fingerprint16": _SHA256_HEX[32:48]}),
        (_OPS, {"device_id": str(uuid.UUID(hex=_CANARY_HEX[:32]))}),
        (_OPS, {"id": str(uuid.UUID(hex=_CANARY_HEX[16:48]))}),
        (_EXPOSURE, {"secret_ref": f"ssm:eu-central-1:{_CANARY_B64}"}),
        (_OPS, {"agent_session_id": str(uuid.UUID(hex=_SHA256_HEX[32:64]))}),
    ],
)
def test_the_residual_a_value_shaped_name_is_accepted(
    upgraded: Engine, table: str, overrides: dict[str, object]
) -> None:
    tenant = _new_tenant(upgraded)
    make, insert = _INSERTERS[table]
    row = make(tenant, **overrides)
    if table == _INVENTORY and str(overrides.get("ref", "")).startswith("sm:"):
        row["store"] = "sm"
        row["type"] = "secret"
    insert(upgraded, row)


def test_the_residual_hex_shaped_uuid_columns_are_accepted(upgraded: Engine) -> None:
    """THE DOCUMENTED RESIDUAL, uuid members: every uuid column holds 32 hex of
    anything. tenant_id, op_id and the fleet-policy secrets_broker_device_id are
    pinned here (id, device_id and agent_session_id in the parametrized test
    above), so tightening any of them turns this red."""
    tenant = str(uuid.UUID(hex=_SHA256_HEX[:32]))
    with upgraded.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (CAST(:t AS uuid), :s, :s)"
            ),
            {"t": tenant, "s": f"sb01-hex-{uuid.uuid4().hex[:8]}"},
        )
    # tenant_id (every table) and op_id (mints) hex-shaped.
    op = _op_row(tenant, id=str(uuid.UUID(hex=_SHA256_HEX[32:64])))
    _insert_op(upgraded, op)
    _insert_mint(upgraded, _mint_row(tenant, str(op["id"])))
    _insert_inventory(upgraded, _inventory_row(tenant))
    _insert_exposure(upgraded, _exposure_row(tenant))
    # secrets_broker_device_id on the fleet-policy row and its snapshot.
    device = str(uuid.UUID(hex=_CANARY_HEX[:32]))
    with upgraded.begin() as conn:
        policy_id = conn.execute(
            text(
                """
                INSERT INTO coord.fleet_runtime_policy
                    (tenant_id, domain, scope_band, scope_key, level,
                     master_enabled, current_version, updated_by,
                     secrets_broker_device_id)
                VALUES (CAST(:t AS uuid), 'secrets_broker', 'tenant', NULL, 'on',
                        true, 1, 'test', CAST(:d AS uuid))
                RETURNING id
                """
            ),
            {"t": tenant, "d": device},
        ).scalar_one()
        conn.execute(
            text(
                "INSERT INTO coord.fleet_runtime_policy_versions "
                "(policy_id, version, level, master_enabled, change_note, "
                "updated_by, secrets_broker_device_id) "
                "VALUES (:p, 1, 'on', true, 'test', 'test', CAST(:d AS uuid))"
            ),
            {"p": policy_id, "d": device},
        )
    for table in _TABLES:
        assert (
            scalar(
                upgraded,
                f"SELECT count(*) FROM coord.{table} WHERE tenant_id = CAST(:t AS uuid)",
                t=tenant,
            )
            == 1
        ), table


def test_every_table_comment_names_the_residual(upgraded: Engine) -> None:
    """The persisted table comments make no absolute "never a value" claim."""
    for table in _TABLES:
        comment = scalar(
            upgraded,
            "SELECT obj_description(to_regclass(:rel), 'pg_class')",
            rel=f"coord.{table}",
        )
        assert isinstance(comment, str), table
        assert "coord ingest" in comment, (table, comment)
        assert "secrets_broker_01" in comment or table == _EXPOSURE, table
        assert "Never a value" not in comment and "never stored" not in comment


@pytest.mark.parametrize(
    "scopes",
    [
        [],
        ["kms:alias/aws/ssm"],
        ["kms:alias/qontinui/broker", "tier:advanced", "rotation:enabled"],
        ["user/josh", "role/qontinui-coord-deploy"],
        ["ecs:qontinui-staging-cluster/qontinui-staging-coord", "tag:owner"],
        ["tier:intelligent-tiering", "rotation:disabled", "tag:aws:cloudformation"],
        ["tag:Cost Center", "tag:team@ops/+=-.:_"],
        [
            "role/aws-reserved/sso.amazonaws.com/"
            "AWSReservedSSO_ReadOnly_0123456789abcdef",
            "role/qontinui-broker-20261020123456789012345678",
            "role/service-role/x",
        ],
    ],
)
def test_the_inventory_scope_vocabulary_accepts_its_closed_prefix_set(
    upgraded: Engine, scopes: list[str]
) -> None:
    tenant = _new_tenant(upgraded)
    _insert_inventory(upgraded, _inventory_row(tenant, scopes=scopes))


@pytest.mark.parametrize(
    ("table", "overrides", "constraint"),
    [
        # A value where a reference belongs, in either column that holds refs.
        (_OPS, {"secret_refs": [_CANARY]}, "ck_secrets_broker_ops_secret_refs"),
        (
            _OPS,
            {"secret_refs": [_SSM_REF, _CANARY_JSON]},
            "ck_secrets_broker_ops_secret_refs",
        ),
        (
            _OPS,
            {"secret_refs": [f"{_SSM_REF} {_CANARY}"]},
            "ck_secrets_broker_ops_secret_refs",
        ),
        (_OPS, {"secret_refs": [None]}, "ck_secrets_broker_ops_secret_refs"),
        (_INVENTORY, {"ref": _CANARY}, "ck_secrets_broker_inventory_ref"),
        (
            _INVENTORY,
            {"ref": "ssm:eu-central-1:flat name"},
            "ck_secrets_broker_inventory_ref",
        ),
        (
            _INVENTORY,
            {"ref": f"{_SSM_REF}?v={_CANARY_B64}"},
            "ck_secrets_broker_inventory_ref",
        ),
        (
            _EXPOSURE,
            {"secret_ref": _CANARY_JSON},
            "ck_secrets_broker_exposure_secret_ref",
        ),
        # A digest or an encoded value where a 16-hex keyed fingerprint belongs.
        (_OPS, {"fingerprints": [_SHA256_HEX]}, "ck_secrets_broker_ops_fingerprints"),
        (_OPS, {"fingerprints": [_FP_A.upper()]}, "ck_secrets_broker_ops_fingerprints"),
        (_OPS, {"fingerprints": [_CANARY_B64]}, "ck_secrets_broker_ops_fingerprints"),
        (_OPS, {"fingerprints": [_FP_A, None]}, "ck_secrets_broker_ops_fingerprints"),
        (
            _INVENTORY,
            {"fingerprint16": _SHA256_HEX},
            "ck_secrets_broker_inventory_fingerprint16",
        ),
        (
            _INVENTORY,
            {"fingerprint16": _CANARY_B64[:16]},
            "ck_secrets_broker_inventory_fingerprint16",
        ),
        # Free-text-looking columns are narrow grammars.
        (_OPS, {"op": _CANARY}, "ck_secrets_broker_ops_op"),
        (
            _OPS,
            {"outcome": "refused", "refusal_rule": _CANARY_JSON},
            "ck_secrets_broker_ops_refusal_rule",
        ),
        (_INVENTORY, {"scopes": [_CANARY]}, "ck_secrets_broker_inventory_scopes"),
        (_EXPOSURE, {"action": _CANARY}, "ck_secrets_broker_exposure_action"),
        (_EXPOSURE, {"principal": _CANARY}, "ck_secrets_broker_exposure_principal"),
    ],
)
def test_a_canary_value_is_refused_wherever_a_writer_could_put_it(
    upgraded: Engine, table: str, overrides: dict[str, object], constraint: str
) -> None:
    tenant = _new_tenant(upgraded)
    assert _refused(upgraded, table, tenant, **overrides) == (
        _CHECK_VIOLATION,
        constraint,
    )


_GH = "github_installation"
_TS = "tailscale_auth_key"
_GH_OK = {"repos": ["qontinui/qontinui-web"], "permissions": {"contents": "write"}}
_TS_OK = {"tags": ["tag:ci-host"], "ephemeral": True}


def _with(base: dict[str, object], **changes: object) -> dict[str, object]:
    return {**base, **changes}


@pytest.mark.parametrize(
    ("kind", "scope"),
    [
        # The shape: fixed keys per kind, an object, never a bare value.
        (_GH, _with(_GH_OK, token="ghs_x")),
        (_GH, {"repos": ["qontinui/qontinui-web"]}),
        (_GH, _with(_GH_OK, repos="qontinui/qontinui-web")),
        (_GH, _with(_GH_OK, repos=[])),
        (_GH, _CANARY),
        (_GH, [_CANARY]),
        (_GH, _TS_OK),
        (_TS, _GH_OK),
        (_TS, {"tags": ["tag:ci-host"]}),
        (_TS, _with(_TS_OK, reusable="no")),
        (_TS, _with(_TS_OK, tags=[])),
        (_TS, _with(_TS_OK, ephemeral="true")),
        # The canary planted in every nested position.
        (_GH, _with(_GH_OK, repos=[_CANARY])),
        (_GH, _with(_GH_OK, repos=["qontinui/qontinui-web", _CANARY_B64])),
        (_GH, _with(_GH_OK, repos=[_CANARY_JSON])),
        (_GH, _with(_GH_OK, repos=[{"name": _CANARY}])),
        (_GH, _with(_GH_OK, permissions={"contents": _CANARY})),
        (_GH, _with(_GH_OK, permissions={"contents": _CANARY_B64})),
        (_GH, _with(_GH_OK, permissions={_CANARY: "read"})),
        (_GH, _with(_GH_OK, permissions={"contents": ["write"]})),
        (_GH, _with(_GH_OK, permissions={"contents": {"v": _CANARY}})),
        (_TS, _with(_TS_OK, tags=[_CANARY])),
        (_TS, _with(_TS_OK, tags=["tag:ci-host", _CANARY_B64])),
        (_TS, _with(_TS_OK, tags=[f"tag:{_CANARY}"])),
        (_TS, _with(_TS_OK, tags=[["tag:ci-host"]])),
        # Length caps: owner <= 39, repo name <= 100, permission key <= 64,
        # tag name <= 64.
        (_GH, _with(_GH_OK, repos=[f"{'o' * 40}/repo"])),
        (_GH, _with(_GH_OK, repos=[f"owner/{'r' * 101}"])),
        (_GH, _with(_GH_OK, permissions={"k" * 65: "read"})),
        (_TS, _with(_TS_OK, tags=[f"tag:{'t' * 65}"])),
    ],
)
def test_a_mint_scope_refuses_a_value_in_every_position(
    upgraded: Engine, kind: str, scope: object
) -> None:
    tenant = _new_tenant(upgraded)
    op = _op_row(tenant)
    _insert_op(upgraded, op)
    with pytest.raises(IntegrityError) as refused:
        _insert_mint(
            upgraded,
            _mint_row(tenant, str(op["id"]), kind=kind, scope=json.dumps(scope)),
        )
    diag = getattr(refused.value.orig, "diag", None)
    assert getattr(refused.value.orig, "pgcode", None) == _CHECK_VIOLATION
    assert getattr(diag, "constraint_name", None) == "ck_secrets_broker_mints_scope"


_MINT_POSITIONS = [
    ("repos element", _GH, lambda v: _with(_GH_OK, repos=[v])),
    ("permissions key", _GH, lambda v: _with(_GH_OK, permissions={v: "read"})),
    (
        "permissions value",
        _GH,
        lambda v: _with(_GH_OK, permissions={"contents": v}),
    ),
    ("tags element", _TS, lambda v: _with(_TS_OK, tags=[v])),
]


@pytest.mark.parametrize("form", sorted(_RAW_FORMS))
@pytest.mark.parametrize(
    ("position", "kind", "build"), _MINT_POSITIONS, ids=[p[0] for p in _MINT_POSITIONS]
)
def test_every_raw_canary_form_is_refused_in_every_mint_scope_position(
    upgraded: Engine, position: str, kind: str, build, form: str
) -> None:
    tenant = _new_tenant(upgraded)
    op = _op_row(tenant)
    _insert_op(upgraded, op)
    with pytest.raises(IntegrityError) as refused:
        _insert_mint(
            upgraded,
            _mint_row(
                tenant,
                str(op["id"]),
                kind=kind,
                scope=json.dumps(build(_RAW_FORMS[form])),
            ),
        )
    diag = getattr(refused.value.orig, "diag", None)
    assert getattr(diag, "constraint_name", None) == "ck_secrets_broker_mints_scope"


# THE DOCUMENTED RESIDUAL, mint-scope members: a value-shaped string spelled to
# fit a repos element, a permission key or a mint tag is accepted by the
# schema; coord's ingest guard owns refusing it.
@pytest.mark.parametrize(
    ("kind", "scope"),
    [
        (_GH, _with(_GH_OK, repos=[f"x/ghp_{'A1b2' * 9}"])),
        (_GH, _with(_GH_OK, permissions={"ghp_qwerty_asdfgh_zxcvbn_poiuyt": "read"})),
        (_TS, _with(_TS_OK, tags=[f"tag:{_TOKEN_LOWER}"])),
    ],
)
def test_the_residual_a_value_shaped_mint_scope_name_is_accepted(
    upgraded: Engine, kind: str, scope: dict[str, object]
) -> None:
    tenant = _new_tenant(upgraded)
    op = _op_row(tenant)
    _insert_op(upgraded, op)
    _insert_mint(
        upgraded,
        _mint_row(
            tenant,
            str(op["id"]),
            kind=kind,
            delivered_to="file" if kind == _TS else "git-helper",
            scope=json.dumps(scope),
        ),
    )


@pytest.mark.parametrize(
    ("kind", "scope"),
    [
        (_GH, _GH_OK),
        (
            _GH,
            {
                "repos": ["qontinui/qontinui-web", "Meryts/bauhaus-b2b.shop"],
                "permissions": {"contents": "read", "pull_requests": "write"},
            },
        ),
        (_GH, _with(_GH_OK, permissions={"administration": "admin"})),
        (_GH, _with(_GH_OK, permissions={})),
        (
            _GH,
            _with(
                _GH_OK,
                repos=[f"{'o' * 39}/{'r' * 100}"],
                permissions={"k" * 64: "read"},
            ),
        ),
        (_TS, _with(_TS_OK, tags=[f"tag:{'t' * 64}"])),
        (_TS, _TS_OK),
        (_TS, _with(_TS_OK, reusable=False)),
        (_TS, {"tags": ["tag:ci-host", "tag:agent-box"], "ephemeral": False}),
    ],
)
def test_both_mint_kinds_insert_with_their_own_scope(
    upgraded: Engine, kind: str, scope: dict[str, object]
) -> None:
    tenant = _new_tenant(upgraded)
    op = _op_row(tenant, op="github.git_credential", secret_refs=[_SM_REF])
    _insert_op(upgraded, op)
    _insert_mint(
        upgraded,
        _mint_row(
            tenant,
            str(op["id"]),
            kind=kind,
            delivered_to="file" if kind == _TS else "git-helper",
            scope=json.dumps(scope),
        ),
    )
    count = scalar(
        upgraded,
        f"SELECT count(*) FROM coord.{_MINTS} WHERE tenant_id = CAST(:t AS uuid)",
        t=tenant,
    )
    assert count == 1


# ---------------------------------------------------------------------------
# No ARN; real IAM names (digit runs included) are accepted.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "principal",
    [
        "arn:aws:iam::047719635665:user/josh",
        "user/arn:josh",
        "role/ARN:aws",
        "group/admin",
        "josh",
        "user/",
        "user/josh smith",
        "role/service-role/",
        "role//x",
        f"user/{'n' * 65}",
    ],
)
def test_an_arn_or_malformed_principal_is_refused(
    upgraded: Engine, principal: str
) -> None:
    tenant = _new_tenant(upgraded)
    assert _refused(upgraded, _EXPOSURE, tenant, principal=principal) == (
        _CHECK_VIOLATION,
        "ck_secrets_broker_exposure_principal",
    )


@pytest.mark.parametrize(
    "principal",
    [
        "user/josh",
        "user/qontinui-box-automation-merytshost",
        "role/qontinui-coord-deploy",
        "role/qontinui-secrets-broker",
        "user/ops+ci=bot,1@example.com",
        # SSO permission-set roles end in a 16-hex suffix, under an SSO path.
        "role/aws-reserved/sso.amazonaws.com/"
        "AWSReservedSSO_AdministratorAccess_0123456789abcdef",
        # Terraform name_prefix roles end in a long digit run.
        "role/qontinui-broker-20261020123456789012345678",
        "user/josh047719635665",
        # Path roles.
        "role/service-role/x",
        "user/division/team/josh",
        f"user/{'n' * 64}",
    ],
)
def test_a_real_iam_principal_is_accepted(upgraded: Engine, principal: str) -> None:
    tenant = _new_tenant(upgraded)
    _insert_exposure(upgraded, _exposure_row(tenant, principal=principal))


# ---------------------------------------------------------------------------
# Realistic rows and the outcome / refusal_rule pairing.
# ---------------------------------------------------------------------------


def test_a_non_hierarchical_ssm_name_is_accepted_in_every_reference_column(
    upgraded: Engine,
) -> None:
    """``ssm:<region>:<name>`` (no leading ``/``) is a real SSM parameter name."""
    tenant = _new_tenant(upgraded)
    _insert_op(upgraded, _op_row(tenant, secret_refs=[_SSM_FLAT_REF, _SSM_REF]))
    _insert_inventory(upgraded, _inventory_row(tenant, ref=_SSM_FLAT_REF))
    _insert_exposure(upgraded, _exposure_row(tenant, secret_ref=_SSM_FLAT_REF))
    for table, column in (
        (_INVENTORY, "ref"),
        (_EXPOSURE, "secret_ref"),
    ):
        assert (
            scalar(
                upgraded,
                f"SELECT count(*) FROM coord.{table} "
                f"WHERE tenant_id = CAST(:t AS uuid) AND {column} = :r",
                t=tenant,
                r=_SSM_FLAT_REF,
            )
            == 1
        ), table


def test_realistic_rows_insert(upgraded: Engine) -> None:
    tenant = _new_tenant(upgraded)
    _insert_op(
        upgraded,
        _op_row(
            tenant,
            secret_refs=[_SSM_REF, _SM_REF, _SM_JSON_REF],
            fingerprints=[_FP_A, _FP_B],
        ),
    )
    _insert_op(upgraded, _op_row(tenant, secret_refs=[], fingerprints=[]))
    _insert_op(upgraded, _op_row(tenant, agent_session_id=None, outcome="error"))
    _insert_op(
        upgraded,
        _op_row(
            tenant,
            outcome="refused",
            refusal_rule="trust_tier.contributed_runner",
            fingerprints=[],
        ),
    )
    _insert_inventory(upgraded, _inventory_row(tenant, fingerprint16=_FP_A))
    _insert_inventory(
        upgraded,
        _inventory_row(tenant, ref=_SM_JSON_REF, store="sm", type="secret", scopes=[]),
    )
    for decision in ("allowed", "implicitDeny", "explicitDeny"):
        _insert_exposure(
            upgraded,
            _exposure_row(
                tenant,
                principal=f"role/r-{decision.lower()}",
                action="secretsmanager:GetSecretValue",
                decision=decision,
            ),
        )
    ingested = scalar(
        upgraded,
        f"SELECT bool_and(ingested_at IS NOT NULL) FROM coord.{_OPS} "
        "WHERE tenant_id = CAST(:t AS uuid)",
        t=tenant,
    )
    assert ingested is True


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        (
            {"outcome": "refused", "refusal_rule": None},
            "ck_secrets_broker_ops_refusal_rule",
        ),
        (
            {"outcome": "ok", "refusal_rule": "op.not_allowlisted"},
            "ck_secrets_broker_ops_refusal_rule",
        ),
        ({"outcome": "denied"}, "ck_secrets_broker_ops_outcome"),
        ({"op": "noop"}, "ck_secrets_broker_ops_op"),
        ({"op": "GitHub.Token"}, "ck_secrets_broker_ops_op"),
    ],
)
def test_the_ops_vocabulary_is_closed(
    upgraded: Engine, overrides: dict[str, object], constraint: str
) -> None:
    tenant = _new_tenant(upgraded)
    assert _refused(upgraded, _OPS, tenant, **overrides) == (
        _CHECK_VIOLATION,
        constraint,
    )


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"store": "sm"}, "ck_secrets_broker_inventory_store"),
        ({"store": "vault"}, "ck_secrets_broker_inventory_store"),
        ({"type": "secret"}, "ck_secrets_broker_inventory_type"),
        (
            {"scopes": ["arn:aws:kms:eu-central-1:x:key/y"]},
            "ck_secrets_broker_inventory_scopes",
        ),
        ({"ref": "ssm:eu-central-1:relative/path"}, "ck_secrets_broker_inventory_ref"),
        ({"ref": "ssm:EU-central-1:/x"}, "ck_secrets_broker_inventory_ref"),
        ({"ref": "vault:/secret/x"}, "ck_secrets_broker_inventory_ref"),
    ],
)
def test_the_inventory_vocabulary_is_closed(
    upgraded: Engine, overrides: dict[str, object], constraint: str
) -> None:
    tenant = _new_tenant(upgraded)
    assert _refused(upgraded, _INVENTORY, tenant, **overrides) == (
        _CHECK_VIOLATION,
        constraint,
    )


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        ({"decision": "Allowed"}, "ck_secrets_broker_exposure_decision"),
        ({"action": "GetParameter"}, "ck_secrets_broker_exposure_action"),
    ],
)
def test_the_exposure_vocabulary_is_closed(
    upgraded: Engine, overrides: dict[str, object], constraint: str
) -> None:
    tenant = _new_tenant(upgraded)
    assert _refused(upgraded, _EXPOSURE, tenant, **overrides) == (
        _CHECK_VIOLATION,
        constraint,
    )


# ---------------------------------------------------------------------------
# Tenancy: a mint belongs to its op's tenant; deletes cascade per tenant.
# ---------------------------------------------------------------------------


def test_a_mint_cannot_name_another_tenants_op(upgraded: Engine) -> None:
    owner, other = _new_tenant(upgraded), _new_tenant(upgraded)
    op = _op_row(owner)
    _insert_op(upgraded, op)
    with pytest.raises(IntegrityError) as refused:
        _insert_mint(upgraded, _mint_row(other, str(op["id"])))
    diag = getattr(refused.value.orig, "diag", None)
    assert getattr(refused.value.orig, "pgcode", None) == _FOREIGN_KEY_VIOLATION
    assert getattr(diag, "constraint_name", None) == "fk_secrets_broker_mints_op"


def test_deleting_an_op_deletes_its_mints_and_a_tenant_only_its_rows(
    upgraded: Engine,
) -> None:
    doomed, kept = _new_tenant(upgraded), _new_tenant(upgraded)
    rows: dict[str, str] = {}
    for tenant in (doomed, kept):
        op = _op_row(tenant)
        _insert_op(upgraded, op)
        _insert_mint(upgraded, _mint_row(tenant, str(op["id"])))
        _insert_inventory(upgraded, _inventory_row(tenant))
        _insert_exposure(upgraded, _exposure_row(tenant))
        rows[tenant] = str(op["id"])

    with upgraded.begin() as conn:
        conn.execute(
            text(f"DELETE FROM coord.{_OPS} WHERE id = CAST(:i AS uuid)"),
            {"i": rows[kept]},
        )
    assert (
        scalar(
            upgraded,
            f"SELECT count(*) FROM coord.{_MINTS} WHERE tenant_id = CAST(:t AS uuid)",
            t=kept,
        )
        == 0
    )

    with upgraded.begin() as conn:
        conn.execute(
            text("DELETE FROM coord.tenants WHERE tenant_id = CAST(:t AS uuid)"),
            {"t": doomed},
        )
    for table in _TABLES:
        assert (
            scalar(
                upgraded,
                f"SELECT count(*) FROM coord.{table} WHERE tenant_id = CAST(:t AS uuid)",
                t=doomed,
            )
            == 0
        ), table
    for table in (_INVENTORY, _EXPOSURE):
        assert (
            scalar(
                upgraded,
                f"SELECT count(*) FROM coord.{table} WHERE tenant_id = CAST(:t AS uuid)",
                t=kept,
            )
            == 1
        ), table


# ---------------------------------------------------------------------------
# The broker-device column on both fleet-policy tables.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("table", _POLICY_TABLES)
def test_the_broker_device_column_is_on_both_policy_tables(
    upgraded: Engine, table: str
) -> None:
    assert column_info(upgraded, table, _DEVICE_COLUMN, schema=_SCHEMA) == (
        "uuid",
        "YES",
        None,
    )
    comment = column_comment(upgraded, table, _DEVICE_COLUMN, schema=_SCHEMA)
    assert comment is not None, table
    assert "secrets broker" in comment.lower() or _DEVICE_COLUMN in comment, comment


def test_the_parent_comment_states_the_fail_closed_rule(upgraded: Engine) -> None:
    comment = column_comment(
        upgraded, "fleet_runtime_policy", _DEVICE_COLUMN, schema=_SCHEMA
    )
    assert comment is not None
    assert "admits_as_sod_actor()" in comment
    assert "fail closed" in comment
    assert "tenant's secrets broker" in comment


# ---------------------------------------------------------------------------
# Idempotency and the round trip.
# ---------------------------------------------------------------------------


def test_re_running_the_upgrade_is_a_no_op(upgraded: Engine) -> None:
    tenant = _new_tenant(upgraded)
    _insert_inventory(upgraded, _inventory_row(tenant))

    module = _module()
    with upgraded.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()

    assert (
        scalar(
            upgraded,
            f"SELECT count(*) FROM coord.{_INVENTORY} WHERE tenant_id = CAST(:t AS uuid)",
            t=tenant,
        )
        == 1
    )


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "sb01_rt") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        tenant = _new_tenant(engine)
        _insert_inventory(engine, _inventory_row(tenant))

        run_alembic(backend_root(), url, "downgrade", _PARENT_REVISION_ID)
        for table in _TABLES:
            assert not table_exists(engine, _SCHEMA, table), table
        for table in _POLICY_TABLES:
            assert column_info(engine, table, _DEVICE_COLUMN, schema=_SCHEMA) is None
        assert (
            scalar(engine, "SELECT version_num FROM public.alembic_version")
            == _PARENT_REVISION_ID
        )

        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert table_exists(engine, _SCHEMA, table), table
        for table in _POLICY_TABLES:
            assert (
                column_info(engine, table, _DEVICE_COLUMN, schema=_SCHEMA) is not None
            )
        assert (
            scalar(engine, "SELECT version_num FROM public.alembic_version")
            == _REVISION_ID
        )
