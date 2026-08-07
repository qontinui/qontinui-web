"""§D1 fleet control columns — on the parent AND the versions table, together

Revision ID: fleet_res_tel_03
Revises: fleet_res_tel_02
Create Date: 2026-08-07

Wave 2 (§D1/§D2) of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-08-02-fleet-resource-telemetry-and-ci-allocation.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the
columns its §D1/§D2 code already reads land here, in qontinui-web. This is the
revision ``fleet_res_tel_02``'s docstring and ``qontinui-coord/src/fleet_policy.rs``
both name as still-to-come; until it merges, every §D1 path in coord degrades
structurally (SQLSTATE 42P01/42703 via ``pg_error::is_missing_schema_object``)
and the controls are inert-but-safe.

What this adds, and to what
===========================

Seven columns, added to **both** ``coord.fleet_runtime_policy`` and
``coord.fleet_runtime_policy_versions``:

```text
min_free_mem_bytes_host        BIGINT   NULL
min_free_mem_bytes_wsl         BIGINT   NULL
min_free_disk_bytes            BIGINT   NULL
max_concurrent_builds_override INTEGER  NULL
sample_interval_secs           INTEGER  NULL
sample_retention_days          INTEGER  NULL
drain                          JSONB    NULL
```

Types and nullability are taken from the Rust that already consumes them, not
chosen here: ``FleetPolicyControls`` (``fleet_policy.rs``) is six
``Option<i64>``/``Option<i32>`` fields read straight off the row via
``row.get(...)``, so the three byte floors must be ``BIGINT`` (an ``i64``
read off an ``INTEGER`` column is a runtime type error in tokio-postgres, not a
widening) and the three counts ``INTEGER``. ``drain`` is read as
``Option<serde_json::Value>`` and written as ``drain = $6`` with a nullable
parameter, and ``fleet_drain::drained_device_ids_on`` filters
``WHERE drain IS NOT NULL`` — so it is nullable JSONB with no default. Every
column is NULL-able because **NULL means "no override", not zero**: a zero
memory floor disables the guard it names, and a zero
``max_concurrent_builds_override`` means "run no builds at all". Those are
different facts and the schema must be able to tell them apart.

The parent's column list is mirrored exactly, in the same order, by
``CONTROL_COLS`` + ``d1_payload_cols()`` on the coord side; ``policy_state_cols``
composes both the parent SELECT and the snapshot INSERT from that one constant
so the two statements cannot name different sets. This migration is the other
half of that contract.

Why the versions table is widened in the SAME migration
=======================================================

Because ``fleet_res_tel_02`` wrote it into the database as a standing rule, in
the versions table's own ``COMMENT ON TABLE``:

    *"Any migration that adds a payload column to the parent must add it here
    too, in the same migration: a partial snapshot is an audit trail that lies
    while still reporting as versioned."*

That is the sharp end of it. A snapshot table missing a payload column does not
fail, does not warn, and does not stop reporting ``current_version`` — it goes
on looking versioned while silently dropping the columns an operator actually
changed. An audit trail that is *wrong* is worse than one that is absent,
because only the absent one is noticeable. Splitting this into "parent now,
snapshot later" would open exactly that window, so the two ALTERs are one
migration by construction.

The coord side takes the same care from the other direction: ``ControlsSchema``
is a single flag (``Present``/``Absent``) rather than two, precisely because
these columns land in ONE revision and are therefore present or absent
together. A migration that widened only one table would put coord's write path
into a state its own type system says cannot exist.

Snapshots that predate this revision keep NULLs, and that is honest
==================================================================

The version-1 rows ``fleet_res_tel_02`` reconstructed — and any snapshot written
in the window between these two revisions — carry NULL for all seven columns.
No backfill is needed or wanted: while the columns did not exist, no override
could have been in force, so "no override" is not an approximation of that
history, it *is* that history. Synthesising anything else would be inventing
observations, which is the failure the seeded row's ``change_note`` already goes
out of its way to avoid.

No CHECK constraints — deliberately, and not for lack of invariants
===================================================================

``FleetPolicyControls::validate`` rejects negative byte floors, a
``max_concurrent_builds_override`` outside ``0..=64``, a ``sample_interval_secs``
outside ``5..=3600`` and a ``sample_retention_days`` outside ``1..=90``. Those
bounds are **operational policy** ("a three-digit build cap is a typo"; "a
quarter of history is where a real TSDB replaces this"), not domain invariants,
and policy is exactly the thing that gets widened later. Mirroring them into
CHECKs buys a second door on the same input while making a future widening a
migration, and — worse — would retroactively invalidate historical snapshots the
day the app's allowed set moves. That is the same stance ``fleet_res_tel_02``
takes for the versions table and ``fleet_policy_01`` takes for ``level``: fixed
vocabularies get a CHECK (``scope_band``), tunable ranges are validated at the
door. It is a decision, not an omission.

No index on ``drain`` either. ``drained_device_ids_on`` scans
``WHERE drain IS NOT NULL`` across the whole table, but the table holds one row
per (tenant, domain, scope) — tens of rows on this fleet, and a handful with a
drain map at all. A GIN index here would cost more to maintain than the seq
scan it replaces.

Idempotency: raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the house
convention for ``coord.*`` tables, and metadata-only on PG 11+ since every
column is nullable with no default (no table rewrite, no lock held for the scan).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fleet_res_tel_03"
down_revision: str | Sequence[str] | None = "fleet_res_tel_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The one column list, spelled once, so the parent and the snapshot cannot
# drift into carrying different payloads — the SQL half of the "widen both
# together" rule the versions table's COMMENT ON TABLE states. This mirrors
# `CONTROL_COLS` + `d1_payload_cols()` in qontinui-coord's `fleet_policy.rs`,
# which composes the parent SELECT, the parent UPSERT and the snapshot INSERT
# from a single constant for the same reason.
_CONTROL_COLUMNS: tuple[tuple[str, str], ...] = (
    ("min_free_mem_bytes_host", "BIGINT"),
    ("min_free_mem_bytes_wsl", "BIGINT"),
    ("min_free_disk_bytes", "BIGINT"),
    ("max_concurrent_builds_override", "INTEGER"),
    ("sample_interval_secs", "INTEGER"),
    ("sample_retention_days", "INTEGER"),
    ("drain", "JSONB"),
)

_TABLES: tuple[str, ...] = (
    "coord.fleet_runtime_policy",
    "coord.fleet_runtime_policy_versions",
)


def _add_columns(table: str) -> str:
    """One ALTER carrying every column, so a table can never get a subset."""
    adds = ",\n            ".join(
        f"ADD COLUMN IF NOT EXISTS {name} {sql_type}"
        for name, sql_type in _CONTROL_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {adds}"


def _drop_columns(table: str) -> str:
    """The exact inverse of [`_add_columns`], over the same one list."""
    drops = ",\n            ".join(
        f"DROP COLUMN IF EXISTS {name}" for name, _ in _CONTROL_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {drops}"


def upgrade() -> None:
    """Add the seven §D1 control columns to the parent AND the versions table."""
    # Both tables, same loop, same list. Not two hand-written blocks: the whole
    # point of this revision is that the two lists are identical, and the
    # cheapest way to guarantee that is to have only one.
    for table in _TABLES:
        op.execute(_add_columns(table))

    # Column comments carry the facts a name cannot: which pool each floor
    # measures, and — for every one of them — that NULL is "no override" rather
    # than zero. A reader who gets that wrong writes a 0 and disables the guard.
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.min_free_mem_bytes_host IS
            'Windows host lane free-commit floor, in bytes. NULL = no override '
            '(consumers fall back to their built-in floor); 0 would DISABLE the '
            'guard, which is a different fact. Validated app-side (>= 0), not '
            'by a CHECK — see the revision docstring.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.min_free_mem_bytes_wsl IS
            'WSL lane available-memory floor, in bytes. Separate from the host '
            'floor because the two lanes measure different pools — the WSL VM '
            'has its own fixed allocation and the host cannot see inside it. '
            'NULL = no override, not zero.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.min_free_disk_bytes IS
            'Shared disk floor, in bytes — one value, because both lanes write '
            'to the same physical volume. NULL = no override, not zero.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN
            coord.fleet_runtime_policy.max_concurrent_builds_override IS
            'Overrides the cap the device advertises for itself. NULL = no '
            'override (use the advertised cap); 0 means ADMIT NO BUILDS, which '
            'is a legitimate and very different setting. Never collapse the two.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.sample_interval_secs IS
            'Cadence for the §A2 resource publishers, in seconds. NULL = no '
            'override. Raising it past a freshness window makes every sample '
            'permanently stale while the dashboard still renders a number, so '
            'the app bounds it (5..=3600) at the door.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.sample_retention_days IS
            'Prune window for coord.device_resource_samples, in days. NULL = no '
            'override. §A1 is a sample table, not a metrics platform; the app '
            'caps it at 90.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.drain IS
            'JSONB map device_id -> {until, reason, drained_by, drained_at} of '
            'machines held out of the fleet (§D2). This is a TYPED, VERSIONED '
            'control column with exactly one meaning — parsed into '
            'fleet_drain::DrainEntry and snapshotted onto '
            'fleet_runtime_policy_versions with every other payload column. It '
            'is NOT an attrs-style JSONB grab-bag: that shape (the '
            'non-versioning trap at prompt_documents.rs:23-35) is what §D1 '
            'forbids, and what makes it forbidden is precisely that the version '
            'snapshot skips it. Do not add unrelated keys here. NULL = nothing '
            'drained for this scope. `until` is MANDATORY per entry: a drain '
            'without a deadline is how a machine silently leaves the fleet '
            'forever. Expiry is evaluated on READ (an elapsed entry stops '
            'matching); there is no sweeper, so a coord restart or a paused '
            'scheduler can never strand a machine outside the fleet.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.drain IS
            'Snapshot of coord.fleet_runtime_policy.drain — see that column for '
            'the shape and for why a typed versioned column is not the '
            'forbidden attrs side-channel. Snapshot rows written BEFORE '
            'revision fleet_res_tel_03 carry NULL here and in the six control '
            'columns: those columns did not exist, so no override could have '
            'been in force. NULL is the honest record of that history, not a '
            'gap to be backfilled.'
        """
    )


def downgrade() -> None:
    """Drop the seven columns from both tables. Reverse of upgrade().

    Both tables again, and for the same reason: leaving the snapshot columns
    behind after removing the parent's would produce a versions table that can
    hold payload the parent cannot — the mirror image of the defect this
    revision exists to prevent, and just as invisible.
    """
    for table in _TABLES:
        op.execute(_drop_columns(table))
