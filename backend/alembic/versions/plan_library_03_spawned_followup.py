"""agent.work_artifact_edges — ``spawned_followup``, the ONE-ENDED edge

Revision ID: plan_library_03_spawned_followup
Revises: runprov_01_worktree_census_build_target
Create Date: 2026-08-16

Phase 7 of ``2026-08-16-plan-corpus-authority-and-run-provenance``: make an
identified-but-unowned follow-up a queryable row.

The gap
=======

A plan routinely surfaces work it deliberately does NOT do — "worth its own
plan", "out of scope, needs its own investigation". Today that survives only as
prose in the plan body, so it is unrecoverable from the data. Three structural
reasons, all of them here in the schema:

1. **No relation expresses it.** The shipped vocabulary is ``produced_report``,
   ``feeds``, ``authored_plan``, ``supersedes``, ``depends_on``. ``depends_on``
   is the near miss and it points the WRONG WAY — it says "I need that first",
   not "I surfaced that".
2. **An edge needs two endpoints.** ``from_id`` and ``to_id`` are both
   ``NOT NULL``, and an unwritten follow-up has no artifact to point at. The
   thing is structurally inexpressible, not merely unrecorded.
3. **Nothing can answer "show me follow-ups with no owning plan".**

What this revision does
=======================

* widens ``ck_work_artifact_edges_relation`` to admit ``spawned_followup``;
* makes ``to_id`` **nullable**, so the edge can dangle at the far end until
  someone writes the plan that owns it;
* guards that relaxation with two CHECKs (below);
* adds a partial unique index that makes a re-post of the SAME note idempotent
  without constraining two DIFFERENT follow-ups off one plan.

Why the relaxation MUST be guarded
==================================

Dropping ``NOT NULL`` on ``to_id`` is the highest-risk change in the phase.
Four shipped relations depend on the target being present, and
``GET /plan-library/candidates`` walks ``depends_on`` (joining
``work_artifacts.id = edges.to_id``) to compute each plan's UNMET dependencies.
A ``depends_on`` row with a null target would silently drop out of that join —
the plan would read as unblocked when it is not. So the column loses its blanket
``NOT NULL`` and immediately regains it as a conditional one::

    ck_work_artifact_edges_open_target
        relation = 'spawned_followup' OR to_id IS NOT NULL

For every relation except the new one, nothing changed: a null target is still
rejected by the database. (The API rejects it first, with a 422 that names the
relation — the CHECK is the backstop, not the user-facing error.)

The note is the payload, so the note is required
------------------------------------------------

::

    ck_work_artifact_edges_followup_note
        relation <> 'spawned_followup'
        OR (note IS NOT NULL AND btrim(note, E' \\t\\n\\r\\f\\v') <> '')

The whitespace set is spelled out because one-argument ``btrim`` strips SPACES
ONLY — ``btrim(E'\\n\\t ')`` is ``E'\\n\\t'``, not the empty string, so the
obvious spelling of this CHECK admits a tab-and-newline note. That is not a
hypothetical: the first draft of this revision shipped it and the round-trip
test caught it.

For a normal edge the note is optional colour on top of a link that already
carries meaning. For an unowned follow-up there IS no far end — the note is the
entire content of the row. A ``spawned_followup`` with an empty note records
that a plan surfaced *something*, which is worse than not recording it: it
occupies the open-follow-ups queue forever with nothing anyone can act on.

The duplicate guard — and why it is scoped so narrowly
======================================================

``uq_work_artifact_edges_from_to_relation`` is ``UNIQUE (from_id, to_id,
relation)`` and it does NOT constrain these rows at all: in SQL two NULLs are
distinct, so every open follow-up is unique to that index no matter what. Two
follow-ups from one plan therefore both insert — which is **correct and
wanted**. A plan that surfaces three separate pieces of out-of-scope work must
be able to say so three times.

What is NOT wanted is an unbounded duplicate of the *same* note. The corpus is
fed by repeatable scans and by agents that re-post; without a guard, N re-posts
of one identical follow-up become N rows in the operator's queue. So::

    CREATE UNIQUE INDEX uq_work_artifact_edges_open_followup
        ON agent.work_artifact_edges (
            from_id, relation, btrim(note, E' \\t\\n\\r\\f\\v')
        )
        WHERE to_id IS NULL AND relation = 'spawned_followup'

Keyed on ``(from_id, relation, note)`` — the note is what distinguishes two
follow-ups, so it belongs in the key — and PARTIAL, restricted to the
null-target case, so it can never touch the four shipped relations. The trim
folds surrounding-whitespace variants, which are re-posts rather than new
findings, and uses the same explicit character set as the CHECK above.
The CRUD layer reads this index's grain directly: an open-follow-up insert whose
``(from_id, relation, btrim(note))`` already exists returns the existing row,
matching the idempotency ``create_edge`` already gives two-ended edges.

Downgrade
=========

Working, and destructive in exactly one respect it cannot avoid: every
``spawned_followup`` row is DELETED first. The pre-revision CHECK does not admit
the relation at all (never mind the ``NOT NULL``), so there is no shape those
rows could be rewritten into. Down-migrating this revision discards the open
follow-ups; that is inherent to removing the vocabulary that holds them.

Idempotency: the relation CHECKs are discovered-and-dropped from
``pg_constraint`` (the same defensive pattern
``coord_prompt_docs_02_prompt_template_kind`` uses) rather than dropped by an
assumed name, both index statements are ``IF [NOT] EXISTS``, and both
``ALTER COLUMN … [DROP|SET] NOT NULL`` forms are no-ops when already applied —
so each direction re-runs cleanly and upgrade → downgrade → upgrade
round-trips. Hand-authored — ``alembic revision --autogenerate`` is never run
here.

The ``ALTER TABLE`` statements are spelled without ``IF EXISTS``: the
``alembic-schema-arg-gate`` pre-commit hook parses the token after
``ALTER TABLE`` as the target and reads ``IF`` as an unqualified identifier.
Nothing is lost — ``agent.work_artifact_edges`` is created by
``plan_library_01_work_artifacts``, an ancestor of this revision, so its
absence is not a state this migration can meaningfully tolerate.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_03_spawned_followup"
down_revision: str = "runprov_01_worktree_census_build_target"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The trim used by BOTH the blank-note CHECK and the duplicate-guard index,
#: spelled once so the two can never drift.
#:
#: ⚠️ The character set is EXPLICIT for a reason: one-argument ``btrim`` strips
#: **spaces only**. A note of ``"\n\t "`` survives ``btrim(note) <> ''``
#: untouched, so the obvious spelling of "the note must not be blank" lets a
#: tab-and-newline note straight through — measured, not theorised (the first
#: draft of this revision did exactly that and the round-trip test caught it).
#: The set matches what Python's ``str.strip()`` removes for ASCII, which is
#: what the API-side check uses.
_TRIM_WS = r"E' \t\n\r\f\v'"


# Discover-and-drop EVERY check constraint that references the ``relation``
# column of ``agent.work_artifact_edges``, whatever its name.
#
# ``plan_library_01`` declared its CHECK inline with an explicit name, but the
# name is an implementation detail that must not be assumed — and this loop also
# has to catch the two guard constraints this revision itself adds (both mention
# ``relation``), which is what makes a re-run of either direction a no-op rather
# than a duplicate-name failure.
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


def upgrade() -> None:
    """Admit ``spawned_followup``; make ``to_id`` conditionally nullable."""
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
                    'spawned_followup'
                )
            )
        """
    )

    # The relaxation itself. Everything below re-fences it.
    op.execute(
        """
        ALTER TABLE agent.work_artifact_edges
            ALTER COLUMN to_id DROP NOT NULL
        """
    )

    # Guard 1 — a null target is legal for the new relation ONLY. The four
    # shipped relations keep the exact guarantee they had before, which is what
    # keeps /candidates' depends_on join sound.
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

    # Duplicate guard for the null-target case only — see the module docstring.
    # Two DIFFERENT follow-ups off one plan stay legal; the same note re-posted
    # collapses onto the existing row.
    op.execute(
        f"""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_work_artifact_edges_open_followup
            ON agent.work_artifact_edges (
                from_id, relation, btrim(note, {_TRIM_WS})
            )
            WHERE to_id IS NULL AND relation = 'spawned_followup'
        """
    )


def downgrade() -> None:
    """Restore the five-relation vocabulary and the unconditional NOT NULL."""
    op.execute("DROP INDEX IF EXISTS agent.uq_work_artifact_edges_open_followup")

    # Drops the widened relation CHECK *and* both guards in one pass — all
    # three reference ``relation``.
    op.execute(_DROP_RELATION_CHECKS)

    # Unavoidably destructive: the pre-revision vocabulary has no shape these
    # rows could be rewritten into. Stated in the docstring rather than hidden.
    op.execute(
        """
        DELETE FROM agent.work_artifact_edges
         WHERE relation = 'spawned_followup'
        """
    )

    op.execute(
        """
        ALTER TABLE agent.work_artifact_edges
            ALTER COLUMN to_id SET NOT NULL
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
                    'depends_on'
                )
            )
        """
    )
