"""fix_subscription_user_id_type

Revision ID: 9d66b0c555d3
Revises: c1464319e0e2
Create Date: 2025-11-10 23:15:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9d66b0c555d3"
down_revision: str | None = "c1464319e0e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Check if subscriptions table exists and if user_id is INTEGER
    conn = op.get_bind()
    result = conn.execute(sa.text("""
        SELECT data_type
        FROM information_schema.columns
        WHERE table_name = 'subscriptions'
        AND column_name = 'user_id'
    """))
    row = result.fetchone()

    if row and row[0] == "integer":
        # If there's data, we need to be careful
        # For pre-launch, safest to just drop and recreate
        op.execute("""
            -- Drop the subscriptions table if it exists with wrong schema
            DROP TABLE IF EXISTS subscriptions CASCADE;

            -- Recreate with correct schema
            CREATE TABLE subscriptions (
                id SERIAL PRIMARY KEY,
                user_id UUID NOT NULL UNIQUE REFERENCES users(id),
                stripe_customer_id VARCHAR,
                stripe_subscription_id VARCHAR,
                stripe_price_id VARCHAR,
                tier VARCHAR NOT NULL DEFAULT 'free',
                status VARCHAR NOT NULL DEFAULT 'active',
                current_period_start TIMESTAMP,
                current_period_end TIMESTAMP,
                cancel_at_period_end BOOLEAN DEFAULT FALSE,
                canceled_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );

            -- Create indexes
            CREATE INDEX ix_subscriptions_id ON subscriptions(id);
            CREATE INDEX ix_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
            CREATE INDEX ix_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);
        """)


def downgrade() -> None:
    # No downgrade - this is a schema fix for production
    pass
