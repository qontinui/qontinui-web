"""The prior-access lookup: its index, and the statement itself.

``_member_had_prior_access`` in ``app/api/v1/endpoints/operations.py`` decides
whether ``POST /api/v1/operations/coord/tenant-members`` emails the person it
just granted access to. Two things about it were untested and are pinned here.

**The statement was never executed by any test.** Both autouse fixtures in
``test_operations_coord_members_proxy.py`` patch the helper out — correctly,
since those tests have no database — so a typo in a column name, a
mis-spelled bound parameter, or the two-key split (``operator_id`` is
compared against a ``uuid`` column in one subquery and its text form against
``operator_audit.resource_key`` in the other) would have shipped green and
surfaced as a swallowed exception in production, which the helper reports as
UNKNOWN and which then silently suppresses every notice.

**The predicate had no index.** ``coord_sso_rbac`` gives
``coord.operator_audit`` two: ``(operator_id, occurred_at DESC)`` — and
``operator_id`` is the ACTOR, not the target — and ``(occurred_at DESC)``.
The lookup filters ``action``, ``resource_kind``, ``resource_key`` and
``tenant_id``, so it matched neither.

Two lanes, deliberately:

* ``TestTheStatementMatchesTheSchema`` needs no database. It compiles the
  real statement against the PostgreSQL dialect and checks every column it
  names against the DDL in the revisions that create the two tables. This
  runs everywhere, including a developer box with no Postgres.
* ``test_membernotice_01_*`` runs the real statement, and the real
  migration, against an ephemeral database. Skipped when no Postgres is
  reachable, like every other migration test here.
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "membernotice_01_operator_audit_grant_lookup"
_PARENT_REVISION_ID = "agent_questions_alert_episode_01"

_INDEX_NAME = "idx_operator_audit_grant_role_lookup"

#: The revision that creates both tables the statement reads.
_RBAC_REVISION = "coord_sso_rbac.py"


def _statement():
    from app.api.v1.endpoints.operations import _MEMBER_PRIOR_ACCESS_SQL

    return _MEMBER_PRIOR_ACCESS_SQL


def _rbac_ddl() -> str:
    path = Path(backend_root()) / "alembic" / "versions" / _RBAC_REVISION
    return path.read_text(encoding="utf-8")


def _columns_of(ddl: str, table: str) -> set[str]:
    """Column names declared in ``CREATE TABLE ... coord.<table> ( ... )``."""
    match = re.search(
        rf"CREATE TABLE IF NOT EXISTS coord\.{table}\s*\((.*?)\n        \)",
        ddl,
        re.S,
    )
    assert match, f"no CREATE TABLE for coord.{table} in {_RBAC_REVISION}"
    columns: set[str] = set()
    for line in match.group(1).splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("PRIMARY KEY", "REFERENCES", ")")):
            continue
        name = stripped.split()[0]
        if name.isidentifier():
            columns.add(name)
    return columns


class TestTheStatementMatchesTheSchema:
    """No database required. Catches the typo class the route tests cannot."""

    def test_it_compiles_against_postgres(self):
        compiled = _statement().compile(dialect=postgresql.dialect())
        assert "operator_roles" in str(compiled)
        assert "operator_audit" in str(compiled)

    def test_it_binds_exactly_the_three_parameters_the_caller_passes(self):
        """A mis-spelled bind name raises at execute time, inside the
        try/except, and is reported as UNKNOWN — which suppresses the notice
        for every caller, silently and forever."""
        params = set(_statement().compile(dialect=postgresql.dialect()).params)
        assert params == {"operator_id", "operator_key", "tenant_id"}

    def test_every_column_it_names_exists_in_the_rbac_ddl(self):
        sql = str(_statement())
        ddl = _rbac_ddl()

        roles_columns = _columns_of(ddl, "operator_roles")
        audit_columns = _columns_of(ddl, "operator_audit")

        # The subquery against coord.operator_roles.
        for column in ("operator_id", "tenant_id"):
            assert column in roles_columns, column
        # The subquery against coord.operator_audit.
        for column in ("action", "resource_kind", "resource_key", "tenant_id"):
            assert column in audit_columns, column

        # And the statement really does name them, so this test fails if the
        # predicate is rewritten to use something else.
        for column in ("action", "resource_kind", "resource_key"):
            assert column in sql

    def test_the_two_key_forms_are_both_present(self):
        """``resource_key`` is TEXT holding the operator id, while
        ``operator_roles.operator_id`` is ``uuid``. The statement must
        compare the same id against both, and an implicit ``uuid = text``
        is an ERROR in PostgreSQL rather than a coercion — so the uuid side
        must carry an explicit cast."""
        sql = str(_statement())
        assert "CAST(:operator_id AS uuid)" in sql
        assert "resource_key = :operator_key" in sql
        assert sql.count("CAST(:tenant_id AS uuid)") == 2

    def test_the_audit_predicate_is_not_filtered_by_role(self):
        """Holding ANY role in the tenant means they already had access to
        the team, so neither subquery may narrow by role — a colleague who
        was a Developer and is being promoted to Administrator has already
        been told about this team."""
        assert ":role" not in str(_statement())


def _seed(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    """One tenant and one operator, returned as ``(tenant_id, operator_id)``."""
    tenant_id = uuid.uuid4()
    operator_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            # display_name is NOT NULL on coord.tenants — omitting it fails
            # the seed before the migration is ever exercised, which is how
            # this test first passed collection and failed on every run.
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (:t, :slug, :display_name)"
            ),
            {
                "t": tenant_id,
                "slug": f"t{tenant_id.hex[:10]}",
                "display_name": f"Tenant {tenant_id.hex[:8]}",
            },
        )
        conn.execute(
            text(
                "INSERT INTO coord.operators "
                "(operator_id, tenant_id, email, sso_subject, sso_provider) "
                "VALUES (:o, :t, :email, :sub, 'cognito')"
            ),
            {
                "o": operator_id,
                "t": tenant_id,
                "email": f"{operator_id.hex[:8]}@example.com",
                "sub": f"sub-{operator_id.hex[:8]}",
            },
        )
    return tenant_id, operator_id


def _run_lookup(engine: Engine, tenant_id: uuid.UUID, operator_id: uuid.UUID):
    with engine.connect() as conn:
        return conn.execute(
            _statement(),
            {
                "operator_id": str(operator_id),
                "operator_key": str(operator_id),
                "tenant_id": str(tenant_id),
            },
        ).one()


def _postgres_lane_verdict() -> str | None:
    """``None`` to run, otherwise the skip reason.

    ``can_connect`` swallows EVERY exception and answers ``False``, so a
    Postgres that is up but refusing credentials, and one that accepts
    connections a second after collection, are both indistinguishable from
    "no Postgres" — and this whole lane then goes quietly green. That is the
    shape that let this file's own seed defect survive: the lane had never
    run anywhere, and a skip reads like a pass in a summary line.

    ``QONTINUI_REQUIRE_PG=1`` turns the skip into a FAILURE. CI sets it on the
    job that provisions the postgres service, so a lane that silently stops
    running there is a red build rather than a quiet one. Locally it is unset,
    and a developer with no database still gets a skip.

    Deliberately scoped to this file rather than to the shared harness: the
    harness is used by many migration tests whose CI wiring was not audited
    here, and arming them all from one place is a change with a blast radius
    that this finding does not justify.
    """
    if can_connect(admin_database_url()):
        return None
    if os.environ.get("QONTINUI_REQUIRE_PG") == "1":
        pytest.fail(
            "QONTINUI_REQUIRE_PG=1 but Postgres is unreachable at "
            f"{admin_database_url().rsplit('@', 1)[-1]}: the migration lane "
            "did not run. This is a failure rather than a skip because a "
            "silently skipped migration test is indistinguishable from a "
            "passing one.",
            pytrace=False,
        )
    return (
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point QONTINUI_TEST_PG at one (the "
        "canonical dev stack publishes it on 5433) before running this test. "
        "Set QONTINUI_REQUIRE_PG=1 to make this a failure instead."
    )


# Evaluated once at import: the decorator would otherwise open a second
# connection just to render the reason string.
_PG_SKIP_REASON = _postgres_lane_verdict()


@pytest.mark.skipif(_PG_SKIP_REASON is not None, reason=_PG_SKIP_REASON or "")
def test_membernotice_01_index_and_the_real_lookup() -> None:
    """The migration creates a valid index, and the statement really runs."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "membernotice_lookup_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — the tables exist, the index does not.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)

        # 2. Apply.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)

        with engine.connect() as conn:
            valid, unique, predicate = conn.execute(
                text(
                    """
                    SELECT i.indisvalid, i.indisunique,
                           pg_get_expr(i.indpred, i.indrelid)
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                     WHERE c.relname = :idx
                    """
                ),
                {"idx": _INDEX_NAME},
            ).one()
        assert valid is True
        # NOT unique: an audit log must accept grant → revoke → grant, and a
        # unique index here would make coord's second grant fail outright.
        assert unique is False
        assert "operator.grant_role" in (predicate or "")

        # 3. The statement executes, and answers False/False for a stranger.
        tenant_id, operator_id = _seed(engine)
        row = _run_lookup(engine, tenant_id, operator_id)
        assert row.holds_role_now is False
        assert row.granted_before is False

        # 4. A role row alone flips the first signal.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO coord.operator_roles "
                    "(operator_id, tenant_id, role) VALUES (:o, :t, 'operator')"
                ),
                {"o": operator_id, "t": tenant_id},
            )
        row = _run_lookup(engine, tenant_id, operator_id)
        assert row.holds_role_now is True
        assert row.granted_before is False

        # 5. An audit row alone flips the second — and survives a revoke,
        #    which is the case the first signal cannot cover.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "DELETE FROM coord.operator_roles "
                    "WHERE operator_id = :o AND tenant_id = :t"
                ),
                {"o": operator_id, "t": tenant_id},
            )
            conn.execute(
                text(
                    "INSERT INTO coord.operator_audit "
                    "(operator_id, tenant_id, action, resource_kind, resource_key) "
                    "VALUES (:actor, :t, 'operator.grant_role', 'operator', :key)"
                ),
                {"actor": operator_id, "t": tenant_id, "key": str(operator_id)},
            )
        row = _run_lookup(engine, tenant_id, operator_id)
        assert row.holds_role_now is False
        assert row.granted_before is True

        # 6. Another tenant's history does not leak in.
        other_tenant, _ = _seed(engine)
        row = _run_lookup(engine, other_tenant, operator_id)
        assert row.holds_role_now is False
        assert row.granted_before is False

        # 7. A DIFFERENT audited action is not mistaken for a grant.
        fresh_tenant, fresh_operator = _seed(engine)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO coord.operator_audit "
                    "(operator_id, tenant_id, action, resource_kind, resource_key) "
                    "VALUES (:actor, :t, 'operator.create', 'operator', :key)"
                ),
                {
                    "actor": fresh_operator,
                    "t": fresh_tenant,
                    "key": str(fresh_operator),
                },
            )
        row = _run_lookup(engine, fresh_tenant, fresh_operator)
        assert row.granted_before is False

        # 8. Idempotent re-apply, then downgrade removes only the index.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        # The audit rows are untouched by either direction.
        with engine.connect() as conn:
            remaining = conn.execute(
                text("SELECT count(*) FROM coord.operator_audit")
            ).scalar()
        assert remaining == 2


def _index_validity(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT i.indisvalid
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'coord' AND c.relname = :idx
                    """
                ),
                {"idx": _INDEX_NAME},
            ).scalar()
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test (QONTINUI_TEST_PG=host:port overrides it)."
    ),
)
def test_membernotice_01_repairs_an_invalid_index() -> None:
    """The repair branch, which is the only logic not inherited from the
    revision this one is modelled on — and which the re-run in the test above
    does NOT reach, because that re-run applies over a VALID index and so
    exercises only the already-exists arm.

    A real failed ``CREATE INDEX CONCURRENTLY`` leaves the index INVALID:
    the planner ignores it, so the lookup silently falls back to a
    sequential scan, and ``IF NOT EXISTS`` sees the name and skips the
    rebuild — the state would persist forever with nothing to show for it.
    The revision's central claim is that a re-run always ends with a VALID
    index or a loud failure, and this is what pins it.

    The invalid state is constructed deterministically by flipping
    ``pg_index.indisvalid``, which is exactly the flag a killed build
    leaves behind and the flag the revision's own ``_index_is_invalid``
    reads.
    """
    root = backend_root()

    with ephemeral_database(admin_database_url(), "membernotice_invalid_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_validity(engine) is True

        # Simulate a killed CONCURRENTLY build.
        with engine.begin() as conn:
            conn.execute(text("SET allow_system_table_mods = on"))
            conn.execute(
                text(
                    """
                    UPDATE pg_index SET indisvalid = false
                     WHERE indexrelid = (
                         SELECT c.oid FROM pg_class c
                         JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'coord' AND c.relname = :idx)
                    """
                ),
                {"idx": _INDEX_NAME},
            )
        assert _index_validity(engine) is False, "failed to stage the invalid state"

        # Re-running the revision must REPAIR it rather than skip it.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)

        assert index_exists(engine, _INDEX_NAME)
        assert _index_validity(engine) is True, (
            "an INVALID index survived a re-run: IF NOT EXISTS kept it and "
            "the lookup is on a sequential scan"
        )
