"""coord dev_action_snapshots — allow kind='restart_lkg'

Revision ID: dev_action_02_restart_lkg_kind
Revises: pr_events_mergeability_head_idx_01
Create Date: 2026-11-05

Phase 6c step 1 of plan
``2026-10-27-bayesian-consequence-model-for-the-dev-twin`` (S3, ``route_lkg``
by expected loss in shadow). The supervisor will ingest a runner restart that
actually ran the last-known-good exe as its own dev-action kind,
``restart_lkg``, so that the treatment (which exe ran) is a separate arm of the
consequence model rather than being folded into ``restart``. The ``kind`` CHECK
created by ``dev_action_01_snapshot_tables`` (``dev_action_snapshots_kind_chk``)
admits only ``restart / spawn / build / deploy / migrate`` and would refuse such
a snapshot with 23514. This revision widens that CHECK by one value.

Ordering is load-bearing (served policy ``production-and-cost``
``alembic-sole-authorship``): this revision must be applied in production
**before** a coord build that adds ``restart_lkg`` to ``SNAPSHOT_KINDS``, and
that coord build before a supervisor that sends it — otherwise the insert is
refused and the trial is lost.

Exactly one constraint
======================

Of the three ``dev_action_*`` tables only ``coord.dev_action_snapshots`` carries
a kind CHECK:

* ``coord.dev_action_outcomes`` has no kind column at all (it keys on
  ``action_id``);
* ``coord.dev_action_stats.action_kind`` is unconstrained — its only CHECK is
  ``dev_action_stats_grain_chk`` on ``grain``.

So a ``restart_lkg`` snapshot, its outcome rows and its stats rows all land
once this one constraint admits it. ``dev_action_01`` named the constraint
explicitly and no later revision renames it, so it is dropped by that name
(``IF EXISTS``, so a database missing it does not fail the upgrade) and re-added
under the same name.

Downgrade deletes ``restart_lkg`` rows
======================================

The narrower CHECK cannot be re-added while ``restart_lkg`` rows exist, so the
downgrade deletes them first (their ``dev_action_outcomes`` rows go with them
through the ``action_id`` ON DELETE CASCADE FK). The alternative — a downgrade
that fails while such rows exist — would block rolling back any later revision
over a table whose raw rows are pruned at 7-30 days anyway. The durable record
of those trials is not lost: the ``coord.process_forecasts`` ledger row coord
writes at first ingest, and the never-pruned ``coord.dev_action_stats`` counts
keyed by ``action_kind = 'restart_lkg'`` (which carries no kind CHECK and is
left untouched). This follows the precedent of
``coord_prompt_docs_04_claude_settings_kind``.

The downgrade is not decorative: ``migration-reversal.yml`` executes
upgrade → ``downgrade -1`` → upgrade against a real PostgreSQL.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "dev_action_02_restart_lkg_kind"
down_revision: str | Sequence[str] | None = "pr_events_mergeability_head_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINT = "dev_action_snapshots_kind_chk"
_OLD_KINDS = "'restart','spawn','build','deploy','migrate'"
_NEW_KINDS = "'restart','spawn','build','deploy','migrate','restart_lkg'"


def _replace_kind_check(kinds: str) -> None:
    op.execute(
        f"ALTER TABLE IF EXISTS coord.dev_action_snapshots "
        f"DROP CONSTRAINT IF EXISTS {_CONSTRAINT}"
    )
    op.execute(
        f"ALTER TABLE IF EXISTS coord.dev_action_snapshots "
        f"ADD CONSTRAINT {_CONSTRAINT} CHECK (kind IN ({kinds}))"
    )


def upgrade() -> None:
    """Re-add the kind CHECK including ``restart_lkg``."""
    _replace_kind_check(_NEW_KINDS)


def downgrade() -> None:
    """Restore the five-value kind CHECK.

    ``restart_lkg`` snapshots would violate it, so they are deleted first;
    their outcome rows cascade via ``dev_action_outcomes.action_id``.
    """
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('coord.dev_action_snapshots') IS NOT NULL THEN
                DELETE FROM coord.dev_action_snapshots
                WHERE kind = 'restart_lkg';
            END IF;
        END
        $$
        """
    )
    _replace_kind_check(_OLD_KINDS)
