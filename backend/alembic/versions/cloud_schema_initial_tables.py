"""cloud schema initial tables

Revision ID: cloud_schema_initial_tables
Revises: coordinator_phase_a_01_coord_tables
Create Date: 2026-04-30

Creates the cloud-only tables that power the qontinui.cloud deployment,
inside the ``cloud.*`` schema added to the canonical-DB topology by 3b
of the cloud-control carve-out (per
``D:/qontinui-root/tmp_cloud_control_carve_out.md`` §5 and
``D:/qontinui-root/tmp_canonical_db_topology_plan.md`` §4).

Per the open-core posture (business-model plan §8: "no proprietary
extensions to OSS schemas — all migrations are open SQL"), the migration
itself lives here in qontinui-web's alembic chain. The matching ORM
classes (``Subscription``, ``AdminNotificationSettings``) live in the
private qontinui-cloud-control repo and are registered with SQLAlchemy
metadata only when cloud-control is installed (via the
``register_cloud_models()`` hook documented in design §3.1).

Self-host posture: this revision creates the tables, but no rows are
ever inserted because OSS code never imports the cloud-only models.
``cloud.*`` sits empty on every self-host install.

Composed-deployment posture: cloud-control's editable install loads its
ORM classes; SQLAlchemy maps them to ``cloud.subscriptions`` and
``cloud.admin_notification_settings`` (declared via
``__table_args__ = {"schema": "cloud"}``); the cross-schema FK
``cloud.subscriptions.user_id → auth.users.id`` resolves at first query
because Postgres handles cross-schema FKs natively.

Tables created:

* ``cloud.subscriptions`` — Stripe subscription state per user (one row
  per user with stripe_customer_id, tier, status, period_end). FK to
  ``auth.users.id`` (post-consolidation location after
  ``consolidation_phase2_zz_final_runner_cleanup`` relocated users out
  of ``runner.*`` / ``public.*``).
* ``cloud.admin_notification_settings`` — Singleton row holding admin
  alert toggles ("notify on user signup", "notify on project
  creation"). No FK; just operator preferences.

Schema choice: ``cloud`` was added as the 5th canonical schema (project
/ coord / agent / auth / cloud) in the ``init-scripts/01-create-schemas.sql``
bootstrap and the ``check_alembic_schema_args.py`` ALLOWED_SCHEMAS gate
during the cloud-control carve-out. CI rejects any DDL operation that
omits ``schema=...`` or that uses a schema name outside the canonical
set; both of this revision's ``op.create_table`` calls carry an
explicit ``schema="cloud"`` keyword.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cloud_schema_initial_tables"
down_revision: str = "coordinator_phase_a_01_coord_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Defensive: the `cloud` schema is created by
    # qontinui-stack/init-scripts/01-create-schemas.sql on first
    # container start, but a fresh DB without that bootstrap (e.g. CI
    # ephemeral PG) won't have it. CREATE SCHEMA IF NOT EXISTS is a
    # no-op when the bootstrap has already run.
    op.execute("CREATE SCHEMA IF NOT EXISTS cloud")

    # ------------------------------------------------------------------
    # cloud.subscriptions
    # ------------------------------------------------------------------
    # Mirrors the moved-out `Subscription` ORM class
    # (qontinui_cloud_control.models.subscription). FK to auth.users.id
    # is cross-schema; Postgres resolves natively. ondelete=CASCADE so
    # deleting a user removes their subscription row (avoids dangling
    # references in cloud's billing audit).
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        # Stripe identifiers
        sa.Column("stripe_customer_id", sa.String(), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(), nullable=True),
        sa.Column("stripe_price_id", sa.String(), nullable=True),
        # Subscription state
        sa.Column(
            "tier",
            sa.String(),
            nullable=False,
            server_default=sa.text("'free'"),
        ),
        sa.Column(
            "status",
            sa.String(),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        # Billing period
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "cancel_at_period_end",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        # Audit
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="cloud",
    )
    op.create_index(
        "idx_subscriptions_stripe_customer",
        "subscriptions",
        ["stripe_customer_id"],
        schema="cloud",
    )
    op.create_index(
        "idx_subscriptions_stripe_subscription",
        "subscriptions",
        ["stripe_subscription_id"],
        schema="cloud",
    )

    # ------------------------------------------------------------------
    # cloud.admin_notification_settings
    # ------------------------------------------------------------------
    # Singleton operator-preferences row. No FK because the settings
    # apply globally to the cloud-control deployment; not user-scoped.
    op.create_table(
        "admin_notification_settings",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "notification_email",
            sa.String(),
            nullable=False,
            comment="Email address to send admin notifications to",
        ),
        sa.Column(
            "notify_on_user_signup",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
            comment="Send notification when a new user signs up",
        ),
        sa.Column(
            "notify_on_project_created",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
            comment="Send notification when a new project is created",
        ),
        sa.Column(
            "notifications_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
            comment="Master toggle for all admin notifications",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="cloud",
    )


def downgrade() -> None:
    # Drop tables in reverse dependency order. The cloud schema itself
    # is left in place — DROP SCHEMA is the responsibility of a future
    # revision that retires the cloud product entirely (which is not
    # this revision's concern).
    op.drop_table("admin_notification_settings", schema="cloud")
    op.drop_index(
        "idx_subscriptions_stripe_subscription",
        table_name="subscriptions",
        schema="cloud",
    )
    op.drop_index(
        "idx_subscriptions_stripe_customer",
        table_name="subscriptions",
        schema="cloud",
    )
    op.drop_table("subscriptions", schema="cloud")
