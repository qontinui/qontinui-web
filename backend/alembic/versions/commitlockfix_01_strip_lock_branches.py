"""commit-lock-fix 01 — strip spurious '.lock' branch attribution from coord.commit_*

Revision ID: commitlockfix_01_strip_lock_branches
Revises: replaycols_01_gates_continuation
Create Date: 2026-06-07

One-time DATA cleanup (no schema change).

The pre-#439 runner ``git_watcher`` watched ``.git/refs/heads/`` for commit
events but did NOT filter the transient ``<branch>.lock`` file git writes (then
renames) during a ref update. It therefore parsed the lock-file path as the
commit's ref and forwarded observations with ``branch = "<realbranch>.lock"``
(e.g. ``main.lock``), often emitting the lock event AND the real-ref event so a
single commit produced both a ``<branch>.lock`` row and a correct ``<branch>``
row. Runner #439 (``3568cb99``, ignore ref lock files) fixed the source; this
migration repairs the rows already written.

Why it matters (not cosmetic): ``branch`` is consumed by the supervision logic —
the per-``(repo, branch)`` message-rewrite *prior* (read from
``coord.commit_verifications``, flips the predicted hook behaviour),
declare-contention detection (``WHERE repo=$1 AND branch=$2``), and the Phase-4
per-``(repo, branch)`` threshold. A ``main.lock`` bucket never trains the ``main``
prior and builds a bogus one, degrading prediction quality.

Strategy (per table):
* ``coord.commit_observations`` (has ``head_sha``): drop each ``.lock`` row that
  already has a correctly-branched twin for the same ``(repo, head_sha)`` (pure
  duplicate), then strip the suffix from any remaining ``.lock``-only rows.
* ``coord.commit_verifications`` / ``coord.commit_signatures`` (no ``head_sha``):
  strip the suffix in place. (Signatures are declare-sourced, not
  git_watcher-sourced, so corruption there is not expected — the strip is
  defensive and a no-op if no rows match.)

The ``coord.*`` schema is Alembic-owned (qontinui-coord/Rust asserts presence,
never mutates), so a coord data fix is authored here, mirroring the
``commit_effect_01_coord_commit_tables`` precedent.

Irreversible (a one-time data repair): ``downgrade`` is a deliberate no-op so it
does not block downgrading the chain past this revision.
"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "commitlockfix_01_strip_lock_branches"
down_revision: str = "replaycols_01_gates_continuation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

_LOCK_TABLES = (
    "commit_observations",
    "commit_verifications",
    "commit_signatures",
)


def _count_lock(bind: sa.engine.Connection, table: str) -> int:
    return (
        bind.execute(
            sa.text(
                f"SELECT count(*) FROM coord.{table} WHERE branch LIKE '%.lock'"
            )
        ).scalar()
        or 0
    )


def upgrade() -> None:
    bind = op.get_bind()

    for table in _LOCK_TABLES:
        logger.info(
            "commitlockfix: coord.%s has %d '.lock' branch row(s) pre-cleanup",
            table,
            _count_lock(bind, table),
        )

    # --- coord.commit_observations: de-dup against the clean twin, then strip ---
    # (a) Drop a '.lock' row when a correctly-branched row for the same commit
    #     already exists — removes the duplicate the pre-#439 double-emit created.
    dropped = bind.execute(
        sa.text(
            r"""
            DELETE FROM coord.commit_observations o
            WHERE o.branch LIKE '%.lock'
              AND EXISTS (
                    SELECT 1
                    FROM coord.commit_observations c
                    WHERE c.repo = o.repo
                      AND c.head_sha = o.head_sha
                      AND c.branch = regexp_replace(o.branch, '\.lock$', '')
              )
            """
        )
    ).rowcount
    # (b) Recover any remaining '.lock'-only rows (no clean twin) in place.
    recovered = bind.execute(
        sa.text(
            r"""
            UPDATE coord.commit_observations
            SET branch = regexp_replace(branch, '\.lock$', '')
            WHERE branch LIKE '%.lock'
            """
        )
    ).rowcount
    logger.info(
        "commitlockfix: coord.commit_observations — dropped %d duplicate '.lock' "
        "row(s), recovered %d '.lock'-only row(s)",
        dropped,
        recovered,
    )

    # --- coord.commit_verifications / commit_signatures: strip in place ---------
    for table in ("commit_verifications", "commit_signatures"):
        n = bind.execute(
            sa.text(
                rf"""
                UPDATE coord.{table}
                SET branch = regexp_replace(branch, '\.lock$', '')
                WHERE branch LIKE '%.lock'
                """
            )
        ).rowcount
        logger.info("commitlockfix: coord.%s — stripped %d '.lock' row(s)", table, n)

    for table in _LOCK_TABLES:
        remaining = _count_lock(bind, table)
        logger.info(
            "commitlockfix: coord.%s has %d '.lock' branch row(s) post-cleanup",
            table,
            remaining,
        )
        assert remaining == 0, f"coord.{table} still has '.lock' branch rows"


def downgrade() -> None:
    # One-time, irreversible data repair: the original '.lock'-corrupted branch
    # values are not reconstructable. Intentional no-op so downgrading the chain
    # past this revision is not blocked.
    pass
