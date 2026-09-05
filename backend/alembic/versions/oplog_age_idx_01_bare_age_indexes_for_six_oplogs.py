"""Bare age indexes for the six registered oplogs that had none.

Plan: ``2026-09-02-bare-age-indexes-for-the-six-unindexed-observation-oplogs``.

What this fixes
------------------------------------------------------------------------------
coord's ``table_retention`` module prunes eighteen-plus append-only ``coord.*``
tables with one rendered statement shape
(``qontinui-coord`` ``crates/coord/src/table_retention.rs``, ``prune_sql``)::

    DELETE FROM {table} WHERE {pk_col} IN (
        SELECT {pk_col} FROM {table}
         WHERE {age_col} < now() - make_interval(days => $1::int)
         ORDER BY {age_col}
         LIMIT $2)

That subquery wants ``{age_col}`` as an index's **leading** column: the range
predicate and the ``ORDER BY`` are the same column, so a b-tree on it turns the
batch selection into a bounded ordered index scan that stops after ``$2`` rows.

Six registered tables carry only a composite whose leading column is something
else. A composite ``(a, b, age_col)`` cannot serve a query that binds nothing on
``a``, so every sweep on these six seq-scans the whole table and sorts it:

===============================================  =============  ===============================================
Table                                            Age column     Index it had (leading column is NOT the age col)
===============================================  =============  ===============================================
``coord.client_telemetry_observations``          observed_at    ``(surface, origin, observed_at DESC)``
``coord.infra_health_observations``              observed_at    ``(resource_kind, resource_id, observed_at DESC)``
``coord.memory_observations``                    observed_at    ``(tenant_id, observed_at DESC)``
``coord.memory_anchor_observations``             observed_at    ``(tenant_id, observed_at DESC)``
``coord.origin_resolution_observations``         observed_at    ``(domain, path, observed_at DESC)``
``coord.error_observations``                     window_start   ``(surface, window_start DESC)``
===============================================  =============  ===============================================

coord's own module doc names the same six. Every column above was re-read from
the LIVE RDS catalog on 2026-09-05 before this revision was written: the five
``observed_at`` columns and ``error_observations.window_start`` are all present
and ``NOT NULL``, and ``coord.error_observations`` has **no** ``observed_at``
column at all — which is why its index is on ``window_start``. Getting that one
wrong would produce an index no sweep can use.

Why now, when the DELETE was already correct
------------------------------------------------------------------------------
It still is. ``table_retention``'s settled rule is that the missing index makes
a sweep *slower*, not wrong, so deploy order is not load-bearing and this
revision can land in either direction relative to coord. What changed is the
count: registering one such table is a documented exception, six is a class, and
a class with no owner drifts. One revision retires it and makes the next
registration's index question a non-question.

This ADDS; it drops nothing
------------------------------------------------------------------------------
A bare ``(age_col)`` is **not a prefix** of ``(a, b, age_col)`` — the age column
is trailing there, not leading — so no existing index is superseded and none
becomes redundant. This is the exact inverse of
``coord_pg_overload_idx_03_drop_redundant_prefix_indexes``, which dropped two
indexes that WERE strict prefixes of a surviving composite. Nothing here
qualifies, so nothing is dropped and every existing composite keeps serving the
per-key reads it was built for.

Ascending, not ``DESC``
------------------------------------------------------------------------------
The composites above all trail ``observed_at DESC`` because their readers want
the newest row per key. The prune wants the OLDEST rows and spells it
``ORDER BY {age_col}`` — ascending. A single-column b-tree is direction
symmetric (PostgreSQL scans it backwards at no cost), so either spelling serves
both; ascending is used because it matches, token for token, the one statement
these indexes exist for. Do not "align" them to ``DESC`` for consistency with
the composites: it would change nothing, and the ASC spelling is the
documentation of which query owns the index.

``CONCURRENTLY``, and why the autocommit block
------------------------------------------------------------------------------
These are hot append-heavy production tables. A plain ``CREATE INDEX`` takes a
``SHARE`` lock that blocks every writer for the whole build; the
``CONCURRENTLY`` form takes only ``SHARE UPDATE EXCLUSIVE``.  ``CONCURRENTLY``
cannot run inside a transaction, hence ``op.get_context().autocommit_block()``
— the same precedent as ``coord_pg_overload_idx_01`` / ``_02`` / ``_03`` and
``coord_obs_idx_01``. On CI's fresh database the tables are empty, so each build
is instant.

Reversible: ``downgrade`` drops exactly these six indexes,
``CONCURRENTLY IF EXISTS``, and touches no table, column, row or other index.

Note on a killed ``CONCURRENTLY`` op: a cancelled concurrent build can leave an
INVALID index of the same name, which ``IF NOT EXISTS`` then skips on a re-run —
so "the index exists" is not "the index is usable". Both directions are
idempotent; if a re-run skips an invalid leftover, ``DROP INDEX`` it by hand and
re-run. ``tests/test_oplog_age_idx_01_migration.py`` asserts ``indisvalid`` for
this reason rather than mere existence.

Revision ID: oplog_age_idx_01
Revises: coord_agent_questions_audience_backfill
Create Date: 2026-09-05

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "oplog_age_idx_01"
down_revision: str | None = "coord_agent_questions_audience_backfill"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ``(index name, table, age column)`` — the six registered oplogs whose only
# index leads with something other than the age column. Ordered as the plan's
# table orders them. ``error_observations`` is last and is the odd one: its age
# column is ``window_start`` because it has no ``observed_at`` column.
_AGE_INDEXES: tuple[tuple[str, str, str], ...] = (
    (
        "idx_client_telemetry_observations_observed_at",
        "client_telemetry_observations",
        "observed_at",
    ),
    (
        "idx_infra_health_observations_observed_at",
        "infra_health_observations",
        "observed_at",
    ),
    (
        "idx_memory_observations_observed_at",
        "memory_observations",
        "observed_at",
    ),
    (
        "idx_memory_anchor_observations_observed_at",
        "memory_anchor_observations",
        "observed_at",
    ),
    (
        "idx_origin_resolution_observations_observed_at",
        "origin_resolution_observations",
        "observed_at",
    ),
    (
        "idx_error_observations_window_start",
        "error_observations",
        "window_start",
    ),
)


def upgrade() -> None:
    """Create one bare ascending age index per table, CONCURRENTLY."""
    with op.get_context().autocommit_block():
        for index_name, table, age_col in _AGE_INDEXES:
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {index_name} "
                f"ON coord.{table} ({age_col})"
            )


def downgrade() -> None:
    """Drop exactly the six indexes this revision created."""
    with op.get_context().autocommit_block():
        for index_name, _table, _age_col in reversed(_AGE_INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS coord.{index_name}")
