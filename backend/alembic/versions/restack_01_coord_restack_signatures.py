"""restack 01 coord.restack_signatures + coord.restack_verifications

Revision ID: restack_01_coord_restack_signatures
Revises: runtests_effect_tables_01
Create Date: 2026-06-03

Substrate for the rebase-restack effect-signatures plan. Two best-effort,
*non-boot-gated* overlay tables in the ``coord`` schema (the coord Rust side
tolerates their absence — they are an observability/audit overlay, not a hard
dependency):

* ``coord.restack_signatures`` — records the per-cascade *predicted*
  RestackSignature. One row per restack trigger (a land/push apply, an
  operator-requested restack, or an operator resolution). ``edges`` is the
  JSONB array of predicted effect edges; ``edge_count`` is its cached length.
  ``correlation_id`` / ``cascade_id`` tie a signature to the broader
  cascade/correlation it belongs to.

* ``coord.restack_verifications`` — records the *composed* per-edge DriftVerdict
  plus the D3 outcome for a signature. ``edge_verdicts`` is the JSONB array of
  per-edge verdicts; ``worst_drift_class`` is the worst drift class observed
  across those edges; ``d3_outcome`` is the D3 verification-space outcome.
  ``edges_predicted`` / ``edges_observed`` / ``coverage`` carry the D6-style
  observation-space coverage pair.

Conventions mirror the sibling coord.* migrations (``twin_08_coord_twin_targets``
/ ``twin_02_coord_infra_drift_observations``):

* Raw ``op.execute`` DDL, every statement schema-qualified to ``coord`` (the
  ``check_alembic_schema_args.py`` pre-commit/CI gate requires it).
* ``trigger`` / ``worst_drift_class`` / ``d3_outcome`` are TEXT + CHECK rather
  than PG enums — same rationale as ``coord.migration_observations.drift_class``:
  text+CHECK evolves without ``ALTER TYPE`` acrobatics. Keep the allowed token
  sets byte-for-byte in sync with the coord-side classifier built against this
  contract.
* No unique constraints — these are append-only audit overlays; the same tuple
  may recur per tick.
* ``IF NOT EXISTS`` everywhere keeps the migration idempotent; the ``coord``
  schema already exists (many coord.* tables live there) so it is NOT created.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "restack_01_coord_restack_signatures"
down_revision: str = "runtests_effect_tables_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the two best-effort coord.* restack overlay tables."""

    # -----------------------------------------------------------------
    # coord.restack_signatures — the per-cascade predicted RestackSignature.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.restack_signatures (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            repo                 TEXT NOT NULL,
            trigger              TEXT NOT NULL,
            triggering_ref       TEXT NOT NULL,
            triggering_from_sha  TEXT NOT NULL,
            triggering_to_sha    TEXT NOT NULL,
            correlation_id       UUID,
            cascade_id           UUID,
            edges                JSONB NOT NULL DEFAULT '[]'::jsonb,
            edge_count           INTEGER NOT NULL DEFAULT 0,
            tenant_id            UUID,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT restack_signatures_trigger_chk
                CHECK (trigger IN ('land-applied','push-applied','operator-requested','operator-resolution'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_restack_signatures_repo_created
            ON coord.restack_signatures (repo, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_restack_signatures_correlation
            ON coord.restack_signatures (correlation_id) WHERE correlation_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_restack_signatures_cascade
            ON coord.restack_signatures (cascade_id) WHERE cascade_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_restack_signatures_tenant
            ON coord.restack_signatures (tenant_id) WHERE tenant_id IS NOT NULL
        """
    )

    # -----------------------------------------------------------------
    # coord.restack_verifications — the composed per-edge DriftVerdict + D3
    # outcome for a signature.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.restack_verifications (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            signature_id         UUID NOT NULL,
            repo                 TEXT NOT NULL,
            edge_verdicts        JSONB NOT NULL DEFAULT '[]'::jsonb,
            worst_drift_class    TEXT NOT NULL,
            d3_outcome           TEXT NOT NULL,
            edges_predicted      INTEGER NOT NULL DEFAULT 0,
            edges_observed       INTEGER NOT NULL DEFAULT 0,
            coverage             DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            tenant_id            UUID,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT restack_verifications_drift_chk
                CHECK (worst_drift_class IN ('none','benign_add','pending','in_place','active_negation','divergent','unknown')),
            CONSTRAINT restack_verifications_d3_chk
                CHECK (d3_outcome IN ('Confirmed','Surprise','Failure','Contradiction','Partial'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_restack_verifications_signature
            ON coord.restack_verifications (signature_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_restack_verifications_repo_created
            ON coord.restack_verifications (repo, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_restack_verifications_tenant
            ON coord.restack_verifications (tenant_id) WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop both overlay tables (indexes drop with them)."""
    op.execute("DROP TABLE IF EXISTS coord.restack_verifications")
    op.execute("DROP TABLE IF EXISTS coord.restack_signatures")
