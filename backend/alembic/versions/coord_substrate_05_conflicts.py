"""coord.conflicts -- Phase 2 first-class conflicts substrate

Revision ID: phase2_conflicts
Revises: workflow_mirror_2026_05_23
Create Date: 2026-05-23

Substrate Phase 2 (first-class conflicts as a crossable, stackable substrate).
Mirrors the coord-side self-heal at
``qontinui-coord/src/conflict_engine.rs::ensure_conflicts_table``. The Rust
engine runs an idempotent ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF
NOT EXISTS`` pass at boot AND lazily before the first conflict is materialized;
this migration is the authoritative alembic record so a fresh canonical PG ends
up with the same shape without depending on a coord boot.

## What the table is

``coord.conflicts`` is the metadata/provenance row for each first-class
conflict. When a server-side rebase conflicts, coord captures the git-native
3-way (index stages 1/2/3) into a durable conflict commit at
``refs/conflict/<id>`` in coord's bare repo (served over smart-HTTP, so it
CROSSES MACHINES) and records one row here. **GitHub never sees conflict state
-- only resolved tips are ever published.**

The ``refs/conflict/<id>`` object is SELF-SUFFICIENT for cross-machine
reconstruction (a fresh clone recovers base/ours/theirs blob OIDs + the
conflicted hunks from the ref ALONE -- see the ``CONFLICT_MANIFEST.json`` in
the conflict commit's tree). This row carries metadata + the query/index
surface; the on-disk object does not depend on it.

## schema_version (MANDATORY, plan §6.2)

The on-disk conflict-object format is versioned from day one via
``schema_version`` so a reader can refuse / adapt if the manifest shape or the
sidecar-blob layout changes. Mirrors ``CONFLICT_SCHEMA_VERSION`` in
``conflict_engine.rs`` (currently 1).

## Why raw `op.execute` instead of `op.create_table`

Collision-safe with the coord self-heal: coord may have already created the
table (via ``ensure_conflicts_table``) before this migration runs.
``op.create_table`` issues a bare ``CREATE TABLE`` that errors if the table
already exists. We emit the exact same idempotent raw SQL the self-heal uses
-- ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT EXISTS`` -- so the
two artifacts converge regardless of order. They MUST stay equivalent in shape;
schema changes here must be mirrored in ``ensure_conflicts_table`` and vice
versa.

## Schema rationale

* ``id`` UUID PK (UUID v7, FIFO-orderable). The ``refs/conflict/<id>`` ref name
  uses the simple (dashless) form of this id.
* ``repo`` TEXT (``owner/name``), ``conflict_ref`` TEXT (``refs/conflict/<id>``).
* ``schema_version`` INT NOT NULL DEFAULT 1 -- see above (mandatory).
* ``base_sha`` / ``ours_sha`` / ``theirs_sha`` TEXT -- the three commit SHAs of
  the 3-way (merge base / descendant head / new base it collided with).
* ``ours_ref`` / ``theirs_ref`` TEXT NULL -- provenance ref names.
* ``status`` TEXT + CHECK ('open','resolved','abandoned') -- text+CHECK over a
  PG ENUM (ENUM ALTER is per-txn pain; house pattern). A conflict is resolved
  purely by appending to ``coord.conflict_resolutions`` + flipping this column.
* ``affected_hunks`` JSONB -- the conflict-marked hunks per path (inspection
  cache; the authoritative copy lives in the conflict commit's tree).
* ``provenance`` JSONB -- ours/theirs refs, conflict commit sha, paths.
* ``tenant_id`` UUID NULLABLE -- lands nullable-first per the canonical
  multi-tenant posture (``coord_tenant_scope_columns``); NOT-NULL tightening is
  a deliberate later migration. PARTIAL index ``WHERE tenant_id IS NOT NULL``.
* ``created_at`` / ``resolved_at`` TIMESTAMPTZ.
* Index on ``(repo, status)`` powers the ``GET /coord/conflicts`` default
  (open conflicts per repo) + the ``conflicts_open`` gauge refresh.

## Single head

At authoring time the single alembic head is ``workflow_mirror_2026_05_23``
(verified via ``alembic heads``). Sibling substrate migrations (Phase 0
``coord_canonical_repos``, Phase 1 ``phase1_stack_edges`` / ``phase1_restack_log``,
Phase 3 ``phase3_hot_file_grammars``, and the companion
``phase2_conflict_resolutions``) also chain off this same head; the coordinator
linearizes the chain at land time (re-pointing each sibling's ``down_revision``
at the prior so there is one head). Per ``feedback_alembic_sibling_head_merge``,
if siblings land via plain PRs instead, an empty merge-heads revision joins the
heads.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "phase2_conflicts"
down_revision: str | Sequence[str] | None = "phase1_restack_log"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed conflict statuses -- keep in sync with the CHECK emitted by
# ``ensure_conflicts_table`` in ``conflict_engine.rs``.
_STATUSES = ("open", "resolved", "abandoned")


def upgrade() -> None:
    # Collision-safe raw SQL -- equivalent in shape to the coord self-heal so
    # the two artifacts converge regardless of run order.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.conflicts (
            id             UUID PRIMARY KEY,
            repo           TEXT NOT NULL,
            conflict_ref   TEXT NOT NULL,
            schema_version INT NOT NULL DEFAULT 1,
            base_sha       TEXT NULL,
            ours_sha       TEXT NULL,
            theirs_sha     TEXT NULL,
            ours_ref       TEXT NULL,
            theirs_ref     TEXT NULL,
            status         TEXT NOT NULL DEFAULT 'open',
            affected_hunks JSONB NULL,
            provenance     JSONB NULL,
            tenant_id      UUID NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_at    TIMESTAMPTZ NULL,
            CONSTRAINT conflicts_status_chk
                CHECK (status IN ('open','resolved','abandoned'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_conflicts_repo_status
            ON coord.conflicts (repo, status)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_conflicts_tenant
            ON coord.conflicts (tenant_id) WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_conflicts_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_conflicts_repo_status")
    op.execute("DROP TABLE IF EXISTS coord.conflicts")


# Touch the symbol so linters don't strip it -- same pattern as
# wave_6_01_coord_merge_batches._STATUSES.
_ = _STATUSES
