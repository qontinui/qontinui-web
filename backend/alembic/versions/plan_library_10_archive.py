"""agent.work_artifacts — soft-delete (archive) columns

Revision ID: plan_library_10_archive
Revises: overlord_01_interventions
Create Date: 2026-09-27

Phase 1 of ``2026-09-12-plan-library-has-no-delete-so-a-junk-row-is-permanent``.
The plan library is authoritative for reads, and until this revision it had no
eviction path at all: the upsert can re-LABEL a junk row (a void probe, a
mis-keyed duplicate) but nothing can REMOVE it, so every reader keeps returning
it and every count keeps including it.

Columns (all nullable, no default — every existing row is live):

* ``archived_at TIMESTAMPTZ`` — when the row was archived. ``NULL`` means live,
  and it is the ONE predicate every default read composes
  (``crud.work_artifact.live_artifacts_clause``).
* ``archived_by TEXT`` — the actor stamp of whoever archived it (the same
  ``email or user id`` stamp version and edge rows carry).
* ``archive_reason TEXT`` — the caller's stated cause. The route refuses a
  blank one; the column is nullable only because a live row has none.

**Soft, never a DROP.** ``DELETE /plan-library/{id}`` sets these three and
nothing else. The row and its version log survive, because the export routes
address ``?version_number=N`` and a hard delete would silently break a
citation. An upsert onto an archived identity clears all three again.

The partial index
=================

``ix_work_artifacts_live_kind_status`` is ``(kind, status) WHERE archived_at
IS NULL`` — the shape of the default list/candidate/reconciliation reads, which
all filter on ``kind`` (usually ``'plan'``) and now also on ``archived_at IS
NULL``. It is built ``CONCURRENTLY`` inside ``autocommit_block()`` (the
``coord_alerts_pagedidx_01`` precedent): a plain ``CREATE INDEX`` takes a
write-blocking lock, and coord's merge-train migration classifier rejects it.

No ``indisvalid`` check is made, and nothing in ``upgrade()`` drops an index:
coord's migration classifier rejects SQL run through ``op.get_bind()`` and a
``DROP INDEX`` anywhere outside ``downgrade()`` (the posture
``plan_library_09_scan_root_refusals`` and ``twin_10`` settled on). The cost is
one documented limit: a CONCURRENTLY build that fails after the columns commit
(a lock or statement timeout, a cancel) leaves an INVALID index that a re-run's
``IF NOT EXISTS`` skips. Postgres never plans a read with an invalid index, so
reads stay correct and only lose the speed-up, while writes still maintain it
(every INSERT/UPDATE pays its upkeep). Recovery is manual:
``DROP INDEX CONCURRENTLY agent.ix_work_artifacts_live_kind_status`` and re-run.

The ``ALTER``s run under ``SET LOCAL lock_timeout = '3s'`` (reset afterwards,
because ``env.py`` runs every revision of one upgrade in a single transaction):
``ADD COLUMN`` takes an ``ACCESS EXCLUSIVE`` lock, and queueing behind a long
reader would stall every plan-library read behind it.

Downgrade drops the index and the three columns. The only thing lost is WHICH
rows were archived — they all read as live again, which is the pre-revision
behaviour.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_10_archive"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "overlord_01_interventions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the three nullable archive columns, then the live-row partial index.

    One PLAIN string literal per call — no f-string — because coord's
    migration classifier rejects dynamic SQL, and the ``alembic-schema-arg-gate``
    pre-commit hook parses each CREATE/DROP for its schema.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE agent.work_artifacts "
        "ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE agent.work_artifacts ADD COLUMN IF NOT EXISTS archived_by TEXT"
    )
    op.execute(
        "ALTER TABLE agent.work_artifacts ADD COLUMN IF NOT EXISTS archive_reason TEXT"
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")

    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_work_artifacts_live_kind_status
            ON agent.work_artifacts (kind, status)
            WHERE archived_at IS NULL
            """
        )


def downgrade() -> None:
    """Drop the index, then the columns. Every row reads as live again."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS agent.ix_work_artifacts_live_kind_status"
        )
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("ALTER TABLE agent.work_artifacts DROP COLUMN IF EXISTS archive_reason")
    op.execute("ALTER TABLE agent.work_artifacts DROP COLUMN IF EXISTS archived_by")
    op.execute("ALTER TABLE agent.work_artifacts DROP COLUMN IF EXISTS archived_at")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
