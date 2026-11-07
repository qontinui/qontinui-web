"""coord.repo_identities — GitHub's stable repo id to the name coord last saw

Revision ID: coord_repo_identities_01
Revises: outbound_budget_windows_01
Create Date: 2026-11-08

Phase 4a (qontinui-web half) of plan
``2026-11-02-coord-follows-a-repository-rename-or-transfer``.

## Why

coord keys every repo by its ``owner/name`` text. GitHub keeps a repository's
numeric id across a rename and across a transfer to another owner, so the name
is the one part of a repo's identity that can change under coord. When it
does, coord's rows keep naming the old ``owner/name`` and nothing notices.

This table records, per GitHub repo id, the ``owner/name`` coord last observed
for it. A later observation of the same id under a different name IS the
rename (or transfer), detected by id rather than guessed from names.

## The three columns

* ``github_repo_id`` -- GitHub's numeric repository id (``repository.id`` in
  every webhook payload and REST response). Primary key: one row per repo.
  The id is global across GitHub, so there is no tenant column; a repo is the
  same repo whichever tenant enrolled it.
* ``repo`` -- the ``owner/name`` coord last observed for that id, as GitHub
  spelled it (case preserved). Non-blank.
* ``observed_at`` -- when coord made that observation. coord's upsert should
  only move ``repo`` forward in time (newest-observation-wins), so a delayed
  webhook cannot roll a rename back.

## What writes and reads it

Written by coord enrollment (which learns the id when a repo is enrolled) and
by the ``repository`` webhook arm (``renamed`` / ``transferred`` actions).
Read by the identity sweep (plan Phase 4b) that re-reads each id from GitHub
and detects a rename coord missed, and by the rename handler, which looks a
repo up by name -- hence ``ix_repo_identities_repo_lower`` on ``lower(repo)``.
GitHub resolves names case-insensitively, so the lookup does too.

The name index is deliberately NOT unique: after repo A is renamed away and a
new repo B is created under A's old name, both ids may briefly carry that name
until the sweep or the webhook catches up. A unique index would make coord's
write of B fail on a stale row for A.

## Owner-only (``system_only``)

The table is cross-tenant: GitHub repo ids are global, so one row can name any
tenant's repository and there is no ``tenant_id`` column. coordrls_01's
``ALTER DEFAULT PRIVILEGES`` gives ``coord_tenant`` and
``coord_tenant_preflight`` DML on every coord table created after it, and with
no ``tenant_id`` column neither r10's oracle nor
``coord_tenant_tables_unenforced`` would ever revisit this one, so upgrade()
revokes both roles here, exactly as ``ingcred_01`` does for its cross-tenant
ledger. A tenant role that could write a row could spoof a rename. coord itself
connects as the owning migrator role, so its reads and writes are unaffected.

## Head choice

``down_revision`` is the repo's single alembic head at authoring time
(``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``,
``HEAD=outbound_budget_windows_01``, 2026-11-08). coord re-points it at land
time if a sibling lands first; the companion test reads the parent from this
file, so it moves with it.

## Two-repo ordering -- this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema (served
policy ``production-and-cost`` ``alembic-sole-authorship``). The coord build
that reads and writes this table is held behind this migration being applied
in production, and must degrade on a missing table
(``pg_error::is_missing_schema_object``).

## Safety

Additive: one ``CREATE TABLE IF NOT EXISTS`` on a new name, a ``REVOKE`` on
that new table, one index on it, and ``COMMENT ON``. No existing table is touched, so
there is no lock on a hot table and nothing to backfill. Every SQL string is a
static literal with no ``:word`` sequence, so the revision renders unchanged in
offline ``--sql`` mode. ``downgrade`` drops only what ``upgrade`` created.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_repo_identities_01"
down_revision: str | Sequence[str] | None = "outbound_budget_windows_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create coord.repo_identities, its name index, and document it. No rows."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.repo_identities (
            github_repo_id  BIGINT PRIMARY KEY,
            repo            TEXT NOT NULL,
            observed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_repo_identities_github_repo_id_positive
                CHECK (github_repo_id > 0),
            CONSTRAINT ck_repo_identities_repo_nonblank
                CHECK (btrim(repo) <> '')
        )
        """
    )
    # system_only: undo the DML coordrls_01's default privileges just gave the
    # tenant roles on this new table (module docs, "Owner-only").
    op.execute(
        "REVOKE ALL ON coord.repo_identities FROM coord_tenant, coord_tenant_preflight"
    )
    # The rename handler and the sweep look a repo up by name, case-insensitively.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_repo_identities_repo_lower
            ON coord.repo_identities (lower(repo))
        """
    )

    # Document the table. Each statement is a complete static literal.
    op.execute(
        """
        COMMENT ON TABLE coord.repo_identities IS
            'GitHub''s stable numeric repository id mapped to the owner/name coord last observed for it. A repo keeps its id across a rename or a transfer, so a later observation of the same id under another name is that rename. Written by coord enrollment and by the repository webhook arm (renamed, transferred); read by the identity sweep that detects a rename coord missed, and by the rename handler. Plan 2026-11-02-coord-follows-a-repository-rename-or-transfer.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.repo_identities.github_repo_id IS
            'GitHub repository.id: global across GitHub and stable across rename and transfer, hence no tenant column.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.repo_identities.repo IS
            'The owner/name coord last observed for this id, case as GitHub spelled it. Looked up by lower(repo); not unique, since a stale row may briefly share a name with a newer repo created under it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.repo_identities.observed_at IS
            'When coord observed repo for this id. The newest observation wins, so a delayed event cannot roll a rename back.'
        """
    )


def downgrade() -> None:
    """Drop the table; its index and constraints go with it."""
    op.execute("DROP TABLE IF EXISTS coord.repo_identities")
