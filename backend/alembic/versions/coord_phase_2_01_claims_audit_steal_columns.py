"""coord phase 2 01 claims_audit steal columns

Revision ID: coord_phase_2_01_claims_audit_steal_columns
Revises: fleet_phase_1_01_machine_budget, ud01_unify_devices_registry
Create Date: 2026-05-18

Phase 2 of plan
``D:/qontinui-root/plans/2026-05-18-agent-spawn-coordination.md``.

Adds two nullable columns to ``coord.claims_audit`` to support the new
explicit-steal endpoint ``POST /coord/claims/steal`` (qontinui-coord):

* ``stolen_by_machine_id UUID NULL`` — the machine_id of the caller that
  invoked the steal endpoint. Non-NULL only on rows authored by the
  explicit-steal path (``event='admin_stolen'``). Bare UUID with no FK,
  matching the soft-link convention for ``claims_audit.machine_id``.
* ``steal_reason TEXT NULL`` — free-text rationale supplied by the
  caller (e.g., "agent appears stuck", "user re-spawned same plan").

The pre-existing ``event='stolen'`` rows are written by the heartbeat
path (``claims.rs:813``) when a holder's next heartbeat finds the Redis
key gone — semantically "heartbeat noticed the key vanished" (could be
TTL expiry OR another caller's steal). Phase 2's explicit-steal endpoint
uses the new literal ``event='admin_stolen'`` so the two paths are
distinguishable in the audit log without overloading the existing
literal.

Per Phase 1 integration spec §2.4 (read-only verification): no FK on
``stolen_by_machine_id``, matching the soft-link convention. Additive
columns only — no behavioral break for existing callers.

Sibling-head merge: this revision merges the two heads
``fleet_phase_1_01_machine_budget`` and
``ud01_unify_devices_registry`` per
[[feedback_alembic_sibling_head_merge]]. The single-line
``down_revision`` tuple is intentional — the ``alembic-graph-pr.yml``
gate's offline parser regex matches ``^down_revision: ... = (...)$`` on
one physical line per [[feedback_alembic_merge_revision_single_line_tuple]].
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_phase_2_01_claims_audit_steal_columns"
down_revision: tuple[str, str] = ("fleet_phase_1_01_machine_budget", "ud01_unify_devices_registry")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "claims_audit",
        sa.Column(
            "stolen_by_machine_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment=(
                "machine_id of the caller that invoked POST "
                "/coord/claims/steal; NULL on all other event paths"
            ),
        ),
        schema="coord",
    )
    op.add_column(
        "claims_audit",
        sa.Column(
            "steal_reason",
            sa.Text(),
            nullable=True,
            comment=(
                "Free-text rationale supplied to POST /coord/claims/steal; "
                "NULL on all other event paths"
            ),
        ),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("claims_audit", "steal_reason", schema="coord")
    op.drop_column("claims_audit", "stolen_by_machine_id", schema="coord")
