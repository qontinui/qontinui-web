"""consolidation phase 7: move identity tables to auth schema

Revision ID: consolidation_phase7_02_move_auth_tables
Revises: consolidation_phase7_01_drop_collision_shadows
Create Date: 2026-05-01

Phase 7 of the migration consolidation
(``D:/qontinui-root/tmp_consolidation_phase7_public_drift.md``).

Moves 13 identity / auth-related tables from ``public.*`` into ``auth.*``,
joining the existing ``auth.users``. Per plan §2 Bucket A and §6.2:

* From Bucket A (10): ``organizations``, ``team_members``,
  ``organization_invitations``, ``runner_tokens``, ``runner_devices``,
  ``runner_connections``, ``runners``, ``device_sessions``,
  ``push_devices``, ``audit_logs``.
* From §6.2 (3 — open-questions resolved as OSS → ``auth.*``):
  ``storage_usage``, ``analytics_events``, ``usage_metrics``.

Postgres preserves cross-schema FKs natively across
``ALTER TABLE … SET SCHEMA``: the constraint-target references update
in place. The plan §5.3 calls this out specifically — verify with
``information_schema.referential_constraints`` after applying.

Defensive shape: each move is guarded by a "exists in public AND not in
auth" idempotency check. If a table was already moved (from prior partial
run, or by an unrelated revision in the interval), the move is skipped
silently. If neither location has it, a warning is raised but execution
continues.

Companion SQLAlchemy ``__table_args__`` updates land in the
``consolidation_phase7_08_repoint_sqlalchemy_models`` companion PR per
plan §5.2 (combined with backlog item #4's runner→auth cleanup). Until
that ships, the ORM points the moved tables at the wrong schema —
runtime queries through these models will fail. **This revision must
not be deployed without the companion model PR landing in lockstep.**

Uses ``op.execute()`` only; not subject to the schema-arg gate.

Downgrade: reverses each ``SET SCHEMA`` move. Unlike revision 01, the
moves are reversible because no data is lost.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "consolidation_phase7_02_move_auth_tables"
down_revision: str = "consolidation_phase7_01_drop_collision_shadows"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_UPGRADE_SQL = """
DO $$
DECLARE
    tbl TEXT;
    in_public BOOLEAN;
    in_auth BOOLEAN;
    moved INT := 0;
    skipped_already_moved INT := 0;
    skipped_missing INT := 0;
    target_tables TEXT[] := ARRAY[
        'organizations','team_members','organization_invitations',
        'runner_tokens','runner_devices','runner_connections','runners',
        'device_sessions','push_devices','audit_logs',
        'storage_usage','analytics_events','usage_metrics'
    ];
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = tbl AND table_type = 'BASE TABLE'
        ) INTO in_public;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'auth' AND table_name = tbl AND table_type = 'BASE TABLE'
        ) INTO in_auth;

        IF in_auth AND NOT in_public THEN
            skipped_already_moved := skipped_already_moved + 1;
            RAISE NOTICE 'phase7_02: % already in auth — skipping', tbl;
            CONTINUE;
        END IF;

        IF NOT in_public THEN
            skipped_missing := skipped_missing + 1;
            RAISE WARNING 'phase7_02: % not in public or auth — skipping', tbl;
            CONTINUE;
        END IF;

        IF in_auth AND in_public THEN
            RAISE EXCEPTION 'phase7_02: % exists in BOTH public and auth — manual reconciliation required before moving', tbl;
        END IF;

        EXECUTE format('ALTER TABLE public.%I SET SCHEMA auth', tbl);
        moved := moved + 1;
        RAISE NOTICE 'phase7_02: moved % from public to auth', tbl;
    END LOOP;

    RAISE NOTICE 'phase7_02 summary: moved=%, skipped_already_moved=%, skipped_missing=%',
        moved, skipped_already_moved, skipped_missing;
END $$;
"""


_DOWNGRADE_SQL = """
DO $$
DECLARE
    tbl TEXT;
    in_public BOOLEAN;
    in_auth BOOLEAN;
    target_tables TEXT[] := ARRAY[
        'organizations','team_members','organization_invitations',
        'runner_tokens','runner_devices','runner_connections','runners',
        'device_sessions','push_devices','audit_logs',
        'storage_usage','analytics_events','usage_metrics'
    ];
BEGIN
    FOREACH tbl IN ARRAY target_tables LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'auth' AND table_name = tbl AND table_type = 'BASE TABLE'
        ) INTO in_auth;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = tbl AND table_type = 'BASE TABLE'
        ) INTO in_public;

        IF in_auth AND NOT in_public THEN
            EXECUTE format('ALTER TABLE auth.%I SET SCHEMA public', tbl);
            RAISE NOTICE 'phase7_02 downgrade: moved % back to public', tbl;
        ELSIF in_public AND NOT in_auth THEN
            RAISE NOTICE 'phase7_02 downgrade: % already in public — skipping', tbl;
        END IF;
    END LOOP;
END $$;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.execute(_DOWNGRADE_SQL)
