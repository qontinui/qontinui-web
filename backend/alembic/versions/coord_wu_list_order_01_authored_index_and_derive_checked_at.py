"""coord.work_units — authored-order list index, plus derive_checked_at for the derive rotation

Revision ID: coord_wu_list_order_01
Revises: notif_gate_action_04_drop_dead_prefs
Create Date: 2026-09-19

Phases 1 and 3 (their alembic halves only) of plan
``2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost``.

DDL ONLY. No route change, no query change, no coord change. Coord's reads of
what this revision adds land AFTER it is applied in production (served policy
``production-and-cost`` ``alembic-sole-authorship``; the 2026-07-13
missing-column incident, ``database-migrations.md``).

What this revision adds
=======================

1. ``ix_coord_work_units_tenant_authored_slug`` ON ``coord.work_units
   (tenant_id, authored_at DESC NULLS LAST, slug)`` — Phase 1.

   The operator's Plans index (``/admin/coord/plans``) was ordered by
   ``updated_at DESC``, a column background workers rewrite every few minutes,
   so a 100-row page showed a rotating slice of recently-touched units and a
   plan could fall off the page without anyone changing it. Phase 1 moves the
   list to a stable keyset order, ``ORDER BY authored_at DESC NULLS LAST, slug
   ASC``, filtered by tenant. This index is that order exactly: the tenant
   equality first, then the two sort keys in the SAME directions and NULL
   placement, so the planner answers a page as a forward index range scan with
   no Sort node. ``NULLS LAST`` is spelled out because a ``DESC`` key defaults
   to ``NULLS FIRST``, which would not match the query (an undated unit must
   sort after every dated one). ``slug`` is the tiebreaker that makes the key
   total — a non-NULL slug is globally unique (``idx_work_units_slug``) — so
   the keyset cursor never skips or repeats a slugged row. No index served this before: alembic had ``(slug)``,
   ``(tenant_id)``, ``(tenant_id, owner_actor_key)`` and
   ``(tenant_id, vet_state)`` only.

2. ``coord.work_units.derive_checked_at TIMESTAMPTZ NULL`` — Phase 3.

   Stamped by coord's derive worker each time it evaluates a unit, so the
   derive sweep can rotate through units that nothing else touches,
   independent of ``updated_at``. Before Phase 3 the worker had ONE lane — its
   500 candidates by ``updated_at DESC`` — so a unit no scanner or transition
   touched was never re-derived, and once Phase 1 stops ordering the operator's
   list by ``updated_at`` nothing else would surface it either.

   Phase 3 adds a SECOND lane, and it is **not a ``UNION``**: coord issues two
   separate statements per tick and concatenates the rows in Rust
   (``work_unit_derive_worker::select_candidates``), because the rotation lane
   is best-effort — a coord deployed ahead of this revision has to keep
   deriving from the recency lane rather than ``42703``-ing the whole tick. The
   rotation statement, in the shape coord actually runs it (qontinui-coord, as
   of 2026-09-19)::

       SELECT w.id, w.slug, w.tenant_id, w.status, w.metadata
         FROM coord.work_units w
        WHERE w.status NOT IN ('superseded', 'obsolete')
          AND NOT (w.id = ANY($1::uuid[]))
          AND EXISTS (SELECT 1 FROM coord.work_unit_pr_citations c
                       WHERE c.work_unit_id = w.id)
        ORDER BY w.derive_checked_at ASC NULLS FIRST, w.id ASC
        LIMIT $2

   ``$1`` is the ids the recency lane already took this tick (≤ 500) and ``$2``
   is the rotation budget (100 per tick).

   **NULL means "the derive worker has never evaluated this unit"** — never
   "checked at created_at". It is exactly the population the rotation must
   reach first, which is why the index below puts NULLs first. No default and
   no backfill: a default of ``now()`` would claim a check that never happened
   and push every existing unit to the BACK of the rotation.

3. ``ix_coord_work_units_derive_checked_at`` ON ``coord.work_units
   (derive_checked_at ASC NULLS FIRST)`` — the LEADING key of that rotation
   statement's ``ORDER BY``. ``NULLS FIRST`` is explicit because a plain ASC
   key is ``NULLS LAST``, and the never-evaluated units are exactly the
   population the rotation must reach first.

   **What it buys — stated so nobody over-reads it.** The statement's second
   sort key (``w.id``) is NOT in this index, so no plan answers it without a
   sort of some kind. Measured on PG16 against the behaviour test's fixture:
   an index scan on this index under an ``Incremental Sort`` whose
   ``Presorted Key`` is ``derive_checked_at``, i.e. only rows sharing a
   timestamp are sorted. What the index buys is that the ``LIMIT`` stops early
   instead of ordering the whole eligible set; it is not a no-Sort guarantee,
   and Incremental-Sort-versus-Sort over the same scan is a cost decision
   rather than a property of this DDL — which is why the behaviour test
   requires only that the statement ride this index, and checks the presorted
   key only on the arm where the planner did choose ``Incremental Sort``.

   **The population is the CITED non-terminal units, not the table.** The
   ``EXISTS`` on ``coord.work_unit_pr_citations`` is a safety property of the
   lane rather than a saving (an uncited ``shipped`` unit would demote under
   the lane's ``Full`` derive authority), so this index is scanned as the outer
   side of a semi-join, with the ``status`` filter and the recency-lane id
   exclusion applied to the rows it yields. Size it against the CITED share of
   the corpus, not against ``count(*)``.

   Not partial: a predicate on ``status`` here would have to match coord's
   terminal-status list verbatim to be usable — a cross-repo coupling the
   derive worker's list is free to change — and the citation ``EXISTS`` is not
   an indexable predicate on this table at all.

Lock posture (deliberate)
=========================

``coord.work_units`` is written continuously (the runner scanner's upsert every
~68 s, every ``coord_work_unit_*`` MCP call, the derive worker). House
convention for a nullable column + index on such a table
(``findings_triage_01``, ``effect_calc_01_ui_bridge_effect_columns``):

* ``SET LOCAL lock_timeout = '3s'`` before the ``ADD COLUMN`` — it fails FAST
  rather than queueing an ``ACCESS EXCLUSIVE`` request that blocks every reader
  behind it. Nullable, no default => catalog-only in PG11+ (no rewrite).
* Both indexes are built ``CONCURRENTLY`` inside ``autocommit_block()``. A
  plain ``CREATE INDEX`` holds a SHARE lock for the whole build and blocks
  every work-unit write meanwhile. Entering the block commits the ``ADD
  COLUMN``, which is why every statement is individually idempotent (``IF NOT
  EXISTS`` / ``IF EXISTS``).

A killed ``CONCURRENTLY`` build leaves an INVALID index that ``IF NOT EXISTS``
then skips forever: re-running this migration does NOT heal it, and no
statement here detects it. The behaviour test EXERCISES that hazard — it marks
one of the two indexes invalid in the catalog, re-stamps alembic at the parent,
re-runs ``upgrade`` and asserts the index is still invalid afterwards — so the
skip is a pinned property rather than a warning. Recovery is manual: ``DROP
INDEX`` the invalid one, then re-run. The detector after a clean upgrade is
that same test's ``indisvalid`` assertion; nothing in production watches it.

Rollout ordering
================

1. **THIS revision** lands; ``migrate.yml`` applies it to the canonical RDS.
   Safe against the currently-deployed coord, which neither reads nor writes
   anything it adds.
2. coord's list query moves to the keyset order (Phase 1) — performance-only
   with respect to this revision: correct without the index, fast with it.
3. coord's derive worker stamps and reads ``derive_checked_at`` (Phase 3). A
   read of a new column — coord's ``schema_read_contract`` gate requires the
   pinned migrator image to contain THIS revision in that same coord PR.

Authorship posture
==================

Hand-authored, never ``--autogenerate``d; raw ``op.execute`` with every
statement schema-qualified as ``coord.`` (the ``forbid-public-schema`` check).
The table already exists (``coord_workunits_01_work_units``); this revision
only ALTERs it and is not added to any ``ALEMBIC_OWNED_TABLES`` list.
``downgrade`` drops exactly the column and the two indexes this revision
created (in that order — see its own docstring); ``authored_at``
(``coord_wu_authored_at_01``) is untouched.

``down_revision`` chains off the single live head on ``origin/main``. It was
authored against ``agent_questions_alert_episode_01`` (the single head per
``scripts/ci/count_alembic_heads.py`` on ``7a5a6f07f``) and RE-POINTED onto
``notif_gate_action_03_drop_enum_value``, then
``plan_library_07_plan_difficulty``, then ``notif_gate_action_04_drop_dead_prefs``
— each time a peer revision landed while this PR was open — a re-point, not an ``alembic merge``, because the forked revision here
had not landed and so leaves nothing behind. The fork became visible in this
PR's own tree once the branch was rebased onto the landed head, and was
re-pointed here on the branch. Do NOT read that as "a required check always
catches a fork pre-merge": a land moves ``main``, not the PR head, so
``alembic-heads-pr`` can hold a STALE GREEN until the branch is updated
against main — which is exactly what the rebase did here. coord also carries an
open-PR fork re-point trigger of its own
(``qontinui-coord`` ``pr_merge/alembic_fork_repoint_watcher.rs``), shadow-gated
by ``COORD_AUTO_REWRITE_ARMED``; whether the deployed service has it armed is
not readable from this repo, so this revision does not depend on it either way.
Three sites move together: this line, the ``Revises:`` header above, and
``_PARENT_REVISION_ID`` in ``backend/tests/test_coord_wu_list_order_01_migration.py``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_wu_list_order_01"
down_revision: str | Sequence[str] | None = "notif_gate_action_04_drop_dead_prefs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_IX_TENANT_AUTHORED_SLUG = "ix_coord_work_units_tenant_authored_slug"
_IX_DERIVE_CHECKED_AT = "ix_coord_work_units_derive_checked_at"

_ADD_COLUMN = (
    "ALTER TABLE coord.work_units "
    "ADD COLUMN IF NOT EXISTS derive_checked_at TIMESTAMPTZ NULL"
)

_COMMENT_COLUMN = """
COMMENT ON COLUMN coord.work_units.derive_checked_at IS
    'Stamped by coord''s derive worker each time it evaluates this unit, so the '
    'derive sweep can rotate through units that nothing else touches, '
    'independent of updated_at. NULL = never evaluated by the derive worker '
    '(the rotation reaches these first). Plan '
    '2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost.'
"""

# Key directions and NULL placement mirror the list query's ORDER BY exactly
# (`authored_at DESC NULLS LAST, slug ASC`); a DESC key defaults to NULLS FIRST.
_CREATE_TENANT_AUTHORED_SLUG = f"""
CREATE INDEX CONCURRENTLY IF NOT EXISTS {_IX_TENANT_AUTHORED_SLUG}
    ON coord.work_units (tenant_id, authored_at DESC NULLS LAST, slug)
"""

# A plain ASC key defaults to NULLS LAST; never-evaluated units must come first.
_CREATE_DERIVE_CHECKED_AT = f"""
CREATE INDEX CONCURRENTLY IF NOT EXISTS {_IX_DERIVE_CHECKED_AT}
    ON coord.work_units (derive_checked_at ASC NULLS FIRST)
"""

_DROP_INDEXES = (
    f"DROP INDEX CONCURRENTLY IF EXISTS coord.{_IX_DERIVE_CHECKED_AT}",
    f"DROP INDEX CONCURRENTLY IF EXISTS coord.{_IX_TENANT_AUTHORED_SLUG}",
)

_DROP_COLUMN = "ALTER TABLE coord.work_units DROP COLUMN IF EXISTS derive_checked_at"


def upgrade() -> None:
    """Additive: one nullable column plus two indexes. Idempotent."""
    # Fail fast rather than queueing an ACCESS EXCLUSIVE request in front of
    # every reader behind it. Nullable + no default => catalog-only.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(_ADD_COLUMN)
    op.execute(_COMMENT_COLUMN)

    # CONCURRENTLY cannot run inside a transaction; entering the block commits
    # the ALTER above, which is why each statement is individually idempotent.
    with op.get_context().autocommit_block():
        op.execute(_CREATE_TENANT_AUTHORED_SLUG)
        op.execute(_CREATE_DERIVE_CHECKED_AT)


def downgrade() -> None:
    """Reverse exactly this revision: the column, then the indexes.

    Statement ORDER mirrors ``upgrade``, and for the same reason: the
    lock-taking ``ALTER`` runs in the migration's own transaction, immediately
    after the ``SET LOCAL lock_timeout`` that bounds it, and the
    ``CONCURRENTLY`` work runs last. Putting the ``autocommit_block`` first
    would commit that transaction and discard the ``SET LOCAL``, leaving
    ``DROP COLUMN`` to queue an unbounded ``ACCESS EXCLUSIVE`` request in front
    of every reader of a continuously-written table. What the ordering buys is
    therefore the lock bound in the TRANSACTIONAL (default) case only: run
    non-transactionally, ``SET LOCAL`` is a no-op in either order and the bound
    has to come from the server's own ``lock_timeout``.

    Dropping the column takes ``ix_coord_work_units_derive_checked_at`` with it
    (an index on a dropped column cannot survive), under the ``ACCESS
    EXCLUSIVE`` lock the ``ALTER`` already holds, so the ``DROP INDEX
    CONCURRENTLY IF EXISTS`` for it below is a no-op. The one drop that still
    matters concurrently is the authored-order index.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(_DROP_COLUMN)

    with op.get_context().autocommit_block():
        for statement in _DROP_INDEXES:
            op.execute(statement)
