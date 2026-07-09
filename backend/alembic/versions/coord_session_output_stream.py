"""coord session_output — add ``stream`` discriminator column + widen PK

Revision ID: coord_session_output_stream
Revises: auto_fix_red_main_01
Create Date: 2026-07-09

Phase 2 of the 2026-07-09 runner-session-history-cloud-sync plan
(``D:/qontinui-root/qontinui-dev-notes/plans/2026-07-09-runner-session-history-cloud-sync.md``).

``coord.session_output`` (created by ``coord_session_substrate`` as the
warm-tier PTY capture table, plan D11 of the 2026-05-22 session
substrate) stored exactly ONE byte stream per session: raw PTY output,
keyed ``PRIMARY KEY (session_id, chunk_offset)``. The session-history
cloud sync uploads MULTIPLE independent streams per session (PTY bytes
plus structured sidecar streams), each with its own monotonic
``chunk_offset`` sequence starting at 0 — so the two-column PK would
collide across streams.

This revision:

1. Adds ``stream TEXT NOT NULL DEFAULT 'pty'``. Every pre-existing row
   IS a PTY chunk (the substrate table only ever held PTY bytes), so
   the column default stamps history correctly with no backfill step.
2. Re-keys the table: drops ``session_output_pkey`` (the default name
   Postgres derived from the inline ``PRIMARY KEY (session_id,
   chunk_offset)`` declaration) and adds
   ``PRIMARY KEY (session_id, stream, chunk_offset)`` — per-(session,
   stream) FIFO ordering, and the PK index keeps serving the
   per-session scan (leading column unchanged).

Idempotency posture
===================

Same defensive style as ``coord_session_substrate``: ``ADD COLUMN IF
NOT EXISTS`` / ``DROP CONSTRAINT IF EXISTS``, and the PK add is wrapped
in a ``DO $$`` block that no-ops when a primary key already exists on
the table — so a re-run against an already-applied DB is a no-op.

Downgrade honesty
=================

The old two-column PK is only valid if no two streams share a
``(session_id, chunk_offset)`` pair — which multi-stream data
guarantees to violate. The downgrade therefore DELETEs all
non-``'pty'`` rows before restoring the narrow PK. That is lossy by
construction (sidecar streams cannot be represented in the old shape);
it is the honest inverse, not an accident.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_session_output_stream"
down_revision: str = "auto_fix_red_main_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``stream`` to ``coord.session_output`` and widen the PK."""
    # ----------------------------------------------------------------
    # 1. stream discriminator. DEFAULT 'pty' stamps every existing row
    #    correctly — the substrate table only ever held PTY bytes. The
    #    default is kept (not dropped post-add) so pre-stream writers
    #    that omit the column keep landing in the PTY stream during the
    #    deploy window.
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.session_output
            ADD COLUMN IF NOT EXISTS stream TEXT NOT NULL DEFAULT 'pty'
        """
    )

    # ----------------------------------------------------------------
    # 2. Re-key: (session_id, chunk_offset) → (session_id, stream,
    #    chunk_offset). Constraint name 'session_output_pkey' is the
    #    Postgres default for the inline PK declared by
    #    coord_session_substrate. The DO block makes the ADD idempotent:
    #    if a primary key already exists (re-run after a prior success),
    #    skip — the DROP above would have removed the old one on the
    #    first pass, so a surviving PK is the widened one.
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.session_output
            DROP CONSTRAINT IF EXISTS session_output_pkey
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint c
                  JOIN pg_class t ON t.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'coord'
                   AND t.relname = 'session_output'
                   AND c.contype = 'p'
            ) THEN
                ALTER TABLE coord.session_output
                    ADD CONSTRAINT session_output_pkey
                    PRIMARY KEY (session_id, stream, chunk_offset);
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    """Restore the narrow PK and drop ``stream``.

    Lossy by construction: the old ``(session_id, chunk_offset)`` PK
    cannot represent multi-stream rows, so all non-PTY chunks are
    deleted before the narrow PK is restored. PTY history survives
    intact.
    """
    op.execute("DELETE FROM coord.session_output WHERE stream <> 'pty'")
    op.execute(
        """
        ALTER TABLE coord.session_output
            DROP CONSTRAINT IF EXISTS session_output_pkey
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint c
                  JOIN pg_class t ON t.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'coord'
                   AND t.relname = 'session_output'
                   AND c.contype = 'p'
            ) THEN
                ALTER TABLE coord.session_output
                    ADD CONSTRAINT session_output_pkey
                    PRIMARY KEY (session_id, chunk_offset);
            END IF;
        END
        $$;
        """
    )
    op.execute("ALTER TABLE coord.session_output DROP COLUMN IF EXISTS stream")
