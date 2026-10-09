"""coord.commit_observations + coord.fs_observations — keyset indexes for the oplog page reads

Revision ID: oplog_keyset_01
Revises: coord_devices_ui_thread_01
Create Date: 2026-10-09

Phase 5 of plan
``2026-09-05-every-bounded-read-is-a-page-that-reads-as-a-corpus`` (D3, D6).
Adds one index per effect oplog, each keyed on exactly the sort key its page
read walks::

    idx_commit_observations_observed_keyset
        ON coord.commit_observations (observed_at DESC, id DESC)
    idx_fs_observations_observed_keyset
        ON coord.fs_observations (observed_at DESC, id DESC)

and drops ``idx_fs_observations_observed_at`` (``observed_at DESC``), whose
every use the new composite index serves: it has the same leading column and
direction, so any read it served is served by the composite.

## The consumers

qontinui-coord ``crates/coord/src/commit_effects.rs`` ``get_commits``
(``GET /coord/commits``) and ``crates/coord/src/edit_effects.rs``
``get_fs_observations`` (``GET /coord/fs/observations``). Each was a hard
``LIMIT 200`` with no caller knob and no disclosure. They are now keyset-paged
reads on the shared ``qontinui_types::page`` contract:
``ORDER BY observed_at DESC, id DESC`` with the cursor predicate
``(observed_at, id) < ($ts, $id)`` and a ``LIMIT limit + 1`` probe.

Before this revision ``coord.commit_observations`` had no index on
``observed_at`` at all (only ``(repo, branch)``, ``(repo, head_sha)`` and
``(correlation_id)``), so every page sorted the whole filtered table.
``coord.fs_observations`` had ``(observed_at DESC)``, which serves the order
but leaves ``id`` to an Incremental Sort and cannot seek to a row-comparison
cursor on the pair.

## Why the key is immutable (D8)

``observed_at`` is ``TIMESTAMPTZ NOT NULL DEFAULT now()``, written once on
INSERT; ``id`` is the ``BIGSERIAL`` primary key. coord never UPDATEs either
column (pinned by coord's ``commits_sort_key_is_never_updated_anywhere_in_the_crate``
and ``fs_observations_sort_key_is_never_updated_anywhere_in_the_crate``). The
only UPDATE ever run on ``coord.commit_observations`` is
``commitlockfix_01``'s one-time ``branch`` rewrite — a filter, not the key.

## Why not repo-leading

Both reads filter ``repo`` OPTIONALLY (``$1::text IS NULL OR repo = $1``). An
index on the sort key alone serves the unfiltered read and the filtered one (as
a Filter over an ordered walk); a ``(repo, …)`` btree serves only the latter.
Same reasoning as ``findings_keyset_01``.

## Not ordered against the coord change

An index changes the plan the planner picks, never the result set, so this
revision and the coord paging change may land in either order. No column is
added, so the ``alembic-sole-authorship`` FIRST rule does not apply.

## House conventions followed

alembic is the SOLE author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``); hand-authored, never
``--autogenerate``d. Each statement runs ``CONCURRENTLY`` inside its own
``autocommit_block()`` — a plain ``CREATE INDEX`` holds a SHARE lock and
blocks the runner's observation ingest for the whole build. There is no ALTER,
so no ``lock_timeout`` guard to set or restore. ``IF NOT EXISTS`` /
``IF EXISTS`` keep both directions idempotent, and every statement names the
``coord`` schema. The behaviour test
``tests/test_oplog_keyset_01_observed_keyset_indexes_migration.py`` pins the
key order, validity, the no-Sort plan for both production statements (first
page and cursor page), the keyset resume across an ``observed_at`` tie, and the
downgrade.

``down_revision`` chains off the live alembic head at authoring time
(``coord_devices_ui_thread_01``, the single head ``ScriptDirectory.get_heads()``
reports on ``754110909``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "oplog_keyset_01"
down_revision: str | Sequence[str] | None = "coord_devices_ui_thread_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_CREATE_COMMITS_KEYSET_INDEX = """
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commit_observations_observed_keyset
    ON coord.commit_observations (observed_at DESC, id DESC)
"""

_CREATE_FS_KEYSET_INDEX = """
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fs_observations_observed_keyset
    ON coord.fs_observations (observed_at DESC, id DESC)
"""

_DROP_FS_OBSERVED_AT_INDEX = (
    "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_fs_observations_observed_at"
)

# Byte-for-byte the index ``edit_effect_01_coord_edit_effect_tables`` built.
_RECREATE_FS_OBSERVED_AT_INDEX = """
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fs_observations_observed_at
    ON coord.fs_observations (observed_at DESC)
"""

_DROP_FS_KEYSET_INDEX = (
    "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_fs_observations_observed_keyset"
)

_DROP_COMMITS_KEYSET_INDEX = (
    "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_commit_observations_observed_keyset"
)


def upgrade() -> None:
    """Additive keyset indexes, then retire the dominated single-column one."""
    # CONCURRENTLY cannot run inside a transaction; one block per statement so
    # a failure part-way leaves the earlier ones committed and re-runnable. The
    # composite is built BEFORE the old index is dropped, so no moment exists
    # where fs_observations has no observed_at index.
    with op.get_context().autocommit_block():
        op.execute(_CREATE_COMMITS_KEYSET_INDEX)
    with op.get_context().autocommit_block():
        op.execute(_CREATE_FS_KEYSET_INDEX)
    with op.get_context().autocommit_block():
        op.execute(_DROP_FS_OBSERVED_AT_INDEX)


def downgrade() -> None:
    """Reverse exactly this revision, in reverse order."""
    with op.get_context().autocommit_block():
        op.execute(_RECREATE_FS_OBSERVED_AT_INDEX)
    with op.get_context().autocommit_block():
        op.execute(_DROP_FS_KEYSET_INDEX)
    with op.get_context().autocommit_block():
        op.execute(_DROP_COMMITS_KEYSET_INDEX)
