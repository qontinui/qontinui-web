"""twin 03 coord.flag_registry — Φ_Config declared flag catalog

Revision ID: twin_03_coord_flag_registry
Revises: cognito_legacy_auth_teardown_02
Create Date: 2026-05-31

Phase 2 of the digital-twin config/secrets/flags-layer plan
(``D:/qontinui-root/plans/2026-05-30-twin-config-secrets-flags-layer.md``).

Creates ``coord.flag_registry`` — the **declared, slow-changing catalog** of the
known behavioral feature flags (``*_ENABLED`` / ``*_DISABLED`` / ``AUTO_RECOVER``)
read across the coord source. Each row is the *declared* side of the Ξ_Config
flag pair (§2.1): the flag's normalized sense (``enable`` vs the inverted
``disable`` flags), its code default when the env var is unset, a human-readable
precondition expression (the "armed but inert" composite-state predicate, §2.3),
the owning module + source ``file:line`` provenance, and a description.

This table is **schema-only — no rows are seeded here.** The catalog is a *code
artifact*: coord upserts the §2.1 enumeration into this table at boot (the
precondition expressions are hand-curated, the flag set is regenerable from the
``env::var`` call sites). Seeding in the migration would drift the instant a flag
is added/removed in coord src.

Design notes (mirrors ``twin_02_coord_infra_drift_observations`` /
``twin_01_coord_migration_observations`` conventions):

* ``sense`` is TEXT + CHECK rather than a PG enum — same rationale as
  ``coord.infra_drift_observations.drift_class`` / ``coord.alerts.severity``:
  text+CHECK evolves without ``ALTER TYPE`` acrobatics. The only two values are
  ``enable`` (``*_ENABLED`` flags, ON when set) and ``disable`` (the inverted
  ``*_DISABLED`` flags, default-ON unless explicitly disabled).
* ``flag_name`` is the natural PRIMARY KEY — the catalog is keyed by the env-var
  name; coord upserts on conflict.
* ``precondition_expr`` is NULL when the flag has no composite precondition
  (its effective state is just set-vs-default). When present it is the
  human-readable description rendered in the ``coord_flag_state`` verdict; the
  actual precondition check is dispatched per-flag in Rust (plan §7.4 Q2).
* ``updated_at`` tracks the last upsert so a stale catalog is observable.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "twin_03_coord_flag_registry"
down_revision: str = "cognito_legacy_auth_teardown_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed flag senses — keep in sync with the coord-side flag-registry seeder
# (built against this same contract). ``enable`` = ON-when-set ``*_ENABLED``
# flags; ``disable`` = the inverted default-ON ``*_DISABLED`` flags.
_SENSES = ("enable", "disable")


def upgrade() -> None:
    op.create_table(
        "flag_registry",
        sa.Column("flag_name", sa.Text(), primary_key=True),
        sa.Column("sense", sa.Text(), nullable=False),
        # The normalized behavior when the env var is unset (e.g. 'on' / 'off').
        sa.Column("code_default", sa.Text(), nullable=False),
        # Human-readable precondition description; NULL = no precondition.
        sa.Column("precondition_expr", sa.Text(), nullable=True),
        # Owning module, e.g. 'next_step', 'merge_scheduler'.
        sa.Column("owning_module", sa.Text(), nullable=False),
        # Source provenance, e.g. 'src/next_step.rs:65'.
        sa.Column("source_file_line", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "sense IN ('enable','disable')",
            name="flag_registry_sense_chk",
        ),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_table("flag_registry", schema="coord")


# Touch the unused-symbol import so linters don't complain — mirrors the
# pattern in twin_02_coord_infra_drift_observations.
_ = _SENSES
