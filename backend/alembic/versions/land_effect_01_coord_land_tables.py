"""land-effect 01 coord.land_signatures + coord.land_verifications

Revision ID: land_effect_01_coord_land_tables
Revises: twin_07_drop_coord_routing_drift_observations
Create Date: 2026-06-04

Substrate for the push/land-action effect-signatures plan
(``2026-05-31-push-land-action-effect-signatures-plan``). Two best-effort,
*non-boot-gated* overlay tables in the ``coord`` schema. The coord Rust side
tolerates their absence — they are an observability/audit overlay, not a hard
boot dependency (they are NOT in coord's ``ALEMBIC_OWNED_TABLES`` boot gate;
coord warns-on-fail rather than crash-looping if they are missing). This
decouples the web/coord deploy order: web authors the DDL, coord reads
best-effort.

* ``coord.land_signatures`` — the per-apply *predicted* land/push effect. One
  row per push or land (PR-merge) apply. ``action`` discriminates ``push`` vs
  ``land``; ``predicted`` is the serialized PredictedLandEffect JSONB the agent
  declares pre-apply. ``from_sha`` / ``to_sha`` carry the branch ref movement;
  ``merge_strategy`` is the land merge method (NULL for a plain push).
  ``correlation_id`` ties a signature to the broader cascade/correlation it
  belongs to.

* ``coord.land_verifications`` — the *composed* per-dimension verdict plus the
  D3-style composed outcome for a signature. ``dimension_verdicts`` is a JSONB
  array of ``{dimension, drift_class, outcome, detail}`` objects, where
  ``dimension`` is one of git / cascade / ci / release. ``composed_outcome``
  carries the composed D3 outcome (tokens copied verbatim from the existing
  ``coord.edit_verifications`` / ``coord.commit_verifications`` CHECK so the
  three D3-outcome contracts stay identical). ``dimensions_predicted`` /
  ``dimensions_observed`` / ``coverage`` carry the D6-style observation-space
  coverage pair; ``settled`` flips once every predicted dimension has been
  observed.

Conventions mirror the sibling coord.* migrations
(``restack_01_coord_restack_signatures`` /
``commit_effect_01_coord_commit_tables``):

* Raw ``op.execute`` DDL, every statement schema-qualified to ``coord`` (the
  ``check_alembic_schema_args.py`` pre-commit/CI gate requires it).
* ``action`` / ``merge_strategy`` / ``composed_outcome`` are TEXT + CHECK rather
  than PG enums — same rationale as ``coord.edit_verifications.composed_outcome``:
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
revision: str = "land_effect_01_coord_land_tables"
down_revision: str = "twin_07_drop_coord_routing_drift_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the two best-effort coord.* land overlay tables."""

    # -----------------------------------------------------------------
    # coord.land_signatures — the per-apply predicted PredictedLandEffect.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.land_signatures (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            action          TEXT NOT NULL,
            repo            TEXT NOT NULL,
            pr_number       INTEGER,
            branch          TEXT NOT NULL,
            from_sha        TEXT NOT NULL,
            to_sha          TEXT,
            merge_strategy  TEXT,
            correlation_id  UUID,
            predicted       JSONB NOT NULL DEFAULT '{}'::jsonb,
            tenant_id       UUID,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT land_signatures_action_chk CHECK (action IN ('push','land')),
            CONSTRAINT land_signatures_strategy_chk CHECK (merge_strategy IS NULL OR merge_strategy IN ('squash','merge','rebase'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_land_signatures_repo_created
            ON coord.land_signatures (repo, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_land_signatures_correlation
            ON coord.land_signatures (correlation_id) WHERE correlation_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_land_signatures_pr
            ON coord.land_signatures (repo, pr_number) WHERE pr_number IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_land_signatures_tenant
            ON coord.land_signatures (tenant_id) WHERE tenant_id IS NOT NULL
        """
    )

    # -----------------------------------------------------------------
    # coord.land_verifications — the composed per-dimension verdict + D3
    # composed outcome for a signature.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.land_verifications (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            signature_id         UUID NOT NULL,
            repo                 TEXT NOT NULL,
            dimension_verdicts   JSONB NOT NULL DEFAULT '[]'::jsonb,
            composed_outcome     TEXT NOT NULL,
            settled              BOOLEAN NOT NULL DEFAULT FALSE,
            dimensions_predicted INTEGER NOT NULL DEFAULT 0,
            dimensions_observed  INTEGER NOT NULL DEFAULT 0,
            coverage             DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            rationale            TEXT,
            tenant_id            UUID,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT land_verifications_outcome_chk
                CHECK (composed_outcome IN ('confirmed','surprise','failure','contradiction','partial'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_land_verifications_signature
            ON coord.land_verifications (signature_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_land_verifications_repo_created
            ON coord.land_verifications (repo, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_land_verifications_tenant
            ON coord.land_verifications (tenant_id) WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop both overlay tables (verifications first; indexes drop with them)."""
    op.execute("DROP TABLE IF EXISTS coord.land_verifications")
    op.execute("DROP TABLE IF EXISTS coord.land_signatures")
