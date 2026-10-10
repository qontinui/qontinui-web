"""coord.pr_holds — a coord-stored PR hold that does not depend on GitHub drafts

Revision ID: coord_pr_holds_01
Revises: coord_ci_pool_observations_01
Create Date: 2026-10-05

Phase 1 of plan ``2026-10-04-coord-pr-hold-without-github-drafts``.

## Why

Private repos on GitHub Free have no draft PRs, so a hold expressed as a
GitHub draft cannot be placed there, and a hold label can be stripped by
anyone. Coord is the sole merge authority, so its own record is the
authoritative hold: ``is_held = active coord.pr_holds row OR pr_state =
'draft'`` (plan D1). GitHub cannot clear a row in this table.

## Shape

One row per hold. A row is LIVE while ``released_at IS NULL``.

* ``repo`` TEXT NOT NULL, ``owner/name``, LOWERCASE (CHECK
  ``repo_lowercase``). GitHub treats ``owner/name`` case-insensitively and
  coord's PR rows carry ``full_name`` as GitHub sent it, so the writer
  lowercases and the reader matches on ``lower(pr.repo)``. Without the CHECK a
  differently-cased hold would read as no hold and the PR would land: a
  fail-OPEN miss the fail-closed read cannot catch. Same rule as
  ``coord_ci_pool_observations_01``. ``head_branch`` is NOT lowercased: git
  branch names are case-sensitive.
* ``head_branch`` TEXT NOT NULL. The hold is keyed by branch so it can be
  placed BEFORE the PR exists (plan D3): ``coord_create_pr { hold: true }``
  inserts the hold first and creates the PR second, so there is no window in
  which a green PR is eligible.
* ``pr_number`` INTEGER NULL. NULL until coord binds the hold to the PR when
  the PR opens (``ingest_pull_request``, the same site that drains
  ``coord.pending_pr_dependencies``).
* ``kind`` TEXT NOT NULL, CHECK in ``manual`` | ``security_tier`` |
  ``migration_order`` | ``create`` | ``coord_proposal`` (plan D4). A new kind
  is a schema change the reader learns about, not a string it mis-renders.
* ``reason`` TEXT NOT NULL and never blank: a hold is not allowed to sit
  silently, and a status card renders "held by X because Y".
* ``held_by`` TEXT NOT NULL, never blank: the actor key that placed the hold,
  which governs who may release it (plan D4).
* ``gate_id`` UUID NULL: a gate whose clearance releases the hold. No FK, so
  the hold table takes no lock on the gate table and a gate's lifecycle does
  not cascade into holds; coord releases the hold when the gate clears.
* ``created_at`` TIMESTAMPTZ NOT NULL DEFAULT now().
* ``released_at``, ``released_by``, ``release_note`` NULL. CHECK
  ``released_coherent``: ``released_at`` and ``released_by`` are both NULL or
  both set, so a release always names who released it.

## Indexes

* ``uq_pr_holds_live_branch_kind``: partial UNIQUE on
  ``(tenant_id, repo, head_branch, kind) WHERE released_at IS NULL``. One live
  hold of a kind per branch, so placing it again is a no-op (``ON CONFLICT DO
  NOTHING`` against this index), while released history accumulates freely.
* ``idx_pr_holds_live_repo_pr``: partial on ``(repo, pr_number) WHERE
  released_at IS NULL``. The train's held-predicate and the act-on
  ``NOT EXISTS`` fragment probe live holds by ``(repo, pr_number)``.

Both are built in the same transaction as the empty table, so a plain
``CREATE INDEX`` takes no lock anything else is waiting on; CONCURRENTLY buys
nothing on a table created in this revision.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema
(``production-and-cost`` ``alembic-sole-authorship``). The coord reader and
writer (plan Phase 2, ``pr_hold.rs``) land after this revision is applied in
production. Arming: none. No reader exists until Phase 2. No SQLAlchemy model:
this table is coord-only.

## Head choice

``down_revision`` is ``coord_ci_pool_observations_01``, the single head of
``origin/main`` at ``aff68a05d`` when this revision was written
(``scripts/ci/count_alembic_heads.py`` reported ``HEAD_COUNT=1``). If main has
moved before it lands, re-point ``down_revision``, the ``Revises:`` header and
``_PARENT_REVISION_ID`` in the migration test at the new single head. Do not
add an ``alembic merge``.

## Merge-train classifier disposition

Whatever coord's migration classifier returns on the PR; not predicted here.
Every SQL string is a static literal, so nothing here is dynamic SQL.

## Safety

``CREATE TABLE IF NOT EXISTS`` / ``CREATE ... INDEX IF NOT EXISTS`` and
re-runnable ``COMMENT ON``, so a partial apply re-runs cleanly. No existing
table is touched and there is no FK. ``downgrade()`` drops the table, and its
indexes, constraints and comments go with it. Both directions are pure SQL
with no bind or inspection, so they work under ``alembic ... --sql``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pr_holds_01"
down_revision: str | Sequence[str] | None = "coord_ci_pool_observations_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic.


def upgrade() -> None:
    """Create coord.pr_holds, its two partial indexes, and its comments."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.pr_holds (
            id            UUID NOT NULL DEFAULT gen_random_uuid(),
            tenant_id     UUID NOT NULL,
            repo          TEXT NOT NULL,
            head_branch   TEXT NOT NULL,
            pr_number     INTEGER,
            kind          TEXT NOT NULL,
            reason        TEXT NOT NULL,
            held_by       TEXT NOT NULL,
            gate_id       UUID,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            released_at   TIMESTAMPTZ,
            released_by   TEXT,
            release_note  TEXT,
            CONSTRAINT pr_holds_pkey
                PRIMARY KEY (id),
            CONSTRAINT pr_holds_kind_check
                CHECK (kind IN ('manual', 'security_tier', 'migration_order', 'create', 'coord_proposal')),
            CONSTRAINT pr_holds_reason_nonblank_check
                CHECK (length(btrim(reason)) > 0),
            CONSTRAINT pr_holds_held_by_nonblank_check
                CHECK (length(btrim(held_by)) > 0),
            CONSTRAINT pr_holds_released_coherent_check
                CHECK ((released_at IS NULL) = (released_by IS NULL)),
            CONSTRAINT pr_holds_repo_lowercase_check
                CHECK (repo = lower(repo))
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_pr_holds_live_branch_kind
            ON coord.pr_holds (tenant_id, repo, head_branch, kind)
            WHERE released_at IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pr_holds_live_repo_pr
            ON coord.pr_holds (repo, pr_number)
            WHERE released_at IS NULL
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.pr_holds IS
            'Coord-stored PR holds (plan 2026-10-04-coord-pr-hold-without-github-drafts). A row is live while released_at IS NULL. A PR is held when a live row matches it or its GitHub state is draft. Keyed by head_branch so a hold can be placed before the PR exists; pr_number is bound when the PR opens.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_holds.pr_number IS
            'NULL until coord binds the hold to the PR when it opens (ingest_pull_request). A NULL here means not yet bound, never no PR.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_holds.repo IS
            'owner/name, lowercased by the writer (repo_lowercase CHECK). Readers match on lower() of the PR row repo.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_holds.kind IS
            'manual, security_tier, migration_order, create or coord_proposal. One live hold per (tenant_id, repo, head_branch, kind).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_holds.held_by IS
            'Actor key that placed the hold. That actor, or the operator, may release it; a security_tier hold is released only by the operator.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_holds.gate_id IS
            'Optional coord gate whose clearance releases the hold. No FK: coord releases the hold when the gate clears.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_holds.released_at IS
            'NULL while the hold is live. Set together with released_by (released_coherent CHECK).'
        """
    )


def downgrade() -> None:
    """Drop coord.pr_holds. Its indexes, constraints and comments go with it."""
    op.execute("DROP TABLE IF EXISTS coord.pr_holds")
