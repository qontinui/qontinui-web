"""coord.pr_body_citation_watermarks and coord.work_unit_citation_retractions

Revision ID: prbody_citation_01
Revises: gate_arming_01
Create Date: 2026-10-05

Phase 1 of plan
``2026-10-05-a-pr-body-citation-outlives-the-body-that-created-it``.

## The defect this schema serves

coord records a ``source = 'pr_body'`` row in ``coord.work_unit_pr_citations``
for every work-unit marker it reads in a PR body, and never removes one. When
the author edits the body to correct a wrong marker, the corrected marker is
captured but the stale one stays, so a unit keeps credit (``merged: true``)
from a PR that never delivered it. Four units carried such false credit when
the plan was written.

The coord half (Phases 2 to 4) re-derives a PR's ``pr_body`` captures from the
newest body it has seen. This revision creates the two tables that re-derivation
needs:

* ``coord.pr_body_citation_watermarks``: one row per ``(repo, pr_number)``, the
  GitHub ``updated_at`` and sha256 of the newest body coord has processed for
  that PR. Rule R1 of the plan: an older delivery (webhooks arrive out of
  order) does nothing to citations, and an equal ``updated_at`` with a
  different digest is ambiguous and applies nothing.
* ``coord.work_unit_citation_retractions``: a ledger of every retraction coord
  decides. ``pending`` while the PR has not landed (R2: a body edit never
  removes a row from an unlanded PR, so it can never remove a block),
  ``applied`` once it has and the ``pr_body`` row was deleted (R3), ``withdrawn``
  when the marker reappears before the land, ``superseded`` when it reappears
  after an applied retraction (R4), and ``ambiguous`` for the equal-timestamp
  case R1 refuses to decide.

A hard DELETE plus this ledger was chosen over a ``retracted_at`` tombstone
column on ``coord.work_unit_pr_citations`` because 38 coord source files read
that table and each would have to filter a tombstone. The ledger keeps the
deleted row's evidence instead.

## Column shape

``coord.pr_body_citation_watermarks``:

* ``repo`` TEXT NOT NULL: spelled EXACTLY as ``coord.work_unit_pr_citations.repo``,
  because the two join on it. On the webhook path that is GitHub's
  ``repository.full_name`` (``owner/name``) as delivered, which coord does NOT
  lowercase (``ingest_pull_request`` in ``data/repo_branches.rs`` passes
  ``ev.repository.full_name`` through). CHECK ``length(btrim(repo)) > 0`` only.
  There is deliberately NO ``repo = lower(repo)`` CHECK, unlike the template
  (``coord_ci_pool_observations_01``): GitHub preserves the case a repo was
  created with, and the citation table itself has no such CHECK and also holds
  short names (``coord_workunits_04``: "owner/name or short name"). A lowercase
  CHECK that rejected the citation table's real spelling would make every
  watermark write for such a repo fail, which would silently disable the
  ordering guard for it. (Decided from reading coord's write path, not from a
  live read of production values.)
* ``pr_number`` INTEGER NOT NULL, CHECK ``> 0``.
* ``body_updated_at`` TIMESTAMPTZ NOT NULL: GitHub's ``pull_request.updated_at``
  of the newest processed body.
* ``body_sha256`` TEXT NOT NULL: hex sha256 of that body, so an equal
  ``updated_at`` with a different body is detectable.
* ``observed_at`` TIMESTAMPTZ NOT NULL DEFAULT now(): when coord processed it.
  The writer must set it explicitly on the update arm of its upsert.

Primary key ``(repo, pr_number)``: the writer's upsert key and the lookup key.

``coord.work_unit_citation_retractions``:

* ``id`` UUID PK DEFAULT ``gen_random_uuid()`` (core since PostgreSQL 13).
* ``tenant_id`` UUID NULL: the deleted citation row's tenant, NULL when unknown.
* ``work_unit_id`` UUID NOT NULL. No FK to ``coord.work_units``: a ledger must
  survive the unit it records.
* ``repo`` TEXT NOT NULL (same spelling and non-blank CHECK as above),
  ``pr_number`` INTEGER NOT NULL CHECK ``> 0``.
* ``source`` TEXT NOT NULL: the citation source retracted. Only ``pr_body`` is
  ever retracted today; unchecked so the ledger records the row as it was.
* ``delivery_scope`` JSONB NULL and ``cited_at`` TIMESTAMPTZ NULL: copied from
  the citation row, so an applied retraction preserves what was deleted.
* ``body_updated_at`` TIMESTAMPTZ NOT NULL: the ``updated_at`` of the body that
  dropped the marker.
* ``state`` TEXT NOT NULL, CHECK in ``pending`` | ``applied`` | ``withdrawn`` |
  ``superseded`` | ``ambiguous``.
* ``recorded_at`` TIMESTAMPTZ NOT NULL DEFAULT now(), ``applied_at``
  TIMESTAMPTZ NULL.

Indexes: a partial UNIQUE index on ``(work_unit_id, repo, pr_number) WHERE
state = 'pending'`` (at most one open retraction per citation, and the writer's
conflict target), and ``(repo, pr_number)`` for the per-PR re-derivation and
the land-time ``pending`` to ``applied`` pass.

No SQLAlchemy model: both tables are coord-only.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors zero ``coord.*`` DDL. The coord writer and
reader (Phases 2 to 4) land after this revision is applied in production.

## Head choice

``down_revision`` is ``gate_arming_01``, the single head of ``origin/main``
at ``e05112fb4`` when this revision was last re-pointed
(``scripts/ci/count_alembic_heads.py`` reported ``HEAD_COUNT=1``). If main has
moved before it lands, re-point ``down_revision``, the ``Revises:`` header and
``_PARENT_REVISION_ID`` in the migration test at the new single head. Do not
add an ``alembic merge``: this repo keeps strict single-head discipline.

## Merge-train classifier disposition

The disposition is whatever coord's migration classifier (``qontinui-coord``
``crates/coord/src/pr_merge/migration_classifier.rs``) returns on the PR; it is
not predicted here. Every SQL string is a static literal.

## Safety

``CREATE TABLE IF NOT EXISTS`` and ``CREATE INDEX IF NOT EXISTS`` on two new,
empty tables, and every ``COMMENT ON`` is re-runnable, so a partial apply
re-runs cleanly. No existing table is touched and there is no FK, so the apply
takes no lock on any table coord writes. ``downgrade()`` is
``DROP TABLE IF EXISTS`` for both; their indexes, constraints and comments go
with them. Both directions are pure SQL with no bind or inspection, so they
work under ``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "prbody_citation_01"
down_revision: str | Sequence[str] | None = "gate_arming_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic.


def upgrade() -> None:
    """Create the watermark table and the retraction ledger, and document both."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.pr_body_citation_watermarks (
            repo             TEXT NOT NULL,
            pr_number        INTEGER NOT NULL,
            body_updated_at  TIMESTAMPTZ NOT NULL,
            body_sha256      TEXT NOT NULL,
            observed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT pr_body_citation_watermarks_pkey
                PRIMARY KEY (repo, pr_number),
            CONSTRAINT pr_body_citation_watermarks_repo_nonblank_check
                CHECK (length(btrim(repo)) > 0),
            CONSTRAINT pr_body_citation_watermarks_pr_number_positive_check
                CHECK (pr_number > 0)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_unit_citation_retractions (
            id               UUID NOT NULL DEFAULT gen_random_uuid(),
            tenant_id        UUID,
            work_unit_id     UUID NOT NULL,
            repo             TEXT NOT NULL,
            pr_number        INTEGER NOT NULL,
            source           TEXT NOT NULL,
            delivery_scope   JSONB,
            cited_at         TIMESTAMPTZ,
            body_updated_at  TIMESTAMPTZ NOT NULL,
            state            TEXT NOT NULL,
            recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            applied_at       TIMESTAMPTZ,
            CONSTRAINT work_unit_citation_retractions_pkey
                PRIMARY KEY (id),
            CONSTRAINT work_unit_citation_retractions_repo_nonblank_check
                CHECK (length(btrim(repo)) > 0),
            CONSTRAINT work_unit_citation_retractions_pr_number_positive_check
                CHECK (pr_number > 0),
            CONSTRAINT work_unit_citation_retractions_state_check
                CHECK (state IN ('pending', 'applied', 'withdrawn', 'superseded', 'ambiguous'))
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_work_unit_citation_retractions_one_pending
            ON coord.work_unit_citation_retractions (work_unit_id, repo, pr_number)
            WHERE state = 'pending'
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_unit_citation_retractions_repo_pr
            ON coord.work_unit_citation_retractions (repo, pr_number)
        """
    )

    # The comments carry what the names cannot: the repo spelling contract, the
    # ordering rule, and what each ledger state means. psql describe output is
    # where a human meets this schema.
    op.execute(
        """
        COMMENT ON TABLE coord.pr_body_citation_watermarks IS
            'Newest PR body coord has processed per (repo, pr_number), by GitHub updated_at and body sha256. A delivery whose updated_at is older than the watermark changes no citation; an equal updated_at with a different digest is ambiguous and applies nothing. Must be written by coord under a per-PR advisory lock in the same transaction as the pr_body citation re-derivation (the qontinui-coord writer lands after this revision).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_body_citation_watermarks.repo IS
            'GitHub repository spelled exactly as coord.work_unit_pr_citations.repo (the join key): the owner/name full name as the webhook delivers it, case NOT normalised, so there is deliberately no lowercase CHECK. Never blank.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_body_citation_watermarks.pr_number IS
            'Pull request number within repo.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_body_citation_watermarks.body_updated_at IS
            'GitHub pull_request.updated_at of the newest body processed. Ordering key: a body older than this is ignored.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_body_citation_watermarks.body_sha256 IS
            'Hex sha256 of the newest processed body, so an equal updated_at carrying a different body is detected as ambiguous.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.pr_body_citation_watermarks.observed_at IS
            'When coord processed the body. The writer must set it explicitly on the update arm of its upsert; the default covers the insert arm only.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.work_unit_citation_retractions IS
            'Ledger of pr_body citation retractions decided when a newer PR body drops a work-unit marker. pending: the PR has not landed, so the citation row stays. applied: the PR landed and the pr_body row was deleted; this row preserves it. withdrawn: the marker reappeared before the land. superseded: it reappeared after an applied retraction and the row was re-created. ambiguous: equal updated_at with a different body, nothing applied. No FK to coord.work_units: the ledger outlives the unit.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.id IS
            'Ledger row id.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.tenant_id IS
            'Tenant of the retracted citation row. NULL when unknown.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.work_unit_id IS
            'Work unit the retracted citation credited. Deliberately not a foreign key.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.repo IS
            'GitHub repository spelled exactly as coord.work_unit_pr_citations.repo: the owner/name full name as the webhook delivers it, case NOT normalised. Never blank.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.pr_number IS
            'Pull request whose body dropped the marker.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.source IS
            'Citation source of the retracted row, copied from coord.work_unit_pr_citations.source. Only pr_body rows are ever retracted.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.delivery_scope IS
            'delivery_scope of the retracted citation row, preserved so an applied retraction loses nothing. NULL when the row had none.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.cited_at IS
            'cited_at of the retracted citation row. NULL when unknown.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.body_updated_at IS
            'GitHub updated_at of the PR body that dropped the marker.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.state IS
            'pending, applied, withdrawn, superseded or ambiguous. At most one pending row per (work_unit_id, repo, pr_number).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.recorded_at IS
            'When coord recorded the retraction decision.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_retractions.applied_at IS
            'When the citation row was deleted on observing the land. NULL unless state reached applied.'
        """
    )


def downgrade() -> None:
    """Drop both tables. Their indexes, constraints and comments go with them."""
    op.execute("DROP TABLE IF EXISTS coord.work_unit_citation_retractions")
    op.execute("DROP TABLE IF EXISTS coord.pr_body_citation_watermarks")
