"""coord.agent_registry admin ceiling + coord.agent_registry_observed_names

Phase 1 of plan
``2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type``
(qontinui-dev-notes). This is the qontinui-web half, which lands and applies
FIRST; coord's Phase 3 reads and writes these surfaces and must not deploy
until this revision is on the serving database.

What this migration does
========================

1. Adds the tenant-admin **ceiling** to ``coord.agent_registry`` — five
   columns, in one ``ALTER``::

       admin_disabled     boolean      NOT NULL DEFAULT false
       admin_disposition  text         NULL
       admin_disabled_by  text         NULL
       admin_disabled_at  timestamptz  NULL
       admin_reason       text         NULL

2. Creates ``coord.agent_registry_observed_names`` — one row per
   ``(tenant_id, agent_name)`` the spawn guard hook reported on an
   ``UNKNOWN_AGENT`` miss, so the admin catalog can list a custom agent type
   that is spawned but has no registry row and is declared in no registered
   repo (plan D2, the "observed" source)::

       tenant_id        uuid         NOT NULL
       agent_name       text         NOT NULL
       first_seen_at    timestamptz  NOT NULL DEFAULT now()
       last_seen_at     timestamptz  NOT NULL DEFAULT now()
       last_device_id   uuid         NULL
       spawn_path_hint  text         NULL
       PRIMARY KEY (tenant_id, agent_name)

Why a ceiling and not ``default_enabled`` (plan D1)
===================================================

``default_enabled`` is the tenant DEFAULT, and a member's
``coord.agent_user_prefs.enabled`` overrides it in both directions. Reusing it
for "an admin turned this agent type off" would let any member re-enable what
the admin disabled. The ceiling is a separate column so coord can fold
``enabled = !admin_disabled && (pref ?? default_enabled)``: a member may narrow
it but never widen it. ``default_enabled`` and ``allowed_dispositions`` are
untouched, so no existing row changes meaning.

Column authority
================

* ``admin_disabled boolean NOT NULL DEFAULT false`` — every existing row and
  every row inserted without it is NOT admin-disabled, which is the
  capability-ships-enabled posture: an agent type stays on until someone turns
  it off. On PostgreSQL 11+ an ``ADD COLUMN ... NOT NULL DEFAULT <constant>``
  is catalogue-only (the default is stored as the attribute's missing value),
  so no row is rewritten.
* ``admin_disposition text NULL`` — the disposition the admin picked from the
  row's ``allowed_dispositions`` (``block`` | ``degrade`` | ``warn_proceed``).
  NULL means none was picked, which coord reads as ``degrade`` (plan D5;
  served ``production-and-cost`` ``agent-spawn-authorization``). NULL is not a
  value the admin chose and is kept distinct from an explicit ``degrade``.
* ``admin_disabled_by text NULL`` / ``admin_disabled_at timestamptz NULL`` /
  ``admin_reason text NULL`` — who last flipped the ceiling, when, and why.
  coord writes them on every admin-switch write (both directions), so they
  describe the LAST decision rather than only a disable. NULL on a row no
  admin has ever switched.
* ``coord.agent_registry_observed_names`` — ``first_seen_at`` /
  ``last_seen_at`` default to ``now()`` so coord's observe upsert can insert
  with neither and bump only ``last_seen_at`` on conflict. ``last_device_id``
  is the reporting device; ``spawn_path_hint`` is what the hook could tell
  (e.g. ``in_session_subagent``), NULL when it could tell nothing.
  ``tenant_id`` carries no foreign key, matching ``coord.agent_registry``
  (``agent_registry_01``'s design notes). The composite primary key is the
  upsert target and serves the by-tenant catalog read (``tenant_id``
  leading), so no second index is needed.

No CHECK constraints
====================

Matching ``agent_registry_01``'s stated convention: the disposition and
spawn-path vocabularies are Rust-enforced in coord, deliberately NOT DB
CHECKs, so vocabulary evolution never requires a migration. Agent-name
normalization (lowercase, ``[a-z0-9_-]``; plan D6) is likewise coord's.

Lock posture
============

The ``ALTER`` takes an ``ACCESS EXCLUSIVE`` lock on ``coord.agent_registry``,
which coord reads on every spawn authorization and every ``/effective`` call.
``env.py`` runs the whole batch in one transaction (``env.py``
``context.begin_transaction()``), so once granted the lock is held until the
BATCH commits, including any later revisions applied in the same run. It is
brief only when this revision is the last in its batch. Both directions bound
the WAIT with ``SET LOCAL lock_timeout = '3s'`` and restore the default
afterwards: a blocked apply fails fast instead of queueing every registry read
behind it. ``coordrls_01``'s ``autocommit_block`` is the escape if the hold
ever matters. The new table is invisible to every other session until the
batch commits.

Idempotency / authorship posture
================================

* ``ADD COLUMN IF NOT EXISTS`` / ``CREATE TABLE IF NOT EXISTS`` /
  ``COMMENT ON``, all in one transaction, so a failed apply rolls back whole.
  ``IF NOT EXISTS`` matches on NAME only and is type-blind; no earlier revision
  spells any of these names, and the companion test asserts every type.
* ``downgrade()`` is the exact inverse: it drops the table, then the five
  columns. The admin decisions and observations they held do not come back.
* **alembic is the SOLE author of the ``coord.*`` schema** (served policy
  ``production-and-cost`` ``alembic-sole-authorship``). Hand-authored;
  ``alembic revision --autogenerate`` was not run — there are no SQLAlchemy
  models behind ``coord.agent_registry``. coord's
  ``crates/coord-migrations/schema.manifest`` moves only when the migrator pin
  is bumped past this revision (plan Phase 3a), never by hand.
* Grants: ``agent_registry_01`` applies none, and neither does this revision.
  The ``coord_tenant`` / ``coord_tenant_preflight`` roles get their table
  privileges from ``coordrls_01``'s ``ALTER DEFAULT PRIVILEGES``.
* Every SQL string is a static literal (so the revision renders unchanged in
  offline ``--sql`` mode), with no ``:word`` bind-looking sequence and no
  ``%``. No ``op.get_bind()`` read.

Chaining
========

``down_revision = "coord_subprojects_05_note_events"`` — ``main``'s single
alembic head, measured 2026-11-24 with ``scripts/ci/count_alembic_heads.py``
(``HEAD_COUNT=1``) at ``origin/main`` ``94b0cc0b2``. A re-point is three
coupled edits: ``down_revision``, the ``Revises:`` line below, and
``_PARENT_REVISION_ID`` in
``tests/test_agent_registry_02_admin_ceiling_migration.py``.

Revision ID: agent_registry_02_admin_ceiling
Revises: coord_subprojects_05_note_events
Create Date: 2026-11-24

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "agent_registry_02_admin_ceiling"
down_revision: str | None = "coord_subprojects_05_note_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the five ceiling columns and create the observed-names table."""
    # Bound the ACCESS EXCLUSIVE wait on a table every spawn authorization reads.
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.agent_registry
            ADD COLUMN IF NOT EXISTS admin_disabled    boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS admin_disposition text,
            ADD COLUMN IF NOT EXISTS admin_disabled_by text,
            ADD COLUMN IF NOT EXISTS admin_disabled_at timestamptz,
            ADD COLUMN IF NOT EXISTS admin_reason      text
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_registry.admin_disabled IS
            'Tenant-admin CEILING (plan '
            '2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type D1). '
            'coord folds enabled = NOT admin_disabled AND (member pref, else '
            'default_enabled): a member pref may narrow it, never widen it. '
            'Separate from default_enabled, which stays the tenant default.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_registry.admin_disposition IS
            'Disposition the admin picked from allowed_dispositions while '
            'admin_disabled holds. NULL = none picked, which coord reads as '
            'degrade. Vocabulary is coord-enforced, no CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_registry.admin_disabled_by IS
            'Actor of the LAST admin-switch write, in either direction (a '
            're-enable writes it too). NULL = no admin has ever switched this row.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_registry.admin_disabled_at IS
            'Time of the LAST admin-switch write, in either direction. NULL = no '
            'admin has ever switched this row.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_registry.admin_reason IS
            'Free-text reason the admin gave on the LAST admin-switch write. NULL '
            '= none given, or no admin has ever switched this row.'
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.agent_registry_observed_names (
            tenant_id        uuid         NOT NULL,
            agent_name       text         NOT NULL,
            first_seen_at    timestamptz  NOT NULL DEFAULT now(),
            last_seen_at     timestamptz  NOT NULL DEFAULT now(),
            last_device_id   uuid,
            spawn_path_hint  text,
            PRIMARY KEY (tenant_id, agent_name)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.agent_registry_observed_names IS
            'Agent type names the spawn guard hook reported on an UNKNOWN_AGENT '
            'miss (no coord.agent_registry row), one row per tenant and name. '
            'The observed source of the admin agent catalog (plan '
            '2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type D2). '
            'Written by coord only; alembic authors the DDL.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_registry_observed_names.spawn_path_hint IS
            'The spawn path the reporting hook could tell (e.g. '
            'in_session_subagent). NULL = it could tell nothing, which is UNKNOWN, '
            'not a default. Vocabulary is coord-enforced, no CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_registry_observed_names.last_device_id IS
            'Device that sent the most recent observation. NULL = the report '
            'carried no device.'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the observed-names table, then the five ceiling columns."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP TABLE IF EXISTS coord.agent_registry_observed_names")
    op.execute(
        """
        ALTER TABLE coord.agent_registry
            DROP COLUMN IF EXISTS admin_reason,
            DROP COLUMN IF EXISTS admin_disabled_at,
            DROP COLUMN IF EXISTS admin_disabled_by,
            DROP COLUMN IF EXISTS admin_disposition,
            DROP COLUMN IF EXISTS admin_disabled
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
