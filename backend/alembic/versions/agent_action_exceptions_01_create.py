"""coord.agent_action_exceptions + suggestions + agent_refusal_events

Phase 1 of plan
``2026-11-27-every-action-is-agent-performable-unless-on-the-operator-exception-list``
(qontinui-dev-notes). This is the qontinui-web half, which lands and applies
FIRST; coord's Phase 2 reads and writes these tables and its schema-manifest
registration must not deploy until this revision is on the serving database
(served policy ``production-and-cost`` ``alembic-sole-authorship``).

Served clause it implements: ``operating-rules``
``every-action-is-agent-performable-unless-the-operator-closed-it`` — every
action is open to an agent unless the operator put it on the tenant's
exception list. These three tables ARE that list, the compiled-deny
suggestions shown to the operator once, and the record of each refusal.

What this migration creates
===========================

1. ``coord.agent_action_exceptions`` — the operator's exception list, one row
   per closed action key (plan D1 grammar ``<surface>.<verb>[:<object>]``; a
   key ending ``.*``, ``:*`` or ``/*`` is a CLASS, matching every key it
   prefixes, and a ``*`` anywhere else is refused)::

       tenant_id    uuid         NOT NULL
       id           uuid         PRIMARY KEY DEFAULT gen_random_uuid()
       action_key   text         NOT NULL
       is_class     boolean      GENERATED ALWAYS AS (action_key ~ '[.:/][*]$') STORED
       reason       text         NOT NULL  (non-blank)
       added_by     text         NOT NULL
       added_at     timestamptz  NOT NULL DEFAULT now()
       origin       text         NOT NULL  CHECK in (operator, migrated_operator_deny,
                                                    reserved_by_clause, accepted_suggestion)
       source_ref   text         NULL
       handoff      text         NULL
       enforced_by  text         NULL
       disposition  text         NULL
       removed_at   timestamptz  NULL
       removed_by   text         NULL
       CHECK ((removed_at IS NULL) = (removed_by IS NULL))
       CHECK (a ``*`` in action_key appears only as a final ``.*`` / ``:*`` / ``/*``)

   plus a partial unique index ``(tenant_id, action_key) WHERE removed_at IS
   NULL``: one LIVE entry per key, while removed rows stay as tombstones.

2. ``coord.agent_action_exception_suggestions`` — each compiled default deny
   that plan D2 removes, shown to the operator once; it takes effect only if
   the operator adds it::

       id          uuid         PRIMARY KEY DEFAULT gen_random_uuid()
       tenant_id   uuid         NOT NULL
       action_key  text         NOT NULL
       rationale   text         NOT NULL
       source_ref  text         NOT NULL
       status      text         NOT NULL DEFAULT 'pending'
                                CHECK in (pending, added, dismissed)
       decided_by  text         NULL
       decided_at  timestamptz  NULL
       UNIQUE (tenant_id, action_key)
       CHECK ((status = 'pending') = (decided_at IS NULL))
       CHECK ((decided_at IS NULL) = (decided_by IS NULL))
       CHECK (a ``*`` in action_key appears only as a final ``.*`` / ``:*`` / ``/*``)

3. ``coord.agent_refusal_events`` — one row per agent refusal written by the
   shared refusal helper (plan Phase 3), so the operator page can answer
   question ``agent-exceptions.operator.3``::

       id               bigserial    PRIMARY KEY
       tenant_id        uuid         NOT NULL
       at               timestamptz  NOT NULL DEFAULT now()
       door             text         NOT NULL
       action_key       text         NOT NULL
       code             text         NOT NULL
       listed_entry_id  uuid         NULL
       principal_kind   text         NOT NULL
       session_id       text         NULL

   plus an index ``(tenant_id, at DESC)`` for the per-tenant recent-refusals
   read and an index ``(at)`` for the global 30-day prune.

Column authority
================

* ``is_class`` is a STORED generated column, not a writable flag: the plan
  defines it as "derived: key ends ``*``", and a generated column cannot drift
  from the key. It is true only for a key ending ``.*``, ``:*`` or ``/*``, never
  for a bare trailing ``*``: ``shell:rm -rf *`` must not become a prefix class.
  ``/*`` is a class separator beside D1's ``.*`` / ``:*`` because the plan's
  own keys need it — D1's example ``prompt_document.write:claude_settings/*``
  and Phase 4's ``prompt_document.write:<kind>/*`` end in ``/*``, and a
  ``.*``/``:*``-only rule would refuse them. The ``*_class_star_final`` CHECK on both tables
  refuses a ``*`` anywhere but that final position, so every stored key is
  either exact (no ``*``) or a well-formed class. coord never writes
  ``is_class``; an INSERT naming it is an error.
* ``source_ref`` on an exception is NULL for an entry the operator typed by
  hand (it has no source); a migrated or reserved entry carries the stored row,
  dial or clause it came from. Phase 4's reconciler keys on it and skips any
  ``source_ref`` that already has a row with ``removed_at`` set, so a deleted
  migrated entry is never resurrected. A suggestion always has a source (the
  compiled deny it replaces), so its ``source_ref`` is NOT NULL.
* ``handoff`` (the sanctioned hand-off Phase 8 renders), ``enforced_by`` and
  ``disposition`` (for ``agent.spawn:*`` entries: the agent registry's
  ``degrade`` / ``block`` / ``warn_proceed``) are NULL when they do not apply.
  NULL is not a default value: coord renders it as "none recorded".
* ``removed_at`` / ``removed_by`` are a SOFT delete. A removed entry no longer
  closes anything (coord's consult reads only ``removed_at IS NULL``) but stays
  as the tombstone the reconciler reads. They are set together or not at all.
* ``listed_entry_id`` NULL means the refusal hit a barrier that is NOT on the
  operator's list — the defect question ``.3`` counts. It is a plain uuid, not
  a foreign key: a refusal record must survive its entry's removal, and the
  event write is non-blocking (a dropped event is counted, never retried).
* ``session_id`` is text, not uuid: a harness other than Claude Code (pi,
  Codex) need not mint uuid session ids, and an event row that fails to insert
  is a lost refusal record.
* ``principal_kind`` / ``door`` / ``code`` are coord-enforced vocabularies with
  no CHECK, so a new door or refusal code never needs a migration. ``origin``
  and suggestion ``status`` DO carry CHECKs because the plan fixes those sets
  and the operator page and reconciler branch on them.
* No column of any table carries a foreign key to tenants, matching
  ``coord.agent_registry`` (``agent_registry_01``'s design notes).

The per-tenant recent-refusals read leads with ``tenant_id`` and is served by
``ix_agent_refusal_events_tenant_at``. The 30-day prune is global
(``DELETE ... WHERE at < now() - interval``, no tenant predicate), which a
``tenant_id``-leading index cannot serve, so it has its own ``(at)`` index,
``ix_agent_refusal_events_at`` (the ``launch_budget_01``
``ix_account_usage_samples_sampled`` precedent). The prune itself is coord's
leader tick (plan Phase 3), not anything in the database.

Lock posture
============

Three new tables, no ``ALTER`` of an existing one, so nothing another session
reads is locked. Each new table is invisible to other sessions until the batch
commits (``env.py`` ``context.begin_transaction()``).

Idempotency / authorship posture
================================

* ``CREATE TABLE IF NOT EXISTS`` / ``CREATE [UNIQUE] INDEX IF NOT EXISTS`` /
  ``COMMENT ON``, all in one transaction, so a failed apply rolls back whole.
  ``IF NOT EXISTS`` matches on NAME only and is type-blind; no earlier revision
  spells any of these names, and the companion test asserts every type.
* ``downgrade()`` is the exact inverse: it drops the three tables (their
  indexes and constraints go with them). The entries, suggestions and events
  they held do not come back.
* **alembic is the SOLE author of the ``coord.*`` schema** (served policy
  ``production-and-cost`` ``alembic-sole-authorship``). Hand-authored;
  ``alembic revision --autogenerate`` was not run — there are no SQLAlchemy
  models behind these tables.
* Grants: none applied here. The ``coord_tenant`` / ``coord_tenant_preflight``
  roles get table (and the bigserial's sequence) privileges from
  ``coordrls_01``'s ``ALTER DEFAULT PRIVILEGES``; the companion test asserts it.
* Every SQL string is a static literal (so the revision renders unchanged in
  offline ``--sql`` mode), with no ``:word`` bind-looking sequence and no
  ``%``. No ``op.get_bind()`` read.

Chaining
========

``down_revision = "overview_07_schedule_last_known"`` — ``main``'s single
alembic head, measured 2026-11-27 with ``scripts/ci/count_alembic_heads.py``
(``HEAD_COUNT=1``) at ``origin/main`` ``aa894fdf4``. A re-point is three
coupled edits: ``down_revision``, the ``Revises:`` line below, and
``_PARENT_REVISION_ID`` in
``tests/test_agent_action_exceptions_01_create_migration.py``.

Revision ID: agent_action_exceptions_01_create
Revises: overview_07_schedule_last_known
Create Date: 2026-11-27

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "agent_action_exceptions_01_create"
down_revision: str | None = "overview_07_schedule_last_known"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the exception list, the suggestions and the refusal events."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.agent_action_exceptions (
            tenant_id    uuid         NOT NULL,
            id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
            action_key   text         NOT NULL,
            is_class     boolean      GENERATED ALWAYS AS (action_key ~ '[.:/][*]$') STORED,
            reason       text         NOT NULL,
            added_by     text         NOT NULL,
            added_at     timestamptz  NOT NULL DEFAULT now(),
            origin       text         NOT NULL,
            source_ref   text,
            handoff      text,
            enforced_by  text,
            disposition  text,
            removed_at   timestamptz,
            removed_by   text,
            CONSTRAINT agent_action_exceptions_origin_check CHECK (
                origin IN (
                    'operator',
                    'migrated_operator_deny',
                    'reserved_by_clause',
                    'accepted_suggestion'
                )
            ),
            CONSTRAINT agent_action_exceptions_reason_nonblank CHECK (
                btrim(reason) <> ''
            ),
            CONSTRAINT agent_action_exceptions_action_key_nonblank CHECK (
                btrim(action_key) <> ''
            ),
            CONSTRAINT agent_action_exceptions_removed_pair CHECK (
                (removed_at IS NULL) = (removed_by IS NULL)
            ),
            CONSTRAINT agent_action_exceptions_class_star_final CHECK (
                action_key ~ '^[^*]*$' OR action_key ~ '^[^*]*[.:/][*]$'
            )
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_action_exceptions_live_key
            ON coord.agent_action_exceptions (tenant_id, action_key)
            WHERE removed_at IS NULL
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.agent_action_exceptions IS
            'The operator exception list (served operating-rules '
            'every-action-is-agent-performable-unless-the-operator-closed-it; plan '
            '2026-11-27-every-action-is-agent-performable-unless-on-the-operator-exception-list). '
            'Every agent action is open unless a LIVE row (removed_at IS NULL) '
            'here closes it. Written by coord operator routes and reconciler only; '
            'alembic authors the DDL.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_action_exceptions.action_key IS
            'Plan D1 grammar <surface>.<verb>[:<object>]. A key ending .*, :* '
            'or /* is a CLASS matching every key it prefixes (is_class); a * '
            'anywhere else is refused by a CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_action_exceptions.is_class IS
            'Derived: true when action_key ends .*, :* or /* (never a bare '
            'trailing *). Generated, never written.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_action_exceptions.source_ref IS
            'The stored row, dial or clause a migrated or reserved entry came '
            'from; the reconciler key. NULL = an operator typed it by hand.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_action_exceptions.disposition IS
            'For agent.spawn entries: degrade, block or warn_proceed. NULL = '
            'does not apply. Vocabulary is coord-enforced, no CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_action_exceptions.removed_at IS
            'Soft delete. A removed row closes nothing but stays as the '
            'tombstone the reconciler reads, so a deleted migrated entry is '
            'never resurrected. Set together with removed_by.'
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.agent_action_exception_suggestions (
            id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   uuid         NOT NULL,
            action_key  text         NOT NULL,
            rationale   text         NOT NULL,
            source_ref  text         NOT NULL,
            status      text         NOT NULL DEFAULT 'pending',
            decided_by  text,
            decided_at  timestamptz,
            CONSTRAINT agent_action_exception_suggestions_tenant_key_unique
                UNIQUE (tenant_id, action_key),
            CONSTRAINT agent_action_exception_suggestions_status_check CHECK (
                status IN ('pending', 'added', 'dismissed')
            ),
            CONSTRAINT agent_action_exception_suggestions_decided_iff_not_pending CHECK (
                (status = 'pending') = (decided_at IS NULL)
            ),
            CONSTRAINT agent_action_exception_suggestions_decided_pair CHECK (
                (decided_at IS NULL) = (decided_by IS NULL)
            ),
            CONSTRAINT agent_action_exception_suggestions_class_star_final CHECK (
                action_key ~ '^[^*]*$' OR action_key ~ '^[^*]*[.:/][*]$'
            )
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.agent_action_exception_suggestions IS
            'Compiled default denies removed by plan D2, shown to the operator '
            'once. A suggestion closes nothing: it takes effect only when the '
            'operator adds it (status added, plus an exception row with origin '
            'accepted_suggestion).'
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.agent_refusal_events (
            id               bigserial    PRIMARY KEY,
            tenant_id        uuid         NOT NULL,
            at               timestamptz  NOT NULL DEFAULT now(),
            door             text         NOT NULL,
            action_key       text         NOT NULL,
            code             text         NOT NULL,
            listed_entry_id  uuid,
            principal_kind   text         NOT NULL,
            session_id       text
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_agent_refusal_events_tenant_at
            ON coord.agent_refusal_events (tenant_id, at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_agent_refusal_events_at
            ON coord.agent_refusal_events (at)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.agent_refusal_events IS
            'One row per agent refusal, written non-blocking by coord shared '
            'refusal helper (plan Phase 3). Pruned to 30 days by a coord leader '
            'tick.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.agent_refusal_events.listed_entry_id IS
            'The exception entry that closed the action. NULL = the barrier is '
            'NOT on the operator list, which is a defect. No foreign key: the '
            'event outlives its entry.'
        """
    )


def downgrade() -> None:
    """Drop the three tables; their indexes and constraints go with them."""
    op.execute("DROP TABLE IF EXISTS coord.agent_refusal_events")
    op.execute("DROP TABLE IF EXISTS coord.agent_action_exception_suggestions")
    op.execute("DROP TABLE IF EXISTS coord.agent_action_exceptions")
