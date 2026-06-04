"""deploy-effect 01 coord.deploy_signatures + deploy_verifications + deploy_health_probes

Revision ID: deploy_effect_01_coord_deploy_tables
Revises: commit_obs_gin_01
Create Date: 2026-06-05

Substrate for the deploy-action effect-signatures plan
(``2026-05-31-deploy-action-effect-signatures``). Three best-effort,
*non-boot-gated* overlay tables in the ``coord`` schema. The coord Rust side
tolerates their absence — they are an observability/audit overlay, not a hard
boot dependency (they are NOT in coord's ``ALEMBIC_OWNED_TABLES`` boot gate;
coord warns-on-fail rather than crash-looping if they are missing). This
decouples the web/coord deploy order: web authors the DDL, coord reads/writes
best-effort. Mirrors the sibling land/restack/commit overlay posture.

* ``coord.deploy_signatures`` — the per-deploy *predicted* effect. One row per
  service deploy. ``service`` / ``environment`` identify the target;
  ``environment`` is staging|production. ``target`` is the deploy target JSONB
  (e.g. the resolved image/ref). ``source`` discriminates ci|manual|orchestrator.
  ``migration_required`` flags whether the deploy carries an alembic migration.
  ``predicted`` is the serialized predicted deploy effect the agent declares
  pre-apply. ``correlation_id`` ties a signature to the broader cascade/
  correlation it belongs to.

* ``coord.deploy_verifications`` — the *composed* per-dimension verdict plus the
  D3-style composed outcome for a signature. ``dimension_verdicts`` is a JSONB
  array of ``{dimension, drift_class, outcome, detail}`` objects.
  ``composed_outcome`` carries the composed D3 outcome (tokens copied verbatim
  from the existing ``coord.land_verifications`` / ``coord.edit_verifications``
  / ``coord.commit_verifications`` CHECK so the D3-outcome contracts stay
  identical). ``dimensions_predicted`` / ``dimensions_observed`` / ``coverage``
  carry the D6-style observation-space coverage pair; ``settled`` flips once
  every predicted dimension has been observed.

* ``coord.deploy_health_probes`` — the individual HTTP health-probe results that
  feed a deploy verification. One row per probe (endpoint hit). ``outcome`` uses
  the same lowercase D3 token set as ``composed_outcome``.

Conventions mirror the sibling coord.* migrations
(``land_effect_01_coord_land_tables`` / ``commit_effect_01_coord_commit_tables``):

* Raw ``op.execute`` DDL, every statement schema-qualified to ``coord`` (the
  ``check_alembic_schema_args.py`` pre-commit/CI gate requires it; web alembic is
  the sole author of coord.* DDL — coord's ``coord_schema_authorship.rs`` CI gate
  forbids coord-side CREATE TABLE).
* ``environment`` / ``source`` / ``composed_outcome`` / ``outcome`` are TEXT +
  CHECK rather than PG enums — same rationale as ``coord.land_verifications``:
  text+CHECK evolves without ``ALTER TYPE`` acrobatics. The D3 outcome tokens are
  lowercase and kept byte-for-byte in sync with the coord-side classifier built
  against this contract.
* No unique constraints — these are append-only audit overlays; the same tuple
  may recur per tick.
* ``IF NOT EXISTS`` everywhere keeps the migration idempotent; the ``coord``
  schema already exists (many coord.* tables live there) so it is NOT created.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "deploy_effect_01_coord_deploy_tables"
down_revision: str = "commit_obs_gin_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the three best-effort coord.* deploy overlay tables."""

    # -----------------------------------------------------------------
    # coord.deploy_signatures — the per-deploy predicted effect.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.deploy_signatures (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            service            TEXT NOT NULL,
            environment        TEXT NOT NULL,
            target             JSONB NOT NULL DEFAULT '{}'::jsonb,
            source             TEXT NOT NULL,
            migration_required BOOLEAN NOT NULL DEFAULT false,
            correlation_id     UUID NULL,
            predicted          JSONB NOT NULL DEFAULT '{}'::jsonb,
            tenant_id          UUID NULL,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT deploy_signatures_environment_chk
                CHECK (environment IN ('staging','production')),
            CONSTRAINT deploy_signatures_source_chk
                CHECK (source IN ('ci','manual','orchestrator'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS deploy_signatures_service_env_idx
            ON coord.deploy_signatures (service, environment, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS deploy_signatures_correlation_idx
            ON coord.deploy_signatures (correlation_id)
        """
    )

    # -----------------------------------------------------------------
    # coord.deploy_verifications — the composed per-dimension verdict + D3
    # composed outcome for a signature.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.deploy_verifications (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            signature_id         UUID NOT NULL,
            service              TEXT NOT NULL,
            dimension_verdicts   JSONB NOT NULL DEFAULT '[]'::jsonb,
            composed_outcome     TEXT NOT NULL,
            settled              BOOLEAN NOT NULL DEFAULT false,
            dimensions_predicted INTEGER NOT NULL DEFAULT 0,
            dimensions_observed  INTEGER NOT NULL DEFAULT 0,
            coverage             DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            rationale            TEXT NULL,
            tenant_id            UUID NULL,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT deploy_verifications_composed_outcome_chk
                CHECK (composed_outcome IN ('confirmed','surprise','failure','contradiction','partial'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS deploy_verifications_signature_idx
            ON coord.deploy_verifications (signature_id, created_at DESC)
        """
    )

    # -----------------------------------------------------------------
    # coord.deploy_health_probes — individual HTTP health-probe results
    # feeding a deploy verification.
    # -----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.deploy_health_probes (
            id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            signature_id          UUID NOT NULL,
            service               TEXT NOT NULL,
            endpoint              TEXT NOT NULL,
            method                TEXT NOT NULL DEFAULT 'GET',
            expected_status       INTEGER NOT NULL,
            observed_status       INTEGER NULL,
            body_assertion        TEXT NULL,
            body_assertion_passed BOOLEAN NULL,
            outcome               TEXT NOT NULL,
            latency_ms            INTEGER NULL,
            error                 TEXT NULL,
            tenant_id             UUID NULL,
            created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT deploy_health_probes_outcome_chk
                CHECK (outcome IN ('confirmed','surprise','failure','contradiction','partial'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS deploy_health_probes_signature_idx
            ON coord.deploy_health_probes (signature_id, created_at DESC)
        """
    )


def downgrade() -> None:
    """Drop the three overlay tables in reverse order (indexes drop with them)."""
    op.execute("DROP TABLE IF EXISTS coord.deploy_health_probes")
    op.execute("DROP TABLE IF EXISTS coord.deploy_verifications")
    op.execute("DROP TABLE IF EXISTS coord.deploy_signatures")
