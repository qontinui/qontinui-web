"""coord.session_census + coord.session_census_device — cross-account Claude session census

Revision ID: coord_session_census_01
Revises: overview_04_timeline
Create Date: 2026-10-01

Phase 2 (qontinui-web half) of plan
``2026-10-01-a-commit-author-session-is-unreachable-because-every-session-roster-is-per-account``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
storage behind coord's ``POST /coord/session-census/:device_id`` ingest and
``GET /coord/sessions/census`` read lands here, and must be applied before the
coord PR that writes or reads it leaves draft. That coord read must degrade on a
missing relation (``pg_error::is_missing_schema_object``) so a coord deploy that
lands ahead of this migration fails open.

Why the table exists
====================

Every session roster the fleet keeps today is per Claude **account**: the runner
reads one config dir's ``sessions/*.json``, so a session started under
``~/.claude-tiohorst`` is invisible to a roster built from ``~/.claude``. A
commit's ``Session-Id`` trailer therefore names a session nothing can resolve to
a device, a pid or a live/dead verdict. The census is the runner's machine-wide
enumeration across EVERY account home it scans, posted per device, so the
answer to "is the author of this commit alive, and where" is one read.

Shape — a per-device snapshot, NOT an oplog
===========================================

Unlike its sibling ``coord.worktree_census`` (``twin_07_coord_worktree_census``,
an append-only history), this store holds only the **latest** snapshot per
device: each post upserts the device row and replaces that device's session
rows wholesale, in one transaction, coord side. Two tables:

* ``coord.session_census_device`` — one row per device, the **freshness** half.
  ``observed_at`` is the runner's observation clock; ``received_at`` is coord's
  ingest clock. The read derives ``census_age_secs`` from these, and a snapshot
  older than 3x the post interval makes every session on that device read
  ``unknown`` — never ``dead``. ``row_count`` and ``account_homes`` let a reader
  tell "this device has no sessions" from "this device scanned no account
  homes", which are different facts that both look like zero rows below.
* ``coord.session_census`` — one row per ``(device_id, session_id, pid)``. The
  pid is in the key because a resumed session id can be held by more than one
  process on the same box; the index on ``session_id`` serves the by-session
  lookup a ``Session-Id`` trailer drives, which spans devices.

``device_id`` on ``session_census`` is a FOREIGN KEY to
``session_census_device`` that cascades on removal: a session row is meaningless
without its device's freshness row (its liveness cannot be read without one),
so the schema refuses an orphan, and retiring a device's snapshot takes its
sessions with it.

``tenant_id`` is nullable and carries no FK to ``coord.tenants`` — the
``worktree_census`` / ``device_status`` convention: a device push must not fail
on tenant resolution.

``last_acted_at`` is the liveness clock: the ``timestamp`` field of the LAST
user/assistant turn in the transcript (``projects/*/<session_id>.jsonl``), read
from the tail with no content kept, falling back to the registry's
``statusUpdatedAt``. It is NEVER the transcript file's mtime — Phase 0 measured
that mtime moves without any turn (coord finding ``124c0ce9``). Nor is
``registry_status`` the liveness clock: it is stored as observed, but the harness
writes it on its own schedule and it lags a session that is acting.

The privacy rule
================

NO transcript content, NO environment values, NO credentials are ever stored.
Every column is a name, an identity, a clock or a flag. ``tmux_pane`` is the one
value read from a process environment, and it is read alone; no other variable is
ever captured. The migration test pins the exact column set, so widening it is a
reviewed act.

Idempotency: raw ``op.execute`` with ``CREATE TABLE / INDEX IF NOT EXISTS`` (the
index CONCURRENTLY, inside ``autocommit_block``) —
the house convention for coord tables (``coordinput_01_operator_inputs``,
``fleet_res_tel_01``).

Note on a killed CONCURRENTLY build: ``autocommit_block`` commits the two
tables before the index is built, so a build killed partway leaves the tables
committed, ``alembic_version`` unadvanced and an INVALID index of the same name,
which ``IF NOT EXISTS`` then skips on the re-run. Recovery is manual (the
classifier refuses a destructive op on the upgrade path): remove the invalid
``coord.ix_session_census_session_id`` index by hand and re-run the upgrade — the same note as
``coord_pg_overload_idx_01``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_session_census_01"
down_revision: str | Sequence[str] | None = "overview_04_timeline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the device freshness table, the session table and its index."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    # One row per device: the freshness half of the snapshot.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_census_device (
            device_id      UUID PRIMARY KEY,
            tenant_id      UUID NULL,
            -- The runner's observation clock.
            observed_at    TIMESTAMPTZ NOT NULL,
            -- coord's ingest clock.
            received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            row_count      INTEGER NOT NULL,
            -- How many Claude config dirs the runner scanned.
            account_homes  INTEGER NOT NULL,
            runner_build   TEXT NULL
        )
        """
    )
    # One row per (device, session, pid); the device's set is replaced on
    # every post. The column list IS the privacy contract — see the docstring.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.session_census (
            device_id                   UUID NOT NULL
                REFERENCES coord.session_census_device (device_id)
                ON DELETE CASCADE,
            session_id                  TEXT NOT NULL,
            pid                         INTEGER NOT NULL,
            pid_alive                   BOOLEAN NOT NULL,
            proc_start                  TEXT NULL,
            started_at                  TIMESTAMPTZ NULL,
            account                     TEXT NULL,
            config_dir                  TEXT NULL,
            cwd                         TEXT NULL,
            entrypoint                  TEXT NULL,
            kind                        TEXT NULL,
            tmux_pane                   TEXT NULL,
            window_name                 TEXT NULL,
            window_name_source          TEXT NULL,
            registry_status             TEXT NULL,
            registry_status_updated_at  TIMESTAMPTZ NULL,
            -- Last transcript turn's timestamp (never file mtime): the liveness clock.
            last_acted_at               TIMESTAMPTZ NULL,
            runner_hosted               BOOLEAN NOT NULL DEFAULT false,
            PRIMARY KEY (device_id, session_id, pid)
        )
        """
    )
    # By-session lookup across devices — what a Session-Id trailer drives.
    # Built CONCURRENTLY outside the migration transaction (the
    # coord_pg_overload_idx_01 precedent) so coord's migration classifier
    # reads it as provably lock-safe; the table is created just above and is
    # empty, so the build is instant either way.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_session_census_session_id
                ON coord.session_census (session_id)
            """
        )


def downgrade() -> None:
    """Drop both tables. Reverse order of upgrade()."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.ix_session_census_session_id"
        )
    op.execute("DROP TABLE IF EXISTS coord.session_census")
    op.execute("DROP TABLE IF EXISTS coord.session_census_device")
