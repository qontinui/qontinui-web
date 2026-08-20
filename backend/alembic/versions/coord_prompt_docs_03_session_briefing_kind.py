"""coord prompt_documents — allow kind='session_briefing'

Revision ID: coord_prompt_docs_03_session_briefing_kind
Revises: coord_workunits_05_status_history_lookup
Create Date: 2026-08-20

Phase 1 of the runner-session-briefing plan
(``2026-08-20-runner-session-briefing-versioned-and-operator-editable``):
widen the ``kind`` CHECK on ``coord.prompt_documents`` to admit a sixth
content family, ``session_briefing`` — the briefing text the runner appends
to the system prompt of every session it hosts. Today that text is a Rust
string literal compiled into the runner binary; moving it into the shipped
versioned document store makes it readable, editable, diffable and
restorable by a tenant admin. Only the CHECK stands in the way.

Ordering is load-bearing (served policy ``production-and-cost``
``alembic-sole-authorship``): this revision must be applied in production
**before** a coord build that seeds the new kind goes live, or seeding
raises 23514 against the narrower CHECK.

Constraint-name strategy
========================

``coord_prompt_docs_01`` declared the CHECK inline on the ``kind`` column,
so PostgreSQL auto-named it (conventionally
``prompt_documents_kind_check``, but the name is an implementation detail
and must not be assumed), and ``coord_prompt_docs_02`` re-added it under
the explicit name ``ck_prompt_documents_kind``. Either name may be in
force depending on how far a given database has been migrated, so this
migration reuses ``coord_prompt_docs_02``'s strategy verbatim: discover
every CHECK constraint attached to the ``kind`` column via
``pg_constraint`` and drop each by its discovered name, then re-add the
widened CHECK under the explicit, stable name ``ck_prompt_documents_kind``.
Downgrade restores the five-value CHECK the same defensive way
(discover-and-drop, then add by explicit name), after deleting any
``session_briefing`` rows that would violate it (their immutable version
snapshots cascade via the ``prompt_document_versions.document_id``
ON DELETE CASCADE FK).

The downgrade is not decorative: ``migration-reversal.yml`` ("Migration
Reversal Gate") detects added revisions and executes upgrade →
``downgrade -1`` → upgrade against a real PostgreSQL.

Idempotency: the discover-and-drop loop is a no-op when no CHECK exists,
the table-absent case returns early, and the ADD never collides because
every CHECK on ``kind`` was just dropped.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_prompt_docs_03_session_briefing_kind"
down_revision: str = "coord_workunits_05_status_history_lookup"
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
    """Re-add the kind CHECK including ``session_briefing``."""
    op.execute(_DROP_KIND_CHECKS)
    op.execute(
        """
        ALTER TABLE IF EXISTS coord.prompt_documents
            ADD CONSTRAINT ck_prompt_documents_kind
            CHECK (kind IN ('policy', 'response_prompt',
                            'continuation_rules', 'agent_playbook',
                            'prompt_template', 'session_briefing'))
        """
    )


def downgrade() -> None:
    """Restore the five-value kind CHECK.

    ``session_briefing`` rows would violate the restored CHECK, so they are
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
                WHERE kind = 'session_briefing';
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
                            'continuation_rules', 'agent_playbook',
                            'prompt_template'))
        """
    )
