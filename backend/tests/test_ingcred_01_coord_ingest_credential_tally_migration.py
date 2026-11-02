"""Structural and round-trip test for the ``ingcred_01`` revision — Phase 1 of plan
``2026-10-16-coord-ingest-doors-take-the-tenant-from-the-request-body``.

``coord.ingest_credential_tally`` is the shadow measurement that decides when coord
may stop accepting the shared ``COORD_INGEST_TOKEN``. coord UPSERTs one row per key
per day, so three properties carry the plan:

* **The PRIMARY KEY is exactly the plan's key, in order.** coord's UPSERT names it as
  the conflict target. A missing column would merge rows that must stay apart; an
  extra one would split one key into many.
* **Each CHECK pins exactly its vocabulary.** coord writes only these values, and
  the retirement code ``shared_ingest_token_retired`` must already be allowed so
  that the plan's Phase 6 needs no migration.
* **The table is owner-only.** It is a cross-tenant ledger, so the tenant roles
  coordrls_01's default privileges would grant must hold no privilege on it.

All three are asserted against the live catalog with literal values spelled out here, so
changing the revision without changing this test turns it red.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, migrated by the real alembic chain. Without a reachable Postgres the
DB-backed tests skip and the source-level ones still run.
"""

from __future__ import annotations

import ast
import re
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
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

_REVISION_ID = "ingcred_01"
_PARENT_REVISION_ID = "coordmem_01"
_REVISION_FILENAME = "ingcred_01_coord_ingest_credential_tally.py"
_SCHEMA = "coord"
_TABLE = "ingest_credential_tally"

# (name, information_schema data_type, nullable, default-substring or None for
# "no default"). Pinned as literals: coord's tally SQL names exactly these columns.
_EXPECTED_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("day", "date", False, None),
    ("door", "text", False, None),
    ("credential_class", "text", False, None),
    ("verdict", "text", False, None),
    ("reason", "text", False, "''"),
    ("credential_repository", "text", False, "''"),
    ("body_repository", "text", False, "''"),
    ("agreement", "text", False, None),
    ("ref_class", "text", False, "''"),
    ("runner_environment", "text", False, "''"),
    ("derived_tenant_id", "uuid", True, None),
    ("body_tenant_id", "uuid", True, None),
    ("requests", "bigint", False, None),
    ("first_seen_at", "timestamp with time zone", False, "now()"),
    ("last_seen_at", "timestamp with time zone", False, "now()"),
)

# The plan's key (D5), in order. coord's UPSERT uses it as the conflict target.
_EXPECTED_KEY: tuple[str, ...] = (
    "day",
    "door",
    "credential_class",
    "verdict",
    "reason",
    "credential_repository",
    "body_repository",
    "agreement",
    "ref_class",
    "runner_environment",
)

# Each `col IN (...)` CHECK and the exact set it must allow.
_EXPECTED_VOCABULARIES: dict[str, frozenset[str]] = {
    "ingest_credential_tally_credential_class_check": frozenset(
        {"github_oidc", "shared_token"}
    ),
    "ingest_credential_tally_verdict_check": frozenset({"accepted", "refused"}),
    "ingest_credential_tally_reason_check": frozenset(
        {
            "",
            "pull_request_target_refused",
            "ingest_repository_not_tenant_owned",
            "ingest_repo_mismatch",
            "ingest_tenant_mismatch",
            "ingest_producer_mismatch",
            "ingest_ref_not_allowed",
            "shared_ingest_token_retired",
        }
    ),
    "ingest_credential_tally_agreement_check": frozenset(
        {"agree", "disagree", "unresolved", "not_applicable"}
    ),
    "ingest_credential_tally_ref_class_check": frozenset(
        {"", "default_branch", "other"}
    ),
    "ingest_credential_tally_runner_environment_check": frozenset(
        {"", "github-hosted", "self-hosted"}
    ),
}

# The tenant roles coordrls_01 creates and default-grants DML on new coord tables.
_TENANT_ROLES: tuple[str, ...] = ("coord_tenant", "coord_tenant_preflight")

# Every CHECK the table carries: the vocabularies plus the two invariants.
_EXPECTED_CHECKS: frozenset[str] = frozenset(_EXPECTED_VOCABULARIES) | {
    "ingest_credential_tally_verdict_reason_check",
    "ingest_credential_tally_requests_check",
}

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)

# A row that satisfies every CHECK; each refusal case overrides only the fields it names.
_VALID_ROW: dict[str, object] = {
    "door": "/coord/test-results/ingest",
    "credential_class": "shared_token",
    "verdict": "accepted",
    "reason": "",
    "credential_repository": "",
    "body_repository": "qontinui/qontinui-runner",
    "agreement": "agree",
    "ref_class": "",
    "runner_environment": "",
    "requests": 1,
}

_INSERT = text(
    f"""
    INSERT INTO {_SCHEMA}.{_TABLE}
        (day, door, credential_class, verdict, reason, credential_repository,
         body_repository, agreement, ref_class, runner_environment, requests)
    VALUES
        ((now() AT TIME ZONE 'UTC')::date, :door, :credential_class, :verdict,
         :reason, :credential_repository, :body_repository, :agreement,
         :ref_class, :runner_environment, :requests)
    """
)

# The UPSERT shape coord's tally writer uses: conflict on the whole key.
_UPSERT = text(
    f"""
    INSERT INTO {_SCHEMA}.{_TABLE}
        (day, door, credential_class, verdict, reason, credential_repository,
         body_repository, agreement, ref_class, runner_environment,
         derived_tenant_id, body_tenant_id, requests)
    VALUES
        ((now() AT TIME ZONE 'UTC')::date, :door, :credential_class, :verdict,
         :reason, :credential_repository, :body_repository, :agreement,
         :ref_class, :runner_environment, :derived_tenant_id, NULL, 1)
    ON CONFLICT (day, door, credential_class, verdict, reason,
                 credential_repository, body_repository, agreement,
                 ref_class, runner_environment) DO UPDATE SET
        requests = {_SCHEMA}.{_TABLE}.requests + 1,
        derived_tenant_id = EXCLUDED.derived_tenant_id,
        body_tenant_id = EXCLUDED.body_tenant_id,
        last_seen_at = now()
    """
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _upgrade_sql() -> list[str]:
    """The SQL of every ``op.execute`` in upgrade(), each a single string literal.

    Any other argument shape (an f-string, ``sa.text(...)``, a name, a second
    argument) fails here rather than being skipped, so the statement count and
    the checks the structural test runs over these strings cover every execute.
    """
    tree = ast.parse(_revision_path().read_text(encoding="utf-8"))
    fn = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade"
    )
    out: list[str] = []
    for node in ast.walk(fn):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
        ):
            literal = (
                len(node.args) == 1
                and not node.keywords
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
            )
            assert literal, (
                f"upgrade() line {node.lineno}: op.execute must take exactly one "
                f"string literal, got: {ast.unparse(node)}"
            )
            out.append(node.args[0].value)
    return out


def _check_definitions(engine: Engine) -> dict[str, str]:
    sql = text(
        """
        SELECT con.conname, pg_get_constraintdef(con.oid)
          FROM pg_constraint con
         WHERE con.conrelid = to_regclass(:rel)
           AND con.contype = 'c'
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(sql, {"rel": f"{_SCHEMA}.{_TABLE}"}).fetchall()
    return {row[0]: row[1] for row in rows}


def _literal_set(definition: str) -> frozenset[str]:
    # pg_get_constraintdef renders `col IN ('a','b')` as
    # `CHECK ((col = ANY (ARRAY['a'::text, 'b'::text])))`.
    return frozenset(re.findall(r"'([^']*)'::text", definition))


def _primary_key_columns(engine: Engine) -> tuple[str, ...]:
    sql = text(
        """
        SELECT a.attname
          FROM pg_index i
          JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
          JOIN pg_attribute a
            ON a.attrelid = i.indrelid AND a.attnum = k.attnum
         WHERE i.indrelid = to_regclass(:rel)
           AND i.indisprimary
         ORDER BY k.ord
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(sql, {"rel": f"{_SCHEMA}.{_TABLE}"}).fetchall()
    return tuple(row[0] for row in rows)


@pytest.fixture(scope="module")
def upgraded() -> Iterator[Engine]:
    """One database migrated to this revision, shared by the read-mostly tests."""
    if not can_connect(admin_database_url()):
        pytest.skip("test Postgres unreachable (set QONTINUI_TEST_PG=host:port)")
    with ephemeral_database(admin_database_url(), "ingcred01") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


def test_revision_is_wired_to_its_pinned_parent() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    doc = ast.get_docstring(ast.parse(_revision_path().read_text(encoding="utf-8")))
    assert f"Revision ID: {_REVISION_ID}" in (doc or "")
    assert f"Revises: {_PARENT_REVISION_ID}" in (doc or "")
    assert module.branch_labels is None
    assert module.depends_on is None


def test_upgrade_drops_nothing_and_is_coord_qualified() -> None:
    sql = _upgrade_sql()
    for stmt in sql:
        assert "DROP" not in stmt.upper(), stmt
        # One statement per op.execute: nothing can ride along behind the
        # COMMENT or the CREATE (a `; GRANT ... TO PUBLIC`, say).
        assert ";" not in stmt, stmt
    # Exactly three statements: the table, the owner-only REVOKE, the COMMENT.
    assert len(sql) == 3, sql
    create, revoke, comment = (" ".join(stmt.split()) for stmt in sql)
    assert create.startswith(f"CREATE TABLE IF NOT EXISTS {_SCHEMA}.{_TABLE} ("), create
    assert revoke == (
        f"REVOKE ALL ON {_SCHEMA}.{_TABLE} FROM {', '.join(_TENANT_ROLES)}"
    ), revoke
    assert comment.startswith(f"COMMENT ON TABLE {_SCHEMA}.{_TABLE} IS "), comment


@_needs_pg
def test_ingcred_01_creates_the_tally_with_its_key_and_checks(upgraded: Engine) -> None:
    assert table_exists(upgraded, _SCHEMA, _TABLE)
    for name, data_type, nullable, default in _EXPECTED_COLUMNS:
        info = column_info(upgraded, _TABLE, name, schema=_SCHEMA)
        assert info is not None, f"{_SCHEMA}.{_TABLE}.{name} missing"
        assert info[0] == data_type, (name, info)
        assert info[1] == ("YES" if nullable else "NO"), (name, info)
        if default is None:
            assert info[2] is None, (name, info)
        else:
            assert info[2] is not None and default in info[2], (name, info)
    column_count = scalar(
        upgraded,
        """
        SELECT count(*) FROM information_schema.columns
         WHERE table_schema = :schema AND table_name = :table
        """,
        schema=_SCHEMA,
        table=_TABLE,
    )
    assert column_count == len(_EXPECTED_COLUMNS)

    assert _primary_key_columns(upgraded) == _EXPECTED_KEY

    checks = _check_definitions(upgraded)
    assert set(checks) == set(_EXPECTED_CHECKS), sorted(checks)
    for name, expected in _EXPECTED_VOCABULARIES.items():
        assert _literal_set(checks[name]) == expected, (name, checks[name])


@_needs_pg
@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"credential_class": "device_jwt"}, id="credential_class"),
        # A valid non-empty reason, so the verdict/reason invariant holds and
        # only the verdict CHECK can refuse the row.
        pytest.param(
            {"verdict": "pending", "reason": "ingest_repo_mismatch"}, id="verdict"
        ),
        pytest.param({"agreement": "maybe"}, id="agreement"),
        pytest.param({"ref_class": "tag"}, id="ref_class"),
        pytest.param({"runner_environment": "contributed"}, id="runner_environment"),
        pytest.param({"requests": 0}, id="requests"),
    ],
)
def test_ingcred_01_refuses_a_value_outside_its_check(
    upgraded: Engine, overrides: dict[str, object]
) -> None:
    row = {**_VALID_ROW, **overrides}
    with pytest.raises(IntegrityError):
        with upgraded.begin() as conn:
            conn.execute(_INSERT, row)


@_needs_pg
def test_ingcred_01_requests_has_no_default(upgraded: Engine) -> None:
    row = {k: v for k, v in _VALID_ROW.items() if k != "requests"}
    insert_without_count = text(
        f"""
        INSERT INTO {_SCHEMA}.{_TABLE}
            (day, door, credential_class, verdict, reason, credential_repository,
             body_repository, agreement, ref_class, runner_environment)
        VALUES
            ((now() AT TIME ZONE 'UTC')::date, :door, :credential_class, :verdict,
             :reason, :credential_repository, :body_repository, :agreement,
             :ref_class, :runner_environment)
        """
    )
    with pytest.raises(IntegrityError) as refused:
        with upgraded.begin() as conn:
            conn.execute(insert_without_count, row)
    # not_null_violation, not a CHECK refusing a default: there is no default.
    assert getattr(refused.value.orig, "pgcode", None) == "23502", refused.value


@_needs_pg
def test_ingcred_01_is_owner_only(upgraded: Engine) -> None:
    # Non-vacuity: both roles exist, and coord's default privileges would grant
    # them on a new table, so their absence below is the REVOKE's doing.
    assert scalar(
        upgraded,
        "SELECT count(*) FROM pg_roles WHERE rolname = ANY(:roles)",
        roles=list(_TENANT_ROLES),
    ) == len(_TENANT_ROLES)
    assert scalar(
        upgraded,
        """
            SELECT count(DISTINCT r.rolname)
              FROM pg_class c
              JOIN pg_default_acl d ON d.defaclrole = c.relowner
              JOIN pg_namespace n ON n.oid = d.defaclnamespace
              CROSS JOIN LATERAL aclexplode(d.defaclacl) a
              JOIN pg_roles r ON r.oid = a.grantee
             WHERE c.oid = to_regclass(:rel)
               AND n.nspname = :schema AND d.defaclobjtype = 'r'
               AND r.rolname = ANY(:roles)
            """,
        rel=f"{_SCHEMA}.{_TABLE}",
        schema=_SCHEMA,
        roles=list(_TENANT_ROLES),
    ) == len(_TENANT_ROLES)
    with upgraded.connect() as conn:
        grantees = {
            row[0]
            for row in conn.execute(
                text(
                    """
                    SELECT coalesce(r.rolname, 'PUBLIC')
                      FROM pg_class c
                      CROSS JOIN LATERAL aclexplode(c.relacl) a
                      LEFT JOIN pg_roles r ON r.oid = a.grantee
                     WHERE c.oid = to_regclass(:rel)
                    """
                ),
                {"rel": f"{_SCHEMA}.{_TABLE}"},
            )
        }
    assert grantees.isdisjoint((*_TENANT_ROLES, "PUBLIC")), sorted(grantees)
    # The effective privileges, which also follow PUBLIC membership
    # (coordrls_01's census-test pattern).
    for role in _TENANT_ROLES:
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            assert (
                scalar(
                    upgraded,
                    "SELECT has_table_privilege(:role, :rel, :privilege)",
                    role=role,
                    rel=f"{_SCHEMA}.{_TABLE}",
                    privilege=privilege,
                )
                is False
            ), (role, privilege)


@_needs_pg
def test_ingcred_01_ties_the_verdict_to_its_reason(upgraded: Engine) -> None:
    accepted_with_reason = {**_VALID_ROW, "reason": "ingest_repo_mismatch"}
    with pytest.raises(IntegrityError):
        with upgraded.begin() as conn:
            conn.execute(_INSERT, accepted_with_reason)
    refused_without_reason = {**_VALID_ROW, "verdict": "refused", "reason": ""}
    with pytest.raises(IntegrityError):
        with upgraded.begin() as conn:
            conn.execute(_INSERT, refused_without_reason)
    unknown_reason = {**_VALID_ROW, "verdict": "refused", "reason": "owner_unbound"}
    with pytest.raises(IntegrityError):
        with upgraded.begin() as conn:
            conn.execute(_INSERT, unknown_reason)


@_needs_pg
def test_ingcred_01_upsert_on_the_key_counts_requests_on_one_row(
    upgraded: Engine,
) -> None:
    door = f"/coord/test-results/ingest#{uuid.uuid4().hex[:8]}"
    key = {
        **{k: v for k, v in _VALID_ROW.items() if k != "requests"},
        "door": door,
        "derived_tenant_id": str(uuid.uuid4()),
    }
    with upgraded.begin() as conn:
        conn.execute(_UPSERT, key)
        conn.execute(_UPSERT, key)
        conn.execute(_UPSERT, {**key, "agreement": "disagree"})
    assert (
        scalar(
            upgraded,
            f"SELECT count(*) FROM {_SCHEMA}.{_TABLE} WHERE door = :door",
            door=door,
        )
        == 2
    )
    assert (
        scalar(
            upgraded,
            f"""
            SELECT requests FROM {_SCHEMA}.{_TABLE}
             WHERE door = :door AND agreement = 'agree'
            """,
            door=door,
        )
        == 2
    )


@_needs_pg
def test_ingcred_01_retirement_reason_is_already_allowed(upgraded: Engine) -> None:
    row = {
        **_VALID_ROW,
        "door": f"/coord/test-coverage/observe#{uuid.uuid4().hex[:8]}",
        "verdict": "refused",
        "reason": "shared_ingest_token_retired",
    }
    with upgraded.begin() as conn:
        conn.execute(_INSERT, row)


@_needs_pg
def test_ingcred_01_downgrade_drops_it() -> None:
    with ephemeral_database(admin_database_url(), "ingcred01_rt") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        run_alembic(backend_root(), url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
