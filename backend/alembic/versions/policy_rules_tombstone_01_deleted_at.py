"""coord policy_rules — deleted_at tombstone, so "turned off" and "deleted" stop being one write

Revision ID: policy_rules_tombstone_01
Revises: require_review_cols_01
Create Date: 2026-09-05

Plan 2026-08-28-coord-policy-rules-has-no-tombstone-so-disable-and-delete-are-one-write
(phase P0). This revision lands the COLUMN ONLY. coord must not read it until
this migration is deployed AND coord's ``MIGRATOR_DIGEST`` has been bumped to an
image carrying this revision — served policy ``production-and-cost``
``alembic-sole-authorship``: "land the companion qontinui-web alembic migration
FIRST, then the read ... the read waits, it does not ship ahead."

Why
---
``DELETE /coord/policies/:id`` is a SOFT delete. Its entire mutation
(``crates/coord/src/policies/routes.rs``, ``delete_soft``) is::

    UPDATE coord.policy_rules
       SET enabled = false, updated_at = now(), updated_by = $2
     WHERE policy_id = $1

``coord.policy_rules`` carries no tombstone column, so ``enabled = false`` means
BOTH "an operator turned this rule off" and "an operator deleted this rule",
indistinguishably — ``updated_at`` / ``updated_by`` are stamped identically by
both paths. ``get_list`` then applies ``q.enabled.unwrap_or(true)``, so the row
leaves the console's view on the next reload either way.

One bit is carrying two facts, and every consumer downstream sees only the bit.
The column is the only place they can be separated.

What this has already cost
--------------------------
* qontinui-web#1040 found ``/admin/coord/automation-rules`` rendering an
  enable/disable SWITCH whose OFF position PATCHed ``enabled: false`` — the same
  column and value as the DELETE. It shipped as a confirmation that names the
  delete, because a reversible disable did not exist to offer.
* qontinui-web#1058 deleted ``enabled`` from both PATCH body types
  (``PolicyUpdate``, ``GateClearanceUpdate``) so the destructive write became
  unrepresentable, and left the ON branch INERT: turning a disabled rule back on
  is a request the product cannot honestly answer.
* The obvious repair — "list the disabled arm too" — was written and REVERTED in
  #1040's own review, because listing ``enabled = false`` would resurrect every
  rule any tenant has ever deleted and offer to switch it back on. On
  ``/admin/coord/gate-clearance`` that means offering to re-arm a deleted
  clearance-AUTHORITY rule.

Shape
-----
``deleted_at TIMESTAMPTZ NULL``. NULL = live (turned on or merely turned off);
non-NULL = deleted, and records WHEN. Chosen over a ``deleted`` boolean because
the timestamp is strictly more information at identical cost, and over a hard
DELETE because the soft delete was presumably chosen to keep recoverability and
audit history.

``expires_at`` is NOT a substitute and must not be repurposed: it is a
tenant-authored policy LIFETIME with its own ``expire_when`` semantics, and
overloading it would recreate this exact defect one column over.

NULLABLE WITH NO DEFAULT is load-bearing. A ``NOT NULL DEFAULT now()`` would
tombstone every existing row; a non-null default of any kind would make "live"
unrepresentable for rows written before coord learns the column.

Backfill: NONE, deliberately
----------------------------
Existing ``enabled = false`` rows are genuinely ambiguous — each is either a
disable or a delete and the database cannot tell which. Guessing either way is
worse than declining to: guessing "deleted" hides rules an operator turned off
on purpose, and guessing "disabled" resurrects deleted clearance-authority rules
into a console that offers to re-arm them, which is precisely the outcome
#1040's review reverted a patch to avoid.

So they stay ``deleted_at IS NULL`` (live-but-off) and remain excluded from the
default listing by the pre-existing ``enabled`` filter until an operator acts on
them. This is a CHOICE, not a forgotten backfill — a future reader who "fixes"
it by backfilling will reintroduce the defect this revision exists to close.

Indexes: NONE, deliberately
---------------------------
The plan left a partial index on ``(tenant_id) WHERE deleted_at IS NULL``
conditional on the read-path sweep warranting it. It does not:

* All three existing indexes on the table — ``idx_policy_rules_tenant_active``
  ``(tenant_id, enabled, kind)``, ``idx_policy_rules_tenant_repo``
  ``(tenant_id, repo)`` and ``idx_policy_rules_tenant_domain``
  ``(tenant_id, decision_domain, enabled)`` — are already PARTIAL on
  ``WHERE enabled = true``. Because coord's ``delete_soft`` keeps writing
  ``enabled = false`` alongside the new ``deleted_at`` (phase P1 sets both), a
  tombstoned row is already outside every one of them.
* A ``(tenant_id) WHERE deleted_at IS NULL`` index would repeat the leading
  column of all three and add no selectivity the hot paths do not already have.
* The one genuinely new read the plan enables — listing ``?enabled=false``
  (phase P2) — returns a single tenant's turned-off rules, a handful of rows.

Add an index when a measured plan asks for one, not pre-emptively.

Reversibility
-------------
``downgrade()`` drops the column. That DISCARDS the disable/delete distinction
for every row that carries one — which is correct for a downgrade (the column
did not exist) but is data loss, so it is stated rather than left to be
discovered.

Idempotency: the add is guarded by an inspector check, so re-running against an
already-migrated database is a no-op.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "policy_rules_tombstone_01"
down_revision: str = "require_review_cols_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    """True if ``coord.<table>`` already has ``column``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns(table, schema="coord")}
    return column in cols


def upgrade() -> None:
    """Add ``coord.policy_rules.deleted_at`` (nullable TIMESTAMPTZ, no default)."""
    if not _has_column("policy_rules", "deleted_at"):
        op.add_column(
            "policy_rules",
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            schema="coord",
        )


def downgrade() -> None:
    """Drop the tombstone column.

    Discards the disable-vs-delete distinction for every row carrying one.
    """
    if _has_column("policy_rules", "deleted_at"):
        op.drop_column("policy_rules", "deleted_at", schema="coord")
