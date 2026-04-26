"""repoint user FKs to runner.users

Revision ID: d7e2f1a8b3c4
Revises: c6d1e2f3a4b5
Create Date: 2026-04-26

Background
----------
The web backend's User model resolves to ``runner.users`` at runtime
via the per-connection ``search_path = runner, public`` set in
``app/db/session.py:48-57`` (env-gated by ``WEB_DB_USE_RUNNER_SCHEMA``,
default ``true`` in dev). All historical alembic migrations created
their FKs against the SQLAlchemy metadata's view of ``users``, which
alembic resolves as ``public.users`` (the User model has no
``__table_args__["schema"]``). The actual user data lives in
``runner.users`` because the qontinui-runner's migration v20
(``qontinui-runner/src-tauri/src/database/pg/mod.rs:808-849``,
"Consolidate all tables into runner schema") consolidates everything
INTO the ``runner`` schema on every fresh DB volume.

Result before this migration: writes that reference a user fail with
``ForeignKeyViolationError`` — ``runner.users`` has the data, FKs
target empty ``public.users``. A previous session manually realigned
4 FKs (``runner_tokens``, ``runners``, ``runner_connections``,
``runner_devices``) to unblock runner registration. The other ~82
were still broken.

This migration repoints every still-broken FK to ``runner.users``,
without hardcoding the table list. It uses ``pg_constraint``
introspection so:

* All still-broken FKs are repointed regardless of which subset is
  currently broken at apply time.
* The 4 already-realigned ones are skipped automatically (their
  ``confrelid`` already references ``runner.users``).
* Idempotent — running twice is a no-op.
* No-op on a fresh DB after runner v20 has run (``ALTER TABLE
  public.users SET SCHEMA runner`` carried the FKs along, so nothing
  targets ``public.users`` anymore).
* No-op if ``runner.users`` doesn't exist yet (the runner hasn't
  started for the first time on this DB) — runner v20 will preserve
  FKs when it ``SET SCHEMA``\\s the users table.

Deferred follow-up (intentionally out of scope here)
----------------------------------------------------
Making the SQLAlchemy User model schema-explicit
(``__table_args__ = {"schema": "runner"}`` at
``app/models/user.py:11-24``) requires renaming
``ForeignKey("users.id", ...)`` to ``ForeignKey("runner.users.id",
...)`` across ~58 model files, otherwise SQLAlchemy's FK string
resolution breaks at import time. That refactor is out of scope here;
the runtime ORM path keeps working via search_path. The cost of
deferral: future ``alembic autogenerate`` runs may try to recreate
FKs targeting ``public.users``. Re-running this migration repairs
that. File a follow-up if autogenerate churn becomes painful.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e2f1a8b3c4"
down_revision: str = "c6d1e2f3a4b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_UPGRADE_SQL = """
DO $$
DECLARE
    runner_users_oid oid;
    public_users_oid oid;
    fk RECORD;
    on_delete TEXT;
    on_update TEXT;
    column_list TEXT;
    repointed INT := 0;
BEGIN
    -- Precondition: runner.users must exist. On a fresh DB, the
    -- runner hasn't started yet; the runner's migration v20 will
    -- later move public.users -> runner.users (FKs follow). Nothing
    -- for us to do in that case.
    SELECT c.oid INTO runner_users_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'runner'
      AND c.relname = 'users'
      AND c.relkind = 'r';

    IF runner_users_oid IS NULL THEN
        RAISE NOTICE 'runner.users does not exist; skipping repoint '
            '(runner v20 will handle the move on first runner startup)';
        RETURN;
    END IF;

    SELECT c.oid INTO public_users_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'users'
      AND c.relkind = 'r';

    IF public_users_oid IS NULL THEN
        RAISE NOTICE 'public.users does not exist; nothing targets it';
        RETURN;
    END IF;

    -- For every FK whose referenced table is public.users, drop and
    -- recreate it pointing at runner.users with the same column list
    -- and ON DELETE / ON UPDATE actions.
    FOR fk IN
        SELECT
            c.conname           AS constraint_name,
            c.conrelid          AS source_oid,
            ns.nspname          AS source_schema,
            cs.relname          AS source_table,
            c.confdeltype       AS on_delete_code,
            c.confupdtype       AS on_update_code,
            c.conkey            AS source_attnums
        FROM pg_constraint c
        JOIN pg_class cs ON cs.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = cs.relnamespace
        WHERE c.contype = 'f'
          AND c.confrelid = public_users_oid
    LOOP
        SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY ord)
          INTO column_list
        FROM unnest(fk.source_attnums) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = fk.source_oid AND a.attnum = u.attnum;

        on_delete := CASE fk.on_delete_code
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
        END;
        on_update := CASE fk.on_update_code
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
        END;

        EXECUTE format(
            'ALTER TABLE %I.%I DROP CONSTRAINT %I',
            fk.source_schema, fk.source_table, fk.constraint_name
        );

        EXECUTE format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I '
            'FOREIGN KEY (%s) REFERENCES runner.users(id) '
            'ON DELETE %s ON UPDATE %s',
            fk.source_schema, fk.source_table, fk.constraint_name,
            column_list, on_delete, on_update
        );

        repointed := repointed + 1;
        RAISE NOTICE
            'Repointed % on %.% (cols: %, ON DELETE %, ON UPDATE %)',
            fk.constraint_name, fk.source_schema, fk.source_table,
            column_list, on_delete, on_update;
    END LOOP;

    RAISE NOTICE 'Repointed % FK(s) from public.users to runner.users',
        repointed;
END $$;
"""


_DOWNGRADE_SQL = """
-- Symmetric inverse: repoint every public-schema FK currently
-- targeting runner.users back to public.users. Requires both tables
-- to exist with compatible row sets, otherwise ADD CONSTRAINT will
-- fail validation. Only restore the public-schema source FKs we
-- ourselves moved; leave intra-runner-schema FKs alone (those came
-- from runner v20 / are not ours to manage).
DO $$
DECLARE
    runner_users_oid oid;
    public_users_oid oid;
    fk RECORD;
    on_delete TEXT;
    on_update TEXT;
    column_list TEXT;
    restored INT := 0;
BEGIN
    SELECT c.oid INTO runner_users_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'runner'
      AND c.relname = 'users'
      AND c.relkind = 'r';

    SELECT c.oid INTO public_users_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'users'
      AND c.relkind = 'r';

    IF runner_users_oid IS NULL OR public_users_oid IS NULL THEN
        RAISE EXCEPTION
            'downgrade requires both runner.users and public.users to exist';
    END IF;

    FOR fk IN
        SELECT
            c.conname           AS constraint_name,
            c.conrelid          AS source_oid,
            ns.nspname          AS source_schema,
            cs.relname          AS source_table,
            c.confdeltype       AS on_delete_code,
            c.confupdtype       AS on_update_code,
            c.conkey            AS source_attnums
        FROM pg_constraint c
        JOIN pg_class cs ON cs.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = cs.relnamespace
        WHERE c.contype = 'f'
          AND c.confrelid = runner_users_oid
          AND ns.nspname = 'public'
    LOOP
        SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY ord)
          INTO column_list
        FROM unnest(fk.source_attnums) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = fk.source_oid AND a.attnum = u.attnum;

        on_delete := CASE fk.on_delete_code
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
        END;
        on_update := CASE fk.on_update_code
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
        END;

        EXECUTE format(
            'ALTER TABLE %I.%I DROP CONSTRAINT %I',
            fk.source_schema, fk.source_table, fk.constraint_name
        );

        EXECUTE format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I '
            'FOREIGN KEY (%s) REFERENCES public.users(id) '
            'ON DELETE %s ON UPDATE %s',
            fk.source_schema, fk.source_table, fk.constraint_name,
            column_list, on_delete, on_update
        );

        restored := restored + 1;
    END LOOP;

    RAISE NOTICE 'Restored % FK(s) to public.users', restored;
END $$;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.execute(_DOWNGRADE_SQL)
