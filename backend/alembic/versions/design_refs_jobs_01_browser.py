"""design_refs capture_job.browser and claimed_by_actor

Revision ID: design_refs_jobs_01
Revises: coord_policy_outcome_counts_02
Create Date: 2026-11-16

Phase 1b-i of plan
``2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query``.
Hand-authored — never ``alembic revision --autogenerate`` (served policy
``production-and-cost`` ``alembic-sole-authorship``). Product data in the
``design_refs`` schema; no ``coord.*`` relation is touched.

``design_refs_01`` already carries the rest of the Phase 1b store (the
``capture_job`` queue with its lease, ``review_state`` / ``quality`` on every
curated record, the append-only ``correction`` log). This adds two columns:

- ``browser`` (``launched`` | ``attached``): the worker captures in a browser
  it launches, or attaches over CDP to the operator's own Chrome for sites a
  headless browser cannot get into. NOT NULL with a ``launched`` default, so
  existing rows are valid unchanged.
- ``claimed_by_actor``: the principal identity of the caller that claimed the
  job (``claimed_by`` stays the worker's self-chosen label). ``/complete``
  authorizes against it, so only the claimant's credential (or an operator)
  can end a running job. Nullable: an unclaimed job has none.

Every step is guarded so a re-run, or a database that already carries a piece,
does not fail on a duplicate. A guard that finds a column already present
checks its type and nullability and RAISES when they differ, rather than
accepting a column this revision did not define.
"""

from __future__ import annotations

from alembic import op

revision: str = "design_refs_jobs_01"
down_revision: str = "coord_policy_outcome_counts_02"
branch_labels = None
depends_on = None


def _add_column_or_verify(
    column: str,
    ddl: str,
    data_type: str,
    max_length: int | None,
    nullable: bool,
    default: str | None,
) -> None:
    """Add ``column`` with ``ddl``, or, when it exists, refuse unless it is
    exactly the declared type, nullability and default. ``default`` is the
    ``information_schema.columns.column_default`` rendering (``None`` = no
    default)."""
    length_check = (
        f"OR character_maximum_length IS DISTINCT FROM {max_length}"
        if max_length is not None
        else ""
    )
    default_sql = "NULL" if default is None else "'" + default.replace("'", "''") + "'"
    is_nullable = "YES" if nullable else "NO"
    quoted_ddl = ddl.replace("'", "''")  # inside the RAISE string literal
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'design_refs'
                   AND table_name = 'capture_job'
                   AND column_name = '{column}'
            ) THEN
                ALTER TABLE design_refs.capture_job ADD COLUMN {column} {ddl};
            ELSIF EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'design_refs'
                   AND table_name = 'capture_job'
                   AND column_name = '{column}'
                   AND (data_type <> '{data_type}'
                        OR is_nullable <> '{is_nullable}'
                        OR column_default IS DISTINCT FROM {default_sql}
                        {length_check})
            ) THEN
                RAISE EXCEPTION
                    'design_refs.capture_job.{column} exists with a type, '
                    'nullability or default other than {quoted_ddl}; '
                    'refusing to adopt it';
            END IF;
        END
        $$;
        """
    )


def upgrade() -> None:
    _add_column_or_verify(
        "browser",
        "varchar(16) NOT NULL DEFAULT 'launched'",
        "character varying",
        16,
        nullable=False,
        default="'launched'::character varying",
    )
    _add_column_or_verify(
        "claimed_by_actor", "text", "text", None, nullable=True, default=None
    )
    # The CHECK: added when absent; when present, its body must be the one this
    # revision declares. The expected body is not hard-coded (Postgres's
    # rendering of a CHECK varies across versions): it is read back from a
    # NOT VALID twin added under a scratch name and dropped again in the same
    # transaction, so both renderings come from the same server.
    op.execute(
        """
        DO $$
        DECLARE
            existing text;
            expected text;
        BEGIN
            SELECT pg_get_constraintdef(c.oid) INTO existing
              FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = 'design_refs'
               AND t.relname = 'capture_job'
               AND c.conname = 'ck_capture_job_browser';
            IF existing IS NULL THEN
                ALTER TABLE design_refs.capture_job
                    ADD CONSTRAINT ck_capture_job_browser
                    CHECK (browser IN ('launched', 'attached'));
                RETURN;
            END IF;
            ALTER TABLE design_refs.capture_job
                ADD CONSTRAINT ck_capture_job_browser_expected
                CHECK (browser IN ('launched', 'attached')) NOT VALID;
            SELECT replace(pg_get_constraintdef(c.oid), ' NOT VALID', '')
              INTO expected
              FROM pg_constraint c
              JOIN pg_class t ON t.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = 'design_refs'
               AND t.relname = 'capture_job'
               AND c.conname = 'ck_capture_job_browser_expected';
            ALTER TABLE design_refs.capture_job
                DROP CONSTRAINT ck_capture_job_browser_expected;
            IF existing IS DISTINCT FROM expected THEN
                RAISE EXCEPTION
                    'design_refs.capture_job constraint ck_capture_job_browser '
                    'exists as % but this revision declares %; refusing to '
                    'adopt it', existing, expected;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE design_refs.capture_job "
        "DROP CONSTRAINT IF EXISTS ck_capture_job_browser"
    )
    op.execute(
        "ALTER TABLE design_refs.capture_job DROP COLUMN IF EXISTS claimed_by_actor"
    )
    op.execute("ALTER TABLE design_refs.capture_job DROP COLUMN IF EXISTS browser")
