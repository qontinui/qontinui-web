"""custody 01 — coord.worktree_census checkout-occupancy (custody) columns

Revision ID: custody_01_worktree_census_occupancy
Revises: coord_iops_idx_01
Create Date: 2026-09-26

Phase 1a (web migration) of plan
``2026-09-07-shared-checkout-occupancy-is-invisible-to-coord``.

The runner's census loop already sends the scalar ``custody_*`` fields for
every worktree carrying a WIP-custody record (the record the ``Stop`` hook
writes into the worktree's ``$GIT_DIR``); ``custody_occupants`` arrives with the
companion runner change that reads every per-session custody slot. coord's
census consumer
(``qontinui-coord`` ``crates/coord/src/worktree_census.rs``, ``WorktreeItem`` /
``CENSUS_COLS_FULL``) drops every one of them, because there is no column to
land them in. That is why a shared checkout's occupancy — which session is in
it, when it was last seen, whether its uncommitted work is captured — is
invisible to coord. This revision adds the columns; the companion coord PR adds
a new column tier to ``worktree_census.rs`` that reads and writes them, and
that tier falls back on SQLSTATE 42703 (undefined column) until this lands.

Alembic in qontinui-web is the sole author of the ``coord.*`` schema (served
policy ``production-and-cost`` ``alembic-sole-authorship``), so this lives here
rather than in qontinui-coord, and it lands FIRST. Hand-authored —
``alembic revision --autogenerate`` is never run against ``coord.*``.

## Columns

* ``custody_session_id`` TEXT — the session that last wrote the custody record.
* ``custody_session_name`` TEXT — that session's display name
  (``Session-Name``, the ``ListAgents`` address).
* ``custody_last_seen`` TIMESTAMPTZ — when the record was last written.
* ``custody_wip_state`` TEXT — the record's ``wip_state`` (``captured`` /
  ``deferred`` / ``stash_create_failed`` / ...); a runner-owned vocabulary.
* ``custody_wip_ref`` TEXT — the ``refs/wip/...`` snapshot ref, if any.
* ``custody_work_unit_id`` TEXT — the coord work unit the session declared.
* ``custody_plan_slug`` TEXT — the plan stem the session declared.
* ``custody_occupants`` JSONB — every custody slot found for the worktree, one
  object per session, newest first (a shared checkout can hold several).

## Shape

Same rules as ``runprov_01_worktree_census_build_target``:

* **Nullable, no default** — the census is an append-only oplog with a long
  tail of historical rows, and a runner that predates the reporting change
  omits the fields. NULL is "not observed", never "unoccupied".
* **No index** — consumers reach rows via the existing
  ``(device_id, observed_at DESC)`` / ``(repo, path)`` paths; the table is
  high-churn, so an index would be pure write cost.
* **TEXT, not enums** — ``wip_state`` and the identifiers are vocabularies the
  runner and the custody recorder own; coord must not pin them.

Additive and reversible: ``downgrade`` drops exactly these eight columns.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "custody_01_worktree_census_occupancy"
down_revision: str = "coord_iops_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "worktree_census"
_SCHEMA = "coord"

# The column NAMES are the interface coord's `worktree_census.rs` reads; a
# rename here idles its degrade-on-42703 tier forever with no error.
_CUSTODY_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("custody_session_id", sa.Text()),
    ("custody_session_name", sa.Text()),
    ("custody_last_seen", sa.DateTime(timezone=True)),
    ("custody_wip_state", sa.Text()),
    ("custody_wip_ref", sa.Text()),
    ("custody_work_unit_id", sa.Text()),
    ("custody_plan_slug", sa.Text()),
    ("custody_occupants", postgresql.JSONB(astext_type=sa.Text())),
)


def upgrade() -> None:
    for name, type_ in _CUSTODY_COLUMNS:
        op.add_column(
            _TABLE,
            sa.Column(name, type_, nullable=True),
            schema=_SCHEMA,
        )


def downgrade() -> None:
    for name, _ in reversed(_CUSTODY_COLUMNS):
        op.drop_column(_TABLE, name, schema=_SCHEMA)
