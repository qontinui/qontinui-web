"""coord.leader_terms and coord.merge_lane_intervals — the merge-lane availability ledger

Revision ID: merge_lane_ledger_01
Revises: ci_read_token_02
Create Date: 2026-10-25

Phases 1 and 2 (schema half) of plan
``2026-10-16-no-read-says-which-term-bounds-a-merge-lane`` (its D2 and D4).
No read today says which leadership term bounded a stalled merge lane, or why
a lane went hours without a land. This revision adds the two durable stores the
plan's coord writers fill; the writers, the backfills and the reader live in
the coord PRs.

``coord.leader_terms`` — one row per leadership TERM (plan D2)
    ``scope`` / ``holder_id`` / ``fenced_token`` mirror ``coord.leader_lease``
    for the term: the term is identified by ``(scope, fenced_token)``
    (``uq_leader_terms_scope_token``), which is also the conflict target of the
    writer's ``INSERT … ON CONFLICT (scope, fenced_token) DO NOTHING``, so a
    replica that re-observes its own lease opens nothing new.

    ``build_id`` is the leader's build sha / id, NULL when unknown — always
    NULL on a backfilled row.

    ``lost_at`` / ``reason`` are NULL together while the term is open and set
    together when it closes (``ck_leader_terms_close_paired``). ``reason`` is
    ``lease_expired`` (closed by the acquirer on a takeover — the one place a
    lease that expired under a live but wedged holder is knowable),
    ``shutdown`` (an orderly yield), ``deploy`` (an orderly yield with a
    reliable rollout signal) or ``unknown`` (the startup reconcile, and every
    backfilled close). The ledger never guesses a reason.

    ``source`` is ``observed`` (written live) or ``backfill`` (derived from
    ``coord.leader_worker_runs`` fenced_token transitions).

    ``ix_leader_terms_scope_acquired`` serves "terms in this scope, newest
    first"; the partial ``ix_leader_terms_open`` serves the open-term close
    every acquisition and the startup reconcile perform.

``coord.merge_lane_intervals`` — the cause-attributed availability ledger (plan D4)
    One row per interval in which a repo went longer than G_min = 1 h without a
    land while it had queued landable work OR its ``main`` was red. A red
    ``main`` opens an interval whatever is queued. ``started_at`` is the gap
    start (the moment the lane last landed, or the moment ``main`` went red), so
    the served hours at G = 1, 2 and 3 h are the intervals whose
    ``coalesce(ended_at, now()) - started_at >= G``; the served default G is 2 h.
    ``ended_at`` is NULL while the interval is open.

    ``cause`` is one of ``ci_offline``, ``billing``, ``red_main``,
    ``leader_change``, ``rollout``, ``hung_candidate``,
    ``control_plane_deferral``, ``unknown``. ``candidate_state`` (``none``,
    ``in_flight``, ``stalled``, …) is a CAUSE FIELD, never a filter, and is free
    text on purpose. ``evidence_ref`` points at the rows that justified the
    cause. ``source`` is ``observed`` or ``backfill``.

    The writer is leader-only and idempotent on ``(repo, started_at)``
    (``uq_merge_lane_intervals_repo_started``).
    ``ix_merge_lane_intervals_tenant_repo_started`` serves the per-tenant,
    per-repo newest-first read; the partial ``ix_merge_lane_intervals_open``
    serves the writer's "is an interval open for this repo" probe.

No foreign keys: a term outlives its replica, and an interval row is history
that must not follow a repo or tenant deletion.

Hand-authored; ``alembic revision --autogenerate`` was not run and is never run
against ``coord.*``. coord authors **zero** DDL
(``[policy: production-and-cost alembic-sole-authorship]``), so this revision
must merge **before** the coord PRs that read and write these tables. Plan
intent for the coord side: until this has applied, the writers log and the
reader serves UNKNOWN; neither crashes nor answers 500.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout, matching the
``coord.*`` migration house style. Creating new tables and their indexes takes
no lock on any existing relation, so no ``lock_timeout`` is set.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "merge_lane_ledger_01"
down_revision: str | Sequence[str] | None = "ci_read_token_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.leader_terms (
            id            BIGSERIAL   PRIMARY KEY,
            scope         TEXT        NOT NULL,
            holder_id     UUID        NOT NULL,
            fenced_token  BIGINT      NOT NULL,
            build_id      TEXT        NULL,
            acquired_at   TIMESTAMPTZ NOT NULL,
            lost_at       TIMESTAMPTZ NULL,
            reason        TEXT        NULL,
            source        TEXT        NOT NULL DEFAULT 'observed',
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_leader_terms_scope_token UNIQUE (scope, fenced_token),
            CONSTRAINT ck_leader_terms_reason
                CHECK (reason IS NULL OR reason IN (
                    'lease_expired', 'shutdown', 'deploy', 'unknown'
                )),
            CONSTRAINT ck_leader_terms_source
                CHECK (source IN ('observed', 'backfill')),
            CONSTRAINT ck_leader_terms_close_paired
                CHECK ((lost_at IS NULL) = (reason IS NULL))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_leader_terms_scope_acquired
            ON coord.leader_terms (scope, acquired_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_leader_terms_open
            ON coord.leader_terms (scope)
            WHERE lost_at IS NULL
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.merge_lane_intervals (
            id               BIGSERIAL   PRIMARY KEY,
            tenant_id        UUID        NOT NULL,
            repo             TEXT        NOT NULL,
            started_at       TIMESTAMPTZ NOT NULL,
            ended_at         TIMESTAMPTZ NULL,
            cause            TEXT        NOT NULL,
            candidate_state  TEXT        NULL,
            evidence_ref     JSONB       NOT NULL DEFAULT '{}'::jsonb,
            source           TEXT        NOT NULL DEFAULT 'observed',
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_merge_lane_intervals_repo_started
                UNIQUE (repo, started_at),
            CONSTRAINT ck_merge_lane_intervals_cause
                CHECK (cause IN (
                    'ci_offline', 'billing', 'red_main', 'leader_change',
                    'rollout', 'hung_candidate', 'control_plane_deferral',
                    'unknown'
                )),
            CONSTRAINT ck_merge_lane_intervals_source
                CHECK (source IN ('observed', 'backfill'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_lane_intervals_tenant_repo_started
            ON coord.merge_lane_intervals (tenant_id, repo, started_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_merge_lane_intervals_open
            ON coord.merge_lane_intervals (repo)
            WHERE ended_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_lane_intervals_open")
    op.execute("DROP INDEX IF EXISTS coord.ix_merge_lane_intervals_tenant_repo_started")
    op.execute("DROP TABLE IF EXISTS coord.merge_lane_intervals")
    op.execute("DROP INDEX IF EXISTS coord.ix_leader_terms_open")
    op.execute("DROP INDEX IF EXISTS coord.ix_leader_terms_scope_acquired")
    op.execute("DROP TABLE IF EXISTS coord.leader_terms")
