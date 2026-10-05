"""coord route-serving: a per-row method, and one row per host per pass.

Revision ID: route_serving_host_passes_01
Revises: coord_pr_files_head_sha_01
Create Date: 2026-09-25

Phase 3 (the schema half) of plan
``qontinui-dev-notes/plans/2026-09-25-route-serving-observer-probes-mutating-routes-with-their-documented-verb.md``.
Additive only. Nothing reads or writes either object yet: the coord build that
does is that plan's Phase 4 (inventory mode), and it must merge only after this
revision is DEPLOYED, not merely merged (served policy ``production-and-cost``
``alembic-sole-authorship``).

What this adds
==========================================================================

1. ``coord.route_serving_observations.method TEXT NULL``.

   The table keys rows on ``(host, route_path)`` and has no method column, so a
   path's GET and POST observations cannot be told apart (the plan's E9). Phase 4
   compares the declared spec against the served-routes inventory PER METHOD and
   writes one row per ``(route_path, method)``. NULL is the honest value for
   every row written before Phase 4 and for the strategies that probe a path
   without a method (``coord_manifest``, ``next_config``): the method was never
   observed, and no backfill invents one.

2. ``coord.route_serving_host_passes``: one row per host per observer pass.

   Every route in one pass shares one ``observed_at`` (the plan's E9), so the
   pass-level facts (drift class, coverage, credibility, provenance, carves, the
   declared and served digests) are recorded once here instead of being
   re-derived from the per-route rows. Phase 4 writes per-route rows only when a
   key changes, so this table is what keeps an unchanged route from ageing out:
   the Phase 2 reuse read, the age gauge and coverage all derive from it.

Keys and indexes
==========================================================================

``id BIGSERIAL PRIMARY KEY`` exists for ``table_retention`` (qontinui-coord
``crates/coord/src/table_retention.rs``), whose prune statement selects victims
by a single ``pk_col``. The plan registers this table there in Phase 4.

``UNIQUE (host, observed_at)`` is the plan's ``(host, observed_at DESC)`` read
index, spelled as a table constraint inside ``CREATE TABLE``. A b-tree scans
backwards at no cost, so the Phase 2 reuse read
``WHERE host = $1 AND observed_at = (SELECT max(observed_at) ... WHERE host = $1)``
is one descent for the inner max and one for the outer match. The uniqueness is
the invariant as well: one pass writes one row per host.

There is no separate age index for the retention prune, and none is created
with ``CREATE INDEX``. The coord migration classifier rejects a non-concurrent
``CREATE INDEX`` outright, and a concurrent one needs an autocommit block. Keys
declared inside a guarded, plain ``CREATE TABLE IF NOT EXISTS`` are built on an
empty table and classify AutoSafe. The prune then has no index with
``observed_at`` leading, so it seq-scans. That is slower, not wrong
(``oplog_age_idx_01`` records the settled rule), and the table is small: three
configured hosts at one pass per 300 s is 864 rows a day. If that estimate stops
holding, add the age index in a revision of its own.

``drift_class`` and ``strategy`` carry no CHECK. A new class is then a coord
change and not a migration, because a later CHECK change needs a ``DROP
CONSTRAINT`` that the classifier rejects. The column comments name the
vocabularies.

Locking and classification
==========================================================================

The ``ADD COLUMN`` of a nullable column with no default only changes the
catalog, but it still takes a brief ACCESS EXCLUSIVE lock on a table the
observer appends to every cycle. The wait is bounded with ``SET LOCAL
lock_timeout = '3s'`` and restored with ``SET LOCAL lock_timeout = DEFAULT``
(not ``RESET``, which the classifier rejects by name). ``env.py`` runs a whole
upgrade in one transaction, so the restore is required.

Expected coord migration-classifier disposition: **AutoSafe**. The upgrade path
has no ``DROP``, no ``CREATE INDEX``, no autocommit block and no DML. It has one
guarded nullable ``ADD COLUMN``, one guarded plain ``CREATE TABLE``, ``COMMENT
ON`` statements and the two admitted ``lock_timeout`` forms.
``tests/test_route_serving_host_passes_01_migration.py`` pins the parts a later
edit is most likely to break.

Downgrade drops the table and the column. It is the exact inverse of an
additive revision. Downgrade only after the Phase 4 coord build that writes
these objects has been rolled back.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "route_serving_host_passes_01"
down_revision: str | Sequence[str] | None = "coord_pr_files_head_sha_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal: the coord merge-train migration
# classifier rejects an execute call whose argument it cannot read as one. The
# comment bodies avoid apostrophes so no SQL escaping is needed.


def upgrade() -> None:
    """Add the nullable method column and create the per-pass table."""
    # Bound the ACCESS EXCLUSIVE wait: the observer appends to this table every
    # cycle, and a queued exclusive lock blocks every reader behind it.
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.route_serving_observations
            ADD COLUMN IF NOT EXISTS method TEXT
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.route_serving_observations.method IS
            'The HTTP method this observation is about, upper case (GET, POST, ...), written by the openapi strategy once it compares the declared spec against the served-routes inventory per method (plan 2026-09-25-route-serving-observer-probes-mutating-routes-with-their-documented-verb, Phase 4). NULL = no method was observed: every row written before Phase 4, and every row of a strategy that probes a path without a method (coord_manifest, next_config). NULL is never read as GET.'
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.route_serving_host_passes (
            id              BIGSERIAL        PRIMARY KEY,
            host            TEXT             NOT NULL,
            observed_at     TIMESTAMPTZ      NOT NULL,
            strategy        TEXT             NOT NULL,
            drift_class     TEXT             NOT NULL,
            coverage        DOUBLE PRECISION NOT NULL,
            credibility     DOUBLE PRECISION NOT NULL,
            provenance      TEXT             NOT NULL,
            carves          JSONB            NOT NULL DEFAULT '[]'::jsonb,
            declared_digest TEXT,
            served_digest   TEXT,
            CONSTRAINT route_serving_host_passes_host_observed_at_key
                UNIQUE (host, observed_at)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.route_serving_host_passes IS
            'One row per host per route-serving observer pass. Every route in a pass shares one observed_at, so the pass-level verdict lives here and per-route rows in coord.route_serving_observations are written only when a key changes. The Phase 2 reuse read, the observation age gauge and coverage derive from this table. Written by qontinui-coord route_serving_observer; pruned by table_retention. Plan 2026-09-25-route-serving-observer-probes-mutating-routes-with-their-documented-verb, Phases 3 and 4.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.route_serving_host_passes.observed_at IS
            'The shared timestamp of every route observation in this pass. Equal to route_serving_observations.observed_at on the rows the pass wrote. Unique per host.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.route_serving_host_passes.strategy IS
            'The declared-route strategy the pass ran: coord_manifest | openapi | next_config. No CHECK, so a new strategy is a coord change rather than a migration.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.route_serving_host_passes.drift_class IS
            'The pass-level RouteServingDriftClass as_str value: ok | pending | shadow_route | status_drift | route_missing | divergent | unknown. No CHECK, for the same reason as strategy.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.route_serving_host_passes.carves IS
            'The carve markers of this pass as a JSON array: the declared routes the pass could not observe, each with its reason. An empty array means nothing was carved.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.route_serving_host_passes.declared_digest IS
            'Digest of the declared route set the pass compared against (for openapi, the committed base spec). NULL = the strategy computes no digest.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.route_serving_host_passes.served_digest IS
            'The digest field of GET /api/v1/meta/served-routes the pass read (inventory mode). NULL = no inventory was read: options mode, an older web build without the route, or a strategy other than openapi.'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the per-pass table and the method column."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP TABLE IF EXISTS coord.route_serving_host_passes")
    op.execute(
        """
        ALTER TABLE coord.route_serving_observations
            DROP COLUMN IF EXISTS method
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
