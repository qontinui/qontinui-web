"""twin git 01 coord.git_ref_events — Ξ_Git ref-mutation oplog + repo_branches.close_cause

Revision ID: twin_git_01_coord_git_ref_events
Revises: bridge_audit_log_01
Create Date: 2026-06-02

Phase 1 of the Ξ_Git twin-observer plan
(``D:/qontinui-root/plans/2026-05-31-twin-git-refs-observer.md`` §3.1, §3.3, §6).

coord's charter includes acting as a **digital twin of the git environment**.
The 2026-05-31 "PR reaper" incident
(``[[proj_coord_outbound_mirror_prune_reaper]]``) exposed that the twin watched
external state but had no append-only record of *ref-level mutations* and no
attribution of *why* a PR closed. This migration lays down the Phase-1 (observe)
storage: a ref-mutation oplog + a free-TEXT ``close_cause`` column on the
existing branch-state cache. No behavior change rides on this migration — coord
Rust code (``repo_branches.rs``) writes these rows from the already-existing
``push`` / ``create`` / ``delete`` / ``pull_request`` webhook ingest path.

This migration is **alembic-sole-author** for ``coord.*`` (coord Rust code only
reads/writes rows, never DDL); coord CI's ``coord-db-tests`` provisions schema
via web's migrator image, so the table must exist here for the coord-side ingest
tests to pass.

--------------------------------------------------------------------------------
1. CREATE TABLE ``coord.git_ref_events`` — append-only ref-mutation oplog (§3.1)
--------------------------------------------------------------------------------

Each row is one observed mutation of one git ref on one governed repo. This is a
*distinct* structure from ``coord.repo_branches`` (a current-state cache keyed
``(repo, branch)``): ``git_ref_events`` is **history**, never updated in place,
and intentionally carries **no unique constraint** — the same ``(repo, ref)``
recurs on every push/create/delete. ``push`` porcelain-style deltas give the
per-ref create/update/delete in the ``change_type`` column.

Columns:

* ``id``                — BIGSERIAL PK.
* ``repo``              — full_name, e.g. ``qontinui/qontinui-coord``.
* ``ref``               — full ref, e.g. ``refs/heads/foo`` / ``refs/tags/v1``.
* ``ref_type``          — closed set ``branch`` | ``tag`` (CHECK).
* ``change_type``       — closed set ``create`` | ``update`` | ``delete`` (CHECK);
                          the per-ref delta derived from before/after SHAs (push)
                          or from the create/delete event itself.
* ``old_sha``           — nullable; NULL on create (GitHub sends a zero-OID,
                          which coord normalizes to NULL) and on SHA-less
                          create/delete events.
* ``new_sha``           — nullable; NULL on delete (zero-OID normalized to NULL)
                          and on SHA-less events.
* ``actor``             — nullable; GitHub ``sender.login`` (the token owner the
                          webhook attributes the mutation to). Note GitHub never
                          surfaces "the outbound_mirror loop" here — only the PAT
                          owner — which is exactly why §3.2's intent ledger (a
                          later phase) is the missing self-attribution primitive.
* ``actor_is_bot``      — ``sender.type == 'Bot'``; NOT NULL DEFAULT false.
* ``integration_hint``  — nullable; a GitHub App slug if trivially derivable from
                          the payload, else NULL. Phase 1 leaves this NULL unless
                          the value is free (the push/branch payloads don't carry
                          a reliable App slug, so it stays NULL for now).
* ``received_at``       — TIMESTAMPTZ NOT NULL DEFAULT NOW(); insert clock. NOT
                          used in any partial-index predicate
                          (cf. reference_alembic_now_index_and_offline_sql_gap).

Indexes:

* ``idx_git_ref_events_repo_ref``     — btree ``(repo, ref)`` for the
  "lifecycle of this ref" lookup (the ``coord_explain_ref_event`` query, Phase 5).
* ``idx_git_ref_events_received_at``  — btree ``received_at DESC`` for the
  recent-window / rate-baseline scans (INV-4, Phase 3).

--------------------------------------------------------------------------------
2. ADD COLUMN ``coord.repo_branches.close_cause`` (§3.3)
--------------------------------------------------------------------------------

A nullable, free-TEXT column carrying the computed cause when a PR transitions
to a closed/merged state, or when an open-PR-backed branch is reaped by a ref
delete. Vocabulary (still being calibrated, hence **no CHECK** — same rationale
as ``coord.config_observations.drift_class`` being free TEXT):

* ``merged``                       — the PR merged.
* ``author_closed``                — closed (not merged) by the PR author.
* ``branch_deleted_by(<actor>)``   — the reaper signature: an open PR's head ref
                                     deleted by ``<actor>``.
* ``commits_landed_via_other_pr``  — closed-not-merged but head landed elsewhere
                                     (Phase 1 only sets this when cheaply
                                     determinable from the webhook payload).
* ``unexplained``                  — closed, none of the above.

Additive + nullable ⇒ **expand/contract-safe** under the repo's forward-only
alembic posture: a rolled-back prior app simply ignores the new column.

DDL is emitted ``IF NOT EXISTS`` (raw ``op.execute``) so a re-apply against a
partially-migrated DB is a no-op — matching the idempotent posture requested for
this twin layer.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_git_01_coord_git_ref_events"
down_revision: str | Sequence[str] | None = "bridge_audit_log_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # coord schema is created by earlier coord migrations; guard anyway so this
    # file is self-contained / idempotent.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # 1. Append-only ref-mutation oplog. Raw IF NOT EXISTS DDL for idempotency.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.git_ref_events (
            id               BIGSERIAL PRIMARY KEY,
            repo             TEXT NOT NULL,
            ref              TEXT NOT NULL,
            ref_type         TEXT NOT NULL,
            change_type      TEXT NOT NULL,
            old_sha          TEXT,
            new_sha          TEXT,
            actor            TEXT,
            actor_is_bot     BOOLEAN NOT NULL DEFAULT false,
            integration_hint TEXT,
            received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT git_ref_events_ref_type_chk
                CHECK (ref_type IN ('branch','tag')),
            CONSTRAINT git_ref_events_change_type_chk
                CHECK (change_type IN ('create','update','delete'))
        )
        """
    )

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_git_ref_events_repo_ref "
        "ON coord.git_ref_events (repo, ref)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_git_ref_events_received_at "
        "ON coord.git_ref_events (received_at DESC)"
    )

    # 2. PR-close cause attribution column on the branch-state cache.
    #    Free TEXT (no CHECK) — vocabulary still calibrating.
    op.execute(
        "ALTER TABLE coord.repo_branches "
        "ADD COLUMN IF NOT EXISTS close_cause TEXT"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE coord.repo_branches DROP COLUMN IF EXISTS close_cause")
    op.execute("DROP INDEX IF EXISTS coord.idx_git_ref_events_received_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_git_ref_events_repo_ref")
    op.execute("DROP TABLE IF EXISTS coord.git_ref_events")
