"""coord.memories — event-sourced shared memory (Phase 6 substrate)

Revision ID: coord_memories
Revises: coord_agent_logs
Create Date: 2026-05-19

Phase 6 of plan
``D:/qontinui-root/plans/2026-05-19-coordinator-production-readiness.md``.

Stands up the event-sourced ``coord.memories`` shared-memory store per
the plan's Q3 resolution: every write is a new immutable row keyed by
``(name, version)``. Reads use the ``coord.memories_latest`` view which
selects the highest non-tombstone version per name. This shape is
preferred over a mutable single-row-per-name table because:

* It preserves history for free — operators can diff prior versions or
  roll back by writing a new row that copies an old one's content.
* Concurrent writers can't lose updates: collisions surface as UNIQUE
  violations rather than silent last-writer-wins.
* Tombstones encode delete without losing audit (``is_tombstone``
  flips on a new version).

Schema:

* ``memory_id UUID PRIMARY KEY``        — synthetic id per row.
* ``name TEXT NOT NULL``                — logical memory key, e.g.
  ``proj_unified_devices_deferred_cutover_2026-05-19``.
* ``version BIGINT NOT NULL``           — monotonic per-name version;
  the writer is expected to supply ``current_max(name) + 1``.
  ``UNIQUE (name, version)`` guarantees no two writers stomp the same
  version.
* ``content TEXT NOT NULL``             — full memory body. Inline
  (not S3) — memories are ~1-50KB and read-path needs immediacy.
* ``description TEXT``                  — short summary; the
  ``MEMORY.md`` index line is rebuilt from this + name.
* ``type TEXT``                         — free-form taxonomy
  (``feedback|project|reference|user_feedback``).
* ``written_by_agent UUID``             — best-effort attribution.
* ``written_by_device UUID``            — best-effort attribution.
* ``written_at TIMESTAMPTZ``            — wall-clock write time.
* ``is_tombstone BOOLEAN``              — set on the version that
  retracts a name. The ``memories_latest`` view filters these out so
  retracted names disappear from reads but stay in history.

Indices:

* ``idx_memories_name_latest``          — ``(name, version DESC)``
  covers the "latest version per name" lookup the view + UPSERT path
  use.
* ``idx_memories_recent``               — global "most recently
  written" feed for the operator memory dashboard.

View:

* ``coord.memories_latest``             — ``SELECT DISTINCT ON (name)``
  ordered by ``(name, version DESC)``, filtered to
  ``is_tombstone = FALSE``. The dashboard's normal read path. Recreated
  via ``CREATE OR REPLACE VIEW`` so the migration is idempotent.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT
EXISTS`` + ``CREATE OR REPLACE VIEW``. Runtime self-heal posture per
[[feedback_canonical_db_behind_alembic]].

Chains off ``coord_agent_logs`` (Phase 5).
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_memories"
down_revision: str = "coord_agent_logs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.memories`` + view + indices. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.memories (
            memory_id          UUID PRIMARY KEY
                DEFAULT gen_random_uuid(),
            name               TEXT NOT NULL,
            version            BIGINT NOT NULL,
            content            TEXT NOT NULL,
            description        TEXT,
            type               TEXT,
            written_by_agent   UUID,
            written_by_device  UUID,
            written_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            is_tombstone       BOOLEAN NOT NULL DEFAULT FALSE,
            UNIQUE (name, version)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memories_name_latest
            ON coord.memories(name, version DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memories_recent
            ON coord.memories(written_at DESC)
        """
    )
    # CREATE OR REPLACE VIEW is idempotent without an IF NOT EXISTS
    # clause; re-applying the migration just rebuilds it.
    op.execute(
        """
        CREATE OR REPLACE VIEW coord.memories_latest AS
            SELECT DISTINCT ON (name) *
            FROM coord.memories
            WHERE is_tombstone = FALSE
            ORDER BY name, version DESC
        """
    )


def downgrade() -> None:
    """Drop the view first, then the table + indices."""
    op.execute("DROP VIEW IF EXISTS coord.memories_latest")
    op.execute("DROP INDEX IF EXISTS coord.idx_memories_recent")
    op.execute("DROP INDEX IF EXISTS coord.idx_memories_name_latest")
    op.execute("DROP TABLE IF EXISTS coord.memories")
