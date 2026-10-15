"""coordrls 01 — the coord_tenant / coord_tenant_preflight roles, their grants, and the scope-census tables

Revision ID: coordrls_01
Revises: image_assets_01
Create Date: 2026-10-15

Phase 1 of plan ``2026-10-15-coord-tenant-isolation-has-no-database-enforcement``
(qontinui-dev-notes ``7cba6994``): review recommendation R10, claim
``r10-database-tenant-isolation`` of ``domain_spec/coord-review-2026-10``.

What it is for
==============

Coord's tenant isolation is enforced only by per-query ``WHERE tenant_id = $1``
filters. The plan backs those filters with Postgres row-level security keyed on
the credential's tenant, enforced through a NOLOGIN role that coord's pool
assumes at every checkout (plan D1-D3). This revision creates that role and
its preview twin, grants them what coord's tenant-path code reads and writes,
and creates the two tables coord's scope census will write. It enforces
NOTHING: no table gets row-level security and no policy exists after it runs.

The two roles
=============

``coord_tenant``
    The role a tenant-scoped checkout will assume (``set_config('role', …)``,
    plan D3, from Phase 4). Policies created by later revisions apply TO it.
``coord_tenant_preflight``
    The preview role (plan D5): a wave's real policies are created ``TO`` it
    first, so the pre-flight and the canary can measure them against
    production data before they apply to traffic.

Both are ``NOLOGIN NOINHERIT NOBYPASSRLS``: they cannot authenticate, so they
are not credentials, and only a member holding the SET option can assume them.
The migrating role grants ITSELF that option (``WITH INHERIT FALSE, SET TRUE``):
a ``CREATEROLE`` creator holds only ADMIN on a role it creates (PostgreSQL 16,
``createrole_self_grant`` unset — measured on production 2026-10-15), and the
migrating role is the role coord connects as (one customer login role; the
migrator's secret is for that same user). A superuser, as in CI, needs no
membership, and ``pg_has_role(…, 'SET')`` already reads true for it, so the
grant is skipped there.

Roles are cluster-wide, not per database. CI and dev clusters host several
databases, so creation is idempotent, and swallows ``unique_violation`` as
well as ``duplicate_object`` because two concurrent ``CREATE ROLE`` statements
of one name race on ``pg_authid``'s unique index rather than raising
``duplicate_object``. A role that already exists in any other shape — with
LOGIN, INHERIT, BYPASSRLS, SUPERUSER, CREATEROLE, CREATEDB or REPLICATION, or
as a member of another role — is refused rather than granted coord's
privileges: a pre-existing role of that name is not this design's role.

What changes for whom
=====================

Nothing changes for any connection that exists today. Every coord, web and
alembic connection is the owner of every coord table, and no policy exists, so
the owner's reads and writes are untouched. The roles receive privileges, but
nothing assumes them until coord's Phase 4.

The grants
==========

To both roles:

* ``USAGE`` on schema ``coord``; ``SELECT, INSERT, UPDATE, DELETE`` on every
  coord table and view; ``USAGE, SELECT, UPDATE`` on every coord sequence.
* The same on objects the migrating role creates in ``coord`` LATER, through
  ``ALTER DEFAULT PRIVILEGES``, so a table a later revision adds is not a
  ``42501`` the first time a tenant path touches it.
* ``SELECT`` on the four non-coord tables coord's tenant-path code reads —
  ``auth.users``, ``project.workflow_verification_phase_results``,
  ``devenv.machines`` and ``devenv.environments`` — and ``USAGE`` on their
  schemas. ``auth``, ``project`` and ``devenv`` carry no PUBLIC usage, so a
  table grant alone still fails "permission denied for schema auth".
  Re-derived 2026-10-15 at qontinui-coord ``8b46d59af`` with the plan's grep;
  ``public.alembic_version`` is read only by coord's boot and observer paths,
  which stay the owner, so it gets nothing.

``TRUNCATE``, ``REFERENCES`` and ``TRIGGER`` are not granted.

The two views
=============

``coord.memories_latest`` and ``coord.pr_check_runs_latest`` are switched to
``security_invoker = true``. A default view runs with its OWNER's rights, so
under the tenant role it would read every tenant's rows (plan fact 7). For the
owner — every connection today — invoker and owner are the same role, so
nothing changes. ``CREATE OR REPLACE VIEW`` resets the option (plan fact 15);
``tests/test_coord_views_security_invoker.py`` asserts every coord view at
the alembic head carries it, so a later revision that drops it reds.

Each switch takes an ``AccessExclusiveLock`` on its view. ``alembic/env.py``
runs a whole upgrade batch in ONE transaction, so inside it that lock would be
held until the entire deploy batch commits, blocking every reader of the view
(coord's gate and merge reads among them) and draining its pool. So each switch
runs in an ``autocommit_block`` as a transaction of its own —
``BEGIN; SET LOCAL lock_timeout = '3s'; ALTER VIEW …; COMMIT`` — and holds the
lock only for the ``ALTER``. Entering the block commits the batch so far (this
revision's roles, tables and grants included). The revision is idempotent, so
a retry after a run that failed past that point is safe.

The census tables
=================

``coord.db_scope_census``
    Daily checkout counts per ``(day, scope, source, label, site)``, summed
    across coord replicas: which scope each pooled checkout ran under, and for
    the unscoped ones the ``file:line`` that made it. Phase 3 of the plan
    writes it; the counts gate every later rung.
``coord.db_scope_census_flushes``
    One row per ``(replica_id, day)``, written on every flush even when every
    count is zero, so "nobody checked out unscoped" can be told apart from
    "nobody flushed".

Both are global (no tenant data: labels are route templates, worker names and
source sites) and ``system_only``: the blanket ``GRANT … ON ALL TABLES IN
SCHEMA coord`` grants them to both roles like every other coord table, and this
revision then revokes that, so a tenant-scoped checkout that touches them fails
loudly (``42501``) instead of reading or writing them.

Downgrade
=========

The reverse, in reverse order, the view resets in their own transactions as
the switches were. The roles are dropped only when ``pg_shdepend`` lists
nothing else that depends on them — another database in the same cluster may
still hold grants to them — and are kept, with a NOTICE, otherwise.

The revokes leave each coord table and sequence with an explicit owner-only ACL
where it had none (``NULL``, the default) before this revision. The two grant
exactly the same privileges, so this has no functional effect.

Landing
=======

coord's migration classifier rejects these statement shapes (``CREATE ROLE``,
``GRANT``, ``ALTER DEFAULT PRIVILEGES``, ``ALTER VIEW``, ``DO`` blocks), so the
PR is escalate-path-matched and is cleared through
``coord_submit_escalate_evidence`` once ``Migration Reversal Gate`` is green
(plan D7).

Chains off ``image_assets_01``
==============================

That was the single local alembic head on ``origin/main`` at ``afd4b765c``
(``poetry run alembic heads`` printed exactly one). If another revision lands
first, re-point ``down_revision``, the ``Revises:`` header above and
``_PARENT_REVISION_ID`` in the companion test together. No ``alembic merge``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coordrls_01"
down_revision: str | Sequence[str] | None = "image_assets_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


#: The tenant role first, then the preview role.
ROLES: tuple[str, ...] = ("coord_tenant", "coord_tenant_preflight")

#: The non-coord tables coord's tenant-path code reads, and their schemas.
NON_COORD_READS: tuple[str, ...] = (
    "auth.users",
    "project.workflow_verification_phase_results",
    "devenv.machines",
    "devenv.environments",
)
NON_COORD_SCHEMAS: tuple[str, ...] = ("auth", "project", "devenv")

#: The two tables coord's scope census writes. Global and system_only.
CENSUS_TABLES: tuple[str, ...] = (
    "coord.db_scope_census",
    "coord.db_scope_census_flushes",
)

#: The coord views switched to security_invoker.
COORD_VIEWS: tuple[str, ...] = (
    "coord.memories_latest",
    "coord.pr_check_runs_latest",
)

_TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE"
_SEQUENCE_PRIVILEGES = "USAGE, SELECT, UPDATE"


def create_role_sql(role: str) -> str:
    """Idempotent ``CREATE ROLE`` that refuses a squatted role of the same name.

    A pre-existing role passes only as this revision would have made it:
    NOLOGIN, NOINHERIT, NOBYPASSRLS, no SUPERUSER / CREATEROLE / CREATEDB /
    REPLICATION, and a member of no other role.
    """
    return f"""
        DO $$
        BEGIN
            BEGIN
                CREATE ROLE {role} NOLOGIN NOINHERIT NOBYPASSRLS;
            EXCEPTION
                WHEN duplicate_object OR unique_violation THEN
                    RAISE NOTICE 'coordrls_01: role {role} already exists';
            END;
            -- A member of another role inherits that role's rights and, for
            -- row-level security, may count as a table's owner; CREATEROLE,
            -- CREATEDB and REPLICATION are authority this NOLOGIN role must
            -- never hold; and the revision makes it NOINHERIT.
            IF EXISTS (
                SELECT 1 FROM pg_roles r
                 WHERE r.rolname = '{role}'
                   AND (r.rolcanlogin OR r.rolbypassrls OR r.rolsuper
                        OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
                        OR r.rolinherit
                        OR EXISTS (SELECT 1 FROM pg_auth_members m
                                    WHERE m.member = r.oid))
            ) THEN
                RAISE EXCEPTION
                    'coordrls_01: role {role} exists with LOGIN, INHERIT, BYPASSRLS, '
                    'SUPERUSER, CREATEROLE, CREATEDB or REPLICATION, or as a member of '
                    'another role; refusing to grant it coord privileges';
            END IF;
        END
        $$
    """


def self_grant_sql(role: str) -> str:
    """Give the migrating role the SET option on ``role``, unless it holds it."""
    return f"""
        DO $$
        BEGIN
            IF NOT pg_has_role(current_user, '{role}', 'SET') THEN
                EXECUTE format(
                    'GRANT {role} TO %I WITH INHERIT FALSE, SET TRUE',
                    current_user
                );
            END IF;
        END
        $$
    """


def revoke_role_sql(role: str) -> str:
    """Revoke, in this database, every privilege upgrade() gave ``role``.

    A ``DO`` block rather than plain statements because a ``REVOKE`` naming a
    role that does not exist errors, and the roles are cluster-wide: another
    database's downgrade may already have dropped them.
    """
    table_reads = ", ".join(NON_COORD_READS)
    schemas = ", ".join(NON_COORD_SCHEMAS)
    statements = (
        f"REVOKE SELECT ON {table_reads} FROM {role}",
        f"REVOKE USAGE ON SCHEMA {schemas} FROM {role}",
        "ALTER DEFAULT PRIVILEGES IN SCHEMA coord "
        f"REVOKE {_SEQUENCE_PRIVILEGES} ON SEQUENCES FROM {role}",
        "ALTER DEFAULT PRIVILEGES IN SCHEMA coord "
        f"REVOKE {_TABLE_PRIVILEGES} ON TABLES FROM {role}",
        f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA coord FROM {role}",
        f"REVOKE ALL ON ALL TABLES IN SCHEMA coord FROM {role}",
        f"REVOKE ALL ON SCHEMA coord FROM {role}",
    )
    body = "\n".join(f"                EXECUTE '{s}';" for s in statements)
    return f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
{body}
            END IF;
        END
        $$
    """


def drop_role_sql(role: str) -> str:
    """Drop ``role`` when nothing in any database still depends on it."""
    return f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                RETURN;
            END IF;
            IF EXISTS (
                SELECT 1 FROM pg_shdepend
                 WHERE refclassid = 'pg_authid'::regclass
                   AND refobjid = (SELECT oid FROM pg_roles WHERE rolname = '{role}')
            ) THEN
                RAISE NOTICE
                    'coordrls_01: keeping role {role}: another database still '
                    'depends on it';
            ELSE
                EXECUTE 'DROP ROLE {role}';
            END IF;
        END
        $$
    """


def _grantees() -> str:
    return ", ".join(ROLES)


def view_option_sql(view: str, change: str) -> str:
    """One view-option change as a transaction of its own (see the module docs)."""
    return f"BEGIN; SET LOCAL lock_timeout = '3s'; ALTER VIEW {view} {change}; COMMIT"


def upgrade() -> None:
    """Create both roles, grant them coord's tenant-path privileges, add the census tables."""
    # Bound every lock wait in the batch transaction. The CREATE TABLEs lock
    # only the two new tables, which no other session can see before the batch
    # commits; the view switches below run in transactions of their own.
    op.execute("SET LOCAL lock_timeout = '3s'")

    for role in ROLES:
        op.execute(create_role_sql(role))
        op.execute(self_grant_sql(role))

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.db_scope_census (
            day           date        NOT NULL,
            scope         text        NOT NULL,
            source        text        NOT NULL DEFAULT '',
            label         text        NOT NULL DEFAULT '',
            site          text        NOT NULL DEFAULT '',
            checkouts     bigint      NOT NULL DEFAULT 0 CHECK (checkouts >= 0),
            first_seen_at timestamptz NOT NULL DEFAULT now(),
            last_seen_at  timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (day, scope, source, label, site)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.db_scope_census IS
            'Daily pooled-checkout counts per (day, scope, source, label, site), '
            'summed across coord replicas: which database scope each checkout ran '
            'under, and for unbound or context-free checkouts the file:line that '
            'made it. Writer: coord db_scope census flush (plan '
            '2026-10-15-coord-tenant-isolation-has-no-database-enforcement, '
            'Phase 3). No tenant data. system_only: the tenant roles hold no '
            'privilege on it.'
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.db_scope_census_flushes (
            replica_id    text        NOT NULL,
            day           date        NOT NULL,
            flushes       bigint      NOT NULL DEFAULT 0 CHECK (flushes >= 0),
            last_flush_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (replica_id, day)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.db_scope_census_flushes IS
            'One row per (replica_id, day) that a coord replica flushed its scope '
            'census, written even when every count is zero, so a day with no '
            'unscoped checkouts can be told apart from a day nobody measured. '
            'system_only: the tenant roles hold no privilege on it.'
        """
    )

    grantees = _grantees()
    op.execute(f"GRANT USAGE ON SCHEMA coord TO {grantees}")
    op.execute(f"GRANT {_TABLE_PRIVILEGES} ON ALL TABLES IN SCHEMA coord TO {grantees}")
    op.execute(
        f"GRANT {_SEQUENCE_PRIVILEGES} ON ALL SEQUENCES IN SCHEMA coord TO {grantees}"
    )
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA coord "
        f"GRANT {_TABLE_PRIVILEGES} ON TABLES TO {grantees}"
    )
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA coord "
        f"GRANT {_SEQUENCE_PRIVILEGES} ON SEQUENCES TO {grantees}"
    )
    for schema in NON_COORD_SCHEMAS:
        op.execute(f"GRANT USAGE ON SCHEMA {schema} TO {grantees}")
    for table in NON_COORD_READS:
        op.execute(f"GRANT SELECT ON {table} TO {grantees}")

    # system_only: undo what the blanket GRANT ON ALL TABLES just gave them.
    op.execute(f"REVOKE ALL ON {', '.join(CENSUS_TABLES)} FROM {grantees}")

    # Each AccessExclusiveLock on a view lasts only its own transaction, not
    # the rest of the deploy batch (module docs, "The two views").
    with op.get_context().autocommit_block():
        for view in COORD_VIEWS:
            op.execute(view_option_sql(view, "SET (security_invoker = true)"))


def downgrade() -> None:
    """Reverse upgrade(): views, census tables, grants, then the roles if nothing else needs them."""
    with op.get_context().autocommit_block():
        for view in COORD_VIEWS:
            op.execute(view_option_sql(view, "RESET (security_invoker)"))

    op.execute("SET LOCAL lock_timeout = '3s'")

    for table in reversed(CENSUS_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table}")

    for role in reversed(ROLES):
        op.execute(revoke_role_sql(role))
        op.execute(drop_role_sql(role))
