"""Schema + round-trip tests for the ``coordrls_01`` revision.

Phase 1 of plan ``2026-10-15-coord-tenant-isolation-has-no-database-enforcement``
creates the ``coord_tenant`` / ``coord_tenant_preflight`` roles, grants them
coord's tenant-path privileges, switches the two coord views to
``security_invoker`` and adds the scope-census tables. None of that is visible
from a passing ``upgrade``, so these are the contract:

1. **Both roles cannot log in, cannot bypass row-level security and are not
   superusers.** A role that could log in would be a credential; one with
   BYPASSRLS would make every later policy a no-op for it.
2. **Every privilege is granted SEPARATELY.** ``has_table_privilege(r, t,
   'SELECT,INSERT,UPDATE,DELETE')`` is true when ANY one is held (plan fact 23),
   so each privilege is asserted on its own; a missing ``INSERT`` would
   otherwise pass.
3. **The non-coord reads work under the role,** schema ``USAGE`` included: a
   table grant without ``USAGE`` on ``auth`` still fails "permission denied
   for schema auth".
4. **The census tables are system_only**: the roles hold nothing on them.
5. **Nothing is enforced**: no coord table has row-level security on and no
   policy exists.
6. **Up -> down -> up leaves no residue,** a role is dropped only when no
   other database depends on it, and re-running the upgrade is a no-op.
7. **The production shape works**: a NON-superuser ``CREATEROLE`` owner of the
   coord schema can run the revision and then assume the roles it created. CI's
   Postgres runs every migration as a superuser, so without this test the first
   non-superuser run of this revision would be the production deploy.

Roles are cluster-wide, so the order of this file matters: the walks that
create, drop and depend on roles run BEFORE the module-scoped read-only
database exists, whose grants would otherwise be "another database's" to
every downgrade. The production-shape walk uses role names of its own, so it
neither depends on nor disturbs the real roles.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing — set
``QONTINUI_TEST_PG_DSN`` (or ``QONTINUI_TEST_PG``) to point it at a live
instance.
"""

from __future__ import annotations

import contextlib
import secrets
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import DBAPIError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
)

# Pinned rather than "head" so a later revision cannot change what this walks.
# MUST equal the revision's own down_revision (the first test enforces it).
_REVISION_ID = "coordrls_01"
_PARENT_REVISION_ID = "image_assets_01"
_REVISION_FILENAME = "coordrls_01_tenant_role_and_scope_census.py"

_ROLES = ("coord_tenant", "coord_tenant_preflight")
_TABLE_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE")
_SEQUENCE_PRIVILEGES = ("USAGE", "SELECT", "UPDATE")
_CENSUS_TABLES = ("coord.db_scope_census", "coord.db_scope_census_flushes")
_VIEWS = ("coord.memories_latest", "coord.pr_check_runs_latest")
_NON_COORD_READS = (
    "auth.users",
    "project.workflow_verification_phase_results",
    "devenv.machines",
    "devenv.environments",
)
_NON_COORD_SCHEMAS = ("auth", "project", "devenv")
# Schemas whose objects a production migrator owns (plan: Schema ACLs).
_OWNED_SCHEMAS = ("coord", *_NON_COORD_SCHEMAS)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module(name: str) -> ModuleType:
    return load_revision_module(_revision_path(), f"coordrls_01_{name}")


# ---------------------------------------------------------------------------
# Catalog reads shared by the walks.
# ---------------------------------------------------------------------------


def _role_attributes(engine: Engine, role: str) -> tuple[bool, bool, bool, bool] | None:
    """``(rolcanlogin, rolbypassrls, rolsuper, rolinherit)``, or None when absent."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT rolcanlogin, rolbypassrls, rolsuper, rolinherit "
                "FROM pg_roles WHERE rolname = :r"
            ),
            {"r": role},
        ).fetchone()
    return (row[0], row[1], row[2], row[3]) if row else None


def _coord_relation_counts(engine: Engine) -> dict[str, int]:
    """How many coord relations of each relkind the grant walk covers."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relkind::text, count(*)
                  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
                 GROUP BY 1
                """
            )
        ).fetchall()
    return {row[0]: int(row[1]) for row in rows}


def _missing_grants(engine: Engine, role: str) -> list[str]:
    """Every ``relation privilege`` pair the role lacks on coord's relations.

    Each privilege is passed to ``has_*_privilege`` ON ITS OWN: a comma list
    answers true when any one of them is held (plan fact 23).
    """
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT format('%I.%I', n.nspname, c.relname) || ' ' || p.privilege
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 CROSS JOIN LATERAL unnest(
                       CASE WHEN c.relkind = 'S'
                            THEN ARRAY['USAGE', 'SELECT', 'UPDATE']
                            ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] END
                     ) AS p(privilege)
                 WHERE n.nspname = 'coord'
                   AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
                   AND format('%I.%I', n.nspname, c.relname) <> ALL (:census)
                   AND NOT CASE WHEN c.relkind = 'S'
                                THEN has_sequence_privilege(:role, c.oid, p.privilege)
                                ELSE has_table_privilege(:role, c.oid, p.privilege) END
                 ORDER BY 1
                """
            ),
            {"role": role, "census": list(_CENSUS_TABLES)},
        ).fetchall()
    return [row[0] for row in rows]


def _count(engine: Engine, sql: str, **params: object) -> int:
    """A ``count(*)`` query's answer, typed."""
    value = scalar(engine, sql, **params)
    assert isinstance(value, int), f"expected a count, got {value!r}"
    return value


def _dependencies(engine: Engine, role: str, *, here: bool) -> int:
    """``pg_shdepend`` rows on ``role`` in THIS database (``here``) or any other."""
    comparison = "=" if here else "<>"
    return _count(
        engine,
        f"""
        SELECT count(*) FROM pg_shdepend d
         WHERE d.refclassid = 'pg_authid'::regclass
           AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = :r)
           AND d.dbid {comparison}
               (SELECT oid FROM pg_database WHERE datname = current_database())
        """,
        r=role,
    )


def _view_options(engine: Engine, view: str) -> str:
    return str(
        scalar(
            engine,
            "SELECT coalesce(array_to_string(reloptions, ','), '') FROM pg_class "
            "WHERE oid = to_regclass(:v)",
            v=view,
        )
    )


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    declared = declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} but this test "
        f"pins {_PARENT_REVISION_ID!r}. Re-point both together, and the "
        f"`Revises:` header in the revision docstring with them."
    )


def test_the_revision_declares_what_this_test_pins() -> None:
    module = _revision_module("declares")
    assert module.ROLES == _ROLES
    assert module.CENSUS_TABLES == _CENSUS_TABLES
    assert module.COORD_VIEWS == _VIEWS
    assert module.NON_COORD_READS == _NON_COORD_READS
    assert module.NON_COORD_SCHEMAS == _NON_COORD_SCHEMAS
    for role in _ROLES:
        assert f"CREATE ROLE {role} NOLOGIN NOINHERIT NOBYPASSRLS;" in (
            module.create_role_sql(role)
        ), f"{role} must be created NOLOGIN NOINHERIT NOBYPASSRLS"


def test_the_revision_enforces_nothing() -> None:
    """Phase 1 is inert: a policy or an ENABLE belongs to a staging revision (D5)."""
    upper = _revision_source().upper()
    for forbidden in ("CREATE POLICY", "ENABLE ROW LEVEL SECURITY", "FORCE ROW LEVEL"):
        assert forbidden not in upper, (
            f"{_REVISION_FILENAME} must not contain {forbidden!r}: this revision "
            "creates roles and grants only; enforcement is staged per table by "
            "later revisions"
        )


# ---------------------------------------------------------------------------
# Walks that create, drop and depend on roles. They run before the read-only
# database below exists — see the module docstring.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def test_a_role_is_dropped_only_once_no_database_depends_on_it(_admin_url: str) -> None:
    """``drop_role_sql``'s two arms, on a role of the test's own."""
    module = _revision_module("drop_arms")
    role = f"coordrls_drop_{secrets.token_hex(4)}"
    admin = create_engine(_admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            conn.execute(text(f"CREATE ROLE {role} NOLOGIN"))
        with (
            ephemeral_database(_admin_url, "coordrls_01_dropa") as (here, _),
            ephemeral_database(_admin_url, "coordrls_01_dropb") as (other, _),
        ):
            with other.begin() as conn:
                conn.execute(text("CREATE TABLE holder (id int)"))
                conn.execute(text(f"GRANT SELECT ON holder TO {role}"))
            with here.begin() as conn:
                conn.execute(text(module.drop_role_sql(role)))
            assert _role_attributes(here, role) is not None, (
                f"{role} was dropped while another database still granted to it"
            )
            with other.begin() as conn:
                conn.execute(text(f"REVOKE SELECT ON holder FROM {role}"))
            with here.begin() as conn:
                conn.execute(text(module.drop_role_sql(role)))
            assert _role_attributes(here, role) is None, (
                f"{role} survived although nothing depended on it"
            )
            # Absent role: the block returns rather than erroring.
            with here.begin() as conn:
                conn.execute(text(module.drop_role_sql(role)))
    finally:
        with contextlib.suppress(Exception), admin.connect() as conn:
            conn.execute(text(f"DROP ROLE IF EXISTS {role}"))
        admin.dispose()


def test_up_down_up_leaves_no_residue(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "coordrls_01_ud") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        elsewhere = {role: _dependencies(engine, role, here=False) for role in _ROLES}
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)

        for table in _CENSUS_TABLES:
            assert scalar(engine, "SELECT to_regclass(:t) IS NULL", t=table), table
        for view in _VIEWS:
            options = _view_options(engine, view)
            assert "security_invoker" not in options, f"{view}: {options!r}"
        for role in _ROLES:
            if _role_attributes(engine, role) is None:
                assert elsewhere[role] == 0, (
                    f"{role} was dropped while {elsewhere[role]} other-database "
                    "dependencies existed"
                )
                continue
            assert elsewhere[role] > 0, (
                f"{role} survived a downgrade although no other database depended on it"
            )
            residue = _dependencies(engine, role, here=True)
            assert residue == 0, f"{role} keeps {residue} dependencies in this database"

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for role in _ROLES:
            assert _role_attributes(engine, role) is not None, f"{role} not re-created"
            assert not _missing_grants(engine, role), f"{role} not re-granted"


def test_the_downgrade_keeps_a_role_another_database_depends_on(
    _admin_url: str,
) -> None:
    with ephemeral_database(_admin_url, "coordrls_01_keep") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with ephemeral_database(_admin_url, "coordrls_01_other") as (other, _):
            with other.begin() as conn:
                conn.execute(text("CREATE TABLE holder (id int)"))
                conn.execute(text(f"GRANT SELECT ON holder TO {', '.join(_ROLES)}"))
            run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
            for role in _ROLES:
                assert _role_attributes(engine, role) is not None, (
                    f"{role} was dropped while another database still granted to it"
                )
                residue = _dependencies(engine, role, here=True)
                assert residue == 0, f"{role} keeps {residue} dependencies here"


def test_the_upgrade_is_idempotent(_admin_url: str) -> None:
    """Re-running every block — the roles' included — over its own result."""
    with ephemeral_database(_admin_url, "coordrls_01_id") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for role in _ROLES:
            assert not _missing_grants(engine, role), f"{role} lost a grant on re-run"
        census_rows = _count(engine, "SELECT count(*) FROM coord.db_scope_census")
        assert census_rows == 0, f"the upgrade wrote {census_rows} census rows"


def test_a_first_creation_makes_a_role_that_cannot_log_in_or_bypass_rls(
    _admin_url: str,
) -> None:
    """The CREATE statement itself, on a name no earlier run has created.

    The real roles are cluster-wide, so once any database has run this revision
    a later ``CREATE ROLE`` is swallowed as a duplicate and the attributes read
    back are the FIRST creation's. This test owns its name, so what it reads is
    what the statement makes.
    """
    module = _revision_module("first_creation")
    role = f"coordrls_fresh_{secrets.token_hex(4)}"
    admin = create_engine(_admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            conn.execute(text(module.create_role_sql(role)))
        assert _role_attributes(admin, role) == (False, False, False, False), (
            f"{role}: (rolcanlogin, rolbypassrls, rolsuper, rolinherit) = "
            f"{_role_attributes(admin, role)}"
        )
        # The second run of the same block is a no-op, not an error.
        with admin.connect() as conn:
            conn.execute(text(module.create_role_sql(role)))
    finally:
        with contextlib.suppress(Exception), admin.connect() as conn:
            conn.execute(text(f"DROP ROLE IF EXISTS {role}"))
        admin.dispose()


@pytest.mark.parametrize(
    "squat",
    [
        "NOINHERIT LOGIN",
        "NOLOGIN NOINHERIT CREATEROLE",
        "NOLOGIN NOINHERIT CREATEDB",
        "NOLOGIN NOINHERIT REPLICATION",
        "NOLOGIN NOINHERIT BYPASSRLS",
        "NOLOGIN INHERIT",
        "MEMBER",
    ],
)
def test_the_revision_refuses_a_squatted_role(_admin_url: str, squat: str) -> None:
    """A pre-existing role of the same name passes only as this revision makes it.

    Each shape differs from the revision's NOLOGIN NOINHERIT NOBYPASSRLS role in
    ONE attribute, so each refusal is that attribute's. ``MEMBER`` is a NOLOGIN
    NOINHERIT role that is a member of another role: it can SET ROLE to that
    role, and with INHERIT it would count as that role (the owner, say) for
    row-level security.
    """
    module = _revision_module(f"squat_{squat.split()[-1].lower()}")
    role = f"coordrls_squat_{secrets.token_hex(4)}"
    parent = f"coordrls_squat_parent_{secrets.token_hex(4)}"
    admin = create_engine(_admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            if squat == "MEMBER":
                conn.execute(text(f"CREATE ROLE {parent} NOLOGIN"))
                conn.execute(text(f"CREATE ROLE {role} NOLOGIN NOINHERIT"))
                conn.execute(text(f"GRANT {parent} TO {role}"))
            else:
                conn.execute(text(f"CREATE ROLE {role} {squat}"))
            with pytest.raises(
                DBAPIError, match="refusing to grant it coord privileges"
            ):
                conn.execute(text(module.create_role_sql(role)))
    finally:
        with contextlib.suppress(Exception), admin.connect() as conn:
            conn.execute(text(f"DROP ROLE IF EXISTS {role}"))
            conn.execute(text(f"DROP ROLE IF EXISTS {parent}"))
        admin.dispose()


_OFFLINE_URL = "postgresql://nobody:nothing@127.0.0.1:1/coordrls_01_offline"


def test_each_view_change_commits_on_its_own() -> None:
    """The view switches hold their ``AccessExclusiveLock`` for one statement.

    ``alembic/env.py`` runs a deploy batch in ONE transaction, so a lock taken
    inside it lasts until the whole batch commits. Rendered offline (``--sql``,
    no database), an ``autocommit_block`` is a bare ``COMMIT;`` before its
    statements and a ``BEGIN;`` after; each view change must sit in that gap as
    its own ``BEGIN … COMMIT``, in both directions.
    """
    for direction, (start, end), change in (
        (
            "upgrade",
            (_PARENT_REVISION_ID, _REVISION_ID),
            "SET (security_invoker = true)",
        ),
        ("downgrade", (_REVISION_ID, _PARENT_REVISION_ID), "RESET (security_invoker)"),
    ):
        sql = run_alembic(
            backend_root(), _OFFLINE_URL, direction, f"{start}:{end}", "--sql"
        ).stdout
        lines = [line.strip() for line in sql.splitlines()]
        for view in _VIEWS:
            statement = f"BEGIN; SET LOCAL lock_timeout = '3s'; ALTER VIEW {view} {change}; COMMIT;"
            assert statement in lines, f"{direction}: no `{statement}` in:\n{sql}"
            at = lines.index(statement)
            # Walk back over the block's other statements to its opening COMMIT.
            opened = next(
                (
                    lines[j]
                    for j in range(at - 1, -1, -1)
                    if lines[j]
                    and not lines[j].startswith("BEGIN; SET LOCAL lock_timeout")
                ),
                None,
            )
            assert opened == "COMMIT;", (
                f"{direction}: {view}'s change is not preceded by the batch commit "
                f"an autocommit_block emits (found {opened!r}) — it would run inside "
                f"the batch transaction and hold its lock to the end of the deploy"
            )


def _hand_ownership_to(engine: Engine, owner: str) -> None:
    """Make ``owner`` own what the production migrator owns: these schemas and their relations."""
    schemas = ", ".join(f"'{s}'" for s in _OWNED_SCHEMAS)
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                DO $$
                DECLARE r record;
                BEGIN
                    FOR r IN SELECT nspname FROM pg_namespace WHERE nspname IN ({schemas}) LOOP
                        EXECUTE format('ALTER SCHEMA %I OWNER TO {owner}', r.nspname);
                    END LOOP;
                    FOR r IN
                        SELECT n.nspname, c.relname, c.relkind
                          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname IN ({schemas}) AND c.relkind IN ('r', 'p', 'v', 'm')
                    LOOP
                        EXECUTE format(
                            'ALTER %s %I.%I OWNER TO {owner}',
                            CASE r.relkind WHEN 'v' THEN 'VIEW'
                                           WHEN 'm' THEN 'MATERIALIZED VIEW'
                                           ELSE 'TABLE' END,
                            r.nspname, r.relname);
                    END LOOP;
                    -- Standalone sequences; a column-owned one moved with its table.
                    FOR r IN
                        SELECT n.nspname, c.relname
                          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname IN ({schemas}) AND c.relkind = 'S'
                           AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = '{owner}')
                    LOOP
                        EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO {owner}',
                                       r.nspname, r.relname);
                    END LOOP;
                END
                $$
                """
            )
        )


def test_a_non_superuser_createrole_owner_runs_the_revision(_admin_url: str) -> None:
    """Production's shape: the migrator is CREATEROLE, not a superuser, and owns coord.

    The revision's own ``upgrade()`` runs on the owner's connection, with its
    role names swapped for this test's: the real roles are cluster-wide, and a
    first creation — the production event, after which the creator holds ADMIN
    but not SET on the role — needs names nothing else has created.
    """
    suffix = secrets.token_hex(4)
    owner = f"coordrls_owner_{suffix}"
    password = secrets.token_hex(16)
    roles = (f"coordrls_t_{suffix}", f"coordrls_tp_{suffix}")
    module = _revision_module(f"as_owner_{suffix}")
    # Re-bound in the module's namespace, where upgrade() reads it at call time.
    vars(module)["ROLES"] = roles

    admin = create_engine(_admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            if not conn.execute(
                text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
            ).scalar_one():
                pytest.skip(
                    "the test Postgres login is not a superuser; cannot stage the owner"
                )
            conn.execute(
                text(
                    f"CREATE ROLE {owner} LOGIN PASSWORD '{password}' "
                    "NOSUPERUSER CREATEROLE NOBYPASSRLS"
                )
            )
        with ephemeral_database(_admin_url, "coordrls_01_owner") as (engine, db_url):
            run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
            _hand_ownership_to(engine, owner)
            owner_url = make_url(db_url).set(username=owner, password=password)
            owner_engine = create_engine(owner_url)
            try:
                # The migration context owns the transaction, as env.py's does, so
                # the revision's autocommit_block can commit it and begin anew.
                with owner_engine.connect() as conn:
                    context = MigrationContext.configure(conn)
                    with context.begin_transaction(), Operations.context(context):
                        module.upgrade()
                with owner_engine.connect() as conn:
                    assert (
                        conn.execute(
                            text(
                                "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
                            )
                        ).scalar_one()
                        is False
                    )
                    for role in roles:
                        assert conn.execute(
                            text("SELECT pg_has_role(current_user, :r, 'SET')"),
                            {"r": role},
                        ).scalar_one(), (
                            f"the owner cannot SET ROLE {role} after the upgrade"
                        )
                    conn.execute(text(f"SET ROLE {roles[0]}"))
                    assert (
                        conn.execute(text("SELECT current_user")).scalar_one()
                        == roles[0]
                    )
                    for table in _NON_COORD_READS:
                        conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
                    conn.execute(
                        text("SELECT count(*) FROM coord.sessions")
                    ).scalar_one()
                    with pytest.raises(DBAPIError, match="permission denied"):
                        conn.execute(text("SELECT count(*) FROM coord.db_scope_census"))
            finally:
                owner_engine.dispose()
            for role in roles:
                attributes = _role_attributes(engine, role)
                assert attributes is not None and attributes[:3] == (
                    False,
                    False,
                    False,
                ), f"{role}: {attributes}"
                assert not _missing_grants(engine, role), f"{role} lacks a grant"
    finally:
        # The database is gone by now, and its dependencies with it; the
        # swapped roles go before the owner that granted their memberships.
        with contextlib.suppress(Exception), admin.connect() as conn:
            for role in (*roles, owner):
                conn.execute(text(f"DROP ROLE IF EXISTS {role}"))
        admin.dispose()


# ---------------------------------------------------------------------------
# Read-only checks on one database upgraded to this revision.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def upgraded(_admin_url: str) -> Iterator[Engine]:
    with ephemeral_database(_admin_url, "coordrls_01_ro") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        yield engine


def test_both_roles_cannot_log_in_or_bypass_rls(upgraded: Engine) -> None:
    for role in _ROLES:
        attributes = _role_attributes(upgraded, role)
        assert attributes is not None, f"{role} was not created"
        can_login, bypass_rls, superuser, inherit = attributes
        assert can_login is False, (
            f"{role} must be NOLOGIN — a LOGIN role is a credential"
        )
        assert bypass_rls is False, f"{role} must be NOBYPASSRLS"
        assert superuser is False, f"{role} must not be a superuser"
        assert inherit is False, f"{role} must be NOINHERIT"


def test_every_coord_relation_grants_each_privilege_to_both_roles(
    upgraded: Engine,
) -> None:
    counts = _coord_relation_counts(upgraded)
    # Non-vacuous: the coord schema at this revision carries ~260 tables, two
    # views and dozens of sequences. Counts this low mean the walk saw nothing.
    assert counts.get("r", 0) + counts.get("p", 0) > 250, counts
    assert counts.get("v", 0) >= 2, counts
    assert counts.get("S", 0) > 0, counts
    for role in _ROLES:
        missing = _missing_grants(upgraded, role)
        assert not missing, f"{role} lacks {len(missing)}: {missing[:20]}"


def test_a_table_created_after_the_upgrade_gets_the_default_grants(
    upgraded: Engine,
) -> None:
    probe = f"coord.zz_coordrls_default_acl_{secrets.token_hex(4)}"
    with upgraded.begin() as conn:
        conn.execute(text(f"CREATE TABLE {probe} (id bigserial PRIMARY KEY)"))
    try:
        with upgraded.connect() as conn:
            for role in _ROLES:
                for privilege in _TABLE_PRIVILEGES:
                    assert conn.execute(
                        text("SELECT has_table_privilege(:r, :t, :p)"),
                        {"r": role, "t": probe, "p": privilege},
                    ).scalar_one(), f"{role} lacks {privilege} on a later table"
                for privilege in _SEQUENCE_PRIVILEGES:
                    assert conn.execute(
                        text("SELECT has_sequence_privilege(:r, :s, :p)"),
                        {"r": role, "s": f"{probe}_id_seq", "p": privilege},
                    ).scalar_one(), f"{role} lacks {privilege} on a later sequence"
    finally:
        with upgraded.begin() as conn:
            conn.execute(text(f"DROP TABLE IF EXISTS {probe}"))


def test_the_tenant_role_reads_the_non_coord_tables_it_needs(upgraded: Engine) -> None:
    with upgraded.connect() as conn:
        for role in _ROLES:
            for schema in _NON_COORD_SCHEMAS:
                assert conn.execute(
                    text("SELECT has_schema_privilege(:r, :s, 'USAGE')"),
                    {"r": role, "s": schema},
                ).scalar_one(), f"{role} lacks USAGE on schema {schema}"
            for table in _NON_COORD_READS:
                assert conn.execute(
                    text("SELECT has_table_privilege(:r, :t, 'SELECT')"),
                    {"r": role, "t": table},
                ).scalar_one(), f"{role} lacks SELECT on {table}"
        # The behaviour the grants exist for, under the role itself.
        conn.execute(text("SET ROLE coord_tenant"))
        try:
            for table in _NON_COORD_READS:
                conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
        finally:
            conn.execute(text("RESET ROLE"))


def test_the_census_tables_are_system_only(upgraded: Engine) -> None:
    with upgraded.connect() as conn:
        for role in _ROLES:
            for table in _CENSUS_TABLES:
                for privilege in (
                    *_TABLE_PRIVILEGES,
                    "TRUNCATE",
                    "REFERENCES",
                    "TRIGGER",
                ):
                    assert not conn.execute(
                        text("SELECT has_table_privilege(:r, :t, :p)"),
                        {"r": role, "t": table, "p": privilege},
                    ).scalar_one(), f"{role} holds {privilege} on {table}"
    with upgraded.connect() as conn:
        conn.execute(text("SET ROLE coord_tenant"))
        with pytest.raises(DBAPIError, match="permission denied"):
            conn.execute(text("SELECT count(*) FROM coord.db_scope_census"))


def test_both_views_are_security_invoker(upgraded: Engine) -> None:
    for view in _VIEWS:
        options = _view_options(upgraded, view)
        assert "security_invoker=true" in options, f"{view}: {options!r}"


def test_the_upgrade_enables_no_row_level_security(upgraded: Engine) -> None:
    enabled = scalar(
        upgraded,
        """
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'coord' AND (c.relrowsecurity OR c.relforcerowsecurity)
        """,
    )
    assert enabled == 0, f"{enabled} coord tables have row-level security on"
    policies = scalar(
        upgraded, "SELECT count(*) FROM pg_policies WHERE schemaname = 'coord'"
    )
    assert policies == 0, f"{policies} coord policies exist"


def test_the_census_tables_have_their_keys(upgraded: Engine) -> None:
    with upgraded.connect() as conn:
        keys = {
            row[0]: row[1]
            for row in conn.execute(
                text(
                    """
                    SELECT c.conrelid::regclass::text, pg_get_constraintdef(c.oid)
                      FROM pg_constraint c
                     WHERE c.contype = 'p'
                       AND c.conrelid IN (to_regclass('coord.db_scope_census'),
                                          to_regclass('coord.db_scope_census_flushes'))
                    """
                )
            ).fetchall()
        }
    assert keys == {
        "coord.db_scope_census": "PRIMARY KEY (day, scope, source, label, site)",
        "coord.db_scope_census_flushes": "PRIMARY KEY (replica_id, day)",
    }, keys
