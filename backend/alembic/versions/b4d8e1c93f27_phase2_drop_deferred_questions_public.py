"""phase 2: drop public.deferred_questions after runner v33 type-aligns it

Revision ID: b4d8e1c93f27
Revises: f1a9c2e7b3d4
Create Date: 2026-04-29

Web-side companion to qontinui-runner PR #4 (runner migration v33,
which aligns 6 column types in ``runner.deferred_questions`` from
``TEXT`` to ``UUID`` / ``VARCHAR(N)`` to match this backend's
SQLAlchemy model).

Once v33 has applied on a given DB, ``runner.deferred_questions``
and ``public.deferred_questions`` have matching column sets, so the
empty ``public.*`` duplicate becomes droppable.

Re-runs the same introspection-based DO block as
``e8a3c5b9d142`` and ``f1a9c2e7b3d4`` — naturally idempotent and
naturally gated by the column-set match condition. If runner v33
hasn't applied yet on a given DB, ``deferred_questions`` is skipped
as drift and stays put. So this can ship in either order relative
to v33; it just becomes effective once both have run.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b4d8e1c93f27"
down_revision: str = "f1a9c2e7b3d4"
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

    RAISE NOTICE 'b4d8e1c93f27 summary: dropped=%, skipped_drift=%, skipped_nonempty=%',
        dropped, skipped_drift, skipped_nonempty;
END $$;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    raise NotImplementedError(
        "Drop of public schema duplicates is not reversible without a "
        "pre-migration snapshot. Restore from backup if needed."
    )
