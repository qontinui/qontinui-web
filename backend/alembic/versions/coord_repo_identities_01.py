"""coord.repo_identities, and canonical_repos.bare_dir -- following a repo rename

Revision ID: coord_repo_identities_01
Revises: coord_test_result_runs_01
Create Date: 2026-11-08

Phases 3 and 4a (qontinui-web half) of plan
``2026-11-02-coord-follows-a-repository-rename-or-transfer``: the
``coord.repo_identities`` table (below), and the nullable
``coord.canonical_repos.bare_dir`` column (section "bare_dir").

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

## bare_dir -- a rename never moves a bare

Every coord replica keeps its own copy of each repo's canonical bare under
``<COORD_GIT_ROOT>/<owner>/<name>.git``, derived from ``canonical_repos.repo``.
Moving those copies on every replica in lockstep with a database rename is a
distributed-consistency problem, so coord does not: a rename re-keys
``repo`` and sets ``bare_dir`` to the directory the bare is actually in
(``COALESCE(bare_dir, <old repo>)``). NULL -- every existing row, and every row
never renamed -- means "derive it from ``repo``", so there is nothing to
backfill.

* ``ck_canonical_repos_bare_dir_safe`` -- NULL, or exactly two non-empty
  segments ``owner/name`` with no ``/``, ``\\`` or ``:`` inside a segment, no
  segment starting with ``.`` and no ``..`` anywhere: coord's own per-segment
  path validation (``git_origin::validate_segment``), so a stored value can
  never escape the git root.
* ``ux_canonical_repos_effective_dir`` -- UNIQUE on
  ``COALESCE(bare_dir, repo)``: two rows can never resolve to one directory
  (after ``a`` is renamed to ``b`` keeping ``bare_dir = a``, a new repo
  registered as ``a`` must get a directory of its own; coord picks
  ``a.<tag>``). It is case-SENSITIVE on purpose: it is sound on existing data
  only because ``repo`` is already UNIQUE case-sensitively and every
  ``bare_dir`` starts NULL, whereas a ``lower(...)`` index would fail to build
  on any pair of case-variant registry rows (the re-key code documents that
  such pairs can exist). The deployed git roots are case-sensitive file
  systems, so this is the property that keeps two rows off one directory;
  coord's registration screen additionally avoids a case-variant of a taken
  directory.

``canonical_repos`` is small (one row per registered repo), so the column add,
the CHECK (validated in place) and the index build hold their locks briefly.

## moved_at -- refusing a replayed move

``coord.repo_identities.moved_at`` (nullable) is GitHub's time
(``repository.updated_at``) of the last rename or transfer coord applied for
the id. coord refuses a ``repository`` webhook older than it: after
``A -> B -> A`` the id is recorded under ``A`` again, so a replayed ``A -> B``
names the recorded name as its old one and only the time tells it is stale.

## retired_bare_dirs -- a deleted renamed repo keeps its directory claimed

When a ``canonical_repos`` row with a ``bare_dir`` is deleted (un-enrollment),
its bare is not removed from the replicas' disks. Without a record, nothing
would claim that directory any more and a repository later registered under
the renamed repo's OLD name would adopt the leftover bare. coord inserts the
row's ``bare_dir`` here in the deleting transaction, and registration treats a
retired directory as taken (a new row then gets ``<owner>/<name>.<tag>``).
Same safe-path CHECK as ``bare_dir``. No ``tenant_id``: it names directories,
not tenants' data, and it keeps the default tenant-role grants because the
un-enrollment that writes it can run on a tenant-scoped connection.

## Head choice

``down_revision`` is the repo's single alembic head at authoring time
(``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``,
``HEAD=coord_test_result_runs_01``, re-pointed 2026-11-08 after that sibling
landed on ``main`` with the same parent). coord re-points it at land time if
another sibling lands first; the companion test reads the parent from this
file, so it moves with it.

## Two-repo ordering -- this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema (served
policy ``production-and-cost`` ``alembic-sole-authorship``). The coord build
that reads and writes this table is held behind this migration being applied
in production, and must degrade on a missing table
(``pg_error::is_missing_schema_object``).

## Safety

Additive: one ``CREATE TABLE IF NOT EXISTS`` on a new name, a ``REVOKE`` on
that new table, one index on it, and ``COMMENT ON``; on ``canonical_repos`` one
nullable column with no default (no rewrite), one CHECK and one unique index
on a small table, all guarded so a re-run is a no-op. Nothing to backfill. Every SQL string is a
static literal with no ``:word`` sequence, so the revision renders unchanged in
offline ``--sql`` mode. ``downgrade`` drops only what ``upgrade`` created (dropping ``bare_dir``
loses where a renamed repo's bare lives, so downgrade only before any rename
was followed).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_repo_identities_01"
down_revision: str | Sequence[str] | None = "coord_test_result_runs_01"
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
            moved_at        TIMESTAMPTZ,
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

    # moved_at (module docs, "moved_at"); ADD IF NOT EXISTS so a database that
    # applied an earlier draft of this revision converges too.
    op.execute(
        "ALTER TABLE coord.repo_identities ADD COLUMN IF NOT EXISTS moved_at TIMESTAMPTZ"
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.repo_identities.moved_at IS
            'GitHub''s time (repository.updated_at) of the last rename or transfer coord applied for this id. A repository webhook older than this is a replay and is refused, so replaying A to B after A to B to A cannot roll the second move back. NULL until a move is applied.'
        """
    )

    # canonical_repos.bare_dir (module docs, "bare_dir").
    op.execute(
        "ALTER TABLE coord.canonical_repos ADD COLUMN IF NOT EXISTS bare_dir TEXT"
    )
    op.execute(
        r"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                 WHERE conname = 'ck_canonical_repos_bare_dir_safe'
                   AND conrelid = to_regclass('coord.canonical_repos')
            ) THEN
                ALTER TABLE coord.canonical_repos
                    ADD CONSTRAINT ck_canonical_repos_bare_dir_safe CHECK (
                        bare_dir IS NULL
                        OR (bare_dir ~ '^[^/\\:.][^/\\:]*/[^/\\:.][^/\\:]*$'
                            AND strpos(bare_dir, '..') = 0)
                    );
            END IF;
        END
        $$
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_canonical_repos_effective_dir
            ON coord.canonical_repos ((COALESCE(bare_dir, repo)))
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.canonical_repos.bare_dir IS
            'Where this repo''s canonical bare lives under the coord git root (owner/name, no .git), when that is not the directory repo derives. Set by the repository rename re-key to the directory the bare already occupies (a rename never moves a bare), and by registration when the derived directory is another row''s. NULL means derive it from repo. Plan 2026-11-02-coord-follows-a-repository-rename-or-transfer.'
        """
    )

    # retired_bare_dirs (module docs, "retired_bare_dirs").
    op.execute(
        r"""
        CREATE TABLE IF NOT EXISTS coord.retired_bare_dirs (
            bare_dir    TEXT PRIMARY KEY,
            repo        TEXT NOT NULL,
            retired_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_retired_bare_dirs_bare_dir_safe CHECK (
                bare_dir ~ '^[^/\\:.][^/\\:]*/[^/\\:.][^/\\:]*$'
                AND strpos(bare_dir, '..') = 0
            )
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.retired_bare_dirs IS
            'Bare directories of deleted canonical_repos rows that had a bare_dir (a renamed repo kept its old name''s directory), claimed for good: registration never gives such a directory to a new repo, so a repository created under a renamed repo''s old name cannot adopt the bare left on disk. Written by the un-enrollment delete. Plan 2026-11-02-coord-follows-a-repository-rename-or-transfer.'
        """
    )


def downgrade() -> None:
    """Drop retired_bare_dirs, bare_dir (with its CHECK and index), and the table."""
    op.execute("DROP TABLE IF EXISTS coord.retired_bare_dirs")
    op.execute("DROP INDEX IF EXISTS coord.ux_canonical_repos_effective_dir")
    op.execute(
        "ALTER TABLE coord.canonical_repos "
        "DROP CONSTRAINT IF EXISTS ck_canonical_repos_bare_dir_safe"
    )
    op.execute("ALTER TABLE coord.canonical_repos DROP COLUMN IF EXISTS bare_dir")
    op.execute("DROP TABLE IF EXISTS coord.repo_identities")
