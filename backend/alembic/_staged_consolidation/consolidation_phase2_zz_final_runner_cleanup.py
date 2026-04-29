"""consolidation phase2 zz final runner cleanup

Revision ID: consolidation_phase2_zz_final_runner_cleanup
Revises: consolidation_phase2_v_33_deferred_questions_types
Create Date: 2026-04-29

FINAL Phase 2 revision. Retires the ``runner`` schema by:

1. Dropping ``runner.schema_migrations`` — runner-native bookkeeping
   that no longer has a writer (the runner-native MIGRATIONS array
   gets deleted in plan Phase 4).
2. Relocating the three remaining ``runner.*`` survivors from the
   existing alembic chain into their canonical schemas per the
   mapping in ``tmp_migration_consolidation_plan.md``.
3. Dropping the now-empty ``runner`` schema with ``RESTRICT`` so any
   missed survivor surfaces as a clear error rather than silent data
   loss.

Survivors moved (verified via grep for ``schema="runner"`` and
``runner.<ident>`` references in alembic versions/):

| from              | to                  | created by                                                                |
|-------------------|---------------------|---------------------------------------------------------------------------|
| ``runner.users``  | ``auth.users``      | ``d7e2f1a8b3c4_repoint_user_fks_to_runner_schema.py`` (FK target)         |
| ``runner.runners``| ``auth.runners``    | earlier in chain; modified by ``unify_runner_concepts.py``                |
| ``runner.runner_sessions`` | ``auth.runner_sessions`` | renamed from ``runner.runner_connections`` in ``unify_runner_concepts.py`` |

Schema choice for ``runners`` / ``runner_sessions``:
The schema mapping in the plan explicitly assigns ``users → auth``.
``runners`` and ``runner_sessions`` aren't called out specifically but
fit ``auth.*`` semantically: they're per-user device-identity tables
(registered runner clients + their currently-open WebSocket sessions),
distinct from ``coord.runner_instances`` which tracks operational
process state across machines. Documented here so the mapping decision
is auditable. If the topology plan author would rather see them in
``coord.*``, this revision is the right place to amend before transplant.

Important: the alembic chain's earlier ``runner.*`` revisions
(``d7e2f1a8b3c4_repoint_user_fks_to_runner_schema``,
``unify_runner_concepts``, ``tighten_runner_schema``, etc.) become
"applied successfully but operate on a renamed schema" after this
revision. The ``alembic_version`` row remembers their revision IDs;
they still ran. Don't try to rewrite chain history.

Cross-schema FKs that follow automatically:
``ALTER TABLE … SET SCHEMA …`` preserves all foreign-key relationships
(Postgres updates the constraint references). The 87 cross-schema FKs
from various ``public.*`` (and post-Phase-1, ``project.*``) tables
to ``runner.users`` will silently follow the move to ``auth.users``;
sibling FK ``runner.runner_sessions.runner_id → runner.runners(id)``
will become ``auth.runner_sessions.runner_id → auth.runners(id)`` once
both moves complete.

Code changes that DO NOT happen here (separate, coordinated):
- ``app/models/user.py`` ``__table_args__ = {"schema": "runner"}`` →
  ``{"schema": "auth"}``. Required so the SQLAlchemy ORM points at
  the new location. Land in the same PR that transplants
  ``_staged_consolidation/`` into ``versions/``.
- Same for any model with ``__table_args__ = {"schema": "runner"}``
  for runners / runner_sessions.

Idempotency: ``ALTER TABLE IF EXISTS`` and ``DROP TABLE IF EXISTS``
make every step a no-op on already-migrated DBs. ``DROP SCHEMA IF
EXISTS … RESTRICT`` errors only if the schema is non-empty; an empty
schema drops cleanly.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase2_zz_final_runner_cleanup"
down_revision: str = "consolidation_phase2_v_33_deferred_questions_types"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Drop runner-native bookkeeping table.
    op.execute("DROP TABLE IF EXISTS runner.schema_migrations CASCADE")

    # 2. Relocate identity / device-registry tables from runner.* to auth.*.
    #    SET SCHEMA preserves FK relationships; cross-schema FKs follow
    #    automatically.
    op.execute("ALTER TABLE IF EXISTS runner.users SET SCHEMA auth")
    op.execute("ALTER TABLE IF EXISTS runner.runners SET SCHEMA auth")
    op.execute("ALTER TABLE IF EXISTS runner.runner_sessions SET SCHEMA auth")

    # 3. Retire the schema. RESTRICT (default) instead of CASCADE so any
    #    missed survivor surfaces as a `dependent objects still exist`
    #    error rather than silently dropping rows.
    op.execute("DROP SCHEMA IF EXISTS runner RESTRICT")


def downgrade() -> None:
    """Best-effort downgrade.

    Re-creates the ``runner`` schema and moves the three identity tables
    back. Data is preserved by ``SET SCHEMA``. The ``schema_migrations``
    table is NOT recreated — its content (a row per applied runner-
    native version) cannot be reconstructed and the runner-native
    migration system is being deleted upstream anyway.
    """
    op.execute("CREATE SCHEMA IF NOT EXISTS runner")
    op.execute("GRANT ALL ON SCHEMA runner TO qontinui_user")

    op.execute("ALTER TABLE IF EXISTS auth.runner_sessions SET SCHEMA runner")
    op.execute("ALTER TABLE IF EXISTS auth.runners SET SCHEMA runner")
    op.execute("ALTER TABLE IF EXISTS auth.users SET SCHEMA runner")
