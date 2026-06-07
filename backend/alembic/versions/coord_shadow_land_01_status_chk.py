"""Add 'shadow-landed' to coord.merge_proposals status CHECK.

Coord PR #388 (plan 2026-06-06-coord-ci-runner-autonomous-green-merge,
Phase 2) introduced a terminal ``shadow-landed`` proposal status: under
``COORD_MERGE_DRY_LAND=1`` the merge scheduler records the would-land
decision and parks the proposal instead of pushing to main. The Rust
side assumed ``merge_proposals.status`` was free-form TEXT — it is not:
``merge_proposals_status_chk`` (coord_phase_3_01_merge_proposals.py)
enumerates the allowed states, and the park UPDATE violates it.

Observed live 2026-06-07 ~03:53Z on the first production shadow land
(proposal 019e9f63-0bdf): the metric incremented and the candidate ref
was cleaned, but the terminal park failed —

    new row for relation "merge_proposals" violates check constraint
    "merge_proposals_status_chk"
    DETAIL: Failing row contains (..., shadow-landed, ...)

— leaving a zombie ``landing`` proposal that the takeover-recovery
sweep requeues on every leader roll, which re-runs candidate CI and
re-increments ``coord_merge_shadow_land_total`` (inflating the shadow-
ramp graduation metric watched by coord gate ecd7003d).

Fix: recreate the CHECK with ``shadow-landed`` appended. Constraint
swap is transactional and instant (no table scan beyond validation of
existing rows, all of which are in the original eight states).

Downgrade restores the original eight-state constraint; any
``shadow-landed`` rows would block the downgrade by design (they are
the durable shadow-ramp record — delete them consciously or don't
downgrade).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_shadow_land_01_status_chk"
down_revision: str = "commitlockfix_01_strip_lock_branches"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# coord_phase_3_01's ALLOWED_STATUSES + the Phase 2 shadow-ramp terminal
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
