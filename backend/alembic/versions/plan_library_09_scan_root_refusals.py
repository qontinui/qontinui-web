"""agent.plan_scan_root_refusals — each device's refused scan-source reports

Revision ID: plan_library_09_scan_root_refusals
Revises: gates_clear_independence_01
Create Date: 2026-09-28

Phase 1 of ``2026-09-11-scan-root-readings-hide-refused-contact-and-never-prune``.

The gap
=======

``POST /plan-library/scan-roots`` refuses a report it cannot store (a runner
clock more than 300 s ahead, an unknown key, a field bound) with a 422, and a
422 wrote nothing. So a device whose EVERY report was refused aged to
``observation_stale`` 45 minutes later — exactly what a switched-off device
looks like. The device was alive and trying; the store could not say so.

What this revision does
=======================

Creates ``agent.plan_scan_root_refusals``: one row per
``(organization, device)`` counting that device's refused reports —
``first_refused_at``, ``last_refused_at``, ``last_refused_reason`` (a compact
``"<loc>: <type>"``, bounded to 512 chars and never an input value) and
``refused_count``. The write route now validates in its handler and upserts this
row before answering the 422, and the read verdict renders a device refused
within the freshness window as ``refused:``.

* **A separate table, not columns on the observations.** A device refused on
  its first-ever report has no reading, and the observation row's NOT NULL
  reading columns would force a fabricated placeholder whose server-clock
  ``observed_at`` would then decline the device's first genuine report as out
  of order. Here "a refusal never overwrites a good reading" holds by
  construction.
* **The identity index is the observations' own NULL-collapsing one** —
  ``(coalesce(organization_id, nil), device_id)`` — and is the upsert's
  ``ON CONFLICT`` target (``app.models.plan_scan_root.IDENTITY_ORG_SQL``).
* Nothing deletes a row. Retirement (Phase 2) is a read-side filter.

Revision id: NOT ``plan_library_08_*`` — open peer PR qontinui-web#1545 claims
``plan_library_08_archive``, and a distinct id keeps the two independently
landable (whichever lands second re-points its ``down_revision``).

Downgrade
=========

Drops the table. What is lost is a diagnostic: the next refused report of each
device recreates its row, with its count restarting at 1.

Idempotency: every statement uses ``IF NOT EXISTS`` / ``IF EXISTS``. One
limit: the identity index is built ``CONCURRENTLY`` outside the migration
transaction, so a build that fails after the table commits (a lock or
statement timeout, a cancel) can leave an INVALID index that a re-run's
``IF NOT EXISTS`` then skips. Postgres ignores an invalid index as an
``ON CONFLICT`` target, so the refusal upsert would fail. Recovery:
``DROP INDEX CONCURRENTLY agent.uq_plan_scan_root_refusals_identity`` and
re-run. No ``indisvalid`` check is made here because coord's migration
classifier rejects ``op.get_bind()``; the table is new and empty, so the
build has nothing to wait on but other sessions' open transactions.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_09_scan_root_refusals"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "gates_clear_independence_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the per-device refused-report store."""
    op.execute("CREATE SCHEMA IF NOT EXISTS agent")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent.plan_scan_root_refusals (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            -- Derived from the reporting principal; NULL is the NULL bucket.
            organization_id     UUID,
            -- The verified device token's device_id claim. No FK: coord's.
            device_id           UUID NOT NULL,
            -- This server's clock, at the first and the latest refusal.
            first_refused_at    TIMESTAMPTZ NOT NULL,
            last_refused_at     TIMESTAMPTZ NOT NULL,
            -- "<loc>: <type>" (+N more); never an input value.
            last_refused_reason TEXT NOT NULL
                CONSTRAINT ck_plan_scan_root_refusals_reason_length
                CHECK (char_length(last_refused_reason) <= 512),
            refused_count       BIGINT NOT NULL DEFAULT 1
                CONSTRAINT ck_plan_scan_root_refusals_count_positive
                CHECK (refused_count >= 1),
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # The nil UUID is the sentinel the functional unique index folds a NULL
    # organization onto; it must equal
    # ``app.models.work_artifact.NIL_ORGANIZATION_ID``. It is written as a
    # literal, not interpolated: coord's migration classifier refuses an
    # f-string ``op.execute`` because its fields are not the SQL that runs.
    #
    # CONCURRENTLY inside an autocommit block: the table above is new and
    # empty, so a plain build would lock nothing, but coord's classifier
    # cannot see that from the statement and admits only a non-transactional
    # CONCURRENTLY build with an IF NOT EXISTS guard.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_plan_scan_root_refusals_identity
                ON agent.plan_scan_root_refusals (
                    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    device_id
                )
            """
        )


def downgrade() -> None:
    """Drop the store. The next refused report recreates each device's row."""
    op.execute("DROP INDEX IF EXISTS agent.uq_plan_scan_root_refusals_identity")
    op.execute("DROP TABLE IF EXISTS agent.plan_scan_root_refusals")
