"""coord.subproject_members / coord.subprojects: the lineage vocabulary and its evidence columns

Phase 1 (the qontinui-web half, which lands FIRST) of plan
``2026-11-16-subproject-lineage-recovers-orphaned-continuations-rehomes-orphans-titles-from-evidence``
(design decision D3). Three changes, all in ONE transaction::

    coord.subproject_members
        ck_subproject_members_joined_via   widened: + 'anchor', 'work_evidence'
        via_detail   jsonb NULL            (new)
    coord.subprojects
        title_basis  text  NULL            (new)
        ck_subprojects_title_basis         title_basis IS NULL OR IN
                                           ('intent', 'unit_plan', 'pr_title',
                                            'session_name', 'derived')

Hand-authored; ``alembic revision --autogenerate`` was not run and is never run
against ``coord.*`` (served policy ``production-and-cost``
``alembic-sole-authorship``).

Why these exist
===============

coord's subproject reconciler (qontinui-coord ``subprojects/resolve.rs``) places
every agent session into a subproject by its lineage. Measured 2026-11-16 (the
plan's measured-state table), 69% of the live subprojects had origin
``orphan_continuation`` and 91% held exactly one session, because two kinds of evidence coord already holds were never used to link:

* an **anchor** (rule 3b, plan D1) — the ``claim:pr:<repo>#<n>`` or
  ``unit:<wu>:<phase>`` that a continuation's gate placeholder, allocation
  intent or session name carries, resolved through the PR's author session, the earliest session with
  the same anchor, or the unit's membership;
* **work evidence** (rule 6b, plan D2) — the session's own commit-lineage PRs
  and allocation work unit, tried before a pending session expires into an
  orphan root.

A member placed by either joins with the new ``joined_via`` word ``anchor`` or
``work_evidence``. ``via_ref`` already holds what it joined through (the anchor
string, a PR ``owner/repo#n`` or a unit id) and ``via_session`` the session
whose membership it inherited. What the existing columns cannot hold:

* ``coord.subproject_members.via_detail jsonb`` — which rule fired and, when the
  evidence named two or more distinct target subprojects so coord refused to
  pick one, those ``candidates``. coord stores no history (the detail door
  computes it at read time from member rows), so without a column the
  ambiguity would be lost rather than shown to the operator and the topics
  layer. NULL = the member predates the column, or joined by a rule that
  records no detail.
* ``coord.subprojects.title_basis text`` — which evidence the
  ``root_session``-sourced title came from (plan D6): the allocation or
  declared ``intent``, a member unit's plan (``unit_plan``), the anchor PR's
  title (``pr_title``), a recorded ``session_name``, or the hash-``derived``
  name of last resort. NULL = the title was written before coord recorded a
  basis (every row this revision finds), or ``title_source = 'explicit'``.

Both vocabularies are closed, so each carries a CHECK that refuses a word
outside it by name. ``joined_via`` stays NOT NULL; ``title_basis`` admits NULL
explicitly (``IS NULL OR ... IN``) so the reading "NULL = basis not recorded"
does not rest on SQL's three-valued CHECK semantics alone.

Lock posture
============

Both tables are coord-written (the leader reconciler tick and the operator
doors). The upgrade runs under the house ``SET LOCAL lock_timeout = '3s'``
(``alembic/env.py`` resets ``lock_timeout`` after each revision) and takes
both tables' ACCESS EXCLUSIVE locks up front in ONE ``LOCK TABLE`` request,
parent first, before any DDL. ``lock_timeout`` applies to each lock
acquisition separately, so the request can wait up to 3 s per table (about
6 s in all, holding ``subprojects`` while it waits for ``subproject_members``).
The order matches the operator merge door (``subprojects`` FOR UPDATE first)
but not the reconciler, which reads ``subproject_members`` before it takes
``subprojects`` FOR SHARE; a collision with a reconciler transaction is
resolved by Postgres's deadlock detector or the timeout aborting one side,
and an aborted migration is simply re-run.

Each table takes ONE ``ALTER TABLE`` statement, so neither can carry a subset
of its change:

* ``subproject_members``: ``ADD COLUMN IF NOT EXISTS via_detail``, then
  ``DROP CONSTRAINT IF EXISTS ck_subproject_members_joined_via`` and
  ``ADD CONSTRAINT`` it back with the widened IN list. Postgres has no way to
  alter a CHECK's expression in place, and no ``ADD CONSTRAINT IF NOT EXISTS``;
  drop-then-add inside one statement is atomic and re-runnable (a re-run drops
  the widened constraint and adds it again).
* ``subprojects``: ``ADD COLUMN IF NOT EXISTS title_basis``, then the same
  drop-then-add of ``ck_subprojects_title_basis``.

The constraints are added VALIDATED (no ``NOT VALID``), which scans each table
once under the lock already held. That is deliberate: these are the two
coord tables a reconciler writes (the plan measured 4 795 subprojects
on 2026-11-16), so the scan is milliseconds. Either way PostgreSQL enforces
the CHECK on every new INSERT/UPDATE (that is what refuses a misspelt word);
validating also proves every existing row passes, so the catalog never carries
a constraint marked unchecked, at almost no cost.
The widened ``joined_via`` list is a superset of the old one, so every existing
row passes; every existing ``title_basis`` is NULL, which passes.

Downgrade refuses on the vocabulary, drops the two columns
==========================================================

Narrowing ``ck_subproject_members_joined_via`` back would FAIL on a row that
already uses ``anchor`` or ``work_evidence`` — and silently rewriting those rows
to an old word would claim a link that does not exist (``gate_continuation``
asserts a gate link; ``root`` asserts the session founded the subproject). So
``downgrade()`` first raises when any member row (live or
removed: the ledger is history) uses a new word; the operator then decides what
those rows become. Otherwise it narrows the CHECK and drops both columns
(``ck_subprojects_title_basis`` goes with ``title_basis``) -- which DISCARDS
any ``via_detail`` candidates and ``title_basis`` values coord has written;
those are derived evidence coord re-records, so they are dropped, not guarded. The refusal is a
``DO`` block so it renders in offline ``--sql`` mode as well; its message
carries no ``%`` (a ``RAISE`` placeholder SQLAlchemy would also have to
escape) and no ``:word`` bind-parameter lookalike.

Merge-train posture
===================

Every ``op.execute`` takes a static literal, but coord's migration classifier
(``pr_merge/migration_classifier.rs``, read at qontinui-coord ``84e37b3b5``)
fails closed on ``upgrade()``, so the merge train HOLDS this revision for
review by design. The classifier reports only its FIRST rejection (today the
``LOCK TABLE``), but each of these three would hold it on its own:

* the ``LOCK TABLE`` (no handler; the unrecognized-statement catch-all) --
  kept because it bounds the lock wait and fixes the acquisition order;
* the ``DROP CONSTRAINT`` inside the ``ALTER TABLE`` -- kept because a CHECK
  cannot be widened without dropping it;
* the validated ``ADD CONSTRAINT`` (no ``NOT VALID``) -- kept because the
  validation scan is milliseconds on these tables and leaves no unchecked
  constraint behind (new rows are checked either way).

The classifier filters ``downgrade()`` out before classifying, so the ``DO``
block plays no part in the hold. The downgrade's refusal is kept because it
turns a downgrade over rows using the new words into a readable error rather
than a bare constraint violation (transactional DDL already rolls back a
failed narrowing; the refusal never rewrites history either way).

Two-repo ordering
=================

This revision must be APPLIED in production before the qontinui-coord Phase 2
PR that writes ``anchor`` / ``work_evidence`` / ``via_detail`` and serves
``title_basis`` deploys (the plan's Phase 1 exit). That coord code does not
exist yet. Plan D3 says an insert of a new word before this revision is
applied is a CHECK violation, an item error retried next tick, never a
fallback to an old word; the Phase 1 exit (applied in production before
Phase 2 merges) is what keeps the new columns' reads from ever running
against a schema that lacks them.

Chaining
========

``down_revision = "cirscope_01_ci_runner_scope_listings"`` -- the single alembic head of qontinui-web
``origin/main`` when this branch was last rebased (2026-11-17), confirmed with
``scripts/ci/count_alembic_heads.py``. Main's head moves often. coord's
land-time re-point (``alembic_repoint_plan.rs``) REFUSES this revision as it
stands: its destructive-code check (E6) matches the ``ALTER TABLE ... DROP
CONSTRAINT`` outside ``downgrade()``. A mechanical re-point therefore needs a
``coord:destructive-attested=<digest12>`` label on the PR (applied on GitHub),
or the re-point is done by hand. A re-point is three coupled
edits: ``down_revision``, the ``Revises:`` line below, and
``_PARENT_REVISION_ID`` in
``tests/test_coord_subprojects_03_lineage_vocabulary_migration.py``.

Revision ID: coord_subprojects_03_lineage_vocabulary
Revises: cirscope_01_ci_runner_scope_listings
Create Date: 2026-11-16

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_subprojects_03_lineage_vocabulary"
down_revision: str | None = "cirscope_01_ci_runner_scope_listings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The vocabularies the migration test pins against the static SQL below. The
# SQL spells the same words; the test asserts the two agree.
_JOINED_VIA_BEFORE: tuple[str, ...] = (
    "root",
    "parent",
    "gate_continuation",
    "work_unit_dispatch",
    "spawn",
    "declared",
    "operator_move",
    "auto_attach",
    "followup_edge",
    "split",
    "backfill",
    "merge",
)
_JOINED_VIA_ADDED: tuple[str, ...] = ("anchor", "work_evidence")
_TITLE_BASES: tuple[str, ...] = (
    "intent",
    "unit_plan",
    "pr_title",
    "session_name",
    "derived",
)


def upgrade() -> None:
    """Widen ``joined_via``, add ``via_detail`` and ``title_basis`` with its CHECK."""
    # Bound the ACCESS EXCLUSIVE lock wait (house style); env.py resets it
    # after each revision.
    op.execute("SET LOCAL lock_timeout = '3s'")
    # Both tables up front, parent first, before any DDL. lock_timeout bounds
    # each table's wait separately; see the module docstring's Lock posture.
    op.execute(
        "LOCK TABLE coord.subprojects, coord.subproject_members IN ACCESS EXCLUSIVE MODE"
    )
    op.execute(
        """
        ALTER TABLE coord.subproject_members
            ADD COLUMN IF NOT EXISTS via_detail jsonb,
            DROP CONSTRAINT IF EXISTS ck_subproject_members_joined_via,
            ADD CONSTRAINT ck_subproject_members_joined_via CHECK (joined_via IN
                ('root', 'parent', 'gate_continuation', 'work_unit_dispatch',
                 'spawn', 'declared', 'operator_move', 'auto_attach',
                 'followup_edge', 'split', 'backfill', 'merge',
                 'anchor', 'work_evidence'))
        """
    )
    op.execute(
        """
        ALTER TABLE coord.subprojects
            ADD COLUMN IF NOT EXISTS title_basis text,
            DROP CONSTRAINT IF EXISTS ck_subprojects_title_basis,
            ADD CONSTRAINT ck_subprojects_title_basis CHECK (
                title_basis IS NULL
                OR title_basis IN
                    ('intent', 'unit_plan', 'pr_title', 'session_name', 'derived'))
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.subproject_members.via_detail IS
            'What placed this member, beyond joined_via / via_ref / via_session '
            '(plan 2026-11-16-subproject-lineage-recovers-orphaned-continuations-'
            'rehomes-orphans-titles-from-evidence, D3): the rule that fired and, '
            'when the evidence named two or more distinct target subprojects and '
            'coord refused to pick one, their candidates. Written by coord only. '
            'NULL = the member predates the column or joined by a rule that '
            'records no detail; never read as no candidates.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.subprojects.title_basis IS
            'The evidence a root_session-sourced title was taken from (plan '
            '2026-11-16-subproject-lineage-recovers-orphaned-continuations-'
            'rehomes-orphans-titles-from-evidence, D6): intent | unit_plan | '
            'pr_title | session_name | derived. Written by coord only. NULL = '
            'the basis was not recorded (a title written before the column, or '
            'title_source = explicit); never read as derived.'
        """
    )


def downgrade() -> None:
    """Refuse when a member row uses a new word; else narrow the CHECK, drop both columns."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    # Lock before the refusal check so no coord insert of a new word can land
    # between the check and the narrowing ALTER.
    op.execute(
        "LOCK TABLE coord.subprojects, coord.subproject_members IN ACCESS EXCLUSIVE MODE"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                  FROM coord.subproject_members
                 WHERE joined_via IN ('anchor', 'work_evidence')
            ) THEN
                RAISE EXCEPTION USING
                    MESSAGE = 'refusing to downgrade '
                        'coord_subprojects_03_lineage_vocabulary, because '
                        'coord.subproject_members rows joined via anchor or '
                        'work_evidence, which the narrowed CHECK would reject',
                    HINT = 'decide what those rows become (SELECT ... WHERE '
                        'joined_via IN (''anchor'', ''work_evidence'')) before '
                        'downgrading';
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        ALTER TABLE coord.subproject_members
            DROP CONSTRAINT IF EXISTS ck_subproject_members_joined_via,
            ADD CONSTRAINT ck_subproject_members_joined_via CHECK (joined_via IN
                ('root', 'parent', 'gate_continuation', 'work_unit_dispatch',
                 'spawn', 'declared', 'operator_move', 'auto_attach',
                 'followup_edge', 'split', 'backfill', 'merge')),
            DROP COLUMN IF EXISTS via_detail
        """
    )
    op.execute(
        """
        ALTER TABLE coord.subprojects
            DROP COLUMN IF EXISTS title_basis
        """
    )
