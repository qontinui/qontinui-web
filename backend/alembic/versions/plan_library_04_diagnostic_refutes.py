"""agent.work_artifacts — ``diagnostic`` kind, ``refutes`` edge, ``intent_refs``

Revision ID: plan_library_04_diagnostic_refutes
Revises: prcheckruns_base_sha_01
Create Date: 2026-09-06

PR A of ``2026-09-06-work-artifacts-kinds-and-edges-cannot-express-a-refutation``.

The gap
=======

Two artifact classes the fleet produces continuously have no representation
in the library — a class with no kind produces no rows and therefore no
signal, which is indistinguishable from a class nobody encountered:

* a **diagnostic** — an operator question answered by live measurement,
  whose conclusion is typically *"the obvious action is inert, and here is
  the mechanism"*. ``investigation_report`` is the closest kind and is
  already ``/chart``'s; reusing it would make the diagnostic family and the
  gap-verdict family indistinguishable on the only structured filter the
  API offers.
* a **refutation** — *"this measurement falsifies that standing claim."*
  ``supersedes`` is the closest relation and means *a newer version of the
  same thing*, not *a measurement that falsifies a claim*; a refutation
  written as ``supersedes`` is unreadable as one.

Both CHECKs are closed vocabularies with no slot for either, and
``plan_library_01`` named them (``ck_work_artifacts_kind`` /
``ck_work_artifact_edges_relation``) precisely so a widening could drop and
re-add them. This is that widening.

What this revision does
=======================

1. ``ck_work_artifacts_kind`` += ``diagnostic``.
2. ``ck_work_artifact_edges_relation`` += ``refutes``. Two-ended: the
   ``ck_work_artifact_edges_open_target`` guard from ``plan_library_03``
   (``relation = 'spawned_followup' OR to_id IS NOT NULL``) already refuses a
   null target for every relation but ``spawned_followup``, so ``refutes``
   inherits the fence without a new one. It is re-added verbatim below
   because the discover-and-drop loop (which is what makes a re-run safe)
   removes every CHECK that mentions ``relation``, guards included.
3. ``agent.work_artifacts.intent_refs TEXT[] NOT NULL DEFAULT '{}'``, GIN
   indexed as ``ix_work_artifacts_intent_refs`` — spelled exactly like
   ``ix_work_artifacts_repos`` — the citation to the served coord Intent a
   diagnostic bears on (``success_metric/<name>``, ``domain_spec/<name>``).

``intent_refs`` is a column, not an edge, and that is forced by the schema
boundary: ``work_artifact_edges`` is artifact→artifact inside qontinui-web's
``agent`` schema, while ``success_metric`` / ``domain_spec`` are coord
``prompt_documents`` in a different deployment. A cross-deployment FK would
re-couple exactly what the web↔coord decoupling separated, so this is an
indexed ``TEXT[]`` that is ALLOWED TO DANGLE — the same discipline
``work_unit_slug`` already carries. ``TEXT[]`` rather than JSONB because the
query it exists to serve — *"which diagnostics bear on
``success_metric/development-speed``?"* — is a containment test
(``intent_refs @> ARRAY[...]``) a GIN index answers directly; JSONB would
serve it too and model nothing extra.

Retro-labelling
===============

``kind`` is part of ``uq_work_artifacts_identity``, so an existing row
relabelled ``diagnostic`` MUST be written through a path that sets
``kind_locked`` — otherwise the next runner scan re-derives the heuristic
kind, misses the corrected identity, and **forks the document into a second
row**: the exact failure ``plan_library_02_kind_lock`` was written to close.
The non-heuristic door is ``patch_work_artifact_kind`` in
``backend/app/api/v1/endpoints/plan_library.py`` (``PATCH
/plan-library/{id}/kind``), which sets the lock unconditionally. A direct
``UPDATE agent.work_artifacts SET kind = 'diagnostic'`` without
``kind_locked = true`` is the trap. This revision relabels nothing itself.

Downgrade
=========

Working, and destructive in exactly two respects it cannot avoid: every
``refutes`` edge is DELETED, and every ``diagnostic`` artifact is DELETED
(its versions and edges cascade through the phase-1 FKs). The pre-revision
vocabularies admit neither value, so there is no shape those rows could be
rewritten into — the same disposition ``plan_library_03`` takes for
``spawned_followup``. The ``intent_refs`` column and its index are dropped;
the citations go with them.

Idempotency: both CHECK families are discovered-and-dropped from
``pg_constraint`` rather than dropped by an assumed name, the column and
index statements are ``IF [NOT] EXISTS``, so each direction re-runs cleanly
and upgrade → downgrade → upgrade round-trips. Hand-authored —
``alembic revision --autogenerate`` is never run here.

The ``ALTER TABLE`` statements are spelled without ``IF EXISTS``: the
``alembic-schema-arg-gate`` pre-commit hook parses the token after
``ALTER TABLE`` as the target and reads ``IF`` as an unqualified identifier.
Both tables are created by ``plan_library_01_work_artifacts``, an ancestor
of this revision, so their absence is not a state this migration can
meaningfully tolerate.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_04_diagnostic_refutes"
down_revision: str = "prcheckruns_base_sha_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Byte-identical to ``plan_library_03``'s ``_TRIM_WS`` — the blank-note guard
#: is re-added verbatim below and must keep the same character set as the
#: partial unique index it pairs with.
_TRIM_WS = r"E' \t\n\r\f\v'"


# Discover-and-drop EVERY check constraint that references the ``kind``
# column of ``agent.work_artifacts``, whatever its name.
#
# ``plan_library_01`` declared it inline under an explicit name, but the name
# is an implementation detail that must not be assumed. On ``origin/main`` the
# only CHECK mentioning ``kind`` IS ``ck_work_artifacts_kind`` (the other,
# ``ck_work_artifacts_captured_by``, references ``captured_by`` only), so this
# loop drops exactly one constraint and nothing has to be re-added besides the
# widened one.
_DROP_KIND_CHECKS = """
DO $$
DECLARE
    c RECORD;
BEGIN
    IF to_regclass('agent.work_artifacts') IS NULL THEN
        RETURN;
    END IF;
    FOR c IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'agent'
          AND rel.relname = 'work_artifacts'
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
            'ALTER TABLE agent.work_artifacts DROP CONSTRAINT %I',
            c.conname
        );
    END LOOP;
END
$$
"""


# Discover-and-drop EVERY check constraint that references the ``relation``
# column of ``agent.work_artifact_edges`` — the same loop ``plan_library_03``
# runs. It catches the vocabulary CHECK AND both guards that revision added
# (``ck_work_artifact_edges_open_target``, ``ck_work_artifact_edges_followup_note``
# — both mention ``relation``), which is why both guards are re-added verbatim
# on each side below.
_DROP_RELATION_CHECKS = """
DO $$
DECLARE
    c RECORD;
BEGIN
    IF to_regclass('agent.work_artifact_edges') IS NULL THEN
        RETURN;
    END IF;
    FOR c IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'agent'
          AND rel.relname = 'work_artifact_edges'
          AND con.contype = 'c'
          AND EXISTS (
              SELECT 1
              FROM unnest(con.conkey) AS k(attnum)
              JOIN pg_attribute att
                ON att.attrelid = con.conrelid
               AND att.attnum = k.attnum
              WHERE att.attname = 'relation'
          )
    LOOP
        EXECUTE format(
            'ALTER TABLE agent.work_artifact_edges DROP CONSTRAINT %I',
            c.conname
        );
    END LOOP;
END
$$
"""


def _add_relation_guards() -> None:
    """Re-add ``plan_library_03``'s two fences, byte-for-byte.

    Called on BOTH sides: the discover-and-drop loop removes them along with
    the vocabulary CHECK, and neither direction of this revision changes what
    they guard. ``refutes`` is two-ended and gets its target requirement from
    the first of these.
    """
    # Guard 1 — a null target is legal for ``spawned_followup`` ONLY.
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
    """Admit ``diagnostic`` and ``refutes``; add the ``intent_refs`` column."""
    # ── 1. The kind vocabulary ──────────────────────────────────────────
    op.execute(_DROP_KIND_CHECKS)

    op.execute(
        """
        ALTER TABLE agent.work_artifacts
            ADD CONSTRAINT ck_work_artifacts_kind
            CHECK (
                kind IN (
                    'investigation_prompt',
                    'plan_authoring_prompt',
                    'implementation_prompt',
                    'investigation_report',
                    'handoff',
                    'plan',
                    'diagnostic'
                )
            )
        """
    )

    # ── 2. The relation vocabulary ──────────────────────────────────────
    op.execute(_DROP_RELATION_CHECKS)

    op.execute(
        """
        ALTER TABLE agent.work_artifact_edges
            ADD CONSTRAINT ck_work_artifact_edges_relation
            CHECK (
                relation IN (
                    'produced_report',
                    'feeds',
                    'authored_plan',
                    'supersedes',
                    'depends_on',
                    'spawned_followup',
                    'refutes'
                )
            )
        """
    )

    _add_relation_guards()

    # ── 3. The Intent citation ──────────────────────────────────────────
    op.execute(
        """
        ALTER TABLE agent.work_artifacts
            ADD COLUMN IF NOT EXISTS intent_refs TEXT[] NOT NULL DEFAULT '{}'
        """
    )

    # Serves `?intent_ref=` — array containment, exactly as
    # ``ix_work_artifacts_repos`` serves `?repo=`.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_work_artifacts_intent_refs
            ON agent.work_artifacts USING GIN (intent_refs)
        """
    )


def downgrade() -> None:
    """Restore the six-kind and six-relation vocabularies; drop the column."""
    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifacts_intent_refs")

    op.execute(
        """
        ALTER TABLE agent.work_artifacts
            DROP COLUMN IF EXISTS intent_refs
        """
    )

    # Drops the widened relation CHECK *and* both guards in one pass — all
    # three reference ``relation``.
    op.execute(_DROP_RELATION_CHECKS)

    # Unavoidably destructive: the pre-revision vocabulary has no shape a
    # ``refutes`` edge could be rewritten into. Stated in the docstring.
    op.execute(
        """
        DELETE FROM agent.work_artifact_edges
         WHERE relation = 'refutes'
        """
    )

    op.execute(
        """
        ALTER TABLE agent.work_artifact_edges
            ADD CONSTRAINT ck_work_artifact_edges_relation
            CHECK (
                relation IN (
                    'produced_report',
                    'feeds',
                    'authored_plan',
                    'supersedes',
                    'depends_on',
                    'spawned_followup'
                )
            )
        """
    )

    _add_relation_guards()

    op.execute(_DROP_KIND_CHECKS)

    # Likewise destructive: a ``diagnostic`` row has no pre-revision kind to
    # become. Its versions and edges cascade through the phase-1 FKs.
    op.execute(
        """
        DELETE FROM agent.work_artifacts
         WHERE kind = 'diagnostic'
        """
    )

    op.execute(
        """
        ALTER TABLE agent.work_artifacts
            ADD CONSTRAINT ck_work_artifacts_kind
            CHECK (
                kind IN (
                    'investigation_prompt',
                    'plan_authoring_prompt',
                    'implementation_prompt',
                    'investigation_report',
                    'handoff',
                    'plan'
                )
            )
        """
    )
