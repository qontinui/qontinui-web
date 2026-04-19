"""add dispatch_secret to runners

Revision ID: a1c4f2d8e3b5
Revises: 6b3fb9585492
Create Date: 2026-04-20 14:10:00.000000

Phase 3C of restate-port-part-b-server-runner.

Adds ``runners.dispatch_secret`` — a per-runner, 64-char hex string the web
backend uses to authenticate ``POST /api/workflows/run`` against the runner.

This secret is **stored plaintext**. The tradeoff: web is the party that
needs to *present* it as a bearer token, so we cannot one-way-hash it the
way we hash ``runner_tokens.token_hash``. The blast radius of a leak is
scoped to a single runner — rotation is handled by re-registration, which
overwrites the column via the ``register_runner`` CRUD.

The ``server_default`` generates a fresh secret on every insert path that
doesn't explicitly supply one (raw SQL, test fixtures, etc.), so existing
rows are backfilled automatically on upgrade.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c4f2d8e3b5"
down_revision: str | None = "6b3fb9585492"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ``pgcrypto`` provides ``gen_random_bytes`` — we rely on it for the
    # ``server_default``. Installing here is idempotent and cheap.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.add_column(
        "runners",
        sa.Column(
            "dispatch_secret",
            sa.String(length=128),
            nullable=False,
            server_default=sa.text("encode(gen_random_bytes(32), 'hex')"),
            comment=(
                "Per-runner m2m secret used by web to authenticate workflow "
                "dispatch POSTs to the runner. Stored plaintext; rotated on "
                "re-registration."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("runners", "dispatch_secret")
