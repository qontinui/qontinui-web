"""coord.work_units — heal the two ``coord_wu_list_order_01`` indexes if a killed build left one INVALID

Revision ID: coord_wu_list_order_02
Revises: coord_wu_list_order_01
Create Date: 2026-09-21

Post-merge follow-up to ``coord_wu_list_order_01`` (qontinui-web#1410, landed
2026-09-21, applied to the canonical RDS by ``migrate.yml`` at 15:24:58Z),
Phases 1 and 3 of plan
``2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost``.

DDL ONLY. No route change, no query change, no coord change. It adds no object
of its own: every statement here either rebuilds or re-creates an index that
``coord_wu_list_order_01`` already owns.

Why a SEPARATE revision rather than an edit to ``_01``
======================================================

``_01`` is already stamped in production, so alembic will never run its
``upgrade()`` again. Adding the check below to that file would be DEAD CODE on
every database that has already applied it — which is every database that
matters. A repair has to arrive as a revision that has not yet run.

The gap this closes, in ``_01``'s own words
===========================================

``_01``'s docstring states the hazard and then leaves it unwatched::

    A killed ``CONCURRENTLY`` build leaves an INVALID index that ``IF NOT
    EXISTS`` then skips forever: re-running this migration does NOT heal it,
    and no statement here detects it. [...] Recovery is manual: ``DROP INDEX``
    the invalid one, then re-run. The detector after a clean upgrade is that
    same test's ``indisvalid`` assertion; **nothing in production watches it.**

``tests/test_coord_wu_list_order_01_migration.py`` assertion 8 PINS that
behaviour — it marks an index invalid, re-runs ``_01``, and asserts the index
is *still* invalid. So the trap is proven, documented, and until now
unmitigated outside a test database.

Across this directory the hazard is DESCRIBED far more often than it is
handled, which is worth stating precisely rather than as "house convention":

* **Handled — heal.** ``coord_alerts_claim_01`` (``_index_is_invalid`` ->
  ``DROP INDEX CONCURRENTLY`` -> rebuild) and
  ``agent_questions_alert_episode_01``. These two are the real precedent, and
  this revision copies their shape.
* **Handled — assert.** ``pr_fixer_spawn_01`` (``_require_valid`` raises,
  naming the index and the recovery) and ``coord_test_results_idx_01``.
* **Described but NOT handled** — ``effect_calc_01_ui_bridge_effect_columns``,
  ``coord_alerts_flakeidx_01`` and ``coord_alerts_pagedidx_01`` each spell the
  trap out in prose ("verify with ``pg_index.indisvalid``, not mere
  existence") and then ship no check at all: ``grep -c get_bind`` is 0 in all
  three, so there is no catalog read to do the verifying. ``_01`` joined this
  group.

So ``_01`` cites ``effect_calc_01`` as its precedent for LOCK POSTURE, which is
real — but there is no invalid-index handling in that file to inherit. The gap
is the directory's most-repeated one, not a lapse peculiar to ``_01``.

This revision applies both handled shapes in the order the two real precedents
use them: heal first, then assert, so an index that cannot be rebuilt fails the
migration loudly instead of reporting success.

What it does, per index
=======================

For ``ix_coord_work_units_tenant_authored_slug`` and
``ix_coord_work_units_derive_checked_at``:

1. If it exists and ``pg_index.indisvalid`` is false — the fingerprint of a
   killed ``CONCURRENTLY`` build — ``DROP INDEX CONCURRENTLY IF EXISTS`` it, so
   the ``CREATE`` below rebuilds rather than skipping the corpse.
2. ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` with the SAME definition ``_01``
   uses — byte-for-byte the same key directions and NULL placement, because a
   rebuild that quietly changed them would be worse than the invalid index.
3. Assert, and RAISE naming the index if any of it fails: the index EXISTS, it
   is ``indisvalid``, and its ``pg_get_indexdef`` still carries the NULL
   placement the order depends on.

Step 3's third clause exists because ``IF NOT EXISTS`` matches on NAME ALONE.
The reachable path is ``_01``'s own prescribed recovery: an operator drops the
invalid index and hand-rebuilds it WITHOUT ``NULLS LAST``. That index is
perfectly valid and stops serving the order, and every existence-or-validity
check in this directory would wave it through. Checking the definition is the
difference between asserting the index is THERE and asserting it is the RIGHT
one.

It is checked as a FRAGMENT — the whole parenthesised key list, e.g.
``(tenant_id, authored_at DESC NULLS LAST, slug)`` — rather than as a
whole-string match: Postgres spells ``USING btree`` and the index's own name on
its own terms, so a whole-string expectation would pin rendering cosmetics and
break on a version bump while the DDL was still exactly right. The key list is
what an operator retyping the statement can get wrong, and not only in the NULL
placement: for the authored index, a leading ``tenant_id`` is what makes a page
a tenant-filtered range scan and a trailing ``slug`` is what makes the keyset
cursor total, so an index built as ``(authored_at DESC NULLS LAST)`` alone
would be valid, carry the right NULL placement, and lose both.

A wrong definition RAISES rather than triggering a rebuild: dropping a valid
index on a continuously-written table on the strength of a string comparison is
a worse failure than stopping and naming it. The raise is still actionable —
the operator drops it and re-runs, which takes the MISSING path and rebuilds it
correctly.

**On a healthy database every step is a no-op**: nothing is invalid, both
indexes exist, and the two ``CREATE ... IF NOT EXISTS`` statements do nothing.
That is the expected production outcome — the migrate run that applied ``_01``
succeeded on its first attempt, so neither index is expected to be invalid
today. This revision is the standing detector, not a fix for a known breakage.

A VALID index is never dropped. Rebuilding a healthy index on a
continuously-written table would cost a full heap scan to prove a property the
catalog already answers, so the ``indisvalid`` read gates the drop.

Lock posture
============

Every statement is ``CONCURRENTLY`` inside ``autocommit_block()``, so nothing
here takes a lock that blocks a reader or a writer of ``coord.work_units``.
There is no ``ALTER TABLE``, hence no ``SET LOCAL lock_timeout`` — ``_01``
needed one for its ``ADD COLUMN``; this revision has no such statement to bound.

``DROP INDEX CONCURRENTLY`` cannot run inside a transaction either, which is why
the drop is in the same block as the create rather than ahead of it.

Downgrade is deliberately a NO-OP
=================================

This revision creates no object it owns. Both indexes belong to
``coord_wu_list_order_01`` and its ``downgrade`` is what removes them. A
``downgrade`` here that dropped them would reverse a DIFFERENT revision and
leave ``_01`` stamped over a table missing the indexes it promises — the exact
silent-skip failure this file exists to catch.

``migration-reversal.yml`` replays upgrade -> downgrade -1 -> upgrade; a no-op
``downgrade`` is correct under that gate and re-running ``upgrade`` is
idempotent. Precedent for an intentionally empty ``downgrade`` is every merge
revision in this directory (e.g. ``8e1c421417fd_merge_heads``).

Authorship posture
==================

Hand-authored, never ``--autogenerate``d; raw ``op.execute`` with every
statement schema-qualified as ``coord.`` (the ``forbid-public-schema`` check and
``.pre-commit-hooks/check_alembic_schema_args.py``).

Every DDL string is passed as a LITERAL at its ``op.execute(...)`` call site,
and that placement is load-bearing rather than stylistic. ``_check_raw_sql`` in
that hook only analyses ``call.args[0]`` when it is an ``ast.Constant``;
anything else — an f-string, a name, or a lookup into a module-level dict —
falls into its "computed / dynamic SQL, skip silently" branch. An earlier draft
of this file held the statements in ``_DROP_BY_INDEX`` / ``_CREATE_BY_INDEX``
and executed ``op.execute(_DROP_BY_INDEX[name])``; the gate passed VACUOUSLY,
and deleting ``coord.`` from both DROPs still exited 0. Inlining is what makes
the gate real here, so do not "tidy" these statements back into a table.

The table already exists;
this revision creates no table and is not added to any ``ALEMBIC_OWNED_TABLES``
list. It drops nothing on the upgrade path except an index it immediately
rebuilds, and only when that index is already INVALID and therefore serving no
query — so the ``coord-column-drop-guard`` has no deployed read to protect.

``down_revision`` is ``coord_wu_list_order_01``, the single head on
``origin/main`` at ``8668ac9bd`` (``scripts/ci/count_alembic_heads.py``:
``HEAD_COUNT=1``). Two sites move together if it is re-pointed: the
``Revises:`` header above and ``_PARENT_REVISION_ID`` in
``backend/tests/test_coord_wu_list_order_02_migration.py``.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_wu_list_order_02"
down_revision: str | Sequence[str] | None = "coord_wu_list_order_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_IX_TENANT_AUTHORED_SLUG = "ix_coord_work_units_tenant_authored_slug"
_IX_DERIVE_CHECKED_AT = "ix_coord_work_units_derive_checked_at"

# The WHOLE key list of each index, as `pg_get_indexdef` renders it — every
# key, in order, with its direction and NULL placement.
#
# A fragment, not a whole-string match, so the `USING btree` prefix and the
# index's own name stay out of it — see "What it does, per index" above. But the
# fragment covers all the keys rather than just the NULL placement, because a
# hand-rebuild loses whichever keys the person retyping it forgot. For the
# authored index those are load-bearing in different ways: `tenant_id` leading
# is what makes a page a tenant-filtered range scan, and the trailing `slug` is
# what makes the keyset cursor total (`_01`'s docstring states both). An index
# built as `(authored_at DESC NULLS LAST)` alone is valid, carries the right
# NULL placement, and silently loses both properties.
#
# `pg_get_indexdef` renders only NON-defaults, which is what makes these exact:
# `DESC` defaults to NULLS FIRST so `NULLS LAST` is printed; a plain ASC key
# defaults to NULLS LAST so `NULLS FIRST` is printed while the redundant `ASC`
# is dropped — hence `(derive_checked_at NULLS FIRST)` and not
# `(derive_checked_at ASC NULLS FIRST)`.
#
# Consequence worth keeping: a rebuild as `(derive_checked_at DESC)` or
# `(derive_checked_at DESC NULLS FIRST)` is ALSO refused, because NULLS FIRST is
# the default for DESC and renders away, leaving `(derive_checked_at DESC)`.
# That is the right answer — a DESC rotation index reaches the never-evaluated
# units last — so do not "fix" the fragment to accept it.
_REQUIRED_KEY_FRAGMENT: dict[str, str] = {
    _IX_TENANT_AUTHORED_SLUG: "(tenant_id, authored_at DESC NULLS LAST, slug)",
    _IX_DERIVE_CHECKED_AT: "(derive_checked_at NULLS FIRST)",
}

_INDEX_STATE_SQL = """
    SELECT i.indisvalid, pg_get_indexdef(i.indexrelid)
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'coord' AND c.relname = :idx
"""


def _index_state(index_name: str) -> tuple[bool, str] | None:
    """``(indisvalid, definition)`` for ``coord.<index_name>``; ``None`` if absent."""
    row = (
        op.get_bind()
        .execute(sa.text(_INDEX_STATE_SQL), {"idx": index_name})
        .one_or_none()
    )
    if row is None:
        return None
    return bool(row[0]), str(row[1])


def _is_invalid(index_name: str) -> bool:
    """True only when the index EXISTS and is INVALID — the killed-build corpse.

    A missing index is not invalid: there is nothing to drop, and issuing a drop
    for it would be a statement about an object that is not there.
    """
    state = _index_state(index_name)
    return state is not None and not state[0]


def _require_healthy(index_name: str) -> None:
    """Raise unless ``coord.<index_name>`` exists, is valid, and has the right keys."""
    state = _index_state(index_name)
    common = (
        "The list page's authored order and the derive worker's rotation both "
        "depend on this index, and CREATE INDEX CONCURRENTLY IF NOT EXISTS "
        "reports success without it serving anything — so this raises rather "
        "than stamping the revision."
    )

    if state is None:
        raise RuntimeError(
            f"coord.{index_name} is MISSING after CREATE INDEX CONCURRENTLY IF "
            f"NOT EXISTS reported success. {common} There is nothing to drop, "
            "so the recovery is to investigate why the build produced no index "
            "(disk, permissions, a cancelled statement) and re-run."
        )

    valid, definition = state

    if not valid:
        raise RuntimeError(
            f"coord.{index_name} is INVALID after this revision's CREATE INDEX "
            f"CONCURRENTLY, so that build was itself interrupted. {common} "
            f"Recovery: DROP INDEX CONCURRENTLY coord.{index_name}, then re-run "
            "this migration when the database is not under a cancelling load."
        )

    required = _REQUIRED_KEY_FRAGMENT[index_name]
    if required not in definition:
        raise RuntimeError(
            f"coord.{index_name} is valid but its definition no longer carries "
            f"{required!r}, so it does not serve the order it exists for. This "
            "is what a hand-rebuild that lost a key or its NULL placement "
            "looks like; IF NOT EXISTS matches on NAME alone and cannot catch "
            f"it. {common} Recovery: DROP INDEX CONCURRENTLY coord.{index_name}, "
            "then re-run this migration, which rebuilds it correctly. "
            f"  found: {definition}"
        )


def upgrade() -> None:
    """Heal-then-assert both ``coord_wu_list_order_01`` indexes. Idempotent.

    The statements are spelled out per index rather than looped over a table
    because the schema-arg gate only analyses a literal at the ``op.execute``
    call site — see "Authorship posture" above.
    """
    # CONCURRENTLY cannot run inside a transaction, and neither can DROP INDEX
    # CONCURRENTLY — both live in the autocommit block together.
    with op.get_context().autocommit_block():
        # 1. The Phase 1 authored-order index.
        if _is_invalid(_IX_TENANT_AUTHORED_SLUG):
            # Only an INVALID index is dropped. A valid one is left alone:
            # proving what the catalog already answered would cost a full heap
            # scan on a continuously-written table.
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.ix_coord_work_units_tenant_authored_slug"
            )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_coord_work_units_tenant_authored_slug
                ON coord.work_units (tenant_id, authored_at DESC NULLS LAST, slug)
            """
        )
        _require_healthy(_IX_TENANT_AUTHORED_SLUG)

        # 2. The Phase 3 derive-rotation index.
        if _is_invalid(_IX_DERIVE_CHECKED_AT):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.ix_coord_work_units_derive_checked_at"
            )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_coord_work_units_derive_checked_at
                ON coord.work_units (derive_checked_at ASC NULLS FIRST)
            """
        )
        _require_healthy(_IX_DERIVE_CHECKED_AT)


def downgrade() -> None:
    """No-op by design — see "Downgrade is deliberately a NO-OP" above.

    Both indexes are ``coord_wu_list_order_01``'s objects. Dropping them here
    would reverse a revision this one does not own and leave ``_01`` stamped
    over a table missing the indexes it promises.
    """
