"""devenv_10: one live machine row per coord device

Revision ID: devenv_10_unique_active_coord_device
Revises: devenv_09_auto_enrollment
Create Date: 2026-08-15

Phase 6 of plan ``2026-08-05-devenv-auto-enrollment-on-connection``.

Adds a PARTIAL unique index on ``devenv.machines``::

    UNIQUE (coord_device_id) WHERE revoked_at IS NULL

which turns the connect-time engine's step-4 discipline into a database
invariant instead of an application convention.

WHAT THIS CLOSES, AND WHY THE INDEX IS THE RIGHT PLACE FOR IT

Before this, ``idx_devenv_machine_coord_device`` was a plain non-unique index,
so two machine rows could point at one device. That is not a cosmetic
duplication: the engine's step 4 reads "the machine row for this device", and
with two rows there is no such thing. Its honest response is to refuse — it
logs ``devenv_auto_enroll_ambiguous`` and does NOTHING, permanently, for that
device. A duplicate row is therefore a silent, self-perpetuating outage for
exactly the box it describes.

The engine already defends the create path with a transaction-scoped
``pg_advisory_xact_lock`` keyed on the device, because ``FOR UPDATE`` locks
rows and the zero-row branch has none to lock. That defence covers the engine.
It does NOT cover the operator dispatch path, the agent enroll path, a manual
row, or a future writer that has not read this comment. A unique index covers
all of them, and it fails loudly at the moment of the second insert rather than
quietly at every subsequent connect.

WHY IT IS PARTIAL

``revoked_at IS NOT NULL`` rows are history. Re-enrolling a box that was
previously revoked must stay possible, and the shipped revoke flow does not
clear ``coord_device_id``, so a full unique index would make a revoked machine
permanently block its own device from ever being enrolled again. The predicate
scopes the invariant to what it actually means: at most one LIVE machine per
device.

NULL ``coord_device_id`` is unaffected — PostgreSQL treats NULLs as distinct in
a unique index, so the many un-bridged machine rows do not collide with each
other.

PRECONDITION, MEASURED TWICE

The plan gates this phase on real data: an index cannot be created over rows
that already violate it, so a duplicate population would make this migration
fail on deploy rather than at review. Phase 1 measured the grouped query on
production (2026-08-15) and got zero duplicate groups over three machine rows;
Phase 6 re-measured immediately before shipping and recorded the result in the
plan's "Phase 1 evidence" section. Both readings are evidence about the moment
they were taken, which is why the second one exists.

``down_revision`` is ``devenv_09_auto_enrollment``, resolved from
``alembic heads`` (NOT from the ``devenv_NN`` filename ordering, which is a
naming convention rather than a private chain) and re-verified against a fresh
``git fetch`` immediately before commit.

``downgrade`` restores the prior state exactly: the plain non-unique index is
recreated so the graph is reversible to a schema the previous revision
describes.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision: str = "devenv_10_unique_active_coord_device"
down_revision: str | Sequence[str] | None = "devenv_09_auto_enrollment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "devenv"
_UNIQUE_INDEX = "uq_devenv_machine_active_coord_device"
_PLAIN_INDEX = "idx_devenv_machine_coord_device"


def upgrade() -> None:
    """Enforce at most one non-revoked machine row per coord device."""
    op.create_index(
        _UNIQUE_INDEX,
        "machines",
        ["coord_device_id"],
        unique=True,
        schema=_SCHEMA,
        # ``sa.text``, NOT ``op.inline_literal``: the latter renders a quoted
        # STRING literal, which Postgres then rejects as a boolean predicate
        # (``invalid input syntax for type boolean``).
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    # The plain index is now redundant for every lookup the unique one covers
    # (same leading column), and a duplicate index costs write amplification on
    # a table the connect path writes. Dropped AFTER the unique one exists so
    # no window leaves `coord_device_id` unindexed.
    op.drop_index(_PLAIN_INDEX, table_name="machines", schema=_SCHEMA)


def downgrade() -> None:
    """Restore the plain non-unique index and drop the invariant."""
    op.create_index(
        _PLAIN_INDEX,
        "machines",
        ["coord_device_id"],
        unique=False,
        schema=_SCHEMA,
    )
    op.drop_index(_UNIQUE_INDEX, table_name="machines", schema=_SCHEMA)
