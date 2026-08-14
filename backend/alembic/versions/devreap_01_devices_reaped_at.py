"""coord.devices.reaped_at — soft-retire dead device rows instead of DELETEing them

Revision ID: devreap_01_devices_reaped_at
Revises: scheduler_ticks_probe_01
Create Date: 2026-08-14

Phase 4 of plan
``D:/qontinui-root/plans/2026-08-03-per-instance-device-identity.md``.

coord authors **zero** ``coord.*`` DDL (``[policy: alembic-sole-authorship]``),
so the one column its dead-device reaper writes lands here, and this revision
must be applied **before** coord reads the column.

That ordering is made safe rather than merely lucky by the coord side: both of
its consumers gate on a ``schema_readiness`` probe of
``coord.devices.reaped_at``, in opposite fail-safe directions. The reaper (the
writer) sweeps only on ``Present`` and skips with a logged reason on ``Missing``
or ``Unknown``; ``fleet::list_fleet`` (the reader) appends its
``reaped_at IS NULL`` filter only on ``Present`` and omits it otherwise, so
pre-migration ``/coord/fleet`` behaves byte-identically to today instead of
500-ing on an unknown column. Either side can therefore deploy first, and coord
picks the column up within one refresh interval with no restart.

What this is for
================

``coord.devices`` accumulates rows that are not devices. A live read of
``GET /coord/fleet`` on 2026-08-14 returned **26 rows of which 6 are a real
machine** — ``spaceship``, ``monster``, ``MSI``, ``nomad``,
``gh-runner-msi-wsl``, ``gh-runner-spaceship-wsl``. The other 20 are probe and
diagnostic leftovers (``_probe_1``…``_probe_6``, ``_fix_probe_1..3``,
``_probe_fresh``, ``diag3``, ``spaceship-diag``, ``spaceship-diag2``,
``treecleanup``, ``pgpool-merge-cli``, ``baserate-calib-a``/``-b`` ×4,
``e2e-svc-principal-test``). Eleven of them have a NULL ``last_seen_at``; the
other nine carry a **non-NULL but ancient** one (2026-05-19 … 2026-06-09). That
split is why the reaper keys on *liveness*, not on nullity — a
``last_seen_at IS NULL`` predicate would leave nine rows behind while reporting
success.

Why a column, and not a DELETE
==============================

``coord.devices.device_id`` is the target of **at least seventeen** inbound
foreign keys spread across three different on-delete behaviours. Enumerated from
this tree — ``pg_constraint`` on the live database is the authority, and the
point of this list is how easy it is to under-count, not the number itself:

* ``ON DELETE CASCADE`` — ``coord.tenant_devices.device_id`` (one table, created
  idempotently by three revisions: ``coord_devices_tenant_id``,
  ``coord_sso_rbac``, ``coord_tenant_devices_mn``),
  ``coord.primary_trees.device_id``, ``coord.wip_attribution.device_id``,
  ``coord.sessions.device_id`` (``coord_session_substrate``),
  ``coord.agent_status.device_id``, and — from ``ud01_unify_devices_registry``'s
  re-point of the old ``coord.machines`` FKs —
  ``coord.build_events.machine_id``, ``coord.device_status.machine_id``,
  ``coord.device_connections.device_id``.
* ``ON DELETE SET NULL`` — ``coord.dev_action_snapshots.device_id``,
  ``coord.pr_merge_tenant_settings.preferred_auditor_device_id``, and from the
  same ``ud01`` re-point: ``coord.claims_audit.machine_id``,
  ``coord.repo_branches.head_author_machine``, ``coord.events.machine_id``,
  ``coord.agent_worktrees.machine_id``,
  ``coord.correlation_topics.created_by_machine_id``.
* **no clause → NO ACTION** — ``coord.agent_sessions.device_id``
  (``coord_agent_session_id_lineage``), ``coord.session_handles.device_id``.

So a ``DELETE FROM coord.devices`` is wrong in two directions at once: it
**hard-fails** with an FK violation on any device that ever opened a session
handle or carried agent-session lineage, and where it *does* succeed it
silently cascades away eight tables of history. There is also a reference the
database would not protect **at all** — ``devenv.machine_credentials.device_id``
is a **deliberate non-FK** soft reference (see
``devenv_04_device_machine_credentials``), so a DELETE orphans it with no error
and no cascade.

That list is also the argument against the alternative design, a hard DELETE
narrowed to rows with no referencing history anywhere. Such a predicate needs a
``NOT EXISTS`` per referencing table; the plan this implements listed eleven and
missed six; every FK a future revision adds silently joins the cascaded set with
nobody deciding. And on the measured population it would reap **zero** rows:
``GET /coord/fleet`` INNER JOINs ``coord.tenant_devices``, and it returned all 26
devices — proof that every one of them, junk included, holds a binding row, so
"no references anywhere" matches nothing. An inert reaper that reports success is
worse than no reaper.

A nullable timestamp sidesteps every one of those: the reaper issues an
``UPDATE``, which cannot cascade, cannot violate a foreign key, and cannot
orphan a soft reference. It is also **reversible** — coord's sweep clears
``reaped_at`` again for any device that heartbeats inside the grace window — so
the worst outcome of a wrong reap is one row missing from ``/coord/fleet`` until
the machine's next heartbeat, rather than the unrecoverable loss of a live
device plus six tables of its history.

Semantics
=========

``NULL`` means "not reaped" — the normal state, and the state every existing row
starts in, so this revision needs no backfill. A non-NULL value is the instant
coord observed the device to be past its grace window. Readers that present the
fleet (``coord`` ``fleet::list_fleet``) filter ``reaped_at IS NULL``; nothing
else changes, and no row is ever destroyed.

Deliberately NOT a boolean. The timestamp answers "when did we decide this?",
which is the question an operator asks first when a device goes missing from a
dashboard, and a boolean cannot answer it.

The partial index
=================

``coord_devices_live_idx ON coord.devices (device_id) WHERE reaped_at IS NULL``
supports the predicate every fleet read now carries. It is partial on the same
predicate, so it indexes only live devices and stays small as retired rows
accumulate — which is the whole point of retiring rather than deleting.

Locking
=======

The column is nullable with no default, so the ADD is a catalogue update with no
table rewrite (PostgreSQL 11+). It takes a brief ``ACCESS EXCLUSIVE`` lock on a
table holding tens of rows, which is immeasurable. The index is created without
``CONCURRENTLY`` for the same reason — alembic runs migrations inside a
transaction, ``CREATE INDEX CONCURRENTLY`` cannot run in one, and at this table
size there is nothing to concurrently avoid.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "devreap_01_devices_reaped_at"
down_revision: str | Sequence[str] | None = "scheduler_ticks_probe_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable retire marker plus the partial live-device index."""
    # `IF NOT EXISTS` is type-blind — it matches on NAME only, so it would
    # silently keep a pre-existing `reaped_at` of the wrong type. That is
    # acceptable here precisely because no such column exists anywhere in this
    # chain: `coord.devices` is created by `ud01_unify_devices_registry` and
    # widened by six later revisions, none of which spells `reaped_at`.
    op.execute(
        """
        ALTER TABLE coord.devices
            ADD COLUMN IF NOT EXISTS reaped_at TIMESTAMPTZ
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.devices.reaped_at IS
            'When coord retired this device row as dead. NULL = live (the '
            'normal state). Set by the coord device reaper once the row has '
            'gone past its grace window without a heartbeat; cleared again by '
            'the same sweep if the device heartbeats. Fleet reads filter '
            'reaped_at IS NULL. NEVER a DELETE: device_id is the target of at '
            'least 17 inbound FKs across three on-delete behaviours plus a '
            'non-FK soft reference from devenv.machine_credentials, so a '
            'DELETE both hard-fails on session/lineage history and silently '
            'cascades away eight tables of it.'
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS coord_devices_live_idx
            ON coord.devices (device_id)
            WHERE reaped_at IS NULL
        """
    )


def downgrade() -> None:
    """Exact inverse — drop the index, then the column."""
    op.execute("DROP INDEX IF EXISTS coord.coord_devices_live_idx")
    op.execute("ALTER TABLE coord.devices DROP COLUMN IF EXISTS reaped_at")
