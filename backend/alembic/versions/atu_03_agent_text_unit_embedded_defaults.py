"""agent_text_units: the embedded-default layer (published_by_version, published_at)

Revision ID: atu_03_embedded_defaults
Revises: prcheckruns_latest_03
Create Date: 2026-09-05

Phase 4a of plan ``2026-08-31-runner-publishes-embedded-command-defaults``.

``project.agent_text_units`` held two layers — the fleet default
(``organization_id IS NULL``) and an account's override — and its own docstring
said *"there is still no row for the embedded default"*. This revision adds
that third layer, so an account has a baseline to diff an override against and
a body to preview before a reset: the runner publishes its whole embedded
roster to the account it is signed in to, and each published row is marked by
a non-NULL ``published_by_version``.

Three things happen here and each is load-bearing:

1. **Two nullable columns.** ``published_by_version`` (the runner build that
   published the row) and ``published_at`` (when, as that runner reported).
   Non-NULL ``published_by_version`` IS the layer discriminator; the service
   filters every override- and fleet-addressed query on it being NULL. A CHECK
   keeps the two stamps paired — a row is published by a version AT a time, or
   it is not published at all.

2. **The account-override index is NARROWED**, not left alone. As shipped,
   ``uq_agent_text_unit_org_kind_name`` was ``UNIQUE (organization_id, kind,
   name) WHERE organization_id IS NOT NULL``. Under that predicate an account's
   override of ``vet-plan`` and the runner's published default of ``vet-plan``
   — both non-NULL org, same kind, same name — collide, and the pair whose
   coexistence is the entire point of this plan could never be stored. The
   index is dropped and recreated with ``AND published_by_version IS NULL``.

3. **A third partial unique index** for the embedded layer:
   ``UNIQUE (organization_id, kind, name) WHERE published_by_version IS NOT
   NULL`` — at most one published default per account per unit, which is what
   makes "the baseline" a well-defined row rather than a bag.

The embedded layer is **org-scoped by construction**: the runner publishes with
the operator's own user bearer, so the server assigns the org from that
credential, and the service never writes it under ``organization_id IS NULL``.
That is deliberately NOT a CHECK here, because ``organization_id`` carries
``ON DELETE SET NULL`` and a CHECK would turn an organization delete into a
constraint failure on a display baseline.

Nothing is backfilled: no row predates this revision as a published default,
and NULL is the honest value for every existing one. Dropping and recreating
the override index is safe against live data — the new predicate is strictly
narrower and every existing row has ``published_by_version IS NULL``, so the
same rows are constrained the same way.

Hand-written. ``alembic revision --autogenerate`` is banned in this repo
(served policy ``production-and-cost`` ``alembic-sole-authorship``).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "atu_03_embedded_defaults"
# The SOLE head of `main` when this was authored (2026-09-05). It is NOT
# `atu_02_atu_provenance`: `coord_pr_events_hydration_head_idx` already chains
# from that, so chaining from it here would fork the graph.
down_revision: str | Sequence[str] | None = "prcheckruns_latest_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the two stamps, pair them, and re-key the override layer."""
    op.add_column(
        "agent_text_units",
        sa.Column("published_by_version", sa.String(length=64), nullable=True),
        schema="project",
    )
    op.add_column(
        "agent_text_units",
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        schema="project",
    )
    op.create_check_constraint(
        "ck_agent_text_unit_embedded_stamp_pair",
        "agent_text_units",
        "(published_by_version IS NULL) = (published_at IS NULL)",
        schema="project",
    )

    # --- re-key the override layer so a published default can sit beside it
    op.drop_index(
        "uq_agent_text_unit_org_kind_name",
        table_name="agent_text_units",
        schema="project",
    )
    op.create_index(
        "uq_agent_text_unit_org_kind_name",
        "agent_text_units",
        ["organization_id", "kind", "name"],
        unique=True,
        schema="project",
        postgresql_where=sa.text(
            "organization_id IS NOT NULL AND published_by_version IS NULL"
        ),
    )
    op.create_index(
        "uq_agent_text_unit_embedded_kind_name",
        "agent_text_units",
        ["organization_id", "kind", "name"],
        unique=True,
        schema="project",
        postgresql_where=sa.text("published_by_version IS NOT NULL"),
    )


def downgrade() -> None:
    """Exact reversal.

    The published rows are removed FIRST: once the override index goes back to
    its wider predicate, a published default and an override of the same name
    would collide, and a downgrade that fails half-way on an index build is
    worse than one that states what it drops. The embedded layer is a display
    baseline the next runner start re-publishes, so no account text is lost.
    """
    op.execute(
        "DELETE FROM project.agent_text_units WHERE published_by_version IS NOT NULL"
    )
    op.drop_index(
        "uq_agent_text_unit_embedded_kind_name",
        table_name="agent_text_units",
        schema="project",
    )
    op.drop_index(
        "uq_agent_text_unit_org_kind_name",
        table_name="agent_text_units",
        schema="project",
    )
    op.create_index(
        "uq_agent_text_unit_org_kind_name",
        "agent_text_units",
        ["organization_id", "kind", "name"],
        unique=True,
        schema="project",
        postgresql_where=sa.text("organization_id IS NOT NULL"),
    )
    op.drop_constraint(
        "ck_agent_text_unit_embedded_stamp_pair",
        "agent_text_units",
        schema="project",
        type_="check",
    )
    op.drop_column("agent_text_units", "published_at", schema="project")
    op.drop_column("agent_text_units", "published_by_version", schema="project")
