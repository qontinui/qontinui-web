"""coord prompt_documents — allow kind='claude_settings'

Revision ID: coord_prompt_docs_04_claude_settings_kind
Revises: coord_claude_acct_usage_02
Create Date: 2026-08-25

Phase 2 of the canonical-Claude-settings plan
(``2026-08-21-canonical-claude-settings-served-document``): widen the
``kind`` CHECK on ``coord.prompt_documents`` to admit a seventh content
family, ``claude_settings`` — the fleet's shared Claude Code settings
*baseline*. Today that content travels by git clone
(``qontinui-claude-config/.claude/settings.json``), which means a tenant
without that repo gets no allowlist, no deny rules and no guard hooks at
all. Moving it into the shipped versioned document store makes it
readable, editable, diffable and restorable by a tenant admin, and
reachable by any tenant over the agent read door. Only the CHECK stands
in the way.

Ordering is load-bearing (served policy ``production-and-cost``
``alembic-sole-authorship``): this revision must be applied in production
**before** a coord build that seeds the new kind goes live, or seeding
raises 23514 against the narrower CHECK. Coord's seed path tolerates that
23514 only for a constraint whose name contains ``kind`` (its
``is_kind_constraint`` predicate), and only for the kinds it has been
taught about — so a wrong-order deploy degrades to an unseeded row rather
than halting seeding tenant-wide, but the right order is still this one.

Exactly one column, exactly one constraint
==========================================

The ``format`` column carries its own CHECK (``format IN ('markdown',
'rubric')``, from ``coord_prompt_docs_01``) and this revision deliberately
does **not** touch it. The ``claude_settings`` seed is authored with
``format: "markdown"`` — content type for this store is enforced on
**kind**, by coord's ``validate_body_for_kind``, not by ``format`` — so no
format widening is needed. Adding one would create a *second* cross-repo
deploy-order dependency, and unlike the ``kind`` CHECK it would be
undefended: coord's seed-time 23514 tolerance is scoped to a constraint
whose name contains ``kind``, so a ``format`` violation falls through to
the bail-out arm and halts seeding for the whole tenant. The
discover-and-drop loop below preserves that property structurally — its
``pg_attribute`` join filters on ``attname = 'kind'``, so the ``format``
CHECK can never match it.

Constraint-name strategy
========================

``coord_prompt_docs_01`` declared the CHECK inline on the ``kind`` column,
so PostgreSQL auto-named it (conventionally
``prompt_documents_kind_check``, but the name is an implementation detail
and must not be assumed); ``coord_prompt_docs_02`` re-added it under the
explicit name ``ck_prompt_documents_kind``, and ``coord_prompt_docs_03``
did the same when it added ``session_briefing``. Either name may be in
force depending on how far a given database has been migrated, so this
migration reuses that strategy verbatim: discover every CHECK constraint
attached to the ``kind`` column via ``pg_constraint`` and drop each by its
discovered name, then re-add the widened CHECK under the explicit, stable
name ``ck_prompt_documents_kind``. Downgrade restores the six-value CHECK
the same defensive way (discover-and-drop, then add by explicit name),
after deleting any ``claude_settings`` rows that would violate it (their
immutable version snapshots cascade via the
``prompt_document_versions.document_id`` ON DELETE CASCADE FK).

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
revision: str = "coord_prompt_docs_04_claude_settings_kind"
down_revision: str = "coord_claude_acct_usage_02"
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
    """Re-add the kind CHECK including ``claude_settings``."""
    op.execute(_DROP_KIND_CHECKS)
    op.execute(
        """
        ALTER TABLE IF EXISTS coord.prompt_documents
            ADD CONSTRAINT ck_prompt_documents_kind
            CHECK (kind IN ('policy', 'response_prompt',
                            'continuation_rules', 'agent_playbook',
                            'prompt_template', 'session_briefing',
                            'claude_settings'))
        """
    )


def downgrade() -> None:
    """Restore the six-value kind CHECK.

    ``claude_settings`` rows would violate the restored CHECK, so they are
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
                WHERE kind = 'claude_settings';
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
                            'prompt_template', 'session_briefing'))
        """
    )
