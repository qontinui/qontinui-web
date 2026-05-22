"""pair_codes table — single-use 5-min TTL paste-pair credentials

Revision ID: pair_codes_table
Revises: coord_session_substrate
Create Date: 2026-05-23

Phase 2a.1 of plan
``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``.

Adds ``auth.pair_codes`` — short-lived, single-use codes the operator
mints from the dashboard and types into the runner Settings UI. The
runner POSTs the code to ``/api/v1/devices/pair-codes/{code}/redeem``
(unauthenticated) and gets back the same ``PairCompleteResponse`` shape
the existing ``pair-cli`` flow returns.

Why parented off ``coord_session_substrate``
--------------------------------------------
``coord_session_substrate`` is the current head as of 2026-05-22; this
revision sits cleanly downstream with no shared columns. Plan note: a
Phase-3 migration is landing in parallel from a different worktree; if
both land with this same down_revision, alembic generates parallel
heads and a downstream merge revision is required (standard alembic
flow — no coordination needed up-front).

Idempotency
-----------
The upgrade uses ``CREATE TABLE IF NOT EXISTS`` / ``CREATE INDEX IF NOT
EXISTS`` so re-running is safe. ``downgrade()`` drops the table; the
indexes go with it.
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "pair_codes_table"
down_revision: str = "coord_session_substrate"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``auth.pair_codes`` + ``expires_at`` sweep index."""
    from alembic import op

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS auth.pair_codes (
            code                  VARCHAR(6)    PRIMARY KEY,
            tenant_id             UUID          NOT NULL,
            issued_by_user_id     UUID          NOT NULL
                                                 REFERENCES auth.users(id)
                                                 ON DELETE CASCADE,
            created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
            expires_at            TIMESTAMPTZ   NOT NULL
                                                 DEFAULT (now() + INTERVAL '5 minutes'),
            redeemed_at           TIMESTAMPTZ   NULL,
            redeemed_by_device_id UUID          NULL
        )
        """
    )

    # Index for the sweep-job query (DELETE WHERE redeemed_at IS NULL
    # AND expires_at < cutoff). Without this, the sweep does a seq scan
    # — fine while the table is small, but the index keeps it cheap as
    # the dashboard sees real use.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pair_codes_expires_at
            ON auth.pair_codes(expires_at)
        """
    )

    # Index for the per-issuer lookup ("show me my recent pair codes")
    # — not strictly required for Phase 2a.1 but small + obvious.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pair_codes_issued_by_user_id
            ON auth.pair_codes(issued_by_user_id)
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pair_codes_tenant_id
            ON auth.pair_codes(tenant_id)
        """
    )


def downgrade() -> None:
    """Drop ``auth.pair_codes``; indexes go with the table."""
    from alembic import op

    op.execute("DROP TABLE IF EXISTS auth.pair_codes")
