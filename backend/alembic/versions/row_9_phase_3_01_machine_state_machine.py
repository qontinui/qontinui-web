"""row 9 phase 3 01 coord.machines state machine

Revision ID: row_9_phase_3_01_machines_state
Revises: row_9_phase_2_01_revoked_tokens
Create Date: 2026-05-14

Row 9 Phase 3 of the failure-modes-at-scale design
(``D:/qontinui-root/plans/2026-05-14-failure-modes-at-scale-design.md``
§3.2 "Network-partition recovery"). Extends ``coord.machines`` with the
columns the coord-side health watcher (``coord/src/health_watcher.rs``)
needs to drive the machine-state state machine:

::

    healthy → degraded   (single failed /health probe)
            ↘ partitioned (3+ consecutive failed probes over 5+ min)
                    ↘ abandoned (no recovery after 24h timeout)
                    ↗ healthy   (re-registered + state verified)

Rather than introduce a new table, this attaches to the existing
``coord.machines`` row per the Row 9 design §1A vet-pass note:

> The §3.2 state-machine extension (healthy→degraded→partitioned→
> abandoned) should attach to whatever ``coord.machine_status``
> already stores, not invent a new table.

(``coord.machine_status`` is the *voluntary status broadcast* surface
— task-currently-running, current-branch text. The *liveness* state
machine logically lives on ``coord.machines`` next to ``last_seen_at``,
which is what watcher-driven aliveness already tracks. Keeping liveness
on ``coord.machines`` avoids cross-table joins on every health-tick
update.)

Schema choices:

* ``state`` is TEXT with a CHECK constraint rather than a PG ENUM. We
  follow the convention of ``coord.agent_worktrees.status`` — text+CHECK
  is easier to evolve than a PG enum (which requires ``ALTER TYPE``
  acrobatics).
* ``state_changed_at`` defaults to ``now()`` so the watcher can compute
  "how long has this machine been in this state?" cheaply
  (``state = 'partitioned' AND now() - state_changed_at > interval
  '24 hours'`` is the abandonment query).
* ``consecutive_failed_probes`` is INTEGER NOT NULL DEFAULT 0. Reset to
  0 on any successful probe; incremented on each failure. The
  ``healthy → degraded`` and ``degraded → partitioned`` thresholds key
  on this counter.
* ``last_probe_at`` / ``last_probe_ok`` are nullable for the bootstrap
  case where coord has the row from registration but hasn't yet polled
  it. NULL ``last_probe_at`` is "no probe attempted yet" (synthetic-
  initial-healthy).
* ``health_url`` is the absolute URL coord polls (e.g.
  ``http://hostname:9876/health``). Nullable: a freshly-registered
  machine that hasn't yet announced its health surface stays in the
  ``healthy`` state but isn't actively probed. The runner Phase 3 patch
  populates this at registration time.

Indices: a partial index on ``state`` for non-healthy rows narrows the
"what's alerting?" dashboard query without bloating the index for the
common case.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "row_9_phase_3_01_machines_state"
down_revision: str = "row_9_phase_2_01_revoked_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed state values — keep in sync with the runner-side self-heal
# (``qontinui-runner/src-tauri/src/database/pg/machines_state.rs``)
# and the coord-side ``MachineState`` enum
# (``qontinui-coord/src/machine_state.rs``).
_STATES = ("healthy", "degraded", "partitioned", "abandoned")


def upgrade() -> None:
    # ``coord.machines`` already exists — Row 9 Phase 3 extends it.
    op.add_column(
        "machines",
        sa.Column(
            "state",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'healthy'"),
        ),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column(
            "state_changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column(
            "consecutive_failed_probes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column(
            "last_probe_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column(
            "last_probe_ok",
            sa.Boolean(),
            nullable=True,
        ),
        schema="coord",
    )
    op.add_column(
        "machines",
        sa.Column(
            "health_url",
            sa.Text(),
            nullable=True,
        ),
        schema="coord",
    )

    op.create_check_constraint(
        "machines_state_chk",
        "machines",
        sa.text(
            "state IN ('healthy','degraded','partitioned','abandoned')"
        ),
        schema="coord",
    )

    # Partial index — the watcher's hot query is "give me rows that
    # need attention" (anything not healthy). Excluding healthy rows
    # from the index keeps it tiny on the common case where the whole
    # fleet is up.
    op.create_index(
        "idx_machines_state_unhealthy",
        "machines",
        ["state", "state_changed_at"],
        schema="coord",
        postgresql_where=sa.text("state <> 'healthy'"),
    )


def downgrade() -> None:
    op.drop_index(
        "idx_machines_state_unhealthy",
        table_name="machines",
        schema="coord",
    )
    op.drop_constraint(
        "machines_state_chk",
        "machines",
        type_="check",
        schema="coord",
    )
    op.drop_column("machines", "health_url", schema="coord")
    op.drop_column("machines", "last_probe_ok", schema="coord")
    op.drop_column("machines", "last_probe_at", schema="coord")
    op.drop_column("machines", "consecutive_failed_probes", schema="coord")
    op.drop_column("machines", "state_changed_at", schema="coord")
    op.drop_column("machines", "state", schema="coord")


# Touch the unused-symbol import so linters don't complain.
_ = _STATES
