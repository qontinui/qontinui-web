"""Per-device worktree cap override — on the parent AND the versions table

Revision ID: wtcap_01_max_worktrees_by_device
Revises: policy_rules_agent_name_uq_01
Create Date: 2026-09-30

Amendment A3 / Phase 4 of plan
``2026-09-18-coord-allocation-budgets-ignore-the-machine-they-gate``
(amendment VETTED 2026-09-28).

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
column its A3 code reads lands here, in qontinui-web, and must be applied in
production BEFORE the coord PR that reads it is deployed. ``down_revision`` is
this repo's LOCAL single alembic head, deliberately NOT pinned to the head this
revision was authored against: ``alembic-graph-pr.yml`` serialises alembic PRs
by construction, so a revision landing ahead of this one re-forks the chain and
this line is re-pointed at the new head. Re-point it; do NOT author an
``alembic merge`` revision.

What this adds, and to what
===========================

One column, added to **both** ``coord.fleet_runtime_policy`` and
``coord.fleet_runtime_policy_versions``:

```text
max_worktrees_by_device  JSONB  NULL
```

Shape::

    {"<device_uuid>": {"n": 40, "reason": "…", "set_by": "…", "set_at": "…"}}

``n`` is the number of agent worktrees coord will allow on that device; the
other three are provenance, so a refusal can say who set the cap and why
instead of sending an operator to read the database.

The row is per ``(tenant, domain, scope)``, so more than one tenant CAN carry an
entry for the same device — a device may be bound to several tenants. What
settles the conflict is the READ: the reading build takes only the entry in the
policy row of the tenant that OWNS the device (``coord.devices.tenant_id``), and
any other tenant's entry for it is ignored rather than prevented.

Why a device-keyed MAP and not ``coord.devices.max_worktrees_override``
=======================================================================

The amendment's first draft put a nullable ``max_worktrees_override`` column on
``coord.devices``. The vet struck it, for two reasons that are worth carrying
here because the column name is the obvious one and someone will propose it
again:

1. **Robustness — history.** ``coord.fleet_runtime_policy`` is the versioned
   control row: every write goes through coord's
   ``fleet_policy::upsert_policy_versioned_tx`` and lands as a numbered,
   attributed, immutable snapshot on ``coord.fleet_runtime_policy_versions``,
   which is what makes a cap change revertible and auditable. A bare column on
   ``coord.devices`` would have no history at all — the previous value would be
   gone the moment it was overwritten.
2. **``coord.devices`` is a PUBLISHER registry.** The runner and the supervisor
   write into those rows (``fleet.rs``). An operator control living there would
   share rows with publishers, which is how an operator decision and a
   machine's self-report end up indistinguishable.

This is exactly the shape ``fleet_res_tel_03`` already shipped for ``drain``
(``{"<device_uuid>": {"until", "reason", "drained_by", "drained_at"}}``), and
that revision's docstring is the one to read first: everything it argues about
nullability, the ``IF NOT EXISTS`` type-blindness trap and why both tables are
widened in one migration applies here verbatim.

Like ``drain``, and unlike an attrs-style grab-bag, this is meant to be a
TYPED, VERSIONED control column with exactly one meaning: the coord PR that
follows this one adds it to ``d1_payload_cols()``, so it is projected and
snapshotted with every other payload column. That is the property which makes
it a control rather than the non-versioning side-channel §D1 forbids, and it is
a REQUIREMENT on the reader, not something this migration can report as already
true — until that PR deploys, nothing in coord reads or writes this column at
all. Do not add unrelated keys to it.

Why the versions table is widened in the SAME migration
=======================================================

``fleet_res_tel_02`` wrote the rule into the database itself, in the versions
table's ``COMMENT ON TABLE``:

    *"Any migration that adds a payload column to the parent must add it here
    too, in the same migration: a partial snapshot is an audit trail that lies
    while still reporting as versioned."*

A parent-only widening produces no error, no warning and no missing
``current_version`` — it just silently drops the column an operator actually
changed. coord's ``ControlsSchema`` is a single ``Present``/``Absent`` flag
*because* payload columns land in one revision and are therefore present or
absent together; a parent-only widening yields a ``42703`` on the child alone,
a state that flag says cannot exist. ``alembic/env.py`` runs the migration
inside ``context.begin_transaction()`` and PostgreSQL DDL is transactional, so
both ALTERs commit or neither does.

Snapshots that predate this revision keep NULL, and that is honest
==================================================================

No backfill. While the column did not exist, no override could have been in
force, so "no override" is not an approximation of that history — it *is* that
history.

No CHECK constraint, deliberately
=================================

``n`` must be ``>= 1``, and coord's write door is where that is enforced. A
zero would refuse every allocation on that device **including the dev-notes
worktree an operator needs to change the setting back**, which is why the bound
exists at all — and why it belongs where the error message can say that, rather
than as a 23514 with no explanation. There is deliberately no upper bound: disk is carried by the
disk gate (``no_build_disk_verdict``), not by this count, and a ceiling
invented here would retroactively invalidate historical snapshots the day it
moved. Same stance as ``fleet_res_tel_03`` takes for its six controls: fixed
vocabularies get a CHECK, tunable ranges are validated at the door.

No index either, for ``fleet_res_tel_03``'s reason: the table holds one row per
(tenant, domain, scope) — tens of rows on this fleet — so a GIN index would
cost more to maintain than the seq scan it replaces.

``IF NOT EXISTS`` is type-BLIND
===============================

It matches on name alone. A column of the same name but the wrong type makes
the ADD a silent no-op and leaves the wrong type in place. A missing column is
42703, which coord's ``pg_error::is_missing_schema_object`` catches and
degrades; a column of the WRONG type is not an error until coord's
``row.get(...)``, which **panics**. So the type here is an interface, and
re-running ``upgrade()`` is not a repair for one that is already wrong: fix such
a column with an explicit ``ALTER COLUMN … TYPE`` in a new revision.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "wtcap_01_max_worktrees_by_device"
down_revision: str | Sequence[str] | None = "policy_rules_agent_name_uq_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The one column list, spelled once, so the parent and the snapshot cannot
# drift into carrying different payloads — the SQL half of the "widen both
# together" rule the versions table's COMMENT ON TABLE states. Mirrors
# `d1_payload_cols()` in qontinui-coord's `fleet_policy.rs`, which composes the
# parent SELECT, the parent UPSERT and the snapshot INSERT from a single
# constant for the same reason.
_COLUMNS: tuple[tuple[str, str], ...] = (("max_worktrees_by_device", "JSONB"),)

_TABLES: tuple[str, ...] = (
    "coord.fleet_runtime_policy",
    "coord.fleet_runtime_policy_versions",
)


def _add_columns(table: str) -> str:
    """One ALTER carrying every column, so a table can never get a subset."""
    adds = ",\n            ".join(
        f"ADD COLUMN IF NOT EXISTS {name} {sql_type}" for name, sql_type in _COLUMNS
    )
    return f"ALTER TABLE {table}\n            {adds}"


def _drop_columns(table: str) -> str:
    """The exact inverse of [`_add_columns`], over the same one list."""
    drops = ",\n            ".join(
        f"DROP COLUMN IF EXISTS {name}" for name, _ in _COLUMNS
    )
    return f"ALTER TABLE {table}\n            {drops}"


def upgrade() -> None:
    """Add ``max_worktrees_by_device`` to the parent AND the versions table."""
    # Both tables, same loop, same list. Not two hand-written blocks: the whole
    # point of this revision is that the two lists are identical, and the
    # cheapest way to guarantee that is to have only one.
    for table in _TABLES:
        op.execute(_add_columns(table))

    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.max_worktrees_by_device IS
            'JSONB map device_id -> {n, reason, set_by, set_at}: the operator '
            'override for how many agent worktrees coord will allow on THAT '
            'machine (plan 2026-09-18 amendment A3). A TYPED, VERSIONED control '
            'column with exactly one meaning — the same shape as the drain '
            'column beside it, and NOT an attrs-style JSONB grab-bag. Do not '
            'add unrelated keys. It is snapshotted onto '
            'fleet_runtime_policy_versions with every other payload column. '
            'NULL (or a device absent from the map) = no override, and the '
            'cap is then derived from that device''s memory_gb and floored at '
            'a compiled minimum; it never means zero. n must be >= 1, a bound '
            'the reading build is required to enforce at its write door: a '
            'zero would refuse EVERY allocation on that device, including the '
            'worktree an operator needs in order to set it back. This row is '
            'per (tenant, domain, scope), so more than one tenant CAN write an '
            'entry for the same device; what settles it is the read, which '
            'takes only the entry in the policy row of the tenant that OWNS '
            'the device (coord.devices.tenant_id). An entry written by any '
            'other tenant for that device is ignored, not prevented. This '
            'column lands BEFORE the coord build that reads it '
            '([policy: alembic-sole-authorship]); until that build is '
            'deployed nothing reads or writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN
            coord.fleet_runtime_policy_versions.max_worktrees_by_device IS
            'Snapshot of coord.fleet_runtime_policy.max_worktrees_by_device — '
            'see that column for the shape and for why a typed versioned '
            'column is not the forbidden attrs side-channel. Snapshot rows '
            'written BEFORE revision wtcap_01_max_worktrees_by_device carry '
            'NULL here: the column did not exist, so no override could have '
            'been in force, and NULL is the honest record of that history '
            'rather than a gap to be backfilled. Immutable: never UPDATE or '
            'DELETE a row here.'
        """
    )


def downgrade() -> None:
    """Drop the column from both tables. Reverse of upgrade().

    Both tables again, and for the same reason: leaving the snapshot column
    behind after removing the parent's would produce a versions table that can
    hold payload the parent cannot — the mirror image of the defect this
    revision exists to prevent, and just as invisible.
    """
    for table in _TABLES:
        op.execute(_drop_columns(table))
