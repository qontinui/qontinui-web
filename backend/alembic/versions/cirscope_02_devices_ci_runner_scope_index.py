"""coord.devices: partial expression index for the CI-runner registrar's per-scope scan

Revision ID: cirscope_02_devices_ci_runner_scope_index
Revises: coord_subprojects_03_lineage_vocabulary
Create Date: 2026-11-17

A review follow-up of plan
``2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console``
Phase 4 (qontinui-coord#4179, ``ci_runner_registrar/retire.rs``). **coord
authors zero ``coord.*`` DDL** (``[policy: alembic-sole-authorship]``), so the
index lands here, hand-authored, and ahead of the coord change that rewrites its
read to match it.

The re-point rule
=================

``down_revision`` is this repo's single alembic head at authoring time and is
deliberately NOT pinned to it: ``alembic-graph-pr.yml`` serialises alembic PRs,
so a revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; do NOT author an ``alembic merge``
revision.

The read it serves
==================

On every registrar tick, for EACH polled scope (one repository or one
organization) whose GitHub listing came back complete, coord's retirement arm
reads every CI-runner row of that scope. Before this revision it spelled the
scope test as a hostname suffix::

    WHERE COALESCE(d.capabilities @> '["ci_runner"]'::jsonb, false)
      AND right(d.hostname, char_length($1::text)) = $1::text

No btree can serve ``right(...)`` and nothing indexes ``capabilities``, so each
of those reads was a sequential scan of ``coord.devices`` — one per scope per
tick, growing with both the device table and the poll set.

The registrar writes a runner's hostname as ``gh-runner-<runner>@<scope>``, and
coord reads the scope back as the text after the LAST ``@``
(``scope_of_hostname``'s ``rsplit_once('@')``). This index keys exactly that
text, ``regexp_replace(hostname, '^.*@', '')`` (greedy, so it strips through the
last ``@``), over only the rows carrying the ``ci_runner`` capability. coord's
companion change rewrites the read as::

    WHERE d.capabilities @> '["ci_runner"]'::jsonb
      AND regexp_replace(d.hostname, '^.*@', '') = $1::text

so the planner can prove the partial predicate and match the expression. The two
spellings select the same rows: in a WHERE, ``COALESCE(x, false)`` and ``x``
both reject NULL; and a scope key holds no ``@`` (a slug is ``owner/name``, an
org key ``org:<owner>``), so "ends with ``@<scope>``" and "text after the last
``@`` is ``<scope>``" agree. coord pins the match with a DB test that EXPLAINs
its read against this exact definition.

Not measured on production: the row counts of ``coord.devices`` and the share
carrying ``ci_runner`` were not read for this revision. The argument is the
plan shape (a per-scope, per-tick full scan becomes an index range scan over
one scope's rows), not a measured latency.

Write cost: one more btree entry per INSERT, and per UPDATE of ``hostname`` or
``capabilities``, of a CI-runner row only (the predicate keeps every other
device out of the index). ``regexp_replace`` is IMMUTABLE, as an index
expression must be.

Built ``CONCURRENTLY`` so device heartbeats and registrations are never blocked.
A killed concurrent build leaves an INVALID index that ``IF NOT EXISTS`` would
then skip and report as success, so the create is followed by an ``indisvalid``
check that raises with the recovery (the ``census_idx_01`` precedent).

Merge-train classifier disposition
==================================

An additive ``CREATE INDEX CONCURRENTLY`` inside an ``autocommit_block`` plus a
catalog SELECT. Every SQL string is a static literal. If the coord migration
classifier does not admit the expression or partial predicate, the PR takes the
escalated land path, which is acceptable for an additive index.

Safety
======

Additive and idempotent: no table, column or existing index is touched, and a
re-run is a no-op once the index is valid. ``downgrade()`` drops only this
index, ``CONCURRENTLY IF EXISTS``; coord's read stays correct without it (it is
the same sequential scan as before).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cirscope_02_devices_ci_runner_scope_index"
down_revision: str | Sequence[str] | None = "coord_subprojects_03_lineage_vocabulary"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


INDEX_NAME = "idx_devices_ci_runner_scope"


def _require_valid() -> None:
    """Refuse unless ``coord.<INDEX_NAME>`` exists and is ``indisvalid``."""
    valid = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT i.indisvalid FROM pg_index i "
                "JOIN pg_class c ON c.oid = i.indexrelid "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'coord' AND c.relname = :n"
            ),
            {"n": INDEX_NAME},
        )
        .scalar()
    )
    if valid is not True:
        state = "INVALID" if valid is False else "absent"
        raise RuntimeError(
            f"coord.{INDEX_NAME} is {state} after CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "— a killed concurrent build left it (IF NOT EXISTS skipped it). "
            f"Run `DROP INDEX coord.{INDEX_NAME}` plainly and re-run this revision."
        )


def upgrade() -> None:
    """Additive: one CONCURRENTLY partial expression index. Idempotent."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_devices_ci_runner_scope
            ON coord.devices ((regexp_replace(hostname, '^.*@', '')))
            WHERE capabilities @> '["ci_runner"]'::jsonb
            """
        )
        _require_valid()


def downgrade() -> None:
    """Reverse the additive index. The table and every other index survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.idx_devices_ci_runner_scope"
        )
