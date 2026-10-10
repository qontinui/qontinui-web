"""agent.work_artifacts — the specification family: kinds, trace relations, stable refs

Revision ID: plan_library_11_spec_artifacts
Revises: plan_library_10_keyset_walk_indexes
Create Date: 2026-10-10

Phase 6 step 1 of ``2026-10-09-spec-front-end-of-the-software-factory``
(design decision D4: specifications are versioned artifacts in the document
layer, not coord work units and not served prompt documents).

What this revision does
=======================

1. ``ck_work_artifacts_kind`` += six spec kinds: ``request``, ``requirement``,
   ``interface_mapping``, ``story``, ``test_case``, ``doc_correction``.
2. ``ck_work_artifact_edges_relation`` += five trace relations:
   ``derives_from``, ``refines``, ``implements``, ``verifies``,
   ``traces_to``. All five are TWO-ENDED: the
   ``ck_work_artifact_edges_open_target`` guard from ``plan_library_03``
   (``relation = 'spawned_followup' OR to_id IS NOT NULL``) refuses a null
   target for them without a new fence. It is re-added verbatim on both
   sides, because the discover-and-drop loop that removes the vocabulary
   CHECK removes every CHECK mentioning ``relation`` — guards included.
3. ``agent.work_artifacts.spec_ref TEXT NULL`` — the stable, human-readable
   identifier of a spec artifact (``REQ-0042``), with:

   * ``ck_work_artifacts_spec_ref``: a spec kind REQUIRES a ref carrying its
     own prefix (``RQ`` / ``REQ`` / ``IFM`` / ``STY`` / ``TC`` / ``DOC``,
     then ``-`` and at least four digits); every other kind REQUIRES NULL.
     The body is byte-identical to ``app.models.work_artifact.SPEC_REF_CHECK_SQL``
     (``tests/test_plan_library_11_spec_artifacts_migration.py`` holds them
     equal). ``spec_ref IS NOT NULL AND`` is load-bearing — a regex test on
     NULL is NULL, and a CHECK admits NULL.
   * ``uq_work_artifacts_spec_ref``: unique per organization scope (the
     identity index's NULL-collapsing ``coalesce(organization_id, nil)``),
     partial on ``spec_ref IS NOT NULL``.

4. ``agent.work_artifact_spec_ref_counters`` — one row per
   ``(organization_scope, kind)`` holding ``last_number``. The API allocates
   a ref with an atomic ``INSERT … ON CONFLICT DO UPDATE SET last_number =
   last_number + 1 RETURNING last_number`` in the same transaction as the
   artifact insert. The counter never moves backwards, so a number is never
   handed out twice — deleting ``REQ-0042`` does not free 42. A per-tenant
   SEQUENCE was the alternative and was rejected: tenants are created at
   runtime, and DDL per tenant (plus per kind) is a migration-free schema
   change nothing else in this store makes.

Why a column and not a derived value
====================================

A ref derived at read time (a row number over ``created_at``) renumbers when
an earlier row is deleted — the opposite of stable. A ref has to be WRITTEN
once and never recomputed, and it has to be queryable (``?spec_ref=``), so it
is a column.

⚠️ A trap for the NEXT kind widening
====================================

``ck_work_artifacts_spec_ref`` references ``kind``. The discover-and-drop
loop every kind widening copies (``plan_library_04``, and this revision)
drops EVERY CHECK on ``agent.work_artifacts`` that mentions ``kind`` — so a
future widening that copies the loop will silently drop this CHECK as well,
and must re-add it (with its own new spec kinds' arms if it adds any). This
revision's migration test asserts the CHECK exists at ``head``, which is
what catches a widening that forgets.

Status
======

A spec kind's ``status`` is its lifecycle, a closed set per kind
(``app.models.work_artifact.SPEC_KIND_STATUSES``). It is checked by the API,
NOT by a CHECK: ``status`` predates this family and stays opaque free text
for every other kind, and a per-kind CHECK would have to be rewritten on
every lifecycle edit.

Downgrade
=========

Working, and destructive in exactly the ways it cannot avoid: every edge of
the five new relations is DELETED, every spec-kind artifact is DELETED (its
versions and edges cascade through the phase-1 FKs), the ``spec_ref`` column
and the counters table are dropped. The pre-revision vocabularies admit none
of those rows.

Idempotency: CHECKs are discovered-and-dropped from ``pg_constraint`` rather
than dropped by an assumed name; column, index and table statements are
``IF [NOT] EXISTS``. Hand-authored — ``alembic revision --autogenerate`` is
never run here. ``ALTER TABLE`` is spelled without ``IF EXISTS`` for the
``alembic-schema-arg-gate`` pre-commit hook (see ``plan_library_04``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_11_spec_artifacts"
down_revision: str = "plan_library_10_keyset_walk_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Byte-identical to ``plan_library_03``'s ``_TRIM_WS``.
_TRIM_WS = r"E' \t\n\r\f\v'"

_PRIOR_KINDS = (
    "investigation_prompt",
    "plan_authoring_prompt",
    "implementation_prompt",
    "investigation_report",
    "handoff",
    "plan",
    "diagnostic",
)

_SPEC_KINDS = (
    "request",
    "requirement",
    "interface_mapping",
    "story",
    "test_case",
    "doc_correction",
)

_PRIOR_RELATIONS = (
    "produced_report",
    "feeds",
    "authored_plan",
    "supersedes",
    "depends_on",
    "spawned_followup",
    "refutes",
)

_TRACE_RELATIONS = (
    "derives_from",
    "refines",
    "implements",
    "verifies",
    "traces_to",
)

#: Byte-identical to ``app.models.work_artifact.SPEC_REF_CHECK_SQL`` — spelled
#: out rather than imported, because a migration must keep meaning what it
#: meant when it ran even after the model moves on. The test pins the two.
_SPEC_REF_CHECK = (
    "CASE kind "
    "WHEN 'request' THEN spec_ref IS NOT NULL AND spec_ref ~ '^RQ-[0-9]{4,}$' "
    "WHEN 'requirement' THEN spec_ref IS NOT NULL AND spec_ref ~ '^REQ-[0-9]{4,}$' "
    "WHEN 'interface_mapping' THEN spec_ref IS NOT NULL AND spec_ref ~ '^IFM-[0-9]{4,}$' "
    "WHEN 'story' THEN spec_ref IS NOT NULL AND spec_ref ~ '^STY-[0-9]{4,}$' "
    "WHEN 'test_case' THEN spec_ref IS NOT NULL AND spec_ref ~ '^TC-[0-9]{4,}$' "
    "WHEN 'doc_correction' THEN spec_ref IS NOT NULL AND spec_ref ~ '^DOC-[0-9]{4,}$' "
    "ELSE spec_ref IS NULL END"
)

_NIL_ORG = "00000000-0000-0000-0000-000000000000"


def _drop_checks_sql(table: str, column: str) -> str:
    """Discover-and-drop every CHECK on ``agent.<table>`` mentioning ``column``.

    The same loop ``plan_library_03``/``_04`` run, parameterised by table and
    column instead of copied twice.
    """
    return f"""
DO $$
DECLARE
    c RECORD;
BEGIN
    IF to_regclass('agent.{table}') IS NULL THEN
        RETURN;
    END IF;
    FOR c IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'agent'
          AND rel.relname = '{table}'
          AND con.contype = 'c'
          AND EXISTS (
              SELECT 1
              FROM unnest(con.conkey) AS k(attnum)
              JOIN pg_attribute att
                ON att.attrelid = con.conrelid
               AND att.attnum = k.attnum
              WHERE att.attname = '{column}'
          )
    LOOP
        EXECUTE format(
            'ALTER TABLE agent.{table} DROP CONSTRAINT %I',
            c.conname
        );
    END LOOP;
END
$$
"""


def _in_list(values: Sequence[str]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def _add_kind_check(kinds: Sequence[str]) -> None:
    op.execute(
        f"""
        ALTER TABLE agent.work_artifacts
            ADD CONSTRAINT ck_work_artifacts_kind
            CHECK (kind IN ({_in_list(kinds)}))
        """
    )


def _add_relation_checks(relations: Sequence[str]) -> None:
    """The relation vocabulary plus ``plan_library_03``'s two fences."""
    op.execute(
        f"""
        ALTER TABLE agent.work_artifact_edges
            ADD CONSTRAINT ck_work_artifact_edges_relation
            CHECK (relation IN ({_in_list(relations)}))
        """
    )
    # Guard 1 — a null target is legal for ``spawned_followup`` ONLY. Every
    # trace relation is therefore two-ended.
    op.execute(
        """
        ALTER TABLE agent.work_artifact_edges
            ADD CONSTRAINT ck_work_artifact_edges_open_target
            CHECK (relation = 'spawned_followup' OR to_id IS NOT NULL)
        """
    )
    # Guard 2 — for an unowned follow-up the note IS the payload.
    op.execute(
        f"""
        ALTER TABLE agent.work_artifact_edges
            ADD CONSTRAINT ck_work_artifact_edges_followup_note
            CHECK (
                relation <> 'spawned_followup'
                OR (note IS NOT NULL AND btrim(note, {_TRIM_WS}) <> '')
            )
        """
    )


def upgrade() -> None:
    """Admit the spec kinds and trace relations; add stable spec refs."""
    # ── 1. The ref column, before any CHECK names it ────────────────────
    op.execute(
        """
        ALTER TABLE agent.work_artifacts
            ADD COLUMN IF NOT EXISTS spec_ref TEXT
        """
    )

    # ── 2. The kind vocabulary, and the ref's kind-keyed shape ──────────
    # The loop drops ``ck_work_artifacts_kind`` and, on a re-run, the
    # ``ck_work_artifacts_spec_ref`` this revision adds — both mention kind.
    op.execute(_drop_checks_sql("work_artifacts", "kind"))
    _add_kind_check(_PRIOR_KINDS + _SPEC_KINDS)
    op.execute(
        f"""
        ALTER TABLE agent.work_artifacts
            ADD CONSTRAINT ck_work_artifacts_spec_ref
            CHECK ({_SPEC_REF_CHECK})
        """
    )

    op.execute(
        f"""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifacts_spec_ref
            ON agent.work_artifacts (
                coalesce(organization_id, '{_NIL_ORG}'::uuid),
                spec_ref
            )
            WHERE spec_ref IS NOT NULL
        """
    )

    # ── 3. The relation vocabulary ──────────────────────────────────────
    op.execute(_drop_checks_sql("work_artifact_edges", "relation"))
    _add_relation_checks(_PRIOR_RELATIONS + _TRACE_RELATIONS)

    # ── 4. The never-reused counter ─────────────────────────────────────
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent.work_artifact_spec_ref_counters (
            organization_scope UUID NOT NULL,
            kind TEXT NOT NULL,
            last_number INTEGER NOT NULL,
            CONSTRAINT pk_work_artifact_spec_ref_counters
                PRIMARY KEY (organization_scope, kind),
            CONSTRAINT ck_spec_ref_counters_positive
                CHECK (last_number >= 1)
        )
        """
    )


def downgrade() -> None:
    """Restore the seven-kind and seven-relation vocabularies."""
    op.execute("DROP TABLE IF EXISTS agent.work_artifact_spec_ref_counters")

    # Relations first: deleting the spec artifacts below would cascade most
    # of these edges anyway, but a trace edge between two NON-spec artifacts
    # (a plan ``implements`` a plan) has no pre-revision shape either.
    op.execute(_drop_checks_sql("work_artifact_edges", "relation"))
    op.execute(
        f"""
        DELETE FROM agent.work_artifact_edges
         WHERE relation IN ({_in_list(_TRACE_RELATIONS)})
        """
    )
    _add_relation_checks(_PRIOR_RELATIONS)

    # Drops ``ck_work_artifacts_kind`` AND ``ck_work_artifacts_spec_ref``.
    op.execute(_drop_checks_sql("work_artifacts", "kind"))
    op.execute(
        f"""
        DELETE FROM agent.work_artifacts
         WHERE kind IN ({_in_list(_SPEC_KINDS)})
        """
    )
    _add_kind_check(_PRIOR_KINDS)

    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifacts_spec_ref")
    op.execute(
        """
        ALTER TABLE agent.work_artifacts
            DROP COLUMN IF EXISTS spec_ref
        """
    )
