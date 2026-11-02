"""coord.ci_runner_probes.poison_verdict_at_dispatch - the poison verdict read when the canary was dispatched

Revision ID: coord_ci_runner_probes_02
Revises: coord_tenant_github_hosts_01
Create Date: 2026-10-16

Phase 1 item 0 of plan
``2026-10-16-runner-canary-probe-mostly-not-acquired-and-its-ledger-has-no-agent-read-door``.

Adds one nullable TEXT column to ``coord.ci_runner_probes``:
``poison_verdict_at_dispatch``. The ``qontinui-coord`` ``ci_runner_probe``
module writes the poison detector verdict it read for the host (for example
``clear`` or ``suspected``) at the moment it inserts the probe row. The new
read door ``GET /coord/agent-ci-runner-ledger`` renders it as
``clear_at_dispatch`` (true, false, or null). Rows written before this column
exists stay NULL, which is UNKNOWN: the verdict is never reconstructed after
the fact.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema. The coord
change that writes and reads this column ships only after this revision is
applied in production; a coord INSERT naming the column before then fails on
every probe dispatch.

## Safety

One additive nullable column, ``ADD COLUMN IF NOT EXISTS`` so a partial apply
re-runs cleanly. No default, so PostgreSQL rewrites nothing and the lock is
momentary. ``downgrade()`` drops the column ``IF EXISTS``. Both directions are
pure static SQL, so they work under ``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_runner_probes_02"
down_revision: str | Sequence[str] | None = "coord_tenant_github_hosts_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal (merge-train migration classifier).


def upgrade() -> None:
    """Add the nullable poison_verdict_at_dispatch column and document it."""
    op.execute(
        """
        ALTER TABLE coord.ci_runner_probes
            ADD COLUMN IF NOT EXISTS poison_verdict_at_dispatch TEXT
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_probes.poison_verdict_at_dispatch IS
            'The poison detector verdict for the probed host at the moment this probe row was inserted (one of suspected | no_peer_baseline | insufficient | clear | indeterminate, the PoisonVerdict label in qontinui-coord). NULL = written before this column existed, or no verdict was readable: UNKNOWN, never clear. Text with no CHECK.'
        """
    )


def downgrade() -> None:
    """Drop the column; its comment goes with it."""
    op.execute(
        """
        ALTER TABLE coord.ci_runner_probes
            DROP COLUMN IF EXISTS poison_verdict_at_dispatch
        """
    )
