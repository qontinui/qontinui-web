"""twin git 02 coord.git_write_ledger — Ξ_Git self-attribution intent ledger

Revision ID: twin_git_02_coord_git_write_ledger
Revises: twin_git_01_coord_git_ref_events
Create Date: 2026-06-02

Phase 2 of the Ξ_Git twin-observer plan
(``D:/qontinui-root/plans/2026-05-31-twin-git-refs-observer.md`` §3.2, §4 INV-2,
§6 Phase 2).

The reaper incident (``[[proj_coord_outbound_mirror_prune_reaper]]``) exposed the
gap that the Phase-1 ref-event oplog cannot close on its own: GitHub's
webhook/event actor only ever shows the PAT owner (``jspinak``), never "the
outbound_mirror loop" — so external observation alone cannot attribute a
destructive ref write to the coord subsystem that emitted it. **Self-attribution
via an intent ledger is the missing primitive.**

This migration lays down ``coord.git_write_ledger`` — the *declared* side of the
Ξ_Git observation space (§3.2): coord records every git write it emits **before
apply** (the intent + predicted per-ref effect) and **after apply** (the
``--porcelain`` result classified per ref). The Rust funnel
(``outbound_git::write``, this plan's Phase 2) writes these rows; coord Rust code
only reads/writes rows here, never DDL — this migration is **alembic-sole-author**
for ``coord.*``. coord CI's ``coord-db-tests`` provisions schema via web's
migrator image, so the table must exist here for the coord-side write tests to
pass.

--------------------------------------------------------------------------------
1. CREATE TABLE ``coord.git_write_ledger`` — coord's own write/intent ledger
--------------------------------------------------------------------------------

Each row is one git write coord emitted (or attempted) against a governed repo.
Unlike ``coord.git_ref_events`` (external observation, append-only, multi-ref per
push collapsed into one row each), a ledger row is one *intent* — it is INSERTed
``pending`` before apply and UPDATEd to ``applied`` / ``failed`` after.

Columns:

* ``id``                 — BIGSERIAL PK.
* ``op``                 — the git operation, closed set (CHECK):
                           ``push`` | ``force_push`` | ``delete`` | ``mirror`` |
                           ``update_ref_delete``. ``mirror`` is the
                           outbound_mirror bulk wildcard push; ``update_ref_delete``
                           is a bare-repo ``git update-ref -d`` (no push wire).
* ``repo``               — full_name / bare-repo path the write targets.
* ``initiator``          — the coord subsystem that emitted the write, closed set
                           (CHECK): ``outbound_mirror`` | ``merge_scheduler`` |
                           ``restack_engine`` | ``conflict_engine`` |
                           ``agent_ref_migrate``. This is the self-attribution
                           dimension GitHub can never surface.
* ``refspecs``           — TEXT[] of the raw git refspecs the write carried (or
                           the single full ref name for ``update_ref_delete``).
* ``predicted_effect``   — JSONB array of
                           ``{ref, change_type, old_sha, new_sha}`` where
                           ``change_type`` ∈ ``create`` | ``update`` | ``delete``
                           (mirrors ``coord.git_ref_events.change_type`` vocab).
                           The predicted-before-apply delta per ref.
* ``intended_deletions`` — TEXT[] of the full ref names predicted to be DELETED
                           (derived from ``predicted_effect`` where
                           ``change_type='delete'``). This is the INV-2 fast-lookup
                           column: Phase 4 cross-checks these against the open-PR
                           set before apply to refuse a destructive write to an
                           open-PR-backed ref. DEFAULT ``'{}'``.
* ``proposal_id``        — nullable UUID; the merge/restack proposal this write
                           realizes, when one exists.
* ``status``             — closed set (CHECK): ``pending`` (recorded, not yet
                           applied) | ``applied`` | ``failed`` | ``refused``.
                           ``refused`` is the INV-2 self-guard terminal state
                           (Phase 4): the funnel cross-checked the intended
                           deletions against the open-PR set BEFORE apply and
                           refused the destructive write (the matched
                           ``{ref, pr_number}`` rides in ``applied_result``); the
                           git op never ran. DEFAULT ``pending``.
* ``applied_result``     — nullable JSONB; filled after apply: array of
                           ``{ref, porcelain_flag, classified}`` — the per-ref
                           ``--porcelain`` classification (``=``/``*``/``+``/``-``/
                           `` ``/``!`` → up-to-date/new/forced/deleted/fast-forward/
                           rejected).
* ``created_at``         — TIMESTAMPTZ NOT NULL DEFAULT NOW(); intent-record clock.
* ``applied_at``         — nullable TIMESTAMPTZ; set when status moves terminal.

Indexes:

* ``idx_git_write_ledger_repo_created`` — btree ``(repo, created_at DESC)`` for
  the "recent writes against this repo" lookup.
* ``idx_git_write_ledger_intended_deletions`` — GIN on ``intended_deletions`` for
  the Phase-4 "does any pending/recent ledger entry intend to delete THIS ref"
  containment lookup (``intended_deletions @> ARRAY[$ref]``).

DDL is emitted ``IF NOT EXISTS`` (raw ``op.execute``) so a re-apply against a
partially-migrated DB is a no-op — matching the idempotent posture of the Phase-1
migration (``twin_git_01_coord_git_ref_events``) and the wider twin layer.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "twin_git_02_coord_git_write_ledger"
down_revision: str | Sequence[str] | None = "twin_git_01_coord_git_ref_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # coord schema is created by earlier coord migrations; guard anyway so this
    # file is self-contained / idempotent.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # 1. coord's own write/intent ledger. Raw IF NOT EXISTS DDL for idempotency.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.git_write_ledger (
            id                  BIGSERIAL PRIMARY KEY,
            op                  TEXT NOT NULL,
            repo                TEXT NOT NULL,
            initiator           TEXT NOT NULL,
            refspecs            TEXT[] NOT NULL,
            predicted_effect    JSONB NOT NULL,
            intended_deletions  TEXT[] NOT NULL DEFAULT '{}',
            proposal_id         UUID,
            status              TEXT NOT NULL DEFAULT 'pending',
            applied_result      JSONB,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            applied_at          TIMESTAMPTZ,
            CONSTRAINT git_write_ledger_op_chk
                CHECK (op IN ('push','force_push','delete','mirror','update_ref_delete')),
            CONSTRAINT git_write_ledger_initiator_chk
                CHECK (initiator IN ('outbound_mirror','merge_scheduler',
                                     'restack_engine','conflict_engine',
                                     'agent_ref_migrate')),
            CONSTRAINT git_write_ledger_status_chk
                CHECK (status IN ('pending','applied','failed','refused'))
        )
        """
    )

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_git_write_ledger_repo_created "
        "ON coord.git_write_ledger (repo, created_at DESC)"
    )
    # GIN on the TEXT[] intended_deletions for the Phase-4 INV-2 containment
    # lookup (intended_deletions @> ARRAY[$ref]).
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_git_write_ledger_intended_deletions "
        "ON coord.git_write_ledger USING GIN (intended_deletions)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_git_write_ledger_intended_deletions")
    op.execute("DROP INDEX IF EXISTS coord.idx_git_write_ledger_repo_created")
    op.execute("DROP TABLE IF EXISTS coord.git_write_ledger")
