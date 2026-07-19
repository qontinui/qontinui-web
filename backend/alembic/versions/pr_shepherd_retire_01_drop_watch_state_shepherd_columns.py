"""pr shepherd retire 01 — drop the PR-shepherd's pr_watch_state additions

Revision ID: pr_shepherd_retire_01
Revises: coord_policy_clauses_01
Create Date: 2026-07-19

Phase 2 of the runner-steward-button-and-pr-shepherd-retirement plan
(``qontinui-dev-notes/plans/2026-07-19-runner-steward-button-and-pr-shepherd-retirement.md``
§4 Part 2 + §5 Phase 2).

The auto-spawned PR shepherd (plan ``2026-07-04-runner-pr-shepherd``, SHIPPED
2026-07-11) is being deleted from qontinui-runner: a week-long observe window
(2026-07-12 -> 07-19) came back null, and the seeder was found to be
structurally blind to PRs opened outside a runner-hosted terminal (see the
retirement plan's Motivation section, and memory
``project_pr_shepherd_observe_week``).

``project.pr_watch_state`` itself is PRE-EXISTING and NOT dropped here — it
was created by ``consolidation_phase1_20_tail_specialty.py`` for the
unrelated CI-red auto-resume watcher, which predates the shepherd and keeps
working after this migration. The shepherd only ever ADDED to that table, and
did so out-of-band via a runner-side self-heal
(``PgDb::verify_and_provision`` / the former ``PR_WATCH_STATE_SELF_HEAL_SQL``
constant in ``qontinui-runner/src-tauri/src/database/pg/mod.rs``) rather than
through an alembic revision — no prior migration in this tree references
``authoring_session_id`` / ``first_fully_green_at`` / ``idx_prw_session_pr``.
This revision is therefore the first alembic-authored statement about these
columns; every DDL below is defensive (``IF EXISTS`` / ``IF NOT EXISTS``) so
it is a clean no-op on a DB that never ran the runner-side self-heal at all.

Reverts, on ``project.pr_watch_state``:

* Drops the partial unique index ``idx_prw_session_pr`` (was
  ``(authoring_session_id, pr_number) WHERE task_run_id IS NULL``) — the
  session-keyed watch identity the shepherd's interactive-session seeds used.
* Drops column ``authoring_session_id`` — the coord session id for
  session-keyed (task-run-less) watches.
* Drops column ``first_fully_green_at`` — the green-but-unmerged detector's
  per-head streak clock.
* Restores ``task_run_id NOT NULL`` — the shepherd dropped this constraint
  to allow session-keyed rows with no task run. Restoring it is preceded by
  a hard pre-check (mirrors ``coord_tenant_id_not_null.py``'s posture): any
  row still carrying a NULL ``task_run_id`` fails the migration loudly rather
  than being silently dropped or coerced. The shepherd's autoseed/diagnose
  gates defaulted OFF for the entire observe window (device-local,
  opt-in-only), so no session-keyed rows are expected to exist in practice —
  but this migration does not assume that; it verifies it.

Confirmed safe to drop (plan §6 Q6): grepping qontinui-web and
qontinui-coord/src for ``authoring_session_id`` / ``first_fully_green_at``
returned zero hits outside the runner — no other consumer reads these
columns.

downgrade() re-adds the columns and index in their original (shepherd)
shape, then drops the NOT NULL constraint again — a true inverse, restoring
the exact schema the runner's self-heal used to maintain.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pr_shepherd_retire_01"
down_revision: str = "coord_policy_clauses_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the shepherd's pr_watch_state additions; restore task_run_id NOT NULL."""
    # The session-keyed identity index goes first — it depends on
    # authoring_session_id, and dropping it before the column keeps every
    # statement independently safe to re-run.
    op.execute("DROP INDEX IF EXISTS project.idx_prw_session_pr")

    op.execute(
        "ALTER TABLE project.pr_watch_state DROP COLUMN IF EXISTS authoring_session_id"
    )
    op.execute(
        "ALTER TABLE project.pr_watch_state DROP COLUMN IF EXISTS first_fully_green_at"
    )

    # Pre-check posture mirrors coord_tenant_id_not_null.py: hard-fail with a
    # descriptive RAISE EXCEPTION if any row still has a NULL task_run_id
    # (a session-keyed shepherd watch with nothing to re-attribute to)
    # instead of silently deleting rows or leaving the column nullable.
    op.execute(
        """
        DO $$
        DECLARE null_count INTEGER;
        BEGIN
            SELECT COUNT(*) INTO null_count
                FROM project.pr_watch_state WHERE task_run_id IS NULL;
            IF null_count > 0 THEN
                RAISE EXCEPTION 'cannot SET NOT NULL on project.pr_watch_state.task_run_id: '
                    '% row(s) still have NULL task_run_id (session-keyed PR-shepherd '
                    'watches) — resolve or delete them before re-running this migration',
                    null_count;
            END IF;
        END
        $$;
        """
    )
    op.execute(
        "ALTER TABLE project.pr_watch_state ALTER COLUMN task_run_id SET NOT NULL"
    )


def downgrade() -> None:
    """Re-add the shepherd's columns/index; drop task_run_id NOT NULL again.

    Mirrors the exact shape the runner's (now-deleted) self-heal DDL used to
    maintain, so this is a true inverse of upgrade().
    """
    op.execute(
        "ALTER TABLE project.pr_watch_state ALTER COLUMN task_run_id DROP NOT NULL"
    )
    op.execute(
        "ALTER TABLE project.pr_watch_state "
        "ADD COLUMN IF NOT EXISTS authoring_session_id TEXT"
    )
    op.execute(
        "ALTER TABLE project.pr_watch_state "
        "ADD COLUMN IF NOT EXISTS first_fully_green_at TIMESTAMPTZ"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_prw_session_pr "
        "ON project.pr_watch_state (authoring_session_id, pr_number) "
        "WHERE task_run_id IS NULL"
    )
