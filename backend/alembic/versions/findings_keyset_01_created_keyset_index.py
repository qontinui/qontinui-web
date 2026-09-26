"""coord.findings — two indexes for the ``recent()`` findings page read

Revision ID: findings_keyset_01
Revises: coord_iops_idx_01
Create Date: 2026-09-26

Phase 0 of plan
``2026-09-05-findings-recent-is-a-window-that-reads-as-a-corpus``. Adds two
indexes to ``coord.findings``, one for each half of the page read::

    idx_findings_created_keyset ON coord.findings (created_at DESC, finding_id DESC)
    idx_findings_supersedes     ON coord.findings (supersedes) WHERE supersedes IS NOT NULL

The first serves the keyset walk (the outer, ordered side). The second serves
the supersede anti-join every page runs (its inner side) — see "The anti-join"
below.

## The consumer

coord ``crates/coord/src/findings.rs`` ``recent()`` — the shared reader behind
``GET /coord/agent-findings``, ``GET /coord/findings`` and the
``coord_recent_findings`` MCP tool. That plan turns its fixed-size window into
a keyset-paged read: ``ORDER BY f.created_at DESC, f.finding_id DESC`` with the
cursor predicate ``(f.created_at, f.finding_id) < ($ts, $id)`` and a
``LIMIT limit + 1`` probe for an exact ``truncated`` flag. This index is keyed
on exactly that sort key, so the planner can walk it in keyset order, start at
the cursor, and stop after ``limit + 1`` qualifying rows instead of sorting the
whole match set. Before this revision nothing served ``ORDER BY created_at``
on the unfiltered read: ``idx_findings_tenant_recent`` is ``(tenant_id,
expires_at)`` and ``idx_findings_untriaged`` is partial on ``triaged_at IS
NULL``.

## The anti-join — why ``idx_findings_supersedes``

Every ``recent()`` page — first page, cursor page, every filter arm — carries

    AND NOT EXISTS (SELECT 1 FROM coord.findings s WHERE s.supersedes = f.finding_id)

so only the live head of a correction chain is served. Before this revision
nothing indexed ``supersedes``, so the planner's order-preserving plan (a
Nested Loop Anti Join over the keyset walk) had to SCAN the whole table on its
inner side once per outer row — cost growing with table size times rows
walked. Its alternative, a Hash Anti Join, destroys the keyset order and puts
back the unbounded Sort the keyset index removes. With this index the inner
side is one index probe per outer row, so the ordered plan stays cheap as the
table grows.

It is PARTIAL on ``supersedes IS NOT NULL`` because the probe is always an
equality against a non-null ``finding_id``, which can never match a NULL, and
almost every row is not a correction — so the index holds only the handful of
correction rows and costs next to nothing to maintain.

## Why the keyset index is NOT tenant-leading

``recent()``'s tenant predicate is ``(f.tenant_id = $1 OR f.scope =
'fleet-infra')`` — an OR whose second arm is tenant-independent. A
``(tenant_id, created_at, finding_id)`` btree cannot produce that union in
``created_at`` order: the planner would bitmap-OR the two arms and then SORT
the entire match set, which is the unbounded sort this index exists to remove.
An index on the sort key alone serves both arms as a Filter over an ordered
walk. Its cost is stepping over interleaved rows of other tenants — a constant
factor with a handful of tenants. The behaviour test pins the choice (an Index
Scan on this index and no Sort node) rather than asserting it.

## Not ordered against the coord change

An index changes the plan the planner picks, never the result set: the row
comparison returns identical rows with or without it. So this revision and the
coord paging change may land in either order. The ``alembic-sole-authorship``
FIRST rule governs a coord read of new ``coord.*`` *columns*; no column is
added here.

## House conventions followed

alembic is the SOLE author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``); this revision is
hand-authored, never ``--autogenerate``d.

Each index is built ``CONCURRENTLY`` inside its own ``autocommit_block()``, the shape
``findings_triage_01_triage_stamp`` set for this table: a plain ``CREATE
INDEX`` holds a SHARE lock on ``coord.findings`` for the whole build and blocks
every coord finding write meanwhile, on a table peer sessions write
continuously. There is no ALTER, so there is no ``SET LOCAL lock_timeout``
guard to set — and so none to restore (the rule qontinui-web#1457 gates).
``IF NOT EXISTS`` / ``IF EXISTS`` keep both directions idempotent. Every
statement names the ``coord`` schema explicitly (the ``forbid-public-schema``
check). The behaviour test
``tests/test_findings_keyset_01_created_keyset_index_migration.py`` pins the
keyset index's key order and direction, the supersedes index's partial
predicate, both indexes' validity (a killed CONCURRENTLY build leaves an
INVALID index that ``IF NOT EXISTS`` would then skip forever), and that coord's
production-shape page read rides the keyset index with no Sort node and probes
the supersedes index on the anti-join's inner side (no Seq Scan there), while
at the parent revision it sorts.

Touches **only** ``coord.findings`` (created by revision ``coord_findings``
earlier in this chain). It is NOT added to any ``ALEMBIC_OWNED_TABLES`` list —
the table already exists.

``down_revision`` chains off the LIVE alembic head at authoring time
(``coord_iops_idx_01`` on ``37c2ce247``, computed as the one revision
no ``down_revision`` names across all 600 revision files) — NOT off the buried
``coord_findings`` or ``findings_triage_01``, both of which have children.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "findings_keyset_01"
down_revision: str | Sequence[str] | None = "coord_iops_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_CREATE_KEYSET_INDEX = """
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_created_keyset
    ON coord.findings (created_at DESC, finding_id DESC)
"""

_CREATE_SUPERSEDES_INDEX = """
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_supersedes
    ON coord.findings (supersedes)
    WHERE supersedes IS NOT NULL
"""

_DROP_SUPERSEDES_INDEX = (
    "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_findings_supersedes"
)

_DROP_KEYSET_INDEX = (
    "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_findings_created_keyset"
)


def upgrade() -> None:
    """Additive: the keyset index and the supersedes index. Idempotent."""
    # CONCURRENTLY cannot run inside a transaction; one block per index so a
    # failure in the second leaves the first committed and re-runnable.
    with op.get_context().autocommit_block():
        op.execute(_CREATE_KEYSET_INDEX)
    with op.get_context().autocommit_block():
        op.execute(_CREATE_SUPERSEDES_INDEX)


def downgrade() -> None:
    """Reverse exactly this revision: drop both indexes, in reverse order."""
    with op.get_context().autocommit_block():
        op.execute(_DROP_SUPERSEDES_INDEX)
    with op.get_context().autocommit_block():
        op.execute(_DROP_KEYSET_INDEX)
