"""coord.ci_runner_scope_listings — the last COMPLETE GitHub runner listing per scope

Revision ID: cirscope_01_ci_runner_scope_listings
Revises: cfo_01_continuation_deferred_device
Create Date: 2026-11-15

Phase 2 of plan
``2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console``
(the qontinui-web half).

coord authors **zero** ``coord.*`` DDL (``[policy: alembic-sole-authorship]``), so
the table coord's CI-runner registrar is about to write lands here, and this
revision must be applied **before** any coord build reads or writes it.

The re-point rule
=================

``down_revision`` is this repo's single alembic head at authoring time and is
deliberately NOT pinned to it: ``alembic-graph-pr.yml`` serialises alembic PRs,
so a revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; do NOT author an ``alembic merge``
revision and do NOT order it with coord dependency labels.

The gap
=======

coord's CI-runner registrar polls GitHub's self-hosted runner listing on the
LEADER only, and keeps what it learned in process memory. A follower, or any
replica after a restart, therefore reads the registrar's view as UNKNOWN, so the
fleet roster (``GET /coord/fleet/dispatch-roles``) cannot say, from whichever
replica serves it, whether GitHub still lists a CI registration. That is how a
dead host (``spaceship-wsl`` on 2026-11-15, gone from GitHub for days) stayed on
the roster with nothing marking it.

This table makes the registrar's last COMPLETE listing of each polled scope
durable: one row per scope, replaced by the leader after every listing in which
every page was walked, no page answered 401/403 or was rate limited, and no page
was a stale cached-body replay. A partial listing never writes, so a name absent
from ``listed_names`` means GitHub positively stopped listing it as of
``listed_at`` — never "the walk did not reach it".

Column contract — shared with coord (that plan's Phase 2)
==========================================================

``scope TEXT PRIMARY KEY``
    The registrar's poll scope, as coord's ``scope_of_hostname`` spells it (one
    repository or one organization). The upsert key: one row per scope, ever.
    Not tenant-scoped: the GitHub listing of a scope is the same fact for every
    tenant that reads it, and coord's roster joins it per device through the
    device's own scope.
``listed_names TEXT[] NOT NULL``
    Every runner name in that complete listing, in the registrar's
    ``runner_identity`` form, so it matches exactly what coord hashes into a
    device id. Empty (``'{}'``) is a real answer — GitHub listed no runner in
    the scope — and is distinct from "no row", which is UNKNOWN.
``listed_at TIMESTAMPTZ NOT NULL``
    When that complete listing finished (coord clock). A reader cites it in the
    ``not_listed`` detail so the age of the evidence is visible.

No default on any column: coord writes all three on every upsert, and a
defaulted ``listed_at`` or ``listed_names`` would manufacture evidence no
listing produced.

Readers
=======

A scope with no row, a missing relation (SQLSTATE 42P01, while this revision is
unapplied), or a read error is UNKNOWN to coord's roster — never ``listed`` and
never ``not_listed`` (``[policy: unknown-must-not-render-as-a-default]``).

Owner-only
==========

The table has no ``tenant_id`` column: a scope's GitHub listing is one fact
shared by every tenant whose devices sit in it, so a row cannot be attributed to
a single tenant. It is therefore ``system_only``, the way ``ingcred_01`` treats
``coord.ingest_credential_tally`` and ``coordrls_01`` treats its census tables.
``coordrls_01``'s ``ALTER DEFAULT PRIVILEGES`` gives ``coord_tenant`` and
``coord_tenant_preflight`` DML on every coord table created after it, and with no
``tenant_id`` column neither r10's oracle nor ``coord_tenant_tables_unenforced``
would ever revisit this one, so ``upgrade()`` revokes both roles here. The REVOKE
is unguarded exactly as in ``ingcred_01``: both roles are created by
``coordrls_01``, an ancestor of this revision, so they always exist when it
runs. coord itself connects as the owning migrator role, so its reads and writes
are unaffected.

No index beyond the primary key
===============================

The table holds one row per polled GitHub scope across every tenant, is read
by primary key or in full, and is written by one leader. The primary-key index
is all it needs.

Merge-train classifier disposition
==================================

The coord migration classifier
(``crates/coord/src/pr_merge/migration_classifier.rs``) is expected to classify
this file **Reject**, so its PR takes the escalated land path (an operator
clears it) rather than auto-landing. Every other statement in ``upgrade()`` is
one the ``sessruns_01_session_runs`` revision documents as an admitted branch
(``CREATE SCHEMA IF NOT EXISTS``, plain ``CREATE TABLE``, ``COMMENT ON`` with
plain literals), but the classifier does not parse ``REVOKE`` or ``GRANT``: it
answers "unparseable/unrecognized SQL statement (fail-closed)" for the
owner-only ``REVOKE``, and one rejected statement rejects the file.
``secrets_broker_01_coord_tables`` and ``coord_repo_tenant_bindings_01`` record
the same classifier behaviour; they could leave the privileges alone because
their tables carry ``tenant_id``, which this one does not.

The ``REVOKE`` stays anyway, as in ``ingcred_01``. Without it the tenant roles
keep the DML ``coordrls_01``'s default privileges grant, on a table no tenant
oracle will ever revisit (see "Owner-only"), so a tenant-role connection could
read or rewrite another tenant's runner evidence. An escalated land costs one
operator review once; a missing ``REVOKE`` would be a standing cross-tenant
grant. Every SQL string is a static literal, so nothing is rejected as dynamic.

Safety
======

One new empty table: ``CREATE TABLE IF NOT EXISTS``, re-runnable ``COMMENT ON``
and an idempotent ``REVOKE``, so a partial apply re-runs cleanly. No existing
table is altered, so no lock on a hot table is taken. ``downgrade()`` drops the
table, ``IF EXISTS``; its rows are a cache of GitHub's listing that the leader
rebuilds on its next complete poll, so dropping them loses no state that is not
reconstructible.

Not mirrored by a SQLAlchemy model: the web backend neither reads nor writes
this table (coord is its only writer and reader).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cirscope_01_ci_runner_scope_listings"
down_revision: str | Sequence[str] | None = "cfo_01_continuation_deferred_device"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic.


def upgrade() -> None:
    """Create the table and document it. No rows."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.ci_runner_scope_listings (
            scope         TEXT PRIMARY KEY,
            listed_names  TEXT[] NOT NULL,
            listed_at     TIMESTAMPTZ NOT NULL
        )
        """
    )
    # system_only: undo the DML coordrls_01's default privileges just gave the
    # tenant roles on this new table (module docs, "Owner-only").
    op.execute(
        "REVOKE ALL ON coord.ci_runner_scope_listings "
        "FROM coord_tenant, coord_tenant_preflight"
    )
    op.execute(
        """
        COMMENT ON TABLE coord.ci_runner_scope_listings IS
            'The CI-runner registrar''s last COMPLETE GitHub self-hosted '
            'runner listing per polled scope (repository or organization), '
            'written by the coord leader only after every page was walked '
            'with no 401/403, rate limit or stale cached-body replay. Durable '
            'so any replica can tell the fleet roster whether GitHub still '
            'lists a CI registration. A scope with no row is UNKNOWN, never '
            'listed and never not listed. Written and read only by coord; '
            'no tenant_id, so system_only: the tenant roles hold no privilege.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_scope_listings.scope IS
            'The registrar poll scope as coord scope_of_hostname spells it. '
            'One row per scope; the upsert key.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_scope_listings.listed_names IS
            'Every runner name in the complete listing, in the registrar '
            'runner_identity form (what coord hashes into a device id). '
            'Empty = GitHub listed no runner in the scope; distinct from no '
            'row, which is UNKNOWN.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.ci_runner_scope_listings.listed_at IS
            'When that complete listing finished (coord clock). The age of '
            'the evidence behind a not_listed verdict.'
        """
    )


def downgrade() -> None:
    """Exact inverse — drop the table (its comments go with it)."""
    op.execute("DROP TABLE IF EXISTS coord.ci_runner_scope_listings")
