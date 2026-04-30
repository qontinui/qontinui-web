"""drop empty public duplicates

Revision ID: e8a3c5b9d142
Revises: d7e2f1a8b3c4
Create Date: 2026-04-27

Background
----------
The DB carries two layers of tables: the runner schema (managed by
``qontinui-runner``'s native migrations + ``schema.pg.sql``, see
``qontinui-runner/src-tauri/src/database/pg/mod.rs``) and the public
schema (created by this alembic chain). Migration v20 of the runner
(``mod.rs:808-849``) consolidates everything INTO the runner schema:
``ALTER TABLE … SET SCHEMA runner`` for public-only tables, and
``DROP TABLE … CASCADE`` for tables that exist in both.

Because v20 is idempotent (tracked in ``schema_migrations``), it only
runs once per DB. Subsequent alembic upgrades that recreate tables in
``public`` then leave permanent empty duplicates — a 0-row
``public.X`` next to the live ``runner.X``. After the user-FK
migration (``d7e2f1a8b3c4``), most of these empty duplicates have no
FKs targeting them either; they are pure cruft.

This migration drops every ``public.X`` for which:

* ``runner.X`` exists, AND
* the column sets match exactly (name + type), AND
* ``public.X`` is empty (0 rows).

Drift cases (33 tables where column sets differ between schemas) are
intentionally NOT touched here — those need per-table analysis to
decide which schema is canonical and whether the two are even the
same domain concept (e.g. ``recordings`` is 47 cols in public vs 14
in runner — they appear to be different things sharing a name). See
the sibling plan file
``tmp_schema_drift_followup_plan.md`` (in the working tree) for
that work.

The migration is dynamic — it discovers candidates by introspecting
``information_schema`` rather than hardcoding a list. Re-running is a
no-op (the dropped tables don't exist anymore, the iteration finds
nothing).

Cross-schema FK safety
----------------------
Audit at apply time (2026-04-27) showed:

* 87 cross-schema FKs total, ALL from ``public.* -> runner.users``.
* 0 FKs from ``runner.* -> public.*``.

So ``DROP TABLE public.X CASCADE`` only drops the now-pointless
``public.X -> runner.users`` FK as a side effect (the public.X is
empty and going away anyway). No runner-side integrity is touched.

The migration also drops ``public.users`` itself once all its
incoming FKs have been removed by earlier iterations (or
explicitly via CASCADE). The drop happens last to keep ordering
clean.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e8a3c5b9d142"
down_revision: str = "d7e2f1a8b3c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_UPGRADE_SQL = """
DO $$
DECLARE
    tbl TEXT;
    p_count BIGINT;
    cols_match BOOLEAN;
    dropped INT := 0;
    skipped_drift INT := 0;
    skipped_nonempty INT := 0;
BEGIN
    -- For every table that exists in BOTH public and runner schemas,
    -- check if columns match and public copy is empty. If so, drop
    -- the public copy.
    FOR tbl IN
        SELECT p.table_name
        FROM information_schema.tables p
        JOIN information_schema.tables r USING (table_name)
        WHERE p.table_schema = 'public'
          AND r.table_schema = 'runner'
          AND p.table_type = 'BASE TABLE'
          AND r.table_type = 'BASE TABLE'
        ORDER BY p.table_name
    LOOP
        SELECT NOT EXISTS (
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = tbl
            EXCEPT
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'runner' AND table_name = tbl
        ) AND NOT EXISTS (
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'runner' AND table_name = tbl
            EXCEPT
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = tbl
        )
        INTO cols_match;

        IF NOT cols_match THEN
            skipped_drift := skipped_drift + 1;
            CONTINUE;
        END IF;

        EXECUTE format('SELECT COUNT(*) FROM public.%I', tbl) INTO p_count;
        IF p_count > 0 THEN
            skipped_nonempty := skipped_nonempty + 1;
            RAISE NOTICE 'Skipped public.% (% rows) - not empty', tbl, p_count;
            CONTINUE;
        END IF;

        EXECUTE format('DROP TABLE public.%I CASCADE', tbl);
        dropped := dropped + 1;
        RAISE NOTICE 'Dropped public.%', tbl;
    END LOOP;

    RAISE NOTICE 'Drop summary: dropped=%, skipped_drift=%, skipped_nonempty=%',
        dropped, skipped_drift, skipped_nonempty;

    -- Drop public.users last (it's the FK target for everything we just
    -- dropped, but the FK migration d7e2f1a8b3c4 already moved all FKs
    -- to runner.users, and we're dropping the public child tables here).
    -- The d7e2f1a8b3c4 audit confirmed 0 FKs target public.users.
    --
    -- Post-consolidation amendment: only drop public.users if runner.users
    -- exists. On a fresh canonical DB (consolidation transplant scenario)
    -- there is no runner-native MIGRATIONS array running, so runner.users
    -- never gets created, and the d7e2f1a8b3c4 FK-repoint was a no-op
    -- (left FKs targeting public.users). Dropping public.users in that
    -- world would CASCADE-drop every FK consumer. The consolidation
    -- chain's final cleanup revision (zz_final_runner_cleanup) handles
    -- the public.users -> auth.users move on fresh canonical DBs.
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'runner' AND table_name = 'users'
    ) THEN
        IF (SELECT COUNT(*) FROM public.users) = 0 THEN
            DROP TABLE public.users CASCADE;
            RAISE NOTICE 'Dropped public.users';
        ELSE
            RAISE NOTICE 'Skipped public.users - not empty';
        END IF;
    ELSE
        RAISE NOTICE 'Skipped public.users - runner.users does not exist '
                     '(fresh canonical DB; cleanup revision will move public.users to auth)';
    END IF;
END $$;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    raise NotImplementedError(
        "Drop of public schema duplicates is not reversible without a "
        "pre-migration snapshot. Restore from backup if needed."
    )
