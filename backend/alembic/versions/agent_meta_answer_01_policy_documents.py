"""agent-meta-answer 01 coord.policy_documents — tenant policy-document store

Revision ID: agent_meta_answer_01_policy_documents
Revises: auto_fix_red_main_01
Create Date: 2026-07-08

Plan "agent meta-answer" (qontinui-dev-notes/plans/2026-07-08-agent-meta-answer.md).

Creates one data-driven ``coord.*`` table consumed by qontinui-coord (Rust),
which cannot author DDL — Alembic in qontinui-web is the sole author of the
``coord.*`` schema (see ``fleet_policy_01_coord_fleet_runtime_policy`` /
``decision_engine_phase0`` for the established convention this migration
mirrors):

* ``coord.policy_documents`` — one row per (tenant, handle) named policy
  document (e.g. an onboarding doc, an escalation runbook) that coord's
  meta-answer surface can serve verbatim or summarize. ``handle`` is a
  short, stable, human-chosen slug scoped to the tenant; ``format`` records
  how ``body`` should be rendered (default ``markdown``); ``default_source``
  is an optional free-text provenance marker (e.g. a code/template default
  the row was seeded from) used the same way sibling ``policy_rules`` rows
  use it (see migration 02 in this same plan) to support restore-to-default
  flows.

Design notes:

* ``(tenant_id, handle)`` uniqueness is enforced with a plain
  ``sa.UniqueConstraint`` — both columns are ``NOT NULL`` here (unlike the
  ``fleet_runtime_policy`` scope index), so no ``COALESCE`` trick is needed
  and a raw-SQL functional index is unnecessary.
* ``coord`` already exists (created by
  ``consolidation_phase1_01_infrastructure``); this migration does NOT
  ``CREATE SCHEMA``.
* Pure DDL only — no data/seed rows. Seeding of policy documents is done
  app-side by coord.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
# down_revision re-pointed from "auto_fix_red_main_01" to the current single
# alembic head "coord_memory_synthesis_jobs": main advanced ~13 migrations past
# auto_fix_red_main_01 while this PR sat open, so branching off it produced a
# second alembic head and failed the required `alembic-heads-pr` gate. Chaining
# onto the live head restores a single linear head. coord's land-time dry-rebase
# re-points this again if the head drifts before merge.
revision: str = "agent_meta_answer_01_policy_documents"
down_revision: str | Sequence[str] | None = "coord_memory_synthesis_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "policy_documents",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        # Short, stable, tenant-scoped slug identifying the document.
        sa.Column("handle", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        # Rendering hint for `body`; plain TEXT, no enum — validated app-side.
        sa.Column(
            "format",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'markdown'"),
        ),
        # Optional provenance marker (e.g. which code/template default this
        # row was seeded from), enabling restore-to-default flows.
        sa.Column("default_source", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "tenant_id",
            "handle",
            name="uq_policy_documents_tenant_handle",
        ),
        schema="coord",
    )
    # List-by-tenant hot path.
    op.create_index(
        "idx_policy_documents_tenant",
        "policy_documents",
        ["tenant_id"],
        schema="coord",
    )


def downgrade() -> None:
    # Reverse order of upgrade().
    op.drop_index(
        "idx_policy_documents_tenant",
        table_name="policy_documents",
        schema="coord",
    )
    op.drop_table("policy_documents", schema="coord")
