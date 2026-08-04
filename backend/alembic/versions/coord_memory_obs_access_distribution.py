"""coord.memory_observations: access-count distribution columns.

Phase 4 of ``2026-07-29-memory-recall-efficacy-benchmark``.

``coord.memory_records.access_count`` is incremented on every query
(``memory_store.bump_access``) and today feeds exactly one consumer: the
decay half-life in ``memory_lifecycle.retention_score``. Which records are
retrieved repeatedly versus never retrieved at all is a free relevance
prior nothing reads.

These columns are where the observer parks that distribution so
``coord/src/memory_metrics.rs`` can publish it. That indirection is not
incidental — coord's memory gauges are a projection of the LATEST
``coord.memory_observations`` row per tenant, not a live registry, so a
new published number needs somewhere on this table to live.

**This migration must be applied in production BEFORE the coord read
ships.** Alembic here is the sole author of the ``coord.*`` schema (coord
authors zero ``coord.*`` DDL), and a coord build that selects a column
this migration has not yet created fails the observer tick outright.

All five columns are **nullable with no default**, deliberately:

* an older coord replica still INSERTing the pre-Phase-4 column list keeps
  working during the rollout window, and its rows read back as NULL rather
  than as a fabricated zero;
* NULL and 0 mean genuinely different things here — "this observer did not
  compute the distribution" versus "no record has ever been retrieved" —
  and the gauge renderer distinguishes them. A ``NOT NULL DEFAULT 0``
  would erase that distinction and publish a confident zero for every row
  written before the observer learned to fill it.

Backfill is deliberately absent for the same reason: historical rows never
had this measurement and must not be given one.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_memory_obs_access_distribution"
down_revision: str = "avac_01_agent_commands"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the five access-distribution columns (nullable, no default)."""
    op.execute(
        """
        ALTER TABLE coord.memory_observations
            ADD COLUMN IF NOT EXISTS retrieved_rows       BIGINT,
            ADD COLUMN IF NOT EXISTS never_retrieved_rows BIGINT,
            ADD COLUMN IF NOT EXISTS access_count_p50     BIGINT,
            ADD COLUMN IF NOT EXISTS access_count_p90     BIGINT,
            ADD COLUMN IF NOT EXISTS access_count_max     BIGINT
        """
    )


def downgrade() -> None:
    """Drop the five columns. The observation oplog itself is untouched."""
    op.execute(
        """
        ALTER TABLE coord.memory_observations
            DROP COLUMN IF EXISTS access_count_max,
            DROP COLUMN IF EXISTS access_count_p90,
            DROP COLUMN IF EXISTS access_count_p50,
            DROP COLUMN IF EXISTS never_retrieved_rows,
            DROP COLUMN IF EXISTS retrieved_rows
        """
    )
