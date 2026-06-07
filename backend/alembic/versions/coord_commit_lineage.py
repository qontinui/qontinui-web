"""coord.commit_lineage — commit ↔ session lineage fact table

Revision ID: coord_commit_lineage
Revises: contcancel_01_gates_continuation_cancel_outcome
Create Date: 2026-06-07

Implements the alembic slice (Acceptance item 1) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-06-07-coord-commit-session-lineage.md``
(digital-twin expansion: "which session produced this commit?").

Stands up one new additive fact table ``coord.commit_lineage`` recording the
session a commit/PR is attributable to — replacing the retired
``Session-Id:``/``Session-Name:`` commit-trailer discipline with a recorded
fact in the digital twin. Population is out of scope for this migration (the
Merge Orchestrator hook, push-report path, and trailer backfill are
coord/runner work in sibling PRs); this revision only stands the table up so
those handler PRs target a live column set.

Schema (per plan §Design DDL block):

* ``commit_sha       TEXT PRIMARY KEY`` — the merge/squash/head commit SHA.
* ``repo             TEXT NOT NULL`` — repository (``owner/name`` or short name;
  population normalizes skew via ``split_part(repo,'/',2)``).
* ``branch           TEXT`` — the PR head branch the commit landed from.
* ``pr_number        INT``  — the orchestrator PR number, when known.
* ``agent_session_id UUID`` — the Claude Code session, FK to
  ``coord.agent_sessions(id) ON DELETE SET NULL``. Mirrors the six
  ``agent_session_id`` columns added by ``coord_agent_session_id_lineage.py``
  exactly: a GDPR session hard-delete nulls the cell rather than orphaning
  (or vaporising) the audit row.
* ``session_name     TEXT`` — denormalized human-label snapshot at record time
  (``coord.agent_sessions.label`` is the live source of truth; this is a
  point-in-time copy so a renamed/closed session still reads back its
  contemporaneous name).
* ``machine_id       TEXT`` — text, matching coord's ``(machine_id, session_id)``
  claim-key convention (machine_id is TEXT everywhere else in coord).
* ``recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now()`` — record time.
* ``source           TEXT NOT NULL`` —
  ``'merge_orchestrator'`` | ``'push_report'`` | ``'trailer_backfill'``.

Indexes (mirroring the sibling migration's pattern):

* Partial ``idx_commit_lineage_agent_session ON (agent_session_id)
  WHERE agent_session_id IS NOT NULL`` — lineage queries always filter on a
  known session UUID; keeps the index off the unattributed-NULL majority.
* ``idx_commit_lineage_repo_pr ON (repo, pr_number)`` — the orchestrator
  ``(repo, pr_number)`` lookup path.

Idempotency / authorship posture
================================

* DDL uses ``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT EXISTS`` raw
  ``op.execute`` — matching the ``coord.*`` migration house style (see
  ``coord_singleauthored_01_gates`` / ``coord_sessions_task_run_id``). coord
  boots against this same schema, so re-running against an already-applied DB
  must be a no-op.
* The partial index predicate uses only an IMMUTABLE expression (no ``now()``)
  so it is safe on real Postgres.
* **alembic is the SOLE author of the coord.* schema.** No Rust
  ``CREATE``/``ALTER`` self-heal — the coord crate's
  ``coord_schema_authorship`` test asserts the live Rust coord.* DDL set is
  empty. The Rust side only SELECTs / INSERTs into this table.

Chains off the current single head
``contcancel_01_gates_continuation_cancel_outcome`` (verified via
``python -m alembic heads`` against origin/main 2026-06-07).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_commit_lineage"
down_revision: str | Sequence[str] | None = "contcancel_01_gates_continuation_cancel_outcome"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.commit_lineage (
            commit_sha        TEXT PRIMARY KEY,
            repo              TEXT NOT NULL,
            branch            TEXT,
            pr_number         INTEGER,
            agent_session_id  UUID
                REFERENCES coord.agent_sessions(id) ON DELETE SET NULL,
            session_name      TEXT,
            machine_id        TEXT,
            recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            source            TEXT NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_commit_lineage_agent_session "
        "ON coord.commit_lineage (agent_session_id) "
        "WHERE agent_session_id IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_commit_lineage_repo_pr "
        "ON coord.commit_lineage (repo, pr_number)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_commit_lineage_repo_pr")
    op.execute("DROP INDEX IF EXISTS coord.idx_commit_lineage_agent_session")
    op.execute("DROP TABLE IF EXISTS coord.commit_lineage")
