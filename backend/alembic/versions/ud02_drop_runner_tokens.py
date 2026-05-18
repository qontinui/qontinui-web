"""ud02 drop recreated auth.runner_tokens table

Revision ID: ud02_drop_runner_tokens
Revises: ud01_unify_devices_registry
Create Date: 2026-05-18

Phase 5 of plan
``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``.

Retires the ``auth.runner_tokens`` table. Migration
``7931bff72fe5_remove_runner_tokens.py`` previously dropped it, but the
SQLAlchemy ``RunnerToken`` model was subsequently recreated with a
widened ``token_hash VARCHAR(255)`` for Argon2 — see the docstring at
``backend/app/models/runner_token.py:23-26``. Phase 5 deletes the
recreated model alongside the token-mint endpoints (token issuance is
now coord's responsibility via ``POST /coord/devices/pair-complete``),
so the underlying table must go as well.

Chained off ``ud01_unify_devices_registry`` (PR #144's canonical
Phase 1 revision) per operator decision 2026-05-18 (plan §3.5).
Earlier draft chained off ``wave_8_02_unify_devices`` (this session's
discarded Phase 1 attempt); rebased here for cutover alignment.

Operator priority: no backward-compat (flag-day rollout); ``downgrade``
is irreversible.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "ud02_drop_runner_tokens"
down_revision: Union[str, None] = "ud01_unify_devices_registry"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop ``auth.runner_tokens`` if it exists.

    Idempotent: ``IF EXISTS`` covers the case where the table was already
    dropped by ``7931bff72fe5_remove_runner_tokens`` and never recreated
    (canonical PG that never ran the model's auto-create path), as well
    as the case where it was recreated and now needs to go.
    """
    bind = op.get_bind()

    # Drop dependent FK first (``auth.runners.runner_token_id`` →
    # ``auth.runner_tokens.id``). The ``auth.runners`` table itself was
    # dropped by Phase 1's ``wave_8_02_unify_devices`` migration, so the
    # FK is gone with it; this is defensive only and a no-op on a clean
    # canonical PG that already ran Phase 1.
    bind.execute(
        sa.text(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'auth' AND table_name = 'runners'
                ) THEN
                    ALTER TABLE auth.runners
                        DROP CONSTRAINT IF EXISTS runners_runner_token_id_fkey;
                END IF;
            END $$;
            """
        )
    )

    op.execute("DROP TABLE IF EXISTS auth.runner_tokens CASCADE")


def downgrade() -> None:
    """Irreversible — flag-day cutover. See plan §"Cutover discipline"."""
    raise NotImplementedError(
        "wave_8_03_drop_runner_tokens is irreversible (flag-day rollout). "
        "Restore from pre-cutover pg_dump if rollback is required."
    )
