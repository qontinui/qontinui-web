"""install-sig 01 coord.install_signatures — install-action effect-signature oplog

Revision ID: install_sig_01_coord_install_signatures
Revises: twin_08_coord_twin_targets
Create Date: 2026-06-03

Phase 1–2 backing of the install-dependency action effect-signatures plan
(``qontinui-dev-notes/plans/2026-05-31-install-dependency-action-effect-signatures-plan.md``).

Creates one **append-only** ``coord.*`` table consumed by qontinui-coord (Rust),
which cannot author DDL — Alembic in qontinui-web is the sole author of the
``coord.*`` schema:

* ``coord.install_signatures`` — one row per ``POST /coord/installs/declare``
  (the *act of installing* a dependency, given a cross-sub-space predicted
  effect signature), enriched in place by the later
  ``POST /coord/installs/verify`` that composes the observed per-dimension drift
  verdicts into one D3 outcome. ``declare`` writes the prediction columns
  (``package_manager`` / ``requested`` / ``predicted`` / ``coverage``); ``verify``
  fills the nullable verification columns (``verified_at`` / ``per_dimension`` /
  ``composed_outcome`` / ``verified_coverage``) for the matching
  ``correlation_id``. A post-hoc ``verify`` with no prior ``declare`` row is a
  best-effort no-op write (coord stays bootable) — see the coord-side
  ``install_effects`` module.

Design notes (mirrors ``edit_effect_01_coord_edit_effect_tables`` /
``twin_03_coord_dependency_observations`` conventions):

* ``composed_outcome`` is TEXT + CHECK rather than a PG enum — same rationale as
  ``coord.edit_verifications.composed_outcome`` / ``coord.alerts.severity``:
  text+CHECK evolves without ``ALTER TYPE`` acrobatics. NULL until ``verify``
  runs. Keep the allowed set in sync with the coord-side
  ``install_effects::compose_install_outcome`` (built against this same
  contract).
* No unique constraints — intentionally a history oplog; ``verify`` updates the
  latest row for a ``correlation_id`` (the coord side scopes the UPDATE), and a
  re-declare of the same install appends a fresh row.
* ``coord`` already exists (created by ``consolidation_phase1_01_infrastructure``);
  this migration does NOT ``CREATE SCHEMA``.
* The ``now()`` default is a plain column default (evaluated per-row at INSERT) —
  fine; only a problem inside a partial-index predicate (none used here).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "install_sig_01_coord_install_signatures"
down_revision: str = "twin_08_coord_twin_targets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed composed outcomes — keep in sync with the coord-side install-effect
# composer (``install_effects::compose_install_outcome``, built against this
# same contract). NULL until ``verify`` runs.
_COMPOSED_OUTCOMES = (
    "confirmed",
    "surprise",
    "failure",
    "contradiction",
    "partial",
)


def upgrade() -> None:
    op.create_table(
        "install_signatures",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "declared_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("repo", sa.Text(), nullable=True),
        # 'npm' | 'yarn' | 'pnpm' | 'cargo' | 'pip' | 'poetry'.
        sa.Column("package_manager", sa.Text(), nullable=False),
        # Array of requested PackageSpec objects ({name, version_req?}); empty for
        # a lockfile-only refresh (e.g. ``cargo update``) — a first-class install.
        sa.Column(
            "requested",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        # Snapshot of the PredictedInstallEffect (the per-dimension predicted
        # effect across fs / dep_graph / security / build / type / coord).
        sa.Column(
            "predicted",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        # D6 coverage of the prediction in [0,1] (mean of the per-dimension
        # coverages; 0 = coord could see nothing, the honest D4 gap).
        sa.Column(
            "coverage",
            sa.Float(precision=53),
            nullable=False,
            server_default=sa.text("0.0"),
        ),
        sa.Column("provenance", sa.Text(), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        # --- verification columns (NULL until POST /coord/installs/verify) ----
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        # Map dimension -> {drift_class, d3_outcome, rationale}.
        sa.Column("per_dimension", postgresql.JSONB(), nullable=True),
        # NULL until verify; then one of _COMPOSED_OUTCOMES.
        sa.Column("composed_outcome", sa.Text(), nullable=True),
        # D6 coverage of the verification in [0,1] (NULL until verify).
        sa.Column("verified_coverage", sa.Float(precision=53), nullable=True),
        sa.CheckConstraint(
            "composed_outcome IS NULL OR composed_outcome IN "
            "('confirmed','surprise','failure','contradiction','partial')",
            name="install_signatures_composed_outcome_chk",
        ),
        schema="coord",
    )
    op.create_index(
        "idx_install_signatures_correlation_id",
        "install_signatures",
        ["correlation_id"],
        schema="coord",
    )
    op.create_index(
        "idx_install_signatures_repo",
        "install_signatures",
        ["repo"],
        schema="coord",
    )
    # Hot lookup: the latest declaration (``ORDER BY declared_at DESC``).
    op.create_index(
        "idx_install_signatures_declared_at",
        "install_signatures",
        [sa.text("declared_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    # Reverse order of upgrade().
    op.drop_index(
        "idx_install_signatures_declared_at",
        table_name="install_signatures",
        schema="coord",
    )
    op.drop_index(
        "idx_install_signatures_repo",
        table_name="install_signatures",
        schema="coord",
    )
    op.drop_index(
        "idx_install_signatures_correlation_id",
        table_name="install_signatures",
        schema="coord",
    )
    op.drop_table("install_signatures", schema="coord")


# Touch the unused-symbol tuple so linters don't complain — mirrors the pattern
# in edit_effect_01_coord_edit_effect_tables / twin_03_coord_dependency_observations.
_ = _COMPOSED_OUTCOMES
