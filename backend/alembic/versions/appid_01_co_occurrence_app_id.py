"""project.co_occurrence_observations — add app_id for multi-app namespacing

Revision ID: appid_01_co_occurrence_app_id
Revises: memory_jobs_02_kind_aware_dedupe
Create Date: 2026-07-27

Phase A7 of ``2026-07-27-state-discovery-and-ci-followups``: give
state-discovery capture data an app dimension.

The gap
=======

``co_occurrence_observations`` (created by
``consolidation_phase2_v_24_co_occurrence``) records one row per captured
UI snapshot, keyed by ``spec_id`` + ``runner_instance``. There is no app
column, so two different applications whose views slug to the same page
label share a single namespace — the runner's own ``specs`` tab and
qontinui-web's ``/specs`` route both slug to ``specs``. Today the capture
hook only ever sees the runner's own frontend so the collision is not
reachable, but ``resolve_page_label``'s docstring already anticipates
qontinui-web and the multi-app Spec API already registers three apps.
Adding the column before real multi-app capture starts is cheap; adding
it afterwards means reconciling an already-polluted namespace.

Nullable, and NOT backfilled — deliberately
===========================================

``app_id`` is **nullable and stays nullable**. Existing rows carry no app
attribution and there is no source of truth from which to derive one: the
capture path never recorded which application produced an observation,
and ``runner_instance`` identifies the *runner process*, not the app
whose UI was snapshotted. Any backfill would be a guess written into a
column that consumers must be able to trust, so historical rows keep
``NULL`` and mean exactly "app unknown". Consumers must treat ``NULL`` as
un-attributed rather than as a sentinel for any particular app.

Index decision
==============

The existing ``idx_observations_spec`` is ``(spec_id, captured_at) WHERE
invalidated_at IS NULL``. Rather than adding a second index, this
migration **widens it in place** to ``(spec_id, app_id, captured_at)``
with the same partial predicate:

* The future runner query shape is ``(app_id, spec_id)`` equality; both
  columns sit in the composite's equality prefix, so the widened index
  serves it directly.
* ``spec_id`` stays the leading column, so every existing ``spec_id``-only
  lookup keeps full index support (leading ``app_id`` would have broken
  those and forced us to keep two indexes).
* Index *count* is unchanged, so per-row write amplification does not
  grow — the alternative (keep the old index, add ``(app_id, spec_id,
  captured_at)``) would have added a third b-tree to every INSERT on a
  write-heavy capture table for no read benefit the widened index does
  not already provide.

``spec_id`` is frequently NULL (global captures); a btree indexes NULLs,
so ``WHERE spec_id IS NULL AND app_id = $1`` is still an index scan.

Idempotent both ways (``ADD COLUMN IF NOT EXISTS`` / ``DROP INDEX IF
EXISTS`` / ``CREATE INDEX IF NOT EXISTS``), matching the style of the
creating migration.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# ``down_revision`` chains off the single web head at authoring time
# (``memory_jobs_02_kind_aware_dedupe``). Keep this on ONE physical line — the
# ``alembic-heads-pr`` CI gate parses it with a line-based regex.
revision: str = "appid_01_co_occurrence_app_id"
down_revision: str = "memory_jobs_02_kind_aware_dedupe"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable ``app_id`` column and widen the spec index."""
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        ALTER TABLE co_occurrence_observations
            ADD COLUMN IF NOT EXISTS app_id TEXT;

        DROP INDEX IF EXISTS idx_observations_spec;
        CREATE INDEX IF NOT EXISTS idx_observations_spec
            ON co_occurrence_observations (spec_id, app_id, captured_at)
            WHERE invalidated_at IS NULL;
        """
    )


def downgrade() -> None:
    """Restore the original ``(spec_id, captured_at)`` index and drop the column."""
    op.execute("SET search_path TO project, public")
    op.execute(
        """
        DROP INDEX IF EXISTS idx_observations_spec;
        CREATE INDEX IF NOT EXISTS idx_observations_spec
            ON co_occurrence_observations (spec_id, captured_at)
            WHERE invalidated_at IS NULL;

        ALTER TABLE co_occurrence_observations
            DROP COLUMN IF EXISTS app_id;
        """
    )
