"""coord.fleet_runtime_policy_versions — version history for the fleet policy

Revision ID: fleet_res_tel_02
Revises: fleet_res_tel_01
Create Date: 2026-08-06

Wave 1 (§D1) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-08-02-fleet-resource-telemetry-and-ci-allocation.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so this
lands here, in qontinui-web, and must merge BEFORE the coord PR that writes
these rows.

**No coord code touches this table yet** — ``fleet_runtime_policy_versions``
appears nowhere on coord's ``origin/main`` as of this revision, and
``src/fleet_policy.rs`` has no missing-relation degradation of its own. So
nothing degrades today and nothing changes today: ``put_fleet_policy`` keeps
its present overwrite-in-place behaviour purely because it is untouched. The
obligation runs the other way, onto the coord PR that follows — see
"Write-path obligations" below, which is the list that PR should be written
from.

The gap this closes
===================

``coord.fleet_runtime_policy`` (created by
``fleet_policy_01_coord_fleet_runtime_policy``) is the per-tenant home for
admin-editable runtime policy, and coord's PUT **UPSERTs it in place with no
history row** (``qontinui-coord/src/fleet_policy.rs:316-324``). Of the three
coord config surfaces that carry version history, it is the one with none:

* ``coord.prompt_documents``          -> ``coord.prompt_document_versions``      (live)
* ``coord.session_compliance_config`` -> ``coord.session_compliance_config_versions`` (live)
* ``coord.fleet_runtime_policy``      -> **nothing**

(Those three are the only ``*_versions`` pairs in the schema — not the only
operator-editable surfaces. PR-merge repo profiles, ``coord.flag_registry`` and
notification preferences are equally editable and equally unversioned; they are
simply not this plan's problem.)

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
parent. The mechanism to copy is ``apply_document_edit_tx``
(``qontinui-coord/src/prompt_documents.rs:918-973``: the ``FOR UPDATE`` select,
then the ``prompt_document_versions`` INSERT, then the ``current_version``
UPDATE). History is never rewritten: a rollback is an ordinary forward edit
that creates a NEW version.

Two deliberate divergences from the precedents, both forced by the parent:

1. **Keys are ``BIGINT``/``BIGSERIAL``, not ``UUID``.**
   ``coord.fleet_runtime_policy.id`` is ``BIGSERIAL``, so ``policy_id`` must be
   ``BIGINT`` and the snapshot's own PK follows the parent's convention rather
   than the UUID convention of the other two version tables. Matching the
   *parent* is what makes the FK valid; matching the siblings would not.
2. **The parent gains ``current_version`` here.** Both precedents ship it on
   the live row from the start; ``fleet_runtime_policy`` predates the versioning
   requirement and has no such column. It is not a correctness backstop —
   ``UNIQUE (policy_id, version)`` plus the parent's ``FOR UPDATE`` already make
   the bump safe. It is there because it is what a *reader* needs: the live row
   states which version it is without a join or an aggregate over the child, so
   every surface that shows current state (the operator UI, coord's own policy
   resolver) gets the version for free, and the schema keeps the same shape as
   its two siblings rather than becoming a third variant.

The version column is named ``version`` (not ``version_number``), matching the
newer ``session_compliance_config_versions``. Plan §D1 does not specify a column
contract for this table — it lists parent *fields* and mandates that the table
exist — so the sibling's naming is the tiebreak.

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

``ON DELETE CASCADE`` on ``policy_id`` is copied from
``session_compliance_config_versions`` (``coord_sesscompl_02:94-96``) and
carries its rationale: *a version snapshot cannot outlive its config*. Restating
it because it does cut against the append-only contract below — deleting a
policy row destroys its whole audit trail. That is accepted, not overlooked:
the alternative (``ON DELETE RESTRICT``) makes a policy row undeletable once
edited, and the audit of the deletion itself belongs in the
``coord.user_overrides`` / ``coord.alerts`` rows that plan §D2's kill-switch
pattern already writes, not in an orphaned snapshot.

Write-path obligations on the coord side, since SQL cannot express them
=======================================================================

This is the list the follow-on coord PR should be written from.

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
* **``put_fleet_policy`` cannot satisfy that as written.** Its UPSERT
  (``fleet_policy.rs:314-339``) has no ``RETURNING id``, and ``FleetPolicyRow``
  (``:57-63``) carries only ``scope_band`` / ``scope_key`` / ``level`` /
  ``master_enabled`` — coord never reads ``fleet_runtime_policy.id`` at all.
  Adding ``RETURNING id`` is the prerequisite for writing the snapshot, because
  ``policy_id`` is the only thing that ties one to the other.
* **Widen both tables together.** The snapshot carries the parent's payload as
  of today. Every control plan §D1 adds — ``min_free_mem_bytes_host`` /
  ``_wsl``, ``min_free_disk_bytes``, ``max_concurrent_builds_override``,
  ``sample_interval_secs``, ``sample_retention_days``, ``drain`` — must be added
  to the parent **and** to this table in the same migration. A migration that
  widens only the parent leaves an audit trail that is silently partial while
  still reporting as versioned, which is worse than an obviously absent one.
* Never UPDATE or DELETE a row in this table.

This migration seeds version-1 snapshots for rows that already exist
===================================================================

Unlike ``coord_sesscompl_02`` (whose tables were new and empty), this parent is
live and may already hold rows. Stamping them ``current_version = 1`` with no
snapshot would ship the exact hole the previous section forbids, so the upgrade
backfills a version-1 snapshot for every parent row that has none — the same
step ``coord_prompt_docs_01`` took for the rows it data-migrated, with both of
its guards: ``WHERE NOT EXISTS`` for the ordinary re-run, and
``ON CONFLICT DO NOTHING`` for the case the anti-join cannot see — a concurrent
coord PUT inserting version 1 between the anti-join and the insert, which would
otherwise abort the migration on a unique violation.

The seeded snapshot's ``created_at`` is the parent's ``updated_at``: it records
when that state became live, which is the honest answer, not when this
migration ran. Its ``change_note`` says plainly that it was reconstructed from
the live row rather than observed, so nobody reads a synthesised row as an
observed edit.

No explicit index is created: ``policy_id`` lookups (the history-of-one-policy
read) ride the leading column of ``UNIQUE (policy_id, version)``, same as
``session_compliance_config_versions``.

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
    # 1. The live row states which version it is, so a reader gets it without
    #    joining the child. Metadata-only on PG 11+; no table rewrite.
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
            'current_version=1 describes history that does not exist. Any '
            'migration that adds a payload column to the parent must add it '
            'here too, in the same migration: a partial snapshot is an audit '
            'trail that lies while still reporting as versioned.'
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
    #    row claims a current_version whose snapshot is missing. WHERE NOT
    #    EXISTS covers the re-run; ON CONFLICT DO NOTHING covers a concurrent
    #    coord PUT racing in between the anti-join and the insert.
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
        ON CONFLICT DO NOTHING
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
