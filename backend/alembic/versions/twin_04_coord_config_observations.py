"""twin 04 coord.config_observations — Φ_Config per-surface observation oplog

Revision ID: twin_04_coord_config_observations
Revises: twin_03_coord_flag_registry
Create Date: 2026-05-31

Phase 3 of the digital-twin config/secrets/flags-layer plan
(``D:/qontinui-root/plans/2026-05-30-twin-config-secrets-flags-layer.md``).

Creates ``coord.config_observations`` — an **append-only oplog** of the
Φ_Config (config/secret/flag) per-surface actual-side observations (§4). Each
row is one observation of one config *key* on one *surface*: an env var, a
secret reference, or a behavioral flag. The ``config_observation_watcher``
writes these rows (ecs-describe + coord's own runtime flag read + the persisted
``infra_observer`` grant verdict). The hot queries are "the latest observation
per ``(surface, kind, key)``" and "stale surfaces" (``observed_at`` window).

**Secret values are NEVER stored** (§1.3 — the value dimension is a D4 ``Blind``
by design). ``live_value_normalized`` is NULL for ``kind='secret_ref'`` and for
any secret-backed env; for ``kind='flag'`` it holds the normalized on/off only,
never an arbitrary (possibly sensitive) config string.

Design notes (mirrors ``twin_02_coord_infra_drift_observations`` /
``twin_01_coord_migration_observations`` conventions):

* ``kind`` and ``drift_class`` are TEXT (+CHECK on ``kind``) rather than PG enums
  — same rationale as ``coord.infra_drift_observations.drift_class`` /
  ``coord.alerts.severity``: text+CHECK evolves without ``ALTER TYPE``
  acrobatics. ``drift_class`` is left as free TEXT (no CHECK) because the §1.4 /
  §6.3 vocabulary (``ok``/``orphaned-env``/``missing-env``/
  ``missing-secret-grant``/``flag-mismatch``) is still being calibrated against
  the coord-side classifier; ``kind`` is the closed, contract-bound set.
* ``effective_state`` is the §2.3 4-valued flag verdict
  (``off``/``armed_but_inert``/``armed_and_live``/``unknown``); NULL for
  non-flag kinds.
* ``granted`` is only meaningful for ``kind='secret_ref'`` (the Φ_Config(S)
  exec-role grant coverage); NULL otherwise.
* No unique constraint — this is intentionally a history oplog; the same
  ``(surface, kind, key)`` tuple recurs every observation tick.
* Two indexes mirror the sibling query patterns: a btree on
  ``(surface, kind, key)`` for the latest-per-key lookup, and one on
  ``observed_at DESC`` for the latest-observation / staleness window.
* The D6 ``coverage`` / ``credibility`` columns carry the observation-space
  confidence pair (both in ``[0,1]``).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "twin_04_coord_config_observations"
down_revision: str = "twin_03_coord_flag_registry"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed observation kinds — keep in sync with the coord-side
# config_observation_watcher (built against this same contract).
_KINDS = ("env", "secret_ref", "flag")


def upgrade() -> None:
    op.create_table(
        "config_observations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # The surface this observation is scoped to, e.g. 'coord-prod'.
        sa.Column("surface", sa.Text(), nullable=False),
        # One of 'env' / 'secret_ref' / 'flag'.
        sa.Column("kind", sa.Text(), nullable=False),
        # env var name / secret name / flag name.
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("present", sa.Boolean(), nullable=False),
        # Only meaningful for kind='secret_ref' (exec-role grant coverage).
        sa.Column("granted", sa.Boolean(), nullable=True),
        # NEVER a secret value: NULL for kind='secret_ref' and secret-backed env;
        # for flags, the normalized on/off only.
        sa.Column("live_value_normalized", sa.Text(), nullable=True),
        # For kind='flag': off / armed_but_inert / armed_and_live / unknown.
        sa.Column("effective_state", sa.Text(), nullable=True),
        # e.g. ok / orphaned-env / missing-env / missing-secret-grant /
        # flag-mismatch.
        sa.Column("drift_class", sa.Text(), nullable=True),
        # D6 coverage in [0,1].
        sa.Column("coverage", sa.Float(precision=53), nullable=True),
        # Observer identity, e.g. 'ecs_describe' / 'coord_self_report'.
        sa.Column("provenance", sa.Text(), nullable=True),
        # D6 credibility in [0,1] (stored as text label or numeric string).
        sa.Column("credibility", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "kind IN ('env','secret_ref','flag')",
            name="config_observations_kind_chk",
        ),
        schema="coord",
    )

    # Latest-per-key lookup: ORDER BY observed_at DESC for a given
    # (surface, kind, key).
    op.create_index(
        "idx_config_observations_surface_kind_key",
        "config_observations",
        ["surface", "kind", "key"],
        schema="coord",
    )

    # Latest-observation / staleness window
    # (``ORDER BY observed_at DESC LIMIT 1`` per surface).
    op.create_index(
        "idx_config_observations_observed_at",
        "config_observations",
        [sa.text("observed_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_config_observations_observed_at",
        table_name="config_observations",
        schema="coord",
    )
    op.drop_index(
        "idx_config_observations_surface_kind_key",
        table_name="config_observations",
        schema="coord",
    )
    op.drop_table("config_observations", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_02_coord_infra_drift_observations.
_ = _KINDS
