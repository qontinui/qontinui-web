"""coord PG overload fix #2 — follow-up: drop the two now-redundant prefix indexes.

Follow-up cleanup to ``coord_pg_overload_idx_02_observation_query_indexes``.

That migration (the mitigation for the 2026-07-21 RDS 99.7%-CPU incident) added
two ``DISTINCT ON`` composites whose leading columns exactly duplicate a shorter
pre-existing index, and it deliberately LEFT the shorter indexes in place —
dropping a live index during an active incident is a separate, riskier change,
so it was flagged in that migration's docstring as belonging to a follow-up
cleanup rather than the mitigation. This is that cleanup.

The two redundant pairs
------------------------------------------------------------------------------
Each dropped index is a strict *prefix* of a surviving composite: a b-tree on
``(a, b, c)`` serves every query an index on the leading subset ``(a, b)`` or
``(a, b, c)`` could serve, so the shorter one buys nothing once the longer one
exists. Both dropped indexes are plain, non-unique, non-partial b-trees that
back no constraint (verified against ``twin_04_coord_config_observations`` and
``twin_06_coord_route_serving_observations``), so removing them is purely a
loss of write-amplification and storage on these hot append-heavy tables — no
read path regresses.

1. ``idx_config_observations_surface_kind_key`` — ``(surface, kind, key)``.
   Superseded by ``idx_config_observations_surface_kind_key_observed`` —
   ``(surface, kind, key, observed_at DESC)``.

2. ``idx_route_serving_observations_host_path`` — ``(host, route_path)``.
   Superseded by ``idx_route_serving_observations_host_path_observed`` —
   ``(host, route_path, observed_at DESC)``.

The two supersedes were called out by name in the ``_02`` docstring
("This SUPERSEDES … left in place … belongs in a follow-up cleanup").

Why the other three ``_02`` indexes are NOT touched here
------------------------------------------------------------------------------
The ``release_observations`` composite and the ``pr_events`` partial index have
no shorter duplicate to retire (the prior ``pr_events`` index has a different,
non-overlapping shape; ``release_observations`` only had an ``observed_at``-led
index and a ``tenant_id`` partial, neither a prefix of the new one). The
``idx_route_serving_observations_drift_status`` index is likewise novel. So
this cleanup is exactly the two prefix indexes and nothing else.

Ordering / safety
------------------------------------------------------------------------------
``Revises: coord_pg_overload_idx_02`` — alembic therefore guarantees the
superseding composites are created BEFORE these prefixes are dropped, so there
is never a window in which neither the prefix nor its replacement exists.

``DROP INDEX CONCURRENTLY`` (not plain ``DROP INDEX``): these are hot
append-heavy tables under live production write load. A plain drop takes an
``ACCESS EXCLUSIVE`` lock on the table and would block writers; the CONCURRENTLY
form takes only a ``SHARE UPDATE EXCLUSIVE`` lock. CONCURRENTLY cannot run
inside a transaction, hence ``op.get_context().autocommit_block()`` (same
precedent as ``coord_pg_overload_idx_01`` / ``_02`` / ``gate_action_02``). On
the CI fresh DB the tables are empty so the drops are instant. Reversible:
``downgrade`` recreates each prefix index ``CONCURRENTLY IF NOT EXISTS`` with
its original ``(surface, kind, key)`` / ``(host, route_path)`` definition. No
table or column is altered.

Note on a killed CONCURRENTLY op: a cancelled concurrent build/drop can leave an
INVALID index of the same name. ``IF EXISTS`` / ``IF NOT EXISTS`` keep both
directions idempotent; if a re-run skips an invalid leftover, ``DROP INDEX`` it
manually and re-run.

Revision ID: coord_pg_overload_idx_03
Revises: coord_pg_overload_idx_02
Create Date: 2026-07-21

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_pg_overload_idx_03"
down_revision: str | None = "coord_pg_overload_idx_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the two prefix indexes superseded by the ``_02`` composites."""
    with op.get_context().autocommit_block():
        # Superseded by idx_config_observations_surface_kind_key_observed
        # (surface, kind, key, observed_at DESC).
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_config_observations_surface_kind_key"
        )
        # Superseded by idx_route_serving_observations_host_path_observed
        # (host, route_path, observed_at DESC).
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_route_serving_observations_host_path"
        )


def downgrade() -> None:
    """Recreate the two prefix indexes exactly as their twin migrations made them."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_route_serving_observations_host_path
            ON coord.route_serving_observations (host, route_path)
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_config_observations_surface_kind_key
            ON coord.config_observations (surface, kind, key)
            """
        )
