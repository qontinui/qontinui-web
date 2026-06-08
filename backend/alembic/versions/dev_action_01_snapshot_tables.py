"""coord dev-action snapshot ledger — snapshots / outcomes / stats

Revision ID: dev_action_01_snapshot_tables
Revises: seed_pnpm_lock_grammar
Create Date: 2026-06-07

Phase 3 of ``plans/2026-06-07-twin-dev-event-cause-effect-ledger.md``
(Digital-Twin dev-event Action Snapshots). Creates the durable
substrate for the dev-environment cause-effect ledger:

* ``coord.dev_action_snapshots`` — one row per dev action (build /
  restart / spawn / deploy / migrate), recording the *active dev-state
  set at execution time* (``state_ids``), the post-window outcome
  (``category`` = the five ``outcome_category`` D3 strings, mirroring
  ``coord.policy_rule_resolutions``), plus evidence / duration / params.
  The supervisor evaluates state predicates at action time and POSTs the
  folded snapshot after the attribution window closes. This is the dev
  instantiation of Spinak (2025) §11.1's Action Snapshot
  ``AS = (o_a^h, S_Ξ^h, r_a^h)``.

* ``coord.dev_action_outcomes`` — child rows, one per observed
  ``DEV-*`` outcome signature, with a ``late`` flag for signatures that
  arrived after the verdict window closed (theory: effect-calculus
  §7.2 delayed-effect windows — late signatures update statistics but
  never re-open the closed verdict).

* ``coord.dev_action_stats`` — the dense, **never-pruned** Bayesian
  counting table. Raw snapshots prune at 7-30d; these counts survive.
  Keyed ``(action_kind, state_key, grain, signature)``. Three grains:

    - ``exact``   — ``state_key`` = the sorted active-state set, ids
      joined by ``|`` (e.g. ``LEGACY_EXE_FALLBACK|SLOTS_EMPTY``).
    - ``marginal``— ``state_key`` = a single active-state id; one row
      per active state (per-state marginal for the log-odds backoff).
    - ``global``  — ``state_key`` = ``''`` (the action-kind-only prior).

  Per grain/state_key, the **denominator** is the row whose
  ``signature = ''`` (the ``__TOTAL__`` sentinel): its ``occurrences``
  is the trial count (every ingested action increments it). Each
  observed ``DEV-*`` signature has its own numerator row whose
  ``occurrences`` counts its appearances. ``P(signature | kind, S)`` is
  then a Beta posterior of ``occ(signature)`` out of ``occ('')`` — the
  empty-signature denominator cleanly handles clean (no-signature)
  actions and late-appearing signatures without per-row trial drift.
  (Phase 4 reads this table; the reader exposes ``occurrences`` +
  derived ``trials`` exactly as the plan's expectations contract states.)

Schema choices (mirroring ``coord.build_events``,
``c0bdef_coord_build_events``):

1. ``device_id`` is a nullable FK to ``coord.devices.device_id`` ON
   DELETE SET NULL — supervisor actions carry a device; coord-originated
   actions (deploy/migrate, future) may not. Nullable + SET NULL keeps
   the ledger immutable against device churn.
2. ``category`` mirrors ``policy_rule_resolutions.outcome_category``
   (confirmed | surprise | failure | contradiction | partial), NULL
   while the attribution window is still open.
3. ``state_ids`` / ``states_unknown`` are TEXT[] with a GIN index for
   ``&&`` overlap queries ("snapshots where LEGACY_EXE_FALLBACK active").
4. ``coord.build_events`` keeps working in parallel (resolved Q1:
   dual-write one release, then build_events becomes a kind='build'
   view). No change to build_events here.

Alembic in qontinui-web is the sole author of the coord.* schema; the
coord Rust boot-gate (``state::require_table``) verifies these three
tables exist before serving.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "dev_action_01_snapshot_tables"
down_revision: str = "seed_pnpm_lock_grammar"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CATEGORY_CHECK = (
    "category IN ('confirmed','surprise','failure','contradiction','partial')"
)
_KIND_CHECK = "kind IN ('restart','spawn','build','deploy','migrate')"
_GRAIN_CHECK = "grain IN ('exact','marginal','global')"


def upgrade() -> None:
    # ------- coord.dev_action_snapshots -------
    op.create_table(
        "dev_action_snapshots",
        sa.Column(
            "action_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("coord.devices.device_id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("requester_id", sa.Text(), nullable=True),
        sa.Column("params_digest", sa.Text(), nullable=False),
        sa.Column(
            "state_ids",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column(
            "states_unknown",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "category",
            sa.Text(),
            nullable=True,
            comment="five D3 outcome_category strings; NULL while window open",
        ),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("evidence_ref", sa.Text(), nullable=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment="optional tenant scope for dashboard/MCP reads",
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.CheckConstraint(_KIND_CHECK, name="dev_action_snapshots_kind_chk"),
        sa.CheckConstraint(
            _CATEGORY_CHECK, name="dev_action_snapshots_category_chk"
        ),
        schema="coord",
    )
    op.create_index(
        "dev_action_snapshots_device_idx",
        "dev_action_snapshots",
        ["device_id", sa.text("started_at DESC")],
        schema="coord",
    )
    op.create_index(
        "dev_action_snapshots_kind_idx",
        "dev_action_snapshots",
        ["kind", sa.text("started_at DESC")],
        schema="coord",
    )
    op.create_index(
        "dev_action_snapshots_state_ids_gin",
        "dev_action_snapshots",
        ["state_ids"],
        schema="coord",
        postgresql_using="gin",
    )
    op.create_index(
        "dev_action_snapshots_closed_idx",
        "dev_action_snapshots",
        [sa.text("started_at DESC")],
        schema="coord",
        postgresql_where=sa.text("category IS NOT NULL"),
    )

    # ------- coord.dev_action_outcomes -------
    op.create_table(
        "dev_action_outcomes",
        sa.Column(
            "id",
            sa.BigInteger(),
            primary_key=True,
            autoincrement=True,
        ),
        sa.Column(
            "action_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "coord.dev_action_snapshots.action_id", ondelete="CASCADE"
            ),
            nullable=False,
        ),
        sa.Column("signature", sa.Text(), nullable=False),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "late",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema="coord",
    )
    op.create_index(
        "dev_action_outcomes_action_idx",
        "dev_action_outcomes",
        ["action_id"],
        schema="coord",
    )

    # ------- coord.dev_action_stats -------
    op.create_table(
        "dev_action_stats",
        sa.Column("action_kind", sa.Text(), nullable=False),
        sa.Column(
            "state_key",
            sa.Text(),
            nullable=False,
            comment="exact: sorted '|'-joined set; marginal: one state id; global: ''",
        ),
        sa.Column("grain", sa.Text(), nullable=False),
        sa.Column(
            "signature",
            sa.Text(),
            nullable=False,
            comment="DEV-* numerator id, or '' for the __TOTAL__ denominator row",
        ),
        sa.Column(
            "occurrences",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "last_seen",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "action_kind",
            "state_key",
            "grain",
            "signature",
            name="dev_action_stats_pkey",
        ),
        sa.CheckConstraint(_GRAIN_CHECK, name="dev_action_stats_grain_chk"),
        schema="coord",
    )
    # Lookup hot path: all rows for an (action_kind, grain, state_key).
    op.create_index(
        "dev_action_stats_lookup_idx",
        "dev_action_stats",
        ["action_kind", "grain", "state_key"],
        schema="coord",
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.dev_action_stats_lookup_idx")
    op.drop_table("dev_action_stats", schema="coord")
    op.execute("DROP INDEX IF EXISTS coord.dev_action_outcomes_action_idx")
    op.drop_table("dev_action_outcomes", schema="coord")
    op.execute("DROP INDEX IF EXISTS coord.dev_action_snapshots_closed_idx")
    op.execute("DROP INDEX IF EXISTS coord.dev_action_snapshots_state_ids_gin")
    op.execute("DROP INDEX IF EXISTS coord.dev_action_snapshots_kind_idx")
    op.execute("DROP INDEX IF EXISTS coord.dev_action_snapshots_device_idx")
    op.drop_table("dev_action_snapshots", schema="coord")
