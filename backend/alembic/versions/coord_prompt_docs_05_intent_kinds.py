"""coord prompt_documents — allow the six project-intent kinds

Revision ID: coord_prompt_docs_05_intent_kinds
Revises: coord_prompt_docs_04_claude_settings_kind
Create Date: 2026-08-25

Phase 1 of the project-intent-documents plan
(``2026-08-21-project-intent-documents-and-the-selection-loop``): widen the
``kind`` CHECK on ``coord.prompt_documents`` to admit six more content
families — ``product_intent``, ``initiative``, ``success_metric``,
``domain_spec``, ``audience_profile`` and ``decision_record``.

Why these six, and why one revision
===================================

Every kind the store serves today is **normative** — it tells a session
*how to act*. Not one of them says *what we are building, for whom, and
what "better" means*, so a session asked to choose its own next piece of
work has a complete rulebook for conduct and no statement of intent to
rank against. These six are organized by what a reader DOES with the
document (justify/tiebreak, rank near-term, measure, diff, justify for
whom, refuse), and the subject is the **tenant's own product**, not
qontinui.

**One revision for all six**, not six revisions: the CHECK is rewritten
wholesale either way, and six sequential rewrites of one constraint is
pure migration-graph noise.

Ordering is load-bearing (served policy ``production-and-cost``
``alembic-sole-authorship``): this revision must be applied in production
**before** a coord build that seeds the new kinds goes live, or seeding
raises 23514 against the narrower CHECK. Coord's seed path tolerates that
23514 only for a constraint whose name contains ``kind``, and only for the
kinds it has been taught about — so a wrong-order deploy degrades to
unseeded rows rather than halting seeding tenant-wide, but the right order
is still this one. Hand-authored; never ``alembic revision
--autogenerate``.

Thirteen up, SEVEN down — the downgrade is not the original six
===============================================================

This revision stacks on ``coord_prompt_docs_04_claude_settings_kind``,
which added a seventh kind, ``claude_settings``. The upgrade CHECK
therefore carries **thirteen** values (the original six + ``claude_settings``
+ these six) and the downgrade restores **seven**, not six. Restoring six
would silently drop every ``claude_settings`` row on a ``downgrade -1`` —
the fleet's Claude Code settings baseline — which is exactly the kind of
collateral a reversal gate is supposed to catch and a hand-authored
downgrade is supposed to avoid.

Exactly one column, exactly one constraint
==========================================

The ``format`` column carries its own CHECK (``format IN ('markdown',
'rubric')``, from ``coord_prompt_docs_01``) and this revision deliberately
does **not** touch it. The intent kinds want structured fields
(``success_metric`` wants metric/source/baseline/target/direction;
``initiative`` wants the new-work bar as a number) and they carry them as
**YAML frontmatter inside a ``markdown`` body** — the precedent
``prompt_template`` already set — so no format widening is needed. Adding
one would create a *second* cross-repo deploy-order dependency, and unlike
the ``kind`` CHECK it would be undefended: coord's seed-time 23514
tolerance is scoped to a constraint whose name contains ``kind``, so a
``format`` violation falls through to the bail-out arm and halts seeding
for the whole tenant. The discover-and-drop loop below preserves that
property structurally — its ``pg_attribute`` join filters on
``attname = 'kind'``, so the ``format`` CHECK can never match it.

Constraint-name strategy
========================

``coord_prompt_docs_01`` declared the CHECK inline on the ``kind`` column,
so PostgreSQL auto-named it (conventionally
``prompt_documents_kind_check``, but the name is an implementation detail
and must not be assumed); ``coord_prompt_docs_02`` re-added it under the
explicit name ``ck_prompt_documents_kind``, and ``_03`` and ``_04`` did the
same when they added ``session_briefing`` and ``claude_settings``. Any of
those names may be in force depending on how far a given database has been
migrated, so this migration reuses that strategy verbatim: discover every
CHECK constraint attached to the ``kind`` column via ``pg_constraint`` and
drop each by its discovered name, then re-add the widened CHECK under the
explicit, stable name ``ck_prompt_documents_kind``. Downgrade restores the
seven-value CHECK the same defensive way (discover-and-drop, then add by
explicit name), after deleting any rows of the six new kinds that would
violate it (their immutable version snapshots cascade via the
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
revision: str = "coord_prompt_docs_05_intent_kinds"
down_revision: str = "coord_prompt_docs_04_claude_settings_kind"
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

# The six kinds this revision adds. Named once so the downgrade's DELETE and
# the upgrade's CHECK cannot drift apart.
_INTENT_KINDS = (
    "product_intent",
    "initiative",
    "success_metric",
    "domain_spec",
    "audience_profile",
    "decision_record",
)


def upgrade() -> None:
    """Re-add the kind CHECK including the six project-intent kinds."""
    op.execute(_DROP_KIND_CHECKS)
    op.execute(
        """
        ALTER TABLE IF EXISTS coord.prompt_documents
            ADD CONSTRAINT ck_prompt_documents_kind
            CHECK (kind IN ('policy', 'response_prompt',
                            'continuation_rules', 'agent_playbook',
                            'prompt_template', 'session_briefing',
                            'claude_settings',
                            'product_intent', 'initiative',
                            'success_metric', 'domain_spec',
                            'audience_profile', 'decision_record'))
        """
    )


def downgrade() -> None:
    """Restore the SEVEN-value kind CHECK — the six originals + claude_settings.

    Rows of the six new kinds would violate the restored CHECK, so they are
    deleted first; their immutable version snapshots cascade through the
    ``prompt_document_versions.document_id`` ON DELETE CASCADE FK.

    ``claude_settings`` is deliberately NOT deleted and stays in the restored
    CHECK: it was added by ``coord_prompt_docs_04``, one revision below this
    one, so a ``downgrade -1`` that dropped it would destroy rows this
    revision never created.
    """
    op.execute(_DROP_KIND_CHECKS)
    op.execute(
        f"""
        DO $$
        BEGIN
            IF to_regclass('coord.prompt_documents') IS NOT NULL THEN
                DELETE FROM coord.prompt_documents
                WHERE kind IN ({", ".join(f"'{k}'" for k in _INTENT_KINDS)});
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
                            'prompt_template', 'session_briefing',
                            'claude_settings'))
        """
    )
