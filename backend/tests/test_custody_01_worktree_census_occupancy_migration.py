"""Source-level guards for the ``custody_01_worktree_census_occupancy`` revision.

Phase 1a of plan ``2026-09-07-shared-checkout-occupancy-is-invisible-to-coord``.
coord's ``worktree_census.rs`` reads these columns over a tier that degrades on
SQLSTATE 42703, so a misspelled or mistyped column produces no error anywhere —
these pins are the only signal. No database needed, so they never skip.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from tests._alembic_harness import backend_root, load_revision_module

# `_PARENT_REVISION_ID` MUST equal the revision's own `down_revision`; re-point
# both together if a sibling lands underneath this revision.
_REVISION_ID = "custody_01_worktree_census_occupancy"
_PARENT_REVISION_ID = "coord_iops_idx_01"

_EXPECTED: tuple[tuple[str, type], ...] = (
    ("custody_session_id", sa.Text),
    ("custody_session_name", sa.Text),
    ("custody_last_seen", sa.DateTime),
    ("custody_wip_state", sa.Text),
    ("custody_wip_ref", sa.Text),
    ("custody_work_unit_id", sa.Text),
    ("custody_plan_slug", sa.Text),
    ("custody_occupants", postgresql.JSONB),
)


def _module():
    path = backend_root() / "alembic" / "versions" / f"{_REVISION_ID}.py"
    return load_revision_module(path, f"_rev_{_REVISION_ID}")


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID


def test_the_revision_targets_coord_worktree_census() -> None:
    module = _module()
    assert (module._SCHEMA, module._TABLE) == ("coord", "worktree_census")


def test_the_columns_coord_reads_have_the_expected_names_and_types() -> None:
    columns = _module()._CUSTODY_COLUMNS
    assert [name for name, _ in columns] == [name for name, _ in _EXPECTED]
    for (name, type_), (_, expected) in zip(columns, _EXPECTED, strict=True):
        assert isinstance(type_, expected), f"{name}: {type_!r} is not {expected}"
    last_seen = dict(columns)["custody_last_seen"]
    assert last_seen.timezone is True, "custody_last_seen must be TIMESTAMPTZ"
