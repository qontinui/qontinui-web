"""coord: a repository can be bound to a tenant other than its GitHub org's

Phase 1 of plan ``2026-10-17-per-repo-tenant-binding-overrides-the-org-tenant``
(decision D1).

WHY THIS EXISTS
---------------
Coord decides which tenant owns a repository from its GitHub org alone:
``coord.tenant_github_accounts`` binds each org to exactly one tenant, and every
repository of that org is enrolled into, and governed by, that tenant. The
operator decided on 2026-10-17 that a repository may live in an org while
belonging to a different tenant (``Meryts/bauhaus-b2b-*`` belong to the
``bauhaus-b2b`` tenant, not to ``meryts-2-0``, which owns the ``Meryts`` org).
This table is where that per-repository decision is recorded.

A binding is the AUTHORITY, not a cache of one: only coord's bind door writes
it, no automatic writer (an installation webhook, enrollment, a repo
registration) ever does, and it can name a repository before that repository
exists. So it survives an un-enroll and a re-enroll, and the org binding stays
an independent authority beside it.

SHAPE
-----
At most one row per repository (``repo`` is the PRIMARY KEY). **No row means
the org rule** — the repository's governing tenant is the tenant bound to its
org in ``coord.tenant_github_accounts``, exactly as today, so an empty table
reproduces today's behaviour for every repository.

* ``repo`` — the lowercased ``owner/name``. The CHECK pins that spelling: a
  GitHub owner (letters, digits, hyphens, not starting with a hyphen), one
  slash, a repository name (letters, digits, ``.``, ``_``, ``-``), all lower
  case. It is a spelling guard, not GitHub's full grammar: it admits some
  names GitHub would never create (``a/..``, ``a--b/x``, over-length names),
  which is harmless because a binding for a name that cannot exist binds
  nothing. coord lowercases the name before it binds or looks one up (plan D5),
  so a mixed-case spelling can never become a second binding for the same
  repository.
* ``tenant_id`` — the governing tenant. ``ON DELETE CASCADE``: deleting the
  bound tenant returns governance to the org's tenant, the only owner left.
  The same delete cascades that tenant's ``coord.tenant_repos`` rows, so the
  org's tenant holds no owner row for the repository until its next full-list
  enrollment pass (an enroll-now, or the next ``installation`` event).
* ``bound_by`` — who bound it (an operator or principal id). Never empty or
  whitespace-only (the same non-whitespace rule as ``reason``).
* ``reason`` — why. The CHECK refuses an empty or whitespace-only reason: it
  requires one non-whitespace character. The plan spells it
  ``btrim(reason) <> ''``, but ``btrim`` with no character list strips only
  spaces, so a tab- or newline-only reason would pass that form (measured on
  PostgreSQL 16.15). The regex escape is used rather than the POSIX class
  ``[:space:]`` because alembic runs an ``op.execute`` string through
  ``text()``, which would read ``:spac`` in it as a bind parameter.
* ``decision_ref`` — optional pointer to the recorded decision.
* ``created_at`` / ``updated_at`` — coord stamps ``updated_at`` on a rebind.

The index on ``tenant_id`` serves "every repository bound to this tenant" and
the cascade's lookup when a tenant is deleted. It is built on the table this
revision creates, so it locks nothing that already holds rows.

The primary key also gives the table a replica identity (``replident_01``;
``tests/test_replica_identity_published_schemas.py``).

There is no ``GRANT`` and no ``REVOKE``: coord's fail-closed migration
classifier rejects both, and ``coordrls_01``'s default privileges apply to
this table as to every other coord table. Its row-level-security shape is for
plan ``2026-10-15-coord-tenant-isolation-has-no-database-enforcement`` to
decide when its waves classify ``tenant_id``-carrying tables (coord reads this
table to resolve a repository's tenant, a cross-tenant lookup).

ORDERING
--------
alembic is the sole author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``); hand-authored, never
``--autogenerate``d. Nothing reads the table until the plan's Phase 4 coord
build, which is opened only after this revision is confirmed in production and
degrades a missing table to the org rule. Every statement names the ``coord``
schema and is idempotent (``IF NOT EXISTS``).

If another revision lands on ``overlord_02_four_class_vocabulary`` first, re-point
``down_revision`` (and the ``Revises:`` line below), and the parent pinned in
``tests/test_coord_repo_tenant_bindings_01_migration.py``.

Downgrade drops the table, and every binding with it: every repository is
governed by its org's tenant again.

Revision ID: coord_repo_tenant_bindings_01
Revises: overlord_02_four_class_vocabulary
Create Date: 2026-10-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_repo_tenant_bindings_01"
down_revision: str | Sequence[str] | None = "overlord_02_four_class_vocabulary"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.repo_tenant_bindings`` and its tenant index."""
    op.execute(
        r"""
        CREATE TABLE IF NOT EXISTS coord.repo_tenant_bindings (
            repo         TEXT        PRIMARY KEY
                CHECK (repo = lower(repo) AND repo ~ '^[a-z0-9][a-z0-9-]*/[a-z0-9._-]+$'),
            tenant_id    UUID        NOT NULL REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE,
            bound_by     TEXT        NOT NULL CHECK (bound_by ~ '\S'),
            reason       TEXT        NOT NULL CHECK (reason ~ '\S'),
            decision_ref TEXT        NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_repo_tenant_bindings_tenant "
        "ON coord.repo_tenant_bindings (tenant_id)"
    )


def downgrade() -> None:
    """Drop the table: every repository follows its org's tenant again."""
    op.execute("DROP TABLE IF EXISTS coord.repo_tenant_bindings")
