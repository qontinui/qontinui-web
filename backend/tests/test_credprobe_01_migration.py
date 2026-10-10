"""Schema contract test for the ``credprobe_01`` revision.

``credprobe_01_credential_probe_specs`` creates ``coord.credential_probe_specs``
as pure schema — Phase 3 (web half) of plan
``2026-10-09-coord-knows-which-box-holds-which-credential``, design D3. The
consumer is coord, which web never reads, so the contract can only be pinned
here.

What ``migration-reversal.yml`` cannot see, and this file pins:

1. **The revision is pure, guarded DDL** — a ``CREATE TABLE IF NOT EXISTS``
   and a ``COMMENT``, no data DML, so coord's migration classifier admits it
   on the auto-safe path.
2. **The columns are exactly D3's**, and the table is born empty.
3. **``UNIQUE (tenant_id, token)``** — the operator upsert's conflict target.
4. **The CHECK floor** — the D1 token grammar (no account id, no ARN, at most
   three segments), the closed ``probe_kind`` enum, the token naming the
   scope its probe proves (D2), and the canary being present for SSM only
   and never secret-shaped (D3).
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
import sqlalchemy.exc
from sqlalchemy import Engine, text

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

_REVISION_ID = "credprobe_01"
_REVISION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "credprobe_01_credential_probe_specs.py"
)

# Read the parent off the revision itself: coord re-points down_revision at
# land time, so a pinned literal here would go stale on main.
_PARENT_REVISION_ID = load_revision_module(
    _REVISION_PATH, "credprobe_01_parent_probe"
).down_revision

_D3_COLUMNS = {
    "tenant_id",
    "token",
    "probe_kind",
    "region",
    "canary_parameter",
    "enabled",
    "updated_by",
    "updated_at",
}


def test_revision_source_is_pure_guarded_ddl() -> None:
    """No database: upgrade() runs one guarded CREATE TABLE and one COMMENT."""
    module = load_revision_module(_REVISION_PATH, "credprobe_01_under_test")
    assert module.revision == _REVISION_ID
    assert isinstance(module.down_revision, str) and module.down_revision

    calls = upgrade_execute_calls(_REVISION_PATH)
    assert len(calls) == 2, calls
    sqls = []
    for call in calls:
        assert call.sql is not None, "op.execute arg must be a static literal"
        sqls.append(" ".join(call.sql.split()))
    assert sqls[0].startswith(
        "CREATE TABLE IF NOT EXISTS coord.credential_probe_specs"
    ), sqls[0]
    assert sqls[1].startswith("COMMENT ON TABLE coord.credential_probe_specs"), sqls[1]
    # Statement forms, not bare keywords: the FK's ``ON DELETE CASCADE`` is DDL.
    for sql in sqls:
        for dml in ("INSERT INTO", "UPDATE COORD.", "DELETE FROM"):
            assert dml not in sql.upper(), sql


def _exec(engine: Engine, sql: str, **params: object) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _tenant(engine: Engine) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    cols = scalar(
        engine,
        """
        SELECT string_agg(column_name, ',')
          FROM information_schema.columns
         WHERE table_schema = 'coord' AND table_name = 'tenants'
           AND is_nullable = 'NO' AND column_default IS NULL
        """,
    )
    required = [c for c in str(cols or "").split(",") if c and c != "tenant_id"]
    names = ["tenant_id", *required]
    values = [":tenant_id", *[f"'t-{tenant_id.hex[:8]}-{c}'" for c in required]]
    _exec(
        engine,
        f"INSERT INTO coord.tenants ({', '.join(names)}) VALUES ({', '.join(values)})",
        tenant_id=tenant_id,
    )
    return tenant_id


_SSM_OK: dict[str, object] = {
    "token": "cred:aws-ssm:eu-central-1",
    "probe_kind": "aws_ssm_get_parameter",
    "region": "eu-central-1",
    "canary_parameter": "/qontinui/probe/canary",
    "updated_by": "operator@example.invalid",
}


def _spec(engine: Engine, tenant_id: uuid.UUID, **overrides: object) -> None:
    params = {**_SSM_OK, **overrides, "tenant_id": tenant_id}
    _exec(
        engine,
        "INSERT INTO coord.credential_probe_specs (tenant_id, token, probe_kind, "
        "region, canary_parameter, updated_by) VALUES (:tenant_id, :token, "
        ":probe_kind, :region, :canary_parameter, :updated_by)",
        **params,
    )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_credential_probe_specs_schema_roundtrip() -> None:
    """upgrade → shape, key and CHECK floor → downgrade → upgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "credprobe_01_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _REVISION_ID)

        assert table_exists(engine, "coord", "credential_probe_specs")
        assert scalar(engine, "SELECT count(*) FROM coord.credential_probe_specs") == 0
        with engine.connect() as conn:
            cols = {
                r[0]
                for r in conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = 'coord' "
                        "AND table_name = 'credential_probe_specs'"
                    )
                ).all()
            }
        assert cols == _D3_COLUMNS, cols

        tenant_id = _tenant(engine)
        other_tenant = _tenant(engine)

        _spec(engine, tenant_id)
        # enabled defaults true; updated_at is stamped.
        assert (
            scalar(
                engine,
                "SELECT enabled AND updated_at IS NOT NULL "
                "FROM coord.credential_probe_specs WHERE tenant_id = :t",
                t=tenant_id,
            )
            is True
        )
        # UNIQUE (tenant_id, token): a second row for the same pair is refused,
        # the same token under another tenant is not.
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _spec(engine, tenant_id)
        _spec(engine, other_tenant)

        # An ECS probe carries no canary.
        _spec(
            engine,
            tenant_id,
            token="cred:aws-ecs:us-east-1",
            probe_kind="aws_ecs_list_clusters",
            region="us-east-1",
            canary_parameter=None,
        )

        bad_specs: tuple[dict[str, object], ...] = (
            # D1 token grammar
            {"token": "cred:aws-ssm:eu-central-1:extra"},  # 4 segments
            {"token": "CRED:aws-ssm:eu-central-1"},  # upper case
            {"token": "cred:aws-ssm:123456789012"},  # account id
            {"token": "cred:arn:aws"},  # arn:
            {"token": "cred:aws/ssm"},  # path
            {"token": "cred:a@b"},  # email
            # closed probe_kind enum
            {"probe_kind": "aws_ssm_get_parameter_decrypted"},
            # region shape
            {"token": "cred:aws-ssm:Europe", "region": "Europe"},
            # D2: token names the scope its probe proves
            {"region": "us-west-2"},
            {"token": "cred:aws-ecs:eu-central-1"},
            # D3: canary required for SSM, refused for other kinds
            {"canary_parameter": None},
            {
                "token": "cred:aws-ecs:eu-west-1",
                "probe_kind": "aws_ecs_list_clusters",
                "region": "eu-west-1",
            },
            # D3: canary never secret-shaped, and SSM-name charset only
            {"canary_parameter": "/prod/db/Password"},
            {"canary_parameter": "/qontinui/api-key"},
            {"canary_parameter": "/svc/SECRET"},
            {"canary_parameter": "/gh/token"},
            {"canary_parameter": "/aws/credential"},
            {"canary_parameter": "has space"},
            {"canary_parameter": ""},
            # audit
            {"updated_by": "   "},
        )
        for bad in bad_specs:
            # A fresh tenant per case, so only the CHECK under test can refuse.
            with pytest.raises(sqlalchemy.exc.IntegrityError):
                _spec(engine, _tenant(engine), **bad)

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", "credential_probe_specs")

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", "credential_probe_specs")
