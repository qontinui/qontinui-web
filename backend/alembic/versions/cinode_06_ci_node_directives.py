"""runner-as-CI-node — coord.ci_node_directives (latest accepted directive per device)

Revision ID: cinode_06_ci_node_directives
Revises: coord_conditions_02_honest_runs
Create Date: 2026-11-22

Phase 1 of plan ``2026-11-22-ci-node-directive-replays-on-connect`` (decision
D1, option B). Coord's ``dispatch_ci_node_directive`` is the one choke point
both CI-node directive doors pass (the operator door ``POST
/devenv/ci-node-dispatch`` that web's PUT calls, and the agent twin ``POST
/devenv/agent-ci-node-dispatch``). Until now it published the directive on the
device's ``device_ci`` channel and kept no copy, so a directive sent while the
device was offline was silently lost. Coord will upsert the accepted directive
into this table BEFORE it publishes (plan D3), and the runner fetches the row
over ``GET /devenv/agent-ci-node-directive`` with its device JWT every time its
``device_ci`` subscription comes up (plan D2/D4).

Coord's store module (qontinui-coord
``crates/coord/src/devenv_ci_node_directive_store.rs``, the plan's Phase 2,
not yet written) is planned to treat this table as best-effort: until it
exists, the read is to answer ``Unavailable`` and a dispatch 503
``schema_migration_pending``. Either way this revision lands and applies first
(served policy ``production-and-cost`` ``alembic-sole-authorship``).

The table
==========================================================================

One row per device: ``device_id`` is the primary key, not ``(tenant_id,
device_id)``. One machine has one ``settings.json``, so its desired CI-node
state is single; a device bound to several tenants takes the newest owner
statement (plan decision, Phase 1 keying note).

* ``tenant_id`` — the tenant whose owner (or agent) issued the directive.
* ``directive_id`` — coord-minted UUIDv7, once per accepted directive; the
  same value rides the published payload, so the runner can tell a replay of
  an already-applied directive apart (plan D2).
* ``requested_at`` — coord's clock, truncated to microseconds so the live
  copy and this ``timestamptz`` round trip compare equal (plan D2).
* ``payload`` — the exact JSON payload a live ``settings_requested`` frame
  carries, so the runner parses both with one type.
* ``credential_arm`` — which door accepted it (``operator`` / ``device``).
* ``machine_id`` — the runner-local machine id, when the door supplied one.
* ``updated_at`` — when coord last wrote the row. The ``now()`` default fires
  on INSERT only, so coord's upsert must set ``updated_at = now()`` in its
  ``ON CONFLICT ... DO UPDATE`` arm itself.

No index beyond the primary key: the only read is by ``device_id``.

Shape
==========================================================================

A guarded ``CREATE TABLE`` in schema ``coord`` with two CHECKs (the arm, and
``payload`` is a JSON object) and column comments;
no data is touched, so it is safe for a running coord on the prior schema
(coord reads nothing from it yet). ``downgrade`` drops exactly the table it
created.

``down_revision`` chains off main's single head at authoring time
(``coord_conditions_02_honest_runs``; ``alembic heads`` printed one head).
Coord re-points it at land time if main moves again.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cinode_06_ci_node_directives"
down_revision: str | Sequence[str] | None = "coord_conditions_02_honest_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "coord"
_TABLE = "ci_node_directives"


def upgrade() -> None:
    """Create coord.ci_node_directives with its CHECKs and comments.

    Idempotent: a prior partial apply (or an out-of-band create) leaves the
    table in place, and the whole body is skipped so ``alembic upgrade head``
    succeeds either way. Coord's merge-time migration classifier also admits
    only a guarded ``create_table``.
    """
    if inspect(op.get_bind()).has_table(_TABLE, schema=_SCHEMA):
        return
    op.create_table(
        _TABLE,
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            comment=(
                "The device the directive targets. One row per device holds the "
                "LATEST accepted CI-node directive for it; the runner reads this "
                "row on every device_ci connect."
            ),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment="The tenant whose owner or agent issued the latest directive.",
        ),
        sa.Column(
            "directive_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            comment=(
                "Coord-minted UUIDv7, once per accepted directive. The published "
                "payload carries the same id, so the runner treats an equal id "
                "as an already-applied replay."
            ),
        ),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            comment=(
                "Coord's clock at acceptance, truncated to microseconds. The "
                "runner applies a directive only when this is strictly newer "
                "than the one it last applied."
            ),
        ),
        sa.Column(
            "payload",
            postgresql.JSONB(),
            nullable=False,
            comment=(
                "The exact payload a live settings_requested frame carries for "
                "this directive; the runner parses both with one type."
            ),
        ),
        sa.Column(
            "credential_arm",
            sa.Text(),
            nullable=False,
            comment=(
                "Which coord door accepted the directive: operator (web PUT) or "
                "device (the agent twin)."
            ),
        ),
        sa.Column(
            "machine_id",
            sa.Text(),
            nullable=True,
            comment="The runner-local machine id, when the door supplied one.",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            comment=(
                "When coord last upserted this row. The default covers the "
                "insert only; the writer sets it to now() on every update."
            ),
        ),
        sa.CheckConstraint(
            "credential_arm IN ('operator', 'device')",
            name="ci_node_directives_credential_arm_check",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(payload) = 'object'",
            name="ci_node_directives_payload_object_check",
        ),
        schema=_SCHEMA,
        comment=(
            "One row per device: the LATEST CI-node settings directive coord "
            "accepted for it, written before the directive is published. The "
            "runner reads its own row on every device_ci connect, so a "
            "directive sent while the device was offline applies when it "
            "reconnects. Owned by coord; schema authored by qontinui-web alembic."
        ),
    )


def downgrade() -> None:
    """Drop exactly the table upgrade created."""
    op.drop_table(_TABLE, schema=_SCHEMA)
