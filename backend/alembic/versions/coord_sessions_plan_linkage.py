"""coord.sessions plan-linkage columns — correlation_topic + plan_slug

Revision ID: coord_sessions_plan_linkage
Revises: twin_02_coord_infra_drift_observations
Create Date: 2026-05-30

Phase 7.0 of the coord-push-wiring plan
(``D:/qontinui-root/plans/2026-05-30-coord-push-wiring.md``).

Adds two **nullable** plain-text columns to ``coord.sessions`` so a session
becomes *plan-aware* — i.e. the Decision Engine's coord-push loop can correlate
a live operator session back to the plan it is executing and the correlation
topic that fans its events out across machines:

* ``correlation_topic TEXT`` (nullable) — the dynamic by-correlation-topic
  rendezvous slug the runner / Decision Engine uses to group cooperating
  sessions for the coord-push loop. Nullable because greenfield / ad-hoc
  sessions have no correlation topic.
* ``plan_slug TEXT`` (nullable) — the slug of the plan this session is
  executing (e.g. ``2026-05-30-coord-push-wiring``). Nullable because not
  every session is plan-scoped.

Idempotency / authorship posture
================================

* DDL uses ``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS`` raw SQL —
  matching the ``coord.*`` migration house style (see
  ``coord_session_substrate``). coord also boots against this same schema, so
  re-running against an already-applied DB must be a no-op.
* **alembic is the SOLE author of the coord.* schema.** There is deliberately
  NO Rust ``CREATE``/``ALTER`` self-heal for these columns — the coord crate's
  ``coord_schema_authorship`` test asserts the live Rust coord.* DDL set is
  empty. The Rust side only SELECTs / INSERTs / UPDATEs these columns.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessions_plan_linkage"
down_revision: str = "twin_02_coord_infra_drift_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS correlation_topic TEXT"
    )
    op.execute("ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS plan_slug TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS plan_slug")
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS correlation_topic")
