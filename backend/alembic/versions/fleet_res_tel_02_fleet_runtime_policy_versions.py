"""coord.fleet_runtime_policy_versions — version history for the fleet policy

Revision ID: fleet_res_tel_02
Revises: fleet_res_tel_01
Create Date: 2026-08-06

Wave 1 (§D1) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-08-02-fleet-resource-telemetry-and-ci-allocation.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so this
lands here, in qontinui-web, and must merge BEFORE the coord PR that writes
these rows. Until it does, coord's writer degrades through
``pg_error::is_missing_relation`` and the PUT keeps its current
overwrite-in-place behaviour.

The gap this closes
===================

``coord.fleet_runtime_policy`` (created by
``fleet_policy_01_coord_fleet_runtime_policy``) is the per-tenant home for
admin-editable runtime policy, and coord's PUT **UPSERTs it in place with no
history row** (``qontinui-coord/src/fleet_policy.rs:316-324``). It is the only
one of the three admin-editable coord config surfaces with no ``*_versions``
companion:

* ``coord.prompt_documents``          -> ``coord.prompt_document_versions``      (live)
* ``coord.session_compliance_config`` -> ``coord.session_compliance_config_versions`` (live)
* ``coord.fleet_runtime_policy``      -> **nothing**

Plan §D1 makes the rule explicit: *an admin-editable control that changes
behaviour must be versioned and auditable*, and must not live in an
``attrs``-style JSONB side-channel (the non-versioning trap documented at
``qontinui-coord/src/prompt_documents.rs:23-35``). The fleet controls this plan
adds — drain, concurrency caps, memory/disk floors, sample retention — all land
on ``fleet_runtime_policy``. Without this table the very first admin control
the plan ships would be unversioned, so this is a required deliverable, not a
follow-up.

Shape — copied from the two live precedents
===========================================

A live parent row carrying ``current_version``, plus an **append-only,
immutable** child with one snapshot row per version and
``UNIQUE (parent_id, version)``. coord INSERTs the snapshot and UPDATEs
``current_version`` **in the same transaction**, under ``FOR UPDATE`` on the
parent (the shape at ``qontinui-coord/src/prompt_documents.rs:805-884``).
History is never rewritten: a rollback is an ordinary forward edit that creates
a NEW version.

Two deliberate divergences from the precedents, both forced by the parent:

1. **Keys are ``BIGINT``/``BIGSERIAL``, not ``UUID``.**
   ``coord.fleet_runtime_policy.id`` is ``BIGSERIAL``, so ``policy_id`` must be
   ``BIGINT`` and the snapshot's own PK follows the parent's convention rather
   than the UUID convention of the other two version tables. Matching the
   *parent* is what makes the FK valid; matching the siblings would not.
2. **The parent gains ``current_version`` here.** Both precedents ship it on
   the live row from the start; ``fleet_runtime_policy`` predates the versioning
   requirement and has no such column, and without it coord cannot do the
   bump-and-snapshot-in-one-transaction idiom (it would have to derive the next
   version with ``SELECT max(version) + 1``, which races under concurrent
   PUTs where the ``FOR UPDATE`` on the parent does not). Added
   ``NOT NULL DEFAULT 1``, idempotently.

The version column is named ``version`` (not ``version_number``), matching the
newer ``session_compliance_config_versions`` and the plan's column contract.

What a snapshot records
=======================

The parent's **mutable payload only**: ``level`` and ``master_enabled``. The
identity columns — ``tenant_id``, ``domain``, ``scope_band``, ``scope_key`` —
are excluded because they are the parent's unique key
(``uq_fleet_runtime_policy_scope``): they identify *which* policy the history
belongs to, and ``policy_id`` already says that. This mirrors
``session_compliance_config_versions``, which likewise carries the payload
(``enabled``, ``enforced_clause_ref``, ``mode``, ``max_attempts``) and not the
identifying ``tenant_id``.

Snapshot rows are deliberately **not** value-CHECKed. ``scope_band`` is
CHECKed on the live table but is not stored here; ``level`` has no CHECK
anywhere by design (domain-specific vocabulary, validated app-side). More
generally a historical record must not be retroactively invalidated by a later
widening of the live table's allowed set — the same stance
``session_compliance_config_versions`` takes.

Write-path obligations on the coord side, since SQL cannot express them
=======================================================================

* ``updated_by`` comes from the authenticated ``OperatorContext``, **never the
  request body**. Plan §D1 is explicit, and an audit trail whose author field
  is client-asserted is not an audit trail. (``fleet_runtime_policy.updated_by``
  is the pre-existing free-text column with the same obligation.)
* ``current_version`` defaults to 1 and nothing in this schema ties it to the
  existence of a snapshot. Every coord write that creates or mutates a policy
  row must INSERT the matching snapshot in the SAME transaction — **including
  the first one** — or ``current_version = 1`` describes history that does not
  exist. The bootstrap
  ``INSERT ... ON CONFLICT (tenant, domain, scope) DO NOTHING`` shape is exactly
  where this hole opens; the same warning is written into
  ``coord_sesscompl_02``.
* Never UPDATE or DELETE a row in this table.

This migration seeds version-1 snapshots for rows that already exist
===================================================================

Unlike ``coord_sesscompl_02`` (whose tables were new and empty), this parent is
live and may already hold rows. Stamping them ``current_version = 1`` with no
snapshot would ship the exact hole the previous paragraph forbids, so the
upgrade backfills a version-1 snapshot for every parent row that has none —
the same step ``coord_prompt_docs_01`` took for the rows it data-migrated.
Idempotent via ``WHERE NOT EXISTS``.

The seeded snapshot's ``created_at`` is the parent's ``updated_at``: it records
when that state became live, which is the honest answer, not when this
migration ran. Its ``change_note`` says plainly that it was reconstructed from
the live row rather than observed, so nobody reads a synthesised row as an
observed edit.

Idempotency: raw ``op.execute`` with ``CREATE TABLE IF NOT EXISTS`` /
``ADD COLUMN IF NOT EXISTS`` — the house convention for coord tables.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fleet_res_tel_02"
down_revision: str | Sequence[str] | None = "fleet_res_tel_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add current_version to the live row, create + backfill the snapshots."""
    # 1. The live row learns which version it is. Required for the
    #    bump-and-snapshot-in-one-transaction idiom; see module docstring.
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1
        """
    )

    # 2. Append-only immutable snapshots — one row per version.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.fleet_runtime_policy_versions (
            id             BIGSERIAL PRIMARY KEY,
            policy_id      BIGINT NOT NULL
                REFERENCES coord.fleet_runtime_policy (id) ON DELETE CASCADE,
            version        INTEGER NOT NULL,
            level          TEXT NOT NULL,
            master_enabled BOOLEAN NOT NULL,
            change_note    TEXT,
            updated_by     TEXT,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_fleet_runtime_policy_versions_policy_version
                UNIQUE (policy_id, version)
        )
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.fleet_runtime_policy_versions IS
            'Append-only immutable snapshots of coord.fleet_runtime_policy. '
            'Never UPDATE or DELETE a row here: a rollback is a forward edit '
            'that INSERTs a new version, mirroring '
            'coord.prompt_document_versions. Every write that creates or '
            'mutates a fleet_runtime_policy row must INSERT the matching '
            'snapshot in the SAME transaction — including the first one, or '
            'current_version=1 describes history that does not exist.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.updated_by IS
            'Taken from the authenticated OperatorContext, NEVER the request '
            'body. An audit trail whose author field is client-asserted is '
            'not an audit trail.'
        """
    )

    # 3. Seed version 1 for parent rows that predate this table, so no live
    #    row claims a current_version whose snapshot is missing. Idempotent.
    op.execute(
        """
        INSERT INTO coord.fleet_runtime_policy_versions
            (policy_id, version, level, master_enabled,
             change_note, updated_by, created_at)
        SELECT p.id, 1, p.level, p.master_enabled,
               'reconstructed from the live row when '
               'fleet_runtime_policy_versions was created; not an observed '
               'edit',
               p.updated_by, p.updated_at
        FROM coord.fleet_runtime_policy p
        WHERE NOT EXISTS (
            SELECT 1 FROM coord.fleet_runtime_policy_versions v
            WHERE v.policy_id = p.id
        )
        """
    )


def downgrade() -> None:
    """Drop the snapshots and the current_version column. Reverse of upgrade()."""
    op.execute("DROP TABLE IF EXISTS coord.fleet_runtime_policy_versions")
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            DROP COLUMN IF EXISTS current_version
        """
    )
