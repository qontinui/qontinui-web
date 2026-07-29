"""coord prompt_documents — allow kind='prompt_template'

Revision ID: coord_prompt_docs_02
Revises: dry_run_retire_02_drop_bools
Create Date: 2026-07-24

Phase 1 of the terminal-prompt-library-command plan
(``qontinui-dev-notes/plans/2026-07-24-terminal-prompt-library-command.md``):
widen the ``kind`` CHECK on ``coord.prompt_documents`` to admit a fifth
content family, ``prompt_template`` — curated, parameterized prompts served
to runner terminals (the ``/prompt`` library). Prompt templates are authored
and versioned through the exact same store as policies; only the CHECK
stands in the way.

Constraint-name strategy
========================

``coord_prompt_docs_01`` declared the CHECK inline on the ``kind`` column,
so PostgreSQL auto-named it (conventionally
``prompt_documents_kind_check``, but the name is an implementation detail
and must not be assumed). This migration therefore discovers every CHECK
constraint attached to the ``kind`` column via ``pg_constraint`` and drops
each by its discovered name, then re-adds the widened CHECK under the
explicit, stable name ``ck_prompt_documents_kind``. Downgrade restores the
original four-value CHECK the same defensive way (discover-and-drop, then
add by explicit name), after deleting any ``prompt_template`` rows that
would violate it (their version snapshots cascade via the
``prompt_document_versions.document_id`` FK).

Idempotency: the discover-and-drop loop is a no-op when no CHECK exists,
the table-absent case returns early, and the ADD never collides because
every CHECK on ``kind`` was just dropped.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_prompt_docs_02"
down_revision: str = "dry_run_retire_02_drop_bools"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Discover-and-drop every CHECK constraint that references the ``kind``
# column of ``coord.prompt_documents``, whatever its (auto-generated or
# explicit) name. The ``format`` column's CHECK never matches: the
# pg_attribute join filters on ``attname = 'kind'``.
_DROP_KIND_CHECKS = """
DO $$
DECLARE
    c RECORD;
BEGIN
    IF to_regclass('coord.prompt_documents') IS NULL THEN
        RETURN;
    END IF;
    FOR c IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'coord'
          AND rel.relname = 'prompt_documents'
          AND con.contype = 'c'
          AND EXISTS (
              SELECT 1
              FROM unnest(con.conkey) AS k(attnum)
              JOIN pg_attribute att
                ON att.attrelid = con.conrelid
               AND att.attnum = k.attnum
              WHERE att.attname = 'kind'
          )
    LOOP
        EXECUTE format(
            'ALTER TABLE coord.prompt_documents DROP CONSTRAINT %I',
            c.conname
        );
    END LOOP;
END
$$
"""


def upgrade() -> None:
    """Re-add the kind CHECK including ``prompt_template``."""
    op.execute(_DROP_KIND_CHECKS)
    op.execute(
        """
        ALTER TABLE IF EXISTS coord.prompt_documents
            ADD CONSTRAINT ck_prompt_documents_kind
            CHECK (kind IN ('policy', 'response_prompt',
                            'continuation_rules', 'agent_playbook',
                            'prompt_template'))
        """
    )


def downgrade() -> None:
    """Restore the original four-value kind CHECK.

    ``prompt_template`` rows would violate the restored CHECK, so they are
    deleted first; their immutable version snapshots cascade through the
    ``prompt_document_versions.document_id`` ON DELETE CASCADE FK.
    """
    op.execute(_DROP_KIND_CHECKS)
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('coord.prompt_documents') IS NOT NULL THEN
                DELETE FROM coord.prompt_documents
                WHERE kind = 'prompt_template';
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        ALTER TABLE IF EXISTS coord.prompt_documents
            ADD CONSTRAINT ck_prompt_documents_kind
            CHECK (kind IN ('policy', 'response_prompt',
                            'continuation_rules', 'agent_playbook'))
        """
    )
