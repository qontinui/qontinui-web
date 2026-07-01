"""Add 'speculative-ci' to coord.merge_proposals status CHECK.

The speculative merge pipeline (qontinui-coord merge scheduler) writes a
new intermediate proposal status ``speculative-ci`` at
``src/merge_scheduler.rs:2736``: when a candidate is speculatively rebased
and pushed for a CI dry-run ahead of the actual land, the proposal is
parked in ``speculative-ci`` while the speculative CI resolves. The Rust
side assumed ``merge_proposals.status`` was free-form TEXT — it is not:
``merge_proposals_status_chk`` (coord_phase_3_01_merge_proposals.py, later
extended by coord_shadow_land_01_status_chk.py) enumerates the allowed
states, and the speculative UPDATE violates it —

    new row for relation "merge_proposals" violates check constraint
    "merge_proposals_status_chk"
    DETAIL: Failing row contains (..., speculative-ci, ...)

— so every speculative-CI transition rolls back, silently killing the
speculative merge pipeline (the write never lands, the proposal never
advances). This migration is the unblock: recreate the CHECK with
``speculative-ci`` appended.

Constraint swap is transactional and instant (no table scan beyond
validation of existing rows, all of which are already in one of the nine
prior states).

Downgrade restores the prior nine-state constraint; any ``speculative-ci``
rows would block the downgrade by design (they are live speculative
proposals — resolve them consciously or don't downgrade).

The Rust mirror is ``STATUSES`` in qontinui-coord ``src/merge.rs``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_specq_01_speculative_ci_status"
down_revision: str = "coord_helper_tasks_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# coord_shadow_land_01's ALLOWED_STATUSES + the speculative-CI intermediate
# state. The Rust mirror is `STATUSES` in qontinui-coord src/merge.rs.
ALLOWED_STATUSES = (
    "queued",
    "dry-rebasing",
    "awaiting-ci",
    "landing",
    "blocked-by-overlap",
    "conflict",
    "merged",
    "cancelled",
    "shadow-landed",
    "speculative-ci",
)

_ORIGINAL_STATUSES = ALLOWED_STATUSES[:-1]


def upgrade() -> None:
    allowed = ", ".join(f"'{s}'" for s in ALLOWED_STATUSES)
    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "DROP CONSTRAINT IF EXISTS merge_proposals_status_chk"
    )
    op.execute(
        f"ALTER TABLE coord.merge_proposals "
        f"ADD CONSTRAINT merge_proposals_status_chk "
        f"CHECK (status IN ({allowed}))"
    )


def downgrade() -> None:
    allowed = ", ".join(f"'{s}'" for s in _ORIGINAL_STATUSES)
    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "DROP CONSTRAINT IF EXISTS merge_proposals_status_chk"
    )
    op.execute(
        f"ALTER TABLE coord.merge_proposals "
        f"ADD CONSTRAINT merge_proposals_status_chk "
        f"CHECK (status IN ({allowed}))"
    )
