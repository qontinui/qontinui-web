"""coord.findings — triage stamp (``triaged_at`` / ``triaged_by``)

Revision ID: findings_triage_01
Revises: blane_01
Create Date: 2026-09-17

Phase 0 of plan
``2026-09-17-findings-carry-a-triage-stamp-and-the-steward-reads-since-last-run``.
Adds two nullable columns and one partial index to ``coord.findings`` so a
finding records whether — and by whom — it has been consumed by a steward
cycle, and so the findings steward's default read becomes "everything since
the last run" instead of a fixed-size window that goes dark unread.

- ``triaged_at TIMESTAMPTZ NULL`` — when the finding was first consumed by a
  triage cycle. **NULL means never consumed by a steward cycle.** The mark
  door sets it to ``now()`` only where it is still NULL: the first consumer's
  stamp is the fact worth keeping, so a re-mark is a no-op rather than a
  re-stamp.
- ``triaged_by TEXT NULL`` — the consumer's own free-form, non-empty name. The
  steward writes ``findings-steward:<session-uuid>``; a hand mark writes
  ``session:<uuid>``. NULL whenever ``triaged_at`` is NULL.

Rows with ``kind = 'dossier'`` are never stamped: a dossier head is the
steward's *output*, not an input it consumes, so the read filter and the mark
door both leave those rows untouched (the columns still exist on them, and
stay NULL).

A partial index ``idx_findings_untriaged`` over ``(tenant_id, created_at)
WHERE triaged_at IS NULL`` serves the steward's ``triaged=false`` read — the
only consumer of that predicate. The NON-dossier population it indexes shrinks
to roughly a day's worth of findings once the steward runs on its schedule;
dossier rows (never stamped, and never expiring — coord gives ``kind='dossier'``
a 100-year TTL) stay in it permanently — ~100 rows (104 measured 2026-09-17) — which is why
the predicate is deliberately NOT ``AND kind <> 'dossier'``: a partial index is
chosen only when the query's own WHERE implies the predicate verbatim, and the
plain ``IS NULL`` form is the one every consumer can satisfy. The predicate is
the constant ``IS NULL`` comparison, so there is no IMMUTABLE-predicate hazard.

## House conventions followed

alembic is the SOLE author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``); this revision is
hand-authored, never ``--autogenerate``d. A coord read of these columns must
land AFTER this migration is applied in production (the 2026-07-13
missing-column incident, ``database-migrations.md``).

Raw ``op.execute`` (not ``op.add_column``) with ``ADD COLUMN IF NOT EXISTS`` /
``CREATE INDEX ... IF NOT EXISTS`` so the migration is collision-safe against
any canonical PG that might already carry the columns — the
``gatesarchival01_gates_archival_cols`` convention. The index is built
``CONCURRENTLY`` inside ``autocommit_block()`` behind a ``SET LOCAL
lock_timeout`` guard on the ALTERs — the current convention for a nullable
column + partial index on a live, continuously-written table
(``effect_calc_01_ui_bridge_effect_columns``): a plain ``CREATE INDEX`` holds a
SHARE lock on ``coord.findings`` for the whole build and blocks every coord
finding write meanwhile. Entering the autocommit block commits the ALTERs, which
is why each statement is individually idempotent. Every statement names the
``coord`` schema explicitly (the ``forbid-public-schema`` check). The
behaviour test ``tests/test_findings_triage_01_triage_stamp_migration.py``
pins the columns, the index's validity (a killed CONCURRENTLY build leaves an
INVALID index that ``IF NOT EXISTS`` would then skip forever), its predicate,
and that the steward's read rides it while the complementary read does not.

Touches **only** ``coord.findings`` (an ALTER of an existing table, created by
revision ``coord_findings`` earlier in this chain). It is NOT added to any
``ALEMBIC_OWNED_TABLES`` list — the table already exists; this revision only
ALTERs it.

``down_revision`` chains off the LIVE alembic head at authoring time
(``blane_01`` on ``a872dd9cb``, computed as the one revision no
``down_revision`` names across all 567 revision files) — NOT off the buried
``coord_findings``, which has had merged children since 2026-06-20.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "findings_triage_01"
down_revision: str | Sequence[str] | None = "blane_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_ADD_COLUMNS = (
    "ALTER TABLE coord.findings ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ NULL",
    "ALTER TABLE coord.findings ADD COLUMN IF NOT EXISTS triaged_by TEXT NULL",
)

_CREATE_INDEX = """
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_untriaged
    ON coord.findings (tenant_id, created_at)
    WHERE triaged_at IS NULL
"""

_DROP_INDEX = "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_findings_untriaged"

_DROP_COLUMNS = (
    "ALTER TABLE coord.findings DROP COLUMN IF EXISTS triaged_at",
    "ALTER TABLE coord.findings DROP COLUMN IF EXISTS triaged_by",
)


def upgrade() -> None:
    """Additive: two nullable columns plus one partial index. Idempotent."""
    # Fail fast rather than queueing an ACCESS EXCLUSIVE request in front of
    # every reader behind it. Nullable + no default => catalog-only, so the
    # lock itself is held only for the catalog update.
    op.execute("SET LOCAL lock_timeout = '3s'")
    for statement in _ADD_COLUMNS:
        op.execute(statement)
    # env.py runs every pending migration in ONE enclosing transaction, so
    # without a reset this SET LOCAL would silently apply to any migration
    # that runs after this one in the same batch (e.g. a fresh-DB replay).
    op.execute("SET LOCAL lock_timeout = DEFAULT")

    # CONCURRENTLY cannot run inside a transaction; entering the block commits
    # the ALTERs above, which is why they are individually idempotent.
    with op.get_context().autocommit_block():
        op.execute(_CREATE_INDEX)


def downgrade() -> None:
    """Reverse exactly this revision: the index, then the two columns."""
    with op.get_context().autocommit_block():
        op.execute(_DROP_INDEX)

    op.execute("SET LOCAL lock_timeout = '3s'")
    for statement in _DROP_COLUMNS:
        op.execute(statement)
    # env.py runs every pending migration in ONE enclosing transaction, so
    # without a reset this SET LOCAL would silently apply to any migration
    # that runs after this one in the same batch (e.g. a fresh-DB replay).
    op.execute("SET LOCAL lock_timeout = DEFAULT")
