"""coord.work_units — authored-order list index, plus derive_checked_at for the derive rotation

Revision ID: coord_wu_list_order_01
Revises: agent_questions_alert_episode_01
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
   independent of ``updated_at``. Today the worker selects its 500 candidates
   by ``updated_at`` recency, so a unit no scanner or transition touches is
   never re-derived — and once Phase 1 stops ordering the index by
   ``updated_at``, nothing else would surface it either. Phase 3 selects the
   candidates as ``updated_at`` recency **UNION** the oldest
   ``derive_checked_at NULLS FIRST``, which bounds every non-terminal unit's
   re-derive interval.

   **NULL means "the derive worker has never evaluated this unit"** — never
   "checked at created_at". It is exactly the population the rotation must
   reach first, which is why the index below puts NULLs first. No default and
   no backfill: a default of ``now()`` would claim a check that never happened
   and push every existing unit to the BACK of the rotation.

3. ``ix_coord_work_units_derive_checked_at`` ON ``coord.work_units
   (derive_checked_at ASC NULLS FIRST)`` — serves the rotation half of that
   UNION (``ORDER BY derive_checked_at ASC NULLS FIRST LIMIT n``). ``NULLS
   FIRST`` is explicit because a plain ASC key is ``NULLS LAST``. Not
   partial: the worker's own status filter is applied to the rows the scan
   yields, and a predicate on ``status`` here would have to match coord's
   terminal-status list verbatim to be usable — a cross-repo coupling the
   derive worker's list is free to change.

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
would then skip forever; the behaviour test pins ``indisvalid`` for both.

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
``downgrade`` drops exactly the two indexes and the column this revision
created; ``authored_at`` (``coord_wu_authored_at_01``) is untouched.

``down_revision`` chains off the single live head at authoring time
(``agent_questions_alert_episode_01``, per ``scripts/ci/count_alembic_heads.py``
on ``7a5a6f07f``); coord re-points it at land time if the head has moved.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_wu_list_order_01"
down_revision: str | Sequence[str] | None = "agent_questions_alert_episode_01"
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
    """Reverse exactly this revision: the two indexes, then the column."""
    with op.get_context().autocommit_block():
        for statement in _DROP_INDEXES:
            op.execute(statement)

    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(_DROP_COLUMN)
