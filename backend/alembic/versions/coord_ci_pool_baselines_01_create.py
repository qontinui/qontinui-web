"""coord.ci_pool_eligibility_baselines — persisted high-water mark for the CI-pool decline alert

Revision ID: coord_ci_pool_baselines_01
Revises: pr_fix_default_on_01
Create Date: 2026-09-14

Phase 3 item 3 ("persistence") of plan
``2026-09-13-coord-counts-ci-runners-it-cannot-route-to``.

Creates ``coord.ci_pool_eligibility_baselines``: one row per ``(tenant_id,
repo, pool)``, holding the 7-day high-water mark of eligible CI runner
REGISTRATIONS for that pool, the most recent observation, and whether the
decline alert is currently open for it.

## What writes it

coord's pool-eligibility tick (``qontinui-coord``, Phase 3 of the same plan).
On each tick it counts, per ``(repo, pool)``, the registered self-hosted
runners whose labels satisfy the pool's ``runs-on`` label set, online or not,
and upserts this row:

* ``last_eligible_registrations`` / ``last_observed_at`` take the current count
  and the tick time.
* ``max_eligible_registrations`` / ``max_observed_at`` rise to the current count
  whenever it reaches or exceeds the stored mark. When ``max_observed_at`` is
  older than 7 days the mark DECAYS: the tick re-baselines it to the current
  count. An intentional retirement therefore pages once and then stops.
* ``alert_open`` flips to true when the tick raises
  ``ci_pool_eligibility_declined`` (current count below the mark) and back to
  false when it resolves (count back at the mark, or the mark decayed).

``pool`` is the pool key: the pool's ``runs-on`` labels, lowercased, sorted,
joined with ``,``. Rendering that key is the writer's job; two spellings of the
same label set would split one pool into two baselines, so every writer must
render it through the one shared function.

## Why it is persisted rather than held in memory

The alert this feeds exists to catch the 2026-09-12 incident: a label change
out-of-band left a pool with 1 eligible registration where it had 3, and
nothing fired because the count never reached zero. The detector compares the
current count to a remembered high-water mark. If that mark lived in process
memory, a deploy or a leader change would re-seed it from the first tick after
restart, which is to say at the POST-incident value, and the decline alert
would never fire for the incident in flight. A deploy is exactly what tends to
follow an incident, so the in-memory form fails in the case it is for.

``alert_open`` is persisted for the same reason: the alert is raised once per
transition, and a new leader that did not know an alert was already open would
raise it a second time.

## Column shape

* ``tenant_id`` UUID NOT NULL, FK to ``coord.tenants`` ON DELETE CASCADE (see
  below). The tick is tenant-scoped.
* ``repo`` TEXT NOT NULL, ``owner/name`` LOWERCASED by the writer. CHECK
  non-empty, and CHECK ``repo = lower(repo)``. GitHub treats owner/name
  case-insensitively, so ``Qontinui/qontinui-coord`` and
  ``qontinui/qontinui-coord`` are one repository; stored as two rows they would
  be two baselines, the post-incident one would seed fresh at the low count,
  and the decline alert would never fire. The CHECK makes a writer that skips
  the lowercasing fail loudly instead.
* ``pool`` TEXT NOT NULL, the pool key above. CHECK non-empty: an empty key
  would be a pool with no labels, which no job can target.
* ``max_eligible_registrations`` INTEGER NOT NULL, CHECK ``>= 0``, and
  ``max_observed_at`` TIMESTAMPTZ NOT NULL. No default on either: the mark and
  its time are both decided by the tick, and a default ``now()`` on
  ``max_observed_at`` would silently restart the 7-day decay window on any
  writer that forgot to carry the time.
* ``last_eligible_registrations`` INTEGER NOT NULL, CHECK ``>= 0``, and
  ``last_observed_at`` TIMESTAMPTZ NOT NULL DEFAULT ``now()``.
* ``alert_open`` BOOLEAN NOT NULL DEFAULT false.

Counts are NOT NULL: a tick that could not count (an UNKNOWN pool) writes
nothing for that pool rather than a zero, so a stored count is always a real
observation. That keeps an unresolvable pool from reading as a decline.

## FK to coord.tenants, ON DELETE CASCADE

``tenant_id`` references ``coord.tenants(tenant_id)`` ON DELETE CASCADE, as
constraint ``ci_pool_eligibility_baselines_tenant_id_fkey``. That is the name
PostgreSQL gives an inline ``REFERENCES``, and the ``<table>_tenant_id_fkey``
form ``coord_tenant_fk_01_repair_missing_tenant_fks`` addresses its constraints
by.

House practice on tenant FKs is mixed, and the tables named here are examples,
not the whole set. Among others, ``coord_tenant_warm_bytes_01`` and the
``pr_merge_*`` settings tables take one, and
``coord_tenant_fk_01_repair_missing_tenant_fks`` (2026-08-18) went back to add
the FKs that never landed on ``agent_logs``, ``agent_questions``, ``memories``
and ``primary_trees``. Among others, ``coord_prepaid_balances_01``,
``coord_findings`` and ``coordnotif_01`` take none.

This table follows ``coord_tenant_warm_bytes_01``, its closest precedent: that
is also per-tenant state coord re-derives, and it cascades. Being re-derivable
does not make a stale row harmless. Without the cascade a deleted tenant would
leave its baselines behind, and if the id were ever reused its pools would
inherit a high-water mark and an ``alert_open`` flag describing another
tenant's runners. The usual objection to an FK on a hot writer, that it might
write for a tenant before the ``coord.tenants`` row exists, does not apply: the
tick only writes for tenants that already have runner devices bound, so the
tenant row precedes every write.

## No trigger, and no secondary index

The house has no ``CREATE TRIGGER`` in its revision chain, so the
``last_observed_at`` default covers INSERT only; the tick sets it explicitly on
every ``ON CONFLICT ... DO UPDATE``. The primary key ``(tenant_id, repo,
pool)`` is the lookup the tick makes, and a tenant-wide read is a prefix scan
of it. No planned reader filters on ``alert_open`` or on either timestamp.

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
``qontinui-coord`` binary authors zero ``coord.*`` DDL. The coord tick that
reads and writes this table is downstream, so this migration must be applied
in production BEFORE that coord binary ships.

## Head choice

``down_revision`` is ``pr_fix_default_on_01``, the single head of
``origin/main`` when this revision was rebased onto it
(``scripts/ci/count_alembic_heads.py`` reported ``HEAD_COUNT=1``). If main has
moved before it lands, re-point ``down_revision``, the ``Revises:`` header and
``_PARENT_REVISION_ID`` in the migration test at the new single head. Do not
add an ``alembic merge``: this repo keeps strict single-head discipline.

## Merge-train classifier disposition

coord's migration classifier (``qontinui-coord``
``crates/coord/src/pr_merge/migration_classifier.rs``) is expected to classify
this revision Reject: ``COMMENT ON`` is not a form it recognises, and it scans
``downgrade()`` too, where it rejects the ``DROP TABLE``. Every SQL string is a
static literal, so it is not rejected for being dynamic. The landed precedents
``coord_displaced_pr_rows_01`` and ``coord_prepaid_balances_01`` classify
Reject the same way.

## Safety

``CREATE TABLE IF NOT EXISTS``, and every ``COMMENT ON`` is re-runnable, so a
partial apply re-runs cleanly. No existing table is rewritten.

The inline FK takes a SHARE ROW EXCLUSIVE lock on ``coord.tenants``, the table
behind every coord session registration, and env.py runs the batch in one
transaction, so the lock is held until the batch commits. Both directions
therefore bound lock waits with ``SET LOCAL lock_timeout = '3s'`` and restore
the default afterwards, the guard ``coord_tenant_warm_bytes_01`` uses: a
blocked apply fails fast instead of queueing in front of coord.
``downgrade()`` is ``DROP TABLE IF EXISTS``, and the comments go with the
table. Both directions are pure SQL execution with no bind or inspection, so
they work under ``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_ci_pool_baselines_01"
down_revision: str | Sequence[str] | None = "pr_fix_default_on_01"  # fmt: skip
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The fmt skip marker above is load-bearing, not style. The head gate in
# scripts/ci/_alembic_graph.py reads DOWN_RE one line at a time, and ruff format
# wraps an over-88-column assignment in parentheses, which that regex reads as
# NO parent. The marker keeps a re-point onto a longer head id from silently
# breaking the gate.
#
# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.


def upgrade() -> None:
    """Create coord.ci_pool_eligibility_baselines and document it in the catalogue."""
    # The inline FK locks coord.tenants until the batch commits. Bound the wait
    # so a blocked apply fails fast, as coord_tenant_warm_bytes_01 does.
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_pool_eligibility_baselines (
            tenant_id                    UUID NOT NULL,
            repo                         TEXT NOT NULL,
            pool                         TEXT NOT NULL,
            max_eligible_registrations   INTEGER NOT NULL,
            max_observed_at              TIMESTAMPTZ NOT NULL,
            last_eligible_registrations  INTEGER NOT NULL,
            last_observed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
            alert_open                   BOOLEAN NOT NULL DEFAULT false,
            CONSTRAINT ci_pool_eligibility_baselines_pkey
                PRIMARY KEY (tenant_id, repo, pool),
            CONSTRAINT ci_pool_eligibility_baselines_tenant_id_fkey
                FOREIGN KEY (tenant_id)
                REFERENCES coord.tenants (tenant_id) ON DELETE CASCADE,
            CONSTRAINT ci_pool_eligibility_baselines_repo_nonempty_check
                CHECK (repo <> ''),
            CONSTRAINT ci_pool_eligibility_baselines_repo_lowercase_check
                CHECK (repo = lower(repo)),
            CONSTRAINT ci_pool_eligibility_baselines_pool_nonempty_check
                CHECK (pool <> ''),
            CONSTRAINT ci_pool_eligibility_baselines_max_nonnegative_check
                CHECK (max_eligible_registrations >= 0),
            CONSTRAINT ci_pool_eligibility_baselines_last_nonnegative_check
                CHECK (last_eligible_registrations >= 0)
        )
        """
    )

    # The comments carry what the names cannot: the pool key format, the decay
    # rule, and that the writer owns last_observed_at. psql describe output is
    # where a human meets this schema; the module docstring ships nowhere they
    # will see it.
    op.execute(
        """
        COMMENT ON TABLE coord.ci_pool_eligibility_baselines IS
            'Per (tenant, repo, pool) high-water mark of eligible CI runner registrations, written by the coord pool-eligibility tick and read by the ci_pool_eligibility_declined alert. Persisted so a deploy or leader change does not re-seed the baseline at a post-incident value. Writers set last_observed_at explicitly on every update: there is no trigger.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_eligibility_baselines.tenant_id IS
            'Owning tenant. FK to coord.tenants ON DELETE CASCADE, so a deleted tenant leaves no baseline behind to be misread if its id is ever reused.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_eligibility_baselines.repo IS
            'GitHub repository as owner/name, lowercased by the writer. GitHub treats owner/name case-insensitively, so two spellings would split one baseline in two; the repo_lowercase CHECK rejects an unnormalised write.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_eligibility_baselines.pool IS
            'Pool key: the runs-on label set, lowercased, sorted, joined with a comma. Rendered by one shared writer function; two spellings would split one pool into two baselines.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_eligibility_baselines.max_eligible_registrations IS
            'High-water mark of eligible registrations, online or not. Decays to the current count once max_observed_at is older than 7 days.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_eligibility_baselines.max_observed_at IS
            'When the high-water mark was last set. Starts the 7-day decay window. No default: the tick decides it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_eligibility_baselines.last_eligible_registrations IS
            'Eligible registrations at the most recent tick that could count the pool. An uncountable pool is not written, so this is never a stand-in zero.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_eligibility_baselines.last_observed_at IS
            'When the last count was taken. The default covers INSERT only; every ON CONFLICT DO UPDATE must set it explicitly.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_pool_eligibility_baselines.alert_open IS
            'True while ci_pool_eligibility_declined is raised for this pool, so the alert is raised once per transition across leader changes.'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop coord.ci_pool_eligibility_baselines. Its comments and constraints go with it."""
    # Dropping a table that carries an FK also locks the referenced table, so
    # the same bound as the upgrade applies.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP TABLE IF EXISTS coord.ci_pool_eligibility_baselines")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
