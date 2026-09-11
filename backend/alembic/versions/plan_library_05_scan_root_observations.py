"""agent.plan_scan_root_observations — each device's latest plan-scan-source reading

Revision ID: plan_library_05_scan_root_observations
Revises: devenv_10_unique_active_coord_device
Create Date: 2026-09-11

Revised Phase 2 (web half) of
``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``.

The gap
=======

The plan corpus (``agent.work_artifacts``) is fed by each runner's body sync,
which scans a git WORKING TREE. Nothing on the corpus read side can tell how far
that tree is from its default branch: on 2026-09-11 the operator box's scan
source was 254 commits behind and the corpus was missing 54 plans, while every
sync cycle reported ``errors=0``. The runner already measures the distance
(``ScanDivergence`` in ``plan_workunit_adapter/trigger.rs``, qontinui-runner
#1453); this table is where each device's reading lands so a corpus reader can
see it.

What this revision does
=======================

Creates ``agent.plan_scan_root_observations``: one row per
``(organization, device)`` holding that device's LATEST reading, overwritten on
every report.

* **Keyed per device, because the corpus has one feeder per device.** Every
  runner scanning ``qontinui-dev-notes/plans`` writes the SAME artifact rows, so
  "how stale is the tree behind this corpus" has one answer per device. A single
  tenant-wide number would be whichever device reported last.
* **``device_id`` comes from the verified device token's claim, never the
  body.** It is FK-less: the device registry is coord's, and ``agent.*`` is
  web-owned.
* **The identity index is NULL-collapsing** —
  ``(coalesce(organization_id, nil), device_id)`` — for the same reason
  ``uq_work_artifacts_identity`` is: the organization comes from the plan
  library's own resolver, which scopes a principal with no personal
  organization to the NULL bucket, and a plain UNIQUE over a nullable column
  does not bind (NULL <> NULL). The upsert's ``ON CONFLICT`` target is that
  exact expression (``app.models.plan_scan_root.IDENTITY_ORG_SQL``).
* **``state`` is a closed vocabulary** (``ck_plan_scan_root_observations_state``)
  matching the runner's ``ScanDivergenceState`` serialization, and the three
  counts are non-negative (``ck_plan_scan_root_observations_counts_nonnegative``).
  Both are also checked by the request schema, so the CHECKs are the backstop
  rather than the user-facing error.
* The counts are BIGINT because the runner's fields are ``u64``.

Staleness is NOT stored. A reading older than the read route's freshness window
(45 min — three 15-min runner heartbeats) is rendered ``unknown`` at read time;
nothing here expires or deletes a row.

Downgrade
=========

Drops the table. The readings are a live diagnostic that every runner re-posts
within one heartbeat, so nothing durable is lost.

Idempotency: every statement uses ``IF NOT EXISTS`` / ``IF EXISTS``, so a
partially-applied run re-runs cleanly.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_05_scan_root_observations"
down_revision: str | Sequence[str] | None = "devenv_10_unique_active_coord_device"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The sentinel the functional unique index folds a NULL organization onto.
# Must equal ``app.models.work_artifact.NIL_ORGANIZATION_ID``.
_NIL_UUID = "00000000-0000-0000-0000-000000000000"


def upgrade() -> None:
    """Create the per-device scan-source reading store."""
    # Defensive only — consolidation_phase1_01_infrastructure created it.
    op.execute("CREATE SCHEMA IF NOT EXISTS agent")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent.plan_scan_root_observations (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            -- Derived from the reporting principal; NULL is the NULL bucket.
            -- No FK, matching agent.work_artifacts.organization_id.
            organization_id   UUID,
            -- The verified device token's device_id claim. No FK: coord's.
            device_id         UUID NOT NULL,
            state             TEXT NOT NULL
                CONSTRAINT ck_plan_scan_root_observations_state CHECK (
                    state IN (
                        'measured',
                        'not_scanning',
                        'not_a_git_work_tree',
                        'unknown'
                    )
                ),
            plans_dir         TEXT,
            repo_root         TEXT,
            source_repo       TEXT,
            default_ref       TEXT,
            ref_sha           TEXT,
            head_sha          TEXT,
            behind            BIGINT,
            ahead             BIGINT,
            ref_age_secs      BIGINT,
            counts_are_floors BOOLEAN NOT NULL,
            detail            TEXT,
            -- The runner's clock: when the reading was taken.
            observed_at       TIMESTAMPTZ NOT NULL,
            -- This server's clock: when the latest report was stored.
            received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_plan_scan_root_observations_counts_nonnegative CHECK (
                (behind IS NULL OR behind >= 0)
                AND (ahead IS NULL OR ahead >= 0)
                AND (ref_age_secs IS NULL OR ref_age_secs >= 0)
            )
        )
        """
    )

    # Identity, and the upsert's ON CONFLICT target. NULL-collapsing — see the
    # module docstring.
    op.execute(
        f"""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_scan_root_observations_identity
            ON agent.plan_scan_root_observations (
                coalesce(organization_id, '{_NIL_UUID}'::uuid),
                device_id
            )
        """
    )


def downgrade() -> None:
    """Drop the store. Every runner re-posts its reading within a heartbeat."""
    op.execute(
        "DROP INDEX IF EXISTS agent.uq_plan_scan_root_observations_identity"
    )
    op.execute("DROP TABLE IF EXISTS agent.plan_scan_root_observations")
