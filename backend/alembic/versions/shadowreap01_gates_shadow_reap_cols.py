"""coord.gates — shadow-reap audit columns (gate-reaper Tier 4 SHADOW)

Revision ID: shadowreap01
Revises: devenv_01
Create Date: 2026-06-25

Adds two nullable shadow-reap audit columns + one partial "shadow would-reap"
index to ``coord.gates`` for plan ``2026-06-25-shadow-reaper-persist-for-audit``
(the Tier-4 ``ai_gate_reaper`` running in SHADOW). Each shadow cycle, the reaper
records the cited abandonment signal it WOULD reap an OPEN gate on rather than
acting — so the would-reap set is auditable and the operator can judge per-class
false-positive rates before arming the reaper live.

- ``shadow_reap_signal TEXT NULL`` — the cited abandonment signal the reaper
  would reap this gate on. Non-NULL ⇔ this OPEN gate is a current shadow
  would-reap. NULL (the default at every existing call site) ⇒ not a shadow
  would-reap candidate.
- ``shadow_reap_at TIMESTAMPTZ NULL`` — when the most recent shadow cycle
  stamped ``shadow_reap_signal`` on this gate.

A partial index ``idx_gates_shadow_reap`` over ``(tenant_id) WHERE
shadow_reap_signal IS NOT NULL`` keeps the per-tenant shadow would-reap scan
fast (mirrors ``idx_gates_live``). The predicate references only the immutable
``shadow_reap_signal IS NOT NULL`` constant comparison, so there is no
IMMUTABLE-predicate hazard.

## House conventions followed

Raw ``op.execute`` (not ``op.add_column``) with ``ADD COLUMN IF NOT EXISTS`` /
``CREATE INDEX IF NOT EXISTS`` so the migration is collision-safe against any
canonical PG that might already carry the columns from a self-heal mirror —
same convention as ``coord_gates_observation_cols``,
``coord_singleauthored_01_gates``, and ``gatesarchival01``.

Touches **only** ``coord.gates`` (an ALTER of an existing table, created
earlier in this same linear chain). It is NOT added to any
``ALEMBIC_OWNED_TABLES`` list — the table already exists; this revision only
ALTERs it.

NOTE: ``down_revision`` is ``trackd_drop_merge_escalations_meta`` as assigned by
the coord migration-reservation handshake — this migration is STACKED behind
qontinui-web #648 (which reserved ``trackd_drop_merge_escalations_meta``, chaining
off ``coord_gates_progress_cols_01``). #648 must land first; until then the
``alembic-heads-pr`` gate reports two heads (expected for a stacked migration —
coord's merge train rebases + re-checks this PR once #648 merges). Do NOT re-point
to ``coord_gates_progress_cols_01``: that would fork the chain once #648 lands and
breaks ``verify-claim`` (the file parent must match the reservation parent).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "shadowreap01"
down_revision: str | Sequence[str] | None = "devenv_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS shadow_reap_signal TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS shadow_reap_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_gates_shadow_reap
            ON coord.gates (tenant_id)
            WHERE shadow_reap_signal IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_gates_shadow_reap")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS shadow_reap_at")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS shadow_reap_signal")
