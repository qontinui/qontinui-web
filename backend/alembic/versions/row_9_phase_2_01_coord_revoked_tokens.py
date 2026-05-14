"""row 9 phase 2 01 coord.revoked_tokens

Revision ID: row_9_phase_2_01_revoked_tokens
Revises: coord_phase_1_01_agent_worktrees
Create Date: 2026-05-14

Row 9 Phase 2 of the failure-modes-at-scale design
(``D:/qontinui-root/plans/2026-05-14-failure-modes-at-scale-design.md``
§3.3 "Auth at scale: coord-issued scoped JWTs"). Creates
``coord.revoked_tokens`` — the revocation list checked by every JWT
verifier in the fleet.

The model:

* JWTs carry a ``jti`` (JWT ID, UUID v7 minted at issuance).
* Verification is signature-only by default — no DB call per request.
* When a token is explicitly revoked (compromised agent, suspicious
  activity, etc.) the ``jti`` is inserted here. The revocation event is
  published on JetStream ``events.auth.revocation`` (durable, replayable
  channel from §3.1) so verifiers can populate an in-memory bloom set
  and skip the DB lookup on the fast path.
* TTLs are short (4h per §3.3) so revocation rows live ~4h on average
  — a fully-natural-expiry token never needs revoking.

Schema choices:

* ``jti`` is the primary key. JTIs are UUIDs minted by coord at
  issuance; duplicates would be a coord bug.
* ``agent_id`` is informational (the JWT's ``sub`` claim) — denormalised
  for audit lookups by agent. Not a FK because ``coord.agent_worktrees``
  rows can be swept while a revocation row outlives them.
* ``machine_id`` is informational (the JWT's ``machine_id`` claim) for
  the same audit-trail reason. Nullable.
* ``reason`` is opaque text — operator note or automated-detection tag.
* ``revoked_at`` defaults to ``now()``. Replication lag in a future HA
  setup means subscribers' clocks may differ; the DB clock is the
  canonical timestamp.
* ``expires_at`` lets a sweeper (out of scope here, future row) drop
  rows whose JWT has naturally expired and can no longer be presented.
  Caller supplies it — coord knows the issuance time + TTL.

Index on ``agent_id`` supports the audit query "what tokens have been
revoked for this agent?" expected during incident response. No index on
``revoked_at`` — date-range scans are forensic, not hot.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "row_9_phase_2_01_revoked_tokens"
down_revision: str = "coord_phase_1_01_agent_worktrees"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "revoked_tokens",
        sa.Column(
            "jti",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "agent_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "machine_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "revoked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "reason",
            sa.Text(),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("jti", name="revoked_tokens_pk"),
        schema="coord",
    )
    op.create_index(
        "idx_revoked_tokens_agent_id",
        "revoked_tokens",
        ["agent_id"],
        schema="coord",
    )
    op.create_index(
        "idx_revoked_tokens_expires_at",
        "revoked_tokens",
        ["expires_at"],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_revoked_tokens_expires_at",
        table_name="revoked_tokens",
        schema="coord",
    )
    op.drop_index(
        "idx_revoked_tokens_agent_id",
        table_name="revoked_tokens",
        schema="coord",
    )
    op.drop_table("revoked_tokens", schema="coord")
