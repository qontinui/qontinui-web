"""design_refs: the holdout split is assigned at intake, not at confirmation

Revision ID: design_refs_split_intake_01
Revises: contproof_01_gates_continuation_start_proof
Create Date: 2026-11-20

Phase 1 of plan
``2026-11-19-the-reference-library-shows-agents-nothing-until-the-operator-confirms-a-site``
(qontinui-dev-notes/plans). The operator's answer to coord question
``a8dc00a6-7a50-481e-a039-23a5dbfbdcae``: the split is assigned by a hash of
the domain at intake, so ``design_refs.site.split`` is never NULL.

Hand-authored — never ``alembic revision --autogenerate`` (served policy
``production-and-cost`` ``alembic-sole-authorship``). No ``coord.*`` relation
is touched.

Upgrade
=======
1. Drop ``ck_site_split_after_confirmation`` (``split IS NULL OR
   context_state = 'confirmed'``), which forbids an intake assignment.
2. Backfill every row whose ``split`` is NULL: the split of a same
   ``(tenant_id, domain)`` row that has one, else ``holdout`` when the frozen
   copy of ``domain_bucket`` below is 0, else ``reference``;
   ``split_assigned_at = now()``. A row with a split but no timestamp gets
   ``COALESCE(context_confirmed_at, now())``. ``trg_site_split_immutable``
   allows NULL -> value, so it needs no change.
3. ``split`` and ``split_assigned_at`` become NOT NULL.

Downgrade
=========
Drops both NOT NULLs, clears the split of every still-``proposed`` site (with
the immutability trigger disabled for that one statement), and re-adds the
CHECK. The intake splits of unconfirmed sites are discarded; re-upgrading
reproduces them, because the hash is deterministic. Correct with zero rows or
many.

Deploy order
============
The ``NOT NULL`` lands with the new code. Code predating this revision creates
a site with a NULL ``split`` (it assigned one at first confirmation), so it
would fail its ``POST /sites`` against the migrated schema. Migrate and deploy
together; do not leave the old application running against the new schema.

``down_revision`` is this repo's single alembic head at authoring time; if
another revision lands first, re-point it at the new head. Do NOT author an
``alembic merge`` revision.
"""

import hashlib
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "design_refs_split_intake_01"
down_revision: str | Sequence[str] | None = (
    "contproof_01_gates_continuation_start_proof"
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Frozen copy of ``app.services.design_refs.HOLDOUT_BUCKETS``.
_HOLDOUT_BUCKETS = 5


def _domain_bucket(domain: str) -> int:
    """Frozen copy of ``app.services.design_refs.domain_bucket``. Stored
    domains are already normalised, so no normalisation is repeated here."""
    digest = hashlib.sha256(domain.encode()).digest()
    return int.from_bytes(digest[:8], "big") % _HOLDOUT_BUCKETS


def upgrade() -> None:
    op.execute(
        "ALTER TABLE design_refs.site DROP CONSTRAINT IF EXISTS "
        "ck_site_split_after_confirmation"
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            """
            SELECT s.id,
                   s.domain,
                   (SELECT o.split
                      FROM design_refs.site o
                     WHERE o.tenant_id = s.tenant_id
                       AND o.domain = s.domain
                       AND o.id <> s.id
                       AND o.split IS NOT NULL
                     LIMIT 1) AS sibling_split
              FROM design_refs.site s
             WHERE s.split IS NULL
            """
        )
    ).all()
    update = sa.text(
        "UPDATE design_refs.site SET split = :split, split_assigned_at = now() "
        "WHERE id = :id AND split IS NULL"
    )
    for site_id, domain, sibling_split in rows:
        if sibling_split is not None:
            split = sibling_split
        else:
            split = "holdout" if _domain_bucket(domain) == 0 else "reference"
        bind.execute(update, {"id": site_id, "split": split})
    # A pair of unsplit siblings (both tiers of one domain) now agree: both
    # took the hash, because neither had a split to inherit.
    # A row that already carried a split but no timestamp (written by a bare
    # UPDATE rather than by ``assign_split``) gets one, so NOT NULL can hold.
    op.execute(
        "UPDATE design_refs.site "
        "SET split_assigned_at = COALESCE(context_confirmed_at, now()) "
        "WHERE split IS NOT NULL AND split_assigned_at IS NULL"
    )
    op.execute("ALTER TABLE design_refs.site ALTER COLUMN split SET NOT NULL")
    op.execute(
        "ALTER TABLE design_refs.site ALTER COLUMN split_assigned_at SET NOT NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE design_refs.site ALTER COLUMN split DROP NOT NULL")
    op.execute(
        "ALTER TABLE design_refs.site ALTER COLUMN split_assigned_at DROP NOT NULL"
    )
    op.execute("ALTER TABLE design_refs.site DISABLE TRIGGER trg_site_split_immutable")
    op.execute(
        "UPDATE design_refs.site SET split = NULL, split_assigned_at = NULL "
        "WHERE context_state = 'proposed'"
    )
    op.execute("ALTER TABLE design_refs.site ENABLE TRIGGER trg_site_split_immutable")
    op.execute(
        "ALTER TABLE design_refs.site ADD CONSTRAINT "
        "ck_site_split_after_confirmation "
        "CHECK (split IS NULL OR context_state = 'confirmed')"
    )
