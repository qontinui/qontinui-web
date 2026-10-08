"""agent.plan_difficulty_model_routes — the operator's model family per difficulty

Revision ID: plan_library_10_model_routes
Revises: prbody_citation_01
Create Date: 2026-10-08

Plan ``2026-10-08-operator-editable-model-family-per-plan-difficulty``.

The gap
=======

The plan library serves, on ``GET /plan-library``, ``/candidates`` and
``/difficulty``, a ``model_selectors`` map (difficulty level → the model family
``/vet-imp-sweep --route-by-difficulty`` spawns that plan on) and its display
twin ``model_tiers``. Both were constants in ``app.services.plan_difficulty``,
so moving ``high`` from Fable to Opus — the operator's ask once Opus 5.5 shipped
— needed a code change and a deploy.

What this revision does
=======================

Creates ``agent.plan_difficulty_model_routes``: one row per
``(organization_id, level)`` naming a ``model_family``. A level with no row
resolves to the shipped default, so the table starts empty and the served map
is unchanged until an operator writes.

* **The family, never a model version.** ``fable | opus | sonnet | haiku`` —
  the ``claude_code_agent_tool_v1`` selector vocabulary. The harness resolves a
  family alias to that family's latest model.
* **``organization_id`` NOT NULL, and the primary key's first column.** The
  plan library's NULL organization bucket is shared by every principal without
  a personal organization; a routing assertion there would re-route another
  principal's sweeps, so that scope reads the defaults and cannot write. With
  no NULL to collapse, a plain composite primary key is the identity — no
  functional index, no ``CONCURRENTLY`` build.
* **CHECKs on both closed columns**, declared inline in ``CREATE TABLE``; the
  table is new, so they validate nothing.
* No FK on ``organization_id`` / ``updated_by_user_id``, matching every other
  ``agent.*`` plan-library table.

Downgrade
=========

Drops the table. Every organization falls back to the shipped default map;
what is lost is the operator's choice, which the console re-records in one save.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_10_model_routes"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "prbody_citation_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the per-organization routing table."""
    op.execute("CREATE SCHEMA IF NOT EXISTS agent")
    # One plain literal — coord's migration classifier refuses dynamic SQL.
    # The two IN-lists must equal ``app.models.plan_model_route`` ROUTE_LEVELS
    # and MODEL_FAMILIES; tests/test_plan_library_10_model_routes_migration.py
    # asserts they do.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agent.plan_difficulty_model_routes (
            organization_id     UUID NOT NULL,
            level               TEXT NOT NULL
                CONSTRAINT ck_plan_difficulty_model_routes_level
                CHECK (level IN ('high', 'medium', 'low')),
            model_family        TEXT NOT NULL
                CONSTRAINT ck_plan_difficulty_model_routes_family
                CHECK (model_family IN ('fable', 'opus', 'sonnet', 'haiku')),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by_user_id  UUID,
            CONSTRAINT plan_difficulty_model_routes_pkey
                PRIMARY KEY (organization_id, level)
        )
        """
    )


def downgrade() -> None:
    """Drop the table; every organization falls back to the default map."""
    op.execute("DROP TABLE IF EXISTS agent.plan_difficulty_model_routes")
