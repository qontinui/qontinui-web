"""coord.machine_dispatch_roles — the operator-chosen dispatch role per machine

Revision ID: mdroles_01
Revises: coord_pr_state_observed_at_01
Create Date: 2026-10-02

Phase 1 (§D4) of plan
``qontinui-dev-notes/plans/2026-10-02-fleet-machine-roles-workhorse-bench-ci-node.md``.
Authored by alembic in ``qontinui-web`` — coord authors zero ``coord.*`` DDL
(served policy ``production-and-cost`` ``alembic-sole-authorship``) — and must
be APPLIED before the plan's Phase 2 coord PR reads the table.

What the table holds
====================

One row per machine of a tenant naming which kinds of work coord may send it
(§D1): ``workhorse`` (CI lane and agent lane open), ``bench`` (both closed) or
``ci_node`` (CI open, agent closed). No row means *unassigned*, which behaves
exactly as ``workhorse`` (§D5), so applying this migration changes nothing
until an operator picks a role.

This is the **dispatch role** — what work a machine ACCEPTS, chosen by the
operator. It is not ``coord.devices.role`` (``fleet::MachineRole``), which is
what a process IS and is self-declared by each publisher; the name
``dispatch_role`` exists so the two never collide.

Keyed on the MACHINE, never on one ``coord.devices`` row (§D4): a GitHub
self-hosted host registered on N repos is N device rows, so a per-row key is
the partial-drain-that-reports-success trap. A machine is either its
workstation device (``machine_device_id``) or, for a CI host with no linked
workstation, its host name (``ci_host_name``) — exactly one of the two, the
same "an un-linked CI host is a machine of its own" rule the maintenance plan
(``2026-09-28-machine-maintenance-pause-ci-and-drain-in-one-place`` §D2) uses
for ``coord.machine_ci_hosts``. **That table is PENDING**: it is on no ``main``
as of this revision, only in qontinui-web#1552 / qontinui-coord#2625. Note the
naming split: its column is ``ci_host``, this table's is ``ci_host_name``.

The unique index is spelled with ``COALESCE`` so the NULL half of the key still
participates in uniqueness: a plain
``UNIQUE (tenant_id, machine_device_id, ci_host_name)`` would admit any number
of rows for one machine, because NULLs never compare equal.

Host names are CANONICAL: compared trimmed and case-insensitively
====================================================================

``'hp2'``, ``'HP2'`` and ``'hp2 '`` must be ONE machine. If they were three, a
role stored under one spelling and looked up under another would miss, and a
miss reads as "unassigned", i.e. ``workhorse`` — silently breaking the Bench
guarantee (nothing coord sends lands on a Bench). So:

* a CHECK refuses a stored name with leading/trailing whitespace or an empty
  one (``ci_host_name = btrim(ci_host_name, <ws>) AND ci_host_name <> ''``).
  The trim set is spelled out — space, tab, LF, CR, FF, VT — because
  ``btrim`` with one argument strips spaces only, and a tab-padded name is the
  same miss;
* the unique index keys on ``lower(ci_host_name)``, so two case spellings of
  one host cannot both hold a row;
* **coord must match with ``lower()``** on both sides
  (``lower(ci_host_name) = lower($host)``), never ``=`` on the raw value — the
  stored case is whatever the operator first typed.

Versioning — copied from ``fleet_res_tel_02`` / ``coord_sesscompl_02``
======================================================================

Plan §D4 applies the fleet_policy §D1 rule: *an admin-editable control that
changes behaviour is versioned and auditable*. The precedent
(``fleet_res_tel_02_fleet_runtime_policy_versions``, itself copied from
``coord_sesscompl_02`` and ``prompt_document_versions``) is **app-written
versions, not a trigger**: a live parent row carrying ``current_version``, plus
an append-only immutable child with one snapshot per version and
``UNIQUE (parent_id, version)``. coord INSERTs the snapshot and UPDATEs
``current_version`` in the SAME transaction under ``FOR UPDATE`` on the parent
(``apply_document_edit_tx`` in ``qontinui-coord``'s ``prompt_documents.rs`` is
the mechanism to copy). This revision copies that shape:

* Keys are ``UUID DEFAULT gen_random_uuid()`` — the convention of
  ``coord_sesscompl_02`` and ``prompt_document_versions``.
  ``fleet_runtime_policy_versions`` uses ``BIGSERIAL`` only because its
  pre-existing parent did; this parent is new, so the UUID convention applies.
* The version column is ``version`` and the child FK cascades
  (``ON DELETE CASCADE`` — *a version snapshot cannot outlive its row*), both as
  in the precedent. Nothing in the plan deletes a role row (there is no
  "unassign" action; a role change is an UPDATE), so the cascade is the
  precedent's rationale, not a path the feature exercises.
* Snapshot rows are deliberately **not** value-CHECKed, so a later widening of
  the live table's role set cannot retroactively invalidate stored history.

**One deliberate divergence:** the snapshot mirrors EVERY column of the parent,
identity included (``tenant_id``, ``machine_device_id``, ``ci_host_name``),
where the precedent stored the mutable payload only. Plan §D4 says so in
terms — *"Versions mirror every column"* — and the precedent's reason for
excluding identity (``policy_id`` already says which policy) is weaker here:
the role history is the audit of who moved which machine's GitHub routing, and
a snapshot that names its machine reads correctly on its own. The child carries
no ``change_note``: the parent's own ``reason`` is the operator's note and is
mirrored like every other column.

Write-path obligations on the coord side, since SQL cannot express them
=======================================================================

* ``updated_by`` comes from the authenticated ``OperatorContext``, never the
  request body (the write is operator-only, plan §D9).
* Every write that creates or mutates a role row INSERTs the matching snapshot
  in the same transaction — **including the first one**, or
  ``current_version = 1`` describes history that does not exist.
* Never UPDATE or DELETE a row in the versions table.
* Any later migration adding a column to the parent adds it to the versions
  table in the same migration. ``test_mdroles_01_machine_dispatch_roles_migration``
  enforces this at ``head``, so a parent-only widening fails CI.
* An upsert must restate the unique index's EXACT expression list as its
  conflict target —
  ``ON CONFLICT (tenant_id, COALESCE(machine_device_id::text, ''),
  COALESCE(lower(ci_host_name), ''))`` — or PostgreSQL cannot infer the
  arbiter index and raises 42P10. There is no named constraint to target.
* When ``coord.machine_ci_hosts`` lands, linking a CI host to a workstation
  while that host still has its own ``ci_host_name`` role row leaves the
  machine with two roles. coord must either refuse the link until the host's
  row is removed, or define which role wins (and say so in the read route);
  it must never leave the choice to query order.

Other notes
===========

* ``tenant_id`` carries no FK to ``coord.tenants`` and ``machine_device_id``
  none to ``coord.devices`` — matching ``coord_sesscompl_02`` and
  ``cmtland_01``; device rows are reaped and re-registered independently of an
  operator's choice about the machine.
* ``ci_host_name`` may not be empty: besides being no host name, ``''`` is the
  ``COALESCE`` sentinel the unique index uses for the absent half of the key.
* The ``workhorse``-for-a-host-only-machine refusal (``no_agent_host``, §D4) is
  a route-level guard in coord, not a CHECK: whether a host has a linked
  workstation lives in ``coord.machine_ci_hosts``, another table.
* No per-table GRANT: the ``coord`` schema's privileges are granted at the
  schema level, and no sibling ``coord.*`` migration issues per-table grants.
* Lookups by machine ride the unique index; history lookups ride the leading
  column of ``UNIQUE (role_id, version)``. No further index.
* HAND-AUTHORED; ``alembic revision --autogenerate`` is never run here. Raw,
  static, ``coord.``-qualified ``op.execute`` with ``IF NOT EXISTS`` — the house
  convention for coord tables. Pure DDL, no app imports.
* ``down_revision`` is re-pointed onto the merged head at land time if another
  revision lands first.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "mdroles_01"
down_revision: str | Sequence[str] | None = "coord_pr_state_observed_at_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the live dispatch-role table and its version snapshots."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # 1. Live values — at most one row per machine of a tenant.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.machine_dispatch_roles (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id         UUID NOT NULL,
            machine_device_id UUID,
            ci_host_name      TEXT,
            dispatch_role     TEXT NOT NULL,
            reason            TEXT,
            current_version   INTEGER NOT NULL DEFAULT 1,
            updated_by        TEXT,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            -- A machine is its workstation device OR an un-linked CI host,
            -- never both and never neither.
            CONSTRAINT ck_machine_dispatch_roles_one_machine_key
                CHECK (num_nonnulls(machine_device_id, ci_host_name) = 1),
            -- Canonical host name: trimmed and non-empty ('' is the COALESCE
            -- sentinel of the unique index below). Case is folded by the index.
            CONSTRAINT ck_machine_dispatch_roles_ci_host_name_canonical
                CHECK (
                    ci_host_name IS NULL
                    OR (
                        ci_host_name = btrim(ci_host_name, E' \\t\\n\\r\\f\\x0b')
                        AND ci_host_name <> ''
                    )
                ),
            -- Named so a later widening (e.g. a session-host role, §D1) can
            -- replace it by name rather than hunting a generated one.
            CONSTRAINT ck_machine_dispatch_roles_dispatch_role
                CHECK (dispatch_role IN ('workhorse', 'bench', 'ci_node'))
        )
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_dispatch_roles_machine
            ON coord.machine_dispatch_roles (
                tenant_id,
                COALESCE(machine_device_id::text, ''),
                COALESCE(lower(ci_host_name), '')
            )
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.machine_dispatch_roles IS
            'Operator-chosen dispatch role per machine: which lanes coord may '
            'dispatch on (workhorse = ci+agent, bench = none, ci_node = ci '
            'only). No row means unassigned, which behaves as workhorse. Keyed '
            'on the machine (workstation device or un-linked CI host), never '
            'on one coord.devices row. ci_host_name is stored trimmed and is '
            'unique case-insensitively: coord must match it with lower() on '
            'both sides. Not coord.devices.role, which is what a '
            'process IS and is self-declared. Every write must INSERT the '
            'matching coord.machine_dispatch_roles_versions row in the SAME '
            'transaction, including the first one.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.machine_dispatch_roles.updated_by IS
            'Taken from the authenticated OperatorContext, NEVER the request '
            'body. An audit trail whose author field is client-asserted is '
            'not an audit trail.'
        """
    )

    # 2. Append-only immutable snapshots — one row per version, mirroring
    #    every column of the live row.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.machine_dispatch_roles_versions (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            role_id           UUID NOT NULL
                REFERENCES coord.machine_dispatch_roles (id)
                ON DELETE CASCADE,
            version           INTEGER NOT NULL,
            tenant_id         UUID NOT NULL,
            machine_device_id UUID,
            ci_host_name      TEXT,
            dispatch_role     TEXT NOT NULL,
            reason            TEXT,
            updated_by        TEXT,
            updated_at        TIMESTAMPTZ NOT NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_machine_dispatch_roles_versions_role_version
                UNIQUE (role_id, version)
        )
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.machine_dispatch_roles_versions IS
            'Append-only immutable snapshots of coord.machine_dispatch_roles, '
            'mirroring every column. Never UPDATE or DELETE a row here: a '
            'rollback is a forward edit that INSERTs a new version, mirroring '
            'coord.prompt_document_versions. Every write that creates or '
            'mutates a machine_dispatch_roles row must INSERT the matching '
            'snapshot in the SAME transaction, including the first one, or '
            'current_version=1 describes history that does not exist. Any '
            'migration that adds a column to the parent must add it here too, '
            'in the same migration.'
        """
    )

    # Snapshot rows are deliberately NOT value-CHECKed: they are a historical
    # record, and a future widening of the live table's role set must not
    # retroactively invalidate stored history.


def downgrade() -> None:
    """Drop the dispatch-role tables (versions first — FK child)."""
    op.execute("DROP TABLE IF EXISTS coord.machine_dispatch_roles_versions")
    op.execute("DROP TABLE IF EXISTS coord.machine_dispatch_roles")
