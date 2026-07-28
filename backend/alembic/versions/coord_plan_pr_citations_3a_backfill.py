"""coord.plan_pr_citations → coord.work_unit_pr_citations residual backfill

Revision ID: coord_plan_pr_citations_3a_backfill
Revises: appid_01_co_occurrence_app_id
Create Date: 2026-07-28

Stage 3a of plan
``D:/qontinui-root/plans/2026-07-06-coord-plan-slug-to-work-unit-slug-rename.md``
("retire the legacy plan_slug path across coord").

``coord.plan_pr_citations`` (legacy, keyed by ``plan_slug`` TEXT with a SOFT FK
posture — see ``coord_plan_pr_citations``) is being retired in favor of the
already-live ``coord.work_unit_pr_citations`` (keyed by ``work_unit_id`` UUID,
hard FK → ``coord.work_units(id)`` ON DELETE CASCADE — see
``coord_workunits_04_work_unit_pr_citations``). coord dual-writes both tables
today, so most citation edges already exist in the successor; this revision
folds the RESIDUAL legacy rows (written before dual-write, or on paths that
only wrote the legacy table) into the successor:

* ``INSERT INTO coord.work_unit_pr_citations
  (tenant_id, work_unit_id, repo, pr_number, commit_sha, source, cited_at)
  SELECT ... FROM coord.plan_pr_citations c
  JOIN coord.work_units wu ON wu.slug = c.plan_slug``.
* The join key is safe standalone: ``idx_work_units_slug`` enforces GLOBAL slug
  uniqueness (deliberately cross-tenant — the Phase-2 409 guard relies on it),
  so a slug resolves to at most one work unit. ``tenant_id`` is a nullable,
  unconstrained "plain fact" on BOTH tables, so it is not part of the join key;
  as a belt-and-braces guard the join still EXCLUDES the anomalous case where
  both sides carry a non-NULL tenant and they disagree (such a row would be
  cross-tenant data drift, not a citation to fold). Excluded-mismatch rows are
  counted and reported, not silently dropped.
* ``ON CONFLICT DO NOTHING`` — rows coord already dual-wrote dedupe against
  ``uq_work_unit_pr_citations_dedupe``
  (``UNIQUE NULLS NOT DISTINCT (work_unit_id, repo, pr_number, commit_sha)``),
  making this INSERT idempotent and re-runnable. The bare (arbiter-less) form
  is deliberate: it also covers the PK, and the legacy table's own dedupe key
  (``uq_plan_pr_citations_dedupe``) plus the 1:1 slug join guarantee the
  SELECT itself produces no intra-statement duplicates.
* ``source`` is stamped ``'legacy_backfill'`` — a value outside the organic
  vocabulary (``'pr_body'`` | ``'commit_message'`` | ``'mcp_declare_intent'``)
  — so backfilled rows stay identifiable and the downgrade can target exactly
  them. The original per-row source is NOT lost: it remains readable in the
  legacy table until Stage 3c drops it. ``cited_at`` is copied verbatim
  (original record time, not ``now()``); ``tenant_id`` is copied verbatim from
  the legacy row (faithful fold — no tenant enrichment from ``work_units``).

Orphans (accepted data loss)
============================

Legacy rows whose ``plan_slug`` matches NO ``coord.work_units.slug`` cannot be
folded — the successor's hard FK requires an existing work unit. Per the plan,
orphaned citations are ACCEPTED data loss: they are counted and surfaced in the
migration log (house style: ``logging.getLogger("alembic.runtime.migration")``,
see ``commitlockfix_01_strip_lock_branches``) but do NOT fail the migration.
They also remain physically present in ``coord.plan_pr_citations`` until Stage
3c, so the report is a heads-up, not a last chance.

Staging
=======

* **Stage 3a (THIS revision):** fold residual legacy rows into the successor.
  The legacy table is NOT dropped here.
* **Stage 3b:** coord's code stops referencing ``coord.plan_pr_citations``.
* **Stage 3c:** a later contract migration drops the legacy table — only safe
  after 3b, since the deployed coord image still dual-writes it today.

Lock posture
============

Pure DML — one ``INSERT ... SELECT`` plus read-only counts, no DDL, in the one
migration transaction. No ACCESS EXCLUSIVE is taken and no ``lock_timeout`` is
needed; the INSERT takes ordinary row locks only and never blocks readers.

Downgrade
=========

Targeted ``DELETE ... WHERE source = 'legacy_backfill'`` — removes exactly the
rows this revision minted (organic writers never use that source value) and
cannot touch organically dual-written citations.

Authorship posture
==================

**alembic is the SOLE author of the coord.* schema** — and this revision
authors no schema at all, only data. The coord crate only SELECTs / INSERTs
against both tables.
"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_plan_pr_citations_3a_backfill"
down_revision: str | Sequence[str] | None = "appid_01_co_occurrence_app_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    """Fold residual legacy plan-citation rows into the work-unit successor."""
    bind = op.get_bind()

    total = (
        bind.execute(
            sa.text("SELECT count(*) FROM coord.plan_pr_citations")
        ).scalar()
        or 0
    )

    inserted = bind.execute(
        sa.text(
            """
            INSERT INTO coord.work_unit_pr_citations
                (tenant_id, work_unit_id, repo, pr_number, commit_sha,
                 source, cited_at)
            SELECT c.tenant_id, wu.id, c.repo, c.pr_number, c.commit_sha,
                   'legacy_backfill', c.cited_at
            FROM coord.plan_pr_citations c
            JOIN coord.work_units wu ON wu.slug = c.plan_slug
            WHERE (c.tenant_id IS NULL
                   OR wu.tenant_id IS NULL
                   OR c.tenant_id = wu.tenant_id)
            ON CONFLICT DO NOTHING
            """
        )
    ).rowcount

    # Orphans: legacy citations whose plan_slug matches no work unit. Accepted
    # data loss per the Stage 3a plan — report, don't fail. The rows survive in
    # coord.plan_pr_citations until the Stage 3c drop.
    orphans = (
        bind.execute(
            sa.text(
                """
                SELECT count(*) FROM coord.plan_pr_citations c
                WHERE NOT EXISTS (
                    SELECT 1 FROM coord.work_units wu
                    WHERE wu.slug = c.plan_slug
                )
                """
            )
        ).scalar()
        or 0
    )

    # Anomalous cross-tenant drift: slug matched but both sides carry a
    # non-NULL tenant that disagrees. Excluded from the fold by the WHERE
    # guard above; surfaced here so the exclusion is never silent.
    tenant_mismatch = (
        bind.execute(
            sa.text(
                """
                SELECT count(*) FROM coord.plan_pr_citations c
                JOIN coord.work_units wu ON wu.slug = c.plan_slug
                WHERE c.tenant_id IS NOT NULL
                  AND wu.tenant_id IS NOT NULL
                  AND c.tenant_id <> wu.tenant_id
                """
            )
        ).scalar()
        or 0
    )

    logger.info(
        "plan_pr_citations 3a backfill: %d legacy row(s) total; %d inserted "
        "into coord.work_unit_pr_citations (source='legacy_backfill'; "
        "already-dual-written rows deduped via ON CONFLICT DO NOTHING); "
        "%d orphan row(s) with no matching coord.work_units slug "
        "(accepted data loss per plan — retained in the legacy table until "
        "Stage 3c); %d tenant-mismatch row(s) excluded as cross-tenant drift",
        total,
        inserted,
        orphans,
        tenant_mismatch,
    )


def downgrade() -> None:
    """Delete exactly the rows this backfill minted (source stamp is unique)."""
    bind = op.get_bind()
    deleted = bind.execute(
        sa.text(
            "DELETE FROM coord.work_unit_pr_citations "
            "WHERE source = 'legacy_backfill'"
        )
    ).rowcount
    logger.info(
        "plan_pr_citations 3a backfill downgrade: deleted %d "
        "'legacy_backfill' row(s) from coord.work_unit_pr_citations",
        deleted,
    )
