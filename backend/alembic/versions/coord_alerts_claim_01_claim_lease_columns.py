"""coord.alerts: claim-lease columns and the expiring-lease partial index.

Phase 2 item 1 of plan
``qontinui-dev-notes/plans/2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work.md``.
Additive, nullable, no backfill.

What this adds
==========================================================================

Three nullable columns on ``coord.alerts`` that let an agent CLAIM an open
alert for a bounded lease before acting on it:

* ``claimed_by TEXT``              — the claimant (an agent session identity).
* ``claimed_at TIMESTAMPTZ``       — when the current lease was taken.
* ``claim_expires_at TIMESTAMPTZ`` — when the lease lapses.

And one partial index::

    CREATE INDEX CONCURRENTLY idx_alerts_claim_expiry
    ON coord.alerts (claim_expires_at)
    WHERE resolved_at IS NULL AND claimed_by IS NOT NULL

Every existing row takes NULL for all three columns, which is exactly
"unclaimed" — so no backfill is needed or wanted. The plan measured 27,604
open alerts, none resolved and none with any owner; they are the queue's
initial unclaimed population.

Why a lease rather than an owner
==========================================================================

The plan (Phase 2, ``POST /coord/alerts/:id/claim``) makes the claim a LEASE:
default TTL 2 h, max 8 h, and **an expired lease reads as unclaimed** because
the queue's predicate compares ``claim_expires_at`` to ``now()``. No sweeper
clears stale claims; a crashed claimant simply stops holding the alert when its
lease lapses. Claiming never resolves an alert — resolution stays with coord's
re-observation of the condition.

Nothing reads these columns until coord's queue/claim routes land, and those
land AFTER this revision is at head (served policy ``production-and-cost``
``alembic-sole-authorship``: the migration precedes the column read). The coord
PR that first reads them bumps ``MIGRATOR_DIGEST`` in coord's ``ci.yml`` so its
``schema_read_contract`` gate migrates to a head that carries them.

The index, and why its key is ``claim_expires_at``
==========================================================================

The partial predicate selects exactly the rows that hold a lease on a LIVE
alert — at any moment a handful, against a table the pagedidx_01 revision
measured at 1121 MB / 1.47 M rows. The key serves the two reads that care
about lease timing:

* **"Which leases are live?"** — ``claim_expires_at > now()`` is a range scan
  on the key, which is how the queue separates claimed from lapsed rows.
* **"Oldest-expiring / lapsed leases"** — ordered by the key.

Only the non-NULL-claimant open rows are indexed, so the index stays tiny as
the table grows and adds no maintenance cost on the alert-upsert write path
for the overwhelming majority of rows (unclaimed alerts are not in it at all).
A read rides it only if its WHERE clause states both conjuncts of the partial
predicate (``resolved_at IS NULL AND claimed_by IS NOT NULL``); conjunct order
is irrelevant to the planner.

Locking: ADD COLUMN in the transaction, the index outside it
==========================================================================

``ADD COLUMN ... NULL`` with no default is a catalog-only change in Postgres —
no table rewrite — but it still takes a brief ACCESS EXCLUSIVE lock, and a
QUEUED ACCESS EXCLUSIVE request blocks every reader and writer arriving behind
it. ``coord.alerts`` is written continuously, so the ALTER bounds its wait with
``SET LOCAL lock_timeout = '3s'`` (same convention as
``coord_agent_questions_audience``): failing fast is a retry, stalling is an
outage. ``RESET lock_timeout`` afterwards is REQUIRED — ``env.py`` runs every
revision of one ``alembic upgrade`` in a single transaction, so an unreset
``SET LOCAL`` would leak into every later revision.

The index is built ``CONCURRENTLY`` (a plain ``CREATE INDEX`` takes a
write-blocking ``SHARE`` lock for the duration of a scan over the whole table).
``CONCURRENTLY`` cannot run inside a transaction, hence
``op.get_context().autocommit_block()`` — the ``coord_alerts_pagedidx_01``
precedent. The ALTER runs first so the autocommit block's implicit COMMIT
publishes the columns before the index build needs them.

A killed or failed CONCURRENTLY build leaves an **INVALID** index of the same
name, which the planner never uses and which ``IF NOT EXISTS`` alone would keep
— a migration reporting success while the index never serves a query. So
before the CREATE, the upgrade looks the index up in ``pg_index`` and, if it
exists with ``indisvalid = false``, drops it (CONCURRENTLY) so the CREATE
rebuilds it. A re-run ends with a valid index or a loud failure.

Downgrade drops the index (CONCURRENTLY) and then the three columns. Any lease
state is lost, which is the correct reversal of an additive revision; the
alerts themselves survive.

Revision ID: coord_alerts_claim_01
Revises: coord_overlap_detections
Create Date: 2026-09-18

"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "coord_alerts_claim_01"
down_revision: str | Sequence[str] | None = "coord_overlap_detections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _index_is_invalid(index_name: str) -> bool:
    """True when ``coord.<index_name>`` exists and is INVALID (a failed build)."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT NOT i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        )
        .scalar()
    )


def upgrade() -> None:
    """Add the three lease columns, then the CONCURRENT partial index. Idempotent."""
    # Bound the ALTER's ACCESS EXCLUSIVE wait: coord.alerts is under a
    # continuous writer, and a queued exclusive lock blocks everyone behind it.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.alerts
            ADD COLUMN IF NOT EXISTS claimed_by       TEXT,
            ADD COLUMN IF NOT EXISTS claimed_at       TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this reset the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("RESET lock_timeout")

    with op.get_context().autocommit_block():
        # A failed earlier CONCURRENTLY build leaves an INVALID index that
        # IF NOT EXISTS would keep. Drop it so the CREATE below rebuilds it.
        if _index_is_invalid("idx_alerts_claim_expiry"):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_alerts_claim_expiry"
            )
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook parses the raw SQL inside `op.execute(...)` to prove
        # every CREATE/DROP names its schema, and an interpolated string is not
        # statically analysable.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_alerts_claim_expiry
            ON coord.alerts (claim_expires_at)
            WHERE resolved_at IS NULL AND claimed_by IS NOT NULL
            """
        )


def downgrade() -> None:
    """Drop the index, then the three lease columns. The alerts survive."""
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS coord.idx_alerts_claim_expiry")

    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.alerts
            DROP COLUMN IF EXISTS claim_expires_at,
            DROP COLUMN IF EXISTS claimed_at,
            DROP COLUMN IF EXISTS claimed_by
        """
    )
    op.execute("RESET lock_timeout")
