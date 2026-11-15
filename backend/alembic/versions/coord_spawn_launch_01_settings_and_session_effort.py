"""coord.spawn_launch_settings + coord.agent_sessions.model/.effort

Revision ID: coord_spawn_launch_01_settings_and_session_effort
Revises: cfo_01_continuation_deferred_device
Create Date: 2026-11-15

Phase 1 (web DDL) of plan
``2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type``
(design decision D2, as corrected by vet correction V2).

coord authors zero ``coord.*`` DDL (``[policy: alembic-sole-authorship]``), so
the table and columns coord will read and write land here, and this revision
must be APPLIED in production before coord reads them (plan Phase 2 degrades on
42P01 / 42703 to "no settings" until it is).

Why
===

Every session coord spawns today launches at whatever model and reasoning
effort the runner's launch template happens to carry. The operator has no
per-spawn-type say: a red-CI fixer and a plan implementer launch identically.
This revision adds the two stores that let the operator choose, and let a
spawn inherit from the session that caused it.

1. ``coord.spawn_launch_settings`` -- one row per ``(tenant_id, spawn_type)``:
   the operator's chosen model family and effort for spawns of that work type.
   ``spawn_type`` is a ``session_work_type.json`` work-type wire name whose
   ``dispatch_settable`` is true (qontinui-schemas, plan Phase 0). It carries
   NO ``CHECK``, by design and matching ``coord.session_runs.work_type``: the
   vocabulary is the schemas contract's, validated at coord's write door, so
   a new work type needs no migration. ``model_family`` and ``effort`` DO
   carry a ``CHECK``: they are closed vocabularies coord renders straight into
   a ``claude --model`` / ``--effort`` argv, so an unrenderable value must be
   refused at rest, not discovered at launch. NULL in either means "no
   operator setting for this field" -- the resolver falls through to the
   continuation's own key, then to the originating session, then to the
   launch template. A row with both NULL is legal (a cleared setting).

2. ``coord.agent_sessions.model`` / ``.effort`` -- what a session actually ran
   at, written by coord's session-context route (fed by the
   qontinui-claude-config ``Stop`` hook ``session-context-report.sh``, the same
   writer as ``context_tokens``), read by coord's launch resolver as the
   ``originating_session`` source. ``model`` is the RAW model id as reported
   (e.g. ``claude-opus-4-5``, at most 128 chars, enforced at coord's door),
   so it carries no ``CHECK``; coord reduces it to a family at resolve time.
   ``effort`` is a level, so it carries the same ``CHECK`` as the settings
   table. They sit on ``coord.agent_sessions`` (not ``coord.sessions``)
   because ``commit_lineage.agent_session_id`` and gates' ``agent_session_id``
   -- the keys the resolver starts from -- reference ``coord.agent_sessions``.
   ``model`` did not exist on this table on ``origin/main`` at authoring time
   (no revision in the chain spells it); it is added here.

Semantics
=========

``NULL`` on the session columns means the hook never reported -- every
existing row, and any session on a box without the hook. The resolver reads
that as UNKNOWN and stamps nothing from it (served policy
``verification-and-evidence`` ``unknown-must-not-render-as-a-default``). So: no
default and no backfill on either session column.

Head choice
===========

``down_revision`` is the single head of ``origin/main`` at authoring time
(``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``). Re-point rule: if
another alembic revision lands first, coord re-points ``down_revision`` at land
time; the companion test's ``_PARENT_REVISION_ID`` literal moves with it.

Safety
======

The new table is created empty, so it holds no lock anyone waits on.

On ``coord.agent_sessions`` both columns are nullable with no default, so each
ADD is catalogue-only and rewrites no row. The effort ``CHECK`` is added as a
SEPARATE named constraint rather than inline on the ``ADD COLUMN``: an inline
constraint on ``ADD COLUMN IF NOT EXISTS`` is skipped with the whole clause
when the column already exists (the trap
``coord_tenant_fk_01_repair_missing_tenant_fks`` repaired), and
``DROP CONSTRAINT IF EXISTS`` + ``ADD CONSTRAINT`` converges either way. Adding
it scans the table once under the ACCESS EXCLUSIVE the ADD COLUMN already
holds; every row's ``effort`` is NULL at that moment, so the scan reads and
refuses nothing. ``coord.agent_sessions`` is written by coord on every session
heartbeat, so the lock WAIT is bounded with ``SET LOCAL lock_timeout = '3s'``
and restored afterwards -- env.py runs the whole upgrade batch in one
transaction, so an unrestored ``SET LOCAL`` would impose the ceiling on every
later revision. Every SQL string is a static literal, so the revision renders
unchanged in offline ``--sql`` mode.

Downgrade drops the session columns (with their constraint) and the table
``IF EXISTS``; the data does not return.

No index beyond the primary key: the resolver reads a settings row by
``(tenant_id, spawn_type)`` and a session row by ``id``.

Merge-train classifier disposition
==================================

The lock bracket makes ``upgrade()`` unclassifiable to coord's migration
classifier (``SET ...`` matches no branch of ``classify_sql_statement``), so an
``auto_if_provably_safe`` escalate policy covering this glob returns Blocked
rather than clearing. That is the known price of the guard, the same one
``coord_agent_sessions_context_01`` documents, not a defect.

Hand-authored; never ``alembic revision --autogenerate``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_spawn_launch_01_settings_and_session_effort"
down_revision: str | Sequence[str] | None = "cfo_01_continuation_deferred_device"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the settings table and add the session model/effort columns."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.spawn_launch_settings (
            tenant_id    UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            spawn_type   TEXT NOT NULL,
            model_family TEXT NULL,
            effort       TEXT NULL,
            updated_by   TEXT NULL,
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT spawn_launch_settings_pkey
                PRIMARY KEY (tenant_id, spawn_type),
            CONSTRAINT spawn_launch_settings_model_family_chk
                CHECK (model_family IN ('fable', 'opus', 'sonnet', 'haiku')),
            CONSTRAINT spawn_launch_settings_effort_chk
                CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max'))
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.spawn_launch_settings IS
            'Operator-chosen launch model family and reasoning effort per spawn '
            'type, one row per (tenant_id, spawn_type). spawn_type is a '
            'qontinui-schemas session_work_type.json work type whose '
            'dispatch_settable is true; validated at the coord write door, no '
            'CHECK here. NULL model_family or effort = no operator setting for '
            'that field; the coord launch resolver falls through to the '
            'continuation, then the originating session. Written by coord PUT '
            '/coord/spawn-launch-settings/{spawn_type} (operator only); read by '
            'the coord launch resolver (plan '
            '2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type).'
        """
    )

    # IF NOT EXISTS matches on NAME only; acceptable because no revision in
    # this chain spells either column on this table.
    op.execute(
        """
        ALTER TABLE coord.agent_sessions
            ADD COLUMN IF NOT EXISTS model TEXT,
            ADD COLUMN IF NOT EXISTS effort TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.agent_sessions
            DROP CONSTRAINT IF EXISTS agent_sessions_effort_chk
        """
    )
    op.execute(
        """
        ALTER TABLE coord.agent_sessions
            ADD CONSTRAINT agent_sessions_effort_chk
                CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max'))
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.model IS
            'The raw model id the session last ran at (e.g. claude-opus-4-5), '
            'as reported. Written by the coord session-context route, fed by '
            'the qontinui-claude-config Stop hook session-context-report.sh. '
            'Read by the coord launch resolver as the originating_session '
            'source, reduced to a family at resolve time (plan '
            '2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type). '
            'NULL = the hook never reported; read as UNKNOWN, never as a default.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_sessions.effort IS
            'The reasoning effort level the session last ran at (low, medium, '
            'high, xhigh, max). Written by the coord session-context route, fed '
            'by the qontinui-claude-config Stop hook session-context-report.sh. '
            'Read by the coord launch resolver as the originating_session '
            'source (plan '
            '2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type). '
            'NULL = the hook never reported; read as UNKNOWN, never as a default.'
        """
    )

    # env.py runs the whole batch in one transaction, so leaving this set would
    # silently impose a 3 s ceiling on the next revision's DDL too.
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the session columns and the settings table (data does not return)."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    # Dropping a column drops the CHECK that references only it.
    op.execute(
        """
        ALTER TABLE coord.agent_sessions
            DROP COLUMN IF EXISTS effort,
            DROP COLUMN IF EXISTS model
        """
    )
    op.execute("DROP TABLE IF EXISTS coord.spawn_launch_settings")

    op.execute("SET LOCAL lock_timeout = DEFAULT")
